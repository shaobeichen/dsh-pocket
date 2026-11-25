// 触屏设备的 composer Enter 守卫：普通 Enter 只换行，不发送。
//
// 宿主 @deepseek-ai/dsh-client-ui-conversation 的 composer 键位表
// （src/client/input/editor/keymap.ts）把「非 Shift 的 Enter」一律当提交：
// 只有 Shift+Enter 走原生换行。手机软键盘没有 Shift，键盘上的回车/换行键
// 到 DOM 里就是一次普通 Enter，于是草稿还没写完就被发了出去。
//
// 这里不复刻换行逻辑，而是在 document 捕获阶段把这一次 Enter 的 shiftKey
// 影子成 true，让宿主自己的键位表走 Shift+Enter 分支：不提交、正常换行。
// 事件不 preventDefault、不重派发——iOS 上宿主故意不拦截 keydown、交给
// beforeinput 落地换行的路径因此保持原样；/ 与 @ 候选有高亮时 Enter 属于
// 菜单仲裁（只挑选候选），也保持原样。

/** 宿主 ComposerContentEditable 打在可编辑根上的标记。 */
const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'

/** 宿主候选菜单：listbox 带 aria-activedescendant 表示当前有高亮项。 */
const HIGHLIGHTED_MENU_SELECTOR = '[role="listbox"][aria-activedescendant]'

/** 测试注入点；生产调用不传。 */
export interface ComposerEnterGuardOptions {
  /** 是否软键盘主导的触屏设备；默认按粗指针 / 无悬停触摸判定。 */
  isSoftKeyboard?: () => boolean
  /** 是否有带高亮项的候选菜单；默认查宿主 listbox。 */
  hasHighlightedMenu?: () => boolean
}

/**
 * 软键盘主导的触屏设备：粗指针，或「无悬停 + 有触摸点」。
 * 触摸屏笔记本通常同时有鼠标（hover: hover、pointer: fine），不会命中；
 * 手机、平板命中。
 * @returns 是否应把 Enter 解释成换行。
 */
export function isSoftKeyboardDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true
    return window.matchMedia('(hover: none)').matches && (navigator.maxTouchPoints ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * 这次 keydown 是否是一次应当换成换行的 composer 普通 Enter。
 * @param event - 捕获阶段收到的 keydown。
 * @returns 命中 composer 内、无修饰键、非输入法组合、可编辑的 Enter。
 */
export function isComposerEnter(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.key !== 'Enter') return false
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
  // keyCode 229 是输入法组合期引擎不带 isComposing 时发的旧信号。
  // oxlint-disable-next-line typescript/no-deprecated
  if (event.isComposing || event.keyCode === 229) return false
  if (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) return false
  const target = event.target
  if (!(target instanceof Element)) return false
  const input = target.closest(COMPOSER_INPUT_SELECTOR)
  if (!(input instanceof HTMLElement) || !input.isContentEditable) return false
  // 组合输入期间不介入：那一次 Enter 由输入法或宿主自己的 composing 守卫处理。
  return !input.hasAttribute('data-composer-composing')
}

/**
 * 只把当前事件对象影子成 Shift+Enter（原型上的 shiftKey 是只读 getter，
 * 实例上的同名自有属性会先命中）。失败时保持宿主的原行为。
 * @param event - 捕获阶段收到的 keydown。
 * @returns 是否改成功。
 */
function claimShiftEnter(event: KeyboardEvent): boolean {
  try {
    Object.defineProperty(event, 'shiftKey', { value: true, configurable: true })
    return true
  } catch {
    return false
  }
}

/**
 * 安装 document 捕获阶段的 Enter 守卫。
 * @param options - 测试注入点；生产省略。
 * @returns 卸载函数。
 */
export function installComposerEnterGuard(options: ComposerEnterGuardOptions = {}): () => void {
  const softKeyboard = options.isSoftKeyboard ?? isSoftKeyboardDevice
  const hasHighlightedMenu = options.hasHighlightedMenu
    ?? (() => document.querySelector(HIGHLIGHTED_MENU_SELECTOR) !== null)
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!softKeyboard()) return
    if (!isComposerEnter(event)) return
    // 有高亮的 / 或 @ 候选：Enter 是菜单挑选（宿主只挑选、不发送），放行原事件。
    if (hasHighlightedMenu()) return
    claimShiftEnter(event)
  }
  document.addEventListener('keydown', onKeyDown, true)
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
  }
}
