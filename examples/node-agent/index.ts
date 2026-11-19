// 示例 Node Agent — 演示用 SDK 完成“读取快照 + 填写 + 点击”任务。

import { BrowserClient } from '@uba/sdk-typescript';

async function main(): Promise<void> {
  const client = new BrowserClient({
    endpoint: process.env.UBA_ENDPOINT ?? 'ws://127.0.0.1:3000',
    agentId: process.env.UBA_AGENT_ID ?? 'node-agent',
    token: process.env.UBA_TOKEN ?? ''
  });

  await client.connect();
  console.log('[node-agent] connected, session=', client.session);

  // 1. 获取快照
  const tabId = 1;
  const snapshot = await client.getSnapshot(tabId);
  console.log(`[node-agent] page=${snapshot.title} elements=${snapshot.elements.length}`);

  // 2. 填写搜索框
  await client.fill(tabId, { role: 'textbox', name: '搜索' }, '示例关键词');
  console.log('[node-agent] filled search box');

  // 3. 点击搜索按钮（普通操作）
  await client.click(tabId, { role: 'button', name: '搜索' });
  console.log('[node-agent] clicked search button');

  await client.close();
}

main().catch((e) => {
  console.error('[node-agent] error:', e);
  process.exit(1);
});
