declare module 'ws' {
  import { EventEmitter } from 'events';

  export class WebSocket extends EventEmitter {
    static OPEN: number;
    readyState: number;
    constructor(url: string, options?: { headers?: Record<string, string> });
    send(data: string): void;
    close(): void;
  }

  export class WebSocketServer extends EventEmitter {
    clients: Set<WebSocket>;
    constructor(options: { port?: number; host?: string });
    close(): void;
  }
}
