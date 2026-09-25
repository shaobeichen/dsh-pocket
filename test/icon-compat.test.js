// 图标导出的跨版本兼容层（client/mobile/icon-compat.mjs）。
//
// 回归背景（dsh 0.1.7-rc.2 + dsh-pocket 2.10.6 实测）：primitives 在 0.1.7-rc 之后把
// Icon*Outline16 改成了 Icon*OutlineRegular / ...Medium，而移动端组件是**直接具名导入**，
// 于是运行期拿到 undefined → React #130（"Element type is invalid ... got: undefined"）
// → slot 条目整条崩掉：移动样式表还在注入，但 data-mobile-nav="frame" 永远挂不上，
// 抽屉彻底失效（手机上的表现是 56px 侧栏图标条一直占位、正文被挤成一列）。
//
// 这里把两代命名、缺失兜底、以及「源码别再静态导入具体图标名」都钉成测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  MOBILE_ICON_CANDIDATES,
  MOBILE_ICON_FALLBACK,
  isRenderableIcon,
  pickIcon,
  resolveMobileIcons,
} = await import('../client/mobile/icon-compat.mjs')

/** 造一个可用作图标的最小函数组件。 */
const icon = (tag) => function IconStub() {
  return tag
}

/** 旧一代 DSH（≤ 0.1.6-alpha.x）：导出带 16 尺寸后缀。 */
const legacyRegistry = {
  IconPanelLeftOutline16: icon('legacy-panel'),
  IconDownloadOutline16: icon('legacy-download'),
  IconFolderOpenOutline16: icon('legacy-folder'),
}

/** 新一代 DSH（≥ 0.1.7-rc.x）：只剩 Regular / Medium。 */
const modernRegistry = {
  IconPanelLeftOutlineRegular: icon('modern-panel'),
  IconPanelLeftOutlineMedium: icon('modern-panel-medium'),
  IconDownloadOutlineRegular: icon('modern-download'),
  IconFolderOpenOutlineRegular: icon('modern-folder'),
}

test('旧一代命名（...16）仍能解析出来 —— 不破坏旧 DSH', () => {
  const resolved = resolveMobileIcons(legacyRegistry)
  assert.equal(resolved.panelLeft, legacyRegistry.IconPanelLeftOutline16)
  assert.equal(resolved.download, legacyRegistry.IconDownloadOutline16)
  assert.equal(resolved.folderOpen, legacyRegistry.IconFolderOpenOutline16)
})

test('新一代命名（...Regular）能解析出来 —— 修好 0.1.7-rc 之后的 DSH', () => {
  const resolved = resolveMobileIcons(modernRegistry)
  assert.equal(resolved.panelLeft, modernRegistry.IconPanelLeftOutlineRegular)
  assert.equal(resolved.download, modernRegistry.IconDownloadOutlineRegular)
  assert.equal(resolved.folderOpen, modernRegistry.IconFolderOpenOutlineRegular)
})

test('两代命名同时存在时优先取新一代（Regular 先于 16）', () => {
  const both = { ...legacyRegistry, ...modernRegistry }
  const resolved = resolveMobileIcons(both)
  assert.equal(resolved.panelLeft, modernRegistry.IconPanelLeftOutlineRegular)
  // 候选顺序本身就是「新名优先」：Regular/Medium 排在 16 之前
  assert.ok(
    MOBILE_ICON_CANDIDATES.panelLeft.indexOf('IconPanelLeftOutlineRegular') <
      MOBILE_ICON_CANDIDATES.panelLeft.indexOf('IconPanelLeftOutline16'),
  )
})

test('一个都解析不到时返回 null —— 绝不返回 undefined（这正是打崩 slot 的原因）', () => {
  const resolved = resolveMobileIcons({ IconPanelLeftGlyph: 1 })
  for (const key of Object.keys(MOBILE_ICON_CANDIDATES)) {
    assert.equal(resolved[key], null, `${key} 应为 null`)
    assert.notEqual(resolved[key], undefined, `${key} 绝不能是 undefined`)
  }
})

test('非组件值一律不算图标（数字 / 字符串 / null / undefined）', () => {
  assert.equal(pickIcon({ IconPanelLeftOutlineRegular: 42 }, ['IconPanelLeftOutlineRegular']), null)
  assert.equal(pickIcon({ IconPanelLeftOutlineRegular: 'oops' }, ['IconPanelLeftOutlineRegular']), null)
  assert.equal(pickIcon({ IconPanelLeftOutlineRegular: null }, ['IconPanelLeftOutlineRegular']), null)
  assert.equal(pickIcon({}, ['IconPanelLeftOutlineRegular']), null)
  // 组件形状：函数 / class / memo 之类的对象都算
  assert.equal(isRenderableIcon(icon('x')), true)
  assert.equal(isRenderableIcon({ $$typeof: Symbol.for('react.memo') }), true)
  assert.equal(isRenderableIcon(undefined), false)
  assert.equal(isRenderableIcon(null), false)
  assert.equal(isRenderableIcon(0), false)
})

test('宿主命名空间缺失 / 不是对象时不抛异常，只是全为 null', () => {
  for (const registry of [null, undefined, 'nope', 7]) {
    assert.doesNotThrow(() => resolveMobileIcons(registry))
    const resolved = resolveMobileIcons(registry)
    for (const key of Object.keys(MOBILE_ICON_CANDIDATES)) assert.equal(resolved[key], null)
  }
})

test('每个图标都有文字兜底字形（没有图标时按钮仍然可见可点）', () => {
  for (const key of Object.keys(MOBILE_ICON_CANDIDATES)) {
    assert.equal(typeof MOBILE_ICON_FALLBACK[key], 'string')
    assert.ok(MOBILE_ICON_FALLBACK[key].length > 0, `${key} 需要兜底字形`)
  }
})

test('移动端组件不再静态具名导入具体图标名（回归护栏）', () => {
  const files = ['MobileNavToggle.tsx', 'MobileNavOverlay.tsx', 'MobileDrawerFooter.tsx']
  for (const file of files) {
    const src = readFileSync(new URL(`../client/mobile/${file}`, import.meta.url), 'utf8')
    // 不许再出现任何带版本后缀的具体图标名（新版/旧版都不行：换版本就崩）
    assert.doesNotMatch(src, /Icon[A-Za-z]*(16|Regular|Medium)\b/, `${file} 不应静态引用具体图标名`)
    // 必须走兼容层
    assert.match(src, /resolveMobileIcons/, `${file} 应通过 resolveMobileIcons 解析图标`)
    assert.match(src, /MobileIcon/, `${file} 应通过 MobileIcon 渲染图标`)
  }
})

test('打包产物已包含本次改动（改完 client/ 记得 node client/build.mjs）', () => {
  const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  // 候选名与兜底标记都是字符串字面量，压缩后依然在
  assert.match(bundle, /IconPanelLeftOutlineRegular/, '产物里应有新一代候选名')
  assert.match(bundle, /icon-fallback/, '产物里应有兜底字形标记')
})
