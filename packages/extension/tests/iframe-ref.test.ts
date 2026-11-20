// 跨同源 iframe ref 唯一性回归 —
// 修复前：不同 iframe 内同构元素（如 UEditor 的 body>p）domPath 相同 → ref 碰撞，
// 导致定位/填写全部命中最后一个 frame 的元素。

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSnapshot, buildRefMap } from '../core/dom-engine/index';

function buildTwoFrameDom(): Document {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://test.local/',
    pretendToBeVisual: true
  });
  const doc = dom.window.document;
  for (let i = 0; i < 2; i++) {
    const f = doc.createElement('iframe');
    doc.body.appendChild(f);
    const idoc = f.contentDocument!;
    idoc.open();
    idoc.write('<!doctype html><html><body><p contenteditable="true">答案</p></body></html>');
    idoc.close();
    const p = idoc.querySelector('p')!;
    Object.defineProperty(p, 'isContentEditable', { value: true });
  }
  return doc;
}

describe('跨 iframe ref 唯一性', () => {
  it('同构元素在不同 iframe 中 ref 不同', () => {
    const doc = buildTwoFrameDom();
    const snap = buildSnapshot(doc);
    const editors = snap.elements.filter((e) => e.role === 'textbox');
    expect(editors.length).toBe(2);
    expect(editors[0].ref).not.toBe(editors[1].ref);
  });

  it('refMap 能分别解析到各自 frame 的元素', () => {
    const doc = buildTwoFrameDom();
    buildSnapshot(doc);
    const map = buildRefMap(doc);
    const snap = buildSnapshot(doc);
    const editors = snap.elements.filter((e) => e.role === 'textbox');
    const a = map.get(editors[0].ref)!;
    const b = map.get(editors[1].ref)!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
    expect(a.ownerDocument).not.toBe(b.ownerDocument);
  });
});