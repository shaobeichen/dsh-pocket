// dsh-pocket 服务：在 dsh web 进程内跑改头代理 + 公网隧道
//
// - 代理：监听 0.0.0.0:<port>（默认 3081），把入站 Host/Origin 改写成
//   127.0.0.1:<dshPort>（dsh web 实际端口），HTTP + WebSocket 全透传。
//   这样 DSH 的 /api 浏览器信任栅栏永远看到 loopback，局域网/公网都能进，
//   且不需要改 dsh 的任何配置（0.0.0.0 绑定被 dsh 官方禁用）。
// - 隧道：cloudflared 快速隧道（可选），公网 https URL，供人在外面访问。

import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createPocketProxy } from './proxy.mjs';
import { startQuickTunnel, startNamedTunnel, probeTunnelReady } from './tunnel.mjs';
import { isValidIpv4 } from './ip.mjs';
import { lanBlacklist } from './settings.mjs';

const require = createRequire(import.meta.url);

/** URL → 二维码 data URL（浏览器 <img> 直接显示，全本地不依赖第三方）。 */
export async function qrDataUrl(text, { width = 220, margin = 1 } = {}) {
  const QRCode = require('qrcode');
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin, width, type: 'image/png' });
}

// RFC1918 私网地址：手机与电脑连同一局域网时通常可直连。
// 另含 CGNAT 100.64/10（RFC 6598，Tailscale/ZeroTier 默认网段，公网不可路由），保持一致（issue #79）。
const PRIVATE_IPV4_RE = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1(?:0\d|1\d|2[0-7]))\.)/;

/** 名称像真实物理网卡的接口（WLAN / Wi-Fi / Ethernet / 以太网 / 有线 / 无线 / en / eth）。
 *  注意：`本地连接` 用负前瞻 `(?!\*)` 排除 Windows 的「移动热点 / Internet 连接共享（ICS）」
 *  虚拟适配器 `本地连接* N`（IP 固定 192.168.137.1，手机连真实 Wi-Fi 时与它不在同一网段，
 *  扫码不可达）——issue #176。 */
const PHYSICAL_IFACE_RE = /^(?:wlan|wi-?fi|wireless|ethernet|eth\d|en\d|wlp\d|以太网|有线|无线|本地连接(?!\*))/i;

/** 常见的 VPN / 虚拟网卡名称：手机通常无法通过它们直连电脑。
 *  含 Windows ICS / 移动热点（`本地连接*`）与承载网络 / Wi-Fi Direct 虚拟适配器——issue #176。 */
const VPN_IFACE_RE = /(?:radmin|tailscale|zerotier|easytier|et_|tun|tap|vpn|vethernet|virtual|vmware|virtualbox|wsl|docker|teredo|hamachi|bluetooth|bridge|本地连接\*|hostednetwork|wifidirect)/i;

/**
 * 从 networkInterfaces() 返回的接口表里选出手机最可能可达的 IPv4。
 *
 * `os.networkInterfaces()` 的枚举顺序不可靠：Windows 上 Radmin VPN / Tailscale /
 * vEthernet 等虚拟网卡常排在 WLAN 前面，旧实现直接取第一张非回环网卡，会生成
 * 手机打不开的二维码。这里按以下规则打分排序：
 *   - RFC1918 私网地址优先（10/8、172.16/12、192.168/16）；
 *   - 名称像物理网卡再加分；
 *   - 名称像 VPN/虚拟网卡减分；
 *   - 同分保持原枚举顺序。
 * 没有任何私网地址时回退到最高分地址（例如纯 VPN 环境仍可用）。
 *
 * @param {ReturnType<typeof networkInterfaces>} interfaces
 * @param {string[]} [blacklist] 网卡黑名单（settings.json 的 `blacklist` 字段）：
 *   每项为网卡名或 IPv4，命中的网卡/地址直接忽略（不参与选择）
 * @returns {string|null}
 */
export function selectLanIPv4(interfaces, blacklist = []) {
  const blNames = new Set(blacklist.map((s) => String(s).toLowerCase()));
  const blIps = new Set(blacklist.filter((s) => isValidIpv4(s)));
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces ?? {})) {
    if (blNames.has(String(name).toLowerCase())) continue; // 网卡名命中 → 整张卡忽略
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      // 排除 loopback 与 link-local；其余地址即使不是私网（如 Radmin 的 26.x）也保留兜底
      if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue;
      if (blIps.has(ip)) continue; // IP 命中 → 该地址忽略

      let score = 0;
      if (PRIVATE_IPV4_RE.test(ip)) score += 100;
      if (PHYSICAL_IFACE_RE.test(name)) score += 20;
      else if (VPN_IFACE_RE.test(name)) score -= 50;

      candidates.push({ ip, score, order: candidates.length });
    }
  }

  // 兜底：同分时不选 ICS 保留段 192.168.137.x（移动热点 / 共享虚拟网卡），避免误指向不可达地址。
  const isIcsSubnet = (ip) => ip.startsWith('192.168.137.');
  candidates.sort((a, b) =>
    b.score - a.score ||
    (isIcsSubnet(a.ip) === isIcsSubnet(b.ip) ? a.order - b.order : isIcsSubnet(a.ip) ? 1 : -1),
  );
  return candidates[0]?.ip ?? null;
}

// ---------- WSL 局域网 IP（issue #39） ----------
// WSL2 是 NAT 模式：WSL 内部 os.networkInterfaces() 只能看到自己的虚拟网卡
// （172.x.x.x），看不到 Windows 宿主机的物理网卡 IP（192.168.x.x）——手机在
// 同一 WiFi 下访问的是 Windows 宿主机，拿 WSL 的 IP 生成的二维码必然打不开。
// 解法：检测到 WSL 时，通过 WSL interop 直接执行 Windows 的 ipconfig.exe，
// 解析出 Windows 侧非虚拟网卡的 IPv4 作为局域网地址；失败回退本机探测。

/** WSL 检测：/proc/version 含 microsoft/wsl，或 WSL 专属环境变量存在。 */
export function detectWsl() {
  try {
    const v = readFileSync('/proc/version', 'utf8').toLowerCase();
    if (v.includes('microsoft') || v.includes('wsl')) return true;
  } catch { /* 非 Linux：无 /proc/version */ }
  // 注意：**不能**用 WSLENV 判据——Windows Terminal 在原生 Windows 上也会设置
  // WSLENV（如 WT_SESSION:WT_PROFILE_ID:），会误判成 WSL。只认 WSL 内部才有的变量。
  return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

/**
 * 解析 ipconfig.exe 输出，默认取非虚拟网卡块的 IPv4 地址（保持输出顺序）。
 * 支持中文（`IPv4 地址 . . . :`）与英文（`IPv4 Address. . . :`）两种格式。
 * @param {string} text ipconfig.exe 的完整输出
 * @param {{ includeVpn?: boolean }} [opts] 传 includeVpn 时保留 Tailscale/VPN 等候选
 * @returns {string[]} 候选 IPv4 列表
 */
export function parseIpconfig(text, { includeVpn = false } = {}) {
  const out = [];
  // 网卡块：块标题行顶格（行首无缩进），其后内容行带缩进
  const blocks = String(text).split(/\r?\n(?=\S)/);
  const ipRe = /IPv4[^0-9]{0,40}((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)/;
  for (const block of blocks) {
    const title = String(block.split(/\r?\n/)[0] ?? '');
    // 跳过虚拟网卡块（vEthernet (WSL)、Docker、VirtualBox、VPN 等）
    if (!includeVpn && VPN_IFACE_RE.test(title)) continue;
    const m = block.match(ipRe);
    if (m) out.push(m[0].replace(/^IPv4[^0-9]*/i, ''));
  }
  return out;
}

function runIpconfig() {
  // WSL 内 PATH 可能不含 Windows System32；用绝对路径兜底
  const candidates = ['ipconfig.exe', '/mnt/c/Windows/System32/ipconfig.exe'];
  return new Promise((resolve) => {
    const tryNext = (i) => {
      if (i >= candidates.length) return resolve(null);
      execFile(candidates[i], [], { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return tryNext(i + 1);
        resolve(String(stdout));
      });
    };
    tryNext(0);
  });
}

async function lanIPv4() {
  const blacklist = lanBlacklist();
  const blIps = new Set(blacklist.filter((s) => isValidIpv4(s)));
  // WSL：优先 Windows 物理网卡 IP（手机可达）；超时/失败回退本机探测
  if (detectWsl()) {
    try {
      const out = await runIpconfig();
      const candidates = parseIpconfig(out ?? '').filter((c) => !blIps.has(c));
      const ip = candidates.find((c) => PRIVATE_IPV4_RE.test(c)) ?? candidates[0];
      if (ip) return ip;
    } catch { /* 回退 */ }
  }
  return selectLanIPv4(networkInterfaces(), blacklist);
}

/** 收集所有可手动选择的局域网/Tailnet 候选 IP（WSL 下以 Windows ipconfig 为准）。 */
async function listLanCandidates() {
  if (detectWsl()) {
    try {
      const out = await runIpconfig();
      const ips = parseIpconfig(out ?? '', { includeVpn: true });
      if (ips.length) return [...new Set(ips)];
    } catch { /* 回退 */ }
  }
  const ips = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue;
      if (!ips.includes(ip)) ips.push(ip);
    }
  }
  return ips;
}

/**
 * 创建 Pocket 服务。
 * @param {object} opts
 * @param {number} opts.dshPort   dsh web 实际端口（从 ctx.webServer.port 取）
 * @param {number} [opts.port]    代理端口（默认 3081）
 * @param {object} [opts.internals] 测试注入：createProxy / startTunnel / lanIPv4
 * @returns {PocketService}
 */
export function createPocketService({
  dshPort,
  port = 3081,
  home,
  internals = {},
  /** 局域网地址手动覆盖：返回 IPv4 字符串；空值表示自动选择 */
  getLanIpOverride,
  /** 局域网访问总开关：返回 boolean；默认开启。关闭后代理拒绝局域网 Host 请求 */
  getLanEnabled = () => true,
  /** 代理注入 HTML 的内容（桌面端补丁等由 lib/index.js 传入；默认 randomUUID polyfill） */
  injectHtml,
  /** 访问令牌认证配置（issue #13）：{ getToken, isProtected }，传给代理 */
  auth,
  /** @type {() => string} dsh web 浏览器会话启动 token（issue #77；老版本返回空字符串） */
  launchToken = () => '',
  /** 隧道配置（issue #66）：() => ({ mode:'quick'|'named', token, hostname })；named 用固定域名 */
  getTunnelConfig,
  /** 隧道就绪回调（lib/index.js 用它轮换公网密码；参数为 'quick'|'named'） */
  onTunnelReady,
  /** 就绪度探活间隔（ms）。<=0 关闭自愈（测试/兼容用）；默认 20s。 */
  healthCheckIntervalMs = 20_000,
  /** 连续多少轮探活失败判定隧道失联（默认 3，约 1 分钟；避免单次抖动误换地址） */
  healthCheckFailures = 3,
  /** 启动宽限期（ms）：刚拿到 URL 时边缘注册可能还没完成（/ready 暂时为 0），宽限期内只探测、
   *  不记失败；首次探活成功即提前结束宽限。默认 30s（cloudflared 通常几秒内完成注册）。 */
  healthStartupGraceMs = 30_000,
  /** 自愈重建退避序列（ms）：第 n 次取第 n 项，超出取最后一项 */
  healthRestartBackoffMs = [5_000, 15_000, 30_000, 60_000, 120_000],
  /** 连续自愈重建次数上限（跨事件累计），超过后置 error 停手（用户可手动重开） */
  healthMaxRestarts = 5,
  /** 预算复位窗口（ms）：隧道连续健康运行这么久，才把「重建次数预算」清零。
   *  默认 10 分钟——避免「能启动但马上死 / 永远不健康」时把 5 次预算当成每轮都能重置，
   *  导致无限重建（换地址 + 轮换密码，等于把用户踢来踢去）。 */
  healthStableMs = 10 * 60_000,
  /** 日志（DSH 宿主 ctx.logger 有 info/warn/error；默认 console 无 info，自动退回 log）。
   *  隧道自动恢复的成败必须走这里：console 输出在 DSH Desktop 里不进日志文件，
   *  出问题时无法排查（2026-09-07 实测教训）。 */
  log = console,
} = {}) {
  // ctx.logger 形状是 info/warn/error；console 只有 log/warn/error——info 做兜底兼容
  const logInfo = (...args) => (log.info ?? log.log).call(log, ...args);
  const logWarn = (...args) => log.warn(...args);
  // 抽成常量：启动与 status 两条路径都要提示同一件事，避免文案漂移。
  const NO_METRICS_WARN = 'dsh-pocket: tunnel has no metrics port — readiness self-heal disabled | 隧道未提供 metrics 端口，就绪探活自愈不可用';
  const createProxy = internals.createProxy ?? createPocketProxy;
  const startTunnel = internals.startTunnel ?? startQuickTunnel;
  const startNamed = internals.startNamedTunnel ?? startNamedTunnel;
  const getLanOverride = () => {
    const value = String(getLanIpOverride?.() ?? '').trim();
    return isValidIpv4(value) ? value : '';
  };
  const getLan = async () => getLanOverride() || (internals.lanIPv4 ? internals.lanIPv4() : lanIPv4());
  let lanCandidateCache = null;
  const getLanCandidates = async () => {
    if (internals.lanCandidates) return internals.lanCandidates();
    const now = Date.now();
    if (!lanCandidateCache || now - lanCandidateCache.at > 15000) {
      lanCandidateCache = { at: now, ips: await listLanCandidates() };
    }
    return lanCandidateCache.ips;
  };

  let proxy = null;
  let tunnel = null;
  let tunnelAbort = null;
  /** in-flight 隧道启动（单飞）：并发调用复用同一次，避免 spawn 多个 cloudflared 孤儿进程 */
  let tunnelPromise = null;
  /** 隧道进度：{ phase: idle|downloading|starting|registering|ready|restarting|error, detail, startedAt } */
  const tunnelState = { phase: 'idle', detail: '', startedAt: null };
  /** 用户是否希望隧道开着（stopTunnel → false）：自愈只在 true 时进行 */
  let tunnelWanted = false;
  /** 自愈重建单飞；预算跨事件累计（稳定健康/用户手动开启才清零） */
  let restartPromise = null;
  let restartAttempt = 0;
  /** 就绪度快照（status 透出，便于设置页/排障）：readyConnections=0 即"进程活着但边缘失联" */
  const tunnelHealth = { readyConnections: null, consecutiveFailures: 0, restarts: 0, lastCheckAt: null, lastError: '' };
  /** 只告警一次：隧道实现未提供 metrics 端口（自愈不可用） */
  let warnedNoMetrics = false;
  /** 启动宽限：刚就绪时边缘注册可能尚未完成，宽限期内探活失败不计数（首次成功即结束） */
  let healthWarm = false;
  let healthWarmDeadline = 0;
  /** 连续健康起点（首次探活成功时间）：持续健康达到 healthStableMs 才清零重建预算 */
  let healthStableSince = null;
  /** 重建代际：stopTunnel/手动重开时 +1，让仍在退避等待的旧 loop 立即失效（评审重要 1） */
  let restartGeneration = 0;
  /** 当前退避等待的取消函数：停止重连时立即唤醒，不必干等最长 120s */
  let cancelRestartSleep = null;
  /** /ready 不可用（旧版自定义 cloudflared 返回 404）：关闭就绪自愈，绝不因此重建可用隧道 */
  let readinessUnsupported = false;
  let warnedReadyUnsupported = false;
  /** 二维码缓存：URL → data URL promise。status() 每 3 秒轮询一次，不能每次都重新生成（CPU 密集）。 */
  const qrCache = new Map();
  const encodeQr = internals.encodeQr ?? qrDataUrl;
  async function qrCached(text) {
    if (!text) return null;
    if (!qrCache.has(text)) {
      if (qrCache.size >= 8) {
        // 只淘汰最旧一条（隧道 URL 每次重启换新），别殃及稳定的 LAN 二维码
        const oldest = qrCache.keys().next().value;
        qrCache.delete(oldest);
      }
      qrCache.set(text, encodeQr(text).catch((err) => {
        const code = err?.code ?? 'UNKNOWN';
        const detail = err?.message ?? String(err);
        logWarn('dsh-pocket: QR generation failed (%s): %s | 二维码生成失败（%s）：%s', code, detail, code, detail);
        return null;
      }));
    }
    return qrCache.get(text);
  }

  // 公网隧道自动恢复（issue #11）：DSH 重启后 cloudflared 子进程被杀、隧道消失，
  // 插件无从知晓。启动时检查持久化的「隧道开启中」标记，自动重新拉起。
  const autoStatePath = home ? join(home, 'dsh-pocket', 'tunnel-auto.json') : null;
  // 写入与删除必须串行：隧道刚就绪就立即关闭时，异步写不能晚于删除重新落盘，
  // 否则标记被晚到的写操作复活，下次启动误恢复（writeFile 与 rm 的完成顺序不保证）。
  let autoStateQueue = Promise.resolve();
  function persistAutoTunnel() {
    if (!autoStatePath) return;
    autoStateQueue = autoStateQueue.then(async () => {
      try {
        await mkdir(dirname(autoStatePath), { recursive: true });
        await writeFile(autoStatePath, JSON.stringify({ at: Date.now() }), 'utf8');
      } catch { /* 忽略 */ }
    });
    return autoStateQueue;
  }
  function clearAutoTunnel() {
    if (!autoStatePath) return;
    autoStateQueue = autoStateQueue.then(async () => {
      try { await rm(autoStatePath, { force: true }); } catch { /* 忽略 */ }
    });
    return autoStateQueue;
  }

  // ---------- 就绪度监督 / 自愈 ----------
  // 背景（2026-11 实测故障）：cloudflared 进程还活着、metrics 端口照常应答，但它与
  // Cloudflare 边缘的连接已全部失效（/ready 返回 readyConnections=0），手机上打开公网
  // 地址得到 Cloudflare 1016/1033/530，而插件只监听「进程退出」→ 界面永远显示"已开启"，
  // 不会自愈，只能手动关开。这里按 /ready 轮询判定就绪度：连续 N 次失败即自动重建隧道。
  // 快速隧道重建会换新地址（并轮换访问密码，旧地址作废）；命名隧道地址不变，恢复即可用。
  const probeReady = internals.probeReady ?? probeTunnelReady;
  let healthTimer = null;

  function clearHealthTimer() {
    if (healthTimer) { clearTimeout(healthTimer); healthTimer = null; }
  }
  function resetHealthCounters() {
    tunnelHealth.consecutiveFailures = 0;
    tunnelHealth.lastError = '';
  }
  /** 清零重建预算（只由「用户手动开启」或「稳定健康达 healthStableMs」触发）。 */
  function resetRestartBudget() {
    restartAttempt = 0;
    healthStableSince = null;
  }
  /** 计划下一次探活（一次结束后再排下一次，避免重入/堆积；用户关闭或隧道为空时停排）。 */
  function scheduleHealthCheck(delay = healthCheckIntervalMs) {
    clearHealthTimer();
    if (!(healthCheckIntervalMs > 0) || readinessUnsupported) return;
    healthTimer = setTimeout(() => {
      healthTimer = null;
      void api.checkTunnelHealth().catch(() => {}).finally(() => {
        if (tunnelWanted && tunnel) scheduleHealthCheck();
      });
    }, Math.max(0, delay));
    healthTimer.unref?.();
  }
  /** 可取消的退避等待：用户「停止重连/手动重开」时立即打断，不必干等最长 120s。 */
  function cancellableSleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { cancelRestartSleep = null; resolve(); }, Math.max(0, ms));
      timer.unref?.();
      cancelRestartSleep = () => {
        clearTimeout(timer);
        cancelRestartSleep = null;
        resolve();
      };
    });
  }
  function interruptRestartSleep() {
    const cancel = cancelRestartSleep;
    cancelRestartSleep = null;
    cancel?.();
  }

  /** 杀掉当前隧道进程（不删自动恢复标记——自愈重建不是用户主动关闭）。 */
  function killTunnelProcess() {
    clearHealthTimer();
    // 稳定计时不能跨隧道实例：旧隧道稳定运行很久后崩溃，新隧道的第一次探活成功
    // 不应把旧稳定期算到自己头上、从而立刻清零重建预算。
    healthStableSince = null;
    tunnelAbort?.abort();
    tunnelAbort = null;
    tunnelPromise = null;
    if (tunnel) tunnel.kill();
    tunnel = null;
  }

  /**
   * 自动重建隧道（就绪探活失败 / 进程异常退出触发）。
   * 单飞 + 退避 + 跨事件累计预算 + 可取消（stopTunnel/手动重开会中断退避等待）。
   */
  async function restartTunnel(reason) {
    if (!tunnelWanted) return undefined;
    if (restartPromise) return restartPromise;
    const generation = restartGeneration;
    const cancelled = () => generation !== restartGeneration || !tunnelWanted;
    const my = (async () => {
      if (cancelled()) return undefined; // 双检：准备期间用户已经关掉/重开
      killTunnelProcess();
      healthWarm = false;
      tunnelState.phase = 'restarting';
      tunnelState.detail = `隧道连接已失效（${reason}），正在自动重连… | tunnel lost (${reason}), reconnecting…`;
      tunnelState.startedAt = Date.now();
      tunnelHealth.consecutiveFailures = 0;
      // 预算跨「自愈事件」累计：快速隧道每次重建都会换地址/轮换密码，若隧道能启动但很快
      // 又失效（或 /ready 永远不健康），不能每轮都重置——否则等于无限重建。只有隧道连续
      // 健康运行 healthStableMs（默认 10 分钟）或用户手动重新开启，才清零预算。
      while (restartAttempt < healthMaxRestarts) {
        restartAttempt += 1;
        const backoff = healthRestartBackoffMs[Math.min(restartAttempt - 1, healthRestartBackoffMs.length - 1)] ?? 0;
        logWarn('dsh-pocket: tunnel unhealthy (%s) — rebuilding in %dms (attempt %d/%d) | 隧道失联，%dms 后自动重建（第 %d/%d 次）',
          reason, backoff, restartAttempt, healthMaxRestarts, backoff, restartAttempt, healthMaxRestarts);
        if (backoff > 0) await cancellableSleep(backoff);
        if (cancelled()) return undefined; // 等待期间用户停止/手动重开
        try {
          // 注意：这里不走公开的 startTunnel()（那是用户手动开启，会重置预算），
          // 只做「代理就绪 + 拉起隧道」，保留累计预算。
          await api.startProxy();
          if (cancelled()) return undefined;
          const url = await api.ensureTunnel();
          if (cancelled()) return undefined;
          tunnelHealth.restarts += 1;
          tunnelHealth.readyConnections = null;
          resetHealthCounters();
          logInfo('dsh-pocket: tunnel auto-rebuilt | 隧道已自动重建（公网地址：%s）', url ?? '');
          return url;
        } catch (err) {
          if (cancelled()) return undefined; // stopTunnel 中断启动：不算失败、不再重试
          tunnelHealth.lastError = err?.message ?? String(err);
          logWarn('dsh-pocket: tunnel rebuild failed (attempt %d/%d): %s | 隧道自动重建失败（第 %d/%d 次）：%s',
            restartAttempt, healthMaxRestarts, tunnelHealth.lastError,
            restartAttempt, healthMaxRestarts, tunnelHealth.lastError);
        }
      }
      if (cancelled()) return undefined;
      logWarn('dsh-pocket: tunnel self-heal gave up after %d consecutive rebuilds: %s | 隧道连续 %d 次自愈重建仍未恢复，已停手：%s',
        healthMaxRestarts, tunnelHealth.lastError, healthMaxRestarts, tunnelHealth.lastError);
      tunnelState.phase = 'error';
      tunnelState.detail = `隧道自动重建失败（连续 ${healthMaxRestarts} 次未恢复）：${tunnelHealth.lastError}`
        + ` | tunnel auto-restart failed after ${healthMaxRestarts} consecutive attempts: ${tunnelHealth.lastError}`;
      tunnelState.startedAt = null;
      return undefined;
    })();
    restartPromise = my;
    try {
      return await my;
    } finally {
      // 只清自己的 promise：stop 后立刻重开时，新的 restartTunnel 可能已经建了新的 in-flight
      if (restartPromise === my) restartPromise = null;
    }
  }

  const api = {
    dshPort,
    /** 启动局域网代理（幂等）。端口被占（EADDRINUSE，如桌面版与普通环境同时运行）时自动尝试下一个端口。 */
    async startProxy() {
      if (proxy) return proxy;
      let lastErr = null;
      for (let p = port; p < port + 10; p++) {
        try {
          proxy = await createProxy({
            port: p,
            host: '0.0.0.0',
            upstream: { host: '127.0.0.1', port: dshPort },
            ...(injectHtml ? { injectHtml } : {}),
            ...(auth ? { auth } : {}),
            // 每次请求实时读开关：设置页切换后立即生效，无需重启代理
            lanAccessEnabled: () => getLanEnabled(),
            // dsh web 浏览器会话启动 token（issue #77）：实时取，新版 dsh 才有
            ...(launchToken ? { launchToken } : {}),
          });
          if (p !== port) {
            logInfo(`dsh-pocket: port ${port} busy, proxy on ${p} | 端口 ${port} 被占用，代理改用 ${p}`);
          }
          break;
        } catch (err) {
          if (err?.code !== 'EADDRINUSE') throw err; // 非端口冲突直接失败
          lastErr = err;
        }
      }
      if (!proxy) throw lastErr ?? new Error('proxy start failed | 代理启动失败');
      return proxy;
    },

    /** 启动公网隧道（幂等；返回公网 URL）。进度写进 tunnelState。并发调用单飞。 */
    async startTunnel() {
      tunnelWanted = true; // 用户明确希望隧道开着（自愈只在此前提下进行）
      // 用户手动开启 = 新一轮：作废仍在退避/重建中的旧自愈 loop（避免陈旧 restartPromise
      // 延迟新故障的恢复），并中断退避等待；预算清零。
      restartGeneration += 1;
      interruptRestartSleep();
      resetRestartBudget();
      await api.startProxy();
      return api.ensureTunnel();
    },

    /**
     * 实际拉起隧道进程（单飞，不改变用户意图）。
     * 就绪后启动就绪度探活；进程异常退出时按需自动重建。
     */
    async ensureTunnel() {
      if (tunnel) return tunnel.url;
      if (tunnelPromise) return tunnelPromise; // 复用 in-flight，防孤儿 cloudflared
      const controller = new AbortController();
      tunnelAbort = controller;
      tunnelState.startedAt = Date.now();
      const onPhase = (phase) => {
        if (controller.signal.aborted) return; // 停止后的晚到进度不能把状态刷回 ready
        tunnelState.phase = phase;
        if (phase === 'downloading') tunnelState.detail = '首次下载 cloudflared（约 20MB）| first run downloads cloudflared (~20MB)';
        else if (phase === 'starting') tunnelState.detail = '启动隧道进程… | starting tunnel…';
        else if (phase === 'registering') tunnelState.detail = '连接 Cloudflare 边缘（通常 5-30 秒）| connecting to Cloudflare edge (usually 5-30s)';
        else if (phase === 'ready') tunnelState.detail = '隧道就绪 | ready';
      };
      // 先 `await null` 让函数体从微任务开始执行：否则在 `p` 初始化之前（getTunnelConfig
      // 之类的同步抛错）就会走到 finally，引用未初始化的 const 触发 TDZ 报错，
      // tunnelPromise 会永久停在 rejected —— 此后 startTunnel 一直复用这个失败的
      // promise，隧道再也起不来。
      const p = (async () => {
        await null;
        try {
          // 命名隧道（issue #66）：固定域名模式——URL 由设置里的域名拼出（cloudflared 不打印）
          const cfg = typeof getTunnelConfig === 'function' ? (getTunnelConfig() ?? {}) : {};
          let result;
          if (cfg?.mode === 'named') {
            if (!cfg.token || !cfg.hostname) {
              throw new Error(
                '命名隧道未配置完整：需要 Tunnel Token 和固定域名（设置页「固定域名」里填写） | '
                + 'named tunnel is incomplete — set the Tunnel Token and the fixed hostname in Settings',
              );
            }
            result = await startNamed({ token: cfg.token, home, signal: controller.signal, onPhase });
          } else {
            result = await startTunnel({ port: proxy.port, home, signal: controller.signal, onPhase });
          }
          // 启动期间用户停止/取消：进程已经起来也必须杀掉，不能在停止后"复活"成 ready
          if (controller.signal.aborted) {
            try { result?.kill?.(); } catch { /* 忽略 */ }
            throw new Error('已取消 | cancelled');
          }
          if (cfg?.mode === 'named') {
            tunnel = { url: `https://${cfg.hostname}`, kill: result.kill, onExit: result.onExit, metricsPort: result.metricsPort };
          } else {
            // 归一化：startTunnel 契约返回 {url, kill}（字符串也兼容）
            tunnel = typeof result === 'string' ? { url: result, kill: () => {} } : result;
          }
          tunnelState.phase = 'ready';
          tunnelHealth.readyConnections = null;
          tunnelHealth.consecutiveFailures = 0;
          // 宽限期内（边缘注册完成前）探活失败不计数，避免把"正在注册"误判成"已失联"
          healthWarm = true;
          healthWarmDeadline = Date.now() + healthStartupGraceMs;
          // 进程运行中死亡（崩溃/被杀）：
          //   - 自愈开启（默认）→ 自动重建，别让界面停在"可用"；
          //   - 自愈关闭（healthCheckIntervalMs<=0，测试/兼容）→ 旧行为：状态打回 error。
          tunnel.onExit?.((code) => {
            if (controller.signal.aborted) return; // 主动停止（stopTunnel/重建前 kill）不算故障
            clearHealthTimer();
            tunnel = null;
            if (tunnelWanted && healthCheckIntervalMs > 0) {
              logWarn('dsh-pocket: tunnel process exited (code=%s) — auto-rebuilding | 隧道进程退出（code=%s），自动重建', code, code);
              // 记下失败原因：进程退出类失败没有异常对象，最终 error 文案需要它
              tunnelHealth.lastError = `process-exit:${code}`;
              void restartTunnel(`process-exit:${code}`).catch((err) => {
                logWarn('dsh-pocket: auto-rebuild crashed: %s | 自动重建异常：%s', err?.message ?? err, err?.message ?? err);
              });
              return;
            }
            tunnelState.phase = 'error';
            tunnelState.detail = `隧道进程退出（code=${code}） | tunnel process exited (code=${code})`;
          });
          // 记录「隧道开启中」，供重启后自动恢复（issue #11）
          void persistAutoTunnel();
          // 公网隧道就绪 → 回调（快速模式轮换访问密码；命名模式不轮换，见 lib/index.js）
          try { onTunnelReady?.(cfg?.mode === 'named' ? 'named' : 'quick'); } catch { /* 忽略 */ }
          // 就绪度探活：只有拿得到 metrics 端口才启用（假隧道/旧实现没有该字段）
          readinessUnsupported = false; // 每个新隧道重新探测一次 /ready 能力
          if (tunnel.metricsPort && healthCheckIntervalMs > 0) scheduleHealthCheck();
          else if (!warnedNoMetrics && healthCheckIntervalMs > 0) {
            warnedNoMetrics = true;
            logWarn(NO_METRICS_WARN);
          }
          return tunnel.url;
        } catch (err) {
          // stopTunnel 触发的 abort 不算错误：保持 idle，别把状态刷成 error
          if (!controller.signal.aborted) {
            tunnelState.phase = 'error';
            tunnelState.detail = err?.message ?? String(err);
          }
          tunnelState.startedAt = null; // 失败后清掉计时，避免 UI 误显"启动中"
          throw err;
        } finally {
          // 只清自己的引用：stopTunnel 后立即 startTunnel 可能已建了新的 in-flight
          // （tunnelPromise=B），A 的 finally 不能把 B 清掉，否则第三次调用会并发 spawn
          if (tunnelPromise === p) tunnelPromise = null;
        }
      })();
      tunnelPromise = p;
      return p;
    },

    /**
     * 单轮就绪度探活（正式运行由定时器驱动；测试可直接调用）。
     *
     * `/ready` 返回 `readyConnections=0` 即"进程活着但边缘注册已丢失"——手机端表现为
     * Cloudflare 1016（Origin DNS error）/1033/530。连续 healthCheckFailures 次失败后
     * 自动重建隧道；成功一次即清零，避免单次网络抖动误换地址。
     * @returns {Promise<{readyConnections:number|null, consecutiveFailures:number, restarts:number, lastCheckAt:number|null, lastError:string}>}
     */
    async checkTunnelHealth() {
      if (!tunnelWanted || !tunnel || tunnelState.phase !== 'ready') return { ...tunnelHealth };
      const metricsPort = tunnel.metricsPort;
      if (!metricsPort) {
        if (!warnedNoMetrics && healthCheckIntervalMs > 0) {
          warnedNoMetrics = true;
          logWarn(NO_METRICS_WARN);
        }
        return { ...tunnelHealth };
      }
      const currentTunnel = tunnel;
      const result = await probeReady({ port: metricsPort });
      // 探活期间隧道可能已被停止/重建：旧结果不能污染新隧道或停止后的健康快照
      if (tunnel !== currentTunnel || !tunnelWanted) return { ...tunnelHealth };
      if (result.unsupported) {
        // 旧版自定义 cloudflared 没有 /ready：只关闭就绪自愈，绝不因此重建本来可用的隧道
        readinessUnsupported = true;
        clearHealthTimer();
        if (!warnedReadyUnsupported) {
          warnedReadyUnsupported = true;
          logWarn('dsh-pocket: metrics /ready unsupported (HTTP 404) — readiness self-heal disabled, tunnel kept running | '
            + 'metrics /ready 不可用（HTTP 404），就绪自愈已关闭（隧道保持运行）');
        }
        return { ...tunnelHealth };
      }
      tunnelHealth.lastCheckAt = Date.now();
      tunnelHealth.readyConnections = result.readyConnections;
      if (result.ok) {
        healthWarm = false; // 首次就绪：宽限期提前结束
        tunnelHealth.consecutiveFailures = 0;
        tunnelHealth.lastError = '';
        // 预算复位：连续健康满 healthStableMs 才清零（避免"刚重建成功又被判死"反复烧预算）
        if (healthStableSince === null) healthStableSince = Date.now();
        if (restartAttempt > 0 && (healthStableMs <= 0 || Date.now() - healthStableSince >= healthStableMs)) {
          logInfo('dsh-pocket: tunnel stable for %dms — restart budget reset | 隧道已稳定运行，自愈预算清零', Date.now() - healthStableSince);
          resetRestartBudget();
        }
        return { ...tunnelHealth };
      }
      healthStableSince = null; // 探活失败：稳定计时作废
      // 启动宽限：刚打印 URL 时注册尚在建立（/ready 暂时 0），这段时间失败不计数
      if (healthWarm) {
        if (Date.now() < healthWarmDeadline) return { ...tunnelHealth };
        healthWarm = false; // 宽限到点仍未就绪 → 从本轮开始正常计数
      }
      tunnelHealth.consecutiveFailures += 1;
      tunnelHealth.lastError = result.error || `readyConnections=0 (HTTP ${result.status})`;
      logWarn('dsh-pocket: tunnel readiness check failed (%d/%d): %s | 隧道就绪探活失败（%d/%d）：%s',
        tunnelHealth.consecutiveFailures, healthCheckFailures, tunnelHealth.lastError,
        tunnelHealth.consecutiveFailures, healthCheckFailures, tunnelHealth.lastError);
      if (tunnelHealth.consecutiveFailures >= healthCheckFailures) {
        logWarn('dsh-pocket: tunnel readiness lost — auto-rebuilding | 隧道就绪探活连续失败，判定失联，自动重建');
        await restartTunnel('readiness');
      }
      return { ...tunnelHealth };
    },

    /**
     * 停止公网隧道（代理保持）。
     * @param {{ keepAutoMarker?: boolean }} [opts] - keepAutoMarker=true 用于进程退出/
     *   自重启（dispose / pocketRestart）：隧道是随进程被动消失的，不是用户主动关闭，
     *   必须保留 tunnel-auto.json，下次启动才能自动恢复（issue #11 的本意）。
     *   默认（设置页手动关闭、恢复出厂）删除标记。
     */
    stopTunnel({ keepAutoMarker = false } = {}) {
      tunnelWanted = false; // 先置意图：正在等待退避的重建循环会据此退出
      restartGeneration += 1; // 作废旧自愈 loop（退避中/启动中都要立即失效）
      interruptRestartSleep();
      healthWarm = false;
      killTunnelProcess();
      tunnelState.phase = 'idle';
      tunnelState.detail = '';
      tunnelState.startedAt = null;
      tunnelHealth.readyConnections = null;
      resetHealthCounters();
      resetRestartBudget();
      if (!keepAutoMarker) void clearAutoTunnel(); // 手动关闭后不再自动恢复
    },

    /** 启动时自动恢复上次开启的公网隧道（DSH 重启后 cloudflared 子进程被杀，issue #11）。 */
    async restoreTunnelIfNeeded() {
      logInfo('dsh-pocket: auto-restore check | 自动恢复检查：读取上次隧道状态');
      if (!autoStatePath || tunnel || tunnelPromise) return;
      let has = false;
      try {
        const raw = await readFile(autoStatePath, 'utf8');
        has = /"at"\s*:/.test(raw);
      } catch { return; } // 无标记 → 不恢复
      if (!has) return;
      logInfo('dsh-pocket: auto-restore: marker found, starting tunnel | 发现上次开启标记，尝试自动恢复');
      try {
        await api.startTunnel();
        logInfo('dsh-pocket: public tunnel auto-restored | 已自动恢复公网隧道');
      } catch (err) {
        // 恢复失败保留标记（下次启动再试）；网络问题见 README 排障
        logWarn('dsh-pocket: tunnel auto-restore failed | 自动恢复隧道失败: %s', err?.message ?? err);
      }
    },

    /** 状态快照（RPC 返回，不含敏感信息；二维码 data URL 本地生成 + 缓存）。 */
    async status() {
      const lan = await getLan();
      const proxyPort = proxy?.port ?? null;
      const lanUrl = lan && proxyPort ? `http://${lan}:${proxyPort}` : null;
      const lanIpOverride = getLanOverride();
      const lanCandidates = [...new Set(await getLanCandidates())];
      if (lanIpOverride && !lanCandidates.includes(lanIpOverride)) lanCandidates.push(lanIpOverride);
      return {
        proxyRunning: proxy !== null,
        proxyPort,
        lanUrl,
        lanQr: await qrCached(lanUrl),
        lanCandidates,
        lanIpOverride,
        tunnelRunning: tunnel !== null,
        tunnelUrl: tunnel?.url ?? null,
        tunnelQr: await qrCached(tunnel?.url ?? null),
        tunnelState: { ...tunnelState },
        // 就绪度快照（自愈排障用）：readyConnections=0 表示"进程活着但边缘注册丢了"
        tunnelHealth: { ...tunnelHealth },
        // 隧道配置脱敏视图（issue #66）：token 永不回显，只有 tokenSet 布尔值
        tunnelConfig: (() => {
          const cfg = typeof getTunnelConfig === 'function' ? (getTunnelConfig() ?? {}) : {};
          return {
            mode: cfg?.mode === 'named' ? 'named' : 'quick',
            hostname: typeof cfg?.hostname === 'string' ? cfg.hostname : '',
            tokenSet: Boolean(cfg?.token),
          };
        })(),
        dshPort,
      };
    },

    /** 停止一切（插件卸载时）。进程退出不是用户手动关闭：保留自动恢复标记。 */
    async dispose() {
      clearHealthTimer();
      api.stopTunnel({ keepAutoMarker: true });
      if (proxy) {
        const p = proxy;
        proxy = null;
        try { await p.close(); } catch { /* server 已关闭等边缘情况 */ }
      }
    },
  };
  return api;
}
