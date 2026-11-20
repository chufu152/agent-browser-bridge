// 一键打包：编译桥接/MCP 服务为单文件 → 组装自包含 zip。
// 运行：node package-zip.mjs
// 产物：dist/uba-browser-agent.zip

import { build } from 'esbuild';
import { mkdirSync, copyFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const staging = join(root, 'dist', 'zip');
const zipOut = join(root, 'dist', 'uba-browser-agent.zip');

rmSync(staging, { recursive: true, force: true });

// 1) 编译单文件
const common = {
  bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  external: ['bufferutil', 'utf-8-validate'], banner: { js: '#!/usr/bin/env node' }, logLevel: 'info'
};
await build({ ...common, entryPoints: ['packages/bridge/src/cli.ts'], outfile: join(staging, 'bin', 'bridge.cjs') });
await build({ ...common, entryPoints: ['packages/mcp-server/src/index.ts'], outfile: join(staging, 'bin', 'mcp-server.cjs') });
await build({ ...common, entryPoints: ['packaging/smoke.mjs'], outfile: join(staging, 'bin', 'smoke.cjs') });
// 页面引擎：注入受控浏览器的 IIFE 脚本（与扩展同一套 DOM/Locator/Action 引擎）
await build({
  bundle: true, platform: 'browser', format: 'iife', target: 'chrome100',
  entryPoints: ['packages/extension/core/page-entry.ts'], outfile: join(staging, 'bin', 'page-engine.js'), logLevel: 'info'
});

// 2) 组装目录
mkdirSync(join(staging, 'bin'), { recursive: true });

// 复制打包源文件
for (const f of ['setup.mjs', 'setup.cmd', 'README.md']) {
  copyFileSync(join(root, 'packaging', f), join(staging, f));
}
copyFileSync(join(root, 'uba-browser.mjs'), join(staging, 'uba-browser.mjs'));

// 3) 压缩（优先用 PowerShell Compress-Archive，回退到 tar）
if (existsSync(zipOut)) rmSync(zipOut);
try {
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path "${join(staging, '*')}" -DestinationPath "${zipOut}" -Force`], { stdio: 'pipe' });
} catch {
  execFileSync('tar', ['-a', '-c', '-f', zipOut, '-C', staging, '.'], { stdio: 'pipe' });
}
const kb = (statSync(zipOut).size / 1024).toFixed(1);
console.log(`✓ 打包完成：${zipOut} (${kb} KB)`);
