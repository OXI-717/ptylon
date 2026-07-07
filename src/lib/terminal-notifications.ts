export type TerminalNotificationProtocol = 'osc777' | 'osc99' | 'osc9';

export interface TerminalNotificationPayload {
  protocol: TerminalNotificationProtocol;
  title: string;
  subtitle?: string;
  body?: string;
}

export type Osc99State = Map<string, Partial<Pick<TerminalNotificationPayload, 'title' | 'subtitle' | 'body'>>>;

const OSC_RE = /\x1b\]([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

function clean(value: string | undefined) {
  return value?.trim();
}

function parseOsc99(content: string, state: Osc99State): TerminalNotificationPayload | null {
  const fields = content.slice(3).split(';');
  let id = 'default';
  let done = false;
  const updates: Partial<Pick<TerminalNotificationPayload, 'title' | 'subtitle' | 'body'>> = {};

  for (const field of fields) {
    if (field.startsWith('i=')) id = field.slice(2) || id;
    else if (field === 'd=1') done = true;
    else if (field.startsWith('p=title:')) updates.title = clean(field.slice(8));
    else if (field.startsWith('p=subtitle:')) updates.subtitle = clean(field.slice(11));
    else if (field.startsWith('p=body:')) updates.body = clean(field.slice(7));
  }

  const next = { ...(state.get(id) || {}), ...updates };
  state.set(id, next);
  if (!done) return null;

  const title = clean(next.title) || clean(next.subtitle) || 'Terminal';
  const body = clean(next.body);
  state.delete(id);
  return {
    protocol: 'osc99',
    title,
    ...(next.subtitle ? { subtitle: next.subtitle } : {}),
    ...(body ? { body } : {}),
  };
}

export function extractTerminalNotifications(data: string, osc99State: Osc99State = new Map()): TerminalNotificationPayload[] {
  const notifications: TerminalNotificationPayload[] = [];
  for (const match of data.matchAll(OSC_RE)) {
    const content = match[1] || '';
    if (content.startsWith('777;')) {
      const parts = content.split(';');
      if (parts[1] !== 'notify') continue;
      const title = clean(parts[2]) || 'Terminal';
      const body = clean(parts.slice(3).join(';'));
      notifications.push({ protocol: 'osc777', title, ...(body ? { body } : {}) });
      continue;
    }
    if (content.startsWith('9;')) {
      const body = clean(content.slice(2));
      if (body) notifications.push({ protocol: 'osc9', title: 'Terminal', body });
      continue;
    }
    if (content.startsWith('99;')) {
      const notification = parseOsc99(content, osc99State);
      if (notification) notifications.push(notification);
    }
  }
  return notifications;
}
