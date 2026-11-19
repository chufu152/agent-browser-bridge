// UBA Observer — DOM 变化监听（ESM）
// 用 MutationObserver 合并高频变化，产出变化记录。

import type { Snapshot } from '../snapshot/index';

export type ChangeType = 'elements-added' | 'elements-removed' | 'text-changed' | 'attributes-changed';

export interface ChangeRecord {
  changeTypes: ChangeType[];
  snapshotVersion: string;
  addedCount: number;
  removedCount: number;
  timestamp: string;
}

export interface ObserverHandle {
  start(): void;
  stop(): void;
  flush(): ChangeRecord | null;
}

export function createObserver(
  doc: Document,
  onFlush: (record: ChangeRecord) => void,
  getVersion: () => string
): ObserverHandle {
  let observer: MutationObserver | null = null;
  let pending: ChangeRecord | null = null;
  let debounceTimer: number | null = null;

  function flush(): ChangeRecord | null {
    if (!pending) return null;
    const record = pending;
    pending = null;
    onFlush(record);
    return record;
  }

  function scheduleFlush(): void {
    if (debounceTimer !== null) return;
    debounceTimer = (doc.defaultView as any).setTimeout(() => {
      debounceTimer = null;
      flush();
    }, 100);
  }

  function noteChange(type: ChangeType): void {
    const snapshotVersion = getVersion();
    if (!pending) {
      pending = { changeTypes: [type], snapshotVersion, addedCount: 0, removedCount: 0, timestamp: new Date().toISOString() };
    } else {
      if (pending.changeTypes.indexOf(type) === -1) pending.changeTypes.push(type);
      pending.snapshotVersion = snapshotVersion;
    }
    if (type === 'elements-added') pending.addedCount++;
    if (type === 'elements-removed') pending.removedCount++;
    scheduleFlush();
  }

  return {
    start() {
      if (observer) return;
      observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'childList') {
            if (m.addedNodes.length > 0) noteChange('elements-added');
            if (m.removedNodes.length > 0) noteChange('elements-removed');
          } else if (m.type === 'characterData') {
            noteChange('text-changed');
          } else if (m.type === 'attributes') {
            noteChange('attributes-changed');
          }
        }
      });
      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      });
    },
    stop() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },
    flush
  };
}

export type { Snapshot };
