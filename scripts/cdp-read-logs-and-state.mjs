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
      logs.push({ ts: data.params.timestamp, text: text.slice(0, 500) });
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

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

await call('Runtime.enable');
await new Promise((resolve) => setTimeout(resolve, 2000));

const state = await call('Runtime.evaluate', {
  expression: String.raw`(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).map((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return {
        inExtension: Boolean(dialog.closest('#linkedin-post-formatter-extension-root')),
        hidden: dialog.classList.contains('lipf-native-composer-hidden'),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        aria: dialog.getAttribute('aria-label'),
        cls: String(dialog.className).slice(0, 100),
        text: (dialog.textContent ?? '').replace(/\s+/g, ' ').slice(0, 80),
      };
    });
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).map((editor) => {
      const rect = editor.getBoundingClientRect();
      return {
        inExtension: Boolean(editor.closest('#linkedin-post-formatter-extension-root')),
        ql: editor.classList.contains('ql-editor'),
        aria: editor.getAttribute('aria-label'),
        placeholder: editor.getAttribute('data-placeholder'),
        inDialog: Boolean(editor.closest('[role="dialog"]')),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        text: (editor.textContent ?? '').slice(0, 60),
      };
    });
    const formatterRoot = document.querySelector('#linkedin-post-formatter-extension-root');
    return {
      url: location.href,
      formatterMounted: Boolean(formatterRoot),
      formatterOpen: Boolean(formatterRoot?.querySelector('.lipf-panel')),
      dialogs,
      editables,
    };
  })()`,
  returnByValue: true,
});

console.log('=== CURRENT DOM STATE ===');
console.log(JSON.stringify(state.result.value, null, 2));
console.log('=== BUFFERED [LIPF] LOGS ===');
logs.forEach((entry) => console.log(new Date(entry.ts).toISOString(), entry.text));
socket.close();
