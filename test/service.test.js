// dsh-pocket 服务 + RPC 测试（stub 隧道/代理，无网络）

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPocketService, selectLanIPv4 } from '../lib/service.mjs';
import { installPocketRpc } from '../lib/web-rpc.js';
import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS } from '../client/api.js';
import { isValidIpv4 } from '../lib/ip.mjs';

function fakeCtxConnection() {
  let handler = null;
  const handle = (channel, fn, opts) => {
    assert.equal(channel, POCKET_RPC_CHANNEL);
    assert.deepEqual(opts, { authority: 'loopback' });
    handler = fn;
    return () => { handler = null; };
  };
  return { rpc: { handle }, get handler() { return handler; } };
}

function stubInternals() {
  const started = [];
  let tunnelUrl = null;
  return {
    started,
    lanIPv4: () => '192.168.1.50',
    lanCandidates: async () => ['192.168.1.50', '100.119.24.44'],
    encodeQr: async (text) => `data:qr;${text}`,
    createProxy: async ({ port }) => ({
      port,
      close: async () => { started.push('closed'); },
    }),
    startTunnel: async ({ port }) => {
      started.push(`tunnel:${port}`);
      tunnelUrl = 'https://abc-123.trycloudflare.com';
      return tunnelUrl;
    },
    get tunnelUrl() { return tunnelUrl; },
  };
}

/** 构造 networkInterfaces() 形状的最小接口表。 */
function ifaces(entries) {
  return Object.fromEntries(entries.map(([name, ip]) => [name, [{ address: ip, family: 'IPv4', internal: false }]]));
}

test('selectLanIPv4：排在前面的 Radmin VPN 不遮蔽 WLAN 私网地址', () => {
  assert.equal(
    selectLanIPv4(ifaces([
      ['Radmin VPN', '198.51.100.10'],
      ['WLAN', '192.168.1.50'],
    ])),
    '192.168.1.50',
  );
});

test('selectLanIPv4：两张私网网卡时优先名称像物理网卡的接口', () => {
  assert.equal(
    selectLanIPv4(ifaces([
      ['vEthernet (WSL)', '172.25.0.1'],
      ['以太网', '10.0.0.8'],
    ])),
    '10.0.0.8',
    '同为 RFC1918 私网时，物理网卡优先于虚拟网卡',
  );
});

test('selectLanIPv4：没有私网地址时回退到非回环地址（纯 VPN 环境仍可用）', () => {
  assert.equal(
    selectLanIPv4(ifaces([
      ['Radmin VPN', '198.51.100.10'],
      ['Loopback Pseudo-Interface 1', '127.0.0.1'],
      ['WLAN', '169.254.12.34'],
    ])),
    '198.51.100.10',
  );
});

test('selectLanIPv4：空接口表返回 null', () => {
  assert.equal(selectLanIPv4({}), null);
});

test('service：lanIpOverride 优先于自动选择，status 返回候选地址', async () => {
  const internals = stubInternals();
  let override = '';
  const service = createPocketService({ dshPort: 3080, port: 3081, internals, getLanIpOverride: () => override });
  await service.startProxy();

  let st = await service.status();
  assert.equal(st.lanUrl, 'http://192.168.1.50:3081', '默认自动选择');
  assert.deepEqual(st.lanCandidates, ['192.168.1.50', '100.119.24.44'], '候选包含 Tailscale IP');
  assert.equal(st.lanIpOverride, '', '未设置覆盖');

  override = '100.119.24.44';
  st = await service.status();
  assert.equal(st.lanUrl, 'http://100.119.24.44:3081', '手动覆盖优先');
  assert.equal(st.lanIpOverride, '100.119.24.44', '状态返回当前覆盖');

  override = 'not-an-ip';
  st = await service.status();
  assert.equal(st.lanUrl, 'http://192.168.1.50:3081', '非法覆盖被忽略，回退自动选择');
  assert.equal(st.lanIpOverride, '', '非法覆盖不进入状态');

  await service.dispose();
});


test('service：startProxy → 局域网状态（含二维码）；startTunnel → 公网状态', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });

  const before = await service.status();
  assert.equal(before.proxyRunning, false);

  const proxy = await service.startProxy();
  assert.equal(proxy.port, 3081);
  const lan = await service.status();
  assert.equal(lan.lanUrl, 'http://192.168.1.50:3081');
  assert.equal(lan.lanQr, 'data:qr;http://192.168.1.50:3081');
  assert.equal(lan.tunnelRunning, false);

  const url = await service.startTunnel();
  assert.equal(url, 'https://abc-123.trycloudflare.com');
  const pub = await service.status();
  assert.equal(pub.tunnelRunning, true);
  assert.equal(pub.tunnelQr, 'data:qr;https://abc-123.trycloudflare.com');
  assert.deepEqual(internals.started, ['tunnel:3081'], '隧道指向代理端口');

  service.stopTunnel();
  const stopped = await service.status();
  assert.equal(stopped.tunnelRunning, false);
  assert.equal(stopped.lanUrl, 'http://192.168.1.50:3081', '停隧道不影响局域网代理');

  await service.dispose();
});

test('RPC：status / tunnel.start / tunnel.stop / 未知端点', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, { service, log: { error() {}, warn() {} } });

  // 先让代理跑起来（插件 apply 里会自动启动）
  await service.startProxy();

  const s1 = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(s1.ok, true);
  assert.equal(s1.value.lanUrl, 'http://192.168.1.50:3081');
  assert.ok(s1.value.lanQr.startsWith('data:qr;'), '局域网二维码 data URL');
  assert.equal(s1.value.restartNotice, null, '无重启标记时 restartNotice 为 null');

  const denied = await conn.handler(POCKET_ENDPOINTS.tunnelStart, {});
  assert.equal(denied.ok, false, '未勾选免责声明 → 拒绝开启');
  assert.equal(denied.error.code, 'bad-request');
  assert.ok(denied.error.message.includes('免责声明'), '提示勾选免责声明');

  const started = await conn.handler(POCKET_ENDPOINTS.tunnelStart, { disclaimer: true });
  assert.equal(started.ok, true);
  assert.equal(started.value.tunnelRunning, true);
  assert.equal(started.value.tunnelUrl, 'https://abc-123.trycloudflare.com');

  const stopped = await conn.handler(POCKET_ENDPOINTS.tunnelStop, {});
  assert.equal(stopped.ok, true);
  assert.equal(stopped.value.tunnelRunning, false);

  const unknown = await conn.handler('nope', {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'bad-request');

  await service.dispose();
});

test('RPC：lan.setOverride 设置/清除覆盖地址，非法 IP 被拒绝', async () => {
  const internals = stubInternals();
  let stored = '';
  const service = createPocketService({ dshPort: 3080, port: 3081, internals, getLanIpOverride: () => stored });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, {
    service,
    getLanIpOverride: () => stored,
    setLanIpOverride: (ip) => {
      if (ip && !isValidIpv4(ip)) throw new Error('局域网地址必须是 IPv4 地址 | LAN address must be an IPv4 address');
      stored = ip;
      return ip;
    },
    log: { error() {}, warn() {} },
  });
  await service.startProxy();

  const set = await conn.handler(POCKET_ENDPOINTS.lanSetOverride, { ip: '100.119.24.44' });
  assert.equal(set.ok, true);
  assert.equal(set.value.lanIpOverride, '100.119.24.44', '覆盖地址已保存');
  const st = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(st.value.lanUrl, 'http://100.119.24.44:3081', '二维码使用覆盖地址');

  const bad = await conn.handler(POCKET_ENDPOINTS.lanSetOverride, { ip: '999.1.1.1' });
  assert.equal(bad.ok, false, '非法地址拒绝');
  assert.equal(bad.error.code, 'bad-request');

  const clear = await conn.handler(POCKET_ENDPOINTS.lanSetOverride, { ip: '' });
  assert.equal(clear.ok, true);
  assert.equal(clear.value.lanIpOverride, '', '清除覆盖');
  const restored = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(restored.value.lanUrl, 'http://192.168.1.50:3081', '恢复自动选择');

  await service.dispose();
});

test('RPC：status 携带重启提示（restartNotice）', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, {
    service,
    restartNotice: () => ({ at: Date.now(), pid: 12345 }),
    log: { error() {}, warn() {} },
  });

  const s = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(s.ok, true);
  assert.equal(s.value.restartNotice.pid, 12345, '重启标记随 status 返回');

  await service.dispose();
});

test('隧道进度：startTunnel 阶段透出到 status.tunnelState', async () => {
  const internals = {
    ...stubInternals(),
    startTunnel: async ({ onPhase }) => {
      onPhase('downloading');
      onPhase('registering');
      onPhase('ready');
      return { url: 'https://x.trycloudflare.com', kill: () => {} };
    },
  };
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  await service.startProxy();
  await service.startTunnel();
  const s = await service.status();
  assert.equal(s.tunnelState.phase, 'ready');
  assert.ok(s.tunnelState.startedAt > 0, '开始时间已记录');
  assert.ok(s.tunnelState.detail.length > 0);
  service.stopTunnel();
  const after = await service.status();
  assert.equal(after.tunnelState.phase, 'idle');
});

test('自重启：restartHost 用 detached 辅助进程交接，旧进程随后退出', async () => {
  const { restartHost } = await import('../lib/restart.js');
  const calls = [];
  const result = restartHost({
    internals: {
      spawn: (file, args, opts) => { calls.push({ file, args, detached: opts?.detached }); return { pid: 4242, unref: () => {} }; },
      kill: (pid) => calls.push('kill:' + pid),
    },
  });
  assert.equal(result.helperPid, 4242, '返回辅助进程 pid');
  assert.ok(result.logOut.endsWith('.out.log'), '输出日志路径');
  assert.ok(result.logErr.endsWith('.err.log'), '错误日志路径');
  // 辅助进程：node -e <helperCode>，detached，代码内含新 dsh 的启动命令
  assert.equal(calls.length, 1, '只拉起一个辅助进程');
  const helper = calls[0];
  assert.equal(helper.file, process.execPath, '用 node 拉起辅助进程');
  assert.equal(helper.args[0], '-e');
  assert.equal(helper.detached, true, '辅助进程 detached');
  const code = helper.args[1];
  assert.ok(code.includes(JSON.stringify(process.argv[0])), '辅助代码含 node 路径');
  assert.ok(code.includes('waitPort'), '辅助代码含端口释放探测（替代固定延时）');
  assert.ok(code.includes('setTimeout'), '辅助代码含轮询延时');
  // helper 代码必须是可执行的有效 JS（防拼接语法错误 → 重启静默失败）
  const vm = await import('node:vm');
  try {
    vm.compileFunction(code, [], { filename: 'restart-helper.js' });
  } catch (e) {
    assert.fail('helper 代码语法错误: ' + e.message);
  }
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(calls.some((c) => typeof c === 'string' && c.startsWith('kill:')), '短暂等待后旧进程退出');
});

test('dshPortFromArgs：--port / -p / --port= 三种形式', async () => {
  const { dshPortFromArgs } = await import('../lib/restart.js');
  assert.equal(dshPortFromArgs(['web']), 3080, '默认 3080');
  assert.equal(dshPortFromArgs(['web', '--port', '3099']), 3099);
  assert.equal(dshPortFromArgs(['web', '-p', '3100']), 3100);
  assert.equal(dshPortFromArgs(['web', '--port=3111']), 3111, '--port= 形式');
  assert.equal(dshPortFromArgs(['web', '--port', 'abc']), 3080, '非法值回退默认');
});

test('自重启失败：spawn 抛错 → 返回 helperPid:null 和错误', async () => {
  const { restartHost } = await import('../lib/restart.js');
  const result = restartHost({
    internals: {
      spawn: () => { throw new Error('boom'); },
      kill: () => {},
    },
  });
  assert.equal(result.helperPid, null);
  assert.match(result.error, /boom/);
});

test('readRestartNotice：真实文件系统（无文件/坏 JSON/过期/有效）', async () => {
  const os = await import('node:os');
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  const { readRestartNotice } = await import('../lib/index.js');

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-pocket-test-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  try {
    // 1. 无文件（ENOENT）→ null，且不得产生未处理的 promise rejection（曾导致启动崩溃）
    assert.equal(await readRestartNotice(), null, '无标记文件返回 null');

    // 2. 坏 JSON → null
    await fsp.mkdir(path.join(dir, 'dsh-pocket'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'dsh-pocket', 'restarted.json'), 'not-json');
    assert.equal(await readRestartNotice(), null, '坏 JSON 返回 null');

    // 3. 过期标记（31 分钟前）→ null
    await fsp.writeFile(path.join(dir, 'dsh-pocket', 'restarted.json'), JSON.stringify({ at: Date.now() - 31 * 60 * 1000, pid: 1 }));
    assert.equal(await readRestartNotice(), null, '过期标记返回 null');

    // 4. 有效标记 → 返回内容
    await fsp.writeFile(path.join(dir, 'dsh-pocket', 'restarted.json'), JSON.stringify({ at: Date.now(), pid: 4242 }));
    const n = await readRestartNotice();
    assert.equal(n.pid, 4242, '有效标记返回 pid');
  } finally {
    process.env.DSH_HOME = prev;
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('consumeRestartNotice：读后即删（横幅只显示一次，不会一直出现）', async () => {
  const os = await import('node:os');
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  const { consumeRestartNotice } = await import('../lib/index.js');

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-pocket-consume-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  try {
    const noticePath = path.join(dir, 'dsh-pocket', 'restarted.json');
    await fsp.mkdir(path.dirname(noticePath), { recursive: true });
    await fsp.writeFile(noticePath, JSON.stringify({ at: Date.now(), pid: 4242 }));

    // 第一次消费：返回标记，且文件被删除
    const n1 = await consumeRestartNotice();
    assert.equal(n1.pid, 4242, '第一次消费返回标记');
    await assert.rejects(fsp.access(noticePath), '文件已删除');

    // 第二次消费：文件没了 → null（横幅不会一直显示）
    const n2 = await consumeRestartNotice();
    assert.equal(n2, null, '消费后不再返回');
  } finally {
    process.env.DSH_HOME = prev;
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('RPC：restartNotice 读取抛错时 status 优雅降级为 null', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, {
    service,
    restartNotice: async () => { throw new Error('ENOENT'); },
    log: { error() {}, warn() {} },
  });
  await service.startProxy();
  const s = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(s.ok, true);
  assert.equal(s.value.restartNotice, null, '读取失败不阻塞 status');
  await service.dispose();
});

test('RPC：version 返回磁盘版本 current 与启动版本 loaded', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, {
    service,
    runUpdate: { currentVersion: () => '1.0.15', loadedVersion: () => '1.0.14', perform: async () => ({ ok: true }) },
    log: { error() {}, warn() {} },
  });

  const v = await conn.handler(POCKET_ENDPOINTS.version, {});
  assert.equal(v.ok, true);
  assert.equal(v.value.current, '1.0.15', 'current 是磁盘实时版本');
  assert.equal(v.value.loaded, '1.0.14', 'loaded 是进程启动版本');

  await service.dispose();
});

test('lib/index.js 模块可加载，apply 可调用（防模块级 ReferenceError 回归）', async () => {
  // 回归：pocketRestart 曾引用 apply 参数里的 internals，点「重启」抛 ReferenceError
  const mod = await import('../lib/index.js');
  assert.equal(typeof mod.apply, 'function');
  assert.equal(typeof mod.readRestartNotice, 'function');
  assert.equal(typeof mod.name, 'string');

  // apply 用最小 fake ctx 调用不应抛错（不启动真实代理：注入 stub service）
  const ctx = {
    logger: () => ({ error() {}, info() {}, warn() {} }),
    webServer: { port: 3080 },
    on: () => () => {},
    effect: () => {},
  };
  const stubService = {
    startProxy: async () => ({}), dispose: async () => {}, status: async () => ({}),
    startTunnel: async () => 'https://x.trycloudflare.com', stopTunnel: () => {},
  };
  // apply 内部用 ctx.effect 注册清理，返回值不是契约；这里只验证不抛错
  mod.apply(ctx, {}, {
    service: stubService,
    runUpdate: { currentVersion: () => '1.0.20', loadedVersion: () => '1.0.20', perform: async () => ({ ok: true }) },
    restart: () => ({ helperPid: 1, logOut: '', logErr: '' }),
    restartNotice: async () => null,
  });
  assert.ok(true, 'apply 正常路径不抛错');
});

test('compareVersions：语义化版本比较', async () => {
  const { compareVersions } = await import('../client/api.js');
  assert.ok(compareVersions('1.0.5', '1.0.4') > 0);
  assert.ok(compareVersions('1.0.4', '1.0.5') < 0);
  assert.equal(compareVersions('1.0.4', '1.0.4'), 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0, '两位数字正确比较');
  assert.ok(compareVersions('1.0.4', '1.0.4-rc.1') > 0, '预发布视为更旧');
  assert.ok(compareVersions('1.0.4-rc.1', '1.0.4') < 0, '反过来更旧');
  assert.ok(compareVersions('1.0.4-alpha', '1.0.4-beta') < 0, '预发布后缀按字典序');
  assert.ok(compareVersions('1.0.4-beta.2', '1.0.4-beta.1') > 0, '预发布后缀比较');
  assert.equal(compareVersions('V1.0.4', '1.0.4'), 0, '大写 V 也剥掉');
  assert.ok(compareVersions('1.0.4-rc.10', '1.0.4-rc.9') > 0, '预发布数字段按数值（rc.10 > rc.9）');
  assert.ok(compareVersions('1.0.4-rc.9', '1.0.4-rc.10') < 0, '反过来');
  assert.ok(compareVersions('1.0.4-alpha.1', '1.0.4-alpha.10') < 0, 'alpha.1 < alpha.10（数值比较）');
});

test('stop 竞态：stop 打断 in-flight 后立即 start，不会并发 spawn cloudflared', async () => {
  let spawnCount = 0;
  let releaseA;
  const gateA = new Promise((r) => { releaseA = r; });
  const internals = {
    ...stubInternals(),
    startTunnel: async ({ signal }) => {
      spawnCount += 1;
      await gateA; // 挂起直到 releaseA
      if (signal.aborted) throw new Error('cancelled');
      return { url: 'https://a.trycloudflare.com', kill: () => {} };
    },
  };
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  await service.startProxy();

  const pA = service.startTunnel().catch(() => null); // A in-flight
  await new Promise((r) => setTimeout(r, 20));
  service.stopTunnel(); // abort A、清 tunnelPromise
  const pB = service.startTunnel().catch(() => null); // B 新起（gate 尚未释放，B 也挂起）
  await new Promise((r) => setTimeout(r, 20));
  releaseA(); // 释放 A：其 finally 不得清掉 B 的引用
  await pA;
  await new Promise((r) => setTimeout(r, 20));
  await service.startTunnel().catch(() => null); // C：应复用 B 或等 B 完成，不再 spawn

  assert.equal(spawnCount, 2, 'A、B 各 spawn 一次，C 不产生第三个 cloudflared');

  service.stopTunnel();
  await service.dispose();
});

test('killHint：按平台返回停止命令（Windows 无 lsof）', async () => {
  const { killHint } = await import('../lib/web-rpc.js');
  const hint = killHint(3080);
  if (process.platform === 'win32') {
    assert.ok(hint.includes('netstat') && hint.includes('taskkill'), 'Windows 用 netstat/taskkill');
  } else {
    assert.ok(hint.includes('lsof -ti :3080'), 'macOS/Linux 用 lsof');
  }
  assert.ok(!hint.includes('undefined'), '端口正确插入');
});

test('tsinghuaBottleUrl：按平台/架构匹配清华 bottle（Windows 无匹配；mock 目录，不依赖外网）', async () => {
  const { tsinghuaBottleUrl } = await import('../lib/tunnel.mjs');
  const origFetch = globalThis.fetch;
  // mock 清华目录页（CI 在境外，真实访问清华会超时导致测试抖动）
  globalThis.fetch = async (url) => {
    if (String(url).includes('mirrors.tuna.tsinghua.edu.cn')) {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <a href="cloudflared-2026.8.2.arm64_sequoia.bottle.tar.gz">
          <a href="cloudflared-2026.8.2.arm64_sonoma.bottle.tar.gz">
          <a href="cloudflared-2026.8.2.arm64_tahoe.bottle.tar.gz">
          <a href="cloudflared-2026.8.2.arm64_linux.bottle.tar.gz">
          <a href="cloudflared-2026.8.2.sonoma.bottle.tar.gz">
          <a href="cloudflared-2026.8.2.x86_64_linux.bottle.tar.gz">
        `,
      };
    }
    return origFetch(url);
  };
  try {
    // Windows：无 Homebrew bottle → null
    assert.equal(await tsinghuaBottleUrl({ os: 'windows', a: 'amd64' }), null, 'Windows 不走清华');
    // macOS arm64 → 清华 arm64_ 开头的 bottle URL
    const macUrl = await tsinghuaBottleUrl({ os: 'darwin', a: 'arm64' });
    assert.ok(macUrl && macUrl.includes('mirrors.tuna.tsinghua.edu.cn'), 'macOS 有清华 URL: ' + macUrl);
    assert.ok(/arm64_(sequoia|sonoma|tahoe)\.bottle\.tar\.gz$/.test(macUrl), '匹配 arm64 macOS bottle: ' + macUrl);
    // macOS Intel → 无 arm64 前缀的 bottle
    const intelUrl = await tsinghuaBottleUrl({ os: 'darwin', a: 'amd64' });
    assert.ok(intelUrl && !/arm64_/.test(intelUrl), 'Intel 用无前缀 bottle: ' + intelUrl);
    // Linux：Homebrew bottle 的 ELF 解释器是占位符，不能直接用 → 跳过清华（issue #22）
    assert.equal(await tsinghuaBottleUrl({ os: 'linux', a: 'arm64' }), null, 'Linux 不走清华（Homebrew bottle 不可用）');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('桌面端（desktop=true）：update/restart 关闭，status 带标志，正常功能不受影响', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, {
    service,
    desktop: true,
    runUpdate: { currentVersion: () => '1.4.0', loadedVersion: () => '1.4.0', perform: async () => ({ ok: true }) },
    restart: () => ({ helperPid: 1, logOut: '', logErr: '' }),
    log: { error() {}, warn() {} },
  });
  await service.startProxy();

  // status 带 desktop 标志
  const s = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(s.ok, true);
  assert.equal(s.value.desktop, true, 'status 标记桌面端');

  // 更新被关闭
  const u = await conn.handler(POCKET_ENDPOINTS.update, {});
  assert.equal(u.ok, false, '桌面端更新不可用');
  assert.match(u.error.message, /DSH Desktop/, '提示由桌面版管理');

  // 重启被关闭
  const r = await conn.handler(POCKET_ENDPOINTS.restart, {});
  assert.equal(r.ok, false, '桌面端重启不可用');
  assert.match(r.error.message, /DSH Desktop/, '提示由桌面版管理');

  // 正常功能（隧道）不受影响（同样需要免责声明确认）
  const t = await conn.handler(POCKET_ENDPOINTS.tunnelStart, { disclaimer: true });
  assert.equal(t.ok, true, '隧道功能照常');

  await service.dispose();
});

test('startProxy：端口被占（EADDRINUSE）时自动尝试下一个端口', async () => {
  let attempts = 0;
  const internals = {
    ...stubInternals(),
    createProxy: async ({ port: p }) => {
      attempts += 1;
      if (attempts === 1) {
        const e = new Error('address in use');
        e.code = 'EADDRINUSE';
        throw e;
      }
      return { port: p, close: async () => {} };
    },
  };
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const proxy = await service.startProxy();
  assert.equal(attempts, 2, '第一个端口失败后重试');
  assert.equal(proxy.port, 3082, '自动换到下一个端口');
  const st = await service.status();
  assert.equal(st.proxyRunning, true);
  assert.ok(st.lanUrl.includes(':3082'), 'URL 使用实际端口');
  await service.dispose();
});

test('公网隧道自动恢复：开启时持久化标记，重启后 restoreTunnelIfNeeded 自动拉起（issue #11）', async () => {
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dshp-auto-'));

  let startCount = 0;
  const internals = {
    ...stubInternals(),
    startTunnel: async () => {
      startCount += 1;
      return { url: 'https://auto.trycloudflare.com', kill: () => {} };
    },
  };
  const service = createPocketService({ dshPort: 3080, port: 3081, home, internals });
  await service.startProxy();

  // 开启隧道 → 持久化标记（persistAutoTunnel 是异步 fire-and-forget，等它落盘）
  await service.startTunnel();
  await new Promise((r) => setTimeout(r, 60));
  const statePath = path.join(home, 'dsh-pocket', 'tunnel-auto.json');
  assert.ok((await fsp.readFile(statePath, 'utf8')).includes('"at"'), '开启后写入标记');

  // 模拟重启：新 service 实例（相同 home）→ 自动恢复
  const service2 = createPocketService({ dshPort: 3080, port: 3081, home, internals });
  await service2.startProxy();
  await service2.restoreTunnelIfNeeded();
  assert.equal(startCount, 2, '重启后自动拉起隧道');

  // 手动关闭 → 标记清除 → 下次不自动恢复
  service2.stopTunnel();
  await new Promise((r) => setTimeout(r, 30));
  const afterClose = await fsp.readFile(statePath, 'utf8').catch(() => null);
  assert.equal(afterClose, null, '关闭后删除标记');
  const service3 = createPocketService({ dshPort: 3080, port: 3081, home, internals });
  await service3.startProxy();
  await service3.restoreTunnelIfNeeded();
  assert.equal(startCount, 2, '无标记不自动恢复');

  await fsp.rm(home, { recursive: true, force: true });
});

test('RPC：局域网密码独立于公网；lanTokenRefresh 刷新并返回新密码（issue #18）', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  let lan = '11111111';
  installPocketRpc({ connection: conn }, {
    service,
    getToken: () => '99999999',
    getLanToken: () => lan,
    refreshLanToken: () => { lan = '22222222'; return lan; },
    log: { error() {}, warn() {} },
  });
  await service.startProxy();

  const s = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(s.value.accessToken, '99999999', '公网密码');
  assert.equal(s.value.lanToken, '11111111', '局域网密码独立');

  const r = await conn.handler(POCKET_ENDPOINTS.lanTokenRefresh, {});
  assert.equal(r.ok, true);
  assert.equal(r.value.lanToken, '22222222', '刷新返回新密码');
  const s2 = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(s2.value.lanToken, '22222222', 'status 反映新密码');

  await service.dispose();
});

test('WSL 局域网 IP（issue #39）：parseIpconfig 取物理网卡 IP、排除虚拟网卡；detectWsl 识别环境', async () => {
  const { parseIpconfig, detectWsl } = await import('../lib/service.mjs');

  // 中文 ipconfig 输出：物理网卡在前、虚拟网卡（vEthernet (WSL)）在后
  const zhSample = `\u4ee5\u592a\u7f51\u9002\u914d\u5668 WLAN:
\n\n   连接特定的 DNS 后缀 . . . . . . . :
   本地链接 IPv6 地址. . . . . . . . : fe80::1%12
   IPv4 地址 . . . . . . . . . . . . : 192.168.1.100
   子网掩码  . . . . . . . . . . . . : 255.255.255.0
   默认网关. . . . . . . . . . . . . : 192.168.1.1

\u4ee5\u592a\u7f51\u9002\u914d\u5668 vEthernet (WSL (Hyper-V firewall)):
\n\n   连接特定的 DNS 后缀 . . . . . . . :
   IPv4 地址 . . . . . . . . . . . . : 172.26.96.1
   子网掩码  . . . . . . . . . . . . : 255.255.255.240

\u4ee5\u592a\u7f51\u9002\u914d\u5668 vEthernet (Docker NAT):
\n\n   IPv4 地址 . . . . . . . . . . . . : 10.0.75.1
   子网掩码  . . . . . . . . . . . . : 255.255.255.0
`;
  const zh = parseIpconfig(zhSample);
  assert.deepEqual(zh, ['192.168.1.100'], '中文输出：只取物理网卡 WLAN 的 IP，排除 vEthernet(WSL/Docker)');

  // 英文 ipconfig 输出
  const enSample = `Ethernet adapter Ethernet:
\n\n   Connection-specific DNS Suffix  . :
   Link-local IPv6 Address . . . . . : fe80::2%4
   IPv4 Address. . . . . . . . . . . : 192.168.50.10
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.50.1

Ethernet adapter vEthernet (WSL):
\n\n   IPv4 Address. . . . . . . . . . . : 172.20.0.1
   Subnet Mask . . . . . . . . . . . : 255.255.255.240
`;
  const en = parseIpconfig(enSample);
  assert.deepEqual(en, ['192.168.50.10'], '英文输出：只取物理网卡 IP');

  // 虚拟网卡在前也跳过（vEthernet 块被排除）
  const vpnFirst = `Ethernet adapter vEthernet (WSL):
\n\n   IPv4 Address. . . . . . . . . . . : 172.20.0.1

Ethernet adapter Wi-Fi:
\n\n   IPv4 Address. . . . . . . . . . . : 192.168.31.8
`;
  assert.deepEqual(parseIpconfig(vpnFirst), ['192.168.31.8'], '虚拟网卡在前也正确跳过');

  // 手动覆盖候选：保留 Tailscale/VPN 地址供设置页选择
  const tailscaleFirst = `Unknown adapter Tailscale:

   IPv4 Address. . . . . . . . . . . : 100.119.24.44

Ethernet adapter WLAN:

   IPv4 Address. . . . . . . . . . . : 10.179.45.172
`;
  assert.deepEqual(parseIpconfig(tailscaleFirst), ['10.179.45.172'], '自动模式仍排除 Tailscale');
  assert.deepEqual(
    parseIpconfig(tailscaleFirst, { includeVpn: true }),
    ['100.119.24.44', '10.179.45.172'],
    '候选模式保留 Tailscale/VPN 地址',
  );

  // detectWsl：环境变量触发（本机 macOS 无 /proc/version，走 env 分支）
  const prev = process.env.WSL_DISTRO_NAME;
  process.env.WSL_DISTRO_NAME = 'Ubuntu';
  try {
    assert.equal(detectWsl(), true, 'WSL_DISTRO_NAME 存在 → 判定 WSL');
  } finally {
    if (prev === undefined) delete process.env.WSL_DISTRO_NAME;
    else process.env.WSL_DISTRO_NAME = prev;
  }
  assert.equal(detectWsl(), false, '非 WSL 环境返回 false（macOS 无 /proc/version microsoft 标记）');
});
