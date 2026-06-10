// Probes LinkedIn's media attach flow without posting: opens the composer,
// dumps dialog/button/file-input state, attaches a generated image directly to
// LinkedIn's media input, dumps again (to capture the media editor), then
// closes everything and discards the draft.
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.includes('linkedin.com'));

if (!target) {
  console.error('No LinkedIn page target found.');
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;

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
await call('Page.navigate', { url: 'https://www.linkedin.com/feed/' });
await sleep(5000);
await call('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

// Deep DOM dump helper injected into the page (pierces shadow roots).
const DUMP_FN = String.raw`
function lipfDump() {
  const roots = [document];
  for (let index = 0; index < roots.length; index += 1) {
    for (const host of roots[index].querySelectorAll('*')) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
    }
  }
  const all = (selector) => roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
  const dialogs = all('[role="dialog"]').filter((d) => !d.closest('#linkedin-post-formatter-extension-root')).map((dialog) => ({
    aria: dialog.getAttribute('aria-label'),
    cls: String(dialog.className).slice(0, 100),
    text: (dialog.textContent ?? '').replace(/\s+/g, ' ').slice(0, 100),
    buttons: Array.from(new Set(all('button, [role="button"]').filter((b) => dialog.contains(b)).map((button) => {
      const label = ((button.getAttribute('aria-label') ?? '') + '|' + (button.textContent ?? '').replace(/\s+/g, ' ').trim()).slice(0, 60);
      return label + (button.disabled || button.getAttribute('aria-disabled') === 'true' ? ' [disabled]' : '');
    }))),
  }));
  const inputs = all('input[type="file"]').filter((i) => !i.closest('#linkedin-post-formatter-extension-root')).map((input) => ({
    accept: input.getAttribute('accept'),
    id: input.id,
    cls: String(input.className).slice(0, 80),
    inDialog: Boolean(input.closest('[role="dialog"]')),
  }));
  return { dialogs, inputs };
}
`;

// Step 1: open the composer via Start a post (formatter takes over and hides it).
await evaluate(String.raw`(() => {
  const control = Array.from(document.querySelectorAll('button, [role="button"]')).find((element) => {
    const label = ((element.textContent ?? '') + ' ' + (element.getAttribute('aria-label') ?? '')).toLowerCase();
    return label.includes('start a post');
  });
  control?.click();
  return Boolean(control);
})()`);
await sleep(4000);

console.log('=== AFTER OPEN ===');
console.log(JSON.stringify(await evaluate(`(() => { ${DUMP_FN} return lipfDump(); })()`), null, 2));

// Step 2: attach a generated image directly to LinkedIn's media file input.
const attach = await evaluate(String.raw`(async () => {
  ${DUMP_FN}
  const roots = [document];
  for (let index = 0; index < roots.length; index += 1) {
    for (const host of roots[index].querySelectorAll('*')) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
    }
  }
  const inputs = roots.flatMap((root) => Array.from(root.querySelectorAll('input[type="file"]')))
    .filter((input) => !input.closest('#linkedin-post-formatter-extension-root'));
  if (inputs.length === 0) return { ok: false, reason: 'no file input' };
  const input = inputs.find((candidate) => (candidate.getAttribute('accept') ?? '').includes('image')) ?? inputs[0];
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  context.fillStyle = '#0a66c2';
  context.fillRect(0, 0, 640, 360);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], 'lipf-probe.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, accept: input.getAttribute('accept'), id: input.id, cls: String(input.className).slice(0, 80) };
})()`);
console.log('attach:', JSON.stringify(attach));

// Step 3: dump state over time to watch the media editor appear.
for (const delay of [1500, 3000, 6000]) {
  await sleep(delay);
  console.log(`=== AFTER ATTACH +${delay} ===`);
  console.log(JSON.stringify(await evaluate(`(() => { ${DUMP_FN} return lipfDump(); })()`), null, 2));
}

// Step 4: close the formatter (which also dismisses the native composer + discard).
await evaluate(String.raw`(() => {
  document.querySelector('#linkedin-post-formatter-extension-root .lipf-icon-button[aria-label="Close formatter"]')?.click();
  return true;
})()`);
await sleep(4000);
const remaining = await evaluate(`(() => { ${DUMP_FN} return lipfDump().dialogs.length; })()`);
console.log('dialogs remaining after close:', remaining);

socket.close();
process.exit(0);
