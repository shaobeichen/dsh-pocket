// dsh-pocket 插件入口（单包单插件：手机扫码访问 DSH，全在这一个包里）
//
// 设置一级入口「手机访问」：
//   - 局域网二维码：自动显示（代理随插件启动）
//   - 公网二维码：点「开启公网」→ cloudflared 隧道 → 扫码即用，人在外面也能访问
//   - 更新提示：有新版本时显示一键更新按钮（dsh plugin update --latest）
// 手机看到的界面 = 电脑上的 dsh web，实时同步（WebSocket 透传）。
//
// 注：Web Push 已移除——浏览器推送依赖 Google FCM（Chrome）等境外服务，
// 国内直连被墙，普通用户用不了，且排障成本高。专注扫码同屏这一件事。

import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createPocketService } from './service.mjs';
import { installPocketRpc } from './web-rpc.js';
import { restartHost } from './restart.js';
import { desktopEnvPatchScript, advancedNoticeScript, DEFAULT_INJECT } from './proxy.mjs';
import { lanAuthEnabled, setLanAuthEnabled, lanIpOverride, setLanIpOverride, pinCustom, setPinCustom } from './settings.mjs';

const name = 'dsh-pocket';
const inject = ['connection', 'webServer'];

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));

/**
 * 本插件磁盘上的已安装版本。注意：**不能用 require 缓存**（进程内永远不变），
 * 必须实时读文件——一键更新会改写 package.json，「已更新未重启」靠它识别。
 */
function currentVersion() {
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

/** 进程启动时加载的版本（模块加载瞬间固化；用于识别「磁盘已更新但进程还是旧代码」）。 */
const loadedVersion = currentVersion();

// ---------- 访问密码（issue #13 + #18 + #33） ----------
// 公网与局域网**分开**：各自 8 位数字，存本机 $DSH_HOME/dsh-pocket/。
// 公网密码（token）：默认每次开启公网时轮换（旧链接作废）；**用户自定义后不再轮换**；
// 局域网密码（token-lan）：默认手动刷新（设置页按钮）；自定义后刷新会换回随机值。
// 会话保持（issue #33）：登录 cookie 绑定进程级 sessionKey（见 apply）——
// dsh web 重启/更新后 sessionKey 变化 → 手机需重新输入。
const PIN_RE = /^\d{8}$/;
function writePinToFile(p, fresh) {
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, fresh, { mode: 0o600 });
  } catch { /* 忽略 */ }
  return fresh;
}
function readPin(p) {
  try {
    const existing = readFileSync(p, 'utf8').trim();
    if (PIN_RE.test(existing)) return existing;
  } catch { /* 无文件 */ }
  return null;
}
function newPin() {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

// --- 公网密码 ---
const tokenRel = join('dsh-pocket', 'token');
function tokenPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), tokenRel);
}
/** 当前公网访问密码；文件不存在时生成一个。 */
export function getAccessToken() {
  return readPin(tokenPath()) ?? writePinToFile(tokenPath(), newPin());
}
/** 轮换公网密码（开启公网时调用）。用户自定义后不再轮换（尊重自定义值）。 */
export function rotateAccessToken() {
  if (pinCustom('public')) return getAccessToken();
  return writePinToFile(tokenPath(), newPin());
}

// --- 局域网密码（issue #18：局域网与公网分开，手动刷新） ---
const lanTokenRel = join('dsh-pocket', 'token-lan');
function lanTokenPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), lanTokenRel);
}
/** 当前局域网访问密码；文件不存在时生成一个。 */
function getLanToken() {
  return readPin(lanTokenPath()) ?? writePinToFile(lanTokenPath(), newPin());
}
/** 刷新局域网密码（设置页按钮触发，旧密码立即作废）；换新后清除自定义标记。 */
function refreshLanToken() {
  setPinCustom('lan', false);
  return writePinToFile(lanTokenPath(), newPin());
}
/** 按 Host 分发的访问密码：公网隧道用公网密码，局域网用局域网密码。 */
function tokenForHost(host) {
  return /trycloudflare\.com$/i.test(String(host ?? '')) ? getAccessToken() : getLanToken();
}
/**
 * 用户自定义访问密码（issue #33）：公网/局域网各自设一个固定的 8 位数字。
 * 自定义后公网开启时不再自动轮换（rotateAccessToken 见上）。
 * 非法输入（非 8 位数字）抛错，由 RPC 层转成错误响应。
 */
export function setCustomPin(which, value) {
  const v = String(value ?? '').trim();
  if (!PIN_RE.test(v)) throw new Error('密码必须是 8 位数字 | PIN must be exactly 8 digits');
  if (which === 'public') {
    writePinToFile(tokenPath(), v);
    setPinCustom('public', true);
    return v;
  }
  if (which === 'lan') {
    writePinToFile(lanTokenPath(), v);
    setPinCustom('lan', true);
    return v;
  }
  throw new Error('未知密码类型 | unknown PIN kind');
}

const restartNoticeRel = join('dsh-pocket', 'restarted.json');
function restartNoticePath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), restartNoticeRel);
}
async function readRestartNotice() {
  try {
    const raw = JSON.parse(await readFile(restartNoticePath(), 'utf8'));
    if (!raw?.at) return null;
    if (Date.now() - raw.at > 30 * 60 * 1000) return null; // 30 分钟后过期
    return raw;
  } catch { return null; }
}
function writeRestartNotice() {
  return mkdir(dirname(restartNoticePath()), { recursive: true })
    .then(() => writeFile(restartNoticePath(), JSON.stringify({ at: Date.now(), pid: process.pid }), 'utf8'));
}
/**
 * 读重启标记并**删除**（一次性消费）：重启后首次打开设置页显示一次「已重启」横幅，
 * 之后不再出现——否则残留文件会让「已重启」一直显示（用户没点重启也误报）。
 */
async function consumeRestartNotice() {
  const notice = await readRestartNotice();
  if (notice) {
    await rm(restartNoticePath(), { force: true }).catch(() => {});
  }
  return notice;
}
/**
 * 自重启。
 * 顺序很重要：先拉起 helper（失败就如实返回，不写标记、不停隧道）→ 停公网隧道
 * （否则孤儿 cloudflared 让旧公网 URL 永活，与「重启即换 URL 作废」的宣传矛盾）→
 * 写重启标记（新进程据此显示一次「已重启」横幅）。
 */
function pocketRestart(service) {
  const result = restartHost();
  if (!result || result.helperPid == null) return result; // helper 都没 spawn 出来 → 失败
  try { service?.stopTunnel(); } catch { /* 忽略 */ }
  writeRestartNotice().catch(() => {});
  return result;
}

/** 执行更新：dsh plugin --profile <p> update dsh-pocket --latest -w（超时保护）。 */
function performUpdate(profile, { timeoutMs = 180_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('dsh', ['plugin', '--profile', profile, 'update', 'dsh-pocket', '--latest', '-w'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (c) => { out += String(c); if (out.length > 4000) out = out.slice(-4000); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, output: out.slice(-800) });
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

export function apply(ctx, config = {}, internals = {}) {
  const logger = ctx.logger?.(name) ?? console;
  const dshPort = internals.dshPort ?? ctx.webServer?.port;
  if (!dshPort) {
    logger.error('dsh-pocket: webServer port unavailable — cannot start proxy | 拿不到 dsh web 端口，无法启动代理');
    return () => {};
  }

  // 桌面端环境识别（官方兼容模式，见 desktop 的 plugin-development.md）：
  // desktopProfiles / desktopPnpm 只在 DSH Desktop（Electron）里存在。
  // 桌面端有自己的更新/进程管理，我们这两项功能在此环境**关闭**（不删除），
  // 避免与 desktopPnpm / Electron 进程模型冲突；扫码同屏等正常功能照常。
  const isDesktop = internals.isDesktop !== undefined
    ? internals.isDesktop === true
    : ctx.get?.('desktopProfiles') !== undefined || ctx.get?.('desktopPnpm') !== undefined;
  if (isDesktop) {
    logger.info('dsh-pocket: DSH Desktop detected — update/restart disabled here | 检测到桌面端环境，更新/重启已关闭');
  }

  // 桌面端 advanced 模式检测（issue #19）：dsh-plugin-desktop 的 mode 配置存在
  // $DSH_HOME/settings.yaml 的 dsh-plugin-desktop 命名空间下。advanced 组合禁用网页版
  // ui-layout、手机页面又拿不到桌面 layout → 手机访问白屏，这里注入覆盖层提示用户切回。
  const desktopAdvanced = isDesktop && (() => {
    try {
      const raw = readFileSync(join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'settings.yaml'), 'utf8');
      return /dsh-plugin-desktop\s*:\s*[\s\S]{0,300}?mode\s*:\s*advanced/i.test(raw);
    } catch { return false; }
  })();
  if (desktopAdvanced) {
    logger.warn('dsh-pocket: DSH Desktop advanced mode — phone access unsupported, injecting notice | 桌面端 advanced 模式：手机访问暂不支持，已注入提示');
  }

  const service = internals.service ?? createPocketService({
    dshPort,
    port: internals.port ?? config.port ?? 3081,
    home: internals.home,
    internals,
    getLanIpOverride: () => lanIpOverride(),
    // 桌面端：手机扫码访问的页面缺 dsh-desktop-mode/platform 参数会让 dsh-plugin-desktop
    // client 崩溃（issue #3/#4）。给代理注入「桌面参数补丁」（history.replaceState 补齐参数，
    // 无跳转；compatibility 模式不套桌面布局，避免移动端按钮叠加）。保留默认 polyfill。
    // advanced 模式再加警告覆盖层（issue #19）。
    injectHtml: isDesktop
      ? DEFAULT_INJECT + desktopEnvPatchScript(process.platform) + (desktopAdvanced ? advancedNoticeScript() : '')
      : undefined,
    // 访问密码（issue #13 + #18 + #24 + #33）：公网永远要密码（默认每次开启变新，
    // 用户自定义后不再轮换）；局域网按开关（默认开启；关闭后局域网扫码直连）。
    auth: {
      // sessionKey：进程级随机密钥——登录 cookie 绑定它（会话保持，issue #33）：
      // dsh web 重启/更新后 sessionKey 变化 → 手机需重新输入
      sessionKey: randomBytes(16).toString('hex'),
      getToken: (host) => tokenForHost(host),
      isProtected: (host) => /trycloudflare\.com$/i.test(String(host ?? '')) ? true : lanAuthEnabled(),
    },
    // 每次公网隧道就绪 → 轮换 8 位密码（旧密码/旧链接立即作废；用户自定义后不轮换）
    onTunnelReady: () => {
      const fresh = rotateAccessToken();
      logger.info('dsh-pocket: public access PIN refreshed | 公网访问密码已更新（自定义密码不受影响）');
      return fresh;
    },
  });

  const disposers = [];
  const disposeRpc = installPocketRpc(ctx, {
    service,
    desktop: isDesktop,
    getToken: () => getAccessToken(),
    getLanToken: () => getLanToken(),
    refreshLanToken: () => refreshLanToken(),
    getLanAuthEnabled: () => lanAuthEnabled(),
    setLanAuthEnabled: (on) => setLanAuthEnabled(on),
    getLanIpOverride: () => lanIpOverride(),
    setLanIpOverride: (ip) => setLanIpOverride(ip),
    getPinCustom: (which) => pinCustom(which),
    setCustomPin: (which, value) => setCustomPin(which, value),
    runUpdate: internals.runUpdate ?? { currentVersion, perform: performUpdate, loadedVersion: () => loadedVersion },
    restart: internals.restart ?? (() => pocketRestart(service)),
    restartNotice: internals.restartNotice ?? consumeRestartNotice,
    log: logger,
  });
  disposers.push(disposeRpc);

  // 代理随插件自动启动（局域网二维码开箱即用，零配置）
  void service.startProxy().then((proxy) => {
    logger.info('dsh-pocket: proxy ready on :%d | 局域网代理已就绪', proxy.port);
    // 自动恢复上次开启的公网隧道（DSH 重启后 cloudflared 子进程被杀，issue #11）
    void service.restoreTunnelIfNeeded?.().catch(() => {});
  }).catch((err) => {
    logger.error('dsh-pocket: proxy start failed | 代理启动失败: %s', err?.message ?? err);
  });

  ctx.effect(() => async () => {
    for (const d of disposers.reverse()) { try { d(); } catch { /* 忽略 */ } }
    await service.dispose();
  }, 'dsh-pocket: stop proxy and tunnel');
}

export { name, inject, readRestartNotice, consumeRestartNotice };
