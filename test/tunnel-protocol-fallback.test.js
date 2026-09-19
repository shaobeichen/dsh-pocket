// 协议回退回归：cloudflared 起得来、但某个协议一直注册不上（真实案例：代理 TUN 只拦
// 到边缘的 TCP，QUIC 正常）时，不能像以前那样死等 30 秒再报一句指向不了真因的
// 「超时」——要自己杀掉换下一个协议，候选里也必须有 http2 兜底（UDP 7844 被屏蔽的网络）。
//
// 用注入的 spawn 造一个假 cloudflared：按 --protocol 决定这次是「注册成功」还是
// 「报错退出」，从而断言候选顺序与失败信息（不依赖平台能否 spawn 无扩展名脚本）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startNamedTunnel, PROTOCOL_CANDIDATES } from '../lib/tunnel.mjs';

/** 假子进程：可写 stdout/stderr，带 kill（真的会触发 exit）与 resume（cleanup 会调）。 */
function fakeChild({ onSpawn }) {
  const child = new EventEmitter();
  const stream = () => {
    const s = new EventEmitter();
    s.resume = () => {};
    return s;
  };
  child.stdout = stream();
  child.stderr = stream();
  child.killed = false;
  child.kill = () => {
    if (child.killed) return;
    child.killed = true;
    setImmediate(() => child.emit('exit', null));
  };
  setImmediate(() => onSpawn(child));
  return child;
}

/** 记录每次 spawn 的协议，并让指定协议成功。 */
function makeSpawnRecorder({ okProtocol }) {
  const seen = [];
  const spawnImpl = (bin, args) => {
    const protocol = args[args.indexOf('--protocol') + 1];
    seen.push(protocol);
    return fakeChild({
      onSpawn: (child) => {
        if (protocol === okProtocol) {
          child.stderr.emit('data', 'INF Registered tunnel connection connIndex=0\n');
        } else {
          child.stderr.emit('data', 'ERR Unable to establish connection with Cloudflare edge error="TLS handshake with edge error: EOF"\n');
          child.emit('exit', 1);
        }
      },
    });
  };
  return { seen, spawnImpl };
}

test('协议回退：前一个协议注册不上就换候选里的下一个，最终成功', async () => {
  const { seen, spawnImpl } = makeSpawnRecorder({ okProtocol: PROTOCOL_CANDIDATES[1] });
  const res = await startNamedTunnel({ token: 'faketoken', internals: { spawn: spawnImpl } });
  res.kill();
  assert.deepEqual(seen, PROTOCOL_CANDIDATES.slice(0, 2), '应按候选顺序依次尝试，直到注册成功');
  assert.ok(PROTOCOL_CANDIDATES.includes('auto'), '首个候选应为 auto：让 cloudflared 预检自选 QUIC/HTTP2');
  assert.ok(PROTOCOL_CANDIDATES.includes('http2'), '候选里要保留 http2 兜底（UDP 7844 被屏蔽的网络）');
});

test('协议全失败：错误信息带 cloudflared 自己的输出，不掩盖真实退出原因', async () => {
  const { seen, spawnImpl } = makeSpawnRecorder({ okProtocol: '__never__' });
  await assert.rejects(
    () => startNamedTunnel({ token: 'faketoken', internals: { spawn: spawnImpl } }),
    (err) => {
      assert.match(err.message, /TLS handshake with edge error: EOF/, '应带上 cloudflared 的关键输出行');
      return true;
    },
  );
  assert.deepEqual(seen, PROTOCOL_CANDIDATES, '所有候选协议都要试过');
});
