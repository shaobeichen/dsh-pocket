// 真机测试（不进 CI）：真实 cloudflared 快速隧道 + 真实 metrics /ready 探活。
//
// 目的：确认「就绪度探活」这条路在真实 cloudflared 上成立——URL 打印之后、
// 边缘注册完成时 /ready 才会变成 readyConnections>0；服务层靠这个信号判断
// 「进程活着但隧道已失效」（手机端 Cloudflare 1016/1033/530 的根因）。
//
// 运行：npm run test:local
// 前提：本机能连 Cloudflare（cloudflared 已缓存或可下载，约 20MB）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { startQuickTunnel, probeTunnelReady } from '../../lib/tunnel.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('真实 cloudflared：quick tunnel 的 metrics /ready 能探到就绪（readyConnections>0）', async (t) => {
  const origin = createServer((req, res) => res.end('origin-ok'));
  const originPort = await new Promise((resolve, reject) => {
    origin.once('error', reject);
    origin.listen(0, '127.0.0.1', () => resolve(origin.address().port));
  });
  t.after(() => new Promise((resolve) => origin.close(resolve)));

  const tunnel = await startQuickTunnel({ port: originPort });
  t.after(() => tunnel.kill());
  assert.match(tunnel.url, /trycloudflare\.com/, '解析到公网 URL');
  assert.ok(tunnel.metricsPort > 0, '句柄带 metrics 端口');

  // URL 会先于"边缘注册完成"打印出来：轮询 /ready，最多 30s
  let result = { ok: false, readyConnections: 0, status: null, error: 'not-probed' };
  for (let i = 0; i < 30; i += 1) {
    result = await probeTunnelReady({ port: tunnel.metricsPort });
    if (result.ok) break;
    await sleep(1000);
  }
  assert.equal(result.ok, true, `应探到就绪；最后结果 ${JSON.stringify(result)}`);
  assert.ok(result.readyConnections >= 1, 'readyConnections 至少 1 条');

  // 反向验证：探活就绪时，真实公网 URL 确实能打开（探活信号与"手机能用"一致）
  const res = await fetch(tunnel.url, { signal: AbortSignal.timeout(15000) });
  assert.equal(res.status, 200, '公网 URL 返回 200');
  assert.equal(await res.text(), 'origin-ok', '流量回到了本机 origin');
});
