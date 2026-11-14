// 「显示 / 隐藏」PIN 按钮的字号要和同排其他按钮一致（12px）。
// 回归点：font 是简写属性，排在 fontSize 之后会把 font-size 重置成 inherit。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client/index.jsx', import.meta.url), 'utf8');

function pinMaskBody() {
  const start = src.indexOf('function PinMask(');
  assert.ok(start > 0, 'PinMask 组件应存在');
  const end = src.indexOf('// 官方 DeepSeek Harness', start);
  return src.slice(start, end > start ? end : start + 1500);
}

test('PIN 显示/隐藏按钮显式声明 12px，与密码行其他按钮一致', () => {
  const body = pinMaskBody();
  const buttonAt = body.indexOf("h('button'");
  assert.ok(buttonAt > 0, 'PinMask 应渲染切换按钮');
  const style = body.slice(buttonAt, body.indexOf('onClick:', buttonAt));
  assert.match(style, /fontSize: 12/, '按钮要显式写 12px，不能靠继承');

  // 同排的「刷新 / 自定义 / 保存 / 取消」都是 fontSize: 12
  assert.match(src, /height: 26, padding: '0 10px', fontSize: 12/, '对照按钮仍为 12px');
});

test('font 简写必须排在 fontSize 之前，否则字号被重置成 inherit', () => {
  const body = pinMaskBody();
  const buttonAt = body.indexOf("h('button'");
  const style = body.slice(buttonAt, body.indexOf('onClick:', buttonAt));
  const fontAt = style.indexOf("font: 'inherit'");
  const sizeAt = style.indexOf('fontSize: 12');
  assert.ok(fontAt >= 0, '保留 font: inherit 以继承字体族');
  assert.ok(sizeAt >= 0, '保留 fontSize: 12');
  assert.ok(fontAt < sizeAt, 'font 简写写在 fontSize 之后会覆盖它，按钮文字会比邻居大');
});
