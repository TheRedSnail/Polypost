// Validates the "formatter IS the LinkedIn composer" UX requirements:
//  1. Clicking "Start a post" opens the formatter; the native LI composer is
//     never visible to the user.
//  2. Dismissing the formatter also dismisses the native composer, with no flash.
//  3. Clicking Post bridges text + posts, native composer never visible, and
//     the formatter does not reappear afterward.
// Visibility is sampled continuously via a rAF loop installed in the page.
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.includes('linkedin.com'));

if (!target) {
  console.error('No LinkedIn page target found.');
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const logs = [];

socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);

  if (data.method === 'Runtime.consoleAPICalled') {
    const text = (data.params.args ?? [])
      .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description ?? ''))
      .join(' ');

    if (text.includes('[LIPF]')) {
      logs.push(`${new Date(data.params.timestamp).toISOString()} ${text.slice(0, 280)}`);
    }
  }
});

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const message = { id: ++nextId, method, params };

    function handleMessage(event) {
      const data = JSON.parse(event.data);

      if (data.id !== message.id) {
        return;
      }

      socket.removeEventListener('message', handleMessage);
      data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result);
    }

    socket.addEventListener('message', handleMessage);
    socket.send(JSON.stringify(message));
  });
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });

  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }

  return result.result.value;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// The validation tab is usually backgrounded (locked machine); re-assert an
// active lifecycle so timers/fetches/animation are not throttled.
async function keepActive() {
  await call('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
}

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

await call('Runtime.enable');
await call('Page.enable');

const marker = `LIPF takeover ${Math.random().toString(36).slice(2, 8)}`;
console.log('test marker:', marker);

const originalDraft = await evaluate(`localStorage.getItem('linkedin-format:draft-v1')`);
const draft = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Takeover Test' }] },
    { type: 'paragraph', content: [{ type: 'text', text: `${marker} - automated, deleting momentarily.` }] },
  ],
};
await evaluate(`localStorage.setItem('linkedin-format:draft-v1', ${JSON.stringify(JSON.stringify(draft))}); true`);

await call('Page.navigate', { url: 'https://www.linkedin.com/feed/' });
await sleep(5000);
await call('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

let mounted = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  mounted = await evaluate(`Boolean(document.querySelector('#linkedin-post-formatter-extension-root'))`);
  if (mounted) break;
  await sleep(250);
}
if (!mounted) {
  console.error('FAIL: extension root never mounted.');
  process.exit(1);
}

// Stash the marker in page scope so cleanup scripts reference it directly
// (avoids fragile nested-template interpolation).
await evaluate(`window.__lipfMarker = ${JSON.stringify(marker)}; true`);

// Install a sampler that, every animation frame, records whether any native
// LinkedIn composer surface is visible to the user (rendered + non-transparent).
await evaluate(String.raw`(() => {
  function deepRoots() {
    const roots = [document];
    for (let index = 0; index < roots.length; index += 1) {
      for (const host of roots[index].querySelectorAll('*')) {
        if (host.shadowRoot) roots.push(host.shadowRoot);
      }
    }
    return roots;
  }
  function nativeComposerVisible() {
    for (const root of deepRoots()) {
      for (const editor of root.querySelectorAll('.ql-editor[contenteditable="true"]')) {
        if (editor.closest('#linkedin-post-formatter-extension-root')) continue;
        const rect = editor.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        // checkVisibility with opacityProperty correctly accounts for ancestor
        // opacity:0 across shadow boundaries (manual climb cannot).
        const visible = editor.checkVisibility
          ? editor.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
          : true;
        if (visible) return true;
      }
    }
    return false;
  }
  window.__lipfSampler = { phase: 'idle', visibleFrames: {}, totalFrames: {} };
  // setInterval (not rAF) so sampling keeps running even when the tab is
  // backgrounded/occluded (rAF is frozen there).
  window.__lipfSamplerId = setInterval(() => {
    const phase = window.__lipfSampler.phase;
    window.__lipfSampler.totalFrames[phase] = (window.__lipfSampler.totalFrames[phase] ?? 0) + 1;
    if (nativeComposerVisible()) {
      window.__lipfSampler.visibleFrames[phase] = (window.__lipfSampler.visibleFrames[phase] ?? 0) + 1;
    }
  }, 16);
  return true;
})()`);

const setPhase = (phase) => evaluate(`window.__lipfSampler.phase = ${JSON.stringify(phase)}; true`);

// ---- TEST A: open via Start a post, then dismiss (no posting) ----
await setPhase('open');
await evaluate(String.raw`(() => {
  const control = Array.from(document.querySelectorAll('button, [role="button"]')).find((element) => {
    const label = ((element.textContent ?? '') + ' ' + (element.getAttribute('aria-label') ?? '')).toLowerCase();
    return label.includes('start a post');
  });
  control?.click();
  return Boolean(control);
})()`);

let formatterOpen = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  await sleep(200);
  formatterOpen = await evaluate(`Boolean(document.querySelector('#linkedin-post-formatter-extension-root .lipf-panel'))`);
  if (formatterOpen) break;
}
console.log('A. formatter opened on Start a post:', formatterOpen);
await sleep(2500); // let the native composer fully render while we sample

// dismiss the formatter
await setPhase('dismiss');
await evaluate(`document.querySelector('#linkedin-post-formatter-extension-root .lipf-icon-button[aria-label="Close formatter"]')?.click(); true`);
await sleep(4000); // sample through the dismissal sequence

const afterDismiss = await evaluate(String.raw`(() => {
  function deepRoots() {
    const roots = [document];
    for (let i = 0; i < roots.length; i += 1) for (const h of roots[i].querySelectorAll('*')) if (h.shadowRoot) roots.push(h.shadowRoot);
    return roots;
  }
  const composerStillPresent = deepRoots().some((r) => Array.from(r.querySelectorAll('.ql-editor[contenteditable="true"]')).some((e) => !e.closest('#linkedin-post-formatter-extension-root')));
  return {
    formatterOpen: Boolean(document.querySelector('#linkedin-post-formatter-extension-root .lipf-panel')),
    nativeComposerPresent: composerStillPresent,
  };
})()`);
console.log('A. after dismiss:', JSON.stringify(afterDismiss));

// ---- TEST B: open again and Post for real ----
await sleep(1000);
await setPhase('reopen');
await evaluate(String.raw`(() => {
  const control = Array.from(document.querySelectorAll('button, [role="button"]')).find((element) => {
    const label = ((element.textContent ?? '') + ' ' + (element.getAttribute('aria-label') ?? '')).toLowerCase();
    return label.includes('start a post');
  });
  control?.click();
  return Boolean(control);
})()`);

formatterOpen = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  await sleep(200);
  formatterOpen = await evaluate(`Boolean(document.querySelector('#linkedin-post-formatter-extension-root .lipf-panel'))`);
  if (formatterOpen) break;
}
console.log('B. formatter reopened:', formatterOpen);
await sleep(1500);

await setPhase('post');
const postClicked = await evaluate(String.raw`(() => {
  const button = document.querySelector('#linkedin-post-formatter-extension-root .lipf-primary-button');
  if (!button || button.disabled) return false;
  button.click();
  return true;
})()`);
console.log('B. extension Post clicked:', postClicked);

// Resolve the just-posted share from the success toast's "View post" link
// (cheap DOM read, no per-attempt network round-trips that throttle badly).
let shareUrn = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await keepActive();
  await sleep(500);
  shareUrn = await evaluate(String.raw`(() => {
    function deepRoots() {
      const roots = [document];
      for (let i = 0; i < roots.length; i += 1) for (const h of roots[i].querySelectorAll('*')) if (h.shadowRoot) roots.push(h.shadowRoot);
      return roots;
    }
    const href = deepRoots()
      .flatMap((r) => Array.from(r.querySelectorAll('[role="alert"] a[href*="/feed/update/"], .artdeco-toast-item a[href*="/feed/update/"]')))
      .map((a) => a.href)[0];
    if (!href) return null;
    const match = decodeURIComponent(href).match(/urn:li:share:\d+/);
    return match ? match[0] : null;
  })()`);
  if (shareUrn) break;
}
console.log('B. posted share urn:', shareUrn);

await setPhase('after-post');
await sleep(4000);
const formatterReappeared = await evaluate(`Boolean(document.querySelector('#linkedin-post-formatter-extension-root .lipf-panel'))`);
console.log('B. formatter reappeared:', formatterReappeared);

// ---- verify + delete the published post ----
// Authoritative cleanup: scan the member share feed for the marker and delete
// whatever share carries it. Works even if the toast link was missed, so a
// real post can never be left behind.
const FEED_SCAN = String.raw`(async () => {
  const jsession = document.cookie.split('; ').find((cookie) => cookie.startsWith('JSESSIONID='));
  const csrf = jsession ? jsession.split('=')[1].replace(/"/g, '') : null;
  const headers = { 'csrf-token': csrf, 'accept': 'application/vnd.linkedin.normalized+json+2.1', 'x-restli-protocol-version': '2.0.0' };
  const me = await (await fetch('https://www.linkedin.com/voyager/api/me', { credentials: 'include', headers })).json();
  const profileUrn = (me.included || []).map((x) => x.entityUrn).find((u) => u && u.includes(':fs_miniProfile:'));
  const profileId = profileUrn ? profileUrn.split(':').pop() : null;
  const url = 'https://www.linkedin.com/voyager/api/identity/profileUpdatesV2?count=10&moduleKey=member-shares%3Aphone&numComments=0&numLikes=0&profileUrn=urn%3Ali%3Afsd_profile%3A' + profileId + '&q=memberShareFeed';
  const feed = await (await fetch(url, { credentials: 'include', headers })).json();
  const urns = new Set();
  for (const inc of feed.included || []) {
    const json = JSON.stringify(inc);
    if (json.includes(window.__lipfMarker)) {
      const match = json.match(/urn:li:share:\d+/);
      if (match) urns.add(match[0]);
    }
  }
  return { csrf, found: [...urns] };
}`;

await keepActive();
const cleanup = await evaluate(`(async () => {
  const scan = await ${FEED_SCAN})();
  const deletions = [];
  for (const urn of scan.found) {
    const del = await fetch('https://www.linkedin.com/voyager/api/contentcreation/normShares/' + encodeURIComponent(urn), {
      method: 'DELETE', credentials: 'include',
      headers: { 'csrf-token': scan.csrf, 'x-restli-protocol-version': '2.0.0' },
    });
    deletions.push({ urn, status: del.status });
  }
  return { found: scan.found, deletions };
})()`);

const postVerified = cleanup.found.length > 0;
const deleteStatus = cleanup.deletions.length > 0 && cleanup.deletions.every((d) => d.status === 204) ? 204 : null;

// Confirm the marker is gone from the share feed after deletion.
await sleep(1500);
await keepActive();
const confirmedGone = postVerified
  ? await evaluate(`(async () => { const scan = await ${FEED_SCAN})(); return scan.found.length === 0; })()`)
  : false;

console.log('B. post found in share feed:', cleanup.found, '| deletions:', JSON.stringify(cleanup.deletions), '| confirmed gone:', confirmedGone);

const samples = await evaluate(`JSON.stringify(window.__lipfSampler)`);
const sampler = JSON.parse(samples);

if (originalDraft === null) {
  await evaluate(`localStorage.removeItem('linkedin-format:draft-v1'); true`);
} else {
  await evaluate(`localStorage.setItem('linkedin-format:draft-v1', ${JSON.stringify(originalDraft)}); true`);
}

console.log('=== NATIVE COMPOSER VISIBILITY (visible frames / total frames per phase) ===');
for (const phase of Object.keys(sampler.totalFrames)) {
  const visible = sampler.visibleFrames[phase] ?? 0;
  console.log(`  ${phase}: ${visible} / ${sampler.totalFrames[phase]}`);
}
console.log('=== [LIPF] LOGS ===');
console.log(logs.join('\n'));

const visibleDuringOpen = sampler.visibleFrames.open ?? 0;
const visibleDuringDismiss = sampler.visibleFrames.dismiss ?? 0;
const visibleDuringReopen = sampler.visibleFrames.reopen ?? 0;
const visibleDuringPost = sampler.visibleFrames.post ?? 0;
const neverVisible = visibleDuringOpen + visibleDuringDismiss + visibleDuringReopen + visibleDuringPost === 0;

const checks = {
  'formatter opened on Start a post': formatterOpen,
  'native composer never visible during open/dismiss/post': neverVisible,
  'dismiss removed native composer': afterDismiss.nativeComposerPresent === false,
  'formatter closed after dismiss': afterDismiss.formatterOpen === false,
  'post published': Boolean(shareUrn) || postVerified,
  'formatter did not reappear after post': formatterReappeared === false,
  'published post verified + deleted': postVerified && deleteStatus === 204 && confirmedGone,
};

console.log('=== CHECKS ===');
let passed = true;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  passed = passed && ok;
}

console.log(passed ? 'VALIDATION PASSED' : 'VALIDATION FAILED');
socket.close();
process.exit(passed ? 0 : 1);
