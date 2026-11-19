// Token 认证 — 生成随机 token，只存 SHA-256 哈希，验证用 timingSafeEqual 防时序攻击。
// 凭据撤销后即时失效；认证失败不泄露 Agent 是否存在等多余信息。

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

interface AgentCredential {
  agentId: string;
  tokenHash: string;
  createdAt: number;
}

export class TokenManager {
  private byAgent = new Map<string, AgentCredential>();
  private byHash = new Map<string, string>(); // tokenHash -> agentId

  /** 为 Agent 签发 token（只返回一次原始值，系统只存哈希） */
  issue(agentId: string): string {
    const raw = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(raw);
    this.byAgent.set(agentId, { agentId, tokenHash, createdAt: Date.now() });
    this.byHash.set(tokenHash, agentId);
    return raw;
  }

  /** 导入预授权 token（来自配置文件，用于让外部 Agent 免交互接入） */
  register(agentId: string, rawToken: string): void {
    const tokenHash = this.hash(rawToken);
    this.byAgent.set(agentId, { agentId, tokenHash, createdAt: Date.now() });
    this.byHash.set(tokenHash, agentId);
  }

  /** 验证原始 token，成功返回 agentId，失败返回 null（不区分“不存在”与“错误”） */
  verify(rawToken: string): string | null {
    const tokenHash = this.hash(rawToken);
    const agentId = this.byHash.get(tokenHash);
    if (!agentId) return null;
    const cred = this.byAgent.get(agentId);
    if (!cred) return null;
    const a = Buffer.from(tokenHash, 'utf8');
    const b = Buffer.from(cred.tokenHash, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return agentId;
  }

  revoke(agentId: string): boolean {
    const cred = this.byAgent.get(agentId);
    if (!cred) return false;
    this.byHash.delete(cred.tokenHash);
    this.byAgent.delete(agentId);
    return true;
  }

  listAgents(): string[] {
    return Array.from(this.byAgent.keys());
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
