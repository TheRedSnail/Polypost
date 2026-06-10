// Dismisses any open native share composer (and its discard confirmation) in
// the debug browser. Used to clean up after probes.
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

await call('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

const CLICK_FN = String.raw`
function lipfClick(labels) {
  const roots = [document];
  for (let index = 0; index < roots.length; index += 1) {
    for (const host of roots[index].querySelectorAll('*')) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
    }
  }
  const controls = roots.flatMap((root) => Array.from(root.querySelectorAll('button, [role="button"]')))
    .filter((control) => !control.closest('#linkedin-post-formatter-extension-root'));
  const control = controls.find((candidate) => {
    const label = ((candidate.getAttribute('aria-label') ?? '') + ' ' + (candidate.textContent ?? '')).trim().toLowerCase();
    return labels.some((wanted) => label === wanted || label.startsWith(wanted));
  });
  control?.click();
  return Boolean(control);
}
`;

for (let attempt = 0; attempt < 6; attempt += 1) {
  const dismissed = await evaluate(`(() => { ${CLICK_FN} return lipfClick(['dismiss', 'close']); })()`);
  await sleep(800);
  const discarded = await evaluate(`(() => { ${CLICK_FN} return lipfClick(['discard']); })()`);
  await sleep(800);
  const remaining = await evaluate(String.raw`(() => {
    const roots = [document];
    for (let index = 0; index < roots.length; index += 1) {
      for (const host of roots[index].querySelectorAll('*')) {
        if (host.shadowRoot) roots.push(host.shadowRoot);
      }
    }
    return roots.flatMap((root) => Array.from(root.querySelectorAll('[role="dialog"]')))
      .filter((dialog) => !dialog.closest('#linkedin-post-formatter-extension-root') && !String(dialog.className).includes('vjs-'))
      .filter((dialog) => { const rect = dialog.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })
      .length;
  })()`);
  console.log(`pass ${attempt + 1}: dismissed=${dismissed} discarded=${discarded} dialogsRemaining=${remaining}`);

  if (remaining === 0) {
    break;
  }
}

socket.close();
process.exit(0);
