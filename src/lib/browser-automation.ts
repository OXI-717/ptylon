import { execFile, spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

type PendingCall = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

type BrowserPage = {
  targetId: string;
  sessionId: string;
};

export type BrowserSnapshot = {
  sessionId: string;
  url: string;
  title: string;
  text: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  inputs: Array<{ selector: string; label: string; type: string }>;
  buttons: Array<{ selector: string; text: string }>;
  consoleErrors: string[];
  updatedAt: number;
};

export type BrowserFrame = {
  sessionId: string;
  url: string;
  title: string;
  width: number;
  height: number;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  screenshot: {
    mimeType: 'image/png' | 'image/jpeg';
    data: string;
  };
  consoleErrors: string[];
  updatedAt: number;
};

type BrowserSession = {
  id: string;
  cdp: Cdp;
  chrome: ReturnType<typeof spawn>;
  page: BrowserPage;
  profile: string;
  crashpadPids: number[];
  consoleErrors: string[];
  loading: boolean;
  createdAt: number;
  updatedAt: number;
};

const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SESSION_TTL_MS = Number(process.env.WEB_CONSOLE_BROWSER_SESSION_TTL_MS || 10 * 60 * 1000);
const sessions = new Map<string, BrowserSession>();
let shutdownHooksInstalled = false;
let shuttingDown = false;
const KEY_CODES: Record<string, { key: string; code: string; windowsVirtualKeyCode: number }> = {
  '\n': { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  '\r': { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  '\b': { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  '\t': { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForChromeExit(session: BrowserSession, timeoutMs: number) {
  if (session.chrome.exitCode !== null || session.chrome.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      session.chrome.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }
    session.chrome.once('exit', onExit);
  });
}

function signalChromeTree(session: BrowserSession, signal: NodeJS.Signals) {
  if (session.chrome.pid) {
    try {
      process.kill(-session.chrome.pid, signal);
      return;
    } catch {}
  }
  session.chrome.kill(signal);
}

function listCrashpadPids() {
  return new Promise<number[]>((resolve) => {
    execFile('pgrep', ['-f', '/opt/google/chrome/chrome_crashpad_handler'], (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(stdout.split(/\s+/).map((pid) => Number(pid)).filter(Number.isFinite));
    });
  });
}

function signalTrackedPids(pids: number[], signal: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function redactText(value: string) {
  return value
    .replace(/(bearer\s+)[a-z0-9._~+/=-]{12,}/gi, '$1[redacted]')
    .replace(/((?:token|secret|password|passwd|apikey|api_key|authorization)=)[^&\s]{4,}/gi, '$1[redacted]')
    .replace(/\b(sk-[a-z0-9_-]{12,})\b/gi, '[redacted-openai-key]')
    .replace(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi, '[redacted-email]');
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactValue(entry)]));
  }
  return value;
}

function selectorFor(element: Element) {
  const id = element.getAttribute('id');
  if (id) return `#${CSS.escape(id)}`;
  const name = element.getAttribute('name');
  const tag = element.tagName.toLowerCase();
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;
  const aria = element.getAttribute('aria-label');
  if (aria) return `${tag}[aria-label="${CSS.escape(aria)}"]`;
  return tag;
}

class Cdp {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private listeners = new Set<(message: Record<string, unknown>) => void>();

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (isRecord(message.error)) {
          pending.reject(new Error(`${String(message.error.message || 'CDP error')}: ${JSON.stringify(message.error.data || '')}`));
        } else {
          pending.resolve(isRecord(message.result) ? message.result : {});
        }
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('Chrome CDP websocket failed')), { once: true });
    });
  }

  onEvent(listener: (message: Record<string, unknown>) => void) {
    this.listeners.add(listener);
  }

  call(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const id = this.nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  close() {
    this.ws.close();
  }
}

async function startChrome(id: string) {
  const profile = path.join(tmpdir(), `web-console-browser-${id}`);
  await mkdir(profile, { recursive: true });
  const port = 9400 + Math.floor(Math.random() * 1000);
  const existingCrashpadPids = new Set(await listCrashpadPids());
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-crash-reporter',
    '--disable-crashpad',
    '--disable-breakpad',
    '--disable-dev-shm-usage',
    '--window-size=1440,950',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  chrome.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  chrome.once('exit', () => {
    const session = sessions.get(id);
    if (session?.chrome === chrome) sessions.delete(id);
  });

  let wsUrl = '';
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const data = await res.json() as { webSocketDebuggerUrl?: string };
        wsUrl = data.webSocketDebuggerUrl || '';
        if (wsUrl) break;
      }
    } catch {}
    await delay(100);
  }
  if (!wsUrl) {
    if (chrome.pid) {
      try {
        process.kill(-chrome.pid, 'SIGTERM');
      } catch {
        chrome.kill('SIGTERM');
      }
    } else {
      chrome.kill('SIGTERM');
    }
    throw new Error(`Chrome remote debugging did not start: ${stderr.slice(0, 500)}`);
  }

  const cdp = new Cdp(wsUrl);
  await cdp.ready();
  const crashpadPids = (await listCrashpadPids()).filter((pid) => !existingCrashpadPids.has(pid));
  return { chrome, cdp, profile, crashpadPids };
}

async function newPage(cdp: Cdp): Promise<BrowserPage> {
  const target = await cdp.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target.targetId || '');
  const attached = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = String(attached.sessionId || '');
  await cdp.call('Page.enable', {}, sessionId);
  await cdp.call('Runtime.enable', {}, sessionId);
  await cdp.call('Log.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function evaluate(session: BrowserSession, expression: string) {
  const result = await session.cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, session.page.sessionId);
  if (result.exceptionDetails) throw new Error('Browser evaluation failed');
  return (result.result as { value?: unknown } | undefined)?.value;
}

async function currentPageState(session: BrowserSession) {
  const raw = await evaluate(session, `(() => ({ url: location.href, title: document.title || '' }))()`);
  const data = isRecord(raw) ? raw : {};
  return {
    url: typeof data.url === 'string' ? redactText(data.url) : 'about:blank',
    title: typeof data.title === 'string' ? redactText(data.title) : '',
  };
}

async function navigationState(session: BrowserSession) {
  const result = await session.cdp.call('Page.getNavigationHistory', {}, session.page.sessionId).catch((): Record<string, unknown> => ({}));
  const currentIndex = Number(result.currentIndex ?? -1);
  const entries = Array.isArray(result.entries) ? result.entries : [];
  return {
    canGoBack: currentIndex > 0,
    canGoForward: currentIndex >= 0 && currentIndex < entries.length - 1,
    currentIndex,
    entries,
  };
}

async function waitForReady(session: BrowserSession, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(session, `document.readyState === 'complete' || document.readyState === 'interactive'`).catch(() => false);
    if (ready) return;
    await delay(200);
  }
}

function attachErrorCapture(session: BrowserSession) {
  session.cdp.onEvent((message) => {
    if (message.sessionId !== session.page.sessionId) return;
    const method = String(message.method || '');
    const params = isRecord(message.params) ? message.params : {};
    if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
      const args = Array.isArray(params.args) ? params.args : [];
      session.consoleErrors.push(redactText(args.map((arg) => isRecord(arg) ? String(arg.value ?? arg.description ?? '') : '').join(' ')));
    }
    if (method === 'Runtime.exceptionThrown' && isRecord(params.exceptionDetails)) {
      session.consoleErrors.push(redactText(String(params.exceptionDetails.text || params.exceptionDetails.exception || 'Uncaught exception')));
    }
    if (method === 'Log.entryAdded' && isRecord(params.entry) && params.entry.level === 'error') {
      session.consoleErrors.push(redactText(String(params.entry.text || 'Browser log error')));
    }
    if (method === 'Page.frameStartedLoading') {
      session.loading = true;
    }
    if (method === 'Page.frameStoppedLoading' || method === 'Page.loadEventFired') {
      session.loading = false;
    }
    session.consoleErrors = session.consoleErrors.slice(-50);
  });
}

async function navigate(session: BrowserSession, url: string) {
  session.loading = true;
  const result = await session.cdp.call('Page.navigate', { url }, session.page.sessionId);
  if (result.errorText) throw new Error(String(result.errorText));
  await waitForReady(session);
  session.loading = false;
  session.updatedAt = Date.now();
}

export async function openBrowserSession(url: string) {
  installBrowserShutdownHooks();
  cleanupBrowserSessions();
  const id = crypto.randomUUID();
  const { chrome, cdp, profile, crashpadPids } = await startChrome(id);
  const page = await newPage(cdp);
  const session: BrowserSession = {
    id,
    cdp,
    chrome,
    page,
    profile,
    crashpadPids,
    consoleErrors: [],
    loading: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  attachErrorCapture(session);
  sessions.set(id, session);
  await navigate(session, url);
  return session;
}

export function listBrowserSessions() {
  cleanupBrowserSessions();
  return Array.from(sessions.values()).map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    consoleErrors: session.consoleErrors.slice(-10),
  }));
}

export async function closeBrowserSession(id: string) {
  const session = sessions.get(id);
  if (!session) return false;
  sessions.delete(id);
  try {
    session.cdp.close();
  } catch {}
  if (session.chrome.exitCode === null && session.chrome.signalCode === null) {
    signalChromeTree(session, 'SIGTERM');
    signalTrackedPids(session.crashpadPids, 'SIGTERM');
    const exited = await waitForChromeExit(session, 1500);
    if (!exited) {
      signalChromeTree(session, 'SIGKILL');
    }
    signalTrackedPids(session.crashpadPids, 'SIGKILL');
    await waitForChromeExit(session, 1000);
  } else {
    signalTrackedPids(session.crashpadPids, 'SIGTERM');
    signalTrackedPids(session.crashpadPids, 'SIGKILL');
  }
  await rm(session.profile, { recursive: true, force: true }).catch(() => {});
  return true;
}

export async function closeAllBrowserSessions() {
  const ids = Array.from(sessions.keys());
  await Promise.allSettled(ids.map((id) => closeBrowserSession(id)));
}

function installBrowserShutdownHooks() {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    void closeAllBrowserSessions().finally(() => {
      process.kill(process.pid, signal);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('beforeExit', () => {
    void closeAllBrowserSessions();
  });
}

export function getBrowserSession(id: string) {
  cleanupBrowserSessions();
  const session = sessions.get(id);
  if (!session) throw new Error(`Browser session not found: ${id}`);
  session.updatedAt = Date.now();
  return session;
}

export async function openOrNavigateBrowserSession(options: { sessionId?: string; url?: string }) {
  if (options.sessionId) {
    const session = getBrowserSession(options.sessionId);
    if (options.url) await navigate(session, options.url);
    return session;
  }
  if (!options.url) throw new Error('url or sessionId is required');
  return openBrowserSession(options.url);
}

export async function snapshotBrowser(session: BrowserSession): Promise<BrowserSnapshot> {
  const raw = await evaluate(session, `(() => {
    const selectorFor = ${selectorFor.toString()};
    const text = document.body?.innerText || '';
    return {
      url: location.href,
      title: document.title || '',
      text: text.slice(0, 12000),
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 30).map((el) => el.textContent?.trim() || '').filter(Boolean),
      links: Array.from(document.querySelectorAll('a[href]')).slice(0, 80).map((el) => ({ text: (el.textContent || '').trim().slice(0, 120), href: el.href })),
      inputs: Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"]')).slice(0, 80).map((el) => ({
        selector: selectorFor(el),
        label: el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '',
        type: el.getAttribute('type') || el.tagName.toLowerCase()
      })),
      buttons: Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"]')).slice(0, 80).map((el) => ({
        selector: selectorFor(el),
        text: (el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || '').trim().slice(0, 120)
      }))
    };
  })()`);
  const data = redactValue(raw) as Omit<BrowserSnapshot, 'sessionId' | 'consoleErrors' | 'updatedAt'>;
  return {
    sessionId: session.id,
    url: data.url,
    title: data.title,
    text: data.text,
    headings: data.headings,
    links: data.links,
    inputs: data.inputs,
    buttons: data.buttons,
    consoleErrors: session.consoleErrors.slice(-20),
    updatedAt: session.updatedAt,
  };
}

function clampViewport(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export async function frameBrowser(session: BrowserSession, options: { width?: unknown; height?: unknown; format?: unknown; quality?: unknown } = {}): Promise<BrowserFrame> {
  const width = clampViewport(options.width, 1280, 320, 2400);
  const height = clampViewport(options.height, 800, 240, 1800);
  const format = options.format === 'png' ? 'png' : 'jpeg';
  const quality = clampViewport(options.quality, 72, 30, 95);
  await session.cdp.call('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  }, session.page.sessionId);
  const result = await session.cdp.call('Page.captureScreenshot', {
    format,
    quality,
    captureBeyondViewport: false,
  }, session.page.sessionId);
  const state = await currentPageState(session);
  const history = await navigationState(session);
  session.updatedAt = Date.now();
  return {
    sessionId: session.id,
    url: state.url,
    title: state.title,
    width,
    height,
    canGoBack: history.canGoBack,
    canGoForward: history.canGoForward,
    loading: session.loading,
    screenshot: {
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      data: String(result.data || ''),
    },
    consoleErrors: session.consoleErrors.slice(-20),
    updatedAt: session.updatedAt,
  };
}

export async function reloadBrowser(session: BrowserSession) {
  session.loading = true;
  await session.cdp.call('Page.reload', { ignoreCache: false }, session.page.sessionId);
  await waitForReady(session);
  session.loading = false;
  session.updatedAt = Date.now();
}

export async function navigateBrowserHistory(session: BrowserSession, direction: 'back' | 'forward') {
  const history = await navigationState(session);
  const targetIndex = direction === 'back' ? history.currentIndex - 1 : history.currentIndex + 1;
  const target = history.entries[targetIndex];
  if (!isRecord(target) || target.id === undefined) return false;
  session.loading = true;
  await session.cdp.call('Page.navigateToHistoryEntry', { entryId: target.id }, session.page.sessionId);
  await waitForReady(session);
  session.loading = false;
  session.updatedAt = Date.now();
  return true;
}

export async function clickBrowser(session: BrowserSession, selector: string) {
  const clicked = await evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`selector not found: ${selector}`);
  await delay(300);
  session.updatedAt = Date.now();
}

export async function clickBrowserPoint(session: BrowserSession, x: unknown, y: unknown) {
  const pointX = clampViewport(x, 0, 0, 2400);
  const pointY = clampViewport(y, 0, 0, 1800);
  await session.cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pointX, y: pointY }, session.page.sessionId);
  await session.cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: pointX, y: pointY, button: 'left', clickCount: 1 }, session.page.sessionId);
  await session.cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pointX, y: pointY, button: 'left', clickCount: 1 }, session.page.sessionId);
  await delay(250);
  session.updatedAt = Date.now();
}

export async function fillBrowser(session: BrowserSession, selector: string, text: string) {
  const filled = await evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus();
    if ('value' in el) {
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    el.textContent = ${JSON.stringify(text)};
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(text)} }));
    return true;
  })()`);
  if (!filled) throw new Error(`selector not found: ${selector}`);
  await delay(200);
  session.updatedAt = Date.now();
}

export async function typeBrowserText(session: BrowserSession, text: string) {
  if (!text) return;
  if (KEY_CODES[text]) {
    const key = KEY_CODES[text];
    await session.cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...key }, session.page.sessionId);
    await session.cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...key }, session.page.sessionId);
  } else {
    await session.cdp.call('Input.insertText', { text }, session.page.sessionId);
  }
  await delay(100);
  session.updatedAt = Date.now();
}

export async function scrollBrowser(session: BrowserSession, x: unknown, y: unknown, deltaX: unknown, deltaY: unknown) {
  await session.cdp.call('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: clampViewport(x, 0, 0, 2400),
    y: clampViewport(y, 0, 0, 1800),
    deltaX: Number.isFinite(Number(deltaX)) ? Number(deltaX) : 0,
    deltaY: Number.isFinite(Number(deltaY)) ? Number(deltaY) : 0,
  }, session.page.sessionId);
  await delay(100);
  session.updatedAt = Date.now();
}

export async function evalBrowser(session: BrowserSession, expression: string) {
  const value = await evaluate(session, expression);
  session.updatedAt = Date.now();
  return redactValue(value);
}

export async function screenshotBrowser(session: BrowserSession, allowUnsafeScreenshot = false) {
  if (!allowUnsafeScreenshot) {
    return {
      redacted: true,
      message: 'Screenshot bytes are disabled by default. Pass allowUnsafeScreenshot=true for explicit local capture.',
    };
  }
  const result = await session.cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session.page.sessionId);
  session.updatedAt = Date.now();
  return {
    redacted: false,
    mimeType: 'image/png',
    data: String(result.data || ''),
  };
}

export function cleanupBrowserSessions() {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      void closeBrowserSession(session.id);
    }
  }
}
