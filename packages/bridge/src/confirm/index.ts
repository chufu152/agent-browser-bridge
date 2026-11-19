// 高风险操作确认管理 — 实现 docs/03-接口文档.md 第 7.3 节的闭环状态机。
// 状态：pending → confirmed（confirmed_pending_retry）/ denied / expired。
// 确认编号绑定 agentId + sessionId + operationId + 参数指纹 + 操作目标，不可跨用。

import { randomBytes } from 'node:crypto';

export type ConfirmationStatus = 'pending' | 'confirmed' | 'denied' | 'expired';

export interface RiskSummary {
  site?: string;
  action?: string;
  target?: string;
}

export interface Confirmation {
  confirmationId: string;
  agentId: string;
  sessionId: string;
  operationId: string;
  paramsFingerprint: string;
  method: string;
  riskSummary: RiskSummary;
  status: ConfirmationStatus;
  createdAt: number;
  expiresAt: number;
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'denied' | 'expired' | 'stale' };

export class ConfirmationManager {
  private confirmations = new Map<string, Confirmation>();

  constructor(private readonly ttlMs: number = 5 * 60 * 1000) {}

  request(
    agentId: string,
    sessionId: string,
    operationId: string,
    paramsFingerprint: string,
    method: string,
    riskSummary: RiskSummary
  ): Confirmation {
    const confirmationId = 'cfm_' + randomBytes(16).toString('hex');
    const now = Date.now();
    const c: Confirmation = {
      confirmationId,
      agentId,
      sessionId,
      operationId,
      paramsFingerprint,
      method,
      riskSummary,
      status: 'pending',
      createdAt: now,
      expiresAt: now + this.ttlMs
    };
    this.confirmations.set(confirmationId, c);
    return c;
  }

  get(confirmationId: string): Confirmation | undefined {
    const c = this.confirmations.get(confirmationId);
    if (!c) return undefined;
    if (c.status === 'pending' && Date.now() > c.expiresAt) {
      c.status = 'expired';
    }
    return c;
  }

  approve(confirmationId: string): boolean {
    const c = this.get(confirmationId);
    if (!c || c.status !== 'pending') return false;
    c.status = 'confirmed';
    return true;
  }

  deny(confirmationId: string): boolean {
    const c = this.get(confirmationId);
    if (!c || c.status !== 'pending') return false;
    c.status = 'denied';
    return true;
  }

  /** 校验重新提交：必须 agentId/sessionId/operationId/参数指纹/确认编号全部一致且状态为 confirmed */
  validateForResubmit(
    agentId: string,
    sessionId: string,
    operationId: string,
    paramsFingerprint: string,
    confirmationId: string
  ): ValidateResult {
    const c = this.get(confirmationId);
    if (!c) return { ok: false, reason: 'invalid' };
    if (c.status === 'denied') return { ok: false, reason: 'denied' };
    if (c.status === 'expired') return { ok: false, reason: 'expired' };
    if (c.status !== 'confirmed') return { ok: false, reason: 'invalid' };
    if (c.agentId !== agentId || c.sessionId !== sessionId || c.operationId !== operationId || c.paramsFingerprint !== paramsFingerprint) {
      return { ok: false, reason: 'stale' };
    }
    return { ok: true };
  }

  /** 会话失效时，其全部确认随之失效 */
  revokeForSession(sessionId: string): void {
    for (const [id, c] of this.confirmations) {
      if (c.sessionId === sessionId) this.confirmations.delete(id);
    }
  }

  listPending(): Confirmation[] {
    return Array.from(this.confirmations.values()).filter((c) => c.status === 'pending' && Date.now() <= c.expiresAt);
  }
}
