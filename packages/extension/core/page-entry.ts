// UBA 页面引擎（CDP 版入口）— 与扩展 content script 同一套引擎，
// 经 CDP Runtime.evaluate 注入页面，不依赖任何 chrome.* API。
// 注入幂等：window.__UBA_INJECTED__ 防止重复装配。

import { buildRefMap } from './dom-engine/index';
import { find } from './locator/index';
import { createSnapshotEngine } from './snapshot/index';
import { perform } from './actions/index';

(() => {
  const w = window as any;
  if (w.__UBA_INJECTED__) return;
  w.__UBA_INJECTED__ = true;

  let refMap = new Map<string, Element>();
  const resolveRef = (ref: string): Element | null => {
    const cached = refMap.get(ref);
    if (cached && cached.isConnected) return cached;
    return null;
  };

  const snapshotEngine = createSnapshotEngine(document);

  function getSnapshot(options?: any) {
    const snap = snapshotEngine.getSnapshot(options);
    refMap = buildRefMap(document);
    return snap;
  }

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
    if (maxLength && maxLength > 0 && text.length > maxLength) text = text.slice(0, maxLength);
    return { ok: true, result: { text, length: totalLength, truncated: totalLength > text.length } };
  }

  w.UBA = {
    __dispatch(type: string, payload?: any): any {
      try {
        switch (type) {
          case 'UBA_GET_SNAPSHOT':
            return { ok: true, result: getSnapshot(payload?.options) };
          case 'UBA_GET_TEXT':
            return getText(payload);
          case 'UBA_PERFORM_ACTION': {
            const res = perform(payload?.action, document, resolveRef);
            return res.ok ? { ok: true, result: res } : res;
          }
          case 'UBA_LOCATE':
            return { ok: true, result: find(payload?.locator, document, resolveRef) };
          case 'UBA_PING':
            return { ok: true, result: { pong: true, url: location.href } };
          default:
            return { ok: false, errorType: 'METHOD_NOT_FOUND', error: 'Unknown command' };
        }
      } catch (e) {
        return { ok: false, errorType: 'INTERNAL_ERROR', error: String(e) };
      }
    }
  };
})();