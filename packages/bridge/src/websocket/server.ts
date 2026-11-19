// WebSocket 服务 — 桥接服务北向，供外部 Agent 连接（M3：支持事件实时推送）。
// 安全：默认只监听 127.0.0.1；每个连接独立上下文；断连即撤销会话与订阅。

import { WebSocketServer, WebSocket } from 'ws';
import type { JsonRpcRouter } from '../router/index';
import type { SessionManager } from '../session/index';
import type { AuditLog } from '../audit/index';
import type { EventBus } from '../events/index';

export interface WebSocketServerOptions {
  host: string;
  port: number;
  router: JsonRpcRouter;
  sessions: SessionManager;
  audit: AuditLog;
  events: EventBus;
}

export interface WebSocketServerHandle {
  server: WebSocketServer;
  /** 向某会话推送 JSON-RPC 通知（实时事件） */
  pushToSession(sessionId: string, payload: unknown): boolean;
}

export function createWebSocketServer(opts: WebSocketServerOptions): WebSocketServerHandle {
  const wss = new WebSocketServer({ host: opts.host, port: opts.port });
  const sessionWs = new Map<string, WebSocket>();

  wss.on('connection', (ws: WebSocket) => {
    const ctx: { sessionId: string | null; agentId: string | null } = { sessionId: null, agentId: null };

    ws.on('message', async (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }

      const response = await opts.router.handle(raw);

      if (response.result && typeof response.result === 'object') {
        const r = response.result as Record<string, unknown>;
        if (typeof r.sessionId === 'string') {
          ctx.sessionId = r.sessionId;
          ctx.agentId = (raw as any)?.params?.agentId ?? null;
          sessionWs.set(ctx.sessionId, ws);
        }
      }

      ws.send(JSON.stringify(response));
    });

    ws.on('close', () => {
      if (ctx.sessionId) {
        sessionWs.delete(ctx.sessionId);
        opts.sessions.revoke(ctx.sessionId);
        opts.events.revokeSession(ctx.sessionId);
        opts.audit.record({
          ts: new Date().toISOString(), agentId: ctx.agentId ?? 'unknown', sessionId: ctx.sessionId,
          method: 'session.closed', risk: 'normal', outcome: 'ok'
        });
      }
    });

    ws.on('error', () => {});
  });

  return {
    server: wss,
    pushToSession(sessionId: string, payload: unknown): boolean {
      const ws = sessionWs.get(sessionId);
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(payload));
      return true;
    }
  };
}
