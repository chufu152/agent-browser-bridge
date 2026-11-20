// 桥接服务 CLI 入口 — 手动启动或被浏览器拉起均可；端口已被占用说明已有实例，直接退出。
import net from 'node:net';
import { startBridge } from './main';

const port = Number(process.env.UBA_WS_PORT ?? 3000);
const probe = net.connect({ host: '127.0.0.1', port, timeout: 1000 });
probe.on('connect', () => {
  probe.destroy();
  console.error(`[uba-bridge] port ${port} already serving, exiting (singleton).`);
  process.exit(0);
});
probe.on('error', () => startBridge());
probe.on('timeout', () => { probe.destroy(); startBridge(); });