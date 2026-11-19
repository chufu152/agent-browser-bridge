// UBA 自包含安装脚本 —— 解压后运行 `node setup.mjs` 即可自动完成：
//   1) 生成原生消息 host 启动器（用当前 node 完整路径）
//   2) 注册到 Chrome / Edge 注册表
//   3) 生成 Agent token 配置（~/.uba/agents.json）
//   4) 生成各 agent 的 MCP 配置文件
// 唯一需要手动的一步：在 edge://extensions 里「加载解压缩的扩展」选择 extension 文件夹。

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const HOST_NAME = 'com.uba.bridge';
const EXT_ID = 'ecpooakhjpoobkfjnkcjfmbnbdbnjhbh';
const NODE = process.execPath;

function log(msg) {
  console.log(msg);
}

log('== UBA 浏览器 Agent 安装 ==');
log(`node 路径: ${NODE}`);

// 1) 生成原生消息 host 启动器
const launcherPath = join(root, 'native-host.cmd');
writeFileSync(launcherPath, '@echo off\r\n"' + NODE + '" "' + join(root, 'bin', 'bridge.cjs') + '"\r\n', 'utf-8');
log('✓ 生成原生 host 启动器');

// 2) 生成原生消息 manifest
const manifestPath = join(root, 'com.uba.bridge.json');
const manifest = {
  name: HOST_NAME,
  description: 'Universal Browser Agent - local bridge',
  path: launcherPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${EXT_ID}/`]
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
log('✓ 生成原生 host manifest');

// 3) 注册到注册表（Chrome + Edge）
if (process.platform === 'win32') {
  const keys = [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`
  ];
  for (const key of keys) {
    try {
      execFileSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'pipe' });
      log(`✓ 已注册 ${key}`);
    } catch (e) {
      log(`✗ 注册失败 ${key}，请手动执行： reg add "${key}" /ve /t REG_SZ /d "${manifestPath}" /f`);
    }
  }
} else {
  const dirs = [join(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts'), join(homedir(), '.config', 'microsoft-edge', 'NativeMessagingHosts')];
  for (const d of dirs) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, `${HOST_NAME}.json`), JSON.stringify(manifest, null, 2), 'utf-8');
    log(`✓ 已写入 ${join(d, `${HOST_NAME}.json`)}`);
  }
}

// 4) 生成 Agent token 配置（已存在则不覆盖）
const agentsDir = join(homedir(), '.uba');
mkdirSync(agentsDir, { recursive: true });
const agentsFile = join(agentsDir, 'agents.json');
let token;
if (existsSync(agentsFile)) {
  token = JSON.parse(readFileSync(agentsFile, 'utf-8')).agents?.[0]?.token ?? '';
  log('✓ 已存在 Agent 配置，复用');
} else {
  token = crypto.randomBytes(32).toString('base64url');
  writeFileSync(agentsFile, JSON.stringify({ agents: [{ agentId: 'demo-agent', token }] }, null, 2), 'utf-8');
  log('✓ 生成 Agent 配置 + token');
}

// 5) 生成 MCP 配置文件（用当前 node 路径 + 本包内 mcp-server.cjs）
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
log('✓ 生成 MCP 配置（claude-desktop / cursor / generic）');

log('');
log('== 安装完成 ==');
log(`Agent token: ${token}`);
log('');
log('还差最后一步（需人工，无法自动化）：');
log('  1. 打开 edge://extensions，开启「开发人员模式」');
log(`  2. 「加载解压缩的扩展」→ 选择文件夹 ${join(root, 'extension')}`);
log('');
log('然后把 mcp-config 里的配置贴进你的 agent（Claude/Cursor/WorkBuddy），即可直接用自然语言控制浏览器。');
