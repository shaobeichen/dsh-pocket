// cloudflared 隧道：把本机代理暴露成公网 https URL
//
// 两条路径（issue #66）：
//   - 快速隧道 startQuickTunnel：URL 由 cloudflared 随机分配（每次重启会变），零配置；
//   - 命名隧道 startNamedTunnel：用户自带 Cloudflare Tunnel Token + 固定域名，重启地址不变。
//
// 手机在任何网络都能访问。公网一律要求访问密码（dsh web 能执行代码，请勿泄露二维码/URL）。

import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
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

// ---------- 就绪度探活（自愈的基础） ----------
//
// 真实故障形态（2026-11 实测）：cloudflared 进程还活着、metrics 端口照常应答，但它与
// Cloudflare 边缘的连接全部失效（registerConnection 成串 `server_error`，
// `readyConnections=0`，临时域名 DNS 记录被回收）。此时插件只监控「进程是否退出」，
// 界面仍显示「已开启」，而手机打开公网地址拿到的是 Cloudflare 1016「Origin DNS error」
// / 1033 / 530，且永远不会自愈——只能手动关开隧道。
//
// cloudflared 自带的 metrics 端点 `/ready` 正好精确暴露这个状态：
//   readyConnections>0  → 至少有一条边缘连接已注册，公网域名可服务；
//   readyConnections=0  → 进程活着但隧道不可用（就是在上面那个现场抓到的）。
// 所以启动时显式指定 `--metrics 127.0.0.1:<空闲端口>`，服务层据此轮询；
// 探活失败连续 N 次即判定隧道死亡并自动重建（快速隧道会换新地址、命名隧道地址不变）。

/** metrics 只绑定本机回环，不对外暴露。 */
const METRICS_HOST = '127.0.0.1';

/**
 * 申请一个空闲的本机端口给 cloudflared metrics 用。
 * 先 bind 再立刻 release，存在"被其它进程抢走"的小概率竞态；实测（cloudflared
 * 2026.10.7）此时 cloudflared 会直接退出（code=1，metrics 绑定失败），而不是"没有
 * metrics 继续运行"。该失败会走上层启动失败/自愈重建路径（下次 pickFreePort 会换新
 * 端口重试），不会静默挂死。
 * @returns {Promise<number>}
 */
export function pickFreePort({ host = METRICS_HOST } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    // 注意：这里不要 unref——await listen/close 期间若只剩这个未计数的 handle，
    // Node 22 可能在事件循环耗尽时提前结束进程（node:test 会报 cancelled）。
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('no free port | 未取到空闲端口'))));
    });
  });
}

/**
 * 探活 cloudflared 本地 metrics 的 `/ready`。
 *
 * @param {object} opts
 * @param {number} opts.port metrics 端口（来自 startQuickTunnel/startNamedTunnel 的返回值）
 * @param {number} [opts.timeoutMs] 单次探活超时（默认 2s；metrics 就在本机，超时即异常）
 * @param {typeof fetch} [opts.fetchImpl] 测试注入
 * @returns {Promise<{ok:boolean, readyConnections:number, status:number|null, error:string}>}
 */
export async function probeTunnelReady({ port, timeoutMs = 2000, fetchImpl = globalThis.fetch } = {}) {
  if (!port) return { ok: false, readyConnections: 0, status: null, error: 'no-metrics-port' };
  try {
    const res = await fetchImpl(`http://${METRICS_HOST}:${port}/ready`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => null);
    const readyConnections = Number(body?.readyConnections ?? 0);
    return {
      ok: Boolean(res.ok) && readyConnections > 0,
      readyConnections: Number.isFinite(readyConnections) ? readyConnections : 0,
      status: res.status,
      error: '',
    };
  } catch (err) {
    return { ok: false, readyConnections: 0, status: null, error: String(err?.message ?? err) };
  }
}

// cloudflared 必须直连 Cloudflare 边缘，不能继承本机拦截代理：
// 本机常挂着 HTTP_PROXY/HTTPS_PROXY（指向 127.0.0.1 的本地代理，如 Clash 透明代理/
// 各类代理软件注入的 env），一旦 cloudflared 继承这些变量，隧道边缘数据面会被绕进
// 本地代理而连不上 → 手机端 error 1033（Tunnel error）。TUN 模式卸载、系统级代理关闭
// 都不影响 shell 里的 env 变量，故这里主动剥离，强制 cloudflared 直连。
const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy'];

/** 给 cloudflared 子进程用的环境：复制当前环境但剥离所有代理变量，强制直连边缘。 */
export function cloudflaredEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of PROXY_ENV_KEYS) delete env[k];
  return env;
}

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
 * 启动 cloudflared 快速隧道，返回公网 URL。
 * @param {object} opts
 * @param {number} opts.port  本机代理端口
 * @param {string} [opts.home] $DSH_HOME（cloudflared 持久缓存）
 * @param {AbortSignal} [opts.signal]
 * @param {(phase:string)=>void} [opts.onPhase] 进度回调：downloading→starting→registering→ready
 * @returns {Promise<{url:string, kill:()=>void}>}
 */
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
 * @returns {Promise<{url:null, metricsPort:number, kill:()=>void, onExit:(cb)=>()=>void}>}
 *   metricsPort：本次进程的 metrics 端口（服务层用它轮询 /ready 做就绪度探活）。
 */
export async function startNamedTunnel({ token, home, signal, onPhase = () => {} }) {
  const bin = await resolveCloudflared({ home, onPhase, signal });
  onPhase('starting');
  // 与快速隧道一致：显式指定 metrics 端口给就绪度探活用（只绑 127.0.0.1）。
  const metricsPort = await pickFreePort();
  // 与快速隧道一致强制 HTTP/2（国内/企业网常屏蔽 UDP 7844 → error 1033）
  // `--no-autoupdate` 必须在全局位置（子命令之前）：cloudflared 2026.x 移除了
  // `tunnel run` 子命令层级的该 flag，但全局位置仍有效（issue #78）
  const child = spawn(bin, ['--no-autoupdate', 'tunnel', 'run', '--protocol', 'http2', '--metrics', `${METRICS_HOST}:${metricsPort}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cloudflaredEnv({ TUNNEL_TOKEN: String(token ?? '') }),
  });
  let cleanup = null;
  let rejectErr = null;
  // H1：spawn 失败（缓存二进制损坏等）必须接住，否则 uncaughtException 崩宿主
  child.on('error', (err) => {
    cleanup?.();
    onPhase?.('error');
    rejectErr?.(new Error(`cloudflared 启动失败：${err?.message ?? err}（可删除 $DSH_HOME/dsh-pocket/bin 缓存后重试）`));
  });
  onPhase('registering');

  await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
      // 边缘连接注册成功即开始服务（每条连接一行；等第一条就够）
      if (/Registered tunnel connection/i.test(buf)) {
        cleanup();
        onPhase('ready');
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      const tail = firstMeaningfulErrorLine(buf);
      reject(new Error(
        `cloudflared 退出（code=${code}）${tail ? '：' + tail : ''}——请检查 Tunnel Token 是否有效、域名 Service 是否指向本机代理端口 | `
        + `tunnel exited (code=${code})${tail ? ': ' + tail : ''} — check the Tunnel Token and the ingress hostname`,
      ));
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
      reject(new Error('已取消 | cancelled'));
    };
    const timer = setTimeout(() => {
      cleanup();
      child.kill();
      reject(new Error(
        'cloudflared 启动超时（30s）——请检查 Tunnel Token 是否有效、域名 Service 是否指向本机代理端口，'
        + '以及是否开着代理/VPN（Clash 等 TUN 模式会掐断隧道连接） | timeout — check the token, the ingress hostname, and quit any proxy/VPN (TUN mode)',
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
    url: null, // 固定域名由调用方（service）按设置拼 https://<hostname>
    metricsPort,
    kill: () => killChild(child),
    /** 注册「进程已退出」回调，返回取消函数。 */
    onExit: (cb) => {
      exitListeners.add(cb);
      return () => exitListeners.delete(cb);
    },
  };
}

/**
 * 停止 cloudflared 子进程：先 SIGTERM，3 秒内仍未退出再 SIGKILL。
 * 自愈重建不能留下孤儿进程（旧进程卡死时 SIGTERM 可能一直不被处理）。
 */
function killChild(child) {
  try { child.kill(); } catch { /* 已退出 */ }
  const timer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* 已退出/无权限 */ }
  }, 3000);
  timer.unref?.();
  child.once('exit', () => clearTimeout(timer));
}

/**
 * 启动 cloudflared 快速隧道。
 * @param {object} opts
 * @param {number} opts.port  本机代理端口（cloudflared 回连目标）
 * @param {string} [opts.home] DSH_HOME（用来找缓存的 cloudflared 二进制）
 * @param {AbortSignal} [opts.signal]
 * @param {(phase:string)=>void} [opts.onPhase] 进度回调：downloading→starting→registering→ready
 * @returns {Promise<{url:string, metricsPort:number, kill:()=>void, onExit:(cb)=>()=>void}>}
 *   metricsPort：本次进程的 metrics 端口（服务层用它轮询 /ready 做就绪度探活）。
 */
export async function startQuickTunnel({ port, home, signal, onPhase = () => {} }) {
  const bin = await resolveCloudflared({ home, onPhase, signal });
  onPhase('starting');
  // 自愈用：显式指定 metrics 端口（默认 cloudflared 会在 20241-20245 里自己挑，多个实例
  // 同时跑时不可预测；显式指定后服务层能稳定拿到 /ready）。端口只绑 127.0.0.1。
  const metricsPort = await pickFreePort();
  // 强制 HTTP/2（TCP 443）而不是默认的 QUIC（UDP 7844）：
  // 国内网络/部分企业网常屏蔽 UDP 7844，导致 tunnel 报 error 1033（Tunnel error）；
  // HTTP/2 走 443 更稳。若平台未来恢复 QUIC 可达，可去掉 --protocol http2。
  // `--no-autoupdate` 必须在全局位置（子命令之前，见 issue #78 同款修复）
  const child = spawn(bin, ['--no-autoupdate', 'tunnel', '--url', `http://127.0.0.1:${port}`, '--protocol', 'http2', '--metrics', `${METRICS_HOST}:${metricsPort}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cloudflaredEnv(),
  });
  // H1：spawn 失败（缓存二进制损坏等）必须接住，否则 uncaughtException 崩宿主
  child.on('error', (err) => {
    cleanup?.();
    onPhase?.('error');
    rejectErr?.(new Error(`cloudflared 启动失败：${err?.message ?? err}（可删除 $DSH_HOME/dsh-pocket/bin 缓存后重试）`));
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
      // 带上 cloudflared 自己的输出（参数错误显示开头、运行期错误显示尾部，见 firstMeaningfulErrorLine），
      // 否则「code=1」用户无从排查（issue #65 / #78）
      const tail = firstMeaningfulErrorLine(buf);
      reject(new Error(`cloudflared 退出（code=${code}）${tail ? '：' + tail : ''}`));
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
      reject(new Error('已取消 | cancelled'));
    };
    const timer = setTimeout(() => {
      cleanup();
      child.kill();
      reject(new Error(
        'cloudflared 启动超时（30s）——请检查是否开着代理/VPN（Clash 等 TUN 模式会掐断隧道连接），退出代理后重试 | '
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
    metricsPort,
    // 自愈重建时会 kill 旧进程：先 TERM，3 秒还没退再 KILL（cloudflared 偶发卡死不响应 TERM
    // 会留下孤儿进程，继续占着旧 metrics 端口/连接，干扰下一次探测）。
    kill: () => killChild(child),
    /** 注册「进程已退出」回调，返回取消函数。 */
    onExit: (cb) => {
      exitListeners.add(cb);
      return () => exitListeners.delete(cb);
    },
  };
}
