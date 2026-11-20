// UBA 浏览器启动器 — 零安装路线的核心。
// 以调试端口拉起一个带用户登录态的 Edge/Chrome 独立实例（复制 Cookies，不动日常浏览器）。
// 幂等：CDP 已在线则直接复用；profile 已存在则不重复复制。
// 用法：node uba-browser.mjs [起始URL]

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CDP_PORT = Number(process.env.UBA_CDP_PORT ?? 9222);
const UBA_HOME = join(homedir(), '.uba');
const PROFILE_DIR = join(UBA_HOME, 'edge-profile');
const START_URL = process.argv[2] ?? 'about:blank';

function log(...args) {
  console.error('[uba-browser]', ...args);
}

function findBrowser() {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  const pf = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
  const pf64 = process.env.PROGRAMFILES ?? 'C:\\Program Files';
  const candidates = [
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf64, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf64, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function sourceUserData(browserExe) {
  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return browserExe.toLowerCase().includes('edge')
    ? join(local, 'Microsoft', 'Edge', 'User Data')
    : join(local, 'Google', 'Chrome', 'User Data');
}

// 只复制登录态必需文件（Cookies + 加密密钥 + 偏好），不碰密码库/历史/缓存。
// 日常浏览器运行时 Cookies 被锁：回退到 .NET 共享读流式复制。
function copyLocked(src, dst) {
  const ps = `$s=[IO.File]::Open('${src.replace(/'/g, "''")}','Open','Read','ReadWrite');` +
    `$d=[IO.File]::Create('${dst.replace(/'/g, "''")}');$s.CopyTo($d);$d.Close();$s.Close()`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'pipe', timeout: 15000 });
}

function copyLoginState(srcUserData) {
  const files = [
    ['Local State', 'Local State'],
    ['Default\\Network\\Cookies', 'Default\\Network\\Cookies'],
    ['Default\\Network\\Cookies-wal', 'Default\\Network\\Cookies-wal'],
    ['Default\\Network\\Cookies-shm', 'Default\\Network\\Cookies-shm'],
    ['Default\\Preferences', 'Default\\Preferences']
  ];
  let copied = 0;
  for (const [from, to] of files) {
    const src = join(srcUserData, from);
    const dst = join(PROFILE_DIR, to);
    if (!existsSync(src)) continue;
    mkdirSync(join(dst, '..'), { recursive: true });
    try {
      copyFileSync(src, dst);
      copied++;
    } catch {
      try {
        copyLocked(src, dst);
        copied++;
      } catch (e) {
        log('copy skipped:', from, String(e.message ?? e));
      }
    }
  }
  const cookieDst = join(PROFILE_DIR, 'Default', 'Network', 'Cookies');
  const cookieSrc = join(srcUserData, 'Default', 'Network', 'Cookies');
  const cookies = existsSync(cookieDst) && existsSync(cookieSrc) &&
    statSync(cookieDst).size === statSync(cookieSrc).size;
  if (cookies) writeFileSync(join(PROFILE_DIR, '.uba-login-copied'), String(Date.now()));
  return { copied, cookies };
}

async function cdpAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(UBA_HOME, { recursive: true });

  if (await cdpAlive()) {
    log(`CDP already online at port ${CDP_PORT}, reusing.`);
    return;
  }

  const browser = findBrowser();
  if (!browser) {
    log('ERROR: Edge/Chrome executable not found.');
    process.exit(1);
  }

  if (!existsSync(join(PROFILE_DIR, '.uba-login-copied'))) {
    const src = sourceUserData(browser);
    if (existsSync(src)) {
      const { copied, cookies } = copyLoginState(src);
      log(`login state copied (${copied} files) from ${src}`);
      if (!cookies) {
        log('WARN: Cookies 被日常浏览器独占锁定，本次未能复制登录态。');
        log('      二选一：① 在受控浏览器窗口登录一次（之后永久保留）；');
        log('              ② 关闭日常 Edge/Chrome 后重跑 node uba-browser.mjs 自动复制。');
      }
    } else {
      log('WARN: source profile not found; starting with a fresh profile.');
    }
  }

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    START_URL
  ];
  const child = spawn(browser, args, { detached: true, stdio: 'ignore' });
  child.unref();
  log(`launched ${browser} (pid ${child.pid}), waiting for CDP...`);

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive()) {
      log(`CDP online: http://127.0.0.1:${CDP_PORT}`);
      return;
    }
  }
  log('ERROR: CDP did not come online within 20s.');
  process.exit(1);
}

main().catch((e) => {
  log('ERROR:', e);
  process.exit(1);
});