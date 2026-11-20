// 连通自检（打包为 bin/smoke.cjs，zip 环境无 node_modules 也可运行）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import WebSocket from 'ws';

const port = Number(process.env.UBA_WS_PORT ?? 3000);
const { agentId, token } = JSON.parse(readFileSync(join(homedir(), '.uba', 'agents.json'), 'utf-8')).agents[0];

const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const timer = setTimeout(() => { console.error('✗ 自检超时'); ws.terminate(); process.exit(1); }, 8000);

ws.on('open', () => {
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'browser.connect', params: { agentId, token, protocolVersion: '1.0' } }));
});
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id === 1) {
    if (msg.error) { console.error('✗ 认证失败:', msg.error.message); process.exit(1); }
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'browser.getTabs', params: { sessionId: msg.result.sessionId } }));
  }
  if (msg.id === 2) {
    clearTimeout(timer);
    if (msg.error) { console.error('✗ getTabs 失败:', msg.error.message); process.exit(1); }
    console.log(`✓ 自检通过：认证成功，受控浏览器 ${msg.result?.tabs?.length ?? 0} 个标签页`);
    ws.close();
    process.exit(0);
  }
});
ws.on('error', (e) => { clearTimeout(timer); console.error('✗ 无法连接桥接:', e.message); process.exit(1); });