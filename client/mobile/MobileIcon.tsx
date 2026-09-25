import { MOBILE_ICON_FALLBACK, isRenderableIcon } from './icon-compat.mjs'

/** Props for the version-tolerant icon slot. */
export interface MobileIconProps {
  /** Icon component resolved from the host primitives namespace (null when absent). */
  icon: unknown
  /** Which fallback glyph to draw when the running DSH has no such export. */
  name: 'panelLeft' | 'download' | 'folderOpen'
  /** Square edge in px, forwarded to the host icon. */
  size: number
}

/**
 * Renders the resolved host icon, or a text glyph when this DSH build no longer
 * exports that name. It must never hand `undefined` to createElement: that is
 * exactly what crashed the whole slot entry (React #130) and left the mobile
 * drawer dead on DSH 0.1.7-rc.2+ (see icon-compat.mjs for the version matrix).
 */
export function MobileIcon({ icon, name, size }: MobileIconProps) {
  if (!isRenderableIcon(icon)) {
    return (
      <span data-mobile-nav="icon-fallback" aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>
        {MOBILE_ICON_FALLBACK[name]}
      </span>
    )
  }
  // The component type differs per DSH version, so it is only known at runtime;
  // `never` as the return type keeps JSX typing happy without an `any` cast.
  const Icon = icon as (props: { size?: number }) => never
  return <Icon size={size} />
}
