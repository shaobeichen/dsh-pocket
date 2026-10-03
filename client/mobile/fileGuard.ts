// 移动端文件守卫（issue #17，issue #152 修正）：dsh-web 在手机上点「文件链接」会触发桌面端
// workspaces.openPath(open <path>)，既打不开（文件在电脑上），又会抛
// "path open failed". 这里做两件事：
//   1) 应用自己没处理这类激活时（点击 / 键盘）弹一个提示兜底；
//   2) 在每个文件链接旁注入一个「复制」按钮，点它经主机 RPC 读文件正文再写剪贴板。
// 另外隐藏「添加工作区」入口（手机上配工作区无意义）。
// 移植自 dsh-web-mobile（MIT）。
//
// 识别方式：不依赖 dsh-web 的 hash 类名（每次构建都变），只认「文本像文件路径的
// <button>/<a>」——文件链接按钮的文案就是路径（如 lib/proxy.mjs / /Users/.../x.ts）。
//
// 兜底必须晚于应用：dsh-web 是「预览优先」（dsh-context 的文件行先 onPreview、再 onOpen；
// dsh-client-ui-reference 的 openReference 就是 sidebarRight.openResource），
// 它处理完了才轮到我们。所以监听器注册在冒泡阶段 + defaultPrevented 早退。

/** 手机上点击文件时弹出的提示。 */
const GUARD_MSG = '手机上无法直接打开电脑上的文件'
/** 「添加工作区」入口的文案（随语言变化），两种都覆盖。 */
const WS_LABELS = ['添加工作区', '添加工作区…', 'Add workspace', 'Add workspace…']
/** 复制按钮文案。 */
const COPY_LABEL = '复制'

/** 主机 fileRead 回调返回结构（与 client/api.js 的 FileReadResult 对齐）。 */
interface ReadFileResponse {
  ok: boolean;
  value?: { content: string; path: string; size: number };
  error?: { message: string };
}

/** 文本是否像文件路径：绝对路径 / 相对路径 / 带扩展名的目录路径。 */
function looksLikeFilePath(text: string | null): boolean {
  const t = (text ?? '').trim()
  if (t.length < 3 || t.length > 320) return false
  if (/^(\/|~\/|\.\.?\/|[A-Za-z]:\\)/.test(t)) return true
  if (/\/[\w.\-]+\.\w{1,12}$/.test(t)) return true
  if (/[\w.\-]+\/[\w.\-]+\.\w{1,12}/.test(t)) return true
  return false
}

/** 写剪贴板：优先 navigator.clipboard，非安全上下文（局域网 http）回退 execCommand。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* 回退 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const okCopy = document.execCommand('copy')
    ta.remove()
    return okCopy
  } catch {
    return false
  }
}

export function startFileGuard(
  readFile: (path: string) => Promise<ReadFileResponse>,
): () => void {
  // 轻量 toast：自包含，不依赖 dsh-pocket 面板的 React 状态。
  let toastEl: HTMLElement | null = null
  let toastTimer: number | null = null
  const showToast = (text: string): void => {
    if (toastEl === null) {
      toastEl = document.createElement('div')
      toastEl.setAttribute('data-mobile-nav', 'file-guard-toast')
      Object.assign(toastEl.style, {
        position: 'fixed',
        left: '50%',
        bottom: '64px',
        transform: 'translateX(-50%)',
        maxWidth: '84vw',
        zIndex: '9999',
        padding: '10px 14px',
        borderRadius: '10px',
        background: 'rgba(20,22,28,.92)',
        color: '#fff',
        fontSize: '13px',
        lineHeight: '1.4',
        textAlign: 'center',
        fontFamily: 'inherit',
        boxShadow: '0 4px 16px rgba(0,0,0,.28)',
        pointerEvents: 'none',
        opacity: '0',
        transition: 'opacity .18s ease',
      } as CSSStyleDeclaration)
      document.body.appendChild(toastEl)
    }
    toastEl.textContent = text
    requestAnimationFrame(() => {
      if (toastEl !== null) toastEl.style.opacity = '1'
    })
    if (toastTimer !== null) window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      if (toastEl !== null) toastEl.style.opacity = '0'
    }, 2600)
  }

  // 兜底拦截，注册在**冒泡**阶段：让 dsh-web 自己的处理器先跑。
  // 应用能处理时会 preventDefault（如裸 <a href> 的导航）或 stopPropagation
  // （如 dsh-context 文件行的 ev.stopPropagation()），事件到不了这里；
  // 只有应用没管、真的会去调桌面端 open 的时候，才弹提示兜底。
  // 反过来注册在捕获阶段会连应用的预览一起吞掉（issue #152）。
  // 按钮的键盘激活（Enter/Space）会派发 click，因此只拦 click 即可同时覆盖鼠标与键盘。
  const onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    const el = target.closest('button, a') as HTMLElement | null
    if (el === null) return
    if (!looksLikeFilePath(el.textContent)) return
    event.preventDefault()
    showToast(GUARD_MSG)
  }
  document.addEventListener('click', onClick)

  // 在文件链接旁注入「复制」按钮：点它经主机 RPC 读文件正文再写剪贴板。
  // 用 data-mobile-nav-copy 标记已处理的链接，避免重复注入；React 重渲染会
  // 产生新元素（无标记），MutationObserver 重新补上按钮。
  const injectCopyButtons = (): void => {
    const links = document.querySelectorAll('button, a')
    links.forEach((el) => {
      if (el.getAttribute('data-mobile-nav-copy') === '1') return
      const txt = (el.textContent ?? '').trim()
      if (!looksLikeFilePath(txt)) return
      el.setAttribute('data-mobile-nav-copy', '1')
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute('data-mobile-nav', 'copy-file')
      btn.textContent = COPY_LABEL
      btn.addEventListener('click', async (e) => {
        e.preventDefault()
        e.stopPropagation()
        const filePath = (el.textContent ?? '').trim()
        btn.disabled = true
        btn.textContent = '…'
        try {
          const res = await readFile(filePath)
          if (!res?.ok) {
            showToast(res?.error?.message ?? '复制失败')
            return
          }
          const content = res.value?.content ?? ''
          const copied = await copyText(content)
          if (copied) {
            const kb = Math.max(1, Math.round((res.value?.size ?? content.length) / 1024))
            showToast(`已复制文件内容（${kb} KB）`)
          } else {
            showToast('复制失败，请手动选择')
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : '复制失败')
        } finally {
          btn.disabled = false
          btn.textContent = COPY_LABEL
        }
      })
      el.parentElement?.insertBefore(btn, el.nextSibling)
    })
  }
  injectCopyButtons()
  const copyObserver = new MutationObserver(() => injectCopyButtons())
  copyObserver.observe(document.body, { childList: true, subtree: true })

  // 隐藏「添加工作区」入口：图标按钮由 mobile.css.ts 按 aria-label 隐藏；
  // 下拉菜单里的文本项 CSS 选不到，这里按文案兜底（只在新增节点时检查，省开销）。
  const hideWsEntries = (): (() => void) => {
    const checkOne = (node: Node): void => {
      if (node.nodeType !== 1) return
      const el = node as HTMLElement
      const txt = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()
      if (WS_LABELS.includes(txt)) {
        el.style.display = 'none'
        el.setAttribute('data-mobile-nav-hide', 'add-workspace')
      }
    }
    const sel = '[role="menuitem"],[role="option"],li,button,a'
    document.querySelectorAll(sel).forEach(checkOne)
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return
          checkOne(n)
          ;(n as HTMLElement).querySelectorAll?.(sel).forEach(checkOne)
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }
  const disconnectWs = hideWsEntries()

  return () => {
    document.removeEventListener('click', onClick)
    copyObserver.disconnect()
    disconnectWs()
    if (toastTimer !== null) window.clearTimeout(toastTimer)
    toastEl?.remove()
  }
}
