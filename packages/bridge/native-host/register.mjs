// 原生消息 host 注册脚本（Windows：写入 HKCU 注册表；macOS/Linux：写入 config 目录）。
// 用法：node register.mjs <extension-id>
// 生成 manifest 时把占位符替换为真实绝对路径与扩展 ID，再写入系统。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST_NAME = 'com.uba.bridge';
const launcherPath = join(__dirname, 'run-bridge.cmd');

const extensionId = process.argv[2];
if (!extensionId) {
  console.error('用法：node register.mjs <extension-id>');
  console.error('扩展 ID 可在 chrome://extensions 页面查看（加载已解压扩展后）。');
  process.exit(1);
}

// 生成 manifest
const template = readFileSync(join(__dirname, 'com.uba.bridge.json'), 'utf-8');
const manifest = template
  .replace('__BRIDGE_PATH__', launcherPath.replace(/\\/g, '\\\\'))
  .replace('__EXTENSION_ID__', extensionId);

const platform = process.platform;

if (platform === 'win32') {
  // 写入 HKCU\Software\Google\Chrome\NativeMessagingHosts\com.uba.bridge
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  const manifestPath = join(__dirname, 'generated', `${HOST_NAME}.json`);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, manifest, 'utf-8');
  try {
    execFileSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'pipe' });
    console.log(`[ok] Chrome 原生 host 已注册：${key} -> ${manifestPath}`);
  } catch (e) {
    console.error('[warn] 写入注册表失败，请手动执行：');
    console.error(`  reg add "${key}" /ve /t REG_SZ /d "${manifestPath}" /f`);
    console.error('  或者从 chrome://extensions 重新加载插件后再试。');
  }
  console.log(`[info] manifest 已生成：${manifestPath}`);
} else {
  // macOS / Linux
  const targets = [
    join(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts'),
    join(homedir(), '.config', 'microsoft-edge', 'NativeMessagingHosts')
  ];
  for (const dir of targets) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${HOST_NAME}.json`), manifest, 'utf-8');
    console.log(`[ok] 已写入：${join(dir, `${HOST_NAME}.json`)}`);
  }
}

console.log('\n完成注册后：');
console.log('1. 重新加载扩展（chrome://extensions -> 重新加载）；');
console.log('2. 启动 bridge（或由浏览器经原生消息自动拉起）；');
console.log('3. 用 Agent 连接 ws://127.0.0.1:3000 并发送 browser.connect。');
