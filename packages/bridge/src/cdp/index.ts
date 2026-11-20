// CDP 南向通道 — 直连浏览器 DevTools 协议，替代扩展 + Native Messaging。
// 零安装：浏览器以 --remote-debugging-port 启动即可被控制，无需扩展/注册表/重载。
// 页面能力由注入的 UBA 引擎提供（与扩展同一套 DOM/Locator/Action 引擎）。

import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import type { ExtensionTransport, ExtensionCommand } from '../transport/index';

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

class PageSession {
  private ws: WebSocket | null = null;
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private injected = false;
  private loadWaiters: Array<() => void> = [];

  constructor(
    private readonly wsUrl: string,
    private readonly engineSource: string
  ) {}

  private connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl, { perMessageDeflate: false });
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('CDP connect timeout')); }, 8000);
      ws.on('open', () => { clearTimeout(timer); this.ws = ws; resolve(ws); });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
      ws.on('message', (data) => this.onMessage(data.toString()));
      ws.on('close', () => {
        this.ws = null;
        this.injected = false;
        for (const p of this.pending.values()) p.reject(new Error('CDP session closed'));
        this.pending.clear();
      });
    });
  }

  private onMessage(raw: string): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message ?? 'CDP error'));
        else p.resolve(msg.result);
      }
      return;
    }
    if (msg.method === 'Page.loadEventFired' || msg.method === 'Page.frameStoppedLoading') {
      const waiters = this.loadWaiters;
      this.loadWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  private async rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const ws = await this.connect();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP rpc timeout: ' + method)); }, 30000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async ensureInjected(): Promise<void> {
    if (this.injected) return;
    await this.rpc('Page.enable');
    await this.rpc('Runtime.enable');
    await this.rpc('Page.addScriptToEvaluateOnNewDocument', { source: this.engineSource });
    await this.rpc('Runtime.evaluate', { expression: this.engineSource, returnByValue: true });
    this.injected = true;
  }

  async dispatch(type: string, payload: unknown): Promise<any> {
    await this.ensureInjected();
    const expression =
      `window.UBA ? window.UBA.__dispatch(${JSON.stringify(type)}, ${JSON.stringify(payload ?? null)})` +
      ` : { ok: false, errorType: 'INTERNAL_ERROR', error: 'UBA engine not injected' }`;
    const res = await this.rpc('Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) {
      return { ok: false, errorType: 'INTERNAL_ERROR', error: res.exceptionDetails.text ?? 'page evaluate failed' };
    }
    return res.result?.value;
  }

  async navigate(url: string): Promise<any> {
    await this.ensureInjected();
    const loaded = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 15000);
      this.loadWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
    const res = await this.rpc('Page.navigate', { url });
    if (res.errorText) return { ok: false, errorType: 'NAVIGATION_INTERRUPTED', error: res.errorText };
    await loaded;
    this.injected = false; // 新文档需重新注入（addScriptToEvaluateOnNewDocument 已覆盖，此处仅复位标记）
    return { ok: true, navigation: { occurred: true, url } };
  }

  async history(delta: -1 | 1): Promise<any> {
    const hist = await this.rpc('Page.getNavigationHistory');
    const idx = hist.currentIndex + delta;
    if (idx < 0 || idx >= hist.entries.length) return { ok: false, errorType: 'INVALID_ELEMENT_STATE', error: 'No history entry' };
    await this.rpc('Page.navigateToHistoryEntry', { entryId: hist.entries[idx].id });
    return { ok: true };
  }

  async reload(): Promise<any> {
    await this.rpc('Page.reload');
    this.injected = false;
    return { ok: true };
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export class CdpTransport implements ExtensionTransport {
  private readonly port: number;
  private readonly engineFile: string;
  private engineSource: string | null = null;
  private readonly targetToTab = new Map<string, number>();
  private readonly tabToTarget = new Map<number, string>();
  private readonly sessions = new Map<string, PageSession>();
  private nextTabId = 1;
  private disconnectCbs: Array<() => void> = [];

  constructor(opts: { port?: number; engineFile?: string } = {}) {
    this.port = opts.port ?? Number(process.env.UBA_CDP_PORT ?? 9222);
    this.engineFile = opts.engineFile ?? process.env.UBA_ENGINE_FILE ?? '';
  }

  private base(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async isAlive(): Promise<boolean> {
    try {
      const res = await fetch(this.base() + '/json/version', { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private engine(): string {
    if (this.engineSource === null) {
      if (!this.engineFile) throw new Error('UBA_ENGINE_FILE is not set');
      this.engineSource = readFileSync(this.engineFile, 'utf-8');
    }
    return this.engineSource;
  }

  private async listTargets(): Promise<CdpTarget[]> {
    const res = await fetch(this.base() + '/json/list', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error('CDP /json/list failed');
    const all = (await res.json()) as CdpTarget[];
    return all.filter((t) => t.type === 'page');
  }

  private register(target: CdpTarget): number {
    let id = this.targetToTab.get(target.id);
    if (id === undefined) {
      id = this.nextTabId++;
      this.targetToTab.set(target.id, id);
      this.tabToTarget.set(id, target.id);
    }
    return id;
  }

  private async resolveTarget(tabId: number): Promise<CdpTarget | null> {
    const targets = await this.listTargets();
    for (const t of targets) this.register(t);
    const targetId = this.tabToTarget.get(tabId);
    return targets.find((t) => t.id === targetId) ?? null;
  }

  private sessionFor(target: CdpTarget): PageSession {
    let s = this.sessions.get(target.id);
    if (!s) {
      if (!target.webSocketDebuggerUrl) throw new Error('Target has no debugger URL');
      s = new PageSession(target.webSocketDebuggerUrl, this.engine());
      this.sessions.set(target.id, s);
    }
    return s;
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCbs.push(cb);
  }

  async send(command: ExtensionCommand): Promise<unknown> {
    const { method, params } = command;
    const tabId = params.tabId as number | undefined;

    if (!(await this.isAlive())) {
      this.disconnectCbs.forEach((cb) => cb());
      return { ok: false, errorType: 'BRIDGE_UNAVAILABLE', error: 'Browser CDP endpoint is not reachable' };
    }

    try {
      switch (method) {
        case 'browser.getInfo':
          return {
            protocolVersion: '1.0',
            capabilities: [
              'browser.getSnapshot', 'browser.getTabs', 'browser.getActiveTab', 'browser.getText',
              'browser.createTab', 'browser.closeTab', 'browser.switchTab',
              'page.goto', 'page.back', 'page.forward', 'page.reload', 'page.getUrl', 'page.getTitle',
              'locator.find', 'locator.click', 'locator.fill', 'locator.type', 'locator.clear',
              'locator.press', 'locator.hover', 'locator.check', 'locator.uncheck',
              'locator.selectOption', 'locator.scrollIntoView'
            ]
          };

        case 'browser.getTabs': {
          const targets = await this.listTargets();
          const tabs = targets.map((t, i) => ({
            tabId: this.register(t), windowId: 0, url: t.url, title: t.title, active: i === 0
          }));
          return { tabs };
        }

        case 'browser.getActiveTab': {
          const targets = await this.listTargets();
          if (!targets.length) return { tab: null };
          const t = targets[0];
          return { tab: { tabId: this.register(t), windowId: 0, url: t.url, title: t.title, active: true } };
        }

        case 'browser.createTab': {
          const url = (params.url as string) ?? 'about:blank';
          const res = await fetch(this.base() + '/json/new?' + encodeURIComponent(url), { method: 'PUT', signal: AbortSignal.timeout(5000) });
          if (!res.ok) return { ok: false, errorType: 'INTERNAL_ERROR', error: 'createTab failed' };
          const t = (await res.json()) as CdpTarget;
          return { tab: { tabId: this.register(t), windowId: 0, url: t.url, title: t.title, active: true } };
        }

        case 'browser.closeTab': {
          const target = await this.resolveTarget(tabId!);
          if (!target) return { ok: false, errorType: 'TAB_NOT_FOUND', error: 'Tab not found' };
          await fetch(this.base() + '/json/close/' + target.id, { signal: AbortSignal.timeout(5000) });
          this.sessions.get(target.id)?.close();
          this.sessions.delete(target.id);
          return { ok: true };
        }

        case 'browser.switchTab': {
          const target = await this.resolveTarget(tabId!);
          if (!target) return { ok: false, errorType: 'TAB_NOT_FOUND', error: 'Tab not found' };
          await fetch(this.base() + '/json/activate/' + target.id, { signal: AbortSignal.timeout(5000) });
          return { ok: true };
        }

        default:
          break;
      }

      // 其余方法都需要具体标签页
      if (tabId === undefined) return { ok: false, errorType: 'INVALID_PARAMS', error: 'tabId is required' };
      const target = await this.resolveTarget(tabId);
      if (!target) return { ok: false, errorType: 'TAB_NOT_FOUND', error: 'Tab not found' };
      if (!/^(https?|file):/.test(target.url)) {
        return { ok: false, errorType: 'UNSUPPORTED_PAGE', error: 'Only http(s)/file pages are controllable' };
      }
      const session = this.sessionFor(target);

      switch (method) {
        case 'page.goto':
          return await session.navigate(params.url as string);
        case 'page.back':
          return await session.history(-1);
        case 'page.forward':
          return await session.history(1);
        case 'page.reload':
          return await session.reload();
        case 'page.getUrl':
          return await session.dispatch('UBA_PING', {}).then((r: any) =>
            r?.ok ? { url: r.result.url, snapshotVersion: '' } : r);
        case 'page.getTitle': {
          const r = await session.dispatch('UBA_GET_SNAPSHOT', { options: { maxElements: 1 } });
          return r?.ok ? { title: r.result.title } : r;
        }
        case 'browser.getSnapshot':
          return await session.dispatch('UBA_GET_SNAPSHOT', { options: params.options });
        case 'browser.getText':
          return await session.dispatch('UBA_GET_TEXT', { ref: params.ref, selector: params.selector, maxLength: params.maxLength });
        case 'locator.find':
          return await session.dispatch('UBA_LOCATE', { locator: params.locator });
        default:
          break;
      }

      if (method.startsWith('locator.')) {
        const action = {
          type: method.split('.')[1],
          locator: params.locator,
          value: params.value,
          text: params.text,
          key: params.key,
          option: params.option,
          confirmationGrant: params.confirmationGrant === true
        };
        return await session.dispatch('UBA_PERFORM_ACTION', { action });
      }

      return { ok: false, errorType: 'METHOD_NOT_FOUND', error: 'Unknown method: ' + method };
    } catch (e) {
      return { ok: false, errorType: 'BRIDGE_UNAVAILABLE', error: String(e) };
    }
  }
}