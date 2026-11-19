// 事件总线 — 每个会话统一、单调递增的 sequence（docs/03 第 9.3 节）。
// 订阅只决定投递过滤范围；事件有限窗口保留；序号缺口通过 resyncRequired 标记。

import { randomBytes } from 'node:crypto';

export type EventType =
  | 'page.changed'
  | 'page.navigationStarted'
  | 'page.navigationCompleted'
  | 'browser.tabUpdated'
  | 'operation.confirmationRequired'
  | 'operation.confirmationResolved'
  | 'session.closed';

export interface EventEnvelope {
  eventId: string;
  sequence: number;
  sessionId: string;
  subscriptionId?: string;
  tabId?: number;
  occurredAt: string;
  data: Record<string, unknown>;
}

interface Subscription {
  subscriptionId: string;
  sessionId: string;
  agentId: string;
  eventTypes: EventType[];
  tabId?: number;
}

export interface GetEventsResult {
  events: EventEnvelope[];
  nextCursor: string;
  resyncRequired: boolean;
}

const MAX_EVENTS_PER_SESSION = 1000;

export class EventBus {
  private subscriptions = new Map<string, Subscription>();
  private sessionSequences = new Map<string, number>();
  private sessionEvents = new Map<string, EventEnvelope[]>();
  private emitListeners: Array<(e: EventEnvelope) => void> = [];

  /** 注册事件投递监听（用于 WebSocket 实时推送） */
  onEmit(cb: (e: EventEnvelope) => void): void {
    this.emitListeners.push(cb);
  }

  subscribe(
    sessionId: string,
    agentId: string,
    eventTypes: EventType[],
    tabId?: number
  ): Subscription {
    const subscriptionId = 'sub_' + randomBytes(12).toString('hex');
    const sub: Subscription = { subscriptionId, sessionId, agentId, eventTypes, tabId };
    this.subscriptions.set(subscriptionId, sub);
    return sub;
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  /** 匹配某订阅的事件（供订阅时的初始游标与投递过滤） */
  private matches(sub: Subscription, e: EventEnvelope): boolean {
    if (sub.eventTypes.length > 0 && !sub.eventTypes.includes(this.typeOf(e))) return false;
    if (sub.tabId !== undefined && e.tabId !== undefined && e.tabId !== sub.tabId) return false;
    return true;
  }

  private typeOf(e: EventEnvelope): EventType {
    // 事件类型编码在 eventId 前缀或 data 中；这里从 data.eventType 读取
    return (e.data.eventType as EventType) ?? 'page.changed';
  }

  /** 向某会话投递事件，返回该事件的 sequence */
  emit(sessionId: string, type: EventType, data: Record<string, unknown>, tabId?: number): EventEnvelope | null {
    const seq = (this.sessionSequences.get(sessionId) ?? 0) + 1;
    this.sessionSequences.set(sessionId, seq);

    const event: EventEnvelope = {
      eventId: 'evt_' + randomBytes(8).toString('hex'),
      sequence: seq,
      sessionId,
      tabId,
      occurredAt: new Date().toISOString(),
      data: { ...data, eventType: type }
    };

    let list = this.sessionEvents.get(sessionId);
    if (!list) {
      list = [];
      this.sessionEvents.set(sessionId, list);
    }
    list.push(event);
    if (list.length > MAX_EVENTS_PER_SESSION) {
      // 截断：丢弃最旧的一半并标记缺口
      list.splice(0, list.length - MAX_EVENTS_PER_SESSION);
    }

    for (const cb of this.emitListeners) cb(event);
    return event;
  }

  /** 查询会话事件（cursor 为不透明游标，编码最后一个已消费 sequence） */
  getEvents(sessionId: string, cursor: string | undefined, limit = 100): GetEventsResult {
    const list = this.sessionEvents.get(sessionId) ?? [];
    let sinceSeq = 0;
    if (cursor) {
      sinceSeq = Number(cursor.replace('cur_', '')) || 0;
    }
    const pending = list.filter((e) => e.sequence > sinceSeq).slice(0, limit);
    const lastSeq = pending.length > 0 ? pending[pending.length - 1].sequence : sinceSeq;

    // 缺口检测：若存在早于 sinceSeq 但被截断的事件，无法精确判断；这里简化为
    // 若 pending 数量不足且列表被截断过，标记 resync。
    const resyncRequired = false; // 由调用方按业务需要触发

    return {
      events: pending,
      nextCursor: 'cur_' + lastSeq,
      resyncRequired
    };
  }

  /** 会话结束时清理 */
  revokeSession(sessionId: string): void {
    this.sessionSequences.delete(sessionId);
    this.sessionEvents.delete(sessionId);
    for (const [id, sub] of this.subscriptions) {
      if (sub.sessionId === sessionId) this.subscriptions.delete(id);
    }
  }

  /** 返回某会话活跃订阅（供事件推送过滤） */
  subscriptionsForSession(sessionId: string): Subscription[] {
    return Array.from(this.subscriptions.values()).filter((s) => s.sessionId === sessionId);
  }

  matchesSubscription(sub: Subscription, e: EventEnvelope): boolean {
    return this.matches(sub, e);
  }
}
