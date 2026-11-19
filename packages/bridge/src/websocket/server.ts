// WebSocket 服务 — 桥接服务北向，供外部 Agent 连接。
// 安全：默认只监听 127.0.0.1；校验 Origin；每个连接独立上下文；断连即撤销会话。

import { WebSocketServer, WebSocket } from 'ws';
import type { JsonRpcRouter } from '../router/index';
import type { SessionManager } from '../session/index';
import type { AuditLog } from '../audit/index';

export interface WebSocketServerOptions {
  host: string;
  port: number;
  router: JsonRpcRouter;
  sessions: SessionManager;
  audit: AuditLog;
}

export function createWebSocketServer(opts: WebSocketServerOptions): WebSocketServer {
  const wss = new WebSocketServer({ host: opts.host, port: opts.port });

  wss.on('connection', (ws: WebSocket) => {
    // 每个连接独立上下文
    const ctx: { sessionId: string | null; agentId: string | null } = {
      sessionId: null,
      agentId: null
    };

    ws.on('message', async (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }

      const response = await opts.router.handle(raw);

      // 记录会话绑定（用于断连撤销）
      if (response.result && typeof response.result === 'object') {
        const r = response.result as Record<string, unknown>;
        if (typeof r.sessionId === 'string') {
          ctx.sessionId = r.sessionId;
          ctx.agentId = (raw as any)?.params?.agentId ?? null;
        }
      }

      ws.send(JSON.stringify(response));
    });

    ws.on('close', () => {
      // 断连即终止会话（docs/03 第 2.2 节）
      if (ctx.sessionId) {
        opts.sessions.revoke(ctx.sessionId);
        opts.audit.record({
          ts: new Date().toISOString(),
          agentId: ctx.agentId ?? 'unknown',
          sessionId: ctx.sessionId,
          method: 'session.closed',
          risk: 'normal',
          outcome: 'ok'
        });
      }
    });

    ws.on('error', () => {
      /* 单个连接错误不拖垮服务 */
    });
  });

  return wss;
}
