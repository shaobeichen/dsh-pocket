// 局域网访问密码开关（issue #24）：默认开启、持久化、可关可开
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 每个测试用独立 DSH_HOME，互不干扰（settings.mjs 每次调用都读磁盘/环境变量）
async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'dshp-settings-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
}

test('局域网访问总开关默认开启（无配置文件）', () => withHome(async () => {
  const { lanEnabled } = await import('../lib/settings.mjs');
  assert.equal(lanEnabled(), true, '默认开启');
}));

test('局域网访问总开关：关闭 → 持久化到 settings.json，重新读取仍为关闭；可再开', () => withHome(async () => {
  const { lanEnabled, setLanEnabled, settingsPath } = await import('../lib/settings.mjs');
  assert.equal(setLanEnabled(false), false, '返回关闭状态');
  assert.equal(lanEnabled(), false, '立即生效（每次读磁盘）');
  const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  assert.equal(raw.lanEnabled, false, 'settings.json 内容正确');
  assert.equal(setLanEnabled(true), true, '重新开启');
  assert.equal(lanEnabled(), true, '开启生效');
}));

test('局域网密码开关默认开启（无配置文件）', () => withHome(async () => {
  const { lanAuthEnabled } = await import('../lib/settings.mjs');
  assert.equal(lanAuthEnabled(), true, '默认开启');
}));

test('关闭 → 持久化到 settings.json，重新读取仍为关闭', () => withHome(async () => {
  const { lanAuthEnabled, setLanAuthEnabled, settingsPath } = await import('../lib/settings.mjs');
  assert.equal(setLanAuthEnabled(false), false, '返回关闭状态');
  assert.equal(lanAuthEnabled(), false, '立即生效（每次读磁盘）');
  const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  assert.equal(raw.lanAuthEnabled, false, 'settings.json 内容正确');
}));

test('再开 → true；settings.json 权限 0600', () => withHome(async () => {
  const { lanAuthEnabled, setLanAuthEnabled, settingsPath } = await import('../lib/settings.mjs');
  setLanAuthEnabled(false);
  assert.equal(setLanAuthEnabled(true), true, '重新开启');
  assert.equal(lanAuthEnabled(), true, '开启生效');
  assert.ok(existsSync(settingsPath()), '配置文件已创建');
  if (process.platform !== 'win32') {
    assert.equal(statSync(settingsPath()).mode & 0o777, 0o600, '权限 0600');
  }
}));

test('手机端右边栏默认开启，可关闭并持久化', () => withHome(async () => {
  const { mobileRightbarEnabled, setMobileRightbarEnabled, settingsPath } = await import('../lib/settings.mjs');
  assert.equal(mobileRightbarEnabled(), true, '默认开启');
  assert.equal(setMobileRightbarEnabled(false), false, '返回关闭状态');
  assert.equal(mobileRightbarEnabled(), false, '关闭后立即生效');
  const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  assert.equal(raw.mobileRightbarEnabled, false, 'settings.json 内容正确');
  assert.equal(setMobileRightbarEnabled(true), true, '可再次开启');
}));

test('局域网地址覆盖：默认自动，设置/清除持久化，非法 IPv4 拒绝', () => withHome(async () => {
  const { lanIpOverride, setLanIpOverride, settingsPath } = await import('../lib/settings.mjs');
  assert.equal(lanIpOverride(), '', '默认自动');
  assert.equal(setLanIpOverride('100.119.24.44'), '100.119.24.44', '设置成功');
  assert.equal(lanIpOverride(), '100.119.24.44', '立即生效');
  const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  assert.equal(raw.lanIpOverride, '100.119.24.44', 'settings.json 内容正确');
  assert.throws(() => setLanIpOverride('999.1.1.1'), /IPv4/, '非法地址拒绝');
  assert.equal(setLanIpOverride(''), '', '清除覆盖');
  assert.equal(lanIpOverride(), '', '恢复自动');
}));

test('PIN 自定义标记（issue #33）：默认 false，设置/清除持久化，未知类型 false', () => withHome(async () => {
  const { pinCustom, setPinCustom } = await import('../lib/settings.mjs');
  assert.equal(pinCustom('public'), false, '默认未自定义');
  assert.equal(pinCustom('lan'), false, '默认未自定义');
  assert.equal(pinCustom('other'), false, '未知类型 false');
  setPinCustom('public', true);
  assert.equal(pinCustom('public'), true, '持久化生效');
  setPinCustom('public', false);
  assert.equal(pinCustom('public'), false, '可清除');
  assert.equal(pinCustom('lan'), false, '互不影响');
}));

test('setCustomPin / rotateAccessToken（issue #33）：8–64 位字母数字自定义 + 自定义后公网不轮换；非法输入抛错', () => withHome(async () => {
  const { setCustomPin, rotateAccessToken, getAccessToken } = await import('../lib/index.js');
  const { pinCustom } = await import('../lib/settings.mjs');
  // 非法输入
  assert.throws(() => setCustomPin('public', '1234567'), /8–64 位英文字母或数字/, '少于 8 位拒绝');
  assert.throws(() => setCustomPin('public', 'abc$ef12'), /8–64 位英文字母或数字/, '特殊符号拒绝');
  assert.throws(() => setCustomPin('public', 'a'.repeat(65)), /8–64 位英文字母或数字/, '超过 64 位拒绝');
  assert.throws(() => setCustomPin('other', '12345678'), /未知/, '未知类型拒绝');
  // 合法自定义：公网（纯数字）
  assert.equal(setCustomPin('public', '88886666'), '88886666', '公网自定义成功（纯数字）');
  assert.equal(pinCustom('public'), true, '公网标记自定义');
  assert.equal(getAccessToken(), '88886666', '值已写入');
  // 自定义后 rotateAccessToken 不轮换（值保持）
  assert.equal(rotateAccessToken(), '88886666', '自定义后开启公网不换新');
  assert.equal(getAccessToken(), '88886666', '值未被覆盖');
  // 合法自定义：公网（字母 + 数字混合，大小写均可）
  assert.equal(setCustomPin('public', 'aB3xY9k2'), 'aB3xY9k2', '公网自定义成功（字母数字混合）');
  assert.equal(getAccessToken(), 'aB3xY9k2', '混合密码已写入');
  const longPin = 'Ab3'.repeat(21) + 'Z';
  assert.equal(longPin.length, 64, '测试密码为 64 位');
  assert.equal(setCustomPin('public', longPin), longPin, '64 位自定义密码成功');
  assert.equal(getAccessToken(), longPin, '64 位密码已写入');
  // 合法自定义：局域网
  assert.equal(setCustomPin('lan', '77775555'), '77775555', '局域网自定义成功');
  assert.equal(pinCustom('lan'), true, '局域网标记自定义');
}));

// ---------- 命名隧道配置（issue #66：固定公网域名） ----------

test('隧道模式（issue #66）：默认 quick，可切 named/quick，非法值拒绝', () => withHome(async () => {
  const { tunnelMode, setTunnelMode } = await import('../lib/settings.mjs');
  assert.equal(tunnelMode(), 'quick', '默认快速隧道');
  assert.equal(setTunnelMode('named'), 'named', '切换命名隧道');
  assert.equal(tunnelMode(), 'named', '命名模式持久化');
  assert.equal(setTunnelMode('quick'), 'quick', '切回快速隧道');
  assert.equal(tunnelMode(), 'quick', '快速模式持久化');
  assert.throws(() => setTunnelMode('other'), /quick 或 named/, '非法模式拒绝');
}));

test('Tunnel Token（issue #66）：设置/清除持久化；过短/非法字符拒绝', () => withHome(async () => {
  const { tunnelToken, setTunnelToken, settingsPath } = await import('../lib/settings.mjs');
  const tok = 'eyJhIjoiY2xvdWRmbGFyZS10b2tlbi1leGFtcGxlLXZhbHVlIn0';
  assert.equal(tunnelToken(), '', '默认未配置');
  assert.equal(setTunnelToken(tok), tok, '设置成功');
  assert.equal(tunnelToken(), tok, '持久化生效');
  const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  assert.equal(raw.tunnelToken, tok, 'settings.json 内容正确');
  assert.throws(() => setTunnelToken('short'), /Token/, '过短拒绝');
  assert.throws(() => setTunnelToken('has space in it and that is bad!!'), /Token/, '非法字符拒绝');
  assert.equal(setTunnelToken(''), '', '空字符串清除');
  assert.equal(tunnelToken(), '', '清除生效');
}));

test('固定域名（issue #66）：URL 粘贴归一化、设置/清除持久化、非法域名拒绝', () => withHome(async () => {
  const { tunnelHostname, setTunnelHostname } = await import('../lib/settings.mjs');
  assert.equal(tunnelHostname(), '', '默认未配置');
  // 粘贴完整 URL → 归一化为裸域名
  assert.equal(setTunnelHostname('https://Pocket.Example.com/'), 'pocket.example.com', 'URL 归一化（含大小写）');
  assert.equal(tunnelHostname(), 'pocket.example.com', '持久化生效');
  assert.equal(setTunnelHostname(' sub.other.org:443 '), 'sub.other.org', '带端口/空白归一化');
  assert.throws(() => setTunnelHostname('localhost'), /域名/, '无点主机名拒绝（那是局域网域）');
  assert.throws(() => setTunnelHostname('192.168.1.5'), /域名/, '裸 IP 拒绝');
  assert.throws(() => setTunnelHostname('bad host name'), /域名/, '含空格拒绝');
  assert.equal(setTunnelHostname(''), '', '空字符串清除');
  assert.equal(tunnelHostname(), '', '清除生效');
}));

// ---------- 恢复出厂设置 ----------

test('恢复出厂设置：清空全部设置 + 重设随机密码（开关回到默认）', () => withHome(async () => {
  const settings = await import('../lib/settings.mjs');
  const { setCustomPin, getAccessToken, resetPocketState } = await import('../lib/index.js');
  // 先把设置搞成非默认：关掉开关、切命名隧道、填 Token/域名、自定义密码
  settings.setLanEnabled(false);
  settings.setLanAuthEnabled(false);
  settings.setMobileRightbarEnabled(true);
  settings.setLanIpOverride('10.0.0.7');
  settings.setTunnelMode('named');
  settings.setTunnelToken('eyJhIjoiY2xvdWRmbGFyZS10b2tlbi1leGFtcGxlLXZhbHVlIn0');
  settings.setTunnelHostname('pocket.example.com');
  const customPublic = setCustomPin('public', 'aB3xY9k2');
  const customLan = setCustomPin('lan', '77775555');
  assert.equal(existsSync(settings.settingsPath()), true, '设置文件已写入');

  const after = resetPocketState();
  assert.notEqual(after.accessToken, customPublic, '公网密码已换新（旧密码作废）');
  assert.notEqual(after.lanToken, customLan, '局域网密码已换新');
  assert.match(after.accessToken, /^\d{8}$/, '新公网密码是 8 位随机');
  assert.match(after.lanToken, /^\d{8}$/, '新局域网密码是 8 位随机');

  // 全部开关回到出厂默认
  assert.equal(settings.lanEnabled(), true, '局域网访问恢复默认开');
  assert.equal(settings.lanAuthEnabled(), true, '访问密码恢复默认开');
  assert.equal(settings.mobileRightbarEnabled(), true, '手机端右边栏恢复默认开');
  assert.equal(settings.lanIpOverride(), '', '局域网地址恢复自动');
  assert.equal(settings.tunnelMode(), 'quick', '公网模式恢复随机域名');
  assert.equal(settings.tunnelToken(), '', 'Tunnel Token 已清空');
  assert.equal(settings.tunnelHostname(), '', '固定域名已清空');
  assert.equal(settings.pinCustom('public'), false, '公网自定义标记已清除');
  assert.equal(settings.pinCustom('lan'), false, '局域网自定义标记已清除');
  assert.equal(getAccessToken(), after.accessToken, '读到的公网密码与返回一致');
}));

test('代理端口（issue #70）：默认 0（用 3081）；持久化、清除', async () => withHome(async () => {
  const { proxyPort, setProxyPort, settingsPath } = await import('../lib/settings.mjs');
  assert.equal(proxyPort(), 0, '无配置 = 0（让 lib/index.js 用 3081）');
  assert.equal(setProxyPort(3082), 3082, '设置后立即返回新值');
  assert.equal(proxyPort(), 3082, '重新读取仍生效');
  const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  assert.equal(raw.proxyPort, 3082, 'settings.json 字段正确');
  // 清除
  assert.equal(setProxyPort(0), 0, '传 0 清除');
  assert.equal(proxyPort(), 0, '清除后回到默认');
  // 非法值容忍
  assert.equal(setProxyPort('garbage'), 0, '字符串非法值清除');
  assert.equal(setProxyPort(70000), 0, '超出 65535 清除');
  assert.equal(setProxyPort(-1), 0, '负数清除');
  assert.equal(setProxyPort(1.5), 0, '小数清除');
  assert.equal(setProxyPort(80), 80, '合法端口生效');
}));

test('cloudflared 路径（issue #45）：默认空、可设可清', async () => withHome(async () => {
  const { cloudflaredPath, setCloudflaredPath, settingsPath } = await import('../lib/settings.mjs');
  assert.equal(cloudflaredPath(), '', '默认空');
  assert.equal(setCloudflaredPath('/usr/local/bin/cloudflared'), '/usr/local/bin/cloudflared', '设置后立即返回');
  assert.equal(cloudflaredPath(), '/usr/local/bin/cloudflared', '重新读取生效');
  const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  assert.equal(raw.cloudflaredPath, '/usr/local/bin/cloudflared', 'settings.json 字段正确');
  // 清除
  assert.equal(setCloudflaredPath(''), '', '空字符串清除');
  assert.equal(cloudflaredPath(), '', '清除后回到默认');
  // 空格 trim
  assert.equal(setCloudflaredPath('  /opt/cf/cloudflared  '), '/opt/cf/cloudflared', '自动 trim');
}));
