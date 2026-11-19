// UBA 演示 Agent — 端到端验证：连接桥接服务 → 认证 → 读取活动标签页快照。
// 用法：node demo-agent.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import WebSocket from 'ws';

const ENDPOINT = process.env.UBA_ENDPOINT ?? 'ws://127.0.0.1:3000';

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
        if (msg.error) reject(new Error(`${msg.error.data?.errorType ?? 'ERROR'}: ${msg.error.message}`));
        else resolve(msg.result);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

async function main() {
  const { agentId, token } = loadConfig();
  console.log(`[demo-agent] 连接 ${ENDPOINT}（agentId=${agentId}）...`);

  const ws = new WebSocket(ENDPOINT);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  let id = 0;
  const call = (method, params) => rpc(ws, ++id, method, params);

  // 1) 认证
  const conn = await call('browser.connect', { agentId, token, protocolVersion: '1.0' });
  console.log('[demo-agent] 认证成功，sessionId=', conn.sessionId);

  const sessionId = conn.sessionId;

  // 2) 获取活动标签页
  const active = await call('browser.getActiveTab', { sessionId });
  const tab = active?.tab ?? active?.tabs?.[0];
  const tabId = tab?.tabId ?? tab?.id;
  console.log('[demo-agent] 活动标签页:', JSON.stringify(tab));

  if (tabId === undefined) {
    console.log('[demo-agent] 未找到活动标签页，请先打开一个普通网页。');
    process.exit(0);
  }

  // 3) 获取快照
  const snap = await call('browser.getSnapshot', { sessionId, tabId });
  console.log('\n=== 页面快照 ===');
  console.log('URL     :', snap.url);
  console.log('标题    :', snap.title);
  console.log('版本    :', snap.snapshotVersion);
  console.log('元素数  :', snap.elements?.length, snap.truncated ? '（已截断）' : '');
  console.log('\n前 10 个可交互元素：');
  for (const el of snap.elements.slice(0, 10)) {
    console.log(`  [${el.role}] ref=${el.ref} name="${el.name}" text="${(el.text || '').slice(0, 30)}"`);
  }

  ws.close();
  console.log('\n[demo-agent] ✅ 端到端链路验证通过');
}

main().catch((e) => {
  console.error('[demo-agent] 失败:', e.message);
  process.exit(1);
});
