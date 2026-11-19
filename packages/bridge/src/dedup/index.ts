// 操作去重与结果查询 — 实现 docs/03-接口文档.md 第 3.4 节的语义。
// operationId 在同一 Agent 内唯一；默认去重窗口 15 分钟；相同标识不同参数 → 冲突。

import { createHash } from 'node:crypto';

export type OperationStatus =
  | 'processing'
  | 'waiting_confirmation'
  | 'confirmed_pending_retry'
  | 'completed'
  | 'failed'
  | 'unknown';

export interface OperationState {
  operationId: string;
  agentId: string;
  status: OperationStatus;
  paramsFingerprint: string;
  result?: unknown;
  error?: { errorType: string; message?: string };
  createdAt: number;
  updatedAt: number;
}

export type ResolveAction = 'new' | 'conflict' | 'duplicate' | 'resume';

export interface ResolveResult {
  action: ResolveAction;
  state?: OperationState;
}

export class OperationStore {
  private ops = new Map<string, OperationState>();

  constructor(private readonly retentionMs: number = 15 * 60 * 1000) {}

  fingerprint(params: unknown): string {
    return createHash('sha256').update(JSON.stringify(params ?? {})).digest('hex');
  }

  get(operationId: string): OperationState | undefined {
    const op = this.ops.get(operationId);
    if (!op) return undefined;
    if (Date.now() - op.updatedAt > this.retentionMs) {
      this.ops.delete(operationId);
      return undefined;
    }
    return op;
  }

  put(op: OperationState): void {
    this.ops.set(op.operationId, op);
  }

  update(operationId: string, patch: Partial<OperationState>): void {
    const existing = this.get(operationId);
    if (!existing) return;
    this.ops.set(operationId, { ...existing, ...patch, updatedAt: Date.now() });
  }

  /** 去重判定 */
  resolve(operationId: string, agentId: string, paramsFingerprint: string): ResolveResult {
    const existing = this.get(operationId);
    if (!existing) return { action: 'new' };
    if (existing.agentId !== agentId) return { action: 'conflict' };
    if (existing.paramsFingerprint !== paramsFingerprint) return { action: 'conflict' };
    if (existing.status === 'processing') return { action: 'duplicate', state: existing };
    if (existing.status === 'completed' || existing.status === 'failed' || existing.status === 'unknown') {
      return { action: 'duplicate', state: existing };
    }
    // waiting_confirmation / confirmed_pending_retry → 允许续执行（由上层确认流程控制）
    return { action: 'resume', state: existing };
  }
}
