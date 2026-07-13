import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const basePort = 19000 + Math.floor(Math.random() * 1000);
const ptyPort = basePort;
const wsPort = basePort + 1;
const secret = 'smoke-test-secret';
const token = jwt.sign({ sub: 'smoke-test' }, secret, { expiresIn: '5m' });
const children = new Set();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startProcess(name, args, env, readyPattern) {
  const child = spawn(process.execPath, args, {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);

  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${name} did not become ready. Output:\n${output}`));
    }, 5000);

    const onData = (chunk) => {
      output += chunk.toString();
      if (readyPattern.test(output)) {
        clearTimeout(timer);
        resolve(child);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`${name} exited early code=${code} signal=${signal}. Output:\n${output}`));
    });
  });

  child.output = () => output;
  return ready;
}

async function stopProcess(child) {
  if (!child || child.killed) return;
  child.kill('SIGINT');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    wait(3000).then(() => child.kill('SIGKILL')),
  ]);
  children.delete(child);
}

function connectBrowser() {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
    headers: { Cookie: `wc-token=${encodeURIComponent(token)}` },
  });
  const messages = [];
  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('browser websocket open timeout')), 5000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve({ ws, messages });
    });
    ws.on('error', reject);
  });
}

function expectQueryTokenRejected() {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${encodeURIComponent(token)}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('query-token websocket did not close')), 5000);
    ws.on('open', () => {});
    ws.on('close', (code) => {
      clearTimeout(timer);
      assert(code === 4001, `expected query-token rejection code 4001, got ${code}`);
      resolve();
    });
    ws.on('error', () => {});
  });
}

async function waitFor(messages, predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = messages.find(predicate);
    if (found) return found;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}. Messages:\n${JSON.stringify(messages, null, 2)}`);
}

async function run() {
  const daemonEnv = {
    PTY_DAEMON_HOST: '127.0.0.1',
    PTY_DAEMON_PORT: String(ptyPort),
  };
  const gatewayEnv = {
    JWT_SECRET: secret,
    WS_PORT: String(wsPort),
    PTY_DAEMON_URL: `ws://127.0.0.1:${ptyPort}`,
  };

  const daemon = await startProcess('pty daemon', ['server/pty-daemon.mjs'], daemonEnv, /PTY daemon listening/);
  let gateway = await startProcess('ws gateway', ['server/ws-server.mjs'], gatewayEnv, /WebSocket gateway listening/);

  await expectQueryTokenRejected();

  const first = await connectBrowser();
  first.ws.send(JSON.stringify({ type: 'create', cols: 80, rows: 24, _cid: 'smoke-create' }));
  const created = await waitFor(first.messages, (m) => m.type === 'created' && m._cid === 'smoke-create', 'created');
  const sessionId = created.sessionId;
  await waitFor(first.messages, (m) => m.type === 'attached' && m.sessionId === sessionId, 'attached after create');

  first.ws.send(JSON.stringify({ type: 'metadata', _cid: 'smoke-metadata-initial' }));
  const initialMetadata = await waitFor(first.messages, (m) => m.type === 'metadata' && m._cid === 'smoke-metadata-initial', 'initial metadata');
  const initialEntry = initialMetadata.data?.find((entry) => entry.sessionId === sessionId);
  assert(initialEntry?.cwd === PROJECT_ROOT, `expected initial cwd ${PROJECT_ROOT}, got ${JSON.stringify(initialEntry)}`);
  if (existsSync(join(PROJECT_ROOT, '.git'))) {
    assert(initialEntry?.git?.branch, `expected git branch metadata, got ${JSON.stringify(initialEntry)}`);
  }

  first.ws.send(JSON.stringify({ type: 'input', sessionId, data: 'printf "SMOKE_DAEMON_SURVIVAL\\n"\r' }));
  await waitFor(first.messages, (m) => m.type === 'output' && String(m.data).includes('SMOKE_DAEMON_SURVIVAL'), 'first marker output');
  first.ws.send(JSON.stringify({ type: 'input', sessionId, data: 'cd /tmp\r' }));
  await wait(300);
  first.ws.send(JSON.stringify({ type: 'metadata', _cid: 'smoke-metadata-tmp' }));
  const tmpMetadata = await waitFor(first.messages, (m) => m.type === 'metadata' && m._cid === 'smoke-metadata-tmp', 'metadata after cd /tmp');
  const tmpEntry = tmpMetadata.data?.find((entry) => entry.sessionId === sessionId);
  assert(tmpEntry?.cwd === '/tmp', `expected cwd /tmp after cd, got ${JSON.stringify(tmpEntry)}`);
  first.ws.close();

  await stopProcess(gateway);
  gateway = await startProcess('ws gateway restart', ['server/ws-server.mjs'], gatewayEnv, /WebSocket gateway listening/);

  const second = await connectBrowser();
  second.ws.send(JSON.stringify({ type: 'attach', sessionId, cols: 80, rows: 24, _cid: 'smoke-attach' }));
  await waitFor(second.messages, (m) => m.type === 'attached' && m._cid === 'smoke-attach', 'attached after gateway restart');
  await waitFor(second.messages, (m) => m.type === 'scrollback' && String(m.data).includes('SMOKE_DAEMON_SURVIVAL'), 'scrollback after gateway restart');

  second.ws.send(JSON.stringify({ type: 'input', sessionId, data: 'printf "SMOKE_AFTER_REATTACH\\n"\r' }));
  await waitFor(second.messages, (m) => m.type === 'output' && String(m.data).includes('SMOKE_AFTER_REATTACH'), 'output after reattach');
  second.ws.send(JSON.stringify({ type: 'kill', sessionId }));
  second.ws.close();

  await stopProcess(gateway);
  await stopProcess(daemon);
  console.log(`PTY gateway smoke passed on ports ${ptyPort}/${wsPort}`);
}

run().catch(async (err) => {
  console.error(err);
  for (const child of [...children].reverse()) await stopProcess(child);
  process.exit(1);
});
