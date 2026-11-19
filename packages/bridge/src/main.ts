// Bridge 主入口 — 组装认证、会话、去重、审计、路由、WebSocket 与 Native Messaging。
// 运行方式：作为 Native Messaging host 由浏览器启动（stdin/stdout 即南向通道），
// 同时启动北向 WebSocket 服务供 Agent 连接。

import { TokenManager } from './auth/index';
import { SessionManager } from './session/index';
import { OperationStore } from './dedup/index';
import { AuditLog } from './audit/index';
import { JsonRpcRouter } from './router/index';
import { NativeMessagingTransport } from './native-messaging/index';
import { createWebSocketServer } from './websocket/server';
import type { ExtensionTransport } from './transport/index';

export interface Bridge {
  tokens: TokenManager;
  sessions: SessionManager;
  operations: OperationStore;
  audit: AuditLog;
  router: JsonRpcRouter;
  setTransport(t: ExtensionTransport | null): void;
  getTransport(): ExtensionTransport | null;
}

export function createBridge(): Bridge {
  const tokens = new TokenManager();
  const sessions = new SessionManager();
  const operations = new OperationStore();
  const audit = new AuditLog();

  let transport: ExtensionTransport | null = null;

  const router = new JsonRpcRouter({
    tokens,
    sessions,
    operations,
    audit,
    getTransport: () => transport
  });

  return {
    tokens,
    sessions,
    operations,
    audit,
    router,
    setTransport(t) {
      transport = t;
    },
    getTransport() {
      return transport;
    }
  };
}

export function startBridge(opts: { host?: string; port?: number; verbose?: boolean } = {}): Bridge {
  const bridge = createBridge();
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env.UBA_WS_PORT ?? 3000);

  // 南向：Native Messaging（浏览器启动本进程时连接）
  const nm = new NativeMessagingTransport();
  nm.onDisconnect(() => bridge.setTransport(null));
  bridge.setTransport(nm);

  // 北向：WebSocket 服务
  const wss = createWebSocketServer({ host, port, router: bridge.router, sessions: bridge.sessions, audit: bridge.audit });

  if (opts.verbose !== false) {
    console.log(`[uba-bridge] WebSocket listening on ws://${host}:${port}`);
    console.log('[uba-bridge] Native messaging channel on stdin/stdout');
    console.log('[uba-bridge] registered agents:', bridge.tokens.listAgents().join(', ') || '(none)');
  }

  wss.on('error', (e) => {
    console.error('[uba-bridge] websocket error', e);
  });

  return bridge;
}

// 直接以 `node`/`tsx` 启动时运行
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  startBridge();
}
