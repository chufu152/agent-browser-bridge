// UBA content script 入口
// 装配顺序：dom → locator → snapshot → observer → actions（引擎均为纯函数模块）。
// 挂载到 window.UBA 隔离命名空间，避免与站点脚本冲突。

import { buildSnapshot, elementFingerprint } from '../core/dom-engine/index';
import { locate, find } from '../core/locator/index';
import { createSnapshotEngine } from '../core/snapshot/index';
import { createObserver } from '../core/observer/index';
import { perform, isHighRiskText, isPasswordField } from '../core/actions/index';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // ref -> element 映射（绑定当前文档与元素身份）
    const refMap = new Map<string, Element>();
    const resolveRef = (ref: string): Element | null => {
      const cached = refMap.get(ref);
      if (cached && cached.isConnected) return cached;
      return null;
    };

    const snapshotEngine = createSnapshotEngine(document);

    // 使用 snapshot 引擎，并在首次 getSnapshot 时重建 refMap
    function getSnapshot(options?: any) {
      const snap = snapshotEngine.getSnapshot(options);
      // 重建 ref 映射：为每个元素按指纹建立映射
      refMap.clear();
      const all = Array.from(document.querySelectorAll('*'));
      for (const d of snap.elements) {
        if (!d.ref) continue;
        const match = all.find((el) => {
          const fp = elementFingerprint(el);
          // ref 是 'el_' + hash(fp)；这里重新计算比对
          const hash = simpleHash(fp);
          return d.ref === 'el_' + hash;
        });
        if (match) refMap.set(d.ref, match);
      }
      return snap;
    }

    function simpleHash(str: string): string {
      let h = 5381;
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
      }
      return h.toString(36);
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
