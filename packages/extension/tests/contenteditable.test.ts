// contenteditable 富文本填写回归测试 —
// 修复前：fill 只写 .value JS 属性，页面无变化但 verified 误报 true。

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { perform } from '../core/actions/index';

function buildDom(): Document {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<div id="editor" contenteditable="true"><p>原有内容</p></div>' +
      '<input id="plain" type="text" />' +
      '</body></html>',
    { url: 'https://test.local/', pretendToBeVisual: true }
  );
  const doc = dom.window.document;
  // jsdom 未实现 isContentEditable，按 contenteditable 属性补齐（真实浏览器原生支持）
  const editor = doc.getElementById('editor')!;
  Object.defineProperty(editor, 'isContentEditable', { value: true });
  return doc;
}

describe('contenteditable 填写', () => {
  it('fill 真实改写文本内容并 verified=true', () => {
    const doc = buildDom();
    const editor = doc.getElementById('editor')!;
    const res = perform({ type: 'fill', locator: { selector: '#editor' }, value: '新答案' }, doc, () => null);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(editor.textContent).toBe('新答案');
  });

  it('fill 派发 input 事件（编辑器框架依赖）', () => {
    const doc = buildDom();
    const editor = doc.getElementById('editor')!;
    let fired = false;
    editor.addEventListener('input', () => { fired = true; });
    perform({ type: 'fill', locator: { selector: '#editor' }, value: 'x' }, doc, () => null);
    expect(fired).toBe(true);
  });

  it('clear 清空内容并 verified=true', () => {
    const doc = buildDom();
    const editor = doc.getElementById('editor')!;
    const res = perform({ type: 'clear', locator: { selector: '#editor' } }, doc, () => null);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(editor.textContent).toBe('');
  });

  it('普通 input 填写路径不受影响', () => {
    const doc = buildDom();
    const input = doc.getElementById('plain') as HTMLInputElement;
    const res = perform({ type: 'fill', locator: { selector: '#plain' }, value: 'hello' }, doc, () => null);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(input.value).toBe('hello');
  });
});