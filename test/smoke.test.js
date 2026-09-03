// 真实链路冒烟测试：不注入任何 stub，验证「真实代理转发 + polyfill 注入 + 状态快照 + RPC」。
// 之前的教训：测试全用 stub 会漏掉真实环境才出现的 bug（如 require 崩溃、未处理 rejection）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPocketService } from '../lib/service.mjs';
import { installPocketRpc } from '../lib/web-rpc.js';
import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS } from '../client/api.js';

/** 假 dsh web：返回一个简单 HTML 文档（走真实 qrcode / 真实代理，无 stub）。 */
async function fakeUpstream() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>dsh</title></head><body>real-dsh</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

function fakeCtxConnection() {
  let handler = null;
  const handle = (channel, fn) => {
    assert.equal(channel, POCKET_RPC_CHANNEL);
    handler = fn;
    return () => { handler = null; };
  };
  return { rpc: { handle }, get handler() { return handler; } };
}

test('真实链路：代理转发 + polyfill 注入 + 状态快照（无 stub）', async () => {
  const up = await fakeUpstream();
  const home = await mkdtemp(join(tmpdir(), 'smoke-'));
  const service = createPocketService({ dshPort: up.address().port, port: 0, home });
  try {
    await service.startProxy();
    const st = await service.status();
    assert.equal(st.proxyRunning, true);
    assert.ok(st.proxyPort > 0, '拿到真实监听端口');

    // 真实代理转发到假 dsh web，且 HTML 被注入 randomUUID polyfill
    const res = await fetch(`http://127.0.0.1:${st.proxyPort}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('real-dsh'), '代理转发到上游');
    assert.ok(html.includes('randomUUID'), '非安全上下文 polyfill 已注入');

    // 状态快照：局域网 URL + 真实 qrcode 生成的二维码
    assert.ok(st.lanUrl.startsWith('http://'), '局域网 URL');
    assert.ok(st.lanQr.startsWith('data:image/png;base64,'), '真实 qrcode 生成的二维码');
  } finally {
    await service.dispose();
    await new Promise((r) => up.close(r));
    await rm(home, { recursive: true, force: true });
  }
});

test('真实链路：RPC status 走真实 service（含 restartNotice）', async () => {
  const up = await fakeUpstream();
  const home = await mkdtemp(join(tmpdir(), 'smoke-rpc-'));
  const service = createPocketService({ dshPort: up.address().port, port: 0, home });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, { service, log: { error() {}, warn() {} } });
  try {
    await service.startProxy();
    const r = await conn.handler(POCKET_ENDPOINTS.status, {});
    assert.equal(r.ok, true);
    assert.equal(r.value.proxyRunning, true);
    assert.ok(r.value.proxyPort > 0);
    assert.ok(r.value.lanQr.startsWith('data:image/png;base64,'), 'RPC 返回真实二维码');
    assert.equal(r.value.restartNotice, null, '无重启标记');
  } finally {
    await service.dispose();
    await new Promise((r) => up.close(r));
    await rm(home, { recursive: true, force: true });
  }
});

test('client bundle 注入 React 绑定（PR #1 回归：mobile 组件曾 React is not defined）', async () => {
  // DSH 模块系统提供 react 为模块、非全局；esbuild classic JSX 生成 React.createElement，
  // 若 factory 不绑定 React，mobile 组件（抽屉布局）渲染即崩、移动端适配永远不激活。
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  assert.ok(src.includes('var React = require("react")'), 'factory 注入 React 绑定');
  // 匹配实际调用形式（带左括号），避免命中 build.mjs 注释里的字面量
  assert.ok(src.includes('React.createElement('), 'bundle 内存在 JSX 编译产物（需要 React 绑定）');
  const injectIdx = src.indexOf('var React = require("react")');
  const createIdx = src.indexOf('React.createElement(');
  assert.ok(injectIdx !== -1 && createIdx !== -1 && injectIdx < createIdx, 'React 声明先于使用');
});

test('client bundle：status 访问必须可选链（回归：1.9.0 白屏——首次渲染 status=null 时裸 status.lanAuthEnabled 抛 TypeError）', async () => {
  // load() 是异步的：首次渲染时 status 为 null。LAN 开关行渲染在 lanUrl 安全分支之外，
  // 1.9.0 在这里裸访问 status.lanAuthEnabled → React 整树崩溃 → 设置页白屏。
  // 修复：全部 status?.lanAuthEnabled。此测试防止再次出现裸访问（esbuild 会原样保留 ?.）。
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('status.lanAuthEnabled'), 'bundle 不允许裸 status.lanAuthEnabled（必须可选链）');
  assert.ok(!src.includes('status.accessToken'), 'bundle 不允许裸 status.accessToken（必须可选链）');
  assert.ok(src.includes('status?.lanAuthEnabled'), 'bundle 存在可选链访问');
  assert.ok(src.includes('status?.accessToken'), 'accessToken 走可选链访问');
});

test('移动导航 backdrop（issue #38）：点击穿透不抢抽屉内点击 + 抽屉外点击关闭保留', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  // CSS：backdrop 必须 pointer-events: none（纯压暗层，不接收点击）
  const css = src.match(/\[data-mobile-nav="backdrop"\][^}]*}/)?.[0] ?? '';
  assert.ok(css.includes('pointer-events: none'), 'backdrop 点击穿透');
  // JSX：backdrop 是纯视觉 div（无 role/onClick）
  assert.ok(src.includes('"data-mobile-nav": "backdrop"'), 'backdrop 纯视觉渲染');
  // 关闭逻辑：抽屉内导航关闭 + 抽屉外点击关闭（两套 document capture contains 处理）
  assert.ok((src.match(/contains\(target\)/g) || []).length >= 2, '存在抽屉内外两套点击处理');
  // 抽屉层级（PR #42 / issue #67）：必须高于第三方插件对 shell overlay 层的
  // 抬升（500），也要压过 @linxin666/dsh-web-ui-all 的移动端层（sidebar pane
  // 1100、details pane 1000、frame ::after 全屏遮罩 1050）。
  // 直接断言 bundle 中抽屉规则的 z-index: 1200（若退回 40/600 则此处失败）
  assert.ok(
    src.includes('z-index: 1200 !important'),
    '抽屉 z-index 1200（高于 overlay 抬升 500 与 web-ui-all 的 1100/1050）',
  );
  assert.ok(!src.includes('z-index: 40 !important'), '不再用 40（会被第三方抬升的 overlay 盖住）');
  assert.ok(!src.includes('z-index: 600 !important'), '不再用 600（会被 web-ui-all 的 1050 遮罩盖住）');
});

test('公网免责声明（issue #31）：bundle 含弹框与勾选逻辑，RPC 必须带 disclaimer 确认', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  assert.ok(src.includes('disclaimer'), 'bundle 含免责声明逻辑');
  assert.ok(src.includes('disclaimer: true'), '开启公网带免责声明确认参数');
});

test('文件浏览（issue #48）：宿主无 aionui explorer 时隐藏入口；点 Files 关抽屉', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  // 检测逻辑：frame 打 data-mobile-nav-explorer 标记
  assert.ok(src.includes('data-mobile-nav-explorer'), '存在 explorer 可用性检测标记');
  // 隐藏 CSS：无 explorer 时隐藏 files/explorer 入口
  assert.ok(src.includes('[data-mobile-nav-explorer="0"] [data-mobile-nav="files"]'), '无 explorer 隐藏 header Files');
  assert.ok(src.includes('[data-mobile-nav-explorer="0"] [data-mobile-nav="explorer"]'), '无 explorer 隐藏 drawer 入口');
  // 点 Files 关闭抽屉（抽屉 z600 会盖住 explorer sheet，且 sheet 外点击会被吃掉）
  assert.ok(src.includes('[data-mobile-nav="files"]'), 'Files 纳入抽屉内导航关闭');
});

test('Windows 更新 spawn（PR #54）：performUpdate 的 spawn 必须带 shell 选项', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  const seg = src.slice(src.indexOf("spawn('dsh'"), src.indexOf('spawn(\'dsh\')') + 500);
  assert.ok(src.includes("shell: process.platform === 'win32'"), 'spawn 带 shell: win32（npm shim ENOENT / Node22 EINVAL）');
});
