// 会话管理 — 会话绑定 Agent、过期时间与连接生命周期。
// 断连即终止会话（见 docs/03-接口文档.md 第 2.2 节），重连须重新认证建立新会话。

import { randomBytes } from 'node:crypto';

export interface Session {
  sessionId: string;
  agentId: string;
  createdAt: number;
  expiresAt: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor(private readonly ttlMs: number = 30 * 60 * 1000) {}

  create(agentId: string): Session {
    const sessionId = 'ses_' + randomBytes(16).toString('hex');
    const now = Date.now();
    const session: Session = { sessionId, agentId, createdAt: now, expiresAt: now + this.ttlMs };
    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId: string): Session | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    return s;
  }

  revoke(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /** 撤销某 Agent 的全部会话（令牌撤销时使用） */
  revokeAllForAgent(agentId: string): void {
    for (const [id, s] of this.sessions) {
      if (s.agentId === agentId) this.sessions.delete(id);
    }
  }

  size(): number {
    return this.sessions.size;
  }
}
