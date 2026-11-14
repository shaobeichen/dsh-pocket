// 隧道就绪度监督 / 自愈测试（stub 隧道 + stub 探活，无网络）
//
// 复现的真实故障：cloudflared 进程活着、边缘注册丢失（/ready readyConnections=0），
// 手机端 Cloudflare 1016/1033/530。旧行为是界面永远显示"已开启"且不自愈；
// 新行为是连续 N 次探活失败后自动重建隧道，并把状态/健康快照透出到 status。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPocketService } from '../lib/service.mjs';
import { redactStatus } from '../client/api.js';

async function waitFor(predicate, { timeoutMs = 3000, intervalMs = 10, label = 'condition' } = {}) {
  const startedAt = Date.now();
  for (;;) {
    let ok = false;
    try { ok = Boolean(await predicate()); } catch { ok = false; }
    if (ok) return;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`waitFor timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** 假隧道工厂：每次 spawn 产生一个句柄；可手动触发 onExit（模拟进程崩溃）。 */
function makeTunnelFactory() {
  const handles = [];
  let spawnCount = 0;
  const failQueue = [];
  let autoExitMs = null;
  let spawnDelayMs = 0;
  const startTunnel = async ({ onPhase } = {}) => {
    spawnCount += 1;
    if (spawnDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, spawnDelayMs));
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
    if (autoExitMs !== null) setTimeout(() => handle.exit(1), autoExitMs);
    return handle;
  };
  return {
    startTunnel,
    handles,
    get spawnCount() { return spawnCount; },
    get last() { return handles[handles.length - 1]; },
    failOnce(err) { failQueue.push(err); },
    setAutoExit(ms) { autoExitMs = ms; },
    setSpawnDelay(ms) { spawnDelayMs = ms; },
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
    healthStableMs: 60_000, // 单测默认不让"稳定"重置预算；专门测复位的用例自己传 0
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

  await new Promise((resolve) => setTimeout(resolve, 120));
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
  const h = makeService();
  const before = h.probeCalls;
  const health = await h.service.checkTunnelHealth();
  assert.equal(health.readyConnections, null);
  assert.equal(h.probeCalls, before, '没有隧道不探活');
  await h.service.dispose();
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
  await new Promise((resolve) => setTimeout(resolve, 340));
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

test('启动成功但 /ready 永远为 0：预算跨事件累计，耗尽后停手（不再无限换地址/轮换密码）', async () => {
  const warns = [];
  const { service, factory, setProbe } = makeService({
    healthMaxRestarts: 2,
    log: { info() {}, log() {}, warn: (...a) => warns.push(a.join(' ')), error() {} },
  });
  await service.startProxy();
  await service.startTunnel(); // 第 1 次 spawn
  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });

  const failCycle = async () => { await service.checkTunnelHealth(); await service.checkTunnelHealth(); };
  await failCycle(); // 第 1 次自动重建成功（budget=1，spawn 2）
  await failCycle(); // 第 2 次自动重建成功（budget=2，spawn 3）
  await failCycle(); // 预算已耗尽 → 不再 spawn，置 error

  const status = await service.status();
  assert.equal(factory.spawnCount, 3, '初始 1 次 + 2 次自动重建后必须停手（旧实现会无限重建）');
  assert.equal(status.tunnelState.phase, 'error');
  assert.match(status.tunnelState.detail, /连续 2 次未恢复/);
  assert.equal(status.tunnelRunning, false);
  assert.ok(warns.some((w) => /自愈重建仍未恢复|gave up/.test(w)), '预算耗尽必须留下最终结论日志');
  await service.dispose();
});

test('进程启动后立即退出：预算耗尽后停手，不无限 spawn', async () => {
  const { service, factory } = makeService({ healthMaxRestarts: 2 });
  factory.setAutoExit(1); // 每次 spawn 后 1ms 进程就退出
  await service.startProxy();
  await service.startTunnel();

  await waitFor(async () => (await service.status()).tunnelState.phase === 'error', {
    timeoutMs: 5000, label: 'budget exhausted → error',
  });
  const countAtError = factory.spawnCount;
  assert.ok(countAtError <= 3, `spawn 次数必须有界（实际 ${countAtError}）`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(factory.spawnCount, countAtError, 'error 后不得继续重建');
  await service.dispose();
});

test('连续健康满 healthStableMs 后预算清零：再次失联仍可重建', async () => {
  const { service, factory, setProbe } = makeService({ healthMaxRestarts: 1, healthStableMs: 0 });
  await service.startProxy();
  await service.startTunnel();

  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await service.checkTunnelHealth();
  await service.checkTunnelHealth(); // 耗尽唯一预算 → 自动重建（attempt=1，spawn 2）
  assert.equal(factory.spawnCount, 2);
  assert.equal((await service.status()).tunnelState.phase, 'ready');

  setProbe({ ok: true, readyConnections: 1, status: 200, error: '' });
  await service.checkTunnelHealth(); // 稳定健康 → 预算清零

  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await service.checkTunnelHealth();
  await service.checkTunnelHealth(); // 预算已复位 → 允许再次重建（spawn 3）
  assert.equal(factory.spawnCount, 3, '稳定健康后预算应清零，允许再次自愈');
  assert.equal((await service.status()).tunnelState.phase, 'ready');
  await service.dispose();
});

test('用户手动重新开启会清零预算：error 后点「开启」+ 再失联仍可自愈', async () => {
  const { service, factory, setProbe } = makeService({ healthMaxRestarts: 1 });
  await service.startProxy();
  await service.startTunnel();
  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });

  const failCycle = async () => { await service.checkTunnelHealth(); await service.checkTunnelHealth(); };
  await failCycle(); // 自动重建一次（spawn 2，预算耗尽）
  await failCycle(); // 立即 error
  assert.equal((await service.status()).tunnelState.phase, 'error');
  const countAtError = factory.spawnCount;

  setProbe({ ok: true, readyConnections: 1, status: 200, error: '' });
  await service.startTunnel(); // 用户手动重新开启（resetTunnelBudget 在 startTunnel 里）
  assert.equal(factory.spawnCount, countAtError + 1, '用户手动开启应重新 spawn');

  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await failCycle(); // 预算已由手动开启清零 → 允许一次新的自愈
  assert.equal(factory.spawnCount, countAtError + 2, '手动开启后预算清零，可再次自愈');
  await service.dispose();
});

test('旧隧道的稳定期不跨实例：崩溃重建后，新隧道第一次探活成功不得立即清零预算', async () => {
  // 评审反馈的边界：healthStableSince 若不在 kill/重建时清空，旧隧道长期稳定会被算到新隧道头上，
  // 新隧道第一次探活成功就把预算清零 → "能启动但马上死"又会变成有限预算下的无限循环。
  const { service, factory, setProbe } = makeService({ healthMaxRestarts: 1, healthStableMs: 200 });
  await service.startProxy();
  await service.startTunnel(); // spawn 1

  setProbe({ ok: true, readyConnections: 1, status: 200, error: '' });
  await service.checkTunnelHealth(); // 旧隧道开始稳定计时（t0）

  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await service.checkTunnelHealth();
  await service.checkTunnelHealth(); // 耗尽预算 1 → 自动重建（spawn 2）
  assert.equal(factory.spawnCount, 2);

  await new Promise((resolve) => setTimeout(resolve, 260)); // 若不清空，旧稳定窗口已超 healthStableMs

  setProbe({ ok: true, readyConnections: 1, status: 200, error: '' });
  await service.checkTunnelHealth(); // 新隧道第一次探活成功：预算必须仍为已耗尽状态

  setProbe({ ok: false, readyConnections: 0, status: 503, error: '' });
  await service.checkTunnelHealth();
  await service.checkTunnelHealth();

  const status = await service.status();
  assert.equal(factory.spawnCount, 2, '预算不得因旧稳定期被清零（否则会再次无限重建）');
  assert.equal(status.tunnelState.phase, 'error');
  await service.dispose();
});

test('旧版 cloudflared 没有 /ready（HTTP 404）：关闭就绪自愈，不重建本来可用的隧道', async () => {
  let probes = 0;
  const factory = makeTunnelFactory();
  const warns = [];
  const service = createPocketService({
    dshPort: 3080,
    port: 3081,
    internals: {
      ...makeInternals({
        probe: async () => {
          probes += 1;
          return { ok: false, readyConnections: 0, status: 404, unsupported: true, error: '' };
        },
        tunnelFactory: factory,
      }),
    },
    healthCheckIntervalMs: 20,
    healthCheckFailures: 2,
    healthStartupGraceMs: 0,
    healthRestartBackoffMs: [0],
    healthMaxRestarts: 2,
    log: { info() {}, log() {}, warn: (...a) => warns.push(a.join(' ')), error() {} },
  });
  await service.startProxy();
  await service.startTunnel();
  await waitFor(() => probes >= 1, { label: 'first 404 probe' });
  await new Promise((resolve) => setTimeout(resolve, 120)); // 定时器应已关闭

  const status = await service.status();
  assert.equal(factory.spawnCount, 1, '404 不代表失联，绝不能重建可用隧道');
  assert.equal(status.tunnelState.phase, 'ready');
  assert.ok(probes <= 2, `关闭自愈后应停止探活（实际探测 ${probes} 次）`);
  assert.ok(warns.some((w) => /ready unsupported|就绪自愈已关闭/.test(w)), '应告警一次');
  await service.dispose();
});

test('healthCheckIntervalMs<=0（兼容旧行为）：进程退出只置 error，不自动重建', async () => {
  const { service, factory } = makeService({ healthCheckIntervalMs: 0 });
  await service.startProxy();
  await service.startTunnel();
  factory.last.exit(1);
  await waitFor(async () => (await service.status()).tunnelState.phase === 'error', { label: 'legacy error state' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(factory.spawnCount, 1, '关闭自愈时不得重建');
  await service.dispose();
});

test('启动进行中 stopTunnel：晚到的隧道进程必须被杀掉，不得"复活"成 ready', async () => {
  const factory = makeTunnelFactory();
  factory.setSpawnDelay(120);
  const service = createPocketService({
    dshPort: 3080,
    port: 3081,
    internals: makeInternals({ tunnelFactory: factory, probe: async () => ({ ok: true, readyConnections: 1, status: 200, unsupported: false, error: '' }) }),
    healthCheckIntervalMs: 60_000,
    healthCheckFailures: 2,
    healthStartupGraceMs: 0,
    log: { info() {}, log() {}, warn() {}, error() {} },
  });
  await service.startProxy();
  const startPromise = service.startTunnel(); // 启动中（spawn 还在 delay 里）
  await new Promise((resolve) => setTimeout(resolve, 30));
  service.stopTunnel(); // 用户停止

  await assert.rejects(() => startPromise, /已取消|cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 200)); // 等晚到的 spawn 完成清理

  const status = await service.status();
  assert.equal(status.tunnelState.phase, 'idle');
  assert.equal(status.tunnelRunning, false);
  assert.equal(factory.last?.killed, true, '晚到的隧道进程必须被杀掉');
  assert.equal(factory.spawnCount, 1);
  await service.dispose();
});

test('停止后旧进程的 onExit 晚到：不得触发自愈重建', async () => {
  const { service, factory } = makeService();
  await service.startProxy();
  await service.startTunnel();
  const handle = factory.last;
  service.stopTunnel();
  handle.exit(1); // 模拟 kill 后 exit 回调晚到
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(factory.spawnCount, 1);
  assert.equal((await service.status()).tunnelState.phase, 'idle');
  await service.dispose();
});

test('dispose 会停止探活定时器，不再继续探活', async () => {
  let probes = 0;
  const service = createPocketService({
    dshPort: 3080,
    port: 3081,
    internals: makeInternals({
      tunnelFactory: makeTunnelFactory(),
      probe: async () => { probes += 1; return { ok: true, readyConnections: 1, status: 200, unsupported: false, error: '' }; },
    }),
    healthCheckIntervalMs: 20,
    healthCheckFailures: 2,
    healthStartupGraceMs: 0,
    log: { info() {}, log() {}, warn() {}, error() {} },
  });
  await service.startProxy();
  await service.startTunnel();
  await waitFor(() => probes >= 1, { label: 'first probe' });
  await service.dispose();
  const probesAfterDispose = probes;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(probes, probesAfterDispose, 'dispose 后不得继续探活');
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
