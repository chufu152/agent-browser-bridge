// 智能等待 — 基于页面状态轮询判断完成，不使用固定延时作为主要同步机制。
// 条件优先级：导航完成 → 目标元素出现 → 目标文本出现。

import type { ExtensionTransport } from '../transport/index';

export interface WaitOptions {
  tabId: number;
  sessionId: string;
  timeoutMs?: number;
  pollMs?: number;
}

export interface WaitResult {
  matched: boolean;
  elapsedMs: number;
  snapshotVersion?: string;
}

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_POLL = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SmartWait {
  constructor(private readonly transport: () => ExtensionTransport | null) {}

  private async getSnapshot(opts: WaitOptions): Promise<any> {
    const t = this.transport();
    if (!t) throw new Error('BRIDGE_UNAVAILABLE');
    const res = await t.send({ method: 'browser.getSnapshot', params: { tabId: opts.tabId, sessionId: opts.sessionId } });
    return normalize(res);
  }

  async waitForSelector(opts: WaitOptions, locator: Record<string, unknown>): Promise<WaitResult> {
    return this.poll(opts, async (snap) => {
      const els = snap?.elements ?? [];
      // 语义匹配：role + name 或 ref
      if (locator.ref) return els.some((e: any) => e.ref === locator.ref);
      return els.some((e: any) => {
        if (locator.role && e.role !== locator.role) return false;
        if (locator.name && e.name !== locator.name) return false;
        return true;
      });
    });
  }

  async waitForText(opts: WaitOptions, text: string): Promise<WaitResult> {
    return this.poll(opts, async (snap) => {
      const els = snap?.elements ?? [];
      return els.some((e: any) => (e.text || '').includes(text));
    });
  }

  async waitForNavigation(opts: WaitOptions, fromUrl: string): Promise<WaitResult> {
    return this.poll(opts, async (snap) => {
      return snap?.url && snap.url !== fromUrl;
    });
  }

  private async poll(
    opts: WaitOptions,
    predicate: (snap: any) => Promise<boolean>
  ): Promise<WaitResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
    const pollMs = opts.pollMs ?? DEFAULT_POLL;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      let snap: any;
      try {
        snap = await this.getSnapshot(opts);
      } catch {
        // 传输不可用，继续等待或超时
        snap = null;
      }
      if (await predicate(snap)) {
        return { matched: true, elapsedMs: Date.now() - start, snapshotVersion: snap?.snapshotVersion };
      }
      await sleep(pollMs);
    }
    return { matched: false, elapsedMs: Date.now() - start };
  }
}

function normalize(raw: unknown): any {
  if (raw && typeof raw === 'object') {
    const r = raw as any;
    if (r.result !== undefined) return r.result;
    if (r.ok === false) return null;
    return raw;
  }
  return raw;
}
