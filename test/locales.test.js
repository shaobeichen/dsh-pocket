// 设置页 i18n 词典完整性（PR #36）：zh/en key 集合必须一致、占位符一致、
// 源码 t()/fmt() 引用的 key 必须都在词典中——防止加字符串时 key 不同步（英文漏翻/白屏 key）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { NS, zh, en, ja } = await import('../client/pocket-locales.js');

const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('pocket 词典：zh/en key 集合完全一致', () => {
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, zhKeys, 'en 与 zh 的 key 必须一一对应');
  assert.ok(zhKeys.length >= 40, `词典 key 数异常（${zhKeys.length}）——i18n 重构后应有 40+`);
});

test('pocket 词典：占位符 {placeholder} 在 zh/en 中一致', () => {
  for (const key of Object.keys(zh)) {
    assert.deepEqual(ph(en[key]), ph(zh[key]), `key "${key}" 的占位符在 zh/en 不一致`);
  }
});

test('pocket 词典：zh/ja key 集合与占位符完全一致', () => {
  const zhKeys = Object.keys(zh).sort();
  assert.deepEqual(Object.keys(ja).sort(), zhKeys, 'ja 与 zh 的 key 必须一一对应');
  for (const key of Object.keys(zh)) {
    assert.deepEqual(ph(ja[key]), ph(zh[key]), `key "${key}" 的占位符在 zh/ja 不一致`);
  }
  assert.equal(ja.section, 'スマホアクセス', 'tab 标签日文');
});

test('pocket 词典：源码 t()/fmt() 引用的 key 都在词典中', () => {
  const src = readFileSync(new URL('../client/index.jsx', import.meta.url), 'utf8');
  const used = new Set();
  for (const m of src.matchAll(/\bt\('([^']+)'\)/g)) used.add(m[1]);
  for (const m of src.matchAll(/fmt\(t,\s*'([^']+)'/g)) used.add(m[1]);
  const missing = [...used].filter((k) => !(k in zh));
  assert.deepEqual(missing, [], '源码引用了词典中不存在的 key');
  // section 经 translate() 调用，单独校验
  assert.equal(zh.section, '手机访问', 'tab 标签中文');
  assert.equal(en.section, 'Phone access', 'tab 标签英文');
  assert.equal(NS, 'pocket', 'namespace 固定');
});
