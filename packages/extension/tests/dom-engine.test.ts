// M1 核心逻辑单元测试
// 直接 import ESM 引擎模块，验证元素提取、定位语义和风险识别。

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSnapshot } from '../core/dom-engine/index';
import { locate, find } from '../core/locator/index';
import { perform, isHighRiskText } from '../core/actions/index';

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildDom(htmlPath: string): { dom: JSDOM; doc: Document } {
  const html = readFileSync(htmlPath, 'utf-8');
  const dom = new JSDOM(html, {
    url: 'https://test.local/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  return { dom, doc: dom.window.document };
}

describe('DOM Engine - 元素提取', () => {
  it('提取搜索输入框（role=textbox，含 placeholder）', () => {
    const { doc } = buildDom(join(__dirname, 'pages/basic.html'));
    const snap = buildSnapshot(doc);
    const search = snap.elements.find((e) => e.tag === 'input' && e.placeholder === '请输入关键词');
    expect(search).toBeDefined();
    expect(search!.role).toBe('textbox');
  });

  it('提取按钮（role=button）', () => {
    const { doc } = buildDom(join(__dirname, 'pages/basic.html'));
    const snap = buildSnapshot(doc);
    const btn = snap.elements.find((e) => e.tag === 'button' && e.name === '搜索');
    expect(btn).toBeDefined();
    expect(btn!.role).toBe('button');
  });

  it('禁用按钮标记 disabled=true，隐藏按钮标记 visible=false', () => {
    const { doc } = buildDom(join(__dirname, 'pages/basic.html'));
    const snap = buildSnapshot(doc);
    const disabled = snap.elements.find((e) => e.name === '禁用按钮');
    expect(disabled!.disabled).toBe(true);
    const hidden = snap.elements.find((e) => e.tag === 'button' && e.name === '隐藏按钮');
    expect(hidden!.visible).toBe(false);
  });

  it('密码字段不进入快照', () => {
    const { doc } = buildDom(join(__dirname, 'pages/risk.html'));
    const snap = buildSnapshot(doc);
    const pwd = snap.elements.find((e) => e.type === 'password');
    expect(pwd).toBeUndefined();
  });
});

describe('Locator - 定位语义', () => {
  it('多匹配返回 AMBIGUOUS_LOCATOR', () => {
    const { doc } = buildDom(join(__dirname, 'pages/dynamic.html'));
    const res = locate({ role: 'button', name: '保存' }, doc, () => null);
    expect(res.ok).toBe(false);
    expect(res.errorType).toBe('AMBIGUOUS_LOCATOR');
    expect(res.ambiguous).toBe(true);
  });

  it('find 查询模式多匹配返回列表 + ambiguous', () => {
    const { doc } = buildDom(join(__dirname, 'pages/dynamic.html'));
    const res = find({ role: 'button', name: '保存' }, doc, () => null);
    expect(res.ok).toBe(true);
    expect(res.ambiguous).toBe(true);
    expect(res.elements!.length).toBe(3);
  });

  it('唯一角色+名称定位成功', () => {
    const { doc } = buildDom(join(__dirname, 'pages/basic.html'));
    const res = locate({ role: 'button', name: '搜索' }, doc, () => null);
    expect(res.ok).toBe(true);
  });

  it('不存在的元素返回 ELEMENT_NOT_FOUND', () => {
    const { doc } = buildDom(join(__dirname, 'pages/basic.html'));
    const res = locate({ role: 'button', name: '不存在的按钮' }, doc, () => null);
    expect(res.ok).toBe(false);
    expect(res.errorType).toBe('ELEMENT_NOT_FOUND');
  });
});

describe('Action Engine - 风险识别', () => {
  it('高风险文本被识别', () => {
    expect(isHighRiskText('确认支付')).toBe(true);
    expect(isHighRiskText('删除账号')).toBe(true);
    expect(isHighRiskText('发布内容')).toBe(true);
    expect(isHighRiskText('搜索')).toBe(false);
  });

  it('点击高风险按钮返回 CONFIRMATION_REQUIRED', () => {
    const { doc } = buildDom(join(__dirname, 'pages/risk.html'));
    const res = perform({ type: 'click', locator: { role: 'button', name: '删除账号' } }, doc, () => null);
    expect(res.ok).toBe(false);
    expect(res.errorType).toBe('CONFIRMATION_REQUIRED');
  });

  it('填写密码字段返回 PERMISSION_DENIED', () => {
    const { doc } = buildDom(join(__dirname, 'pages/risk.html'));
    const res = perform({ type: 'fill', locator: { role: 'textbox', name: '密码' }, value: 'secret' }, doc, () => null);
    expect(res.ok).toBe(false);
    expect(res.errorType).toBe('PERMISSION_DENIED');
  });
});
