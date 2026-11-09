// 隧道就绪度监督 / 自愈测试（stub 隧道 + stub 探活，无网络）
//
// 复现的真实故障：cloudflared 进程活着、边缘注册丢失（/ready readyConnections=0），
// 手机端 Cloudflare 1016/1033/530。旧行为是界面永远显示"已开启"且不自愈；
// 新行为是连续 N 次探活失败后自动重建隧道，并把状态/健康快照透出到 status。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPocketService } from '../lib/service.mjs';
import { redactStatus } from '../client/api.js';

function waitFor(predicate, { timeoutMs = 3000, intervalMs = 10, label = 'condition' } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = Boolean(predicate()); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`waitFor timeout: ${label}`));
      setTimeout(tick, intervalMs).unref?.();
    };
    tick();
  });
}

/** 假隧道工厂：每次 spawn 产生一个句柄；可手动触发 onExit（模拟进程崩溃）。 */
function makeTunnelFactory() {
  const handles = [];
  let spawnCount = 0;
  const failQueue = [];
  const startTunnel = async ({ onPhase } = {}) => {
    spawnCount += 1;
    if (failQueue.length) throw failQueue.shift();
    onPhase?.('starting');
    onPhase?.('registering');
    onPhase?.('ready');
    const handle = {
      url: `https://t${spawnCount}.trycloudflare.com`,
      metricsPort: 20000 + spawnCount,
      killed: false,
      exitCb: null,
      kill() { handle.killed = true; },
      onExit(cb) { handle.exitCb = cb; return () => { handle.exitCb = null; }; },
      /** 模拟进程运行中退出 */
      exit(code = 1) { handle.exitCb?.(code); },
    };
    handles.push(handle);
    return handle;
  };
  return {
    startTunnel,
    handles,
    get spawnCount() { return spawnCount; },
    get last() { return handles[handles.length - 1]; },
    failOnce(err) { failQueue.push(err); },
  };
}

function makeInternals({ probe, tunnelFactory }) {
  return {
    lanIPv4: () => '192.168.1.50',
    lanCandidates: async () => ['192.168.1.50'],
    encodeQr: async (text) => `data:qr;${text}`,
    createProxy: async ({ port }) => ({ port, close: async () => {} }),
    startTunnel: tunnelFactory.startTunnel,
    probeReady: probe,
  };
}

/** 默认服务参数：关闭自动定时器（测试手动调 checkTunnelHealth），退避 0 便于断言。 */
function makeService({ probe, tunnelFactory, ...overrides } = {}) {
  const factory = tunnelFactory ?? makeTunnelFactory();
  let probeResult = { ok: true, readyConnections: 1, status: 200, error: '' };
  let probeCalls = 0;
  const probeImpl = probe ?? (async () => { probeCalls += 1; return probeResult; });
  const service = createPocketService({
    dshPort: 3080,
    port: 3081,
    internals: makeInternals({ probe: probeImpl, tunnelFactory: factory }),
    // 默认开启自愈（进程退出/探活失败都会自动重建），但 60s 定时器在一次测试内不会触发，
    // 需要定时行为的用例自己传更小的间隔。
    healthCheckIntervalMs: 60_000,
    healthCheckFailures: 2,
    healthStartupGraceMs: 0, // 单测默认关闭宽限（专门测宽限的用例自己传）
    healthRestartBackoffMs: [0],
    healthMaxRestarts: 2,
    log: { info() {}, log() {}, warn() {}, error() {} },
    ...overrides,
  });
  return {
    service,
    factory,
    get probeCalls() { return probeCalls; },
    setProbe(next) { probeResult = next; },
  };
}

test('探活成功：不重建，健康快照透出 status', async () => {
  const { service, factory } = makeService();
  await service.startProxy();
  await service.startTunnel();

  const health = await service.checkTunnelHealth();
  assert.equal(health.readyConnections, 1);
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.restarts, 0);
  assert.ok(health.lastCheckAt > 0);
  assert.equal(factory.spawnCount, 1, '健康时不应重建');

  const status = await service.status();
  assert.deepEqual(status.tunnelHealth, health, 'status 透出同一份健康快照');
  assert.equal(status.tunnelState.phase, 'ready');
  await service.dispose();
});

test('连续探活失败（readyConnections=0）→ 自动重建并恢复 ready', async () => {
  const { service, factory, setProbe } = makeService();
  await service.startProxy();
  await service.startTunnel();
  const firstHandle = factory.last;

  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  const first = await service.checkTunnelHealth();
  assert.equal(first.consecutiveFailures, 1, '第一次失败先不重建（避免抖动误换地址）');
  assert.equal(factory.spawnCount, 1);

  // 第二次达到阈值 → 重建
  await service.checkTunnelHealth();
  assert.equal(factory.spawnCount, 2, '达到阈值后重建隧道');
  assert.equal(firstHandle.killed, true, '旧进程被终止');

  const status = await service.status();
  assert.equal(status.tunnelState.phase, 'ready');
  assert.equal(status.tunnelUrl, 'https://t2.trycloudflare.com', '快速隧道重建后是新地址');
  assert.equal(status.tunnelHealth.restarts, 1);
  assert.equal(status.tunnelHealth.consecutiveFailures, 0, '重建成功后失败计数清零');
  await service.dispose();
});

test('重建成功后 onTunnelReady 再次回调（快速模式要轮换访问密码）', async () => {
  const modes = [];
  const { service, setProbe } = makeService({ onTunnelReady: (mode) => modes.push(mode) });
  await service.startProxy();
  await service.startTunnel();
  assert.deepEqual(modes, ['quick'], '首次就绪');

  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await service.checkTunnelHealth();
  await service.checkTunnelHealth();
  assert.deepEqual(modes, ['quick', 'quick'], '重建后重新回调（旧地址/旧密码作废）');
  await service.dispose();
});

test('隧道进程运行中崩溃 → 自动重建（不再只显示 error）', async () => {
  const { service, factory } = makeService();
  await service.startProxy();
  await service.startTunnel();
  assert.equal(factory.spawnCount, 1);

  factory.last.exit(137);
  await waitFor(() => factory.spawnCount === 2, { label: 'process exit auto-rebuild' });

  const status = await service.status();
  assert.equal(status.tunnelState.phase, 'ready');
  assert.equal(status.tunnelUrl, 'https://t2.trycloudflare.com');
  assert.equal(status.tunnelHealth.restarts, 1);
  await service.dispose();
});

test('连续重建失败达到上限 → error 状态停手，不再无限 spawn', async () => {
  const { service, factory, setProbe } = makeService();
  await service.startProxy();
  await service.startTunnel();

  // 之后每次 spawn 都失败
  factory.failOnce(new Error('spawn boom'));
  factory.failOnce(new Error('spawn boom'));
  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await service.checkTunnelHealth();
  await service.checkTunnelHealth(); // 触发重建，2 次尝试都失败

  const status = await service.status();
  assert.equal(status.tunnelState.phase, 'error');
  assert.match(status.tunnelState.detail, /重建失败/);
  assert.equal(status.tunnelRunning, false);
  assert.equal(factory.spawnCount, 3, '首次 1 次 + 重建 2 次，之后停手');
  await service.dispose();
});

test('重建退避等待期间用户手动关闭 → 取消重建，不再 spawn', async () => {
  const { service, factory, setProbe } = makeService({ healthRestartBackoffMs: [50] });
  await service.startProxy();
  await service.startTunnel();

  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await service.checkTunnelHealth();
  const pending = service.checkTunnelHealth(); // 达到阈值 → 进入 50ms 退避等待
  service.stopTunnel(); // 用户在等待期间关闭
  await pending;

  await new Promise((resolve) => setTimeout(resolve, 120).unref?.());
  assert.equal(factory.spawnCount, 1, '用户主动关闭后不得再重建');
  const status = await service.status();
  assert.equal(status.tunnelState.phase, 'idle');
  assert.equal(status.tunnelRunning, false);
  await service.dispose();
});

test('没有 metrics 端口的隧道（旧实现）→ 跳过探活，不误判重建', async () => {
  const factory = makeTunnelFactory();
  const legacyStart = factory.startTunnel;
  let probeCalls = 0;
  const service = createPocketService({
    dshPort: 3080,
    port: 3081,
    internals: {
      ...makeInternals({
        probe: async () => { probeCalls += 1; return { ok: false, readyConnections: 0, status: 503, error: '' }; },
        tunnelFactory: { startTunnel: async (opts) => ({ ...(await legacyStart(opts)), metricsPort: undefined }) },
      }),
    },
    // 默认开启自愈（进程退出/探活失败都会自动重建），但 60s 定时器在一次测试内不会触发，
    // 需要定时行为的用例自己传更小的间隔。
    healthCheckIntervalMs: 60_000,
    healthCheckFailures: 2,
    healthStartupGraceMs: 0, // 单测默认关闭宽限（专门测宽限的用例自己传）
    log: { info() {}, log() {}, warn() {}, error() {} },
  });
  await service.startProxy();
  await service.startTunnel();
  await service.checkTunnelHealth();
  await service.checkTunnelHealth();
  assert.equal(probeCalls, 0, '无 metrics 端口时不做探活');
  assert.equal((await service.status()).tunnelState.phase, 'ready');
  await service.dispose();
});

test('未开启隧道（或已停止）时 checkTunnelHealth 是空操作', async () => {
  const { service, probeCalls: _unused, ...rest } = makeService();
  const before = rest.probeCalls;
  const health = await service.checkTunnelHealth();
  assert.equal(health.readyConnections, null);
  assert.equal(rest.probeCalls, before, '没有隧道不探活');
  await service.dispose();
});

test('启动宽限期内（边缘注册尚未完成）探活失败不计数，不误重建', async () => {
  const { service, factory, setProbe } = makeService({ healthStartupGraceMs: 300 });
  await service.startProxy();
  await service.startTunnel();
  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });

  // 刚拿到 URL、注册还没完成：/ready 可能暂时是 0，但绝不能因此重建
  await service.checkTunnelHealth();
  await service.checkTunnelHealth();
  assert.equal(factory.spawnCount, 1, '宽限期内不重建');
  assert.equal((await service.status()).tunnelHealth.consecutiveFailures, 0, '宽限期内失败不计数');

  // 宽限到点仍未就绪 → 恢复计数，两次失败后重建
  await new Promise((resolve) => setTimeout(resolve, 340).unref?.());
  await service.checkTunnelHealth();
  await service.checkTunnelHealth();
  assert.equal(factory.spawnCount, 2, '宽限结束后照常自动重建');
  await service.dispose();
});

test('宽限期内首次探活成功即提前结束宽限，之后失败照常计数', async () => {
  const { service, factory, setProbe } = makeService({ healthStartupGraceMs: 60_000 });
  await service.startProxy();
  await service.startTunnel();

  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await service.checkTunnelHealth();
  assert.equal((await service.status()).tunnelHealth.consecutiveFailures, 0, '宽限期内不计数');

  setProbe({ ok: true, readyConnections: 2, status: 200, error: '' });
  await service.checkTunnelHealth();
  assert.equal((await service.status()).tunnelHealth.consecutiveFailures, 0, '成功探活结束宽限');

  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await service.checkTunnelHealth();
  await service.checkTunnelHealth();
  assert.equal(factory.spawnCount, 2, '宽限结束后失败照常触发重建');
  await service.dispose();
});

test('自动定时器：健康时按间隔轮询，失败达阈值后自动重建（不依赖手动调用）', async () => {
  const { service, factory, setProbe } = makeService({
    healthCheckIntervalMs: 20,
    healthCheckFailures: 2,
    healthRestartBackoffMs: [0],
  });
  await service.startProxy();
  await service.startTunnel();

  // 先让它探活成功一轮，确认定时器在跑
  await waitFor(() => factory.spawnCount === 1, { label: 'initial spawn' });
  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await waitFor(() => factory.spawnCount === 2, { timeoutMs: 3000, label: 'timer-driven auto rebuild' });

  const status = await service.status();
  assert.equal(status.tunnelState.phase, 'ready');
  assert.ok(status.tunnelHealth.restarts >= 1);
  await service.dispose();
});

test('redactStatus 透出 tunnelHealth（设置页/排障可见），且不破坏既有字段', () => {
  const raw = {
    proxyRunning: true,
    tunnelState: { phase: 'ready', detail: 'ok', startedAt: 1 },
    tunnelHealth: { readyConnections: 1, consecutiveFailures: 0, restarts: 2, lastCheckAt: 123, lastError: '' },
  };
  const redacted = redactStatus(raw);
  assert.deepEqual(redacted.tunnelHealth, raw.tunnelHealth);
  assert.equal(redacted.proxyRunning, true);
  // 缺省时给 null，避免旧宿主/旧缓存崩
  assert.equal(redactStatus({}).tunnelHealth, null);
});
