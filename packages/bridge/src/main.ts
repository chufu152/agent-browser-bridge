// Bridge 主入口 — 组装认证、会话、去重、审计、确认、事件、路由、WebSocket 与 Native Messaging。

import { TokenManager } from './auth/index';
import { SessionManager } from './session/index';
import { OperationStore } from './dedup/index';
import { AuditLog } from './audit/index';
import { ConfirmationManager } from './confirm/index';
import { EventBus } from './events/index';
import { JsonRpcRouter } from './router/index';
import { NativeMessagingTransport } from './native-messaging/index';
import { createWebSocketServer, type WebSocketServerHandle } from './websocket/server';
import type { ExtensionTransport } from './transport/index';
import type { EventEnvelope } from './events/index';

export interface Bridge {
  tokens: TokenManager;
  sessions: SessionManager;
  operations: OperationStore;
  audit: AuditLog;
  confirmations: ConfirmationManager;
  events: EventBus;
  router: JsonRpcRouter;
  setTransport(t: ExtensionTransport | null): void;
  getTransport(): ExtensionTransport | null;
  /** 本地管理员确认（仅本地界面/插件可调用，不经 Agent 路由） */
  approveConfirmation(confirmationId: string, approved: boolean): boolean;
  /** 关闭 WebSocket 服务（测试用） */
  close(): void;
}

export function createBridge(): Bridge {
  const tokens = new TokenManager();
  const sessions = new SessionManager();
  const operations = new OperationStore();
  const audit = new AuditLog();
  const confirmations = new ConfirmationManager();
  const events = new EventBus();

  let transport: ExtensionTransport | null = null;

  const router = new JsonRpcRouter({
    tokens, sessions, operations, audit, confirmations, events,
    getTransport: () => transport
  });

  return {
    tokens, sessions, operations, audit, confirmations, events, router,
    setTransport(t) { transport = t; },
    getTransport() { return transport; },
    approveConfirmation(id, approved) { return router.adminResolveConfirmation(id, approved); },
    close() { /* no-op（无独立 WS 句柄时） */ }
  };
}

export function startBridge(opts: { host?: string; port?: number; verbose?: boolean } = {}): Bridge {
  const bridge = createBridge();
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env.UBA_WS_PORT ?? 3000);

  // 南向：Native Messaging
  const nm = new NativeMessagingTransport();
  nm.onDisconnect(() => bridge.setTransport(null));
  bridge.setTransport(nm);

  // 本地管理员接口（扩展 popup 经原生消息调用，Agent 路由不可达）
  nm.setAdminHandler((msg: any) => {
    switch (msg.action) {
      case 'listConfirmations':
        return bridge.confirmations.listPending().map((c) => ({
          confirmationId: c.confirmationId,
          operationId: c.operationId,
          method: c.method,
          riskSummary: c.riskSummary,
          createdAt: c.createdAt,
          expiresAt: c.expiresAt
        }));
      case 'approve':
        return { ok: bridge.approveConfirmation(msg.confirmationId, true) };
      case 'deny':
        return { ok: bridge.approveConfirmation(msg.confirmationId, false) };
      case 'listAudit':
        return bridge.audit.list();
      default:
        return { ok: false, error: 'unknown admin action' };
    }
  });

  // 北向：WebSocket
  const handle: WebSocketServerHandle = createWebSocketServer({
    host, port, router: bridge.router, sessions: bridge.sessions, audit: bridge.audit, events: bridge.events
  });

  // 事件实时推送：按订阅过滤
  bridge.events.onEmit((event: EventEnvelope) => {
    for (const sub of bridge.events.subscriptionsForSession(event.sessionId)) {
      if (bridge.events.matchesSubscription(sub, event)) {
        handle.pushToSession(event.sessionId, { jsonrpc: '2.0', method: event.data.eventType, params: event });
      }
    }
  });

  // 注意：日志一律走 stderr（console.error），stdout 只用于原生消息协议帧，
  // 否则被浏览器作为原生消息 host 拉起时，stdout 混入日志会污染协议导致断管。
  if (opts.verbose !== false) {
    console.error(`[uba-bridge] WebSocket listening on ws://${host}:${port}`);
    console.error('[uba-bridge] Native messaging channel on stdin/stdout');
    console.error('[uba-bridge] registered agents:', bridge.tokens.listAgents().join(', ') || '(none)');
  }

  handle.server.on('error', (e) => console.error('[uba-bridge] websocket error', e));

  // 覆盖 close 以关闭 WS
  const origClose = bridge.close;
  bridge.close = () => {
    handle.server.close();
    origClose();
  };

  return bridge;
}
