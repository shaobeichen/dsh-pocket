// 抽屉点击规则（client/mobile/nav-targets.mjs + MobileNavOverlay.tsx）。
// 没有 DOM 可用，所以判定逻辑是纯函数：用一个只有 closest() 的桩元素喂进去。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  DRAWER_SELECTOR,
  TOGGLE_SELECTOR,
  NAV_TARGETS,
  NAV_EXCLUDE,
  OVERLAY_SELECTOR,
  navTargetFor,
  isOverlayTap,
} = await import('../client/mobile/nav-targets.mjs');

/**
 * 造一个只实现 closest() 的桩元素。hits 传**单个**选择器；closest() 收到的
 * 是逗号连接的复合选择器时按真实语义拆开逐条比对（命中任意一条即命中）。
 */
const stub = (...hits) => {
  const el = {
    closest: (sel) => {
      const parts = String(sel)
        .split(',')
        .map((s) => s.trim());
      return hits.some((h) => parts.includes(h)) ? el : null;
    },
  };
  return el;
};

test('导航选择器覆盖当前与旧一代侧边栏的行类名', () => {
  // 当前侧边栏（qDHVXG_ 区块 / YDXeBa_ 行）
  assert.match(NAV_TARGETS, /sessionRow/, '当前侧边栏的会话行 YDXeBa_sessionRow');
  // 旧一代侧边栏（_searchResultRow_ / _searchResultWorkspace_）
  assert.match(NAV_TARGETS, /searchResultRow/);
  assert.match(NAV_TARGETS, /searchResultWorkspace/);
  assert.match(NAV_TARGETS, /newSession/);
  assert.match(NAV_TARGETS, /data-dsh-taskboard-entry/);
  assert.match(NAV_TARGETS, /data-dsh-ssh-entry/);
  assert.match(NAV_TARGETS, /data-mobile-nav="files"/);
  assert.match(NAV_EXCLUDE, /sessionRow/, '行内 kebab 按钮');
});

test('工作区行（projectRow）按折叠开关处理，不算导航 —— issue #72', () => {
  // YDXeBa_projectRow 实测是折叠/展开：aria-expanded 来回翻、会话列表显隐，
  // 工作区本身不变。把它当导航会在每次展开工作区时把抽屉关掉。
  assert.doesNotMatch(NAV_TARGETS, /projectRow/);
  assert.equal(navTargetFor(stub('[class*="projectRow"]')), null);
});

test('会话行算导航，行内的 kebab 按钮不算', () => {
  assert.notEqual(navTargetFor(stub('[class*="sessionRow"]')), null);
  assert.notEqual(navTargetFor(stub('[class*="newSession"]')), null);
  assert.notEqual(navTargetFor(stub('[data-mobile-nav="files"]')), null);
  // NAV_EXCLUDE 就是 '[class*="sessionRow"] button'：行内 kebab 命中它优先
  assert.equal(navTargetFor(stub('[class*="sessionRow"] button')), null);
  assert.equal(
    navTargetFor(stub('[class*="sessionRow"] button', '[class*="sessionRow"]')),
    null,
    'kebab 同时命中行本身时，NAV_EXCLUDE 优先',
  );
});

test('空目标 / 非元素目标安全降级', () => {
  assert.equal(navTargetFor(null), null);
  assert.equal(navTargetFor(undefined), null);
  assert.equal(navTargetFor({}), null, '没有 closest 方法的对象不该抛错');
  assert.equal(isOverlayTap(null), false);
  assert.equal(isOverlayTap({}), false);
});

test('浮层内的点击被识别为 overlay（不该关抽屉）—— issue #72', () => {
  assert.match(OVERLAY_SELECTOR, /role="menu"/);
  assert.match(OVERLAY_SELECTOR, /role="listbox"/);
  assert.match(OVERLAY_SELECTOR, /role="dialog"/);
  assert.equal(isOverlayTap(stub('[role="menu"]')), true);
  assert.equal(isOverlayTap(stub('[data-radix-popper-content-wrapper]')), true);
  // 抽屉里的普通行、页面空白处都不是浮层
  assert.equal(isOverlayTap(stub('[class*="sessionRow"]')), false);
  assert.equal(isOverlayTap(stub()), false);
});

test('选择器常量与 MobileNavOverlay 的用法保持一致', () => {
  const src = readFileSync(new URL('../client/mobile/MobileNavOverlay.tsx', import.meta.url), 'utf8');
  assert.equal(DRAWER_SELECTOR, '[data-mobile-nav="frame"] > :first-child');
  assert.equal(TOGGLE_SELECTOR, '[data-mobile-nav="toggle"]');
  assert.ok(
    src.includes("document.querySelector<HTMLElement>(DRAWER_SELECTOR)"),
    '抽屉查询应复用 DRAWER_SELECTOR，避免与 CSS 里的选择器漂移',
  );
  assert.ok(src.includes('isOverlayTap(target)'), '点抽屉外的处理必须先豁免浮层（issue #72）');
  assert.ok(
    src.includes("event.pointerType !== 'touch'"),
    '触摸导航路径必须限定在 touch/pen，桌面鼠标不能受影响',
  );
  assert.ok(
    src.includes("attributeFilter: ['aria-selected']"),
    '触摸会话行必须等 aria-selected 变化后再关闭抽屉',
  );
  assert.ok(
    src.includes('pendingTouchRow !== null') && src.includes('&& isPendingTouchClick(event)'),
    '只有与待完成触摸位置/能力匹配的 click 才能绕过立即关闭，不能误伤鼠标',
  );
  assert.ok(
    src.includes('navClickArrived && selectedRow !== null && selectedRow !== selectedRowAtArm'),
    '必须等真实 click 到达且选中行变化，不能依赖可能被卸载或同名的旧 row',
  );
  assert.ok(
    src.includes("row.getAttribute('aria-selected') === 'true'"),
    '点击已选中会话时没有选择变化，必须直接关闭抽屉',
  );
  assert.ok(
    !src.includes("dispatchEvent(new MouseEvent('click'"),
    '不能再向 pointerup 保存的旧 DOM target 延迟补发 click',
  );
  assert.ok(
    !/\[class\*="sessionRow"\],?\s*\[class\*="searchResultRow"\]/.test(src),
    '行选择器应集中在 nav-targets.mjs，组件里不要再内联一份',
  );
});

test('抽屉层级压过 dsh-web-ui-all 的移动端遮罩 —— issue #67', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  // web-ui-all 0.3.6 的移动端响应式：sidebar pane 1100 / details pane 1000 /
  // frame ::after 全屏遮罩 1050。抽屉必须高于 1100，否则那层遮罩会盖在抽屉
  // 上吃掉每一次点击 —— 抽屉能开，但里面什么都点不动，页面也滚不了。
  const drawerBlock = css.slice(css.indexOf('> :first-child {'));
  const z = drawerBlock.match(/z-index:\s*(\d+)\s*!/);
  assert.ok(z, '抽屉必须显式声明 z-index !important');
  assert.ok(
    Number(z[1]) > 1100,
    `抽屉 z-index ${z[1]} 压不过 web-ui-all 的 1100 sidebar pane / 1050 遮罩`,
  );
  assert.ok(Number(z[1]) < 9999, `抽屉 z-index ${z[1]} 不该盖住视口级 banner/toast（9999）`);
});

test('移除 web-ui-all 在 frame 上的全屏 ::after 遮罩 —— issue #67', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  assert.ok(
    /\[data-mobile-nav="frame"\]\s*\[data-mobile-nav="frame"\]:not\(\[data-sidebar-collapsed\]\)::after\s*\{[^}]*content:\s*none\s*!/.test(
      css,
    ),
    '必须有一条把 frame 的 ::after 遮罩去掉的规则',
  );
  // 对方的选择器 [data-dsh-frame]:not([data-sidebar-collapsed])::after 是
  // (0,2,1)。重复一次属性选择器把我们的抬到 (0,3,1)，这样不论插件样式表谁
  // 后注入都由我们说了算 —— 同优先级时胜负取决于插件加载顺序，不可靠。
  assert.ok(
    /\[data-mobile-nav="frame"\]\s*\[data-mobile-nav="frame"\]/.test(css),
    '遮罩规则要靠重复属性选择器提高优先级，不能依赖插件加载顺序',
  );
});

test('打包产物里带上抽屉规则的关键字', () => {
  const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  // client/client.js 是 esbuild 产物，跑测试前需先 npm run build:client
  for (const needle of ['sessionRow', 'searchResultWorkspace', 'role="menu"', 'pointerType']) {
    assert.ok(bundle.includes(needle), `打包产物缺少 "${needle}" —— 先跑 npm run build:client`);
  }
});

test('打包产物：mobile-apply 引用的组件都有 import 且有定义', () => {
  const src = readFileSync(new URL('../client/mobile/mobile-apply.tsx', import.meta.url), 'utf8');
  const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  // import type 进来的是纯类型，产物里没有运行时定义 —— 只检查值组件
  const typeOnly = new Set();
  for (const m of src.matchAll(/^import\s+type\s+(?:\{([^}]*)\}|(\w+))\s+from/gm)) {
    for (const part of (m[1] ?? m[2] ?? '').split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) typeOnly.add(n);
    }
  }
  const used = [...new Set([...src.matchAll(/\b(Mobile[A-Za-z0-9_]*)\b/g)].map((m) => m[1]))].filter(
    // 排除纯类型；再排除光秃秃的 "Mobile"（注释里的 Mobile-adaptive 之类）
    (n) => !typeOnly.has(n) && /^Mobile[A-Z]/.test(n),
  );
  assert.ok(used.length >= 3, `预期至少 3 个 Mobile* 组件，实际 ${used.length}`);

  for (const name of used) {
    // ① 必须在源码里 import —— esbuild 不检查未定义标识符，漏了能照常打包，
    //    到浏览器里才炸：apply 时 "<name> is not defined" → 整个插件
    //    Failed to load plugins（2.6.0 / 2.6.1 就漏了某个 Mobile* 组件 import）。
    assert.match(
      src,
      new RegExp(`import\\s+(?:type\\s+)?(?:\\{[^}]*\\b${name}\\b[^}]*\\}|${name})\\s+from`),
      `${name} 在 mobile-apply.tsx 里被用到但没有 import`,
    );
    // ② 产物里必须有定义（只有引用没有定义 = 悬空全局引用）
    const defs = (bundle.match(new RegExp(`(?:function\\s+${name}\\b|\\b${name}\\s*=)`, 'g')) ?? []).length;
    assert.ok(defs >= 1, `${name} 在打包产物里只有引用、没有定义 —— 漏 import 会让整个插件加载失败`);
  }
});
