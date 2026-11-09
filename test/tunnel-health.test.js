// 就绪度探活工具测试（无网络：本地起假 metrics 服务）
//
// 背景：cloudflared 进程活着、但边缘注册丢失时，metrics /ready 返回
// readyConnections=0（HTTP 503）；手机端就是 Cloudflare 1016/1033/530。
// 自愈依赖把这几个信号判准，所以这里把 probeTunnelReady 的每条分支都钉死。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { pickFreePort, probeTunnelReady } from '../lib/tunnel.mjs';

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('pickFreePort：返回可用的本机端口', async () => {
  const port = await pickFreePort();
  assert.equal(typeof port, 'number');
  assert.ok(port > 0 && port < 65536, '端口在合法范围');

  // 端口确实空闲：能直接 bind 到它（pickFreePort 已 close）
  const server = createServer((req, res) => res.end('ok'));
  const bound = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
  assert.equal(bound, port, '返回的端口可被立即使用');
  await close(server);
});

test('probeTunnelReady：/ready 200 且 readyConnections>0 → ok', async (t) => {
  const { server, port } = await listen((req, res) => {
    assert.equal(req.url, '/ready');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 200, readyConnections: 1, connectorId: 'x' }));
  });
  t.after(() => close(server));

  const result = await probeTunnelReady({ port });
  assert.equal(result.ok, true);
  assert.equal(result.readyConnections, 1);
  assert.equal(result.status, 200);
  assert.equal(result.error, '');
});

test('probeTunnelReady：/ready 503 且 readyConnections=0（进程活着但边缘失联）→ 不 ok', async (t) => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 503, readyConnections: 0, connectorId: 'x' }));
  });
  t.after(() => close(server));

  const result = await probeTunnelReady({ port });
  assert.equal(result.ok, false);
  assert.equal(result.readyConnections, 0);
  assert.equal(result.status, 503);
});

test('probeTunnelReady：响应体不是 JSON 也不崩（按不 ok 处理）', async (t) => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>oops</html>');
  });
  t.after(() => close(server));

  const result = await probeTunnelReady({ port });
  assert.equal(result.ok, false);
  assert.equal(result.readyConnections, 0);
});

test('probeTunnelReady：端口不可达（进程已死/端口被抢）→ 不 ok 且带 error', async () => {
  // 取一个刚释放的端口，再立即探测：正常情况下连接被拒
  const port = await pickFreePort();
  const result = await probeTunnelReady({ port, timeoutMs: 500 });
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0, 'error 说明失败原因');
});

test('probeTunnelReady：超时 → 不 ok（metrics 就在本机，超时即异常）', async (t) => {
  let pending = null;
  const { server, port } = await listen((req, res) => {
    // 永不主动响应，等客户端超时
    pending = setTimeout(() => { try { res.end('{}'); } catch { /* 已断开 */ } }, 5000);
  });
  t.after(() => {
    if (pending) clearTimeout(pending);
    return close(server);
  });

  const startedAt = Date.now();
  const result = await probeTunnelReady({ port, timeoutMs: 80 });
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0, '超时也应给出 error');
  assert.ok(Date.now() - startedAt < 2000, '应在超时后尽快返回');
});

test('probeTunnelReady：没有 metrics 端口（旧实现/假隧道）→ no-metrics-port', async () => {
  const result = await probeTunnelReady({ port: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no-metrics-port');
});
