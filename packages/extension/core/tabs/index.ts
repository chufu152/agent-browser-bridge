// UBA Tab Manager — service worker 侧
// 负责标签页枚举、创建、切换、关闭，以及标签页与 Agent 的授权绑定。
// 授权模型：tabId -> 授权 agentId 集合，未经授权的 Agent 看不到该标签页。

/// <reference types="chrome" />

export interface TabInfo {
  tabId: number;
  windowId: number;
  url?: string;
  title?: string;
  active: boolean;
}

export class TabManager {
  private grants: Map<number, Set<string>> = new Map();

  // 授权一个标签页给某 Agent（M2/M3 使用；M1 先提供结构）
  grant(tabId: number, agentId: string): void {
    let set = this.grants.get(tabId);
    if (!set) {
      set = new Set();
      this.grants.set(tabId, set);
    }
    set.add(agentId);
  }

  revoke(tabId: number, agentId?: string): void {
    if (agentId === undefined) {
      this.grants.delete(tabId);
      return;
    }
    const set = this.grants.get(tabId);
    if (set) {
      set.delete(agentId);
      if (set.size === 0) this.grants.delete(tabId);
    }
  }

  hasGrant(tabId: number, agentId: string): boolean {
    const set = this.grants.get(tabId);
    return !!set && set.has(agentId);
  }

  // 当前所有已认证 Agent 均可查看全部标签页（认证在桥接层完成）。
  // 标签页级授权（grant / hasGrant）为未来多 Agent 隔离预留，暂不在此过滤。
  async list(): Promise<TabInfo[]> {
    const tabs = await chrome.tabs.query({});
    return tabs
      .filter((t) => t.id !== undefined)
      .map((t) => ({
        tabId: t.id as number,
        windowId: t.windowId,
        url: t.url,
        title: t.title,
        active: t.active
      }));
  }

  async getActive(): Promise<TabInfo | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) return null;
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title,
      active: true
    };
  }

  async create(url: string, active = true): Promise<TabInfo> {
    const tab = await chrome.tabs.create({ url, active });
    return {
      tabId: tab.id as number,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title,
      active
    };
  }

  async switchTo(tabId: number): Promise<void> {
    await chrome.tabs.update(tabId, { active: true });
  }

  async close(tabId: number): Promise<void> {
    this.revoke(tabId);
    await chrome.tabs.remove(tabId);
  }

  async exists(tabId: number): Promise<boolean> {
    try {
      const tab = await chrome.tabs.get(tabId);
      return !!tab;
    } catch {
      return false;
    }
  }
}
