// Native Messaging 传输 — 桥接服务南向到浏览器插件。
// 协议：每条消息 = 4 字节小端无符号长度 + UTF-8 JSON。
// 浏览器通过 chrome.runtime.connectNative 启动本进程并连接 stdin/stdout。

import { Readable, Writable } from 'node:stream';
import type { ExtensionTransport, ExtensionCommand } from '../transport/index';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class NativeMessagingTransport implements ExtensionTransport {
  private pending = new Map<string, Pending>();
  private seq = 0;
  private buffer = Buffer.alloc(0);
  private disconnectCbs: Array<() => void> = [];
  private disconnected = false;

  constructor(
    private readonly stdin: Readable = process.stdin,
    private readonly stdout: Writable = process.stdout,
    private readonly timeoutMs = 15000
  ) {
    this.stdin.on('data', (chunk: Buffer) => this.onData(chunk));
    this.stdin.on('end', () => this.emitDisconnect());
    this.stdin.on('error', () => this.emitDisconnect());
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + len) break;
      const payload = this.buffer.subarray(4, 4 + len).toString('utf8');
      this.buffer = this.buffer.subarray(4 + len);
      this.onMessage(payload);
    }
  }

  private onMessage(payload: string): void {
    let msg: any;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    const requestId = msg?.requestId as string | undefined;
    if (!requestId) return;
    const p = this.pending.get(requestId);
    if (p) {
      this.pending.delete(requestId);
      clearTimeout(p.timer);
      p.resolve(msg?.result ?? msg);
    }
  }

  send(command: ExtensionCommand): Promise<unknown> {
    if (this.disconnected) {
      return Promise.reject(new Error('Native messaging channel is disconnected'));
    }
    const requestId = 'nm_' + (++this.seq);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Native messaging request timed out'));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      const payload = Buffer.from(JSON.stringify({ requestId, ...command }), 'utf8');
      const len = Buffer.alloc(4);
      len.writeUInt32LE(payload.length, 0);
      this.stdout.write(Buffer.concat([len, payload]));
    });
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCbs.push(cb);
  }

  private emitDisconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Native messaging channel disconnected'));
    }
    this.pending.clear();
    for (const cb of this.disconnectCbs) cb();
  }
}
