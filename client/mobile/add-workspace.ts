// 隐藏「添加工作区」入口（issue #17 修正）：手机上配工作区没有意义，桌面端不受影响。
//
// 图标按钮的 aria-label 随语言变化（zh「添加工作区」/ en「Add workspace」），由
// mobile.css.ts 直接按 aria-label 隐藏；下拉菜单里的「添加工作区…」是纯文本项，CSS
// 选不到，这里按文案兜底（只在新增节点时检查，省开销）。
//
// 历史：本模块原名 fileGuard，另外两件事都已过时并被删掉 ——
//   1) 在捕获阶段拦截文件链接的点击、弹一句「无法直接打开」。DSH 现在把文件链接交给
//      openFile，最终在侧边栏打开预览
//      （ui-tool/tests/toolview-slot.client.spec.tsx「file-path clicks travel owner
//      openFile → chat inject → the right Sidebar」），不再调主机 openPath；而且拦截
//      靠「文案像不像路径」猜目标，会把文案恰好是路径的正常按钮一起吞掉。
//   2) 给每个文件链接注入「复制」按钮（经主机侧读文件 RPC 取正文再写剪贴板）。
//      侧边栏预览已经能看文件，这个按钮冗余，RPC 端点一并删掉了。

/** 「添加工作区」入口的文案（随语言变化），两种都覆盖。 */
const WS_LABELS = ['添加工作区', '添加工作区…', 'Add workspace', 'Add workspace…']

/** 就地隐藏「添加工作区」入口，返回清理函数。 */
export function startAddWorkspaceHider(): () => void {
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
