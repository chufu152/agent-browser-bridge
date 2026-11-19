#!/usr/bin/env node
// UBA 一键启用：注册原生消息 host（扩展会自动重连，无需手动重载）。
// 用法：node start.mjs [扩展ID]
//   扩展 ID 可省略：优先读 uba-extension-id.txt，否则用内置默认值。

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const configFile = join(root, 'uba-extension-id.txt');
// 扩展已用固定 key，ID 恒为该值（见 packages/extension/wxt.config.ts）
const DEFAULT_ID = 'ecpooakhjpoobkfjnkcjfmbnbdbnjhbh';

// 解析扩展 ID：命令行参数 > 配置文件 > 默认值
let extId = process.argv[2];
if (!extId) {
  extId = existsSync(configFile) ? readFileSync(configFile, 'utf-8').trim() : DEFAULT_ID;
}
if (!/^[a-p]{32}$/.test(extId)) {
  console.error('扩展 ID 格式不对（应为 32 位小写 a-p 字母）。请从 edge://extensions 插件卡片上复制。');
  process.exit(1);
}

// 保存扩展 ID，下次可直接双击运行
writeFileSync(configFile, extId, 'utf-8');

console.log('== UBA 一键启用 ==');
console.log(`扩展 ID : ${extId}`);
console.log('注册原生消息 host（Chrome + Edge）...\n');

const registerPath = join(root, 'packages', 'bridge', 'native-host', 'register.mjs');
// 用当前 node 的完整路径（process.execPath），避免再次依赖 PATH
const r = spawnSync(process.execPath, [registerPath, extId], { stdio: 'inherit', shell: false });

if (r.status !== 0) {
  console.error('\n注册失败，请检查上面的错误信息。');
  process.exit(1);
}

console.log('\n✅ 完成！插件会在 12 秒内自动连接，无需手动重载。');
console.log('之后打开任意普通网页，点插件图标，面板显示「当前页已注入」即表示整条链路已通。');
console.log('（如需查看桥接服务日志：npm run start -w packages/bridge）');
