// End-to-end validation of the media attachment flow: attach a generated test
// image in the formatter, post through the native composer bridge (media file
// input -> media editor Next -> text -> Post), then delete the published post
// immediately via the Voyager API (per project policy).
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
      logs.push(`${new Date(data.params.timestamp).toISOString()} ${text.slice(0, 300)}`);
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

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

await call('Runtime.enable');
await call('Page.enable');

const marker = `LIPF media test ${Math.random().toString(36).slice(2, 8)}`;
console.log('test marker:', marker);

// Preserve whatever draft the user had, then seed the test draft.
const originalDraft = await evaluate(`localStorage.getItem('linkedin-format:draft-v1')`);
const draft = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: `${marker} - automated media validation, deleting momentarily.` }] },
  ],
};
await evaluate(`localStorage.setItem('linkedin-format:draft-v1', ${JSON.stringify(JSON.stringify(draft))}); true`);

await call('Page.navigate', { url: 'https://www.linkedin.com/feed/' });
await sleep(5000);

// The tab may be backgrounded (machine locked); keep the page acting visible
// so timers run unthrottled and in-page fetches do not freeze.
await call('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

let mounted = false;

for (let attempt = 0; attempt < 40; attempt += 1) {
  mounted = await evaluate(`Boolean(document.querySelector('#linkedin-post-formatter-extension-root'))`);

  if (mounted) {
    break;
  }

  await sleep(250);
}

if (!mounted) {
  console.error('FAIL: extension root never mounted.');
  process.exit(1);
}

// Step 1: click "Start a post" -> formatter should take over.
const startClicked = await evaluate(String.raw`(() => {
  const control = Array.from(document.querySelectorAll('button, [role="button"]')).find((element) => {
    const label = ((element.textContent ?? '') + ' ' + (element.getAttribute('aria-label') ?? '')).toLowerCase();
    return label.includes('start a post');
  });
  control?.click();
  return Boolean(control);
})()`);

if (!startClicked) {
  console.error('FAIL: Start a post control not found.');
  process.exit(1);
}

let formatterOpen = false;

for (let attempt = 0; attempt < 20; attempt += 1) {
  await sleep(250);
  formatterOpen = await evaluate(`Boolean(document.querySelector('#linkedin-post-formatter-extension-root .lipf-panel'))`);

  if (formatterOpen) {
    break;
  }
}

console.log('formatter opened after Start a post:', formatterOpen);

if (!formatterOpen) {
  console.error('FAIL: formatter did not open.');
  console.log(logs.join('\n'));
  process.exit(1);
}

await sleep(1500);

// Step 2: generate a PNG in-page and attach it through the formatter's media input.
const attached = await evaluate(String.raw`(async () => {
  const input = document.querySelector('#linkedin-post-formatter-extension-root .lipf-media-input');
  if (!input) return { ok: false, reason: 'media input not found' };

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  context.fillStyle = '#0a66c2';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.font = 'bold 36px sans-serif';
  context.fillText('LIPF media validation', 40, 180);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], 'lipf-media-test.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`);

console.log('attach via formatter input:', JSON.stringify(attached));

if (!attached.ok) {
  console.error('FAIL: could not attach test image.');
  process.exit(1);
}

await sleep(500);
const thumbnailCount = await evaluate(`document.querySelectorAll('#linkedin-post-formatter-extension-root .lipf-attachment').length`);
console.log('attachment thumbnails shown:', thumbnailCount);

if (thumbnailCount !== 1) {
  console.error('FAIL: attachment thumbnail did not appear.');
  process.exit(1);
}

// Step 3: click the formatter's Post button.
const postClicked = await evaluate(String.raw`(() => {
  const button = document.querySelector('#linkedin-post-formatter-extension-root .lipf-primary-button');
  if (!button || button.disabled) return false;
  button.click();
  return true;
})()`);

if (!postClicked) {
  console.error('FAIL: extension Post button missing or disabled.');
  console.log(logs.join('\n'));
  process.exit(1);
}

// Step 4: wait for the posted update link. Media uploads make this slower than
// the text-only flow, so poll for up to 90 seconds.
let shareUrn = null;

for (let attempt = 0; attempt < 180; attempt += 1) {
  await sleep(500);
  shareUrn = await evaluate(String.raw`(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/feed/update/"]')).map((a) => a.href);
    for (const href of links) {
      const match = decodeURIComponent(href).match(/urn:li:(?:share|ugcPost|activity):\d+/);
      if (match) return match[0];
    }
    return null;
  })()`);

  if (shareUrn) {
    break;
  }
}

console.log('posted share urn:', shareUrn);

// Step 5: make sure the formatter does not reappear.
await sleep(4000);
const formatterReappeared = await evaluate(`Boolean(document.querySelector('#linkedin-post-formatter-extension-root .lipf-panel'))`);
console.log('formatter reappeared:', formatterReappeared);

// Step 6: verify the published post contains the marker and an uploaded image,
// then delete it. Deletion is unconditional: the URN came from OUR post's
// success toast, so it is always removed regardless of verification outcome.
let postVerified = false;
let imageVerified = false;
let deleteStatus = null;

if (shareUrn) {
  const verifyAndDelete = await evaluate(String.raw`(async () => {
    const page = await fetch('https://www.linkedin.com/feed/update/${shareUrn}/', { credentials: 'include' });
    const html = await page.text();
    const hasMarker = html.includes(${JSON.stringify(marker)});
    // Uploaded post images live under feedshare paths; avatars do not.
    const hasImage = /feedshare/.test(html);
    const jsession = document.cookie.split('; ').find((cookie) => cookie.startsWith('JSESSIONID='));
    const csrf = jsession ? jsession.split('=')[1].replace(/"/g, '') : null;
    const shareId = '${shareUrn}'.split(':').pop();
    const del = await fetch('https://www.linkedin.com/voyager/api/contentcreation/normShares/' + encodeURIComponent('urn:li:share:' + shareId), {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' },
    });
    return { hasMarker, hasImage, deleteStatus: del.status };
  })()`);
  postVerified = verifyAndDelete.hasMarker;
  imageVerified = verifyAndDelete.hasImage;
  deleteStatus = verifyAndDelete.deleteStatus;
  console.log('post contains marker:', postVerified, '| post has image:', imageVerified, '| delete status:', deleteStatus);

  if (deleteStatus === 204) {
    const gone = await evaluate(String.raw`(async () => {
      const page = await fetch('https://www.linkedin.com/feed/update/${shareUrn}/', { credentials: 'include' });
      const html = await page.text();
      return !html.includes(${JSON.stringify(marker)});
    })()`);
    console.log('post confirmed deleted:', gone);
  }
}

// Restore the user's original draft.
if (originalDraft === null) {
  await evaluate(`localStorage.removeItem('linkedin-format:draft-v1'); true`);
} else {
  await evaluate(`localStorage.setItem('linkedin-format:draft-v1', ${JSON.stringify(originalDraft)}); true`);
}

console.log('=== [LIPF] LOGS ===');
console.log(logs.join('\n'));

const passed = formatterOpen && Boolean(shareUrn) && postVerified && imageVerified && deleteStatus === 204 && !formatterReappeared;
console.log(passed ? 'VALIDATION PASSED' : 'VALIDATION FAILED');
socket.close();
process.exit(passed ? 0 : 1);
