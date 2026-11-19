// UBA service worker — 后台指挥中枢
// 职责：
//   1. 管理标签页与授权（TabManager）。
//   2. 接收接入层（M2 起经 nativeMessaging / WebSocket 桥接）指令，路由到 content script。
//   3. 维护页面上下文、操作去重与高风险确认状态（M2/M3 完整闭环，M1 先建立骨架）。
//
// 注意：MV3 service worker 无持久状态，随时可能被回收。
// 跨消息状态必须落 chrome.storage；本文件仅在内存中缓存最近状态，重启后重建。

/// <reference types="chrome" />

import { TabManager } from '../core/tabs/index';

export default defineBackground(() => {
  const tabs = new TabManager();

  // 页面上下文缓存：tabId -> { url, snapshotVersion }（内存态，重启重建）
  const pageContext = new Map<number, { url: string; snapshotVersion: string }>();

  chrome.runtime.onInstalled.addListener((details) => {
    console.log('[UBA] installed', details.reason);
    // 建立诊断入口
    chrome.storage.local.set({ uba_installed_at: Date.now() });
  });

  // 标签页生命周期清理
  chrome.tabs.onRemoved.addListener((tabId) => {
    pageContext.delete(tabId);
    tabs.revoke(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
      pageContext.set(tabId, {
        url: tab.url || '',
        snapshotVersion: ''
      });
    }
  });

  // 统一指令路由：来自接入层（M2）或 popup 的受控命令
  async function dispatch(command: any): Promise<any> {
    const { method, params } = command;
    const tabId = params?.tabId as number;

    switch (method) {
      case 'browser.getInfo': {
        return {
          protocolVersion: '1.0',
          capabilities: [
            'browser.getSnapshot', 'browser.getTabs', 'browser.getActiveTab',
            'browser.createTab', 'browser.closeTab', 'browser.switchTab',
            'page.goto', 'page.back', 'page.forward', 'page.reload',
            'page.getUrl', 'page.getTitle',
            'locator.find', 'locator.click', 'locator.fill', 'locator.type',
            'locator.clear', 'locator.press', 'locator.hover', 'locator.check',
            'locator.uncheck', 'locator.selectOption', 'locator.scrollIntoView'
          ]
        };
      }

      case 'browser.getSnapshot': {
        return await sendToTab(tabId, 'UBA_GET_SNAPSHOT', { options: params?.options });
      }

      case 'browser.getTabs': {
        return { tabs: await tabs.list(params?.agentId as string) };
      }

      case 'browser.getActiveTab': {
        return { tab: await tabs.getActive() };
      }

      case 'browser.createTab': {
        return { tab: await tabs.create(params?.url as string, params?.active !== false) };
      }

      case 'browser.closeTab': {
        await tabs.close(tabId);
        return { ok: true };
      }

      case 'browser.switchTab': {
        await tabs.switchTo(tabId);
        return { ok: true };
      }

      case 'page.goto': {
        await chrome.tabs.update(tabId, { url: params?.url as string });
        return { ok: true, navigation: { occurred: true, url: params?.url } };
      }

      case 'page.back': {
        await chrome.tabs.goBack(tabId);
        return { ok: true };
      }

      case 'page.forward': {
        await chrome.tabs.goForward(tabId);
        return { ok: true };
      }

      case 'page.reload': {
        await chrome.tabs.reload(tabId);
        return { ok: true };
      }

      case 'page.getUrl': {
        const tab = await chrome.tabs.get(tabId);
        return { url: tab.url, snapshotVersion: pageContext.get(tabId)?.snapshotVersion || '' };
      }

      case 'page.getTitle': {
        const tab = await chrome.tabs.get(tabId);
        return { title: tab.title };
      }

      case 'locator.find': {
        return await sendToTab(tabId, 'UBA_LOCATE', { locator: params?.locator });
      }

      case 'locator.click':
      case 'locator.fill':
      case 'locator.type':
      case 'locator.clear':
      case 'locator.press':
      case 'locator.hover':
      case 'locator.check':
      case 'locator.uncheck':
      case 'locator.selectOption':
      case 'locator.scrollIntoView': {
        const actionType = method.split('.')[1];
        const action = {
          type: actionType,
          locator: params?.locator,
          value: params?.value,
          text: params?.text,
          key: params?.key,
          option: params?.option
        };
        return await sendToTab(tabId, 'UBA_PERFORM_ACTION', { action });
      }

      default:
        return { ok: false, errorType: 'METHOD_NOT_FOUND', error: 'Unknown method: ' + method };
    }
  }

  async function sendToTab(tabId: number, type: string, payload?: any): Promise<any> {
    if (tabId === undefined || tabId === null) {
      return { ok: false, errorType: 'INVALID_PARAMS', error: 'tabId is required' };
    }
    if (!(await tabs.exists(tabId))) {
      return { ok: false, errorType: 'TAB_NOT_FOUND', error: 'Tab not found' };
    }
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type, payload });
      return response;
    } catch (e) {
      // content script 未注入（特殊页面 / 尚未加载）
      return { ok: false, errorType: 'UNSUPPORTED_PAGE', error: 'Content script not available for this page' };
    }
  }

  // 暴露给 popup 与接入层
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'UBA_DISPATCH') {
      dispatch(message.command)
        .then((result) => sendResponse(result))
        .catch((e) => sendResponse({ ok: false, errorType: 'INTERNAL_ERROR', error: String(e) }));
      return true;
    }
  });

  // 诊断入口：打印当前授权与上下文
  (globalThis as any).__UBA__ = {
    diagnose: async () => ({
      tabs: await tabs.list('*'),
      pageContext: Array.from(pageContext.entries())
    })
  };
});
