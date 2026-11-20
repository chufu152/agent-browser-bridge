// 本地人工确认界面 — 高风险操作的批准/拒绝入口（CDP 版替代扩展 popup）。
// 仅监听 127.0.0.1；Agent 的 BCP 路由不可达此接口，批准权始终在用户手里。

import { createServer, type Server } from 'node:http';
import type { ConfirmationManager } from '../confirm/index';

export interface ConfirmUIHandle {
  server: Server;
  url: string;
}

const PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>UBA 人工确认</title>
<style>
 body{font-family:"Microsoft YaHei",sans-serif;max-width:640px;margin:40px auto;padding:0 16px;background:#f5f6f7}
 h1{font-size:20px} .card{background:#fff;border:1px solid #e4e7ed;border-radius:6px;padding:16px;margin:12px 0}
 .method{font-weight:bold} .meta{color:#909399;font-size:12px;margin:6px 0}
 button{font-size:14px;padding:6px 20px;margin-right:8px;border-radius:4px;cursor:pointer}
 .ok{background:#67c23a;color:#fff;border:none} .no{background:#fff;border:1px solid #f56c6c;color:#f56c6c}
 .empty{color:#909399}
</style></head><body>
<h1>UBA 高风险操作确认</h1>
<p class="meta">Agent 请求了高风险操作。批准前请核对方法与目标；拒绝或不处理（5 分钟过期）都不会执行。</p>
<div id="list"><span class="empty">加载中…</span></div>
<script>
async function load(){
  const res = await fetch('/api/confirmations'); const items = await res.json();
  const box = document.getElementById('list');
  if(!items.length){ box.innerHTML = '<span class="empty">当前没有待确认的操作。</span>'; return; }
  box.innerHTML = '';
  for(const c of items){
    const d = document.createElement('div'); d.className='card';
    const sum = c.riskSummary ? JSON.stringify(c.riskSummary) : '';
    d.innerHTML = '<div class="method"></div><div class="meta"></div>';
    d.querySelector('.method').textContent = c.method;
    d.querySelector('.meta').textContent = sum + '  过期：' + new Date(c.expiresAt).toLocaleTimeString();
    const ok = document.createElement('button'); ok.className='ok'; ok.textContent='批准';
    const no = document.createElement('button'); no.className='no'; no.textContent='拒绝';
    ok.onclick = ()=>resolve(c.confirmationId,true); no.onclick = ()=>resolve(c.confirmationId,false);
    d.appendChild(ok); d.appendChild(no); box.appendChild(d);
  }
}
async function resolve(id,approved){
  await fetch('/api/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmationId:id,approved})});
  load();
}
load(); setInterval(load, 3000);
</script></body></html>`;

export function startConfirmUI(opts: {
  port?: number;
  confirmations: ConfirmationManager;
  resolve: (confirmationId: string, approved: boolean) => boolean;
}): ConfirmUIHandle {
  const port = opts.port ?? Number(process.env.UBA_CONFIRM_PORT ?? 3001);
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'GET' && (url === '/' || url === '/confirm')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    if (req.method === 'GET' && url === '/api/confirmations') {
      const items = opts.confirmations.listPending().map((c) => ({
        confirmationId: c.confirmationId,
        operationId: c.operationId,
        method: c.method,
        riskSummary: c.riskSummary,
        createdAt: c.createdAt,
        expiresAt: c.expiresAt
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(items));
      return;
    }
    if (req.method === 'POST' && url === '/api/resolve') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; if (body.length > 10000) req.destroy(); });
      req.on('end', () => {
        try {
          const { confirmationId, approved } = JSON.parse(body);
          const ok = opts.resolve(String(confirmationId), approved === true);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid body' }));
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, '127.0.0.1');
  server.on('error', (e) => console.error('[uba-confirm-ui]', e));
  return { server, url: `http://127.0.0.1:${port}/` };
}