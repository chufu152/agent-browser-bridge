// UBA 自包含安装脚本（CDP 版）—— 解压后运行 `node setup.mjs`，全自动完成：
//   1) 生成/复用 Agent token 配置（~/.uba/agents.json）
//   2) 拉起带登录态的受控浏览器（复制 Cookies，调试端口，无需装扩展）
//   3) 启动桥接服务（CDP 南向 + WebSocket 北向 + 本地确认页）
//   4) 生成 MCP 配置并做连通自检
// 全程无注册表、无扩展安装、无需人工点击。

import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import crypto from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const WS_PORT = Number(process.env.UBA_WS_PORT ?? 3000);

function log(msg) {
  console.log(msg);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 1000 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

async function waitPort(port, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

log('== UBA 浏览器 Agent 安装（CDP 零安装版） ==');
log(`node 路径: ${NODE}`);

// 1) Agent token 配置
const agentsDir = join(homedir(), '.uba');
mkdirSync(agentsDir, { recursive: true });
const agentsFile = join(agentsDir, 'agents.json');
let token;
if (existsSync(agentsFile)) {
  token = JSON.parse(readFileSync(agentsFile, 'utf-8')).agents?.[0]?.token ?? '';
  log('✓ 复用已有 Agent 配置');
} else {
  token = crypto.randomBytes(32).toString('base64url');
  writeFileSync(agentsFile, JSON.stringify({ agents: [{ agentId: 'demo-agent', token }] }, null, 2), 'utf-8');
  log('✓ 生成 Agent 配置 + token');
}

// 2) 受控浏览器（幂等）
execFileSync(NODE, [join(root, 'uba-browser.mjs')], { stdio: 'inherit' });
log('✓ 受控浏览器就绪（CDP 9222）');

// 3) 桥接服务（已在运行则复用）
if (await portOpen(WS_PORT)) {
  log(`✓ 桥接服务已在 ws://127.0.0.1:${WS_PORT} 运行，复用`);
} else {
  const logFile = join(agentsDir, 'bridge.log');
  const out = openSync(logFile, 'a');
  const child = spawn(NODE, [join(root, 'bin', 'bridge.cjs')], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, UBA_ENGINE_FILE: join(root, 'bin', 'page-engine.js') }
  });
  child.unref();
  if (!(await waitPort(WS_PORT))) {
    log(`✗ 桥接服务未能在 20s 内监听 ${WS_PORT}，查看日志：${logFile}`);
    process.exit(1);
  }
  log(`✓ 桥接服务已启动 ws://127.0.0.1:${WS_PORT}（日志 ${logFile}）`);
}

// 4) MCP 配置
const mcpConfig = {
  mcpServers: {
    'uba-browser': {
      command: NODE,
      args: [join(root, 'bin', 'mcp-server.cjs')]
    }
  }
};
mkdirSync(join(root, 'mcp-config'), { recursive: true });
writeFileSync(join(root, 'mcp-config', 'claude-desktop.json'), JSON.stringify(mcpConfig, null, 2), 'utf-8');
writeFileSync(join(root, 'mcp-config', 'cursor-mcp.json'), JSON.stringify(mcpConfig, null, 2), 'utf-8');
writeFileSync(join(root, 'mcp-config', 'generic.json'), JSON.stringify(mcpConfig, null, 2), 'utf-8');
log('✓ 生成 MCP 配置（mcp-config/）');

// 5) 连通自检：认证 + 读标签页
try {
  execFileSync(NODE, [join(root, 'bin', 'smoke.cjs')], { stdio: 'inherit' });
} catch {
  log('✗ 自检失败：请确认受控浏览器窗口已打开，然后重跑 node setup.mjs');
  process.exit(1);
}

log('');
log('== 安装完成，无需任何手动步骤 ==');
log('把 mcp-config/generic.json 的内容接入你的 agent（或告诉 agent 读取该文件），');
log('即可用自然语言控制浏览器。高风险操作会在受控浏览器弹出确认页，由你批准。');