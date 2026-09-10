// 回归测试：dsh v0.1.5-alpha.1+ 直接挂 webServer 路径
//
// 背景：dsh v0.1.5-alpha.1 把 client-connection 的 inject 从 ['webServer','credentials']
// 收缩为 ['credentials']，rpc.handle 内部访问 owner.webServer 必抛
// "cannot get property \"webServer\" without inject"。dsh-pocket 改为直接挂到
// 自己 inject 的 webServer 上，绕开该访问路径。
//
// 本测试用最小 fake webServer + fake connection.requestRejection，验证：
//   - 直接 mount 不经过 rpc.handle（rpc.handle 被设为抛错以证伪）；
//   - 认证门（401/403/放行）逐分支生效；
//   - client-request/server-response 信封往返；
//   - 各错误分支（404/415/400/bad-request/method-mismatch/500）；
//   - disposer 卸载路由。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';

import { installPocketRpc } from '../lib/web-rpc.js';
import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS } from '../client/api.js';

/** 最小 fake webServer：register 只记路由表，listen 用真 http server 转发。 */
function fakeWebServer() {
  const routes = [];
  let server = null;
  return {
    get routes() { return routes; },
    register(route) {
      if (route.kind !== 'prefix') throw new Error('test only supports prefix routes');
      routes.push(route);
      return () => {
        const i = routes.indexOf(route);
        if (i >= 0) routes.splice(i, 1);
      };
    },
    async listen() {
      const { createServer } = await import('node:http');
      server = createServer(async (req, res) => {
        // 取最长前缀匹配
        const matched = routes
          .filter((r) => req.url === r.path || req.url.startsWith(r.path + '/') || req.url.startsWith(r.path))
          .sort((a, b) => b.path.length - a.path.length)[0];
        if (!matched) { res.writeHead(404); res.end('not found'); return; }
        try { await matched.handler(req, res); }
        catch (err) { res.writeHead(500); res.end(`handler failure: ${err}`); }
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      return server.address().port;
    },
    close() { return new Promise((r) => server?.close(r)); },
  };
}

/** 最小 fake service：只暴露 status()。 */
function fakeService({ dshPort = 3080 } = {}) {
  return {
    status: async () => ({ dshPort, proxyRunning: true, proxyPort: 3081, lanUrl: 'http://127.0.0.1:3081', lanQr: null, lanCandidates: [], lanIpOverride: '', tunnelRunning: false, tunnelUrl: null, tunnelQr: null, tunnelState: { phase: 'idle' }, tunnelConfig: { mode: 'quick', hostname: '', tokenSet: false } }),
    stopTunnel() {},
    dispose: async () => {},
  };
}

/** 拿一个本地 HTTP 请求结果。 */
function postJson(port, path, body, { host = '127.0.0.1', origin, contentType = 'application/json', secFetchSite } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host, 'content-type': contentType };
    if (origin !== undefined) headers.origin = origin;
    if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite;
    const payload = body === undefined ? '' : JSON.stringify(body);
    if (payload) headers['content-length'] = Buffer.byteLength(payload);
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

/** 装配一个跑在 fake webServer 上的 dsh-pocket RPC，返回 { port, stop, ctx, installDispose }。 */
async function setup({ requestRejection, opts = {} } = {}) {
  const webServer = fakeWebServer();
  // 故意把 rpc.handle 设成抛错：若走回退路径就直接失败，证明走的是直接 mount 路径。
  const ctx = {
    webServer,
    connection: {
      rpc: { handle: () => { throw new Error('test: must not call rpc.handle when webServer is available'); } },
      requestRejection,
    },
  };
  const installDispose = installPocketRpc(ctx, {
    service: fakeService(),
    log: { error() {}, warn() {} },
    ...opts,
  });
  const port = await webServer.listen();
  return { port, stop: async () => { try { installDispose?.(); } catch {} await webServer.close(); }, ctx, installDispose };
}

test('直接挂 webServer：不走 rpc.handle（rpc.handle 抛错也照常 mount）', async () => {
  const env = await setup();
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r1', method: POCKET_ENDPOINTS.status, payload: {} });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.type, 'server-response');
    assert.equal(body.rpcId, 'r1');
    assert.equal(body.result.ok, true);
    assert.equal(body.result.value.dshPort, 3080);
  } finally { await env.stop(); }
});

test('认证门：requestRejection 返回 401 → 401 unauthorized', async () => {
  const env = await setup({ requestRejection: () => 401 });
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r2', method: POCKET_ENDPOINTS.status, payload: {} });
    assert.equal(res.status, 401);
    assert.equal(res.body, 'unauthorized');
  } finally { await env.stop(); }
});

test('认证门：requestRejection 返回 403 → 403 forbidden', async () => {
  const env = await setup({ requestRejection: () => 403 });
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r3', method: POCKET_ENDPOINTS.status, payload: {} });
    assert.equal(res.status, 403);
    assert.equal(res.body, 'forbidden');
  } finally { await env.stop(); }
});

test('认证门：无 requestRejection 且 Host 非 loopback → 403', async () => {
  const env = await setup({ requestRejection: undefined });
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r4', method: POCKET_ENDPOINTS.status, payload: {} }, { host: 'evil.example.com' });
    assert.equal(res.status, 403);
    assert.equal(res.body, 'forbidden');
  } finally { await env.stop(); }
});

test('认证门：无 requestRejection 且 sec-fetch-site=cross-site → 403', async () => {
  const env = await setup({ requestRejection: undefined });
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r5', method: POCKET_ENDPOINTS.status, payload: {} }, { secFetchSite: 'cross-site' });
    assert.equal(res.status, 403);
  } finally { await env.stop(); }
});

test('路由：非 POST → 404', async () => {
  const env = await setup();
  try {
    const { default: http } = await import('node:http');
    const res = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: env.port, path: `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, method: 'GET', headers: { host: '127.0.0.1' } }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.status, 404);
    assert.equal(res.body, 'not found');
  } finally { await env.stop(); }
});

test('路由：endpoint 段含 ".." → 404', async () => {
  const env = await setup();
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/../evil`, { rpcId: 'x', method: 'x', payload: {} });
    assert.equal(res.status, 404);
  } finally { await env.stop(); }
});

test('content-type：非 application/json → 415', async () => {
  const env = await setup();
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r6', method: POCKET_ENDPOINTS.status, payload: {} }, { contentType: 'text/plain' });
    assert.equal(res.status, 415);
    assert.match(res.body, /application\/json/);
  } finally { await env.stop(); }
});

test('body：非 JSON → 400', async () => {
  const env = await setup();
  try {
    const { default: http } = await import('node:http');
    const res = await new Promise((resolve, reject) => {
      const payload = 'not-json-at-all';
      const req = http.request({ host: '127.0.0.1', port: env.port, path: `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, method: 'POST', headers: { host: '127.0.0.1', 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end(payload);
    });
    assert.equal(res.status, 400);
    assert.match(res.body, /not JSON/);
  } finally { await env.stop(); }
});

test('信封：缺 rpcId → 200 + invalid-request 兜底', async () => {
  const env = await setup();
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { method: POCKET_ENDPOINTS.status, payload: {} });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.type, 'server-response');
    assert.equal(body.rpcId, 'invalid-request');
    assert.equal(body.result.ok, false);
    assert.equal(body.result.error.code, 'bad-request');
    assert.match(body.result.error.message, /invalid client-request/);
  } finally { await env.stop(); }
});

test('信封：method 与 endpoint 不匹配 → 200 + gateway bad-request', async () => {
  const env = await setup();
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r7', method: 'pocket.version', payload: {} });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.rpcId, 'r7');
    assert.equal(body.result.ok, false);
    assert.equal(body.result.error.code, 'bad-request');
    assert.match(body.result.error.message, /does not match/);
  } finally { await env.stop(); }
});

test('handler 抛错 → 200 + bad-request（业务层 try-catch 归一化）', async () => {
  // 注意：installPocketRpc 的 pocketRpcHandler 末尾有 try-catch，业务异常会被归一化
  // 成 bad-request（200 + server-response），而不是 500。500 只在 fetch handler 自己
  // 外层 try 失败时触发——业务层已 catch，所以生产路径基本不会到 500。
  const env = await setup({
    requestRejection: undefined,
    opts: {
      service: {
        status: async () => { throw new Error('boom'); },
        stopTunnel() {},
        dispose: async () => {},
      },
    },
  });
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r8', method: POCKET_ENDPOINTS.status, payload: {} });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.rpcId, 'r8');
    assert.equal(body.result.ok, false);
    assert.equal(body.result.error.code, 'bad-request');
    assert.match(body.result.error.message, /boom/);
  } finally { await env.stop(); }
});

test('成功响应：server-response 信封形状与原 /api 逐字节一致', async () => {
  const env = await setup();
  try {
    const res = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r9', method: POCKET_ENDPOINTS.status, payload: {} });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/json');
    const body = JSON.parse(res.body);
    assert.deepEqual(Object.keys(body).sort(), ['result', 'rpcId', 'type']);
    assert.equal(body.type, 'server-response');
    assert.equal(body.rpcId, 'r9');
    assert.deepEqual(Object.keys(body.result), ['ok', 'value']);
    assert.equal(body.result.ok, true);
  } finally { await env.stop(); }
});

test('disposer：调用后路由从 webServer 移除，再请求 → 404', async () => {
  const env = await setup();
  try {
    const before = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r10', method: POCKET_ENDPOINTS.status, payload: {} });
    assert.equal(before.status, 200);

    env.installDispose?.();
    // 给路由表一点反应时间（同步 disposer 立即生效，这里只是稳妥）
    const after = await postJson(env.port, `${POCKET_RPC_CHANNEL}/${POCKET_ENDPOINTS.status}`, { rpcId: 'r11', method: POCKET_ENDPOINTS.status, payload: {} });
    assert.equal(after.status, 404);
  } finally { await env.stop(); }
});

test('无 webServer 时回退 rpc.handle（旧版 dsh 兼容路径）', async () => {
  let handler = null;
  const ctx = {
    connection: {
      rpc: {
        handle: (channel, fn, opts) => {
          assert.equal(channel, POCKET_RPC_CHANNEL);
          assert.deepEqual(opts, { authority: 'loopback' });
          handler = fn;
          return () => { handler = null; };
        },
      },
      // 不提供 requestRejection，但因为没有 webServer，根本走不到认证门
    },
    // 故意没有 webServer
  };
  const dispose = installPocketRpc(ctx, { service: fakeService(), log: { error() {}, warn() {} } });
  assert.equal(typeof handler, 'function', '回退到 rpc.handle，handler 被注册');

  const result = await handler(POCKET_ENDPOINTS.status, {});
  assert.equal(result.ok, true);
  assert.equal(result.value.dshPort, 3080);

  dispose();
});

test('无 webServer 且无 connection.rpc.handle → 返回空 disposer + 警告日志', async () => {
  const warnings = [];
  const ctx = { connection: { rpc: {} } }; // 无 handle、无 webServer
  const dispose = installPocketRpc(ctx, { service: fakeService(), log: { error() {}, warn: (m) => warnings.push(m) } });
  assert.equal(typeof dispose, 'function');
  assert.ok(warnings.some((m) => /Connection RPC unavailable/.test(m)), '应有 unavailable 警告');
  dispose();
});
