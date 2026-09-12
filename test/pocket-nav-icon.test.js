// 设置页「手机访问」导航图标（client/pocket-nav-icon.mjs）。
//
// 没有 DOM 可用，所以认行判定是纯函数 isOwnNavRow()，用字符串/桩元素喂进去即可；
// 样式与图标几何按文本断言（与 test/mobile-nav.test.js 同款做法）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  NAV_ICON_MARKER,
  NAV_ROW_SELECTOR,
  NAV_ICON_SIZE,
  NAV_ICON_SIZE_NARROW,
  NARROW_MEDIA_QUERY,
  PHONE_GLYPH_SVG,
  phoneMaskUrl,
  isOwnNavRow,
  navIconCss,
} = await import('../client/pocket-nav-icon.mjs');

const { zh, en } = await import('../client/pocket-locales.js');

test('认行：只认「手机访问」自己那一行', () => {
  assert.equal(isOwnNavRow(zh.section, zh.section), true, '中文文案命中');
  assert.equal(isOwnNavRow(en.section, en.section), true, '英文文案命中');
  assert.equal(isOwnNavRow(`  ${zh.section}\n`, zh.section), true, '两侧空白不影响');
  // 其它分区不能被标记，否则会把别人的图标也换掉
  assert.equal(isOwnNavRow('通用设置', zh.section), false);
  assert.equal(isOwnNavRow('模型', zh.section), false);
  assert.equal(isOwnNavRow('', zh.section), false);
  assert.equal(isOwnNavRow(undefined, zh.section), false);
  assert.equal(isOwnNavRow(null, zh.section), false);
});

test('认行：文案取不到时一律不认（不能撒网式标记）', () => {
  for (const empty of ['', '   ', undefined, null]) {
    assert.equal(isOwnNavRow(zh.section, empty), false, `wantedLabel=${JSON.stringify(empty)} 不应命中`);
    assert.equal(isOwnNavRow('通用设置', empty), false);
  }
});

test('认行：切到英文后旧的中文行不再命中', () => {
  assert.equal(isOwnNavRow(zh.section, en.section), false);
  assert.equal(isOwnNavRow(en.section, zh.section), false);
});

test('标记属性与认行范围是外壳契约的一部分', () => {
  assert.match(NAV_ICON_MARKER, /^data-[a-z0-9-]+$/, '必须是合法的 data 属性名');
  // 外壳 SettingsPanel：面板 role="dialog"，导航在 <nav> 里，每行是 <button>
  assert.equal(NAV_ROW_SELECTOR, '[role="dialog"] nav button');
});

test('样式：隐藏外壳兜底的齿轮 svg，用 mask 画图标并跟随 currentColor', () => {
  const css = navIconCss(phoneMaskUrl());
  assert.match(css, new RegExp(`\\[${NAV_ICON_MARKER}\\] > svg \\{ display: none; \\}`), '齿轮必须被隐藏');
  assert.match(css, /background-color: currentColor/, '颜色必须继承行文字色（主题/选中态）');
  assert.match(css, /-webkit-mask-image: url\("data:image\/svg\+xml,/);
  assert.match(css, /mask-image: url\("data:image\/svg\+xml,/);
  assert.match(css, /mask-size: 16px 16px/, '默认 16px 盒');
});

test('样式：窄屏跟着外壳缩到 14px，断点与 mobile.css.ts 一致', () => {
  const css = navIconCss(phoneMaskUrl());
  assert.match(css, new RegExp(`@media ${NARROW_MEDIA_QUERY.replace(/[()]/g, '\\$&')}`));
  assert.match(css, /width: 14px;/);
  assert.match(css, /mask-size: 14px 14px/);

  // 防漂移：mobile.css.ts 里 `[class$="_navCell"] svg` 的实际取值就是 14px，
  // 断点也必须是 1023px；那边改了这边要跟着改。
  const mobileCss = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  const navCellSvg = /\[class\$="_navCell"\] svg \{[^}]*\}/.exec(mobileCss);
  assert.ok(navCellSvg, 'mobile.css.ts 里应有 _navCell svg 的尺寸规则');
  assert.match(navCellSvg[0], new RegExp(`width: ${NAV_ICON_SIZE_NARROW}px !important`));
  assert.match(navCellSvg[0], new RegExp(`height: ${NAV_ICON_SIZE_NARROW}px !important`));
  assert.match(mobileCss, new RegExp(`@media ${NARROW_MEDIA_QUERY.replace(/[()]/g, '\\$&')}`));
  assert.equal(NAV_ICON_SIZE, 16, '宽屏盒尺寸应与外壳 navIcon 的 size 一致');
});

test('图标：mask 里必须是不透明的黑色（mask 是独立图片，currentColor 解析不了）', () => {
  assert.ok(!PHONE_GLYPH_SVG.includes('currentColor'), 'mask 里不能用 currentColor');
  assert.match(PHONE_GLYPH_SVG, /stroke="#000"/);
  assert.match(PHONE_GLYPH_SVG, /fill="#000"/, 'Home 键是实心点，必须填充');
  assert.match(phoneMaskUrl(), /^data:image\/svg\+xml,/);
  assert.ok(!phoneMaskUrl().includes('<'), 'data URI 里不能有裸的尖括号');
});

test('图标：是手机（机身 + 听筒 + Home 键），不是齿轮', () => {
  assert.match(PHONE_GLYPH_SVG, /viewBox="0 0 16 16"/);
  assert.match(PHONE_GLYPH_SVG, /<rect [^>]*rx="/, '机身是圆角矩形');
  assert.equal((PHONE_GLYPH_SVG.match(/<rect/g) ?? []).length, 1, '只有一个机身');
  assert.equal((PHONE_GLYPH_SVG.match(/<circle/g) ?? []).length, 1, '只有一个 Home 键');
  assert.ok(!PHONE_GLYPH_SVG.includes('path d="M8 1.4'), '不应是齿轮的齿');
});

test('图标几何：机身比例贴合设计稿，且听筒/Home 键与边框留白（16px 下不糊在一起）', () => {
  const rect = /<rect ([^/>]+)\/>/.exec(PHONE_GLYPH_SVG);
  const speaker = /<path d="M([\d.]+) ([\d.]+)h([\d.]+)"\/>/.exec(PHONE_GLYPH_SVG);
  const home = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/.exec(PHONE_GLYPH_SVG);
  assert.ok(rect && speaker && home, '三段几何都应在');

  const attr = (src, key) => Number(new RegExp(`${key}="([\\d.]+)"`).exec(src)[1]);
  const half = attr(PHONE_GLYPH_SVG, 'stroke-width') / 2;
  const rx = attr(rect[1], 'x');
  const ry = attr(rect[1], 'y');
  const rw = attr(rect[1], 'width');
  const rh = attr(rect[1], 'height');

  // 设计稿机身 345×535（宽高比 0.645）
  const ratio = (rw + half * 2) / (rh + half * 2);
  assert.ok(Math.abs(ratio - 0.645) < 0.02, `机身宽高比应贴合设计稿，实际 ${ratio.toFixed(3)}`);

  // 描边含在内也必须落在 16×16 里，否则会被 svg 裁掉
  assert.ok(rx - half >= 0 && ry - half >= 0, '机身不能越出左/上边界');
  assert.ok(rx + rw + half <= 16 && ry + rh + half <= 16, '机身不能越出右/下边界');

  // 听筒/Home 键与机身边框的留白：留白为 0 时 16px 下会和边框糊成一条
  const bodyInnerTop = ry + half;
  const bodyInnerBottom = ry + rh - half;
  const speakerTop = Number(speaker[2]) - half;
  const homeBottom = Number(home[2]) + Number(home[3]);
  assert.ok(speakerTop - bodyInnerTop >= 0.5, `听筒与上边框留白不足（${(speakerTop - bodyInnerTop).toFixed(2)}px）`);
  assert.ok(bodyInnerBottom - homeBottom >= 0.3, `Home 键与下边框留白不足（${(bodyInnerBottom - homeBottom).toFixed(2)}px）`);

  // 两个部件都水平居中
  assert.equal(Number(speaker[1]) + Number(speaker[3]) / 2, 8, '听筒应水平居中');
  assert.equal(Number(home[1]), 8, 'Home 键应水平居中');
});

test('接线：index.jsx 装上这个 effect，且用的是本地化后的 section 文案', () => {
  const src = readFileSync(new URL('../client/index.jsx', import.meta.url), 'utf8');
  assert.match(src, /import \{ installSettingsNavIcon \} from '\.\/pocket-nav-icon\.mjs'/);
  assert.match(src, /installSettingsNavIcon\(ctx, \(\) => translate\('section'\)\)/, '认行文案必须走 translate，切语言才能自愈');
});

test('构建产物：client/client.js 里带上了本模块（改了源码别忘 node client/build.mjs）', () => {
  const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  assert.ok(bundle.includes(NAV_ICON_MARKER), '打包产物缺少导航图标标记——请重跑 node client/build.mjs');
  assert.ok(bundle.includes('installSettingsNavIcon'), '打包产物缺少 installSettingsNavIcon');
});
