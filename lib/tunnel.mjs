// cloudflared 隧道：把本机代理暴露成公网 https URL
//
// 两条路径（issue #66）：
//   - 快速隧道 startQuickTunnel：URL 由 cloudflared 随机分配（每次重启会变），零配置；
//   - 命名隧道 startNamedTunnel：用户自带 Cloudflare Tunnel Token + 固定域名，重启地址不变。
//
// 手机在任何网络都能访问。公网一律要求访问密码（dsh web 能执行代码，请勿泄露二维码/URL）。

import { spawn, execSync } from 'node:child_process';
import { mkdir, access, chmod, rm, stat, rename, cp, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';

// 快速隧道 URL：https://<随机子域>.trycloudflare.com
// (?!api\.) 负向前瞻排除保留子域 api（issue #32）：某些 cloudflared 版本/网络环境下
// 进程输出会先出现 https://api.trycloudflare.com（Cloudflare API 注册地址），原正则
// [a-z0-9-]+ 会把它误当隧道 URL → 设置页/二维码给出 api 地址 → 扫码打开返回
// {"code":10005,"message":"Method Not Allowed"}。api.trycloudflare.com 访问 GET 实测
// 正是该错误体，与 issue 完全一致。
export const QUICK_TUNNEL_URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i;

// 隧道连接协议候选，按顺序尝试。
//
// 默认 auto 让 cloudflared 按连通性预检（precheck）自选：UDP 7844 通就走 QUIC，不通退回 HTTP/2。
// 「HTTP/2 被拦、QUIC 可用」的真实环境存在（代理 TUN / 企业网关会掐掉到边缘的 TCP，却不拦 UDP）：
// 旧实现无条件 --protocol http2，在这种机器上永远等不到 Registered tunnel connection，
// 30 秒后只能给出「请检查 Token / 域名 Service / 关代理」这类指不到真因的提示。
// 反过来「QUIC 被拦、HTTP/2 可用」也存在（国内 UDP 7844 常被丢包），auto 的预检会自动落到 http2；
// 连预检都判不出可用协议时进程只会无限重试，所以再显式 http2 兜底一次。
export const PROTOCOL_CANDIDATES = ['auto', 'http2'];
const PROTOCOL_HINT = '已依次尝试 auto（QUIC）与 http2';
const PROTOCOL_HINT_EN = 'tried auto (QUIC) and http2';

/**
 * 从 cloudflared 输出里提取最有诊断价值的一段（issue #78）。
 *
 * cloudflared 参数错误（如 "Incorrect Usage: flag provided but not defined"）的
 * 关键信息在输出**开头**，尾部整段都是 usage 帮助文本（对用户没用）；而运行期错误
 * （403 / 协议 / 网络）的关键信息在**尾部**。所以：参数错误取该行，其它仍取尾部。
 * 最多 500 字符，与历史上限一致。
 */
export function firstMeaningfulErrorLine(buf) {
  const lines = String(buf ?? '').trim().split(/\r?\n/);
  // 命中哪行就返回哪行：cloudflared 先打版本横幅时，参数错误未必是首行
  const usageIdx = lines.findIndex((l) => /^(?:Incorrect Usage|flag provided but not defined|unknown flag|unknown command)/i.test(l.trim()));
  if (usageIdx >= 0) return lines[usageIdx].trim().slice(0, 500);
  return lines.slice(-4).join('\n').trim().slice(0, 500);
}

function platformBinary() {
  const archMap = { x64: 'amd64', arm64: 'arm64', ia32: '386', arm: 'arm' };
  const a = archMap[process.arch] ?? process.arch;
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
  return { os, a, ext: os === 'windows' ? '.exe' : '' };
}

/**
 * 候选发布资产名，按优先级排列（issue #45）。
 *
 * cloudflared 现在的发布布局是**按平台分**：
 * - linux：只有裸二进制 `cloudflared-linux-amd64`（没有 .tgz）
 * - darwin：只有 `cloudflared-darwin-<arch>.tgz`
 * - windows：只有 `cloudflared-windows-<arch>.exe`
 *
 * 我们以前给 linux 拼的是 `cloudflared-linux-amd64.tgz`，而它**根本不存在**
 * （GitHub 返回 404），五个镜像全指向同一个 404 地址，于是必然"所有源都不通"
 * —— 表现就是 Linux 服务器上开了公网访问一直报"无法安装"，而 macOS/Windows
 * 一切正常。Linux 下裸二进制还有个额外好处：不用解压，也就不再依赖系统装了
 * `tar`（Alpine / slim 镜像 / 容器里常常没有）。
 *
 * linux 仍把 .tgz 留在候选里作为回退，万一上游改回打包方式也不会直接躺平。
 *
 * @returns {string[]} 资产名列表，越靠前越优先。
 */
export function platformAssets() {
  const { os, a } = platformBinary();
  if (os === 'windows') return [`cloudflared-windows-${a}.exe`];
  if (os === 'darwin') return [`cloudflared-darwin-${a}.tgz`];
  return [`cloudflared-linux-${a}`, `cloudflared-linux-${a}.tgz`];
}

/**
 * cloudflared 下载源。
 * 平台策略：macOS 优先清华 TUNA 镜像的 Homebrew bottle（国内 CDN，实测 ~3MB/s），
 * 拿不到再回退；Linux / Windows 直接走官方源优先（见 downloadCloudflared 里的说明）。
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
 * ENOENT（issue #22）；Linux 走官方 GitHub 裸二进制（无需解压）+ 加速源。
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
  const fetchSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);

  // 源的顺序按平台定（issue #45）：
  // - macOS：清华 Homebrew bottle 排第一（国内 CDN 实测 ~3MB/s，给家用网络省几分钟），
  //   拿不到再退回官方源 + 国内加速源。
  // - Linux / Windows：不走 bottle，直接官方源优先。这两类环境网络差异太大
  //   （服务器、容器、 corporate 网络），多一层镜像就多一层失败模式；官方源
  //   拿不到时，再用国内加速源兜底。
  // bottle 与资产名无关，只算一次。
  const bottle = os === 'darwin' ? await tsinghuaBottleUrl({ os, a }).catch(() => null) : null;

  // 逐个资产试（linux 首选裸二进制，.tgz 只是回退），每个资产再逐个源试
  const assets = platformAssets();
  let lastErr = null;
  let usedAsset = null;

  for (let ai = 0; ai < assets.length && usedAsset === null; ai++) {
    const asset = assets[ai];
    const sources = [];
    if (bottle && asset.endsWith('.tgz')) {
      sources.push({ url: bottle, host: 'mirrors.tuna.tsinghua.edu.cn' });
    }
    for (const m of CLOUDFLARED_MIRRORS) sources.push({ url: m(asset), host: hostOf(m(asset)) });

    for (let i = 0; i < sources.length; i++) {
      const { url, host } = sources[i];
      console.log(`⬇️  下载 cloudflared（${asset}，源 ${i + 1}/${sources.length}：${host}）…`);
      try {
        // 多线程分块（官方 GitHub 支持 Range，Windows 50MB 从几分钟降到几十秒）；
        // 不支持 Range 的源自动回退单线程
        await downloadFile(url, tmpFile, { signal: fetchSignal });
        // 简单校验：空文件/极小文件视为下载失败（可能是镜像返回了错误页）
        const st = await stat(tmpFile);
        if (st.size < 1024 * 1024) throw new Error(`文件异常小（${st.size} 字节），疑似镜像错误页`);
        usedAsset = asset;
        lastErr = null;
        break; // 下载成功
      } catch (err) {
        lastErr = err;
        await rm(tmpFile, { force: true }).catch(() => {}); // 清掉半截文件
        console.warn(`  ⚠️ 源 ${i + 1} 失败：${err?.message ?? err}，尝试下一个…`);
      }
    }
  }
  if (usedAsset === null) {
    throw new Error(
      `cloudflared 下载失败：所有源都不通（最后错误：${lastErr?.message ?? lastErr}）。`
      + (isWindows
        ? `Windows 可手动安装后重试：winget install cloudflared；或下载 ${assets[0]} 放到 ${dir} 目录 | download failed — try: winget install cloudflared, or put the exe into ${dir}`
        : `也可以自己装好后在 settings.json 写 "cloudflaredPath": "/path/to/cloudflared" 跳过下载（或用环境变量 DSH_POCKET_CLOUDFLARED）；或用包管理器安装：apt/dnf install cloudflared | all mirrors failed — install cloudflared manually and set "cloudflaredPath" in settings.json, or: apt/dnf install cloudflared`),
    );
  }

  let extracted = join(dir, `cloudflared${ext}`);
  // 只有 .tgz 才需要解压：Windows 的 .exe 和 linux 的裸二进制本身就可直接执行
  // （linux 用裸二进制还有个好处——不依赖系统装了 tar，见 platformAssets 的说明）
  if (!usedAsset.endsWith('.tgz')) {
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
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`cloudflared 解压失败（code=${code}）`)));
        // spawn 失败（Alpine / slim 镜像 / 容器里常见：根本没有 tar）时 err.code 是
        // ENOENT，直接抛出来只有一句 "spawn tar ENOENT"，看不出该怎么办
        child.once('error', (err) => reject(
          err?.code === 'ENOENT'
            ? new Error(`系统里没有 tar 命令，无法解压 ${usedAsset} —— 可改用 linux 裸二进制（默认已如此）或手动安装后设置 cloudflaredPath | no tar on this system`)
            : err,
        ));
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
      if (!found) throw new Error('cloudflared 解压成功但未找到二进制 | binary not found after extract');
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
  // 自定义路径（issue #45）：用户可能在 settings.json 写了 cloudflaredPath，
  // 或者在外部注入 process.env.DSH_POCKET_CLOUDFLARED；命中就直接用，绕过
  // PATH 探测与下载（远程 Linux 服务器上下载源不可达时的兜底）。
  const explicit = process.env.DSH_POCKET_CLOUDFLARED;
  if (explicit) {
    try {
      await access(explicit);
      return explicit;
    } catch {
      throw new Error(
        `DSH_POCKET_CLOUDFLARED 指向的路径不可执行：${explicit} | cloudflaredPath is set but not accessible: ${explicit}`,
      );
    }
  }
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
            console.warn('dsh-pocket: discarding unusable Homebrew-bottle cloudflared cache | 丢弃不可用的 Homebrew bottle 缓存，重新下载');
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
 * 依次用 PROTOCOL_CANDIDATES 里的协议拉起 cloudflared，返回第一个成功注册连接的子进程。
 *
 * 判定交给调用方：`prompt(buf)` 返回非空值即视为就绪（返回值就是本次尝试的结果），
 * 返回 null 表示还没就绪、继续等。单个协议在 timeoutMs 内没就绪就杀掉进程换下一个，
 * 进程自己退出（参数错误、Token 无效等）同样立刻换下一个——这样真错误不会被超时掩盖。
 * 全部协议都失败时，抛最后一个失败原因（含 cloudflared 输出的关键行）。
 *
 * @param {object} opts
 * @param {string} opts.bin   cloudflared 可执行文件
 * @param {string[]} opts.args   除 --protocol 之外的 cloudflared 参数
 * @param {Record<string,string>} [opts.env] 附加环境变量（命名隧道放 TUNNEL_TOKEN）
 * @param {(buf:string)=>string|null} opts.prompt 就绪判定：非空 = 就绪
 * @param {string} opts.label 错误信息里的中文前缀
 * @param {string} opts.labelEn 错误信息里的英文前缀
 * @param {number} [opts.timeoutMs=20_000] 单个协议的就绪等待上限
 * @param {AbortSignal} [opts.signal]
 * @param {typeof spawn} [opts.spawnImpl] 测试注入用的 spawn（默认 node:child_process 的 spawn）
 * @returns {Promise<{child:import('node:child_process').ChildProcess, buf:string}>}
 */
async function spawnCloudflaredWithFallback({
  bin, args, env, prompt, label, labelEn, timeoutMs = 20_000, signal, spawnImpl = spawn,
}) {
  let lastErr = null;
  for (let i = 0; i < PROTOCOL_CANDIDATES.length; i++) {
    const protocol = PROTOCOL_CANDIDATES[i];
    const last = i === PROTOCOL_CANDIDATES.length - 1;
    let cleanup = () => {};
    let child;
    try {
      child = spawnImpl(bin, [...args, '--protocol', protocol], {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(env ? { env: { ...process.env, ...env } } : {}),
      });
    } catch (err) {
      lastErr = err; // spawn 同步抛错（参数非法等）
      continue;
    }
    const outcome = await new Promise((resolve) => {
      let buf = '';
      let timedOut = false;
      const onData = (chunk) => {
        buf += String(chunk);
        const ok = prompt(buf);
        if (ok !== null && ok !== undefined) resolve({ kind: 'ready', buf, value: ok });
      };
      const onExit = (code) => resolve({ kind: timedOut ? 'timeout' : 'exit', buf, code });
      const onError = (err) => resolve({ kind: 'error', buf, err });
      cleanup = () => {
        child.stdout.off('data', onData);
        child.stderr.off('data', onData);
        child.off('exit', onExit);
        child.off('error', onError);
        signal?.removeEventListener('abort', onAbort);
        clearTimeout(timer);
        // 摘掉监听后管道不再消费 → 64KB 缓冲填满会阻塞 cloudflared → 继续吞掉输出
        child.stdout.resume();
        child.stderr.resume();
      };
      // 先清理再杀：kill 触发的 exit 不会把结果改写成「进程退出」误报
      const killNow = () => { cleanup(); try { child.kill(); } catch { /* 已退出 */ } };
      const onAbort = () => {
        killNow();
        resolve({ kind: 'abort', buf });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        killNow();
        resolve({ kind: 'timeout', buf });
      }, timeoutMs);
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', onExit);
      child.once('error', onError);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
    cleanup();
    if (outcome.kind === 'ready') return { child, buf: outcome.buf };
    if (outcome.kind === 'abort') {
      try { child.kill(); } catch { /* 已退出 */ }
      throw new Error('已取消 | cancelled');
    }
    try { child.kill(); } catch { /* 已退出 */ } // 失败路径：别把上一个 cloudflared 留成孤儿
    const tail = firstMeaningfulErrorLine(outcome.buf);
    if (outcome.kind === 'error') {
      lastErr = new Error(`${label}：${outcome.err?.message ?? outcome.err}${last ? '' : '（换下一个协议重试）'}`);
    } else if (outcome.kind === 'exit') {
      lastErr = new Error(`${label}（code=${outcome.code}）${tail ? '：' + tail : ''}${last ? '' : '（换个协议重试）'}`);
    } else {
      // 超时：把 cloudflared 自己的关键输出带出来，否则用户只看到一句「超时」，无从下手
      lastErr = new Error(
        `${label}：${Math.round(timeoutMs / 1000)}s 内没有注册成功（${PROTOCOL_HINT}）`
        + `${tail ? '。cloudflared 输出：' + tail : ''}`
        + ` | ${labelEn}: no tunnel registration within ${Math.round(timeoutMs / 1000)}s（${PROTOCOL_HINT_EN}）`
        + `${tail ? ' — cloudflared: ' + tail : ''}`,
      );
    }
  }
  throw lastErr ?? new Error(`${label} | ${labelEn}`);
}
/**
 * 启动 cloudflared 命名隧道（issue #66：固定公网域名）。
 *
 * 用户在 Cloudflare Zero Trust 后台创建 Tunnel、把域名 ingress 的 Service 指向
 * `http://127.0.0.1:<port>`，复制 Tunnel Token 填进设置页。与快速隧道的区别：
 *   - Token 走 `TUNNEL_TOKEN` **环境变量**（不进 argv——长期凭据不该出现在
 *     进程列表/崩溃日志里，issue #66 讨论中的一致意见）；
 *   - URL 固定为用户绑定的域名（cloudflared 输出不打印它），由调用方拼 `https://<域名>`，
 *     所以这里返回 `url: null`；
 *   - 就绪判据是 stderr 出现 `Registered tunnel connection`（边缘连接注册成功即开始服务）。
 * @param {object} opts
 * @param {string} opts.token    Cloudflare Tunnel Token
 * @param {string} [opts.home]   $DSH_HOME（cloudflared 持久缓存）
 * @param {AbortSignal} [opts.signal]
 * @param {(phase:string)=>void} [opts.onPhase] 进度回调：downloading→starting→registering→ready
 * @param {object} [opts.internals] 测试注入（spawn）
 * @returns {Promise<{url:null, kill:()=>void, onExit:(cb)=>()=>void}>}
 */
export async function startNamedTunnel({ token, home, signal, onPhase = () => {}, internals = {} }) {
  const bin = await resolveCloudflared({ home, onPhase, signal });
  onPhase('starting');
  // `--no-autoupdate` 必须在全局位置（子命令之前）：cloudflared 2026.x 移除了
  // `tunnel run` 子命令层级的该 flag，但全局位置仍有效（issue #78）
  // 协议不写死 HTTP/2：由 spawnCloudflaredWithFallback 先 auto（按预检自选）再 http2 兜底（见 PROTOCOL_CANDIDATES）
  const child = (await spawnCloudflaredWithFallback({
    bin,
    args: ['--no-autoupdate', 'tunnel', 'run'],
    env: { TUNNEL_TOKEN: String(token ?? '') },
    prompt: (buf) => (/Registered tunnel connection/i.test(buf) ? 'registered' : null),
    label: 'cloudflared 启动超时——请检查 Tunnel Token 是否有效、域名 Service 是否指向本机代理端口，'
      + '或者本机到 Cloudflare 边缘的连接被挡（代理/VPN 的 TUN 模式、企业网关）',
    labelEn: 'cloudflared timeout — check the Tunnel Token, the ingress hostname, and whether a proxy/VPN TUN mode'
      + ' or corporate gateway blocks the connection to the Cloudflare edge',
    signal,
    spawnImpl: internals.spawn,
  })).child;
  onPhase('ready');
  // M1：隧道进程运行中死亡（崩溃/被杀）→ 通知监听方（service 据此把状态从 ready 打回）
  const exitListeners = new Set();
  child.on('exit', (code) => {
    for (const cb of exitListeners) cb(code);
  });

  return {
    url: null, // 固定域名由调用方（service）按设置拼 https://<hostname>
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

/**
 * 启动 cloudflared 快速隧道，返回公网 URL。
 * @param {object} opts
 * @param {number} opts.port  本机代理端口
 * @param {string} [opts.home] $DSH_HOME（cloudflared 持久缓存）
 * @param {AbortSignal} [opts.signal]
 * @param {(phase:string)=>void} [opts.onPhase] 进度回调：downloading→starting→registering→ready
 * @param {object} [opts.internals] 测试注入（spawn）
 * @returns {Promise<{url:string, kill:()=>void}>}
 */
export async function startQuickTunnel({ port, home, signal, onPhase = () => {}, internals = {} }) {
  const bin = await resolveCloudflared({ home, onPhase, signal });
  onPhase('starting');
  // `--no-autoupdate` 必须在全局位置（子命令之前，见 issue #78 同款修复）
  // 协议不写死 HTTP/2：先 auto（按预检自选）再 http2 兜底（见 PROTOCOL_CANDIDATES）
  const { child, buf } = await spawnCloudflaredWithFallback({
    bin,
    args: ['--no-autoupdate', 'tunnel', '--url', `http://127.0.0.1:${port}`],
    prompt: (b) => (b.match(QUICK_TUNNEL_URL_RE)?.[0] ?? null),
    label: 'cloudflared 启动超时——请检查是否开着代理/VPN（Clash 等 TUN 模式会掐断隧道连接），退出代理后重试',
    labelEn: 'timeout — if you run a proxy/VPN (Clash etc., TUN mode), it can block the tunnel; quit it and retry',
    signal,
    spawnImpl: internals.spawn,
  });
  onPhase('ready');
  const url = String(buf.match(QUICK_TUNNEL_URL_RE)[0]);

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
