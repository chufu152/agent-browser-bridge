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
  // 1) 桥接服务（含 WebSocket + 原生消息）
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
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
