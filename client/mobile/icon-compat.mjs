// DSH primitives 图标导出的跨版本兼容层。
//
// 背景（2026-09 实测，dsh 0.1.7-rc.2 + dsh-pocket 2.10.6）：
// 移动端组件原来直接具名导入
//   IconPanelLeftOutline16 / IconDownloadOutline16 / IconFolderOpenOutline16，
// 而 @deepseek-ai/dsh-client-ui-primitives 在 0.1.7-rc 之后把图标导出改成了
//   Icon<Name>OutlineRegular / Icon<Name>OutlineMedium（`16` 尺寸后缀被移除）。
// 于是这些导入在运行期变成 undefined —— 组件一渲染就抛 React #130
// （"Element type is invalid ... got: undefined"），slot 条目整条崩掉：
// 移动样式表照样注入，但 `data-mobile-nav="frame"` 标记永远挂不上，抽屉彻底失效。
// 手机上的表现：56px 侧栏图标条一直占位、正文被挤成一列（用户可见症状）。
//
// 这里做三件事：
//   1. 不再按具体名字静态导入 —— 新版名字在旧版不存在、旧版名字在新版不存在；
//      对真正的 ESM 来说，具名导入不存在的导出是**链接期**错误，比 undefined 更难查；
//   2. 用候选名列表在运行时解析，先后覆盖新旧两代命名；
//   3. 全都解析不到时返回 null（绝不返回 undefined），调用方用文字字形兜底 ——
//      在任何一代 DSH 上都不会再把整条 slot 打崩。
//
// 纯数据 + 纯函数、无 DOM 依赖，便于 `node --test` 直接引（test/icon-compat.test.js）。

/** 每个图标按「新名优先、旧名兜底」的候选顺序。 */
export const MOBILE_ICON_CANDIDATES = {
  panelLeft: [
    'IconPanelLeftOutlineRegular',
    'IconPanelLeftOutlineMedium',
    'IconPanelLeftOutline16',
    'IconPanelLeftOutline',
  ],
  download: [
    'IconDownloadOutlineRegular',
    'IconDownloadOutlineMedium',
    'IconDownloadOutline16',
    'IconDownloadOutline',
  ],
  folderOpen: [
    'IconFolderOpenOutlineRegular',
    'IconFolderOpenOutlineMedium',
    'IconFolderOpenOutline16',
    'IconFolderOpenOutline',
    'IconFolderOpen',
  ],
}

/** 解析不到图标时用的文字字形（保证按钮仍然可见、可点、可读）。 */
export const MOBILE_ICON_FALLBACK = {
  panelLeft: '☰',
  download: '⤓',
  folderOpen: '▤',
}

/**
 * 注册表里的某个导出能不能当 React 组件渲染。
 * 组件可能是函数，也可能是对象（memo / forwardRef / class 组件），所以两者都收；
 * 数字、字符串、null、undefined 一律不算 —— 它们正是打崩 slot 的元凶。
 * @param value - 待判定的导出值。
 * @returns 可渲染时为 true。
 */
export function isRenderableIcon(value) {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null
}

/**
 * 按候选顺序取第一个可渲染的导出。
 * @param registry - 宿主 primitives 命名空间（可能为 null/不是对象）。
 * @param names - 候选导出名，按优先级排列。
 * @returns 命中的组件；一个都没有时返回 null（**绝不返回 undefined**）。
 */
export function pickIcon(registry, names) {
  if (registry === null || typeof registry !== 'object') return null
  for (const name of names) {
    const candidate = registry[name]
    if (isRenderableIcon(candidate)) return candidate
  }
  return null
}

/**
 * 把宿主 primitives 命名空间解析成移动端要用的三个图标。
 * @param registry - 宿主 primitives 命名空间。
 * @returns `{ panelLeft, download, folderOpen }`，缺的为 null（不是 undefined）。
 */
export function resolveMobileIcons(registry) {
  const resolved = {}
  for (const [key, names] of Object.entries(MOBILE_ICON_CANDIDATES)) {
    resolved[key] = pickIcon(registry, names)
  }
  return resolved
}
