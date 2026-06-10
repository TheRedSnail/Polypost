// Deletes a share by URN via the Voyager API from the LinkedIn page context.
// Usage: node scripts/cdp-delete-share.mjs urn:li:share:123 [--inspect]
const urn = process.argv[2];

if (!urn || !/^urn:li:(share|ugcPost|activity):\d+$/.test(urn)) {
  console.error('Usage: node scripts/cdp-delete-share.mjs urn:li:share:<id>');
  process.exit(1);
}

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

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

await call('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

const shareId = urn.split(':').pop();
const outcome = await evaluate(String.raw`(async () => {
  const page = await fetch('https://www.linkedin.com/feed/update/urn:li:share:${shareId}/', { credentials: 'include' });
  const html = await page.text();
  const textMatch = html.match(/LIPF[^<"\\]{0,120}/g);
  const jsession = document.cookie.split('; ').find((cookie) => cookie.startsWith('JSESSIONID='));
  const csrf = jsession ? jsession.split('=')[1].replace(/"/g, '') : null;
  const del = await fetch('https://www.linkedin.com/voyager/api/contentcreation/normShares/' + encodeURIComponent('urn:li:share:${shareId}'), {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' },
  });
  const after = await fetch('https://www.linkedin.com/feed/update/urn:li:share:${shareId}/', { credentials: 'include' });
  const afterHtml = await after.text();
  return {
    pageStatus: page.status,
    markerSnippets: (textMatch ?? []).slice(0, 5),
    deleteStatus: del.status,
    permalinkStatusAfter: after.status,
    stillHasLipf: afterHtml.includes('LIPF'),
  };
})()`);

console.log(JSON.stringify(outcome, null, 2));
socket.close();
process.exit(outcome.deleteStatus === 204 ? 0 : 1);
