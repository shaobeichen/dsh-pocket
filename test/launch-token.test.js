// 回归测试：dsh 0.2.3-alpha.2 移除了 connection.authenticatedUrl，
// 启动 token 改由 webserver/entry-url 事件下发（issue #239）。
// 手机端拿不到 token 时代理不会补 ?token=，上游就一直停在「连接到此 Host」登录页。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLaunchTokenResolver } from '../lib/index.js';

test('entry-url 事件缓存 token，且优先于旧 API 返回值', () => {
  const resolve = createLaunchTokenResolver({ resolveLegacyToken: () => 'legacy-token' });
  resolve.onEntryUrl('http://127.0.0.1:3080/', [
    { label: 'dsh web', url: 'http://127.0.0.1:3080/?token=launch-abc', open: true },
  ]);
  assert.equal(resolve.getToken(), 'launch-abc');
});

test('没有 entry-url 事件时回退旧 API（老版本 dsh）', () => {
  const resolve = createLaunchTokenResolver({ resolveLegacyToken: () => 'legacy-token' });
  assert.equal(resolve.getToken(), 'legacy-token');
});

test('旧 API 已移除（返回空）时，事件 token 仍然可用', () => {
  const resolve = createLaunchTokenResolver({ resolveLegacyToken: () => '' });
  resolve.onEntryUrl('http://127.0.0.1:3080/', [{ url: 'http://127.0.0.1:3080/?token=launch-xyz' }]);
  assert.equal(resolve.getToken(), 'launch-xyz');
});

test('旧 API 抛错时 getToken 返回空字符串，不把异常抛给代理', () => {
  const resolve = createLaunchTokenResolver({
    resolveLegacyToken: () => { throw new Error('connection.authenticatedUrl removed'); },
  });
  assert.equal(resolve.getToken(), '');
});

test('entries 含非法 URL / 无 token 条目时跳过，不抛错', () => {
  const resolve = createLaunchTokenResolver({});
  resolve.onEntryUrl('http://127.0.0.1:3080/', [
    { label: 'broken', url: 'not a url' },
    { label: 'no token', url: 'http://127.0.0.1:3080/' },
    { label: 'dsh web', url: 'http://127.0.0.1:3080/?token=ok-token' },
  ]);
  assert.equal(resolve.getToken(), 'ok-token');
});

test('多次 entry-url 事件以最后一次缓存的 token 为准', () => {
  const resolve = createLaunchTokenResolver({});
  resolve.onEntryUrl('http://127.0.0.1:3080/', [{ url: 'http://127.0.0.1:3080/?token=first' }]);
  resolve.onEntryUrl('http://127.0.0.1:3080/', [{ url: 'http://127.0.0.1:3080/?token=second' }]);
  assert.equal(resolve.getToken(), 'second');
});

test('事件里没有任何 token 时返回空字符串', () => {
  const resolve = createLaunchTokenResolver({});
  resolve.onEntryUrl('http://127.0.0.1:3080/', [{ url: 'http://127.0.0.1:3080/' }]);
  assert.equal(resolve.getToken(), '');
});
