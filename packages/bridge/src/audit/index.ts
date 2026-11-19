// 审计 — 记录必要操作元数据，不记录认证材料、输入值、页面全文等敏感信息。
// 每条记录：时间、Agent、会话、方法、目标标签页、风险级别、结果。

export interface AuditEntry {
  ts: string;
  agentId: string;
  sessionId: string;
  method: string;
  tabId?: number;
  risk: 'normal' | 'restricted' | 'high';
  outcome: 'ok' | 'error' | 'denied';
  errorType?: string;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries;
  }

  record(entry: AuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  list(): AuditEntry[] {
    return this.entries.slice();
  }

  byAgent(agentId: string): AuditEntry[] {
    return this.entries.filter((e) => e.agentId === agentId);
  }

  clear(): void {
    this.entries = [];
  }
}
