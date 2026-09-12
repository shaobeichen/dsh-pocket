// dsh-web-mobile 移植（MIT，见 LICENSE.dsh-web-mobile）：移动端适配的 client 侧实现。
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { MobileNavToggle } from './MobileNavToggle.tsx'
import { MobileNavOverlay } from './MobileNavOverlay.tsx'
import { MobileDrawerFooter } from './MobileDrawerFooter.tsx'
import { startFileGuard } from './fileGuard.ts'
import { MOBILE_CSS } from './mobile.css.ts'
import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS, MOBILE_RIGHTBAR_ATTRIBUTE, MOBILE_RIGHTBAR_EVENT } from '../api.js'
import { NS, en, zh } from './locales.ts'
import type { MobileNavKey } from './locales.ts'
import { resolveLayout, persistLayoutFromUrl } from './layout-mode.mjs'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Directory-drawer controls copy. */
    'mobileNav': MobileNavKey
  }
}

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */

/**
 * Mobile-adaptive shell, browser half: injects the mobile stylesheet, then
 * contributes the directory toggle to the session header and the backdrop +
 * floating button to the shell overlay.
 * @param ctx - client root context.
 */
export function mobileApply(ctx): void {
  // 布局模式（issue #74）：URL 参数 > localStorage > auto(=matchMedia)。
  // desktop 模式（宽屏手机/平板强制电脑布局）下整段 mobile 效果都不挂——
  // 不加 styles、不挂 slots、不跑 effects，直接走 DSH 原生桌面 UI。
  const urlValue = new URL(window.location.href).searchParams.get('dsh-layout') ?? '';
  const narrowMQ = window.matchMedia('(max-width: 1023px)');
  const stored = persistLayoutFromUrl(urlValue);
  const layout = resolveLayout({ urlValue, stored, narrowMatch: narrowMQ.matches });
  document.body?.setAttribute('data-dsh-pocket-layout', layout);
  if (layout === 'desktop') return;
  // 强制 mobile：narrow 永远 true；宽度变化不再切换（用户已显式选 mobile）
  // auto 模式：narrow 是真实的 matchMedia，宽度变化会触发 effect 挂载/卸载
  let narrow: MediaQueryList = narrowMQ;
  if (layout === 'mobile') {
    narrow = { matches: true, addEventListener: () => {}, removeEventListener: () => {} } as MediaQueryList;
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mobile-nav: dictionaries')

  ctx.effect(() => {
    let active = true
    const applyEnabled = (enabled: boolean): void => {
      document.body?.setAttribute(MOBILE_RIGHTBAR_ATTRIBUTE, enabled ? 'on' : 'off')
    }
    const onChange = (event: Event): void => {
      applyEnabled((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled === true)
    }
    const load = async (): Promise<void> => {
      try {
        const result = await ctx.connection.rpc.call(POCKET_RPC_CHANNEL, POCKET_ENDPOINTS.status, {}) as {
          ok?: boolean
          value?: { mobileRightbarEnabled?: boolean }
        }
        if (active) applyEnabled(result?.ok === true ? result.value?.mobileRightbarEnabled !== false : true)
      } catch {
        if (active) applyEnabled(true)
      }
    }
    window.addEventListener(MOBILE_RIGHTBAR_EVENT, onChange)
    void load()
    return () => {
      active = false
      window.removeEventListener(MOBILE_RIGHTBAR_EVENT, onChange)
      document.body?.removeAttribute(MOBILE_RIGHTBAR_ATTRIBUTE)
    }
  }, 'dsh-mobile-nav: optional right sidebar')

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@dsh-external/dsh-mobile-nav'
    tag.dataset.pluginCss = '@dsh-external/dsh-mobile-nav/mobile.css'
    tag.textContent = MOBILE_CSS
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  }, 'dsh-mobile-nav: styles')

  // Phone chrome: KEEP the system status bar (no fullscreen) and make it
  // blend into the page. On narrow screens:
  // - The viewport meta gains viewport-fit=cover, so env(safe-area-inset-top)
  //   is the real status-bar / notch height and the stylesheet can push every
  //   surface below it (off notched phones, or in a browser tab where the
  //   layout viewport already sits below the status bar, the inset is 0 and
  //   nothing shifts).
  // - A theme-color meta tracks the shell background (the official theme is
  //   toggled by body[data-ds-dark-theme], which flips --dsw-alias-bg-base):
  //   Android then paints the status bar / URL bar with the page's own base
  //   color, so the status bar reads as part of the UI instead of a foreign
  //   strip. The drawer paints the same strip on iOS / notch displays.
  // - gesturestart is suppressed as the legacy-iOS fallback for double-tap
  //   zoom; modern browsers are covered by the stylesheet's
  //   touch-action: manipulation (which keeps pan and pinch zoom).
  ctx.effect(() => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    const originalViewport = viewport?.content ?? ''
    const themeMeta = document.createElement('meta')
    themeMeta.name = 'theme-color'
    const bodyBg = (): string => getComputedStyle(document.body).backgroundColor

    const sync = (): void => {
      if (viewport !== null) viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover'
      themeMeta.content = bodyBg()
      if (themeMeta.parentElement === null) document.head.appendChild(themeMeta)
    }
    const restore = (): void => {
      if (viewport !== null) viewport.content = originalViewport
      themeMeta.remove()
    }
    const onGestureStart = (event: Event) => event.preventDefault()
    if (narrow.matches) sync()
    const onChange = (event: MediaQueryListEvent) => (event.matches ? sync() : restore())
    narrow.addEventListener('change', onChange)
    const observer = new MutationObserver(() => {
      if (narrow.matches) themeMeta.content = bodyBg()
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    document.addEventListener('gesturestart', onGestureStart)
    return () => {
      narrow.removeEventListener('change', onChange)
      observer.disconnect()
      document.removeEventListener('gesturestart', onGestureStart)
      restore()
    }
  }, 'dsh-mobile-nav: status bar theme + viewport + zoom guard')

  // dsh-web-ui compatibility: the aionui explorer column would render as a
  // sheet over the whole mobile UI whenever its (persisted) expanded state
  // is active — including right after a reload, with no way out (the
  // suite's floating expand button only exists while collapsed). Instead
  // of fighting the suite's store timing, the mobile stylesheet keeps the
  // explorer column hidden by default and the header's Files action (plus
  // the drawer footer entry) opens it via the `data-aionui-explorer-open`
  // marker on the frame. This effect just clears that marker when the
  // sheet's own collapse chevron is tapped, so closing is symmetric with
  // opening.
  ctx.effect(() => {
    if (!narrow.matches) return () => {}
    const onChevronClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target === null || !target.closest('.aionui-collapse-chevron')) return
      document.querySelector('[data-mobile-nav="frame"]')?.removeAttribute('data-aionui-explorer-open')
    }
    document.addEventListener('click', onChevronClick, true)
    return () => document.removeEventListener('click', onChevronClick, true)
  }, 'dsh-mobile-nav: aionui explorer close marker')

  // The mobile "Files" entries (header icon + drawer footer) open the
  // dsh-web-ui **aionui explorer column** — a host-side component that plain
  // DeepSeek Harness does NOT ship (issue #48). Without it the entries are
  // dead buttons (they only toggle a frame attribute; nothing ever renders).
  // Detect whether the host provides the column and mark the frame with
  // `data-mobile-nav-explorer="1|0"` so the stylesheet can hide the entries
  // on hosts without it (dsh-web-ui installs keep the feature).
  ctx.effect(() => {
    if (!narrow.matches) return () => {}
    const frame = (): HTMLElement | null => document.querySelector('[data-mobile-nav="frame"]')
    const check = () => {
      const has = document.querySelector('[data-aionui-explorer-col]') !== null
      frame()?.setAttribute('data-mobile-nav-explorer', has ? '1' : '0')
    }
    check()
    const timer = window.setTimeout(check, 1500) // 宿主懒渲染：稍后再查一次
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, 'dsh-mobile-nav: explorer availability (issue #48)')

  // dsh-web-ui compatibility: the aionui preview column persists its open
  // tabs in localStorage and restores them on load, which would pop the
  // preview sheet over the fresh UI after a reload. Gate it like the
  // explorer: the stylesheet keeps the column hidden unless the frame
  // carries `data-aionui-preview-open`; this effect sets that marker when
  // the user actually taps a file row in the explorer sheet, and clears it
  // whenever the suite hides the column again (collapse chevron / tab
  // close), so a restored-but-unwanted sheet never appears.
  ctx.effect(() => {
    if (!narrow.matches) return () => {}
    const frame = (): HTMLElement | null => document.querySelector('[data-mobile-nav="frame"]')
    const onTap = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target === null) return
      if (target.closest('[data-aionui-explorer-col] [class$="_treeRow"]') === null) return
      frame()?.setAttribute('data-aionui-preview-open', '')
    }
    const sync = (): void => {
      const pv = document.querySelector('[data-aionui-preview-col]')
      if (pv === null) return
      if (getComputedStyle(pv).visibility === 'hidden') frame()?.removeAttribute('data-aionui-preview-open')
    }
    document.addEventListener('click', onTap, true)
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] })
    sync()
    return () => {
      document.removeEventListener('click', onTap, true)
      observer.disconnect()
    }
  }, 'dsh-mobile-nav: preview sheet open marker')

  // The official conversation status row (turns / steps / LLM time / TTFT /
  // cache) has a hashed class, so the stylesheet cannot target it directly.
  // Its stable boundary is the official conversation.composer.dock slot. Mark
  // only the metrics root inside that slot; never scan every *_root under the
  // composer because the editor itself is now contenteditable (not textarea)
  // and its root also contains the dock text.
  ctx.effect(() => {
    if (!narrow.matches) return () => {}
    // The composer root renders the TPS readout ("TPS 89.4 tok/s") as its
    // own row BELOW the status strip; fold it into the strip so every
    // metric scrolls together. The suite re-renders its own tree, so this
    // must be idempotent and re-run on every mutation.
    const moveTps = (stats: Element): void => {
      if ([...stats.children].some((c) => /^TPS\s+\d/.test((c.textContent ?? '').trim()))) return
      const stack = stats.closest('[class$="_composerStack"]')
      if (stack === null) return
      for (const el of stack.querySelectorAll('div')) {
        const text = (el.textContent ?? '').trim()
        if (!/^TPS\s+\d/.test(text)) continue
        if (el.children.length > 0) continue
        stats.appendChild(el)
        return
      }
    }
    const mark = (): void => {
      const selector = '[data-phase] [data-slot="conversation.composer.dock"] [class$="_root"]'
      for (const root of document.querySelectorAll(selector)) {
        const text = root.textContent ?? ''
        if (!/(turns|steps|\bLLM\b|轮|步)/.test(text)) continue
        root.setAttribute('data-mobile-nav', 'stats')
        moveTps(root)
        return
      }
    }
    const observer = new MutationObserver(mark)
    observer.observe(document.body, { childList: true, subtree: true })
    mark()
    return () => {
      observer.disconnect()
    }
  }, 'dsh-mobile-nav: stats line marker')

  // The dsh-web-ui explorer / preview columns toggle via `visibility`
  // (their inline style), which never restarts a CSS animation — so the
  // sheets would only animate on first mount. Replay the rise animation
  // with the Web Animations API each time a column turns visible, then
  // leave the resting state to the stylesheet.
  ctx.effect(() => {
    if (!narrow.matches) return () => {}
    const cols = ['[data-aionui-explorer-col]', '[data-aionui-preview-col]']
    const seen = new Map<string, boolean>()
    const play = (el: Element): void => {
      el.animate(
        [
          { opacity: 0, transform: 'translateY(28px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 280, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' },
      )
    }
    const check = (): void => {
      for (const sel of cols) {
        const el = document.querySelector(sel)
        if (el === null) continue
        const visible = getComputedStyle(el).visibility === 'visible'
        const prev = seen.get(sel) ?? false
        if (visible && !prev) play(el)
        seen.set(sel, visible)
      }
    }
    const observer = new MutationObserver(check)
    // Visibility flips come through inline style mutations (suite) or the
    // explorer-open marker on the frame; class changes are watched too.
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style', 'class', 'data-aionui-explorer-open'] })
    check()
    return () => {
      observer.disconnect()
    }
  }, 'dsh-mobile-nav: sheet rise animation replay')

  // 移动端文件守卫（issue #17 修正）：手机上点 dsh-web 渲染的文件链接会触发桌面
  // 端 workspaces.openPath(open ...) —— 既打不开（路径在电脑上），又会抛
  // "path open failed"。这里在捕获阶段拦截这类点击 / 键盘激活，改为弹一个提示，
  // 并隐藏「添加工作区」入口（手机上配工作区无意义）；同时在文件链接旁注入
  // 「复制」按钮，点它经主机 RPC 读取文件正文再写入剪贴板。只挂窄屏。
  ctx.effect(() => {
    if (!narrow.matches) return () => {}
    // 尽量拿到当前工作区 cwd（文件链接文案是相对它的），传给主机 RPC 做精确解析；
    // 拿不到就回退到主机 process.cwd()。dsh-web 的 workspaces 服务暴露当前工作区。
    const getWorkspaceCwd = (): string => {
      try {
        const ws = (ctx as unknown as { get?: (k: string) => unknown }).get?.('workspaces')
          ?? (ctx as unknown as { workspaces?: unknown }).workspaces
        const list = (ws as { list?: unknown })?.list
        const arr: unknown[] | null = Array.isArray(list)
          ? list
          : (list && typeof list === 'object' && 'value' in (list as object)
            ? (list as { value: unknown[] }).value
            : null)
        if (Array.isArray(arr)) {
          for (const w of arr) {
            const c = (w as { cwd?: string; root?: string })?.cwd
              ?? (w as { cwd?: string; root?: string })?.root
            if (typeof c === 'string' && c) return c
          }
        }
      } catch { /* 忽略，回退 process.cwd() */ }
      return ''
    }
    // 手机侧读文件回调：走 dsh-pocket 的 RPC 通道，由主机侧 fileRead 端点处理。
    const readFile = (filePath: string) =>
      ctx.connection.rpc.call(
        POCKET_RPC_CHANNEL,
        POCKET_ENDPOINTS.fileRead,
        { path: filePath, cwd: getWorkspaceCwd() },
      ) as Promise<{ ok: boolean; value?: { content: string; path: string; size: number }; error?: { message: string } }>
    return startFileGuard(readFile)
  }, 'dsh-mobile-nav: file open guard + copy button + hide add-workspace (issue #17)')

  // 手机上模型 / 提供方设置加载失败：上游 dsh-web 会渲染「加载提供方目录失败 /
  // Settings are unavailable in this browser」。这条文案不是 dsh-pocket 的，但手机侧
  // 本就不支持改模型设置，原报错只会吓到用户。窄屏下用 MutationObserver 就地把该报错
  // 文本替换成「去电脑端修改」的引导提示（仅手机，桌面端不受影响）。
  ctx.effect(() => {
    if (!narrow.matches) return () => {}
    const PHRASES = ['加载提供方目录失败', 'Settings are unavailable in this browser']
    const NOTICE = '手机上不支持模型设置，请去电脑端修改设置'
    // 取包含报错文案的最深节点，避免把外层大容器整块清掉。
    const findDeepest = (el: Element): Element => {
      let deepest = el
      for (const child of el.querySelectorAll('*')) {
        if (PHRASES.some((p) => (child.textContent ?? '').includes(p))) deepest = child
      }
      return deepest
    }
    const patch = (): void => {
      for (const el of document.querySelectorAll('body *')) {
        const t = el.textContent ?? ''
        if (!PHRASES.some((p) => t.includes(p))) continue
        if ((el as HTMLElement).dataset?.dshpModelNotice === '1') continue
        const target = findDeepest(el)
        target.textContent = NOTICE
        ;(target as HTMLElement).dataset.dshpModelNotice = '1'
      }
    }
    const observer = new MutationObserver(patch)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    patch()
    return () => observer.disconnect()
  }, 'dsh-mobile-nav: replace model-settings load error with mobile hint')


  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'mobile-nav-toggle',
    order: 10,
    locale: NS,
    inject: () => ({
      toggleSidebar: () => ctx.layout.toggleSidebar(),
    }),
  }, MobileNavToggle))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'mobile-nav-overlay',
    order: 10,
    locale: NS,
    inject: () => ({
      toggleSidebar: () => ctx.layout.toggleSidebar(),
    }),
  }, MobileNavOverlay))

  // Session log download, relocated from the session header to the drawer
  // footer on mobile (the header capsule is hidden by CSS); the drawer
  // footer also hosts the Files action that opens the dsh-web-ui explorer
  // sheet.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'mobile-nav-session-log',
    order: 10,
    locale: NS,
    inject: () => ({
      downloadSessionLog: (sessionId: string) => ctx.sessionLogDownload.download(sessionId),
      toggleSidebar: () => ctx.layout.toggleSidebar(),
    }),
  }, MobileDrawerFooter))
}

// Type-only augmentation imports: pull the layout / conversation / sidebar
// SlotMap merges and the sessionLogDownload service typing into this program
// without any runtime import.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-session-log-export/client'
