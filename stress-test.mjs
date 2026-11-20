// UBA 实战压测 — 在真实受控浏览器里跑满 100 题复刻作业页：
// 70 组选择/判断 radio 点击 + 30 个 UEditor 式 iframe contenteditable 填写，
// 全部经 BCP 桥接 → CDP → 页面引擎；读回验证 + 性能统计 + 高风险确认红线验证。
// 用法：node stress-test.mjs

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.UBA_ENDPOINT ?? 'ws://127.0.0.1:3000';
const PAGE_PORT = 8090;

const { agentId, token } = JSON.parse(readFileSync(join(homedir(), '.uba', 'agents.json'), 'utf-8')).agents[0];

// 本地静态服务（复刻页）
const server = createServer((req, res) => {
  const file = join(root, 'test-pages', 'xuexitong-replica.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PAGE_PORT, '127.0.0.1', r));

const ws = new WebSocket(ENDPOINT);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
let seq = 0;
const latencies = [];
let rateLimitedRetries = 0;

function rpc(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== id) return;
      ws.off('message', onMsg);
      if (msg.error) {
        const e = new Error(msg.error.message);
        e.errorType = msg.error.data?.errorType;
        e.data = msg.error.data;
        reject(e);
      } else resolve(msg.result);
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

async function call(method, params, opId) {
  const start = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await rpc(method, { ...params, operationId: opId });
      latencies.push(Date.now() - start);
      return result;
    } catch (e) {
      if (e.errorType === 'RATE_LIMITED' && attempt < 10) {
        rateLimitedRetries++;
        await new Promise((r) => setTimeout(r, (e.data?.retryAfterMs ?? 50) + 10));
        continue;
      }
      throw e;
    }
  }
}

const run = Date.now();
const conn = await rpc('browser.connect', { agentId, token, protocolVersion: '1.0' });
const sessionId = conn.sessionId;
console.log(`✓ 认证成功 session=${sessionId.slice(0, 12)}...`);

const created = await rpc('browser.createTab', {
  sessionId,
  operationId: `stress_tab_${run}`,
  url: `http://127.0.0.1:${PAGE_PORT}/?courseId=1&workId=2&answerId=3`
});
const tabId = created.tab.tabId;
console.log(`✓ 打开复刻页 tabId=${tabId}`);

// 等待页面渲染完成（100 题全部生成）
let snap;
for (let i = 0; i < 60; i++) {
  snap = await rpc('browser.getSnapshot', { sessionId, tabId });
  if ((snap.elements ?? []).length >= 250) break;
  await new Promise((r) => setTimeout(r, 300));
}
const els = snap.elements ?? [];
const editors = els.filter((e) => e.role === 'textbox' && e.tag === 'p');
console.log(`✓ 快照 ${els.length} 元素，其中 iframe 内编辑器 ${editors.length} 个`);
if (editors.length !== 30) {
  console.error(`✗ 编辑器数量异常：期望 30，实际 ${editors.length}`);
  process.exit(1);
}

// 1–70：选择/判断 radio
let failures = 0;
for (let n = 1; n <= 70; n++) {
  const value = n <= 40 ? ['A', 'B', 'C', 'D'][n % 4] : n % 2 ? 'T' : 'F';
  try {
    const res = await call('locator.click', {
      sessionId, tabId, locator: { selector: `input[name="q${n}"][value="${value}"]` }
    }, `stress_click_${run}_${n}`);
    if (res?.ok === false) { failures++; console.error(`✗ q${n}:`, res.errorType, res.error); }
  } catch (e) { failures++; console.error(`✗ q${n}:`, e.errorType, e.message); }
}
console.log(`✓ 选择/判断 70 题点击完成（失败 ${failures}）`);

// 71–100：iframe contenteditable 填写
const answers = [];
for (let i = 0; i < 30; i++) {
  const value = `第 ${71 + i} 题测试答案：SELECT 语句用于查询数据，WHERE 子句用于过滤条件，JOIN 用于多表关联。`;
  answers.push(value);
  try {
    const res = await call('locator.fill', {
      sessionId, tabId, locator: { ref: editors[i].ref }, value
    }, `stress_fill_${run}_${i}`);
    if (res?.ok === false || res?.result?.verified === false) {
      failures++; console.error(`✗ 简答${i + 1}:`, JSON.stringify(res).slice(0, 200));
    }
  } catch (e) { failures++; console.error(`✗ 简答${i + 1}:`, e.errorType, e.message); }
}
console.log(`✓ 简答 30 题填写完成（累计失败 ${failures}）`);

// 读回验证：页面自检 + 抽查编辑器全文
await call('locator.click', { sessionId, tabId, locator: { role: 'button', name: '自检' } }, `stress_selfcheck_${run}`);
const check = await rpc('browser.getText', { sessionId, tabId, selector: '#selfcheck-result' });
console.log('✓ 页面自检读回:', check.text);
const readBack = await rpc('browser.getText', { sessionId, tabId, ref: editors[0].ref });
const readOk = readBack.text === answers[0];
console.log(`✓ 编辑器全文读回${readOk ? '一致' : '不一致'}（${readBack.length} 字符）`);

// 高风险红线：点击「提交作业」必须被拦截，且 agent 无法自确认
let redlineOk = false;
try {
  await call('locator.click', { sessionId, tabId, locator: { role: 'button', name: '提交作业' } }, `stress_submit_${run}`);
  console.error('✗ 红线失效：高风险点击未被拦截！');
} catch (e) {
  if (e.errorType === 'CONFIRMATION_REQUIRED' && e.data?.confirmationId) {
    const cid = e.data.confirmationId;
    const list = await (await fetch('http://127.0.0.1:3001/api/confirmations')).json();
    const present = list.some((c) => c.confirmationId === cid);
    // 模拟用户在确认页拒绝
    await fetch('http://127.0.0.1:3001/api/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationId: cid, approved: false })
    });
    let denied = false;
    try {
      await rpc('locator.click', { sessionId, tabId, locator: { role: 'button', name: '提交作业' }, confirmationId: cid, operationId: `stress_submit_${run}` });
    } catch (e2) { denied = e2.errorType === 'CONFIRMATION_DENIED'; }
    redlineOk = present && denied;
    console.log(`✓ 高风险拦截：CONFIRMATION_REQUIRED，确认页可见=${present}，拒绝后重提=${denied ? 'CONFIRMATION_DENIED' : '异常'}`);
  } else {
    console.error('✗ 红线异常:', e.errorType, e.message);
  }
}

// 统计
latencies.sort((a, b) => a - b);
const p = (q) => latencies[Math.floor(latencies.length * q)] ?? 0;
const total = ((Date.now() - run) / 1000).toFixed(1);
console.log('');
console.log(`== 压测结果 ==`);
console.log(`操作数: ${latencies.length}  失败: ${failures}  限流重试: ${rateLimitedRetries}`);
console.log(`延迟 P50=${p(0.5)}ms  P95=${p(0.95)}ms  max=${latencies[latencies.length - 1]}ms`);
console.log(`总耗时: ${total}s`);
console.log(`判定: ${failures === 0 && check.text.includes('100/100') && readOk && redlineOk ? '✅ 全部通过' : '❌ 存在失败'}`);

server.close();
ws.close();
process.exit(failures === 0 && check.text.includes('100/100') && readOk && redlineOk ? 0 : 1);