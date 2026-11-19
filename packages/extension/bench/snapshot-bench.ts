// 快照性能基准 — 在 jsdom 中重复执行 buildSnapshot，输出中位数 / P95 / 最大值。
// 说明：jsdom 无真实布局引擎，数值仅作受控基准的参考基线；真实浏览器 P95 需另行测量。
// 运行：npx tsx bench/snapshot-bench.ts

import { JSDOM } from 'jsdom';
import { buildSnapshot } from '../core/dom-engine/index';

const N = 50;

// 构造标准页面：50 个交互元素 + 100 个文本节点（jsdom 受控规模）
function buildHtml(): string {
  const parts: string[] = ['<html><body>'];
  for (let i = 0; i < 50; i++) {
    parts.push(`<button aria-label="按钮${i}">按钮${i}</button><input id="in${i}" placeholder="输入${i}" /><div><span>文本${i}</span></div>`);
  }
  for (let i = 0; i < 100; i++) {
    parts.push(`<div><p>段落${i}</p></div>`);
  }
  parts.push('</body></html>');
  return parts.join('');
}

const dom = new JSDOM(buildHtml(), { url: 'https://bench.local/', pretendToBeVisual: true });
const doc = dom.window.document;

// 注入 DOM 全局（生产代码在浏览器/jsdom 环境下运行；此处为独立 Node 基准补齐全局）
(globalThis as any).Document = dom.window.Document;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).Element = dom.window.Element;
(globalThis as any).HTMLElement = dom.window.HTMLElement;

// 预热 10 轮
for (let i = 0; i < 10; i++) buildSnapshot(doc);

const times: number[] = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const snap = buildSnapshot(doc);
  const t1 = performance.now();
  times.push(t1 - t0);
  if (i === 0) console.log(`elements=${snap.elements.length} truncated=${snap.truncated}`);
}

times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
const p95 = times[Math.floor(times.length * 0.95)];
const max = times[times.length - 1];

console.log(`\n样本数: ${N}`);
console.log(`中位数: ${median.toFixed(2)} ms`);
console.log(`P95:     ${p95.toFixed(2)} ms`);
console.log(`最大值:  ${max.toFixed(2)} ms`);
