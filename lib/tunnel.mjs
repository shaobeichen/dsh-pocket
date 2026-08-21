// cloudflared 快速隧道：把本机代理暴露成公网 https URL
//
// 手机在任何网络都能访问；URL 由 cloudflared 随机分配（每次重启会变）。
// 无密码模式：URL 即钥匙（dsh web 能执行代码，请勿把二维码/URL 发给别人）。

import { spawn, execSync } from 'node:child_process';
import { mkdir, access, chmod, rm, stat, rename, cp, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';

const QUICK_TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function platformBinary() {
  const archMap = { x64: 'amd64', arm64: 'arm64' };
  const a = archMap[process.arch] ?? process.arch;
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
  return { os, a, ext: os === 'windows' ? '.exe' : '' };
}

/**
 * cloudflared 下载源。
 * 优先：清华 TUNA 镜像的 Homebrew bottle（国内 CDN，实测 ~3MB/s）——仅 macOS/Linux
 * 且有对应 bottle 时可用（Windows 无 Homebrew，自动跳过）。
 * 兜底：官方 GitHub + 国内加速源（ghproxy.net / gh.ddlc.top / gh-proxy.com，2026-08
 * 实测可达）。npmmirror（淘宝）没有 cloudflared 镜像（已实测 404）。
 */
const CLOUDFLARED_MIRRORS = [
  (asset) => `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`,
  (asset) => `https://ghproxy.net/https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`,
  (asset) => `https://gh.ddlc.top/https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`,
  (asset) => `https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`,
];

const TUNA_BOTTLES = 'https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/';

/** 多线程分块下载的并发段数（Windows 官方源单线程 ~200KB/s，8 并发 ≈ 1.6MB/s）。 */
const PARALLEL_SEGMENTS = 8;
/** 小于该字节数的文件不值得分块（直接用单线程）。 */
const MIN_PARALLEL_SIZE = 8 * 1024 * 1024;
/** 探针大小：单线程先下这么多测速。 */
const PROBE_SIZE = 2 * 1024 * 1024;
/** 探针测速阈值（bytes/ms）：低于它认为慢网络，切多线程。300KB/s = 0.3。 */
const SLOW_SPEED_THRESHOLD = 0.3;

function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}

/** 合并多个分段文件为一个目标文件（顺序拼接后统一结束）。 */
async function mergeParts(partFiles, dest) {
  const { createReadStream } = await import('node:fs');
  const out = createWriteStream(dest);
  try {
    for (const f of partFiles) {
      await new Promise((resolve, reject) => {
        const rs = createReadStream(f);
        rs.on('error', reject);
        rs.pipe(out, { end: false });
        rs.on('end', resolve);
      });
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
}

/**
 * 下载文件到 dest（自适应）：
 * 1. 服务器不支持 Range 或文件小 → 单线程；
 * 2. 单线程下载探针（PROBE_SIZE）测速——速度够快 → 继续单线程（多线程在部分网络/
 *    服务器上反而更慢，如 GitHub CDN 并发限速）；
 * 3. 探针速度低于阈值（典型慢网络，如 Windows 用户官方源 ~200KB/s）→ 丢弃探针，
 *    改 8 段并发分块（可把 200KB/s 拉到 1.6MB/s）。
 * 返回实际下载字节数。
 */
export async function downloadFile(url, dest, { signal, segments = PARALLEL_SEGMENTS } = {}) {
  // HEAD 探测：Content-Length + Accept-Ranges
  let head = null;
  try { head = await fetch(url, { method: 'HEAD', signal }); } catch { head = null; }
  const len = head ? Number(head.headers.get('content-length') || 0) : 0;
  const acceptsRanges = head ? String(head.headers.get('accept-ranges') || '').toLowerCase() === 'bytes' : false;

  if (!head || !acceptsRanges || len < MIN_PARALLEL_SIZE) {
    // 单线程
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    return len || 0;
  }

  // 探针测速：单线程下载前 PROBE_SIZE，计时
  const probeBytes = Math.min(PROBE_SIZE, len);
  const probeStart = Date.now();
  try {
    const probeRes = await fetch(url, { signal, headers: { Range: `bytes=0-${probeBytes - 1}` } });
    if (!probeRes.ok) throw new Error(`HTTP ${probeRes.status} (probe)`);
    const probeBody = await probeRes.arrayBuffer();
    const probeMs = Date.now() - probeStart;
    const probeSpeed = probeMs > 0 ? probeBytes / probeMs : Infinity; // bytes/ms
    if (probeMs < 500 || probeSpeed >= SLOW_SPEED_THRESHOLD) {
      // 够快 → 单线程下完剩余部分（探针字节已拿到，写入 dest）
      const { createWriteStream, createReadStream } = await import('node:fs');
      const w = createWriteStream(dest);
      await new Promise((resolve, reject) => {
        w.on('error', reject);
        w.write(Buffer.from(probeBody));
        w.end(resolve);
      });
      const restRes = await fetch(url, { signal, headers: { Range: `bytes=${probeBytes}-${len - 1}` } });
      if (!restRes.ok) throw new Error(`HTTP ${restRes.status} (rest)`);
      await pipeline(Readable.fromWeb(restRes.body), createWriteStream(dest, { flags: 'a' }));
      return len;
    }
    // 慢 → 丢弃探针，转分块并发（从 0 开始全量分块）
    await rm(dest, { force: true }).catch(() => {});
  } catch (err) {
    await rm(dest, { force: true }).catch(() => {});
    if (!/HTTP|fetch/i.test(String(err?.message ?? ''))) throw err; // 探针网络异常 → 抛给上层换源
    // 探针 HTTP 错误（部分服务器 HEAD 与 GET 行为不一致）→ 直接分块
  }

  // 分块并发
  const parts = [];
  const chunk = Math.ceil(len / segments);
  for (let i = 0; i < segments; i++) {
    const start = i * chunk;
    const end = i === segments - 1 ? len - 1 : Math.min(start + chunk - 1, len - 1);
    if (start > end) break;
    parts.push({ start, end, file: `${dest}.part${i}` });
  }
  try {
    await Promise.all(parts.map(async (p) => {
      const res = await fetch(url, { signal, headers: { Range: `bytes=${p.start}-${p.end}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status} (range ${p.start}-${p.end})`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(p.file));
    }));
    await mergeParts(parts.map((p) => p.file), dest);
  } finally {
    await Promise.all(parts.map((p) => rm(p.file, { force: true }).catch(() => {})));
  }
  return len;
}

/**
 * 清华 TUNA 镜像的 cloudflared Homebrew bottle URL（国内 CDN，实测 ~3MB/s）。
 * **仅 macOS**——Linux 的 Homebrew bottle 其 ELF 解释器是 `@@HOMEBREW_PREFIX@@`
 * 占位符（需 brew install 时 patchelf 替换），没装 Homebrew 的机器直接 spawn 会
 * ENOENT（issue #22）；Linux 走官方 GitHub tgz（解压即用）+ 加速源。
 * 匹配按 CPU 架构取清华目录里版本号最新的 bottle——Homebrew 构建时部署目标
 * 设得较老、向后兼容，所以旧系统（如 Ventura）也能用新一点的 bottle。
 * 抓目录失败/无匹配 → null（调用方回退 GitHub/加速源，不影响可用性）。
 */
async function tsinghuaBottleUrl({ os, a }) {
  if (os !== 'darwin') return null;
  let res;
  try {
    res = await fetch(TUNA_BOTTLES, { signal: AbortSignal.timeout(20_000) });
  } catch { return null; }
  if (!res.ok) return null;
  let html;
  try { html = await res.text(); } catch { return null; }
  // macOS: arm64_<代号> 或 <代号>（Intel 无前缀），代号白名单排除 linux；Linux: arm64_linux / x86_64_linux
  const MACOS_CODES = 'monterey|ventura|sonoma|sequoia|tahoe';
  const pattern = os === 'darwin'
    ? new RegExp(`cloudflared-([0-9.]+)\\.${a === 'arm64' ? 'arm64_' : ''}(${MACOS_CODES})\\.bottle\\.tar\\.gz`, 'g')
    : new RegExp(`cloudflared-([0-9.]+)\\.${a === 'arm64' ? 'arm64' : 'x86_64'}_linux\\.bottle\\.tar\\.gz`, 'g');
  let best = null;
  let bestV = '';
  for (const m of html.matchAll(pattern)) {
    if (m[1] > bestV) { bestV = m[1]; best = m[0]; }
  }
  return best ? `${TUNA_BOTTLES}${best}` : null;
}

async function downloadCloudflared(binPath, signal) {
  const { os, a, ext } = platformBinary();
  const dir = dirname(binPath);
  const tmpFile = join(dir, `cloudflared.download`);
  const isWindows = os === 'windows';
  // 发布资产：Windows 是 .exe（下载即二进制），macOS/Linux 是 .tgz（需解压）
  const asset = isWindows ? `cloudflared-windows-${a}.exe` : `cloudflared-${os}-${a}.tgz`;
  const fetchSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);

  // 构建有序源列表：[{url, host}]；清华（如有，仅 macOS/Linux）排第一，再官方 + 加速源
  const sources = [];
  if (!isWindows) {
    const tua = await tsinghuaBottleUrl({ os, a }).catch(() => null);
    if (tua) sources.push({ url: tua, host: 'mirrors.tuna.tsinghua.edu.cn' });
  }
  for (const m of CLOUDFLARED_MIRRORS) sources.push({ url: m(asset), host: hostOf(m(asset)) });

  let lastErr = null;
  for (let i = 0; i < sources.length; i++) {
    const { url, host } = sources[i];
    console.log(`⬇️  Downloading cloudflared (${i + 1}/${sources.length}: ${host})…`);
    try {
      // 多线程分块（官方 GitHub 支持 Range，Windows 50MB 从几分钟降到几十秒）；
      // 不支持 Range 的源自动回退单线程
      await downloadFile(url, tmpFile, { signal: fetchSignal });
      // 简单校验：空文件/极小文件视为下载失败（可能是镜像返回了错误页）
      const st = await stat(tmpFile);
      if (st.size < 1024 * 1024) throw new Error(`suspiciously small file (${st.size} bytes) — probably a mirror error page`);
      lastErr = null;
      break; // 下载成功
    } catch (err) {
      lastErr = err;
      await rm(tmpFile, { force: true }).catch(() => {}); // 清掉半截文件
      console.warn(`  ⚠️ mirror ${i + 1} failed: ${err?.message ?? err}, trying next…`);
    }
  }
  if (lastErr) {
    throw new Error(
      `cloudflared download failed: all mirrors unreachable (last error: ${lastErr?.message ?? lastErr}).`
      + (isWindows
        ? `Windows: install manually and retry — winget install cloudflared, or download ${asset} into ${dir}`
        : `install cloudflared manually and retry: npm i -g cloudflared (just the cloudflared CLI on PATH is enough), or retry with a proxy / different network`),
    );
  }

  let extracted = join(dir, `cloudflared${ext}`);
  if (isWindows) {
    // Windows：exe 直接就是二进制，无需解压
    await rename(tmpFile, extracted).catch(async () => {
      await cp(tmpFile, extracted).catch(() => {});
    });
  } else {
    // 解压到独立临时子目录（bottle 解压产物会占用 cacheDir/cloudflared 这个名字，
    // 直接解压到 dir 会让目标路径变成目录，rename 失败）
    const extractDir = join(dir, `.extract-${process.pid}-${Date.now()}`);
    await mkdir(extractDir, { recursive: true });
    try {
      await new Promise((resolve, reject) => {
        const child = spawn('tar', ['-xzf', tmpFile, '-C', extractDir], { stdio: 'ignore' });
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`cloudflared extract failed (code=${code})`)));
        child.once('error', reject);
      });
      // 找真实的二进制**文件**（排除目录）：
      // - GitHub tgz：extractDir/cloudflared
      // - Homebrew bottle（清华）：extractDir/cloudflared/<版本>/bin/cloudflared
      const { readdir } = await import('node:fs/promises');
      let found = null;
      const direct = join(extractDir, `cloudflared${ext}`);
      try { if ((await stat(direct)).isFile()) found = direct; } catch { /* 不存在 */ }
      if (!found) {
        const verDir = join(extractDir, 'cloudflared');
        try {
          const vers = await readdir(verDir);
          for (const v of vers) {
            const bin = join(verDir, v, 'bin', `cloudflared${ext}`);
            try { if ((await stat(bin)).isFile()) { found = bin; break; } } catch { /* 继续 */ }
          }
        } catch { /* 无此目录 */ }
      }
      if (!found) throw new Error('binary not found after extract');
      if (found !== extracted) {
        await rename(found, extracted).catch(async () => { await cp(found, extracted).catch(() => {}); });
      }
    } finally {
      await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  if (!isWindows) await chmod(extracted, 0o755);
  // 解压/搬移完成就删掉临时下载文件，避免长期占用缓存目录
  await rm(tmpFile, { force: true }).catch(() => {});
  return extracted;
}

/** PATH 里是否已有 cloudflared。 */
function cloudflaredOnPath() {
  try {
    execSync(process.platform === 'win32' ? 'where cloudflared' : 'command -v cloudflared', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** in-flight 下载（单飞）：并发调用复用同一次，防止交错写入损坏 tgz。 */
let downloading = null;

/**
 * 拿一个可用的 cloudflared 路径。
 * 优先：PATH 已有 → 直接用；否则用持久缓存（$DSH_HOME/dsh-pocket/cloudflared），
 * 只有缓存缺失才下载——避免每次开启公网都重新下 20MB。
 */
export { tsinghuaBottleUrl };

export async function resolveCloudflared({ home, onPhase = () => {}, signal } = {}) {
  if (cloudflaredOnPath()) return 'cloudflared';
  const dshHome = home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const cacheDir = join(dshHome, 'dsh-pocket', 'bin');
  const { os, a, ext } = platformBinary();
  // 缓存命中，兼容两种文件名（issue #15）：
  // 1) 本插件下载时写入的 bin 名：cloudflared.exe
  // 2) 手动放置的**发布资产名**：cloudflared-windows-amd64.exe（与下载失败的错误提示一致）
  const candidates = [
    join(cacheDir, `cloudflared${ext}`),
    join(cacheDir, `cloudflared-${os}-${a}${ext}`),
  ];
  for (const bin of candidates) {
    try {
      await access(bin);
      // Linux：识别并丢弃 Homebrew bottle 坏缓存（issue #22）——其 ELF 解释器是
      // @@HOMEBREW_PREFIX@@ 占位符，直接 spawn 报 ENOENT；读文件头（解释器路径在
      // ELF 头部附近）即可识别，命中则删掉走重新下载
      if (os === 'linux') {
        try {
          const fd = await open(bin, 'r');
          const head = Buffer.alloc(8192);
          await fd.read(head, 0, 8192, 0);
          await fd.close();
          if (head.includes('@@HOMEBREW_PREFIX@@')) {
            await rm(bin, { force: true }).catch(() => {});
            console.warn('dsh-pocket: discarding unusable Homebrew-bottle cloudflared cache, redownloading');
            continue;
          }
        } catch { /* 读失败按正常缓存处理 */ }
      }
      return bin; // 缓存命中，秒开
    } catch { /* 继续找下一个 */ }
  }
  onPhase('downloading');
  await mkdir(cacheDir, { recursive: true });
  if (!downloading) {
    downloading = downloadCloudflared(join(cacheDir, `cloudflared${ext}`), signal).finally(() => { downloading = null; });
  }
  return downloading;
}

/**
 * 启动 cloudflared 快速隧道，返回公网 URL。
 * @param {object} opts
 * @param {number} opts.port  本机代理端口
 * @param {string} [opts.home] $DSH_HOME（cloudflared 持久缓存）
 * @param {AbortSignal} [opts.signal]
 * @param {(phase:string)=>void} [opts.onPhase] 进度回调：downloading→starting→registering→ready
 * @returns {Promise<{url:string, kill:()=>void}>}
 */
export async function startQuickTunnel({ port, home, signal, onPhase = () => {} }) {
  const bin = await resolveCloudflared({ home, onPhase, signal });
  onPhase('starting');
  // 强制 HTTP/2（TCP 443）而不是默认的 QUIC（UDP 7844）：
  // 国内网络/部分企业网常屏蔽 UDP 7844，导致 tunnel 报 error 1033（Tunnel error）；
  // HTTP/2 走 443 更稳。若平台未来恢复 QUIC 可达，可去掉 --protocol http2。
  const child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--protocol', 'http2', '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // H1：spawn 失败（缓存二进制损坏等）必须接住，否则 uncaughtException 崩宿主
  child.on('error', (err) => {
    cleanup?.();
    onPhase?.('error');
    rejectErr?.(new Error(`cloudflared failed to start: ${err?.message ?? err} (try deleting the $DSH_HOME/dsh-pocket/bin cache and retry)`));
  });
  onPhase('registering');

  let cleanup = null;
  let rejectErr = null;
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
      const m = buf.match(QUICK_TUNNEL_URL_RE);
      if (m) {
        cleanup();
        onPhase('ready');
        resolve(m[0]);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`cloudflared exited (code=${code})`));
    };
    cleanup = () => {
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // M4：摘掉监听后管道不再消费 → 64KB 缓冲填满会阻塞 cloudflared → 继续吞掉输出
      child.stdout.resume();
      child.stderr.resume();
    };
    const onAbort = () => {
      cleanup();
      child.kill();
      reject(new Error('cancelled'));
    };
    const timer = setTimeout(() => {
      cleanup();
      child.kill();
      reject(new Error(
        'cloudflared start timed out (30s) — '
        + 'timeout — if you run a proxy/VPN (Clash etc., TUN mode), it can block the tunnel; quit it and retry',
      ));
    }, 30_000);

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
    signal?.addEventListener('abort', onAbort, { once: true });
    rejectErr = reject;
  });

  // M1：隧道进程运行中死亡（崩溃/被杀）→ 通知监听方（service 据此把状态从 ready 打回）
  const exitListeners = new Set();
  child.on('exit', (code) => {
    for (const cb of exitListeners) cb(code);
  });

  return {
    url,
    kill: () => {
      try { child.kill(); } catch { /* 忽略 */ }
    },
    /** 注册「进程已退出」回调，返回取消函数。 */
    onExit: (cb) => {
      exitListeners.add(cb);
      return () => exitListeners.delete(cb);
    },
  };
}
