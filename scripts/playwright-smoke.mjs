import { readFile } from 'fs/promises';
import { chromium } from 'playwright';

const BASE_URL = process.env.WC_BASE_URL || 'http://127.0.0.1:8790';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function envValue(name) {
  if (process.env[name]) return process.env[name];
  const text = await readFile('.env', 'utf8');
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  assert(line, `missing ${name}; set it in .env or as an environment variable`);
  return line.slice(name.length + 1).replace(/^['"]|['"]$/g, '');
}

async function main() {
  const password = await envValue('AUTH_PASSWORD');
  const username = process.env.WC_BASIC_USER;
  const basicPassword = process.env.WC_BASIC_PASS;
  assert(Boolean(username) === Boolean(basicPassword), 'set both WC_BASIC_USER and WC_BASIC_PASS for proxy basic auth');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(username ? { httpCredentials: { username, password: basicPassword } } : {});
  const page = await context.newPage();
  const sockets = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));

  try {
    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    assert(response?.ok(), `GET ${BASE_URL} returned ${response?.status()}`);
    const authenticated = await page.evaluate(async (value) => {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: value }),
      });
      return response.ok;
    }, password);
    assert(authenticated, 'application authentication failed');

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /\bconnected\b/i.test(document.body.innerText), undefined, { timeout: 20_000 });
    assert(sockets.length > 0, 'browser did not attach a WebSocket');
    console.log(JSON.stringify({ baseUrl: BASE_URL, appLogin: true, connected: true, websocketAttach: true }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
