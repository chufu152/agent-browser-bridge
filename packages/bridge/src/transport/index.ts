// 扩展传输接口 — 桥接服务南向到浏览器插件的受控通道。
// 生产实现走 Native Messaging；测试用内存 mock。

export interface ExtensionCommand {
  method: string;
  params: Record<string, unknown>;
}

export interface ExtensionTransport {
  /** 发送命令到插件并等待结果 */
  send(command: ExtensionCommand): Promise<unknown>;
  /** 插件通道断开时的回调 */
  onDisconnect(cb: () => void): void;
}
