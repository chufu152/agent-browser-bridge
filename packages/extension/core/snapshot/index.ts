// UBA Snapshot Engine — 快照与版本管理
// 页面版本基于 URL + title + 元素 ref 签名的哈希，用于变化检测与缓存判断。

import { buildSnapshot, type SnapshotResult } from '../dom-engine/index';

export interface Snapshot {
  url: string;
  title: string;
  snapshotVersion: string;
  elements: SnapshotResult['elements'];
  truncated: boolean;
  fullSync: boolean;
  generatedAt: string;
}

export function computeVersion(raw: SnapshotResult): string {
  const signatures = raw.elements.map((e) => e.ref).join('|');
  let h = 5381;
  const str = raw.url + '|' + raw.title + '|' + signatures;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return 'sv_' + h.toString(36) + '_' + raw.elements.length;
}

export interface SnapshotOptions {
  sinceVersion?: string;
  maxElements?: number;
}

export interface SnapshotEngine {
  getSnapshot(options?: SnapshotOptions): Snapshot;
}

export function createSnapshotEngine(doc: Document): SnapshotEngine {
  let currentVersion: string | null = null;

  return {
    getSnapshot(options) {
      const opts = options || {};
      const raw = buildSnapshot(doc);

      if (opts.sinceVersion && currentVersion && opts.sinceVersion === currentVersion) {
        return {
          url: raw.url,
          title: raw.title,
          snapshotVersion: currentVersion,
          elements: [],
          truncated: false,
          fullSync: false,
          generatedAt: new Date().toISOString()
        };
      }

      const version = computeVersion(raw);
      const fullSync = version !== currentVersion;
      currentVersion = version;

      let elements = raw.elements;
      let truncated = raw.truncated;
      if (typeof opts.maxElements === 'number' && opts.maxElements > 0 && elements.length > opts.maxElements) {
        elements = elements.slice(0, opts.maxElements);
        truncated = true;
      }

      return {
        url: raw.url,
        title: raw.title,
        snapshotVersion: version,
        elements,
        truncated,
        fullSync,
        generatedAt: new Date().toISOString()
      };
    }
  };
}
