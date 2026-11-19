// M5 高级能力测试 — Shadow DOM 提取与定位、文件操作授权门。

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSnapshot } from '../core/dom-engine/index';
import { locate } from '../core/locator/index';

function buildShadowDom(): { doc: Document } {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
    url: 'https://test.local/',
    pretendToBeVisual: true
  });
  const doc = dom.window.document;
  const host = doc.getElementById('host')!;
  const shadow = host.attachShadow({ mode: 'open' });
  const btn = doc.createElement('button');
  btn.setAttribute('aria-label', '影子按钮');
  btn.textContent = '影子按钮';
  shadow.appendChild(btn);
  return { doc };
}

describe('M5 Shadow DOM 支持', () => {
  it('提取 Shadow DOM 内元素并标记 inShadowRoot', () => {
    const { doc } = buildShadowDom();
    const snap = buildSnapshot(doc);
    const btn = snap.elements.find((e) => e.name === '影子按钮');
    expect(btn).toBeDefined();
    expect(btn!.inShadowRoot).toBe(true);
  });

  it('语义定位能命中 Shadow DOM 内元素', () => {
    const { doc } = buildShadowDom();
    const res = locate({ role: 'button', name: '影子按钮' }, doc, () => null);
    expect(res.ok).toBe(true);
    expect(res.elements![0].textContent).toBe('影子按钮');
  });
});
