/** `pocketMobileNav` namespace dictionaries: drawer controls. */
export const NS = 'pocketMobileNav'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'open': '打开目录',
  'close': '收起目录',
  'backdrop': '点击关闭目录',
  'sessionLog': '导出会话日志',
  'files': '文件浏览',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<MobileNavKey, string> = {
  'open': 'Open directory',
  'close': 'Close directory',
  'backdrop': 'Click to close directory',
  'sessionLog': 'Session log',
  'files': 'Files',
}

/** Japanese dictionary, key-identical to the Chinese source of truth. */
export const ja: Record<MobileNavKey, string> = {
  'open': 'ディレクトリを開く',
  'close': 'ディレクトリを閉じる',
  'backdrop': 'クリックでディレクトリを閉じる',
  'sessionLog': 'セッションログをエクスポート',
  'files': 'ファイル',
}

/** Key domain of the `pocketMobileNav` namespace (zh is the source of truth). */
export type MobileNavKey = keyof typeof zh
