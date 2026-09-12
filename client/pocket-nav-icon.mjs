// 设置页「手机访问」的导航图标。
//
// 背景：DSH 0.1.x 的设置外壳（dsh-client-ui-settings-general）把导航图标写死在
// 内部的 navIcon(id) 里——只认 models / agent-presets / plugins 三个内置 id，
// 其余一律兜底成齿轮；而 settings.section 的注册项由外壳只投影 id / order / label
// （见 ui-settings 的 slots 契约与运行时 slot 清单），没有 icon 字段可传。
// 所以在设置弹层挂载后，按「自己那一行的可见文案」认出自己的导航按钮，打一个
// data 标记，再由 CSS 把兜底齿轮换成设计稿的手机图标。
//
// 边界：只认自己这一行（文案是本插件自己的本地化文案，见 pocket-locales.js 的
// section），不碰外壳结构；标记随 fiber 释放一起移除，locale 切换后由
// MutationObserver 重新认行。上游若给 settings.section 增加 icon 字段，本模块可整个删掉。
//
// 认行判定 isOwnNavRow 是纯函数、不碰 DOM，便于 test/ 里用桩元素喂进来
// （与 client/mobile/nav-targets.mjs、layout-mode.mjs 同款做法）。

/** 标记属性：只落在本插件自己的那一行导航上。 */
export const NAV_ICON_MARKER = 'data-dsh-pocket-nav-icon';

/** 认行范围：设置弹层导航里的按钮（外壳 SettingsPanel 的 DOM 契约）。 */
export const NAV_ROW_SELECTOR = '[role="dialog"] nav button';

/** 图标盒尺寸（px）。与外壳 navIcon 渲染的 size 一致。 */
export const NAV_ICON_SIZE = 16;

/** 窄屏下 client/mobile/mobile.css.ts 把设置页导航图标缩到 14px，这里跟着缩，
 *  免得自己这一格比别的大一圈。 */
export const NAV_ICON_SIZE_NARROW = 14;

/** 窄屏断点：与 mobile.css.ts 的 `@media (max-width: 1023px)` 对齐。 */
export const NARROW_MEDIA_QUERY = '(max-width: 1023px)';

/**
 * 设计稿手机图标（16×16 网格）：圆角机身 + 顶部听筒 + 底部 Home 键。
 *
 * 作为 CSS mask 使用，所以固定用黑色（黑 = 不透明 = 显示）；实际颜色由
 * `background-color: currentColor` 决定，随主题/选中态走。
 *
 * 比例取自设计稿（机身 345×535、听筒 102×27、Home 键外径 80、壁厚 19），
 * 但按 16px 网格重新落点：设计稿描边只占机身宽的 7.8%，等比缩到 16px 是 0.78px，
 * 与 DSH 图标族 1.5px 的描边不一致，故描边统一取 1.5px；听筒与 Home 键改为
 * 「按留白落点」——留出与机身边框的间隙，否则在 16px 下会和边框糊在一起。
 * Home 键缩到 16px 后壁厚只剩 0.53px，无法成环，落成同直径实心点。
 */
export const PHONE_GLYPH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3.75" y="1.05" width="8.5" height="13.9" rx="1.15"/>' +
  '<path d="M7.27 3.2h1.46"/>' +
  '<circle cx="8" cy="12.6" r="1.16" fill="#000" stroke="none"/>' +
  '</svg>';

/** mask 用的 data URI（运行时编码，避免手写转义）。 */
export function phoneMaskUrl(svg = PHONE_GLYPH_SVG) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * 这一行是不是本插件的导航行。
 *
 * 纯函数，判定依据只有「该行的可见文案 === 本插件当前 locale 下的文案」。
 * wantedLabel 为空时一律不认——否则文案还没解析出来时会把标记撒到别的分区上。
 *
 * @param rowText - 候选导航按钮的可见文案（通常取 textContent）。
 * @param wantedLabel - 本插件当前 locale 的 section 文案。
 * @returns 命中为 true。
 */
export function isOwnNavRow(rowText, wantedLabel) {
  const wanted = String(wantedLabel ?? '').trim();
  if (wanted.length === 0) return false;
  return String(rowText ?? '').trim() === wanted;
}

/** 注入的样式文本：隐藏外壳兜底的齿轮 svg，用 mask 画设计稿图标。 */
export function navIconCss(maskUrl) {
  return [
    `[${NAV_ICON_MARKER}] > svg { display: none; }`,
    `[${NAV_ICON_MARKER}]::before {`,
    `  content: '';`,
    `  flex: none;`,
    `  width: ${NAV_ICON_SIZE}px;`,
    `  height: ${NAV_ICON_SIZE}px;`,
    `  background-color: currentColor;`,
    `  -webkit-mask-image: url("${maskUrl}");`,
    `  mask-image: url("${maskUrl}");`,
    `  -webkit-mask-repeat: no-repeat;`,
    `  mask-repeat: no-repeat;`,
    `  -webkit-mask-position: center;`,
    `  mask-position: center;`,
    `  -webkit-mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `  mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `}`,
    `@media ${NARROW_MEDIA_QUERY} {`,
    `  [${NAV_ICON_MARKER}]::before {`,
    `    width: ${NAV_ICON_SIZE_NARROW}px;`,
    `    height: ${NAV_ICON_SIZE_NARROW}px;`,
    `    -webkit-mask-size: ${NAV_ICON_SIZE_NARROW}px ${NAV_ICON_SIZE_NARROW}px;`,
    `    mask-size: ${NAV_ICON_SIZE_NARROW}px ${NAV_ICON_SIZE_NARROW}px;`,
    `  }`,
    `}`,
  ].join('\n');
}

/**
 * 把「手机访问」那一行的兜底齿轮换成设计稿的手机图标。
 *
 * 只做两件事：给认出来的导航按钮打标记，注入一条只认该标记的样式。认行依据是
 * resolveLabel() 返回的本插件本地化文案，所以 locale 切换、设置弹层开关、外壳
 * 重渲染都能自愈。
 *
 * @param ctx - client 根上下文（取其 effect 做随 fiber 释放的副作用登记）。
 * @param resolveLabel - 返回当前 locale 下「手机访问」文案的函数。
 */
export function installSettingsNavIcon(ctx, resolveLabel) {
  if (typeof document === 'undefined') return;

  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-pocket';
    tag.dataset.pluginCss = 'dsh-pocket/nav-icon';
    tag.textContent = navIconCss(phoneMaskUrl());
    document.head.appendChild(tag);

    let disposed = false;
    let scheduled = false;

    const sync = () => {
      scheduled = false;
      if (disposed) return;
      const wanted = resolveLabel();
      for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
        if (isOwnNavRow(row.textContent, wanted)) row.setAttribute(NAV_ICON_MARKER, '');
        else row.removeAttribute(NAV_ICON_MARKER);
      }
    };

    // 合并同一帧内的多次 DOM 变更，且在绘制前落地，避免图标闪一下齿轮。
    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(sync);
    };

    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      disposed = true;
      observer.disconnect();
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) {
        row.removeAttribute(NAV_ICON_MARKER);
      }
      tag.remove();
    };
  }, 'dsh-pocket: settings nav icon');
}
