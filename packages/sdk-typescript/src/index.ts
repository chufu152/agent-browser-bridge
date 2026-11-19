// UBA TypeScript SDK — BrowserClient
// 封装认证、请求、错误、事件与重连，不绕过 BCP，不内置另一套执行引擎。

import WebSocket from 'ws';

export interface BrowserClientOptions {
  endpoint: string;
  agentId: string;
  token: string;
  protocolVersion?: string;
}

export class UbaError extends Error {
  constructor(
    public readonly code: number,
    public readonly errorType: string,
    message: string,
    public readonly data?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'UbaError';
  }
}

export interface ElementDescriptor {
  ref: string;
  role: string;
  name: string;
  text: string;
  placeholder?: string;
  tag: string;
  type?: string;
  disabled: boolean;
  visible: boolean;
  enabled: boolean;
}

export interface Snapshot {
  url: string;
  title: string;
  snapshotVersion: string;
  elements: ElementDescriptor[];
  truncated: boolean;
  fullSync: boolean;
}

export interface Locator {
  ref?: string;
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  selector?: string;
  xpath?: string;
  exact?: boolean;
}

type EventListener = (event: unknown) => void;

export class BrowserClient {
  private ws: WebSocket | null = null;
  private idSeq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private sessionId: string | null = null;
  private listeners = new Map<string, EventListener[]>();
  private subscriptionId: string | null = null;

  constructor(private readonly opts: BrowserClientOptions) {}

  async connect(): Promise<void> {
    if (this.ws) return;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.opts.endpoint);
      this.ws = ws;
      ws.on('open', () => resolve());
      ws.on('error', (e) => reject(e));
      ws.on('message', (data) => this.onMessage(data.toString()));
      ws.on('close', () => {
        this.ws = null;
        this.sessionId = null;
      });
    });

    const res = await this.call('browser.connect', {
      agentId: this.opts.agentId,
      token: this.opts.token,
      protocolVersion: this.opts.protocolVersion ?? '1.0'
    }) as { sessionId: string };
    this.sessionId = res.sessionId;
  }

  async close(): Promise<void> {
    this.ws?.close();
    this.ws = null;
    this.sessionId = null;
  }

  get session(): string | null {
    return this.sessionId;
  }

  private onMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new UbaError(msg.error.code, msg.error.data?.errorType ?? 'INTERNAL_ERROR', msg.error.message, msg.error.data));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    // 通知（无 id）
    if (msg.method) {
      for (const cb of this.listeners.get(msg.method) ?? []) cb(msg.params);
      for (const cb of this.listeners.get('*') ?? []) cb(msg);
    }
  }

  private call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new UbaError(-32012, 'BRIDGE_UNAVAILABLE', 'Not connected'));
    }
    const id = ++this.idSeq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private async callWithSession(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.sessionId) throw new UbaError(-32007, 'SESSION_EXPIRED', 'Not authenticated');
    return this.call(method, { ...params, sessionId: this.sessionId });
  }

  on(method: string, cb: EventListener): void {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method)!.push(cb);
  }

  // ---------- Browser ----------

  async getInfo(): Promise<unknown> {
    return this.callWithSession('browser.getInfo');
  }

  async getSnapshot(tabId: number, options?: Record<string, unknown>): Promise<Snapshot> {
    return this.callWithSession('browser.getSnapshot', { tabId, options }) as Promise<Snapshot>;
  }

  async getText(tabId: number, options?: { ref?: string; selector?: string; maxLength?: number }): Promise<unknown> {
    return this.callWithSession('browser.getText', { tabId, ...(options ?? {}) });
  }

  async getTabs(): Promise<{ tabs: unknown[] }> {
    return this.callWithSession('browser.getTabs') as Promise<{ tabs: unknown[] }>;
  }

  async getActiveTab(): Promise<{ tab: unknown }> {
    return this.callWithSession('browser.getActiveTab') as Promise<{ tab: unknown }>;
  }

  async createTab(url: string, active = true): Promise<unknown> {
    return this.callWithSession('browser.createTab', { url, active, operationId: this.nextOp('createTab') });
  }

  async closeTab(tabId: number): Promise<unknown> {
    return this.callWithSession('browser.closeTab', { tabId, operationId: this.nextOp('closeTab') });
  }

  async switchTab(tabId: number): Promise<unknown> {
    return this.callWithSession('browser.switchTab', { tabId, operationId: this.nextOp('switchTab') });
  }

  async getOperation(operationId: string): Promise<unknown> {
    return this.callWithSession('browser.getOperation', { operationId });
  }

  async getEvents(cursor?: string, limit = 100): Promise<unknown> {
    return this.callWithSession('browser.getEvents', { cursor, limit });
  }

  // ---------- Page ----------

  async goto(tabId: number, url: string): Promise<unknown> {
    return this.callWithSession('page.goto', { tabId, url, operationId: this.nextOp('goto') });
  }

  async back(tabId: number): Promise<unknown> {
    return this.callWithSession('page.back', { tabId, operationId: this.nextOp('back') });
  }

  async forward(tabId: number): Promise<unknown> {
    return this.callWithSession('page.forward', { tabId, operationId: this.nextOp('forward') });
  }

  async reload(tabId: number): Promise<unknown> {
    return this.callWithSession('page.reload', { tabId, operationId: this.nextOp('reload') });
  }

  async getUrl(tabId: number): Promise<unknown> {
    return this.callWithSession('page.getUrl', { tabId });
  }

  async getTitle(tabId: number): Promise<unknown> {
    return this.callWithSession('page.getTitle', { tabId });
  }

  async subscribe(tabId: number, eventTypes: string[]): Promise<{ subscriptionId: string }> {
    const res = await this.callWithSession('page.subscribe', { tabId, eventTypes }) as { subscriptionId: string };
    this.subscriptionId = res.subscriptionId;
    return res;
  }

  async unsubscribe(): Promise<unknown> {
    if (!this.subscriptionId) return { unsubscribed: false };
    const res = await this.callWithSession('page.unsubscribe', { subscriptionId: this.subscriptionId });
    this.subscriptionId = null;
    return res;
  }

  // ---------- Locator ----------

  async find(tabId: number, locator: Locator): Promise<unknown> {
    return this.callWithSession('locator.find', { tabId, locator });
  }

  async click(tabId: number, locator: Locator, operationId?: string, confirmationId?: string): Promise<unknown> {
    const params: Record<string, unknown> = { tabId, locator, operationId: operationId ?? this.nextOp('click') };
    if (confirmationId) params.confirmationId = confirmationId;
    return this.callWithSession('locator.click', params);
  }

  async fill(tabId: number, locator: Locator, value: string): Promise<unknown> {
    return this.callWithSession('locator.fill', { tabId, locator, value, operationId: this.nextOp('fill') });
  }

  async type(tabId: number, locator: Locator, text: string): Promise<unknown> {
    return this.callWithSession('locator.type', { tabId, locator, text, operationId: this.nextOp('type') });
  }

  async clear(tabId: number, locator: Locator): Promise<unknown> {
    return this.callWithSession('locator.clear', { tabId, locator, operationId: this.nextOp('clear') });
  }

  async press(tabId: number, locator: Locator, key: string): Promise<unknown> {
    return this.callWithSession('locator.press', { tabId, locator, key, operationId: this.nextOp('press') });
  }

  async hover(tabId: number, locator: Locator): Promise<unknown> {
    return this.callWithSession('locator.hover', { tabId, locator, operationId: this.nextOp('hover') });
  }

  async check(tabId: number, locator: Locator): Promise<unknown> {
    return this.callWithSession('locator.check', { tabId, locator, operationId: this.nextOp('check') });
  }

  async uncheck(tabId: number, locator: Locator): Promise<unknown> {
    return this.callWithSession('locator.uncheck', { tabId, locator, operationId: this.nextOp('uncheck') });
  }

  async selectOption(tabId: number, locator: Locator, option: string): Promise<unknown> {
    return this.callWithSession('locator.selectOption', { tabId, locator, option, operationId: this.nextOp('selectOption') });
  }

  async scrollIntoView(tabId: number, locator: Locator): Promise<unknown> {
    return this.callWithSession('locator.scrollIntoView', { tabId, locator, operationId: this.nextOp('scrollIntoView') });
  }

  async batch(tabId: number, actions: unknown[], stopOnError = true): Promise<unknown> {
    return this.callWithSession('browser.batch', { tabId, actions, stopOnError, operationId: this.nextOp('batch') });
  }

  private nextOp(prefix: string): string {
    return `op_${prefix}_${Date.now()}_${++this.idSeq}`;
  }
}
