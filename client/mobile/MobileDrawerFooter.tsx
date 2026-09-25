import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import { MobileIcon } from './MobileIcon.tsx'
import { resolveMobileIcons } from './icon-compat.mjs'

/** 宿主图标在加载时解析一次：不同 DSH 版本的导出名不同（见 icon-compat.mjs）。 */
const icons = resolveMobileIcons(primitives)

/** Full props for the sidebar footer action entry. */
export interface MobileDrawerFooterProps extends PropsRuntime<'sidebar.footer.action'>, PropsLocale<typeof NS> {
  /** Bound ctx.sessionLogDownload.download() for the current session. */
  downloadSessionLog: (sessionId: string) => void
  /** Bound ctx.layout.toggleSidebar(): the Files sheet closes the drawer. */
  toggleSidebar: () => void
}

/**
 * Mobile-only drawer footer actions, relocated from the session header to the
 * drawer footer (beside Settings):
 * - Files: opens the dsh-web-ui aionui explorer as a floating bottom sheet
 *   (the explorer column is hidden on mobile until this marker is set, so
 *   the suite's own persisted-expanded state can never cover the UI on load).
 * - Session log: the official session-log-export controller, so the
 *   progress/result dialog is shared with the desktop flow.
 * Hidden entirely on wide screens (CSS media query).
 */
export function MobileDrawerFooter({ useSessions, downloadSessionLog, toggleSidebar, t }: MobileDrawerFooterProps) {
  const sessionId = useSessions((state) => state.current)
  const openExplorer = (): void => {
    document.querySelector('[data-mobile-nav="frame"]')?.setAttribute('data-aionui-explorer-open', '')
    toggleSidebar()
  }
  return (
    <div data-mobile-nav="drawer-actions">
      <button
        type="button"
        data-mobile-nav="explorer"
        aria-label={t('files')}
        title={t('files')}
        onClick={openExplorer}
      >
        <MobileIcon icon={icons.panelLeft} name="panelLeft" size={14} />
        <span>{t('files')}</span>
      </button>
      <button
        type="button"
        data-mobile-nav="session-log"
        aria-label={t('sessionLog')}
        title={t('sessionLog')}
        disabled={sessionId === undefined}
        onClick={() => {
          if (sessionId !== undefined) downloadSessionLog(sessionId)
        }}
      >
        <MobileIcon icon={icons.download} name="download" size={14} />
        <span>{t('sessionLog')}</span>
      </button>
    </div>
  )
}
