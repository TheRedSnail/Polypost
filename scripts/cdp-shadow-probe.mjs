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

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const WALKER = String.raw`
  function walkAll(root, results) {
    const elements = root.querySelectorAll('*');
    for (const element of elements) {
      if (element.shadowRoot) {
        results.shadowHosts.push({
          tag: element.tagName.toLowerCase(),
          id: element.id,
          cls: String(element.className).slice(0, 80),
        });
        walkAll(element.shadowRoot, results);
      }
      if (element.getAttribute && element.getAttribute('contenteditable') === 'true' && !element.closest('#linkedin-post-formatter-extension-root')) {
        const rect = element.getBoundingClientRect();
        results.editables.push({
          inShadow: root !== document,
          tag: element.tagName.toLowerCase(),
          ql: element.classList.contains('ql-editor'),
          aria: element.getAttribute('aria-label'),
          placeholder: element.getAttribute('data-placeholder'),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
      if (element.getAttribute && element.getAttribute('role') === 'dialog' && !element.closest('#linkedin-post-formatter-extension-root')) {
        const rect = element.getBoundingClientRect();
        results.dialogs.push({
          inShadow: root !== document,
          aria: element.getAttribute('aria-label'),
          cls: String(element.className).slice(0, 80),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          text: (element.textContent ?? '').replace(/\s+/g, ' ').slice(0, 80),
        });
      }
    }
  }
`;

async function dumpAll(label) {
  const result = await call('Runtime.evaluate', {
    expression: String.raw`(() => {
      ${WALKER}
      const results = { shadowHosts: [], editables: [], dialogs: [] };
      walkAll(document, results);
      return { url: location.href, ...results };
    })()`,
    returnByValue: true,
  });
  console.log(`=== ${label} ===`);
  console.log(JSON.stringify(result.result.value, null, 2));
}

await dumpAll('BEFORE CLICK');

const clicked = await call('Runtime.evaluate', {
  expression: String.raw`(() => {
    const control = Array.from(document.querySelectorAll('button, [role="button"]')).find((element) => {
      const label = ((element.textContent ?? '') + ' ' + (element.getAttribute('aria-label') ?? '')).toLowerCase();
      return label.includes('start a post');
    });
    if (!control) return false;
    const rect = control.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`,
  returnByValue: true,
});

console.log('start-post control coords:', JSON.stringify(clicked.result.value));

if (clicked.result.value) {
  const { x, y } = clicked.result.value;
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 3500));
  await dumpAll('AFTER REAL CLICK (3.5s)');
}

socket.close();
