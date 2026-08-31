import { useEffect, useLayoutEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import {
  DRAWER_SELECTOR,
  TOGGLE_SELECTOR,
  isOverlayTap,
  navTargetFor,
} from './nav-targets.mjs'

/** Full props for the shell overlay entry. */
export interface MobileNavOverlayProps extends PropsRuntime<'shell.overlay'>, PropsLocale<typeof NS> {
  /** Bound ctx.layout.toggleSidebar(). */
  toggleSidebar: () => void
}

/** Same breakpoint as the shell's SIDEBAR_AUTO_COLLAPSE (viewport < 1024). */
const MOBILE_QUERY = '(max-width: 1023px)'

/** Live matchMedia hook for the narrow breakpoint. */
function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const onChange = (event: MediaQueryListEvent) => setMobile(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return mobile
}

/** The AppFrame element: direct parent of the shell overlay layer. */
function findFrame(): HTMLElement | null {
  return document.querySelector('[data-shell-overlay]')?.parentElement ?? null
}

/**
 * Mobile shell overlay: owns the `data-mobile-nav` marker on the AppFrame
 * element (the CSS restructure keys off it), mirrors the frame's collapsed
 * state into React state, and renders the dimmed backdrop plus a floating
 * directory button for the hero/blank phases that have no session header.
 */
export function MobileNavOverlay({ toggleSidebar, t }: MobileNavOverlayProps) {
  const mobile = useMobile()
  const [open, setOpen] = useState(false)
  const [fabVisible, setFabVisible] = useState(false)

  // Frame ownership + open-state mirror. On wide screens this effect is inert:
  // the marker is never set, so the layout is untouched.
  useLayoutEffect(() => {
    if (!mobile) {
      setOpen(false)
      return
    }
    const frame = findFrame()
    if (frame === null) return
    frame.setAttribute('data-mobile-nav', 'frame')
    const sync = () => setOpen(!frame.hasAttribute('data-sidebar-collapsed'))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
    return () => {
      observer.disconnect()
      frame.removeAttribute('data-mobile-nav')
    }
  }, [mobile])

  // The floating button is a fallback for surfaces without a session header:
  // phase "active" means the header (and its toggle) is rendered already.
  useEffect(() => {
    if (!mobile) {
      setFabVisible(false)
      return
    }
    const sync = () => setFabVisible(document.querySelector('[data-phase="active"]') === null)
    sync()
    const observer = new MutationObserver(sync)
    // childList: the conversation root can be replaced wholesale on session
    // switches, so attribute-only observation would miss the new phase.
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-phase'],
    })
    return () => observer.disconnect()
  }, [mobile])

  // Escape closes the drawer — but yields to an open modal dialog (e.g. the
  // settings panel), which owns its own Escape handling.
  useEffect(() => {
    if (!mobile || !open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('[aria-modal="true"]') === null) toggleSidebar()
    }
    // Capture phase: run before the settings panel's own document-bubble Escape
    // handler, so the modal is still present when we yield to it.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [mobile, open, toggleSidebar])

  // Navigation inside the drawer closes it: tapping a session row or a
  // plugin takeover entry (task board / ssh) must hand the screen to the
  // content it just opened. Mouse clicks keep the direct close path. Touch
  // session rows close only after aria-selected changes, so live session
  // updates cannot strand a delayed click on a detached DOM target.
  //
  // Deliberately NOT closed by this rule:
  // - Settings / Session log: their dialogs render INSIDE the drawer DOM
  //   (portaled into the sidebar); closing the drawer would slide the dialog
  //   off-screen with it.
  // - Workspace folder rows (YDXeBa_projectRow), the logo: pure UI toggles,
  //   not navigation — see NAV_TARGETS in nav-targets.mjs.
  // - Anything while a modal dialog is open: the dialog owns the screen.
  useEffect(() => {
    if (!mobile || !open) return
    let lastTouchNavAt = 0
    let lastTouchX = 0
    let lastTouchY = 0
    let suppressTouchClickUntil = 0
    let pendingTouchRow: Element | null = null
    let selectedRowAtArm: Element | null = null
    let navClickArrived = false
    let navObserver: MutationObserver | null = null
    let navTimer: number | null = null

    const drawerRoot = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(DRAWER_SELECTOR)

    const disarmNav = (): void => {
      navObserver?.disconnect()
      navObserver = null
      if (navTimer !== null) window.clearTimeout(navTimer)
      navTimer = null
      pendingTouchRow = null
      selectedRowAtArm = null
      navClickArrived = false
    }

    const armNav = (row: Element): void => {
      disarmNav()
      pendingTouchRow = row
      const drawer = drawerRoot()
      selectedRowAtArm = drawer?.querySelector('[role="treeitem"][aria-selected="true"]') ?? null
      if (drawer === null) return
      navObserver = new MutationObserver(() => {
        const frame = document.querySelector('[data-mobile-nav="frame"]')
        if (frame === null || frame.hasAttribute('data-sidebar-collapsed')) {
          disarmNav()
          return
        }
        const selectedRow = drawerRoot()?.querySelector('[role="treeitem"][aria-selected="true"]') ?? null
        if (navClickArrived && selectedRow !== null && selectedRow !== selectedRowAtArm) {
          disarmNav()
          toggleSidebar()
        }
      })
      navObserver.observe(drawer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-selected'],
      })
      navTimer = window.setTimeout(disarmNav, 2000)
    }

    const navigationTarget = (target: EventTarget | null): Element | null => {
      if (document.querySelector('[aria-modal="true"]') !== null) return null
      const frame = document.querySelector('[data-mobile-nav="frame"]')
      if (frame === null || frame.hasAttribute('data-sidebar-collapsed')) return null
      if (!(target instanceof Element)) return null
      const drawer = drawerRoot()
      if (drawer === null || !drawer.contains(target)) return null
      return navTargetFor(target)
    }

    const isPendingTouchClick = (event: MouseEvent): boolean => {
      const capabilities = (event as MouseEvent & {
        sourceCapabilities?: { firesTouchEvents?: boolean }
      }).sourceCapabilities
      if (capabilities?.firesTouchEvents === true) return true
      return Math.hypot(event.clientX - lastTouchX, event.clientY - lastTouchY) <= 24
    }

    const onDrawerClick = (event: MouseEvent): void => {
      // A touch row tap owns the close through the selection observer. Let the
      // browser click reach React without a capture-phase close racing it.
      if (performance.now() < suppressTouchClickUntil) return
      if (
        pendingTouchRow !== null
        && performance.now() - lastTouchNavAt < 500
        && isPendingTouchClick(event)
      ) {
        const target = navigationTarget(event.target)
        const row = target?.closest('[role="treeitem"]')
        if (row !== null && row !== undefined) {
          pendingTouchRow = row
          navClickArrived = true
          return
        }
      }
      if (navigationTarget(event.target) !== null) toggleSidebar()
    }

    const onDrawerPointerUp = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      const target = navigationTarget(event.target)
      if (target === null) return

      const row = target.closest('[role="treeitem"]')
      if (row !== null) {
        if (row.getAttribute('aria-selected') === 'true') {
          // Already-selected rows will not navigate; closing now is safe.
          suppressTouchClickUntil = performance.now() + 500
          toggleSidebar()
        } else {
          // Let React navigate first, then close on the selection mutation.
          lastTouchNavAt = performance.now()
          lastTouchX = event.clientX
          lastTouchY = event.clientY
          armNav(row)
        }
        return
      }

      // Non-row targets keep their existing click path; only host
      // session/search rows participate in the selected-state hand-off.
    }

    document.addEventListener('click', onDrawerClick, true)
    document.addEventListener('pointerup', onDrawerPointerUp, true)
    return () => {
      disarmNav()
      document.removeEventListener('click', onDrawerClick, true)
      document.removeEventListener('pointerup', onDrawerPointerUp, true)
    }
  }, [mobile, open, toggleSidebar])

  // Tap-outside closes the drawer (issue #38). The backdrop is now
  // pointer-events: none (pure dimming layer that never steals clicks), so
  // "tap the dimmed area to close" moves here: any click outside the drawer
  // (and outside the header toggle) closes it, keeping the standard
  // interaction while letting drawer contents receive clicks normally.
  // Capture phase: the close happens before the content processes the tap
  // (same first-tap-closes behaviour as before).
  useEffect(() => {
    if (!mobile || !open) return
    const onOutsideClick = (event: MouseEvent) => {
      if (document.querySelector('[aria-modal="true"]') !== null) return
      const target = event.target as HTMLElement | null
      if (target === null) return
      if (target.closest(TOGGLE_SELECTOR) !== null) return
      // Portaled overlays (issue #72): the workspace section's "视图选项" /
      // "添加工作区" and the session row kebab all open menus that live on
      // document.body — outside the drawer DOM. Without this exemption the
      // first tap on a menu item is eaten: the drawer slides away, the menu
      // unmounts with the sidebar, and the item's onClick never runs, so
      // every workspace control reads as "点了没反应" on a phone.
      if (isOverlayTap(target)) return
      const frame = document.querySelector('[data-mobile-nav="frame"]')
      if (frame === null || frame.hasAttribute('data-sidebar-collapsed')) return
      const drawer = document.querySelector<HTMLElement>(DRAWER_SELECTOR)
      if (drawer !== null && drawer.contains(target)) return
      toggleSidebar()
    }
    document.addEventListener('click', onOutsideClick, true)
    return () => document.removeEventListener('click', onOutsideClick, true)
  }, [mobile, open, toggleSidebar])

  if (!mobile) return null
  return (
    <>
      {open && (
        <div data-mobile-nav="backdrop" />
      )}
      {fabVisible && !open && (
        <button
          type="button"
          data-mobile-nav="fab"
          aria-label={t('open')}
          title={t('open')}
          onClick={() => toggleSidebar()}
        >
          <IconPanelLeftOutline16 size={18} />
        </button>
      )}
    </>
  )
}
