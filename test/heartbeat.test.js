// #221：WS 心跳的真实行为测试（不再是「源码里有没有这行字符串」）。
// 用假 socket + mock 定时器推进周期，直接观察 Ping 是否发出、连接何时被销毁。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachWebSocketHeartbeat } from '../lib/proxy.mjs';

class FakeSocket extends EventEmitter {
  destroyed = false;
  pings = 0;

  write(frame) {
    assert.equal(frame[0], 0x89, '发给浏览器侧的应是 WS Ping（opcode 9）');
    this.pings += 1;
    return true;
  }

  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
}

test('每个周期都先发 Ping；健康连接（有 Pong）永不销毁', (t) => {
  mock.timers.enable({ apis: ['setInterval'] });
  t.after(() => mock.timers.reset());
  const sock = new FakeSocket();
  attachWebSocketHeartbeat(sock, { intervalMs: 1000 });
  for (let i = 0; i < 40; i++) {
    mock.timers.tick(1000);
    sock.emit('data', Buffer.from([0x8a, 0x00])); // 浏览器自动回的 Pong
  }
  assert.equal(sock.pings, 40, '每个周期都发一次 Ping，计数与「真的探测过」挂钩');
  assert.equal(sock.destroyed, false, '有 Pong 的连接不得被判成死链');
});

test('默认连续 8 个静默周期才销毁（4 分钟，不再 60 秒误杀空闲）', (t) => {
  mock.timers.enable({ apis: ['setInterval'] });
  t.after(() => mock.timers.reset());
  const sock = new FakeSocket();
  attachWebSocketHeartbeat(sock, { intervalMs: 1000 });
  for (let i = 0; i < 7; i++) {
    mock.timers.tick(1000);
    assert.equal(sock.destroyed, false, `第 ${i + 1} 个静默周期仍应保活`);
  }
  mock.timers.tick(1000);
  assert.equal(sock.destroyed, true, '第 8 个静默周期才销毁');
  assert.equal(sock.pings, 8, '销毁前每个周期都真的发过 Ping');
});

test('missLimit <= 0 只保活、永不主动断链', (t) => {
  mock.timers.enable({ apis: ['setInterval'] });
  t.after(() => mock.timers.reset());
  const sock = new FakeSocket();
  attachWebSocketHeartbeat(sock, { intervalMs: 1000, missLimit: 0 });
  for (let i = 0; i < 100; i++) mock.timers.tick(1000);
  assert.equal(sock.pings, 100, '仍然每个周期发 Ping 保活');
  assert.equal(sock.destroyed, false, '逃生阀生效，不主动断');
});

test('连接关闭后不再发 Ping（cleanup 生效，无定时器泄漏）', (t) => {
  mock.timers.enable({ apis: ['setInterval'] });
  t.after(() => mock.timers.reset());
  const sock = new FakeSocket();
  attachWebSocketHeartbeat(sock, { intervalMs: 1000, missLimit: 0 });
  mock.timers.tick(1000);
  assert.equal(sock.pings, 1);
  sock.emit('close');
  for (let i = 0; i < 20; i++) mock.timers.tick(1000);
  assert.equal(sock.pings, 1, 'close 之后定时器已清理');
});
