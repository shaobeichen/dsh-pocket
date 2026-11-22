// 布局模式判定（issue #74）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveLayout, persistLayoutFromUrl, readStoredLayout } from '../client/mobile/layout-mode.mjs';

test('resolveLayout: URL desktop 优先于一切', () => {
  assert.equal(resolveLayout({ urlValue: 'desktop', stored: 'mobile', narrowMatch: true }), 'desktop');
  assert.equal(resolveLayout({ urlValue: 'desktop', stored: 'desktop', narrowMatch: false }), 'desktop');
});

test('resolveLayout: URL mobile 优先于一切（含宽屏）', () => {
  // 用户在 1920px 宽屏设备上显式选 mobile → 强制 mobile（即使 matchMedia 判 wide）
  assert.equal(resolveLayout({ urlValue: 'mobile', stored: 'desktop', narrowMatch: false }), 'mobile');
});

test('resolveLayout: URL auto / 空 → 退到 localStorage', () => {
  assert.equal(resolveLayout({ urlValue: 'auto', stored: 'desktop', narrowMatch: true }), 'desktop');
  // issue #228：存过的 mobile 在宽屏下不生效——桌面浏览器误开一次配对链接
  // 不应被永久钉在移动布局。真想强制走 URL 参数（每次生效，不落盘）。
  assert.equal(resolveLayout({ urlValue: '', stored: 'mobile', narrowMatch: false }), 'desktop');
  assert.equal(resolveLayout({ urlValue: 'auto', stored: 'invalid', narrowMatch: true }), 'mobile');
});

test('resolveLayout: 存过的 mobile 偏好只在窄屏生效（issue #228）', () => {
  assert.equal(resolveLayout({ urlValue: '', stored: 'mobile', narrowMatch: true }), 'mobile');
  assert.equal(resolveLayout({ urlValue: 'auto', stored: 'mobile', narrowMatch: false }), 'desktop');
});

test('resolveLayout: 存过的 desktop 偏好在任何视口都生效（保留 #74 持久化）', () => {
  assert.equal(resolveLayout({ urlValue: '', stored: 'desktop', narrowMatch: false }), 'desktop');
  assert.equal(resolveLayout({ urlValue: '', stored: 'desktop', narrowMatch: true }), 'desktop');
});

test('resolveLayout: 都无 → 按 matchMedia 决定', () => {
  assert.equal(resolveLayout({ urlValue: '', stored: '', narrowMatch: true }), 'mobile');
  assert.equal(resolveLayout({ urlValue: '', stored: '', narrowMatch: false }), 'desktop');
  assert.equal(resolveLayout({ urlValue: 'garbage', stored: '', narrowMatch: true }), 'mobile');
});

test('resolveLayout: URL auto 显式清掉 localStorage 后 → 走 matchMedia', () => {
  assert.equal(resolveLayout({ urlValue: 'auto', stored: '', narrowMatch: false }), 'desktop');
  assert.equal(resolveLayout({ urlValue: 'auto', stored: '', narrowMatch: true }), 'mobile');
});

test('persistLayoutFromUrl: 显式 desktop/mobile 写入 localStorage', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  assert.equal(persistLayoutFromUrl('desktop'), 'desktop');
  assert.equal(store.get('dsh-pocket.layout'), 'desktop');
  assert.equal(persistLayoutFromUrl('mobile'), 'mobile');
  assert.equal(persistLayoutFromUrl('auto'), '');
  assert.equal(store.has('dsh-pocket.layout'), false);
  assert.equal(persistLayoutFromUrl(''), '');
  assert.equal(persistLayoutFromUrl('garbage'), '');
});

test('打包产物里带上布局模式判定的关键字', () => {
  const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  for (const needle of ['dsh-layout', 'dsh-pocket.layout', 'data-dsh-pocket-layout']) {
    assert.ok(bundle.includes(needle), `打包产物缺少 "${needle}" —— 先跑 npm run build:client`);
  }
});
