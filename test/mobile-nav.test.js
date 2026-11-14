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
  assert.equal(DRAWER_SELECTOR, '[data-mobile-nav="frame"] > [class*="_sidebarCol"]');
  assert.equal(TOGGLE_SELECTOR, '[data-mobile-nav="toggle"], [data-sidebar-opener]');
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
  const drawerBlock = css.slice(css.indexOf('> [class*="_sidebarCol"] {'));
  const z = drawerBlock.match(/z-index:\s*(\d+)\s*!/);
  assert.ok(z, '抽屉必须显式声明 z-index !important');
  assert.ok(
    Number(z[1]) > 1100,
    `抽屉 z-index ${z[1]} 压不过 web-ui-all 的 1100 sidebar pane / 1050 遮罩`,
  );
  assert.ok(Number(z[1]) < 9999, `抽屉 z-index ${z[1]} 不该盖住视口级 banner/toast（9999）`);
});

test('body 级 portal 浮层必须高于抽屉，否则抽屉里的「更多」菜单看不见 —— issue #88', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  // DSH 的 Menu / Tooltip 把浮层 createPortal 到 document.body，和抽屉不在
  // 同一个层叠上下文里，只能靠 z-index 比大小：
  //   Menu.tsx:572    createPortal(list, document.body)    -> role="menu"
  //   Tooltip.tsx:270 createPortal(content, document.body) -> role="tooltip" [data-portal]
  // 两者的 z-index 都是 1100（Menu.module.css:45 `.portal`、
  // Tooltip.module.css:28 `.bubble[data-portal]`），而抽屉是 1200。
  // 于是：侧边栏「更多」菜单（SidebarRoot PanelMoreMenu，align=start/side=bottom，
  // 整块落在 280px 抽屉内）完全被抽屉盖住，按钮点了像没反应；会话行 kebab 菜单
  // （ui-workspace rows/Rows.tsx:760，align=end，从行右缘向右溢出）只剩露在抽屉
  // 外的窄条 —— 用户报的「大部分被侧边栏遮挡」。
  const drawerZ = Number(
    css.slice(css.indexOf('> [class*="_sidebarCol"] {')).match(/z-index:\s*(\d+)\s*!/)[1],
  );
  const portalRule = css.match(
    /body\s*>\s*\[role="menu"\][\s\S]{0,400}?\{[^}]*z-index:\s*(\d+)\s*!/,
  );
  assert.ok(portalRule, '缺少把 body 级 [role="menu"] 抬到抽屉之上的规则');
  const portalZ = Number(portalRule[1]);
  assert.ok(portalZ > drawerZ, `浮层 z-index ${portalZ} 必须高于抽屉 ${drawerZ}`);
  assert.ok(portalZ < 9999, `浮层 z-index ${portalZ} 不该盖住视口级 banner/toast（9999）`);
  // Tooltip 的气泡同样是 body 级 portal，抽屉按钮上的长按提示也一起被压住
  assert.ok(
    /body\s*>\s*\[role="tooltip"\]/.test(css) && /body\s*>\s*\[data-portal\]/.test(css),
    'Tooltip 的 portal 气泡（[role="tooltip"] / [data-portal]）要一起抬',
  );
  // 只抬 body 的直接子元素：被 portal 进抽屉内部的对话框要保持自己的层叠上下文
  assert.ok(
    !/\[data-mobile-nav="frame"\]\s+\[role="menu"\]/.test(css),
    '不要在抽屉内部再抬一次 [role="menu"]（会顶掉抽屉内对话框的层级）',
  );
});

test('body 级模态层必须高于抽屉，否则展开的侧边栏会挡住「设置」窗口', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  // 设置面板和 Modal 都是 body 级 portal，z-index 都是 1000：
  //   SettingsRoot.tsx:70  createPortal(overlay, document.body)
  //     -> SettingsRoot.module.css:63  .overlay { position: fixed; inset: 0; z-index: 1000 }
  //   Modal.tsx:57         createPortal(root, document.body)
  //     -> Modal.module.css:10  .root { z-index: 1000 }
  // 抽屉是 1200，于是抽屉展开时打开「设置」，抽屉会盖住设置面板的标题、关闭
  // 按钮和整列导航。模态层要压在抽屉之上，但仍低于它自己内部弹出的菜单。
  const drawerZ = Number(
    css.slice(css.indexOf('> [class*="_sidebarCol"] {')).match(/z-index:\s*(\d+)\s*!/)[1],
  );
  const modalRule = css.match(
    /body\s*>\s*\[role="presentation"\][\s\S]{0,400}?\{[^}]*z-index:\s*(\d+)\s*!/,
  );
  assert.ok(modalRule, '缺少把 body 级模态层（设置面板 / Modal）抬到抽屉之上的规则');
  const modalZ = Number(modalRule[1]);
  assert.ok(modalZ > drawerZ, `模态层 z-index ${modalZ} 必须高于抽屉 ${drawerZ}`);
  assert.ok(modalZ < 9999, `模态层 z-index ${modalZ} 不该盖住视口级 banner/toast（9999）`);
  // 设置面板里的下拉菜单要能盖住设置面板本身
  const portalZ = Number(
    css.match(/body\s*>\s*\[role="menu"\][\s\S]{0,400}?\{[^}]*z-index:\s*(\d+)\s*!/)[1],
  );
  assert.ok(portalZ > modalZ, `菜单层 ${portalZ} 必须高于模态层 ${modalZ}`);
  // 单独 portal 出来的对话框根节点（PlatformOverlay.tsx:69 直接就是
  // <div role="dialog" aria-modal="true">，z-index 1001）也要一起抬
  assert.ok(
    /body\s*>\s*\[role="dialog"\]\[aria-modal="true"\]/.test(css),
    'body 级 [role="dialog"][aria-modal="true"]（账号 PlatformOverlay）要一起抬',
  );
  // toast 同样是 body 级 portal（Toast.tsx:75，role="alert"，z-index 1100），
  // 抽屉展开时弹出的提示不该被抽屉盖住
  assert.ok(
    /body\s*>\s*\[role="alert"\]/.test(css),
    'toast（[role="alert"]）也要抬到抽屉之上',
  );
});

test('DSH 0.2.2 自带抽屉：按类名定位，并让位给官方遮罩', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  // 0.2.2 的 AppFrame 在窄屏开启自带抽屉（.frame[data-sidebar-drawer]），并在
  // frame 里插入 div[data-sidebar-mask] 作为第一个子元素。于是位置选择器整体
  // 错位：> :first-child 命中遮罩、> :nth-child(2) 命中侧边栏列，主内容列留在
  // 0px 的第 2 轨 —— 手机上整个会话界面消失。必须改用官方类名后缀定位。
  assert.ok(
    /\[data-mobile-nav="frame"\]\s*>\s*\[class\*="_centerCol"\]\s*\{[^}]*grid-column:\s*1\s*!/.test(css),
    '主内容列必须按类名（_centerCol）拉回第 1 轨，不能按子元素序号',
  );
  assert.ok(
    /\[data-mobile-nav="frame"\]\s*>\s*\[class\*="_sidebarCol"\]\s*\{[^}]*position:\s*absolute\s*!/.test(css),
    '抽屉必须按类名（_sidebarCol）定位，不能按子元素序号',
  );
  assert.ok(
    !/\[data-mobile-nav="frame"\][^{]*>\s*:first-child\s*[,{]/.test(css)
      && !/\[data-mobile-nav="frame"\][^{]*>\s*:nth-child\(\d+\)\s*[,{]/.test(css),
    'frame 上不许再用 > :first-child / > :nth-child(N)（官方插入新节点就会错位）',
  );
  // 官方遮罩在点击时调 toggleSidebar()，而我们在 JS 里也会关抽屉：一次点击
  // 触发两次 toggle，抽屉关了又立刻弹回来，看起来「关不掉」。
  assert.ok(
    /\[data-mobile-nav="frame"\]\s*>\s*\[data-sidebar-mask\]\s*\{[^}]*display:\s*none\s*!/.test(css),
    '必须屏蔽官方抽屉遮罩，避免一次点击 toggle 两次',
  );
});

test('DSH 0.2.2 自带开合按钮时，插件自绘的两个入口让位', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  // 0.2.2 在 frame 的 leading 座挂了官方开合按钮（button[data-sidebar-opener]，
  // ui-sidebar HeaderLeadingControls.tsx:36，drawer 模式下每个 phase 都在），
  // 位置和插件自绘的 toggle 几乎重合。三个入口做同一件事，只留官方那个。
  assert.ok(
    /\[data-mobile-nav="frame"\]:has\(\[data-sidebar-opener\]\)\s*\[data-mobile-nav="toggle"\]/.test(css),
    '官方开合按钮存在时，插件自绘的 toggle 要隐藏',
  );
  assert.ok(
    /\[data-mobile-nav="frame"\]:has\(\[data-sidebar-opener\]\)\s*\[data-mobile-nav="fab"\]/.test(css),
    '官方开合按钮存在时，插件悬浮球也要隐藏',
  );
  // 反过来：老宿主没有官方按钮，两个兜底入口必须留着（否则手机上打不开抽屉）。
  // 用行首锚定，只看这两条自己的规则块 —— 否则 :has() 那条的后半个选择器
  // 也会以 [data-mobile-nav="fab"] 结尾，被误判成"无条件隐藏"。
  assert.ok(
    !/(?:^|\n)[ \t]*\[data-mobile-nav="toggle"\]\s*\{[^}]*display:\s*none/.test(css)
      && !/(?:^|\n)[ \t]*\[data-mobile-nav="fab"\]\s*\{[^}]*display:\s*none/.test(css),
    '不能让兜底入口无条件隐藏 —— 老版本 DSH 没有官方开合按钮',
  );
  // 官方按钮自己调 toggleSidebar()，必须和自绘 toggle 一样豁免「点抽屉外就关」，
  // 否则一次点击被两边各 toggle 一次，净效果是抽屉不动。
  assert.ok(TOGGLE_SELECTOR.includes('[data-sidebar-opener]'));
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

test('手机端右边栏默认显示，设置关闭后隐藏稳定 header corner 入口', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  const apply = readFileSync(new URL('../client/mobile/mobile-apply.tsx', import.meta.url), 'utf8');
  assert.ok(
    css.includes('body[data-dsh-pocket-mobile-rightbar="off"] [data-conversation-header-corner]'),
    '仅在用户关闭设置时隐藏官方右栏入口',
  );
  assert.ok(
    !css.includes('[data-phase] header > :first-child > :last-child'),
    '不能依赖标题栏子元素顺序隐藏右栏入口',
  );
  assert.ok(apply.includes('POCKET_ENDPOINTS.status'), '移动端启动时读取持久化设置');
  assert.ok(apply.includes('MOBILE_RIGHTBAR_EVENT'), '设置切换后立即同步右栏入口');
});

test('会话头部放不下时横向滚动，而不是让 chip 互相压盖', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  // 取「某个选择器后面第一个 { ... }」的规则体，避免整份 CSS 里别处的同名声明干扰断言。
  const ruleBody = selector => {
    const at = css.indexOf(selector)
    assert.ok(at >= 0, `缺少选择器 ${selector}`)
    const open = css.indexOf('{', at)
    const close = css.indexOf('}', open)
    return css.slice(open + 1, close)
  }
  const cluster = '[data-phase] header [class$="_titleRow"] [class$="_titleCluster"]'
  const body = ruleBody(`${cluster} {`)
  assert.ok(body.includes('overflow-x: auto !important'), '头部集群必须能横向滚动');
  assert.ok(body.includes('overflow-y: hidden !important'), '只滚动横轴，纵向不能把 chip 裁成半截');
  assert.ok(body.includes('scrollbar-width: thin'), '滚动条要细，36px 的头部容不下常规滚动条');
  // 子元素不再压缩：压缩正是 chip 溢出后互相压盖的成因
  assert.ok(
    ruleBody(`${cluster} > * {`).includes('flex: 0 0 auto !important'),
    '集群子元素必须保持固有宽度',
  );
  // 滚动容器是集群，不是整行：右侧 utilities / corner 必须保持固定可点
  assert.ok(
    !/\[class\$="_titleRow"\]\s*\{[^}]*overflow-x/.test(css),
    '不能让整行滚动，否则右栏入口会被推出视口',
  );
  // 细滚动条样式（webkit 需要显式高度才不是 overlay 隐藏态）
  assert.ok(
    css.includes(`${cluster}::-webkit-scrollbar {`),
    '必须给 webkit 定义细滚动条，否则手机上默认是滑动才出现的 overlay',
  );
});

test('composer 底栏用稳定 card 标记并在窄屏允许换行 (#170)', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  assert.ok(css.includes('[data-composer-card="true"] > [class$="_row"]'));
  assert.ok(css.includes('flex-wrap: wrap !important'), '窄屏允许底栏换行，避免模型药丸被压成 0 宽 (#170)');
  assert.ok(
    !css.includes('[class*="_card"]:has(textarea) > :last-child'),
    '会话 composer 底栏不能再依赖 textarea',
  );
  assert.ok(
    !css.includes('[data-composer-card="true"] > [class$="_row"] > :last-child'),
    '移除 :last-child 的 flex:1 1 0 挤压规则，模型药丸不再被压成 0 宽 (#170)',
  );
});

test('统计行只从 composer.dock 标记，不误标 contenteditable composer 根节点', () => {
  const src = readFileSync(new URL('../client/mobile/mobile-apply.tsx', import.meta.url), 'utf8');
  assert.ok(
    src.includes('[data-slot="conversation.composer.dock"] [class$="_root"]'),
    '统计行必须限定在 DSH 的 conversation.composer.dock 稳定插槽内',
  );
  assert.ok(
    !src.includes("document.querySelectorAll('[data-phase] [class$=\"_root\"]')"),
    '不能扫描 composer 内所有 *_root；新版编辑器是 contenteditable，会让 composer 根误命中',
  );
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


test('issue #181：排版规则不覆盖输入框几何，控制行换行后不被固定行高裁掉', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  const exclude = ':has(p):not([data-input-scroll])';
  assert.equal(css.split(exclude).length - 1, 4, 'padding 与 font-size 两组规则都要排除 [data-input-scroll]');
  assert.ok(
    !/\[class\$="_scroll"\]:has\(p\)\s*[{,p]/.test(css),
    '不能留下未排除输入框的 :has(p) 选择器（会压掉皮肤给发送键预留的 padding-right）',
  );
  assert.match(css, /height: auto !important;\s*min-height: 28px !important;/, '换行必须配自适应高度');
  assert.match(css, /max-height: none !important;\s*overflow: visible !important;/, '第二行控件不能被 28px 行盒裁掉');
});

test('issue #196：抽屉工作区保底高度 + 侧栏列可滚动', () => {
  const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
  assert.match(css, /min-height: min\(55vh, 420px\) !important/, '矮屏上工作区不能被压成 0 高');
  assert.match(css, /\[data-mobile-nav="frame"\] :has\(> \[class\$="_regionArea"\]\)/, '按直接子级定位列根，不靠子元素序号');
  assert.match(css, /overflow-y: auto !important/, '上下固定区块溢出时仍能滚到工作区');
  assert.match(css, /overscroll-behavior: contain !important/);
});
