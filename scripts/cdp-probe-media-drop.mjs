// Probes what LinkedIn's redesigned composer does after a simulated file drop
// (the working attach path) WITHOUT posting: opens the composer, drops a
// generated image, dumps dialog state over time, then closes and discards.
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

const DUMP_FN = String.raw`
function lipfDump() {
  const roots = [document];
  for (let index = 0; index < roots.length; index += 1) {
    for (const host of roots[index].querySelectorAll('*')) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
    }
  }
  const all = (selector) => roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
  const dialogs = all('[role="dialog"]').filter((d) => !d.closest('#linkedin-post-formatter-extension-root') && !String(d.className).includes('vjs-')).map((dialog) => ({
    aria: dialog.getAttribute('aria-label'),
    cls: String(dialog.className).slice(0, 110),
    text: (dialog.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160),
    images: Array.from(new Set(all('img').filter((img) => dialog.contains(img)).map((img) => (img.src || '').slice(0, 60)))),
    buttons: Array.from(new Set(all('button, [role="button"]').filter((b) => dialog.contains(b)).map((button) => {
      const label = ((button.getAttribute('aria-label') ?? '') + '|' + (button.textContent ?? '').replace(/\s+/g, ' ').trim()).slice(0, 60);
      return label + (button.disabled || button.getAttribute('aria-disabled') === 'true' ? ' [disabled]' : '');
    }))),
  }));
  const inputs = all('input[type="file"]').filter((i) => !i.closest('#linkedin-post-formatter-extension-root')).map((input) => ({
    accept: input.getAttribute('accept'),
    id: input.id,
  }));
  return { dialogs, inputs };
}
`;

// Open the composer via Start a post (formatter takes over and hides it).
await evaluate(String.raw`(() => {
  const control = Array.from(document.querySelectorAll('button, [role="button"]')).find((element) => {
    const label = ((element.textContent ?? '') + ' ' + (element.getAttribute('aria-label') ?? '')).toLowerCase();
    return label.includes('start a post');
  });
  control?.click();
  return Boolean(control);
})()`);
await sleep(4000);

// Drop a generated image onto the composer (deep search, same logic the
// extension's fallback uses: composer editable first, else the dialog).
const dropped = await evaluate(String.raw`(async () => {
  const roots = [document];
  for (let index = 0; index < roots.length; index += 1) {
    for (const host of roots[index].querySelectorAll('*')) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
    }
  }
  const all = (selector) => roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
  const editor = all('.ql-editor[contenteditable="true"]').find((e) => !e.closest('#linkedin-post-formatter-extension-root'));
  const dialog = all('.share-box-v2__modal').find((d) => !d.closest('#linkedin-post-formatter-extension-root'));
  const target = editor ?? dialog;
  if (!target) return { ok: false, reason: 'no drop target' };

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
  for (const type of ['dragenter', 'dragover', 'drop']) {
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer }));
  }
  return { ok: true, target: editor ? 'editor' : 'dialog' };
})()`);
console.log('drop:', JSON.stringify(dropped));

for (const delay of [1000, 2000, 3000, 6000]) {
  await sleep(delay);
  console.log(`=== AFTER DROP +${delay} ===`);
  console.log(JSON.stringify(await evaluate(`(() => { ${DUMP_FN} return lipfDump(); })()`), null, 2));
}

// Close the formatter (also dismisses the native composer and discards).
await evaluate(String.raw`(() => {
  document.querySelector('#linkedin-post-formatter-extension-root .lipf-icon-button[aria-label="Close formatter"]')?.click();
  return true;
})()`);
await sleep(5000);
const remaining = await evaluate(`(() => { ${DUMP_FN} return lipfDump(); })()`);
console.log('=== AFTER CLOSE ===');
console.log(JSON.stringify(remaining, null, 2));

socket.close();
process.exit(0);
