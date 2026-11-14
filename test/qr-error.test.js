// issue #203：二维码生成失败（多为源码直装缺 qrcode 依赖）时不能只留一张空白图。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zh, en, ja } from '../client/pocket-locales.js';

test('issue #203：lan/tunnel 二维码为 null 时渲染可操作提示，而不是空 img', () => {
  const src = readFileSync(new URL('../client/index.jsx', import.meta.url), 'utf8');
  assert.match(src, /qrArea = \(src, url, hint, missingText\)/, 'qrArea 接收失败文案');
  assert.match(src, /src\s*\?\s*h\('img'/, '有二维码时仍渲染 img，行为不变');
  assert.match(src, /data-pocket-qr-error/, '失败分支要有稳定标记，便于排查与回归');
  assert.equal((src.match(/t\('qrFailed'\)/g) ?? []).length, 2, '局域网与公网两处入口都要传失败文案');

  for (const [name, dict] of [['zh', zh], ['en', en], ['ja', ja]]) {
    assert.ok(dict.qrFailed && dict.qrFailed.length > 20, name + ' 词典要有 qrFailed');
    assert.match(dict.qrFailed, /qrcode|npm install|dsh plugin add/, name + ' 提示要包含可操作的排查方向');
  }
});

test('issue #203：后端对二维码生成失败要记录错误码，不再静默吞掉', () => {
  const src = readFileSync(new URL('../lib/service.mjs', import.meta.url), 'utf8');
  assert.ok(!/encodeQr\(text\)\.catch\(\(\) => null\)/.test(src), 'catch(() => null) 已被带日志的版本替代');
  assert.match(src, /MODULE_NOT_FOUND|err\.code|error\.code|\.code/, '日志要带出错误码，区分依赖缺失与 URL 为空');
});
