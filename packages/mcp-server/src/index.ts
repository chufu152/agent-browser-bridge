// MCP Server — 标准工具接入（stdio，JSON-RPC over 换行分隔 JSON）。
// 将浏览器能力暴露为 MCP Tools，内部通过 @uba/sdk-typescript 调用 BCP（经桥接服务）。
//
// 配置优先级：环境变量 > ~/.uba/agents.json（由一键脚本自动生成）。
//   UBA_ENDPOINT  桥接服务 WebSocket 地址（默认 ws://127.0.0.1:3000）
//   UBA_AGENT_ID  Agent 身份（默认取配置文件的第一个 agent）
//   UBA_TOKEN     访问 token（默认取配置文件的第一个 agent）

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { BrowserClient, UbaError } from '@uba/sdk-typescript';
import { TOOLS, dispatchTool } from './tools';

const PROTOCOL_VERSION = '2024-11-05';

function loadConfig(): { agentId: string; token: string } | null {
  try {
    const file = join(homedir(), '.uba', 'agents.json');
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const first = raw?.agents?.[0];
    if (first?.agentId && first?.token) return { agentId: first.agentId, token: first.token };
  } catch {
    /* 忽略 */
  }
  return null;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const endpoint = process.env.UBA_ENDPOINT ?? 'ws://127.0.0.1:3000';
  const agentId = process.env.UBA_AGENT_ID ?? cfg?.agentId ?? 'demo-agent';
  const token = process.env.UBA_TOKEN ?? cfg?.token ?? '';

  const client = new BrowserClient({ endpoint, agentId, token });

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const write = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + '\n');

  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }

    const id = msg.id ?? null;
    const method = msg.method as string | undefined;

    if (method === 'initialize') {
      write({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'universal-browser-agent-mcp', version: '0.1.0' }
        }
      });
      continue;
    }

    if (method === 'tools/list') {
      write({
        jsonrpc: '2.0', id,
        result: {
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
        }
      });
      continue;
    }

    if (method === 'tools/call') {
      const params = msg.params ?? {};
      const toolName = params.name as string;
      const args = (params.arguments ?? {}) as Record<string, any>;
      try {
        if (!client.session) {
          await client.connect();
        }
        const result = await dispatchTool(client, toolName, args);
        write({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
        });
      } catch (e) {
        const ubaErr = e instanceof UbaError
          ? e
          : new UbaError(-32603, 'INTERNAL_ERROR', String(e));
        // 返回 isError=true 的结构化错误，而非抛异常
        write({
          jsonrpc: '2.0', id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ errorType: ubaErr.errorType, message: ubaErr.message, data: ubaErr.data }) }],
            isError: true
          }
        });
      }
      continue;
    }

    if (method === 'notifications/initialized' || method === 'ping') {
      // 无需响应
      if (method === 'ping') write({ jsonrpc: '2.0', id, result: {} });
      continue;
    }

    write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }
}

main().catch((e) => {
  console.error('[uba-mcp] fatal', e);
  process.exit(1);
});
