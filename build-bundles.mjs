// 把桥接服务与 MCP 服务编译成单文件（无 node_modules 依赖），供自包含 zip 分发。
// 运行：node build-bundles.mjs

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist/bin', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs', // ws 内部用 require，必须用 CommonJS 输出
  target: 'node18',
  external: ['bufferutil', 'utf-8-validate'], // ws 的可选原生依赖
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info'
};

async function run() {
  // 1) 桥接服务（WebSocket 北向 + CDP 南向）
  await build({
    ...common,
    entryPoints: ['packages/bridge/src/cli.ts'],
    outfile: 'dist/bin/bridge.cjs'
  });
  console.log('✓ dist/bin/bridge.cjs');

  // 2) MCP 服务（含 SDK + WebSocket）
  await build({
    ...common,
    entryPoints: ['packages/mcp-server/src/index.ts'],
    outfile: 'dist/bin/mcp-server.cjs'
  });
  console.log('✓ dist/bin/mcp-server.cjs');

  // 3) 连通自检
  await build({
    ...common,
    entryPoints: ['packaging/smoke.mjs'],
    outfile: 'dist/bin/smoke.cjs'
  });
  console.log('✓ dist/bin/smoke.cjs');

  // 4) 页面引擎（注入受控浏览器的 IIFE 脚本）
  await build({
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome100',
    entryPoints: ['packages/extension/core/page-entry.ts'],
    outfile: 'dist/bin/page-engine.js',
    logLevel: 'info'
  });
  console.log('✓ dist/bin/page-engine.js');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
