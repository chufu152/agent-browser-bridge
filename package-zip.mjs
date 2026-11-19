// 一键打包：编译桥接/MCP 服务为单文件 → 组装自包含 zip。
// 运行：node package-zip.mjs
// 产物：dist/uba-browser-agent.zip

import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const staging = join(root, 'dist', 'zip');
const zipOut = join(root, 'dist', 'uba-browser-agent.zip');

// 1) 编译单文件
const common = {
  bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  external: ['bufferutil', 'utf-8-validate'], banner: { js: '#!/usr/bin/env node' }, logLevel: 'info'
};
await build({ ...common, entryPoints: ['packages/bridge/src/cli.ts'], outfile: join(staging, 'bin', 'bridge.cjs') });
await build({ ...common, entryPoints: ['packages/mcp-server/src/index.ts'], outfile: join(staging, 'bin', 'mcp-server.cjs') });

// 2) 组装目录
mkdirSync(join(staging, 'bin'), { recursive: true });
mkdirSync(join(staging, 'extension'), { recursive: true });

// 复制扩展构建产物
const extOut = join(root, 'packages', 'extension', '.output', 'chrome-mv3');
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name), d = join(dst, name);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}
copyDir(extOut, join(staging, 'extension'));

// 复制打包源文件
for (const f of ['setup.mjs', 'setup.cmd', 'README.md']) {
  copyFileSync(join(root, 'packaging', f), join(staging, f));
}

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
