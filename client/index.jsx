// dsh-pocket 网页客户端：
//   1. 设置页签「手机访问」（局域网/公网二维码 + 更新/重启提示）
//   2. 移动端适配（移植自 MIT 项目 dsh-web-mobile，见 client/mobile/LICENSE.dsh-web-mobile）
//
// 手机扫码打开的就是电脑上的 dsh web，实时同步；窄屏自动变成抽屉布局。
//
// 注：Web Push 已移除——浏览器推送依赖 Google FCM（Chrome）等境外服务，
// 国内直连被墙，普通用户用不了。专注扫码同屏这一件事。

import { createElement as h, useEffect, useState } from 'react';

import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS, redactStatus, compareVersions } from './api.js';
import { mobileApply } from './mobile/mobile-apply.tsx';
import { NS as POCKET_NS, zh as POCKET_ZH, en as POCKET_EN } from './pocket-locales.js';

const name = 'dsh-pocket';
const inject = ['slots', 'connection', 'layout', 'locale', 'sessionLogDownload'];

// 词典在 pocket-locales.js；这里只做「取 key → 替换 {占位符} → 字符串」。
// 不依赖 DSH t() 的插值能力，避免行为不一致。
function fmt(t, key, vars) {
  let s = t(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = String(s).split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

// 官方 DeepSeek Harness 设计系统（dsh-client-ui-theme design-platform.css）：
// 按钮 md=36px 胶囊形 / sm=28px；品牌色 --dsw-alias-brand-primary；
// hover 走 --dsw-alias-button-*-hover；间距 4px 栅格；正文 13px。
const styles = {
  card: { background: 'var(--dsw-alias-bg-layer-1,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', borderRadius: 12, padding: '16px 20px', maxWidth: 480 },
  block: { borderTop: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', marginTop: 16, paddingTop: 16 },
  muted: { color: 'var(--dsw-alias-label-tertiary,#8b93a1)', fontSize: 12, lineHeight: 1.5 },
  code: { fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, wordBreak: 'break-all', margin: '6px 0 10px', color: 'var(--dsw-alias-label-primary,inherit)' },
  // 主按钮：官方 md 胶囊形（36px）
  primary: { font: 'inherit', cursor: 'pointer', border: 'none', background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))', color: 'var(--dsw-alias-label-primary-foreground, #fff)', height: 36, padding: '0 16px', borderRadius: 999, fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  // 次级按钮：官方 outline/ghost 胶囊形
  btn: { font: 'inherit', cursor: 'pointer', border: '1px solid var(--dsw-alias-button-ghost-active-border, var(--dsw-alias-border-l2,#d1d5db))', background: 'var(--dsw-alias-bg-layer-1,#fff)', color: 'var(--dsw-alias-label-primary,inherit)', height: 36, padding: '0 16px', borderRadius: 999, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  qr: { width: 220, height: 220, borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', margin: '8px 0' },
  warn: { color: 'var(--dsw-alias-state-warn-primary,#b45309)', fontSize: 12, lineHeight: 1.5 },
};

function PocketSettingsTab({ rpcCall, t }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [tunnelState, setTunnelState] = useState(null); // 隧道进度 {phase, detail, startedAt}
  const [restartNotice, setRestartNotice] = useState(false); // 重启后提示
  const [updateInfo, setUpdateInfo] = useState(null); // { current, latest, updating, result, startedAt } | null
  const [isDesktop, setIsDesktop] = useState(false); // DSH Desktop（Electron）环境：更新/重启由桌面版管理
  const [now, setNow] = useState(Date.now()); // 每秒 tick，驱动倒计时

  // 进行中操作的「已等待 X 秒」倒计时
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = (startedAt) => (startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0);

  const call = async (endpoint, payload) => {
    const res = await rpcCall(endpoint, payload);
    if (!res?.ok) throw new Error(res?.error?.message ?? 'RPC failed');
    return res.value;
  };

  const load = async () => {
    try {
      const s = await call(POCKET_ENDPOINTS.status, {});
      setStatus(s);
      setTunnelState(s.tunnelState ?? null);
      if (s.desktop) setIsDesktop(true);
      if (s.restartNotice) {
        // 新进程确认起来了：显示一次「已重启」，清掉旧的更新横幅（单状态，不并存），
        // 然后自动刷新页面加载新代码——不用用户手动刷新
        setRestartNotice(true);
        setUpdateInfo(null);
        if (!sessionStorage.getItem('dshp-auto-reloaded')) {
          sessionStorage.setItem('dshp-auto-reloaded', '1');
          setTimeout(() => { try { location.reload(); } catch { /* 忽略 */ } }, 2000);
        }
      }
    } catch { /* 忽略瞬时失败 */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  // 每次页面加载清掉自动刷新标记——这样下次重启（更新后）才能再次触发自动刷新
  useEffect(() => {
    try { sessionStorage.removeItem('dshp-auto-reloaded'); } catch { /* 忽略 */ }
  }, []);

  // 版本检测：host 当前版本 vs npm registry latest（registry 带 CORS *）
  // 两种情况显示横幅：① 有新版可更新；② 磁盘已更新但进程还是旧代码（重启生效）
  // cache: 'no-store' —— registry 响应带缓存头，浏览器会缓存旧版本号导致「小版本不提示」
  // 周期重查（每 5 分钟）：npm registry 的 /latest 走 CDN 边缘缓存，刚发布后打开页面
  // 可能拿到旧版本号——周期性重查让更新提示在缓存刷新后自动出现，不用重开页面。
  // 桌面端（isDesktop）：更新/重启由 DSH Desktop 管理，这里不做版本检测、不显示更新横幅
  useEffect(() => {
    if (isDesktop) return;
    let alive = true;
    const check = async () => {
      try {
        const v = await call(POCKET_ENDPOINTS.version, {});
        const meta = await (await fetch('https://registry.npmjs.org/dsh-pocket/latest', { cache: 'no-store' })).json();
        if (!alive) return;
        const latest = typeof meta?.version === 'string' ? meta.version : null;
        if (latest && v.current && compareVersions(latest, v.current) > 0) {
          setUpdateInfo({ current: v.current, latest, updating: false, result: null });
        } else if (v.current && v.loaded && compareVersions(v.current, v.loaded) > 0) {
          // 已更新未重启：显示「已更新，重启生效」+ 重启按钮
          setUpdateInfo({ current: v.current, latest: v.current, updating: false, result: 'ok', updated: true });
        }
      } catch { /* 网络失败静默 */ }
    };
    check();
    const t = setInterval(check, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [isDesktop]);

  // 重启宿主（更新生效必需：刷新页面不会重载服务端代码）
  const restartPocket = async () => {
    setUpdateInfo((u) => ({ ...u, restarting: true, startedAt: Date.now() }));
    try {
      // 宿主 500ms 后自杀，RPC 响应可能来不及送达 → 3 秒超时兜底，别让按钮永远卡「重启中…」
      await Promise.race([
        call(POCKET_ENDPOINTS.restart, {}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('restart requested (no reply within 3s)')), 3000)),
      ]);
      setUpdateInfo((u) => ({ ...u, restarting: true, result: 'ok' }));
    } catch (err) {
      // 网络断连/超时同样视为「已请求重启」——旧进程即将退出，等新进程起来后刷新即可
      const msg = String(err?.message ?? '');
      if (/connection|socket|fetch|network|abort|cancelled|ECONN|disconnect|closed|timeout/i.test(msg)) {
        setUpdateInfo((u) => ({ ...u, restarting: true, result: 'ok' }));
        return;
      }
      setUpdateInfo((u) => ({ ...u, restarting: false, result: 'fail', output: err.message }));
    }
  };

  // 一键更新：调宿主 dsh plugin update（成功后宿主自动重启生效，用户只点一次）
  const runUpdate = async () => {
    setUpdateInfo((u) => ({ ...u, updating: true, result: null, startedAt: Date.now() }));
    try {
      const r = await call(POCKET_ENDPOINTS.update, {});
      setUpdateInfo((u) => ({
        ...u,
        updating: false,
        result: r.ok ? 'ok' : 'fail',
        autoRestart: r.autoRestart === true,
        output: r.output ?? r.error,
      }));
    } catch (err) {
      setUpdateInfo((u) => ({ ...u, updating: false, result: 'fail', output: err.message }));
    }
  };

  // 安全免责声明（issue #31）：每次开启公网都必须先弹框勾选「我已知情」。
  // 服务端同样强制（tunnel.start 需 disclaimer: true），防绕过前端直接调 RPC。
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);

  const doStartTunnel = async () => {
    setBusy(true);
    setError(null);
    setTunnelState({ phase: 'starting', detail: '正在开启…', startedAt: Date.now() });
    try {
      setStatus(await call(POCKET_ENDPOINTS.tunnelStart, { disclaimer: true }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const startTunnel = () => {
    // 每次开启都弹免责确认（勾选后才能继续）
    setDisclaimerChecked(false);
    setDisclaimerOpen(true);
  };
  const confirmDisclaimer = () => {
    if (!disclaimerChecked) return; // 未勾选不允许
    setDisclaimerOpen(false);
    doStartTunnel();
  };

  const stopTunnel = async () => {
    try { setStatus(await call(POCKET_ENDPOINTS.tunnelStop, {})); } catch { /* 忽略 */ }
  };

  // 刷新局域网访问密码（旧密码立即作废）
  const refreshLanPin = async () => {
    try {
      const r = await call(POCKET_ENDPOINTS.lanTokenRefresh, {});
      setStatus((s) => ({ ...s, lanToken: r.lanToken }));
    } catch { /* 忽略 */ }
  };

  // 局域网访问密码开关（issue #24）：默认开启；关闭后局域网扫码直连（公网不受影响）
  const setLanAuth = async (on) => {
    try {
      const r = await call(POCKET_ENDPOINTS.lanAuthSetEnabled, { on });
      setStatus((s) => ({ ...s, lanAuthEnabled: r.lanAuthEnabled }));
    } catch { /* 忽略 */ }
  };

  // 局域网地址手动覆盖（Tailscale/VPN 等远程访问场景）：空值恢复自动选择
  const setLanAddress = async (ip) => {
    try {
      setStatus(await call(POCKET_ENDPOINTS.lanSetOverride, { ip }));
    } catch (err) {
      setError(err.message);
    }
  };

  // 自定义访问密码（issue #33）：公网/局域网各自设固定 8 位数字；自定义后公网不再自动轮换。
  // customPin: { which: 'public'|'lan', value, err } | null —— 正在输入自定义密码的区块
  const [customPin, setCustomPin] = useState(null);
  const saveCustomPin = async (which) => {
    try {
      const r = await call(POCKET_ENDPOINTS.pinSetCustom, { which, value: customPin?.value ?? '' });
      setStatus((s) => ({
        ...s,
        accessToken: which === 'public' ? r.pin : s.accessToken,
        lanToken: which === 'lan' ? r.pin : s.lanToken,
        publicPinCustom: which === 'public' ? true : s.publicPinCustom,
        lanPinCustom: which === 'lan' ? true : s.lanPinCustom,
      }));
      setCustomPin(null);
    } catch (err) {
      setCustomPin((c) => ({ ...c, err: err.message }));
    }
  };
  // 渲染自定义输入行（共用）：输入框 + 保存/取消
  const customPinRow = (which) => h('div', { style: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)', lineHeight: 1.5 } },
    t('customizing'),
    h('input', {
      style: { width: 110, margin: '0 6px', padding: '4px 8px', fontSize: 14, letterSpacing: 2, textAlign: 'center', border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 6, outline: 'none' },
      type: 'password',
      inputMode: 'numeric',
      maxLength: 8,
      value: customPin?.value ?? '',
      autoFocus: true,
      onChange: (e) => setCustomPin((c) => ({ ...c, value: e.target.value.replace(/\D/g, ''), err: null })),
      onKeyDown: (e) => { if (e.key === 'Enter') saveCustomPin(which); if (e.key === 'Escape') setCustomPin(null); },
    }),
    h('button', { style: { ...styles.btn, height: 26, padding: '0 10px', fontSize: 12, marginLeft: 2 }, onClick: () => saveCustomPin(which) }, t('save')),
    h('button', { style: { ...styles.btn, height: 26, padding: '0 10px', fontSize: 12 }, onClick: () => setCustomPin(null) }, t('cancel')),
    customPin?.err ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary,#dc2626)', marginTop: 4 } }, customPin.err) : null,
  );
  // 「自定义」按钮（非输入态显示在密码行末尾）
  const customBtn = (which) => h('button', { style: { ...styles.btn, height: 26, padding: '0 10px', fontSize: 12, marginLeft: 8 }, onClick: () => setCustomPin({ which, value: '', err: null }) }, t('customize'));

  const lanUrl = status?.lanUrl;
  const tunnelUrl = status?.tunnelUrl;
  const tunnelPhase = tunnelState?.phase ?? 'idle';
  const tunnelStarting = ['downloading', 'starting', 'registering'].includes(tunnelPhase);
  const tunnelStateDetail = tunnelState?.detail ?? '';
  const tunnelStateStarted = tunnelState?.startedAt ?? null;

  return h('div', { style: styles.card },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
      h('div', null,
        h('strong', null, t('title')),
        h('div', { style: styles.muted }, t('subtitle')),
      ),
      h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary,#8b93a1)', textAlign: 'right' } },
        h('div', { style: { whiteSpace: 'nowrap' } }, t('developer')),
        h('div', { style: { whiteSpace: 'nowrap' } }, t('starAsk')),
        h('a', { href: 'https://github.com/shaobeichen/dsh-pocket', target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-brand-primary,#4f6ef7)', fontSize: 12, lineHeight: 1.6, textDecoration: 'underline' } },
          t('starCta')),
      ),
    ),

    // 桌面端不显示更新/重启横幅（更新由 DSH Desktop 管理），也不需要额外提示

    // 重启后提示（进程在后台运行，停止方法）——左侧蓝色色条（桌面端不会触发本插件的自重启）
    !isDesktop && restartNotice ? h('div', { style: { ...styles.block, borderLeft: '4px solid var(--dsw-alias-brand-primary,#4f6ef7)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2,#f3f4f6)', padding: '10px 12px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('div', { style: { fontWeight: 600, fontSize: 13 } }, t('restarted')),
        h('button', { style: styles.btn, onClick: () => setRestartNotice(false) }, t('ok')),
      ),
      h('div', { style: styles.muted, marginTop: 4, wordBreak: 'break-all' }, fmt(t, 'bgHint', { cmd: status?.killHint ?? `lsof -ti :${status?.dshPort ?? 3080} | xargs kill -9` })),
    ) : null,

    // 更新提示——左侧黄色色条（提示有新版本）；单状态：有更新/更新中/已更新自动重启，不并存
    // 桌面端不渲染（更新由 DSH Desktop 管理）
    !isDesktop && updateInfo ? h('div', { style: { ...styles.block, borderLeft: '4px solid var(--dsw-alias-state-warn-primary,#b45309)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2,#f3f4f6)', padding: '10px 12px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('div', { style: { fontWeight: 600, fontSize: 13 } },
          updateInfo.updated
            ? fmt(t, 'updatedRestart', { ver: updateInfo.current })
            : updateInfo.result === 'ok'
              ? (updateInfo.autoRestart ? fmt(t, 'updateAutoRestarting', { ver: updateInfo.latest }) : fmt(t, 'updatedOk', { ver: updateInfo.latest }))
              : fmt(t, 'updateAvailable', { ver: updateInfo.latest })),
        updateInfo.result !== 'ok'
          ? h('button', { style: styles.primary, onClick: runUpdate, disabled: updateInfo.updating }, updateInfo.updating ? t('updating') : fmt(t, 'updateTo', { ver: updateInfo.latest }))
          : updateInfo.autoRestart
            ? h('button', { style: styles.btn, disabled: true }, t('restartingNow'))
            : h('button', { style: styles.primary, onClick: restartPocket, disabled: updateInfo.restarting }, updateInfo.restarting ? t('restarting') : t('restartNow')),
      ),
      h('div', { style: styles.muted, marginTop: 4 },
        updateInfo.updating
          ? fmt(t, 'updatingDetail', { s: elapsed(updateInfo.startedAt) })
        : updateInfo.restarting
          ? fmt(t, 'restartingDetail', { s: elapsed(updateInfo.startedAt) })
        : updateInfo.result === 'ok'
          ? (updateInfo.autoRestart ? t('updatedAutoDetail')
            : t('updatedRestartDetail'))
        : updateInfo.result === 'fail' ? fmt(t, 'updateFailed', { err: updateInfo.output || t('unknownError') })
        : fmt(t, 'versionRange', { cur: updateInfo.current, latest: updateInfo.latest })),
    ) : null,

    // 局域网
    h('div', { style: styles.block },
      h('div', { style: { fontWeight: 600, fontSize: 13 } }, t('lanTitle')),
      lanUrl
        ? h('div', null,
          h('img', { src: status.lanQr, alt: 'LAN QR', style: styles.qr }),
          h('div', { style: styles.code }, lanUrl),
          h('div', { style: styles.muted }, t('lanHint')),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)' } },
            t('lanAddress'),
            h('select', {
              value: status?.lanIpOverride || '',
              onChange: (e) => setLanAddress(e.target.value),
              style: { font: 'inherit', height: 30, padding: '0 8px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', background: 'var(--dsw-alias-bg-layer-1,#fff)', color: 'var(--dsw-alias-label-primary,inherit)' },
            },
            h('option', { value: '' }, t('lanAddressAuto')),
            (status?.lanCandidates || []).map((ip) => h('option', { key: ip, value: ip }, ip)),
            ),
          ),
          h('div', { style: { ...styles.muted, marginTop: 2 } }, t('lanAddressHint')),
          // 访问密码开关（issue #24）：默认开启；关闭后扫码直连（仅同一局域网设备可访问）
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)' } }, t('lanPin')),
            h('button', {
              style: { ...styles.btn, height: 28, padding: '0 12px', fontSize: 12, fontWeight: status?.lanAuthEnabled !== false ? 600 : 400, background: status?.lanAuthEnabled !== false ? 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))' : 'var(--dsw-alias-bg-layer-1,#fff)', color: status?.lanAuthEnabled !== false ? 'var(--dsw-alias-label-primary-foreground, #fff)' : 'var(--dsw-alias-label-primary,inherit)' },
              onClick: () => setLanAuth(true),
            }, t('on')),
            h('button', {
              style: { ...styles.btn, height: 28, padding: '0 12px', fontSize: 12, fontWeight: status?.lanAuthEnabled === false ? 600 : 400, background: status?.lanAuthEnabled === false ? 'var(--dsw-alias-state-error-primary,#dc2626)' : 'var(--dsw-alias-bg-layer-1,#fff)', color: status?.lanAuthEnabled === false ? '#fff' : 'var(--dsw-alias-label-primary,inherit)' },
              onClick: () => setLanAuth(false),
            }, t('off')),
          ),
          status?.lanAuthEnabled !== false
            ? (customPin?.which === 'lan'
                ? customPinRow('lan')
                : h('div', { style: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)', lineHeight: 1.5 } },
                  fmt(t, status?.lanPinCustom ? 'lanPinCustomValue' : 'lanPinValue', { pin: status.lanToken }),
                  h('button', { style: { ...styles.btn, height: 26, padding: '0 10px', fontSize: 12, marginLeft: 8 }, onClick: refreshLanPin }, t('refresh')),
                  customBtn('lan'),
                ))
            : h('div', { style: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-state-warn-primary,#b45309)', lineHeight: 1.5 } },
              t('lanPinOff')),
        )
        : h('div', { style: styles.muted }, t('lanStarting')),
    ),

    // 公网
    h('div', { style: styles.block },
      h('div', { style: { fontWeight: 600, fontSize: 13 } }, t('wanTitle')),
      tunnelUrl
        ? h('div', null,
          h('img', { src: status.tunnelQr, alt: 'Tunnel QR', style: styles.qr }),
          h('div', { style: styles.code }, tunnelUrl),
          h('div', { style: styles.muted }, t('wanHint')),
          status.accessToken
            ? (customPin?.which === 'public'
                ? customPinRow('public')
                : h('div', { style: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)', lineHeight: 1.5 } },
                  fmt(t, status?.publicPinCustom ? 'wanPinCustom' : 'wanPin', { pin: status.accessToken }),
                  customBtn('public'),
                  status?.publicPinCustom ? h('div', { style: { marginTop: 2, fontSize: 11, color: 'var(--dsw-alias-state-warn-primary,#b45309)' } }, t('pinCustomHint')) : null,
                ))
            : null,
          h('button', { style: styles.btn, onClick: stopTunnel }, t('stopTunnel')),
        )
        : h('div', null,
          h('button', { style: { ...styles.primary, margin: '8px 0' }, onClick: startTunnel, disabled: busy || tunnelStarting }, busy ? t('opening') : t('enable')),
          tunnelStarting
            ? h('div', { style: { marginTop: 4, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)' } },
              tunnelPhase === 'downloading'
                ? fmt(t, 'downloading', { s: elapsed(tunnelStateStarted) })
                : fmt(t, 'connecting', { s: elapsed(tunnelStateStarted), suffix: elapsed(tunnelStateStarted) > 30 ? t('slowHint') : '' }))
            : tunnelPhase === 'error'
              ? h('div', { style: { marginTop: 4, fontSize: 12, color: 'var(--dsw-alias-state-error-primary,#dc2626)' } },
                fmt(t, 'error', { detail: tunnelStateDetail || t('unknownError') }))
              : null,
        ),
    ),

    error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary,#dc2626)', fontSize: 12, marginTop: 8 } }, `❌ ${error}`) : null,

    // 安全免责声明弹框（issue #31）：每次开启公网访问前确认
    disclaimerOpen ? h('div', { style: { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 } },
      h('div', { style: { background: 'var(--dsw-alias-bg-layer-1,#fff)', borderRadius: 12, maxWidth: 420, width: '100%', padding: '20px 22px', boxShadow: '0 8px 32px rgba(0,0,0,.18)' } },
        h('div', { style: { fontWeight: 600, fontSize: 15, color: 'var(--dsw-alias-state-warn-primary,#b45309)', marginBottom: 10 } }, t('disclaimerTitle')),
        h('div', { style: { fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-label-primary,inherit)' } }, t('disclaimerBody')),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, cursor: 'pointer' } },
          h('input', { type: 'checkbox', checked: disclaimerChecked, onChange: (e) => setDisclaimerChecked(e.target.checked), style: { width: 16, height: 16 } }),
          t('disclaimerAgree'),
        ),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 16 } },
          h('button', { style: { ...styles.btn, flex: 1 }, onClick: () => setDisclaimerOpen(false) }, t('cancel')),
          h('button', {
            style: { ...styles.primary, flex: 1, opacity: disclaimerChecked ? 1 : .5 },
            disabled: !disclaimerChecked,
            onClick: confirmDisclaimer,
          }, t('disclaimerAgree')),
        ),
        !disclaimerChecked ? h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-state-error-primary,#dc2626)' } }, t('disclaimerHint')) : null,
      ),
    ) : null,

    // 页面最底部：反馈入口
    h('div', { style: { ...styles.block, textAlign: 'center' } },
      h('a', { href: 'https://github.com/shaobeichen/dsh-pocket/issues', target: '_blank', rel: 'noreferrer', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)', textDecoration: 'none' } },
        t('feedback')),
    ),
  );
}

export function apply(ctx) {
  // 移动端适配（dsh-web-mobile 移植）：抽屉布局/触控/安全区，仅窄屏生效
  mobileApply(ctx);

  const rpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(POCKET_RPC_CHANNEL, endpoint, payload, signal);

  // 设置页签接入 DSH 本地化：注册 pocket 词典（zh/en），并绑定一个随当前 locale 切换的 t()。
  const translate = ctx.locale.bind(POCKET_NS);
  ctx.effect(() => ctx.locale.register(POCKET_NS, { zh: POCKET_ZH, en: POCKET_EN }), 'dsh-pocket: pocket locale dictionaries');

  // 设置一级入口（与 通用设置/模型/插件 同级，order 1 = 通用之后、最外层）
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'pocket',
        order: 1,
        label: () => translate('section'),
        inject: () => ({ rpcCall, t: translate }),
      },
      PocketSettingsTab,
    ),
  );
}

export { name, inject, redactStatus };
