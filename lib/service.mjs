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
import { startQuickTunnel } from './tunnel.mjs';
import { isValidIpv4 } from './ip.mjs';

const require = createRequire(import.meta.url);

/** URL → 二维码 data URL（浏览器 <img> 直接显示，全本地不依赖第三方）。 */
export async function qrDataUrl(text, { width = 220, margin = 1 } = {}) {
  const QRCode = require('qrcode');
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin, width, type: 'image/png' });
}

/** RFC1918 私网地址：手机与电脑连同一局域网时通常可直连。 */
const PRIVATE_IPV4_RE = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

/** 名称像真实物理网卡的接口（WLAN / Wi-Fi / Ethernet / 以太网 / en / eth）。 */
const PHYSICAL_IFACE_RE = /^(?:wlan|wi-?fi|wireless|ethernet|eth\d|en\d|wlp\d|以太网|本地连接)/i;

/** 常见的 VPN / 虚拟网卡名称：手机通常无法通过它们直连电脑。 */
const VPN_IFACE_RE = /(?:radmin|tailscale|zerotier|tun|tap|vpn|vethernet|virtual|vmware|virtualbox|wsl|docker|teredo|hamachi|bluetooth|bridge)/i;

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
 * @returns {string|null}
 */
export function selectLanIPv4(interfaces) {
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces ?? {})) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      // 排除 loopback 与 link-local；其余地址即使不是私网（如 Radmin 的 26.x）也保留兜底
      if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue;

      let score = 0;
      if (PRIVATE_IPV4_RE.test(ip)) score += 100;
      if (PHYSICAL_IFACE_RE.test(name)) score += 20;
      else if (VPN_IFACE_RE.test(name)) score -= 50;

      candidates.push({ ip, score, order: candidates.length });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
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
  return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP || process.env.WSLENV);
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
  // WSL：优先 Windows 物理网卡 IP（手机可达）；超时/失败回退本机探测
  if (detectWsl()) {
    try {
      const out = await runIpconfig();
      const candidates = parseIpconfig(out ?? '');
      const ip = candidates.find((c) => PRIVATE_IPV4_RE.test(c)) ?? candidates[0];
      if (ip) return ip;
    } catch { /* 回退 */ }
  }
  return selectLanIPv4(networkInterfaces());
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
  /** 代理注入 HTML 的内容（桌面端补丁等由 lib/index.js 传入；默认 randomUUID polyfill） */
  injectHtml,
  /** 访问令牌认证配置（issue #13）：{ getToken, isProtected }，传给代理 */
  auth,
  /** 隧道就绪回调（lib/index.js 用它轮换公网密码） */
  onTunnelReady,
} = {}) {
  const createProxy = internals.createProxy ?? createPocketProxy;
  const startTunnel = internals.startTunnel ?? startQuickTunnel;
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
  /** 隧道进度：{ phase: idle|downloading|starting|registering|ready|error, detail, startedAt } */
  const tunnelState = { phase: 'idle', detail: '', startedAt: null };
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
      qrCache.set(text, encodeQr(text).catch(() => null));
    }
    return qrCache.get(text);
  }

  // 公网隧道自动恢复（issue #11）：DSH 重启后 cloudflared 子进程被杀、隧道消失，
  // 插件无从知晓。启动时检查持久化的「隧道开启中」标记，自动重新拉起。
  const autoStatePath = home ? join(home, 'dsh-pocket', 'tunnel-auto.json') : null;
  async function persistAutoTunnel() {
    if (!autoStatePath) return;
    try {
      await mkdir(dirname(autoStatePath), { recursive: true });
      await writeFile(autoStatePath, JSON.stringify({ at: Date.now() }), 'utf8');
    } catch { /* 忽略 */ }
  }
  async function clearAutoTunnel() {
    if (!autoStatePath) return;
    try { await rm(autoStatePath, { force: true }); } catch { /* 忽略 */ }
  }

  return {
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
          });
          if (p !== port) {
            console.log(`dsh-pocket: port ${port} busy, proxy on ${p} | 端口 ${port} 被占用，代理改用 ${p}`);
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
      await this.startProxy();
      if (tunnel) return tunnel.url;
      if (tunnelPromise) return tunnelPromise; // 复用 in-flight，防孤儿 cloudflared
      const controller = new AbortController();
      tunnelAbort = controller;
      tunnelState.startedAt = Date.now();
      const onPhase = (phase) => {
        tunnelState.phase = phase;
        if (phase === 'downloading') tunnelState.detail = '首次下载 cloudflared（约 20MB）| first run downloads cloudflared (~20MB)';
        else if (phase === 'starting') tunnelState.detail = '启动隧道进程… | starting tunnel…';
        else if (phase === 'registering') tunnelState.detail = '连接 Cloudflare 边缘（通常 5-30 秒）| connecting to Cloudflare edge (usually 5-30s)';
        else if (phase === 'ready') tunnelState.detail = '隧道就绪 | ready';
      };
      tunnelPromise = (async () => {
        try {
          const result = await startTunnel({ port: proxy.port, home, signal: controller.signal, onPhase });
          // 归一化：startTunnel 契约返回 {url, kill}（字符串也兼容）
          tunnel = typeof result === 'string' ? { url: result, kill: () => {} } : result;
          tunnelState.phase = 'ready';
          // M1：隧道进程运行中死亡（崩溃/被杀）→ 状态打回，别让 UI 永远显示"可用"
          tunnel.onExit?.((code) => {
            if (controller.signal.aborted) return; // 主动停止（stopTunnel）不算故障
            tunnelState.phase = 'error';
            tunnelState.detail = `隧道进程退出（code=${code}）| tunnel process exited`;
          });
          // 记录「隧道开启中」，供重启后自动恢复（issue #11）
          void persistAutoTunnel();
          // 公网隧道就绪 → 轮换访问密码（issue #13：每次开启变新，旧链接作废）
          try { onTunnelReady?.(); } catch { /* 忽略 */ }
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
      const p = tunnelPromise;
      return tunnelPromise;
    },

    /** 停止公网隧道（代理保持）。 */
    stopTunnel() {
      tunnelAbort?.abort();
      tunnelAbort = null;
      tunnelPromise = null; // 丢弃已 abort 的 in-flight（其 finally 会再清一次，无害）
      if (tunnel) tunnel.kill();
      tunnel = null;
      tunnelState.phase = 'idle';
      tunnelState.detail = '';
      tunnelState.startedAt = null;
      void clearAutoTunnel(); // 手动关闭后不再自动恢复
    },

    /** 启动时自动恢复上次开启的公网隧道（DSH 重启后 cloudflared 子进程被杀，issue #11）。 */
    async restoreTunnelIfNeeded() {
      if (!autoStatePath || tunnel || tunnelPromise) return;
      let has = false;
      try {
        const raw = await readFile(autoStatePath, 'utf8');
        has = /"at"\s*:/.test(raw);
      } catch { return; } // 无标记 → 不恢复
      if (!has) return;
      try {
        await this.startTunnel();
        console.log('dsh-pocket: public tunnel auto-restored | 已自动恢复公网隧道');
      } catch (err) {
        // 恢复失败保留标记（下次启动再试）；网络问题见 README 排障
        console.warn('dsh-pocket: tunnel auto-restore failed | 自动恢复隧道失败: %s', err?.message ?? err);
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
        dshPort,
      };
    },

    /** 停止一切（插件卸载时）。 */
    async dispose() {
      this.stopTunnel();
      if (proxy) {
        const p = proxy;
        proxy = null;
        try { await p.close(); } catch { /* server 已关闭等边缘情况 */ }
      }
    },
  };
}
