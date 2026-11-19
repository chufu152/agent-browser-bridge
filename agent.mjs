// UBA 完整使用示例 Agent —— 真正控制浏览器：读取快照 → 定位搜索框 → 填入关键词 → 点击搜索。
// 用法：node agent.mjs [关键词]    （默认关键词「测试搜索」）

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import WebSocket from 'ws';

const ENDPOINT = process.env.UBA_ENDPOINT ?? 'ws://127.0.0.1:3000';
const KEYWORD = process.argv[2] ?? '测试搜索';

function loadConfig() {
  const file = process.env.UBA_AGENTS_FILE ?? join(homedir(), '.uba', 'agents.json');
  const raw = JSON.parse(readFileSync(file, 'utf-8'));
  return raw.agents[0];
}

function rpc(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off('message', onMsg);
        if (msg.error) {
          const e = new Error(`${msg.error.data?.errorType ?? 'ERROR'}: ${msg.error.message}`);
          e.errorType = msg.error.data?.errorType;
          e.data = msg.error.data;
          reject(e);
        } else resolve(msg.result);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

async function main() {
  const { agentId, token } = loadConfig();
  console.log('┌─ UBA Agent 开始 ───────────────────────────────');
  console.log(`│ 连接 ${ENDPOINT} ...`);

  const ws = new WebSocket(ENDPOINT);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0;
  const call = (method, params) => rpc(ws, ++id, method, params);

  // 1) 认证
  const conn = await call('browser.connect', { agentId, token, protocolVersion: '1.0' });
  const sessionId = conn.sessionId;
  console.log(`│ 认证成功 (session=${sessionId.slice(0, 12)}...)`);

  // 2) 活动标签页
  const active = await call('browser.getActiveTab', { sessionId });
  const tab = active?.tab ?? active?.tabs?.[0];
  const tabId = tab?.tabId ?? tab?.id;
  if (tabId === undefined) {
    console.log('│ ✗ 没有活动标签页，请先打开一个普通网页（如 bilibili.com）。');
    process.exit(1);
  }
  console.log(`│ 活动标签页: ${tab.title} (${tab.url})`);

  // 3) 快照
  const snap = await call('browser.getSnapshot', { sessionId, tabId });
  const els = snap.elements ?? [];
  console.log(`│ 快照: ${els.length} 个可交互元素`);

  // 4) 定位搜索框（语义定位：role=textbox，优先 placeholder 含「搜索」）
  const textboxes = els.filter((e) => e.role === 'textbox' && e.visible !== false);
  const searchBox =
    textboxes.find((e) => (e.placeholder || e.name || '').includes('搜索')) ?? textboxes[0];
  if (!searchBox) {
    console.log('│ ✗ 未找到搜索框，页面上的输入框如下：');
    for (const e of textboxes.slice(0, 5)) console.log(`│   - placeholder="${e.placeholder}" name="${e.name}"`);
    process.exit(1);
  }
  console.log(`│ 定位到搜索框: ref=${searchBox.ref} placeholder="${searchBox.placeholder}"`);

  // 5) 填入关键词（语义定位，不依赖 ref，开箱即用）
  const fillLocator = searchBox.placeholder
    ? { placeholder: searchBox.placeholder }
    : { role: 'textbox' };
  await call('locator.fill', { sessionId, tabId, operationId: 'op_fill_1', locator: fillLocator, value: KEYWORD });
  console.log(`│ 已填入关键词: "${KEYWORD}"`);

  // 6) 触发搜索：优先点按钮，否则在搜索框内按回车（B站搜索框回车即搜索）
  const searchBtn = els.find((e) => e.role === 'button' && (e.name || e.text || '').includes('搜索'));
  if (searchBtn) {
    const btnLocator = searchBtn.name
      ? { role: 'button', name: searchBtn.name }
      : { role: 'button', text: searchBtn.text };
    await call('locator.click', { sessionId, tabId, operationId: 'op_click_1', locator: btnLocator });
    console.log(`│ 已点击搜索按钮: "${searchBtn.name || searchBtn.text}"`);
  } else {
    await call('locator.press', { sessionId, tabId, operationId: 'op_press_1', locator: fillLocator, key: 'Enter' });
    console.log('│ 未找到搜索按钮，已在搜索框内按回车触发搜索');
  }

  console.log('└─ ✅ 完成！Agent 已成功控制浏览器。');
  ws.close();
}

main().catch((e) => {
  console.error('└─ ✗ 失败:', e.message, e.errorType ? `(${e.errorType})` : '');
  process.exit(1);
});
