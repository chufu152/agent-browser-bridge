// UBA content script 入口
// 装配顺序：dom → locator → snapshot → observer → actions（引擎均为纯函数模块）。
// 挂载到 window.UBA 隔离命名空间，避免与站点脚本冲突。

import { buildSnapshot, buildRefMap } from '../core/dom-engine/index';
import { locate, find } from '../core/locator/index';
import { createSnapshotEngine } from '../core/snapshot/index';
import { createObserver } from '../core/observer/index';
import { perform, isHighRiskText, isPasswordField } from '../core/actions/index';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // ref -> element 映射（绑定当前文档与元素身份）
    let refMap = new Map<string, Element>();
    const resolveRef = (ref: string): Element | null => {
      const cached = refMap.get(ref);
      if (cached && cached.isConnected) return cached;
      return null;
    };

    const snapshotEngine = createSnapshotEngine(document);

    // 获取快照并同步重建 refMap（单次遍历 O(n)）
    function getSnapshot(options?: any) {
      const snap = snapshotEngine.getSnapshot(options);
      refMap = buildRefMap(document);
      return snap;
    }

    // 获取某元素（或整页）的完整文本：ref / selector / 默认 body，保留换行
    function getText(payload?: any) {
      const { ref, selector, maxLength } = payload || {};
      let el: Element | null = null;
      if (ref) el = resolveRef(ref);
      else if (selector) el = document.querySelector(selector);
      else el = document.body;
      if (!el) return { ok: false, errorType: 'ELEMENT_NOT_FOUND', error: 'Element not found' };
      let text = el.textContent || '';
      text = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      const totalLength = text.length;
      if (maxLength && maxLength > 0 && text.length > maxLength) {
        text = text.slice(0, maxLength);
      }
      return { ok: true, result: { text, length: totalLength, truncated: totalLength > text.length } };
    }

    // 观察器：变化时转发给 service worker
    const observer = createObserver(
      document,
      (record) => {
        try {
          chrome.runtime.sendMessage({ type: 'UBA_PAGE_CHANGED', record }).catch(() => {});
        } catch {
          /* 忽略 */
        }
      },
      () => snapshotEngine.getSnapshot().snapshotVersion
    );
    observer.start();

    // 暴露引擎
    (window as any).UBA = {
      dom: { buildSnapshot: () => buildSnapshot(document), resolveRef, isVisible: undefined },
      locator: {
        locate: (loc: any) => locate(loc, document, resolveRef),
        find: (loc: any) => find(loc, document, resolveRef)
      },
      snapshot: { getSnapshot },
      observer: { start: () => observer.start(), stop: () => observer.stop(), flush: () => observer.flush() },
      actions: {
        perform: (action: any) => perform(action, document, resolveRef),
        isHighRiskText,
        isPasswordField
      }
    };

    // 接收 service worker 指令
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return;
      const { type, payload } = message;
      try {
        switch (type) {
          case 'UBA_GET_SNAPSHOT': {
            sendResponse({ ok: true, result: getSnapshot(payload?.options) });
            break;
          }
          case 'UBA_GET_TEXT': {
            sendResponse(getText(payload));
            break;
          }
          case 'UBA_PERFORM_ACTION': {
            const res = perform(payload?.action, document, resolveRef);
            sendResponse(res.ok ? { ok: true, result: res } : res);
            break;
          }
          case 'UBA_LOCATE': {
            sendResponse({ ok: true, result: find(payload?.locator, document, resolveRef) });
            break;
          }
          case 'UBA_PING': {
            sendResponse({ ok: true, result: { pong: true, url: location.href } });
            break;
          }
          default:
            sendResponse({ ok: false, errorType: 'METHOD_NOT_FOUND', error: 'Unknown content command' });
        }
      } catch (e) {
        sendResponse({ ok: false, errorType: 'INTERNAL_ERROR', error: String(e) });
      }
      return true;
    });
  }
});
