#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function readEnvFile(filePath) {
  try {
    const env = {};
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
      const index = line.indexOf('=');
      env[line.slice(0, index)] = line.slice(index + 1).replace(/^['"]|['"]$/g, '');
    }
    return env;
  } catch {
    return {};
  }
}

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const fileEnv = readEnvFile(path.join(repoRoot, '.env'));
const env = { ...fileEnv, ...process.env };
const baseUrl = env.WEBC_URL || `http://127.0.0.1:${env.PORT || '8790'}`;
const token = env.WEB_CONSOLE_ADMIN_TOKEN || env.JWT_SECRET;

function usage() {
  console.log(`webc <command>

Commands:
  ping
  recipes
  workspace list
  workspace create <recipe-id-or-name>
  workspace delete <workspace-id>
  browser panel <url>
  browser panel --local <port>
  browser open <url>
  browser snapshot <url-or-sessionId>
  browser frame <url-or-sessionId> [out.png]
  browser back <sessionId>
  browser forward <sessionId>
  browser reload <sessionId>
  browser click <sessionId> <selector>
  browser point-click <sessionId> <x> <y>
  browser fill <sessionId> <selector> <text>
  browser type <sessionId> <text>
  browser scroll <sessionId> <deltaY> [x] [y]
  browser eval <sessionId> <expression>
  browser screenshot <url-or-sessionId> [out.png]
  browser close <sessionId>
  notify <title> [body]
  send <sessionId> <text>
`);
}

async function request(method, route, body) {
  if (!token) throw new Error('Missing WEB_CONSOLE_ADMIN_TOKEN or JWT_SECRET');
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Web-Console-Admin-Token': token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  if (!res.ok) throw new Error(data.error || data.text || `${res.status} ${res.statusText}`);
  return data;
}

const args = process.argv.slice(2);

function isUrl(value) {
  return /^(https?:|about:|data:|localhost(:|\/|$)|127\.0\.0\.1(:|\/|$))/i.test(value || '');
}

function browserTarget(parts) {
  if (parts[0] === '--local') {
    const port = parts[1] || '3000';
    return `http://127.0.0.1:${port}`;
  }
  return parts.join(' ').trim();
}

async function browserRequest(body) {
  return request('POST', '/api/admin/browser', body);
}

try {
  const [cmd, sub, ...rest] = args;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
  } else if (cmd === 'ping') {
    console.log(JSON.stringify(await request('GET', '/api/admin/ping'), null, 2));
  } else if (cmd === 'recipes') {
    const data = await request('GET', '/api/recipes');
    for (const recipe of data.recipes || []) console.log(`${recipe.id}\t${recipe.name}`);
  } else if (cmd === 'workspace' && sub === 'list') {
    const data = await request('GET', '/api/admin/workspaces');
    for (const workspace of data.workspaces || []) {
      const active = workspace.id === data.activeWorkspaceId ? '*' : ' ';
      console.log(`${active} ${workspace.id}\t${workspace.name}\t${workspace.tabs} tabs`);
    }
  } else if (cmd === 'workspace' && sub === 'create') {
    const recipe = rest.join(' ').trim();
    if (!recipe) throw new Error('recipe is required');
    const data = await request('POST', '/api/admin/workspaces', { recipe });
    console.log(`${data.workspace.id}\t${data.workspace.name}`);
  } else if (cmd === 'workspace' && sub === 'delete') {
    const id = rest.join(' ').trim();
    if (!id) throw new Error('workspace id is required');
    console.log(JSON.stringify(await request('DELETE', `/api/admin/workspaces?id=${encodeURIComponent(id)}`), null, 2));
  } else if (cmd === 'browser' && sub === 'panel') {
    const url = browserTarget(rest);
    if (!url) throw new Error('url is required');
    const data = await browserRequest({ action: 'panelOpen', url });
    console.log(`${data.workspace.id}\t${data.tab.id}\t${data.tab.browserSessionId || ''}\t${data.tab.url}`);
  } else if (cmd === 'browser' && sub === 'open') {
    const url = browserTarget(rest);
    if (!url) throw new Error('url is required');
    console.log(JSON.stringify(await browserRequest({ action: 'open', url }), null, 2));
  } else if (cmd === 'browser' && sub === 'snapshot') {
    const target = rest.join(' ').trim();
    if (!target) throw new Error('url or sessionId is required');
    const body = isUrl(target) ? { action: 'snapshot', url: target } : { action: 'snapshot', sessionId: target };
    console.log(JSON.stringify(await browserRequest(body), null, 2));
  } else if (cmd === 'browser' && sub === 'frame') {
    const [target, outPath] = rest;
    if (!target) throw new Error('url or sessionId is required');
    const body = isUrl(target)
      ? { action: 'frame', url: target, allowUnsafeScreenshot: true }
      : { action: 'frame', sessionId: target, allowUnsafeScreenshot: true };
    const data = await browserRequest(body);
    const image = data.frame?.screenshot?.data;
    if (outPath) {
      if (!image) throw new Error('no frame screenshot returned');
      fs.writeFileSync(outPath, Buffer.from(image, 'base64'));
      console.log(outPath);
    } else {
      console.log(JSON.stringify({ ...data, frame: data.frame ? { ...data.frame, screenshot: { ...data.frame.screenshot, data: '[base64]' } } : undefined }, null, 2));
    }
  } else if (cmd === 'browser' && (sub === 'back' || sub === 'forward' || sub === 'reload')) {
    const sessionId = rest.join(' ').trim();
    if (!sessionId) throw new Error('sessionId is required');
    const data = await browserRequest({ action: sub, sessionId });
    console.log(JSON.stringify({ ...data, frame: data.frame ? { ...data.frame, screenshot: { ...data.frame.screenshot, data: '[base64]' } } : undefined }, null, 2));
  } else if (cmd === 'browser' && sub === 'click') {
    const [sessionId, ...selectorParts] = rest;
    const selector = selectorParts.join(' ').trim();
    if (!sessionId || !selector) throw new Error('sessionId and selector are required');
    console.log(JSON.stringify(await browserRequest({ action: 'click', sessionId, selector }), null, 2));
  } else if (cmd === 'browser' && sub === 'point-click') {
    const [sessionId, x, y] = rest;
    if (!sessionId || x === undefined || y === undefined) throw new Error('sessionId, x, and y are required');
    console.log(JSON.stringify(await browserRequest({ action: 'pointClick', sessionId, x: Number(x), y: Number(y) }), null, 2));
  } else if (cmd === 'browser' && sub === 'fill') {
    const [sessionId, selector, ...textParts] = rest;
    const text = textParts.join(' ');
    if (!sessionId || !selector) throw new Error('sessionId, selector, and text are required');
    console.log(JSON.stringify(await browserRequest({ action: 'fill', sessionId, selector, text }), null, 2));
  } else if (cmd === 'browser' && sub === 'type') {
    const [sessionId, ...textParts] = rest;
    const text = textParts.join(' ');
    if (!sessionId || !text) throw new Error('sessionId and text are required');
    console.log(JSON.stringify(await browserRequest({ action: 'type', sessionId, text }), null, 2));
  } else if (cmd === 'browser' && sub === 'scroll') {
    const [sessionId, deltaY, x = '600', y = '400'] = rest;
    if (!sessionId || deltaY === undefined) throw new Error('sessionId and deltaY are required');
    console.log(JSON.stringify(await browserRequest({ action: 'scroll', sessionId, deltaY: Number(deltaY), x: Number(x), y: Number(y) }), null, 2));
  } else if (cmd === 'browser' && sub === 'eval') {
    const [sessionId, ...expressionParts] = rest;
    const expression = expressionParts.join(' ').trim();
    if (!sessionId || !expression) throw new Error('sessionId and expression are required');
    console.log(JSON.stringify(await browserRequest({ action: 'eval', sessionId, expression, allowUnsafeEval: true }), null, 2));
  } else if (cmd === 'browser' && sub === 'screenshot') {
    const [target, outPath] = rest;
    if (!target) throw new Error('url or sessionId is required');
    const body = isUrl(target)
      ? { action: 'screenshot', url: target, allowUnsafeScreenshot: true }
      : { action: 'screenshot', sessionId: target, allowUnsafeScreenshot: true };
    const data = await browserRequest(body);
    const image = data.screenshot?.data;
    if (!image) throw new Error(data.screenshot?.message || 'no screenshot data returned');
    const file = outPath || `webc-browser-${Date.now()}.png`;
    fs.writeFileSync(file, Buffer.from(image, 'base64'));
    console.log(file);
  } else if (cmd === 'browser' && sub === 'close') {
    const sessionId = rest.join(' ').trim();
    if (!sessionId) throw new Error('sessionId is required');
    console.log(JSON.stringify(await browserRequest({ action: 'close', sessionId }), null, 2));
  } else if (cmd === 'notify') {
    const [title, ...bodyParts] = [sub, ...rest].filter(Boolean);
    if (!title) throw new Error('title is required');
    await request('POST', '/api/admin/notify', { title, body: bodyParts.join(' ') });
    console.log('ok');
  } else if (cmd === 'send') {
    const sessionId = sub;
    const text = rest.join(' ');
    if (!sessionId || !text) throw new Error('sessionId and text are required');
    await request('POST', '/api/admin/send', { sessionId, data: text });
    console.log('ok');
  } else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
