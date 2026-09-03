window.__ModuleLoader__.load({
  id: "dsh-pocket",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    // The DSH client module system provides react as a module, never as a
    // global. esbuild keeps react external (see the build config above) and
    // its classic JSX transform emits bare React.createElement calls for the
    // mobile components (which import only named hooks, not React itself), so
    // the bundle must bind React itself - otherwise every mobile component
    // crashes at render time with "ReferenceError: React is not defined".
    var React = require("react");
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  redactStatus: () => redactStatus
});
module.exports = __toCommonJS(index_exports);
var import_react2 = require("react");

// client/api.js
var POCKET_RPC_CHANNEL = "/dsh-pocket";
var POCKET_ENDPOINTS = Object.freeze({
  status: "pocket.status",
  tunnelStart: "tunnel.start",
  tunnelStop: "tunnel.stop",
  tunnelSetConfig: "tunnel.setConfig",
  version: "pocket.version",
  update: "pocket.update",
  restart: "pocket.restart",
  lanTokenRefresh: "token.lanRefresh",
  lanAuthSetEnabled: "lanAuth.setEnabled",
  lanSetOverride: "lan.setOverride",
  lanSetEnabled: "lan.setEnabled",
  pinSetCustom: "pin.setCustom",
  pocketReset: "pocket.reset",
  // 移动端「复制文件内容」（issue #17）：手机经此 RPC 让主机读取文件正文，
  // 再写入剪贴板——因为手机无法直接打开电脑上的文件。
  fileRead: "pocket.fileRead"
});
function compareVersions(a, b) {
  const pa = String(a).replace(/^[vV]/, "").split(".");
  const pb = String(b).replace(/^[vV]/, "").split(".");
  for (let i = 0; i < 3; i++) {
    const x = parseInt(pa[i], 10) || 0;
    const y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x - y;
  }
  const aPre = String(a).replace(/^[vV]/, "").match(/-.*$/)?.[0] ?? "";
  const bPre = String(b).replace(/^[vV]/, "").match(/-.*$/)?.[0] ?? "";
  if (!aPre && !bPre) return 0;
  if (!aPre) return 1;
  if (!bPre) return -1;
  const aParts = aPre.slice(1).split(".");
  const bParts = bPre.slice(1).split(".");
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ax = aParts[i] ?? "";
    const bx = bParts[i] ?? "";
    if (ax === bx) continue;
    const aNum = /^\d+$/.test(ax);
    const bNum = /^\d+$/.test(bx);
    if (aNum && bNum) return Number(ax) - Number(bx);
    if (aNum) return 1;
    if (bNum) return -1;
    return ax < bx ? -1 : 1;
  }
  return 0;
}
function redactStatus(s) {
  return {
    proxyRunning: s?.proxyRunning === true,
    proxyPort: s?.proxyPort ?? null,
    lanUrl: s?.lanUrl ?? null,
    lanQr: s?.lanQr ?? null,
    lanCandidates: Array.isArray(s?.lanCandidates) ? s.lanCandidates : [],
    lanIpOverride: s?.lanIpOverride ?? "",
    tunnelRunning: s?.tunnelRunning === true,
    tunnelActiveMode: s?.tunnelActiveMode === "named" ? "named" : s?.tunnelActiveMode === "quick" ? "quick" : null,
    tunnelUrl: s?.tunnelUrl ?? null,
    tunnelQr: s?.tunnelQr ?? null,
    tunnelState: s?.tunnelState ?? { phase: "idle" },
    tunnelConfig: s?.tunnelConfig ?? { mode: "quick", hostname: "", tokenSet: false },
    dshPort: s?.dshPort ?? null
  };
}

// client/mobile/MobileNavToggle.tsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
function MobileNavToggle({ toggleSidebar, t }) {
  const toggleExplorer = () => {
    const frame = document.querySelector('[data-mobile-nav="frame"]');
    if (frame === null) return;
    if (frame.hasAttribute("data-aionui-explorer-open")) {
      frame.removeAttribute("data-aionui-explorer-open");
    } else {
      frame.setAttribute("data-aionui-explorer-open", "");
    }
  };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      "data-mobile-nav": "toggle",
      "aria-label": t("open"),
      title: t("open"),
      onClick: () => toggleSidebar()
    },
    /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives.IconPanelLeftOutline16, { size: 16 })
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      "data-mobile-nav": "files",
      "aria-label": t("files"),
      title: t("files"),
      onClick: toggleExplorer
    },
    /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives.IconFolderOpenOutline16, { size: 16 })
  ));
}

// client/mobile/MobileNavOverlay.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// client/mobile/nav-targets.mjs
var DRAWER_SELECTOR = '[data-mobile-nav="frame"] > :first-child';
var TOGGLE_SELECTOR = '[data-mobile-nav="toggle"]';
var NAV_TARGETS = [
  "button[data-dsh-taskboard-entry]",
  "button[data-dsh-ssh-entry]",
  // 抽屉底部的 "文件" 入口打开的是 dsh-web-ui 的 explorer 面板，它的 z-index
  // (55) 低于展开的抽屉 (600)，且在抽屉 DOM 之外：抽屉不关就会盖住面板，点
  // 面板里的行又会被"点抽屉外就关"吃掉。所以按导航处理，一起关掉。
  '[data-mobile-nav="files"]',
  '[class*="sessionRow"]',
  '[class*="newSession"]',
  '[class*="searchResultWorkspace"]',
  '[class*="searchResultRow"]'
].join(", ");
var NAV_EXCLUDE = '[class*="sessionRow"] button';
var OVERLAY_SELECTOR = [
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="tooltip"]',
  "[data-radix-popper-content-wrapper]"
].join(", ");
function navTargetFor(target) {
  if (target == null || typeof target.closest !== "function") return null;
  if (target.closest(NAV_EXCLUDE) !== null) return null;
  return target.closest(NAV_TARGETS);
}
function isOverlayTap(target) {
  if (target == null || typeof target.closest !== "function") return false;
  return target.closest(OVERLAY_SELECTOR) !== null;
}

// client/mobile/MobileNavOverlay.tsx
var MOBILE_QUERY = "(max-width: 1023px)";
function useMobile() {
  const [mobile, setMobile] = (0, import_react.useState)(() => window.matchMedia(MOBILE_QUERY).matches);
  (0, import_react.useEffect)(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = (event) => setMobile(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return mobile;
}
function findFrame() {
  return document.querySelector("[data-shell-overlay]")?.parentElement ?? null;
}
function MobileNavOverlay({ toggleSidebar, t }) {
  const mobile = useMobile();
  const [open, setOpen] = (0, import_react.useState)(false);
  const [fabVisible, setFabVisible] = (0, import_react.useState)(false);
  (0, import_react.useLayoutEffect)(() => {
    if (!mobile) {
      setOpen(false);
      return;
    }
    const frame = findFrame();
    if (frame === null) return;
    frame.setAttribute("data-mobile-nav", "frame");
    const sync = () => setOpen(!frame.hasAttribute("data-sidebar-collapsed"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(frame, { attributes: true, attributeFilter: ["data-sidebar-collapsed"] });
    return () => {
      observer.disconnect();
      frame.removeAttribute("data-mobile-nav");
    };
  }, [mobile]);
  (0, import_react.useEffect)(() => {
    if (!mobile) {
      setFabVisible(false);
      return;
    }
    const sync = () => setFabVisible(document.querySelector('[data-phase="active"]') === null);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-phase"]
    });
    return () => observer.disconnect();
  }, [mobile]);
  (0, import_react.useEffect)(() => {
    if (!mobile || !open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && document.querySelector('[aria-modal="true"]') === null) toggleSidebar();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [mobile, open, toggleSidebar]);
  (0, import_react.useEffect)(() => {
    if (!mobile || !open) return;
    let lastTouchNavAt = 0;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let suppressTouchClickUntil = 0;
    let pendingTouchRow = null;
    let selectedRowAtArm = null;
    let navClickArrived = false;
    let navObserver = null;
    let navTimer = null;
    const drawerRoot = () => document.querySelector(DRAWER_SELECTOR);
    const disarmNav = () => {
      navObserver?.disconnect();
      navObserver = null;
      if (navTimer !== null) window.clearTimeout(navTimer);
      navTimer = null;
      pendingTouchRow = null;
      selectedRowAtArm = null;
      navClickArrived = false;
    };
    const armNav = (row) => {
      disarmNav();
      pendingTouchRow = row;
      const drawer = drawerRoot();
      selectedRowAtArm = drawer?.querySelector('[role="treeitem"][aria-selected="true"]') ?? null;
      if (drawer === null) return;
      navObserver = new MutationObserver(() => {
        const frame = document.querySelector('[data-mobile-nav="frame"]');
        if (frame === null || frame.hasAttribute("data-sidebar-collapsed")) {
          disarmNav();
          return;
        }
        const selectedRow = drawerRoot()?.querySelector('[role="treeitem"][aria-selected="true"]') ?? null;
        if (navClickArrived && selectedRow !== null && selectedRow !== selectedRowAtArm) {
          disarmNav();
          toggleSidebar();
        }
      });
      navObserver.observe(drawer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-selected"]
      });
      navTimer = window.setTimeout(disarmNav, 2e3);
    };
    const navigationTarget = (target) => {
      if (document.querySelector('[aria-modal="true"]') !== null) return null;
      const frame = document.querySelector('[data-mobile-nav="frame"]');
      if (frame === null || frame.hasAttribute("data-sidebar-collapsed")) return null;
      if (!(target instanceof Element)) return null;
      const drawer = drawerRoot();
      if (drawer === null || !drawer.contains(target)) return null;
      return navTargetFor(target);
    };
    const isPendingTouchClick = (event) => {
      const capabilities = event.sourceCapabilities;
      if (capabilities?.firesTouchEvents === true) return true;
      return Math.hypot(event.clientX - lastTouchX, event.clientY - lastTouchY) <= 24;
    };
    const onDrawerClick = (event) => {
      if (performance.now() < suppressTouchClickUntil) return;
      if (pendingTouchRow !== null && performance.now() - lastTouchNavAt < 500 && isPendingTouchClick(event)) {
        const target = navigationTarget(event.target);
        const row = target?.closest('[role="treeitem"]');
        if (row !== null && row !== void 0) {
          pendingTouchRow = row;
          navClickArrived = true;
          return;
        }
      }
      if (navigationTarget(event.target) !== null) toggleSidebar();
    };
    const onDrawerPointerUp = (event) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      const target = navigationTarget(event.target);
      if (target === null) return;
      const row = target.closest('[role="treeitem"]');
      if (row !== null) {
        if (row.getAttribute("aria-selected") === "true") {
          suppressTouchClickUntil = performance.now() + 500;
          toggleSidebar();
        } else {
          lastTouchNavAt = performance.now();
          lastTouchX = event.clientX;
          lastTouchY = event.clientY;
          armNav(row);
        }
        return;
      }
    };
    document.addEventListener("click", onDrawerClick, true);
    document.addEventListener("pointerup", onDrawerPointerUp, true);
    return () => {
      disarmNav();
      document.removeEventListener("click", onDrawerClick, true);
      document.removeEventListener("pointerup", onDrawerPointerUp, true);
    };
  }, [mobile, open, toggleSidebar]);
  (0, import_react.useEffect)(() => {
    if (!mobile || !open) return;
    const onOutsideClick = (event) => {
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      const target = event.target;
      if (target === null) return;
      if (target.closest(TOGGLE_SELECTOR) !== null) return;
      if (isOverlayTap(target)) return;
      const frame = document.querySelector('[data-mobile-nav="frame"]');
      if (frame === null || frame.hasAttribute("data-sidebar-collapsed")) return;
      const drawer = document.querySelector(DRAWER_SELECTOR);
      if (drawer !== null && drawer.contains(target)) return;
      toggleSidebar();
    };
    document.addEventListener("click", onOutsideClick, true);
    return () => document.removeEventListener("click", onOutsideClick, true);
  }, [mobile, open, toggleSidebar]);
  if (!mobile) return null;
  return /* @__PURE__ */ React.createElement(React.Fragment, null, open && /* @__PURE__ */ React.createElement("div", { "data-mobile-nav": "backdrop" }), fabVisible && !open && /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      "data-mobile-nav": "fab",
      "aria-label": t("open"),
      title: t("open"),
      onClick: () => toggleSidebar()
    },
    /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives2.IconPanelLeftOutline16, { size: 18 })
  ));
}

// client/mobile/MobileDrawerFooter.tsx
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
function MobileDrawerFooter({ useSessions, downloadSessionLog, toggleSidebar, t }) {
  const sessionId = useSessions((state) => state.current);
  const openExplorer = () => {
    document.querySelector('[data-mobile-nav="frame"]')?.setAttribute("data-aionui-explorer-open", "");
    toggleSidebar();
  };
  return /* @__PURE__ */ React.createElement("div", { "data-mobile-nav": "drawer-actions" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      "data-mobile-nav": "explorer",
      "aria-label": t("files"),
      title: t("files"),
      onClick: openExplorer
    },
    /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives3.IconPanelLeftOutline16, { size: 14 }),
    /* @__PURE__ */ React.createElement("span", null, t("files"))
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      "data-mobile-nav": "session-log",
      "aria-label": t("sessionLog"),
      title: t("sessionLog"),
      disabled: sessionId === void 0,
      onClick: () => {
        if (sessionId !== void 0) downloadSessionLog(sessionId);
      }
    },
    /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives3.IconDownloadOutline16, { size: 14 }),
    /* @__PURE__ */ React.createElement("span", null, t("sessionLog"))
  ));
}

// client/mobile/fileGuard.ts
var GUARD_MSG = "\u624B\u673A\u4E0A\u65E0\u6CD5\u76F4\u63A5\u6253\u5F00\u7535\u8111\u4E0A\u7684\u6587\u4EF6";
var WS_LABELS = ["\u6DFB\u52A0\u5DE5\u4F5C\u533A", "\u6DFB\u52A0\u5DE5\u4F5C\u533A\u2026", "Add workspace", "Add workspace\u2026"];
var COPY_LABEL = "\u590D\u5236";
function looksLikeFilePath(text) {
  const t = (text ?? "").trim();
  if (t.length < 3 || t.length > 320) return false;
  if (/^(\/|~\/|\.\.?\/|[A-Za-z]:\\)/.test(t)) return true;
  if (/\/[\w.\-]+\.\w{1,12}$/.test(t)) return true;
  if (/[\w.\-]+\/[\w.\-]+\.\w{1,12}/.test(t)) return true;
  return false;
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const okCopy = document.execCommand("copy");
    ta.remove();
    return okCopy;
  } catch {
    return false;
  }
}
function startFileGuard(readFile) {
  let toastEl = null;
  let toastTimer = null;
  const showToast = (text) => {
    if (toastEl === null) {
      toastEl = document.createElement("div");
      toastEl.setAttribute("data-mobile-nav", "file-guard-toast");
      Object.assign(toastEl.style, {
        position: "fixed",
        left: "50%",
        bottom: "64px",
        transform: "translateX(-50%)",
        maxWidth: "84vw",
        zIndex: "9999",
        padding: "10px 14px",
        borderRadius: "10px",
        background: "rgba(20,22,28,.92)",
        color: "#fff",
        fontSize: "13px",
        lineHeight: "1.4",
        textAlign: "center",
        fontFamily: "inherit",
        boxShadow: "0 4px 16px rgba(0,0,0,.28)",
        pointerEvents: "none",
        opacity: "0",
        transition: "opacity .18s ease"
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    requestAnimationFrame(() => {
      if (toastEl !== null) toastEl.style.opacity = "1";
    });
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      if (toastEl !== null) toastEl.style.opacity = "0";
    }, 2600);
  };
  const onClick = (event) => {
    const target = event.target;
    if (target === null) return;
    const el = target.closest("button, a");
    if (el === null) return;
    if (!looksLikeFilePath(el.textContent)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast(GUARD_MSG);
  };
  document.addEventListener("click", onClick, true);
  const injectCopyButtons = () => {
    const links = document.querySelectorAll("button, a");
    links.forEach((el) => {
      if (el.getAttribute("data-mobile-nav-copy") === "1") return;
      const txt = (el.textContent ?? "").trim();
      if (!looksLikeFilePath(txt)) return;
      el.setAttribute("data-mobile-nav-copy", "1");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-mobile-nav", "copy-file");
      btn.textContent = COPY_LABEL;
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const filePath = (el.textContent ?? "").trim();
        btn.disabled = true;
        btn.textContent = "\u2026";
        try {
          const res = await readFile(filePath);
          if (!res?.ok) {
            showToast(res?.error?.message ?? "\u590D\u5236\u5931\u8D25");
            return;
          }
          const content = res.value?.content ?? "";
          const copied = await copyText(content);
          if (copied) {
            const kb = Math.max(1, Math.round((res.value?.size ?? content.length) / 1024));
            showToast(`\u5DF2\u590D\u5236\u6587\u4EF6\u5185\u5BB9\uFF08${kb} KB\uFF09`);
          } else {
            showToast("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9");
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : "\u590D\u5236\u5931\u8D25");
        } finally {
          btn.disabled = false;
          btn.textContent = COPY_LABEL;
        }
      });
      el.parentElement?.insertBefore(btn, el.nextSibling);
    });
  };
  injectCopyButtons();
  const copyObserver = new MutationObserver(() => injectCopyButtons());
  copyObserver.observe(document.body, { childList: true, subtree: true });
  const hideWsEntries = () => {
    const checkOne = (node) => {
      if (node.nodeType !== 1) return;
      const el = node;
      const txt = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
      if (WS_LABELS.includes(txt)) {
        el.style.display = "none";
        el.setAttribute("data-mobile-nav-hide", "add-workspace");
      }
    };
    const sel = '[role="menuitem"],[role="option"],li,button,a';
    document.querySelectorAll(sel).forEach(checkOne);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          checkOne(n);
          n.querySelectorAll?.(sel).forEach(checkOne);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  };
  const disconnectWs = hideWsEntries();
  return () => {
    document.removeEventListener("click", onClick, true);
    copyObserver.disconnect();
    disconnectWs();
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastEl?.remove();
  };
}

// client/mobile/mobile.css.ts
var MOBILE_CSS = `
/* ---------- base control styles (rendered at any width, hidden where unused) ---------- */

[data-mobile-nav="toggle"],
[data-mobile-nav="files"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
[data-mobile-nav="toggle"]:hover,
[data-mobile-nav="files"]:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06));
}
[data-mobile-nav="toggle"]:focus-visible,
[data-mobile-nav="files"]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4f6ef7);
  outline-offset: 1px;
}

/* Drawer footer actions: the relocated Session log download plus the Files
   action that opens the dsh-web-ui explorer sheet. */
[data-mobile-nav="drawer-actions"] {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
/* \u5BBF\u4E3B\u6CA1\u6709 aionui explorer \u5217\uFF08\u5B98\u65B9 DSH \u65E0 dsh-web-ui\uFF0Cissue #48\uFF09\u65F6\u9690\u85CF
   \u79FB\u52A8\u7AEF\u300C\u6587\u4EF6\u6D4F\u89C8\u300D\u5165\u53E3\uFF08header \u56FE\u6807 + drawer footer \u9879\uFF09\u2014\u2014\u4E0D\u7136\u70B9\u4E86\u6CA1\u53CD\u5E94\u3002 */
[data-mobile-nav-explorer="0"] [data-mobile-nav="files"],
[data-mobile-nav-explorer="0"] [data-mobile-nav="explorer"] {
  display: none !important;
}
[data-mobile-nav="session-log"],
[data-mobile-nav="explorer"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .12));
  border-radius: 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
[data-mobile-nav="session-log"]:hover:not(:disabled),
[data-mobile-nav="explorer"]:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06));
}
[data-mobile-nav="session-log"]:disabled {
  color: var(--dsw-alias-label-dimmed, rgba(0, 0, 0, .35));
  cursor: default;
}

/* Floating fallback button (hero / blank phases without a session header).
   The top clears the camera band below the status bar; when the client has
   set viewport-fit=cover the safe-area inset moves it below the notch too. */
[data-mobile-nav="fab"] {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 72px);
  left: 10px;
  z-index: 21;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .12));
  border-radius: 50%;
  background: var(--dsw-alias-button-floating-fill, #ffffff);
  color: var(--dsw-alias-label-primary, inherit);
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .18);
  -webkit-tap-highlight-color: transparent;
}
[data-mobile-nav="fab"]:hover {
  background: var(--dsw-alias-button-floating-hover, rgba(0, 0, 0, .08));
}
[data-mobile-nav="fab"]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4f6ef7);
  outline-offset: 2px;
}

/* Dimmed backdrop under the open drawer; above every column, below the drawer.
   pointer-events: none \u2014\u2014 \u70B9\u51FB\u7A7F\u900F\uFF08issue #38\uFF09\uFF1Abackdrop \u53EA\u8D1F\u8D23\u89C6\u89C9\u538B\u6697\uFF0C
   \u4E0D\u62A2\u70B9\u51FB\u3002\u5173\u95ED\u62BD\u5C49\u6539\u7531 MobileNavOverlay \u7684 document \u7EA7\u300C\u62BD\u5C49\u5916\u70B9\u51FB\u300D\u76D1\u542C\u5904\u7406
   \uFF08\u7B49\u4EF7\u4E8E\u539F\u6765\u7684\u70B9\u51FB\u906E\u7F69\u5173\u95ED\uFF0C\u4E14\u62BD\u5C49\u5185\u70B9\u51FB\u4E0D\u518D\u88AB backdrop \u5403\u6389\uFF09\u3002 */
[data-mobile-nav="backdrop"] {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(0, 0, 0, .45);
  pointer-events: none;
  animation: dsh-mobile-nav-fade .2s var(--ds-ease-in-out, ease-in-out);
  -webkit-tap-highlight-color: transparent;
}
@keyframes dsh-mobile-nav-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* Settings sheet entrance: the official dialog mounts with no animation at
   all, so it snaps in. Fade + slight rise/scale reads as a proper sheet. */
@keyframes dsh-mobile-nav-sheet-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
/* Preview sheet rise: the aionui preview column opens as a bottom sheet. */
@keyframes dsh-mobile-nav-sheet-up {
  from {
    opacity: 0;
    transform: translateY(28px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* ---------- mobile-only layout ---------- */

@media (max-width: 1023px) {
  /* --- Phone chrome ---
     The system status bar stays visible (no fullscreen). Two adjustments
     make it behave:
     - touch-action: manipulation kills double-tap-to-zoom (and the 300ms
       tap delay) while keeping pan and pinch zoom; the client also
       suppresses legacy-iOS gesturestart as a fallback.
     - With the client's viewport-fit=cover, env(safe-area-inset-top) is the
       status bar / notch height; the rules below push the app content below
       it so the status bar never covers anything. Off notched phones (or in
       a normal browser tab where the layout viewport already sits below the
       status bar) the inset is 0 and nothing shifts. */
  html,
  body {
    touch-action: manipulation !important;
  }

  /* AppFrame: the drawer takes the sidebar column out of grid flow, so the
     remaining in-flow items (center, details) land in tracks 1..2: give the
     center every pixel and keep the details track at zero. The top padding
     clears the status bar / notch for every in-flow surface (session header,
     messages, composer); the absolutely-positioned drawer is unaffected (its
     containing block is the frame's padding box, i.e. still the frame top). */
  [data-mobile-nav="frame"] {
    position: relative !important;
    grid-template-columns: minmax(0, 1fr) 0 0 !important;
    padding-top: env(safe-area-inset-top, 0px) !important;
  }

  /* \u4E3B\u5185\u5BB9\u5217\uFF08\u7B2C 2 \u4E2A\u7F51\u683C\u5B50\u5143\u7D20\uFF09\u5728\u5B98\u65B9\u6837\u5F0F\u91CC\u6709\u663E\u5F0F grid-column: 2\u2014\u2014
     \u7F51\u683C\u88AB\u538B\u7F29\u6210 [1fr, 0, 0] \u540E\u5B83\u4F1A\u843D\u5728 0px \u7684\u7B2C 2 \u8F68\uFF0C\u6574\u4E2A\u4E3B\u754C\u9762\u88AB\u6324\u51FA
     \u89C6\u53E3\uFF08\u53EA\u5269\u80CC\u666F\u56FE\uFF09\u3002\u5FC5\u987B\u663E\u5F0F\u628A\u5B83\u62C9\u56DE\u7B2C 1 \u8F68\uFF08issue #5\uFF09\u3002
     \u7B2C 3 \u5217\uFF08details\uFF09\u4FDD\u6301 0 \u8F68\u5373\u53EF\uFF0C\u65E0\u9700\u5904\u7406\u3002 */
  [data-mobile-nav="frame"] > :nth-child(2) {
    grid-column: 1 !important;
    grid-row: 1 !important;
    min-width: 0 !important;
  }

  /* The sidebar column (first grid child) becomes a left drawer. The drawer
     hugs the sidebar content exactly (the wide sidebar carries an inline
     width, ~280px): a fixed 92vw box would leave a white strip where the
     container background shows beside the content.
     Closed state: translateX(-110%) \u2014 more than -100% of the max-content
     width \u2014 guarantees the whole drawer (and its shadow, had it one) leaves
     the viewport. A mere -100% leaves a sliver on screen; -105% (as used
     before) left 14px of the drawer plus a long 32px-blur shadow gradient
     visible along the left edge of the main UI. No box-shadow at all: the
     dimmed backdrop already separates drawer from content.
     Z-index note: the backdrop renders inside the shell's overlay layer
     ([data-shell-overlay]), which forms its own stacking context. Third-party
     plugins can force that layer up with !important (dsh-update-checker sets
     it to 500), and when the layer outranks the drawer, the backdrop paints
     ABOVE the drawer and swallows every tap \u2014 the drawer opens but no row
     can be pressed (every tap just closes it). The drawer must therefore
     outrank any such raise.
     1200 (was 600) clears the mobile layers shipped by
     @linxin666/dsh-web-ui-all \u2014 its sidebar pane is z-index 1100, its
     details pane 1000 and its full-screen frame ::after mask 1050 (issue
     #67: that mask sat on top of the 600 drawer and ate every tap). Still
     far under the fixed-position banners/toasts (z 9999) that float at the
     viewport level. */
  [data-mobile-nav="frame"] > :first-child {
    position: absolute !important;
    inset: 0 auto 0 0 !important;
    width: max-content !important;
    max-width: 92vw !important;
    z-index: 1200 !important;
    transform: translateX(-110%);
    transition: transform .28s var(--ds-ease-in-out, ease-in-out);
    background: var(--dsw-alias-bg-base, #ffffff);
    /* Keep the drawer's own content below the status bar / notch: the drawer
       spans the full frame height (its absolute containing block is the
       frame's padding box, so the frame's own safe-area padding does NOT
       reach it). The drawer background paints the status-bar strip, which
       the client's theme-color meta matches, so the strip reads seamless. */
    padding-top: env(safe-area-inset-top, 0px) !important;
    /* Kill the official sidebarCol right border: with the backdrop the edge
       reads cleanly, and the settings dialog (width:100% of this box) stays
       pixel-flush with the drawer. */
    border-right: none !important;
  }

  /* Expanded state (frame without data-sidebar-collapsed) slides the drawer in.
     The open state must be transform:none \u2014 NOT translateX(0): an identity
     transform still makes the drawer the containing block for fixed-position
     descendants (the settings dialog's .VOzbGW_overlay is portaled into the
     sidebar DOM). With the identity transform the wide settings sheet
     (100vw-16) overflows the 280px drawer, the dialog's focus scrolls the
     overflow:hidden drawer to scrollLeft=102, and every static child (plus the
     fixed overlay) shifts 102px off-screen. With transform:none the overlay is
     viewport-anchored: it dims the full screen and the sheet sits at left:8. */
  [data-mobile-nav="frame"]:not([data-sidebar-collapsed]) > :first-child {
    transform: none !important;
  }

  /* Kill a competing full-screen mask (issue #67).
     @linxin666/dsh-web-ui-all ships its own mobile drawer, and part of it is

       [data-dsh-frame]:not([data-sidebar-collapsed])::after {
         content: ""; position: fixed; inset: 0; z-index: 1050;
         background: rgb(0 0 0 / 24%);
       }

     The pseudo-element belongs to the frame we already mark, and the frame
     carries only "position: relative" with z-index auto \u2014 no stacking context
     \u2014 so this mask competes with the drawer in the parent stacking context
     and, at 1050, paints over it. It covers the whole viewport, so every tap
     on a session row lands on the mask instead: the drawer opens but nothing
     inside it can be pressed, and the page behind cannot be scrolled.
     Removing it is safe: the mobile stylesheet already renders its own
     backdrop, and tapping outside the drawer is handled in JS.

     The attribute selector is repeated on purpose. Their rule has the same
     specificity (0,2,1) once ours is written the obvious way, and plugin
     stylesheets are injected in load order, so a tie would be decided by
     whichever plugin happened to load last. Doubling the attribute makes it
     (0,3,1) and deterministic. */
  [data-mobile-nav="frame"][data-mobile-nav="frame"]:not([data-sidebar-collapsed])::after {
    content: none !important;
  }

  /* Drag handles are useless on touch and would float over the drawer. */
  [data-side="sidebar"],
  [data-side="details"] {
    display: none !important;
  }

  /* --- Conversation text on mobile ---
     The official message flow keeps desktop's 32px side gutters and 16px
     type. On a phone: shrink the type a notch and widen the lines by
     trimming the gutters (the sidebar drawer list keeps its size). The
     flow's scroll container is the only _scroll element holding markdown
     <p> paragraphs \u2014 the composer's own scroll (textarea) is excluded
     via :has(p). */
  /* The official main scroll body reserves scrollbar-gutter for desktop
     scrollbars (8px), which shoves every column off-center on a phone.
     Classic desktop scrollbars (Edge/Chrome) also occupy ~8-17px in a
     phone-sized viewport, shifting the column further. Mobile scrolling
     is touch/wheel, so remove the scrollbar entirely on phones: the
     column is then exactly centered in every browser. */
  [data-phase] [class$="_scrollBody"] {
    scrollbar-gutter: auto !important;
    scrollbar-width: none !important;
  }
  [data-phase] [class$="_scrollBody"]::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
  /* Message action rows (copy / run-time badges) can overflow the right
     edge on narrow screens \u2014 keep them inside the message width. */
  [data-phase] [class$="_actions"] {
    overflow: hidden !important;
  }
  [data-phase] [class$="_actions"] [class$="_timeEnd"] {
    flex: 0 1 auto !important;
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }

  [data-phase] [class$="_scroll"]:has(p) {
    padding-left: 20px !important;
    padding-right: 20px !important;
    font-size: 15px !important;
  }
  /* The official markdown styles set an explicit 16px on paragraphs and
     list items, so the container's inherited 15px is not enough. User
     messages render their text in a div whose class carries _text_
     (16px too) \u2014 cover it as well. */
  [data-phase] [class$="_scroll"]:has(p) p,
  [data-phase] [class$="_scroll"]:has(p) li,
  [data-phase] [class$="_scroll"]:has(p) [class*="_text_"] {
    font-size: 15px !important;
  }

  /* Keep DSH's own process disclosures and their expand/collapse behaviour,
     but remove desktop-sized vertical breathing room between consecutive
     context, Skill, and system-prompt entries. */
  [data-phase] [data-turn-process] {
    height: 28px !important;
    padding-bottom: 4px !important;
    margin-bottom: 4px !important;
  }
  [data-phase] [data-turn-process][data-open] {
    margin-bottom: 4px !important;
  }
  [data-phase] [data-disclosure-row] {
    min-height: 24px !important;
  }
  [data-phase] :is([data-context-injection-body], [data-system-prompt-body]) {
    margin-top: 2px !important;
  }

  /* --- Composer bottom row on mobile ---
     Keep add, permission, model, reasoning and send controls on one line at
     the Honor 50's 360px CSS viewport. DSH's stable data-composer-card hook
     survives the editor's textarea -> contenteditable migration. */
  [data-phase] [data-composer-card="true"] > [class$="_row"] {
    flex-wrap: nowrap !important;
    gap: 6px !important;
  }
  [data-phase] [data-composer-card="true"] > [class$="_row"] > :first-child {
    gap: 8px !important;
    min-width: 0 !important;
  }
  [data-phase] [data-composer-card="true"] > [class$="_row"] > :first-child > :nth-child(2) {
    flex: 0 1 auto !important;
    min-width: 0 !important;
  }
  [data-phase] [data-composer-card="true"] > [class$="_row"] > :last-child {
    flex: 1 1 0 !important;
    min-width: 0 !important;
    gap: 6px !important;
  }

  /* --- Composer popups as bottom sheets on mobile ---
     Two composer-anchored popups break on phones (field: bottom + side
     cut, only part of the popup visible):
     1. the model pill menu ([role=menu], max 360px, opens upward from the
        pill inside the composer card);
     2. the "/" command palette (max 320px card with the search box \u2014 it
        hosts the /model popupSelect list: search + provider-grouped rows).
     Both are position:absolute INSIDE the conversation scrollBody
     (overflow:hidden) and the shell center column (overflow:hidden), so
     the scroll containers clip them mid-list. Forensics showed neither
     layer creates a containing block (no transform/contain/will-change),
     so on mobile we snap whichever popup is open to a viewport-anchored
     sheet: fixed positioning escapes the scroll clip entirely, width is
     deterministic, safe-area keeps it off the gesture bar. A transient
     picker covering the composer is standard mobile UX; selection or an
     outside tap still dismisses it. */
  [data-phase] [class$="_root"]:has(> [aria-haspopup="menu"]) > [role="menu"],
  [data-phase] [class$="_card"]:has(> [class$="_search"]) {
    position: fixed !important;
    left: 12px !important;
    right: 12px !important;
    top: auto !important;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 12px) !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    max-height: min(65vh, 480px) !important;
    max-height: min(65dvh, 480px) !important;
    z-index: 130 !important;
    border-radius: 14px !important;
    box-shadow: 0 -4px 28px rgba(0, 0, 0, .18) !important;
  }

  /* --- Session header on mobile ---
     Layout goal: [toggle] [session title] [mode badge] in a row, with the
     Session log capsule removed from the header (relocated to the drawer
     footer). Stable structural hooks only:
       [data-phase] header                     the session header element
       header > :first-child                   titleRow (titleCluster + utilities)
       header > :first-child > :last-child     headerUtilities (Session log seat) */
  [data-phase] header {
    padding: 8px 12px 0 !important;
  }
  /* The directory and Files controls are absolutely positioned, so reserve
     their lanes and let the title use the remaining width without squeezing. */
  [data-phase] header > :first-child {
    min-height: 36px !important;
    padding: 0 32px !important;
  }
  [data-phase] header [class$="_titleCluster"],
  [data-phase] header [class$="_crumbs"] {
    min-width: 0 !important;
  }
  [data-phase] header button[class*="_crumb"] {
    max-width: calc(100vw - 104px) !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }
  /* The directory toggle sits at the far left of the header (the header
     is position:relative; the data-slot wrappers are display:contents). */
  [data-mobile-nav="toggle"] {
    position: absolute !important;
    left: 8px !important;
    top: 12px !important;
    z-index: 2 !important;
  }
  /* The Files action sits at the FAR RIGHT of the header so it reads as a
     distinct control from the directory toggle on the left (which opens
     the history sidebar). */
  [data-mobile-nav="files"] {
    position: absolute !important;
    left: auto !important;
    right: 8px !important;
    top: 12px !important;
    z-index: 2 !important;
  }
  /* Session log download: gone from the header row on mobile (the utilities
     seat holds only the session-log-export capsule). */
  [data-phase] header > :first-child > :last-child {
    display: none !important;
  }

  /* --- Settings dialog on mobile ---
     Desktop: 800px two-column flex (188px nav + content). Mobile: a
     near-full-width sheet \u2014 nav tabs wrap into rows on top, option rows
     stay horizontal (title+description left, control right). Structural
     selectors are scoped to the unique aria-modal dialog; every
     settings-specific rule is gated with
     :has(> :first-child > :last-child > button) \u2014 the settings nav tab
     list holds <button> tabs, so the transient export dialog (the same
     primitives Modal, header(title+close)+description+body) keeps its
     official centered card layout. Requires :has() support
     (Chromium 105+, 2022). */
  [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])) {
    position: absolute !important;
    left: 8px !important;
    /* Fixed top (no translateY): a transform on the panel combined with the
       panel overflowing the max-content drawer shifts the fixed overlay's
       coordinate frame, dragging the whole sidebar content off-screen. The
       safe-area inset keeps the sheet below the status bar / notch. */
    top: calc(env(safe-area-inset-top, 0px) + 12px) !important;
    width: calc(100vw - 16px) !important;
    max-width: calc(100vw - 16px) !important;
    /* Height follows the content (no dead space under a short page); it
       caps at 100dvh-24 (less the safe-area top) and the options area
       scrolls only then. */
    height: auto !important;
    max-height: min(800px, calc(100vh - 24px - env(safe-area-inset-top, 0px))) !important;
    max-height: min(800px, calc(100dvh - 24px - env(safe-area-inset-top, 0px))) !important;
    flex-direction: column !important;
    border-radius: 14px !important;
    animation: dsh-mobile-nav-sheet-in .22s var(--ds-ease-out, ease-in-out);
  }
  /* The settings sheet's dimmed mask fades in with the panel (the mask is
     the first child of the overlay that directly contains the sheet). */
  :has(> [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"]))) > :first-child {
    animation: dsh-mobile-nav-fade .18s var(--ds-ease-out, ease-in-out);
  }
  @media (prefers-reduced-motion: reduce) {
    [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])),
    :has(> [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"]))) > :first-child {
      animation: none !important;
    }
  }
  /* The export dialog (not the settings sheet) must never overflow the
     viewport: the official centered card can be wider than 390px. */
  [aria-modal="true"]:not(:has(> :first-child > :last-child > button)) {
    max-width: calc(100vw - 32px) !important;
  }
  /* Nav bar: hide the "Settings" caption (redundant on a full-width sheet)
     and wrap the tab list so every tab is visible \u2014 a horizontal scroll cut
     the last tab ("Plugins") off with no affordance to scroll. */
  [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])) > :first-child {
    width: 100% !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 6px !important;
    padding: 10px 12px 8px !important;
  }
  [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])) > :first-child > :first-child {
    display: none !important;
  }
  [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])) > :first-child > :last-child {
    flex-direction: row !important;
    flex-wrap: wrap !important;
    width: 100% !important;
    gap: 6px !important;
    overflow: visible !important;
  }
  /* Content toolbar (Open configuration file + close): spread to the edges
     instead of clustering right with a dead zone on the left. The toolbar
     children carry official auto-margins that would defeat space-between,
     so neutralize them. The close button gets a round tappable base so it
     reads as its own control, not part of the outline button. */
  [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])) > :last-child > :first-child {
    justify-content: space-between !important;
    align-items: center !important;
    padding: 0 12px !important;
    min-height: 40px !important;
  }
  [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])) > :last-child > :first-child > * {
    margin-left: 0 !important;
    margin-right: 0 !important;
  }
  [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])) > :last-child > :first-child > :last-child {
    width: 32px !important;
    height: 32px !important;
    border-radius: 50% !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06)) !important;
  }
  /* Appearance mode cards: the official cube row renders three tall
     vertical cards (~268px) that eat half the sheet. Turn them into a
     compact horizontal trio (icon + label inline, equal widths).
     Relies on the official cube-row class name of this version. */
  [aria-modal="true"] [class$="_cubeRow"] {
    gap: 6px !important;
  }
  [aria-modal="true"] [class$="_cubeRow"] > * {
    flex: 1 1 0 !important;
    flex-direction: row !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 6px !important;
    padding: 10px 8px !important;
    min-height: 0 !important;
  }
  /* Content: the options scroll area gets bottom breathing room so the last
     row never sits flush against the sheet's rounded corner. */
  [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])) > :last-child {
    flex: 1 1 auto !important;
    min-height: 0 !important;
  }
  [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])) > :last-child > :last-child {
    padding: 0 12px 24px !important;
  }

  /* ---------- dsh-web-ui family compatibility ----------
     The linxin666 plugin suite extends the shell frame directly:
       - aionui-panel appends two trailing grid columns (explorer / preview)
         plus absolute drag handles to [data-dsh-frame]; its 5-track inline
         grid is already overridden above, but the handles and columns would
         still float over the main UI. On mobile the columns leave the grid
         as floating bottom sheets and keep their own visibility state \u2014
         the suite's collapse chevron / preview tabs still work, so no
         feature is lost. The task-board / ssh plugins inject sidebar
         entries and center-column takeover panels; the entries need
         spacing and the kanban needs scrollable columns. */

  /* Touch devices: the drag handles are useless \u2014 the floating expand
     button is the opener. */
  .aionui-explorer-handle,
  .aionui-preview-handle {
    display: none !important;
  }

  /* Shared base: both columns leave the grid as floating panels. The
     explorer is gated shut by default (its own persisted expanded state
     must never cover the mobile UI on load); the header Files action opens
     it via the frame marker below, and the sheet's own collapse chevron
     clears it. Preview stays owned by the suite (hidden while no tab is
     open). The per-column rules below override the geometry. */
  [data-aionui-explorer-col],
  [data-aionui-preview-col] {
    position: fixed !important;
    z-index: 55 !important;
    background: var(--aion-bg-base, #ffffff) !important;
    border-left: none !important;
  }
  /* Explorer (file tree) bottom sheet: bottom edge aligned exactly with
     the composer card's bottom line \u2014 the card sits 36px above the
     viewport bottom (8px composer padding + the 28px stats strip below
     the card), so the sheet uses the same 36px bottom offset. */
  [data-aionui-explorer-col] {
    visibility: hidden !important;
    left: 8px !important;
    right: 8px !important;
    top: auto !important;
    bottom: 36px !important;
    width: auto !important;
    height: min(55dvh, 460px) !important;
    max-height: calc(100dvh - 44px) !important;
    border-radius: 14px !important;
    overflow: hidden !important;
    box-shadow: 0 -4px 28px rgba(0, 0, 0, .18) !important;
    animation: dsh-mobile-nav-sheet-up .24s var(--ds-ease-out, ease-in-out) !important;
  }
  /* Preview (file content) bottom sheet. Gated shut by default: the suite
     persists open preview tabs in localStorage and restores them on load,
     which would pop the sheet over the fresh UI. The client only sets the
     frame marker after the user taps a file row in the explorer; the
     suite's own collapse chevron clears it via the visibility watcher. */
  [data-aionui-preview-col] {
    visibility: hidden !important;
    position: fixed !important;
    left: 8px !important;
    right: 8px !important;
    top: auto !important;
    bottom: 40px !important;
    width: auto !important;
    height: min(50dvh, 420px) !important;
    max-height: calc(100dvh - 48px) !important;
    border-radius: 14px !important;
    overflow: hidden !important;
    box-shadow: 0 -4px 28px rgba(0, 0, 0, .18) !important;
    z-index: 56 !important;
    animation: dsh-mobile-nav-sheet-up .24s var(--ds-ease-out, ease-in-out) !important;
  }
  /* User-opened preview sheet (frame marker, set on file-row tap). */
  [data-mobile-nav="frame"][data-aionui-preview-open] [data-aionui-preview-col] {
    visibility: visible !important;
  }
  /* The Files action opens the explorer sheet (frame marker). */
  [data-mobile-nav="frame"][data-aionui-explorer-open] [data-aionui-explorer-col] {
    visibility: visible !important;
  }
  /* The open drawer must never sit under a sheet: while the frame is in the
     narrow-expanded state both sheets yield (later in the file than the
     open marker rule, so it wins at equal specificity). */
  [data-mobile-nav="frame"]:not([data-sidebar-collapsed]) [data-aionui-explorer-col],
  [data-mobile-nav="frame"]:not([data-sidebar-collapsed]) [data-aionui-preview-col] {
    visibility: hidden !important;
  }
  /* The suite's own expand button reads the store state we bypass on
     mobile \u2014 hide it; the header Files action is the opener. */
  .aionui-floating-expand {
    display: none !important;
  }

  /* dsh-web-ui sidebar entries (task board / ssh) sit flush against each
     other \u2014 give the injected rows breathing room. */
  button[data-dsh-taskboard-entry],
  button[data-dsh-ssh-entry] {
    margin-bottom: 8px !important;
  }

  /* Task board: five kanban columns at minmax(0,1fr) crush into ~78px phone
     strips. Give every column a usable minimum and let the row scroll. */
  [data-dsh-taskboard-board] > [class$="_columns"] {
    grid-template-columns: repeat(5, minmax(240px, 1fr)) !important;
    overflow-x: auto !important;
  }
  /* The floating button must not float over a takeover panel (task board /
     ssh own the center column while active). */
  html[data-dsh-taskboard-active] [data-mobile-nav="fab"],
  html[data-dsh-ssh-active] [data-mobile-nav="fab"],
  html[data-dsh-taskboard-active] [data-mobile-nav="backdrop"],
  html[data-dsh-ssh-active] [data-mobile-nav="backdrop"] {
    display: none !important;
  }
  /* Board header: let the search field take the slack instead of squeezing
     the action buttons. */
  [data-dsh-taskboard-board] > [class$="_boardHeader"] [class$="_search"] {
    flex: 1 1 auto !important;
    min-width: 80px !important;
  }

  /* ---------- dsh-web-ui polish: plugin market search ----------
     The market tab row (Discover / Themes / Installed + the plugin search
     box) is a no-wrap flex: at 390px the tabs plus the ~218px search box
     (~475px total) overflow the ~334px sheet and the search box runs off
     the right edge of the screen (it also forces a horizontal scrollbar on
     the sheet's options area). Let the row wrap: the tabs keep the first
     line and the search box gets its own full-width second line. */

  [aria-modal="true"] [class$="_tabs"] {
    flex-wrap: wrap !important;
    row-gap: 8px !important;
  }
  [aria-modal="true"] [class$="_searchInline"] {
    flex: 1 1 100% !important;
    width: 100% !important;
    max-width: 100% !important;
  }

  /* ---------- dsh-usage-stats polish: usage & balance panel ----------
     The panel's stats row shows three token counters side by side
     (today / month / total). The counters use tabular nowrap figures whose
     min-content width overflows the ~336px panel body on a phone: figures
     clip at the row's edges and the panel grows a horizontal scrollbar.
     Stack the three counters vertically \u2014 full-width rows, so the figures
     always fit. */

  [class*="usg_"][class$="_statsRow"] {
    flex-direction: column !important;
  }
  [class*="usg_"][class$="_stat"] {
    flex: 0 0 auto !important;
    width: 100% !important;
    min-width: 0 !important;
  }

  /* ---------- dsh-web-ui polish: settings sheet ----------
     The official dialog is a desktop two-column form; on a phone the
     label/control split leaves a huge dead gap and long descriptions wrap
     into tall stacks. Stack each row (text above, control full-width) and
     compact the nav tabs into an even wrap. */

  /* Nav tabs: a stable 3-per-row grid (two clean rows instead of a ragged
     wrap) with tighter cells. */
  [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])) > :first-child > :last-child {
    display: grid !important;
    grid-template-columns: repeat(3, 1fr) !important;
    gap: 6px !important;
  }
  [aria-modal="true"] [class$="_navCell"] {
    padding: 6px 8px !important;
    gap: 6px !important;
    font-size: 13px !important;
    justify-content: flex-start !important;
  }
  [aria-modal="true"] [class$="_navCell"] svg {
    width: 14px !important;
    height: 14px !important;
    flex: none !important;
  }
  /* Setting rows: text on top, control below at full width. */
  [aria-modal="true"] [class$="_section"] [class$="_row"] {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 8px !important;
  }
  [aria-modal="true"] [class$="_section"] [class$="_row"] > :first-child {
    width: 100% !important;
    max-width: none !important;
  }
  [aria-modal="true"] [class$="_section"] [class$="_row"] > :last-child {
    width: 100% !important;
    max-width: none !important;
  }
  /* Appearance mode group: give the cube row a consistent bordered
     segmented look (the official borders differ per state). */
  [aria-modal="true"] [class$="_cubeRow"] > * {
    border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .12)) !important;
  }

  /* ---------- dsh-web-ui polish: explorer sheet ----------
     The aionui explorer was designed for a desktop side column: compact the
     header, search box and tree rows so a phone shows more entries, and pad
     the scroll bottom so the last row never sits flush on the edge. */

  [data-aionui-explorer-col] [class$="_tabBar"] {
    height: 36px !important;
  }
  [data-aionui-explorer-col] [class$="_tabBtn"],
  [data-aionui-explorer-col] [class$="_tabBtnActive"] {
    padding: 0 12px !important;
    font-size: 13px !important;
  }
  [data-aionui-explorer-col] [class$="_searchBox"] {
    height: 32px !important;
    font-size: 13px !important;
  }
  [data-aionui-explorer-col] [class$="_treeRow"] {
    height: 30px !important;
    font-size: 13px !important;
  }
  [data-aionui-explorer-col] [class$="_treeRow"] svg {
    width: 14px !important;
    height: 14px !important;
  }
  [data-aionui-explorer-col] [class$="_scrollArea"] {
    padding-bottom: 28px !important;
  }

  /* ---------- dsh-web-ui polish: drawer footer ----------
     The injected footer actions (Files + Session log) become two equal pill
     buttons instead of text-width capsules. */

  /* The official footerActions row also hosts the remote-web-ui entry
     row (two icon buttons); without wrapping the two groups squeeze each
     other on one line. Wrap so each group gets its own full-width row. */
  [data-mobile-nav="frame"] [class$="_footerActions"] {
    flex-wrap: wrap !important;
    gap: 6px !important;
  }
  [data-mobile-nav="drawer-actions"] {
    width: 100% !important;
  }
  [data-mobile-nav="drawer-actions"] > button {
    flex: 1 1 0 !important;
    padding: 0 8px !important;
    white-space: nowrap !important;
  }

  /* ---------- dsh-web-ui polish: floating pet ----------
     The whale-girl pet (dsh-pet) floats at the viewport corner with a
     persisted, draggable position. On phones the pet is scaled down so
     it does not dominate the screen; the plugin's own drag + persist
     still work (the position itself is left alone \u2014 the mobile default
     position is seeded via the pet API to just above the composer). */

  body > [class$="_float"]:has([class$="_sprite"][role="button"]) {
    transform: scale(.66);
    transform-origin: bottom right;
  }
  /* While a modal dialog (settings sheet / export) owns the screen the pet
     floats ABOVE it and covers the dialog content; modal semantics say the
     background is inert, so hide the pet for the modal's lifetime. */
  body:has([aria-modal="true"]) > [class$="_float"]:has([class$="_sprite"][role="button"]) {
    display: none !important;
  }

  /* ---------- dsh-web-ui polish: conversation stats line ----------
     The official session-status row (turns / steps / LLM time / TTFT /
     cache) is long. The client marks the exact row with
     [data-mobile-nav="stats"] (text-anchored, hashed classes can't be
     targeted). Layout: ONE fixed-height (28px) flex strip that scrolls
     horizontally \u2014 the full metrics stream stays reachable by swiping,
     the row never grows vertically, no ellipsis or fade, 12px gaps
     between metric groups, a 2px scrollbar as the swipe affordance. */

  [data-mobile-nav="stats"] {
    display: flex !important;
    flex-flow: row nowrap !important;
    align-items: center !important;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: 28px !important;
    min-height: 28px !important;
    max-height: 28px !important;
    box-sizing: border-box !important;
    white-space: nowrap !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    scrollbar-width: thin !important;
    scrollbar-color: var(--dsw-alias-border-l1, rgba(0, 0, 0, .28)) transparent !important;
    padding: 0 0 4px !important;
    line-height: 20px !important;
    font-size: 12px !important;
  }
  [data-mobile-nav="stats"]::-webkit-scrollbar {
    height: 2px !important;
  }
  [data-mobile-nav="stats"]::-webkit-scrollbar-thumb {
    background: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, .3)) !important;
    border-radius: 2px !important;
  }
  [data-mobile-nav="stats"]::-webkit-scrollbar-track {
    background: transparent !important;
  }
  [data-mobile-nav="stats"] > * {
    display: flex !important;
    flex: 0 0 auto !important;
    flex-flow: row nowrap !important;
    align-items: center !important;
    width: max-content !important;
    min-width: max-content !important;
    max-width: none !important;
    white-space: nowrap !important;
    margin-right: 12px !important;
    padding: 0 !important;
  }
  [data-mobile-nav="stats"] > *:last-child {
    margin-right: 0 !important;
  }
  [data-mobile-nav="stats"] * {
    white-space: nowrap !important;
  }

  /* ---------- hero composer on mobile ----------
     The official hero card carries a 2-line textarea plus a tall tool row,
     which reads oversized on a phone. Tighten the empty-state rhythm: keep
     the official centered hero, shrink the textarea line box, slim the card
     padding and the tool row, and close the gap under the headline. */

  [data-phase="hero"] [class$="_card"]:has(textarea) {
    padding-top: 6px !important;
    gap: 8px !important;
  }
  /* The official composer autosizes the textarea and writes an inline
     height (2 lines on the hero empty state) on the textarea's scroll/grow
     wrappers. :placeholder-shown lets us collapse the EMPTY state to one
     line with !important; as soon as the user types, the pseudo-class no
     longer matches and the autosizer's inline height takes over again \u2014 so
     multi-line growth keeps working. */
  [data-phase="hero"] textarea:placeholder-shown {
    height: 28px !important;
  }
  [data-phase="hero"] [class$="_card"]:has(textarea:placeholder-shown) > [class$="_scroll"],
  [data-phase="hero"] [class$="_card"]:has(textarea:placeholder-shown) [class$="_grow"] {
    height: 28px !important;
  }
  [data-phase="hero"] [class$="_card"]:has(textarea) > [class$="_row"] {
    padding-top: 2px !important;
  }
  [data-phase="hero"] [class$="_headline"] {
    line-height: 1.15 !important;
    margin-bottom: 0 !important;
  }
  [data-phase="hero"] [class$="_stack"] {
    gap: 0 !important;
  }

  /* ---------- \u9690\u85CF\u300C\u6DFB\u52A0\u5DE5\u4F5C\u533A\u300D\u5165\u53E3\uFF08\u624B\u673A\u4E0A\u914D\u5DE5\u4F5C\u533A\u65E0\u610F\u4E49\uFF0Cissue #17 \u4FEE\u6B63\uFF09 ----------
     \u56FE\u6807\u6309\u94AE\u7684 aria-label \u968F\u8BED\u8A00\u53D8\u5316\uFF08zh\u300C\u6DFB\u52A0\u5DE5\u4F5C\u533A\u300D/ en\u300CAdd workspace\u300D\uFF09\uFF0C
     \u4E24\u79CD\u90FD\u8986\u76D6\uFF1B\u4E0B\u62C9\u83DC\u5355\u91CC\u7684\u300C\u6DFB\u52A0\u5DE5\u4F5C\u533A\u2026\u300D\u9879\u7531 fileGuard.ts \u7684 MutationObserver
     \u6309\u6587\u6848\u515C\u5E95\u9690\u85CF\uFF08CSS \u9009\u4E0D\u5230\u7EAF\u6587\u672C\u8282\u70B9\uFF09\u3002\u53EA\u5728\u7A84\u5C4F\u751F\u6548\u2014\u2014\u684C\u9762\u7AEF\u7167\u5E38\u4FDD\u7559\u3002 */
  button[aria-label="\u6DFB\u52A0\u5DE5\u4F5C\u533A"],
  button[aria-label="\u6DFB\u52A0\u5DE5\u4F5C\u533A\u2026"],
  button[aria-label="Add workspace"],
  button[aria-label="Add workspace\u2026"] {
    display: none !important;
  }

  /* ---------- \u6587\u4EF6\u94FE\u63A5\u65C1\u7684\u300C\u590D\u5236\u300D\u6309\u94AE\uFF08issue #17\uFF1A\u590D\u5236\u6587\u4EF6\u5185\u5BB9\uFF09 ----------
     \u6302\u5728\u5BF9\u8BDD\u91CC\u7684\u6587\u4EF6\u94FE\u63A5\uFF08<button>/<a>\uFF0C\u6587\u6848\u5373\u8DEF\u5F84\uFF09\u7D27\u90BB\u4F4D\u7F6E\uFF0C\u7531 fileGuard.ts
     \u6CE8\u5165\u3002\u53EA\u5C4F\u5185\u53EF\u89C1\uFF1A\u684C\u9762\u7AEF\u4E0D\u6CE8\u5165\u3001\u4E0D\u663E\u793A\uFF1B\u8FD9\u91CC\u518D\u515C\u5E95\u4E00\u5C42\uFF0C\u907F\u514D\u4EFB\u4F55\u9057\u6F0F\u3002
     \u6587\u4EF6\u94FE\u63A5\u591A\u4E3A inline\uFF0C\u6309\u94AE\u7528 inline-flex \u7D27\u8DDF\u5176\u540E\u5373\u53EF\u3002 */
  [data-mobile-nav="copy-file"] {
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    margin-left: 6px !important;
    vertical-align: baseline !important;
    height: 22px !important;
    padding: 0 8px !important;
    border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .14)) !important;
    border-radius: 6px !important;
    background: var(--dsw-alias-bg-layer-1, #fff) !important;
    color: var(--dsw-alias-label-primary, inherit) !important;
    font-family: inherit !important;
    font-size: 11px !important;
    line-height: 1 !important;
    cursor: pointer !important;
    -webkit-tap-highlight-color: transparent !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .12) !important;
  }
  [data-mobile-nav="copy-file"]:active {
    background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06)) !important;
  }
  [data-mobile-nav="copy-file"][disabled] {
    opacity: .55 !important;
    cursor: default !important;
  }
}

/* ---------- desktop: the mobile controls must never appear ---------- */

@media (min-width: 1024px) {
  [data-mobile-nav="toggle"],
  [data-mobile-nav="files"],
  [data-mobile-nav="fab"],
  [data-mobile-nav="backdrop"],
  [data-mobile-nav="session-log"],
  [data-mobile-nav="explorer"],
  [data-mobile-nav="drawer-actions"] {
    display: none !important;
  }
}

`;

// client/mobile/locales.ts
var NS = "mobileNav";
var zh = {
  "open": "\u6253\u5F00\u76EE\u5F55",
  "close": "\u6536\u8D77\u76EE\u5F55",
  "backdrop": "\u70B9\u51FB\u5173\u95ED\u76EE\u5F55",
  "sessionLog": "\u5BFC\u51FA\u4F1A\u8BDD\u65E5\u5FD7",
  "files": "\u6587\u4EF6\u6D4F\u89C8"
};
var en = {
  "open": "Open directory",
  "close": "Close directory",
  "backdrop": "Click to close directory",
  "sessionLog": "Session log",
  "files": "Files"
};

// client/mobile/layout-mode.mjs
function resolveLayout({ urlValue, stored, narrowMatch }) {
  const url = String(urlValue ?? "").trim();
  if (url === "desktop") return "desktop";
  if (url === "mobile") return "mobile";
  if (stored === "desktop" || stored === "mobile") return stored;
  return narrowMatch ? "mobile" : "desktop";
}
function persistLayoutFromUrl(urlValue) {
  if (typeof localStorage === "undefined") return "";
  const v = String(urlValue ?? "").trim();
  try {
    if (v === "desktop" || v === "mobile") localStorage.setItem("dsh-pocket.layout", v);
    else if (v === "auto" || v === "") localStorage.removeItem("dsh-pocket.layout");
  } catch {
  }
  try {
    const s = localStorage.getItem("dsh-pocket.layout");
    return s === "desktop" || s === "mobile" ? s : "";
  } catch {
    return "";
  }
}

// client/mobile/mobile-apply.tsx
function mobileApply(ctx) {
  const urlValue = new URL(window.location.href).searchParams.get("dsh-layout") ?? "";
  const narrowMQ = window.matchMedia("(max-width: 1023px)");
  const stored = persistLayoutFromUrl(urlValue);
  const layout = resolveLayout({ urlValue, stored, narrowMatch: narrowMQ.matches });
  document.body?.setAttribute("data-dsh-pocket-layout", layout);
  if (layout === "desktop") return;
  let narrow = narrowMQ;
  if (layout === "mobile") {
    narrow = { matches: true, addEventListener: () => {
    }, removeEventListener: () => {
    } };
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-mobile-nav: dictionaries");
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = "@dsh-external/dsh-mobile-nav";
    tag.dataset.pluginCss = "@dsh-external/dsh-mobile-nav/mobile.css";
    tag.textContent = MOBILE_CSS;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, "dsh-mobile-nav: styles");
  ctx.effect(() => {
    const viewport = document.querySelector('meta[name="viewport"]');
    const originalViewport = viewport?.content ?? "";
    const themeMeta = document.createElement("meta");
    themeMeta.name = "theme-color";
    const bodyBg = () => getComputedStyle(document.body).backgroundColor;
    const sync = () => {
      if (viewport !== null) viewport.content = "width=device-width, initial-scale=1, viewport-fit=cover";
      themeMeta.content = bodyBg();
      if (themeMeta.parentElement === null) document.head.appendChild(themeMeta);
    };
    const restore = () => {
      if (viewport !== null) viewport.content = originalViewport;
      themeMeta.remove();
    };
    const onGestureStart = (event) => event.preventDefault();
    if (narrow.matches) sync();
    const onChange = (event) => event.matches ? sync() : restore();
    narrow.addEventListener("change", onChange);
    const observer = new MutationObserver(() => {
      if (narrow.matches) themeMeta.content = bodyBg();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
    document.addEventListener("gesturestart", onGestureStart);
    return () => {
      narrow.removeEventListener("change", onChange);
      observer.disconnect();
      document.removeEventListener("gesturestart", onGestureStart);
      restore();
    };
  }, "dsh-mobile-nav: status bar theme + viewport + zoom guard");
  ctx.effect(() => {
    if (!narrow.matches) return () => {
    };
    const onChevronClick = (event) => {
      const target = event.target;
      if (target === null || !target.closest(".aionui-collapse-chevron")) return;
      document.querySelector('[data-mobile-nav="frame"]')?.removeAttribute("data-aionui-explorer-open");
    };
    document.addEventListener("click", onChevronClick, true);
    return () => document.removeEventListener("click", onChevronClick, true);
  }, "dsh-mobile-nav: aionui explorer close marker");
  ctx.effect(() => {
    if (!narrow.matches) return () => {
    };
    const frame = () => document.querySelector('[data-mobile-nav="frame"]');
    const check = () => {
      const has = document.querySelector("[data-aionui-explorer-col]") !== null;
      frame()?.setAttribute("data-mobile-nav-explorer", has ? "1" : "0");
    };
    check();
    const timer = window.setTimeout(check, 1500);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, "dsh-mobile-nav: explorer availability (issue #48)");
  ctx.effect(() => {
    if (!narrow.matches) return () => {
    };
    const frame = () => document.querySelector('[data-mobile-nav="frame"]');
    const onTap = (event) => {
      const target = event.target;
      if (target === null) return;
      if (target.closest('[data-aionui-explorer-col] [class$="_treeRow"]') === null) return;
      frame()?.setAttribute("data-aionui-preview-open", "");
    };
    const sync = () => {
      const pv = document.querySelector("[data-aionui-preview-col]");
      if (pv === null) return;
      if (getComputedStyle(pv).visibility === "hidden") frame()?.removeAttribute("data-aionui-preview-open");
    };
    document.addEventListener("click", onTap, true);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["style"] });
    sync();
    return () => {
      document.removeEventListener("click", onTap, true);
      observer.disconnect();
    };
  }, "dsh-mobile-nav: preview sheet open marker");
  ctx.effect(() => {
    if (!narrow.matches) return () => {
    };
    const moveTps = (stats) => {
      if ([...stats.children].some((c) => /^TPS\s+\d/.test((c.textContent ?? "").trim()))) return;
      const stack = stats.closest('[class$="_composerStack"]');
      if (stack === null) return;
      for (const el of stack.querySelectorAll("div")) {
        const text = (el.textContent ?? "").trim();
        if (!/^TPS\s+\d/.test(text)) continue;
        if (el.children.length > 0) continue;
        stats.appendChild(el);
        return;
      }
    };
    const mark = () => {
      const selector = '[data-phase] [data-slot="conversation.composer.dock"] [class$="_root"]';
      for (const root of document.querySelectorAll(selector)) {
        const text = root.textContent ?? "";
        if (!/(turns|steps|\bLLM\b|轮|步)/.test(text)) continue;
        root.setAttribute("data-mobile-nav", "stats");
        moveTps(root);
        return;
      }
    };
    const observer = new MutationObserver(mark);
    observer.observe(document.body, { childList: true, subtree: true });
    mark();
    return () => {
      observer.disconnect();
    };
  }, "dsh-mobile-nav: stats line marker");
  ctx.effect(() => {
    if (!narrow.matches) return () => {
    };
    const cols = ["[data-aionui-explorer-col]", "[data-aionui-preview-col]"];
    const seen = /* @__PURE__ */ new Map();
    const play = (el) => {
      el.animate(
        [
          { opacity: 0, transform: "translateY(28px)" },
          { opacity: 1, transform: "none" }
        ],
        { duration: 280, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "backwards" }
      );
    };
    const check = () => {
      for (const sel of cols) {
        const el = document.querySelector(sel);
        if (el === null) continue;
        const visible = getComputedStyle(el).visibility === "visible";
        const prev = seen.get(sel) ?? false;
        if (visible && !prev) play(el);
        seen.set(sel, visible);
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["style", "class", "data-aionui-explorer-open"] });
    check();
    return () => {
      observer.disconnect();
    };
  }, "dsh-mobile-nav: sheet rise animation replay");
  ctx.effect(() => {
    if (!narrow.matches) return () => {
    };
    const getWorkspaceCwd = () => {
      try {
        const ws = ctx.get?.("workspaces") ?? ctx.workspaces;
        const list = ws?.list;
        const arr = Array.isArray(list) ? list : list && typeof list === "object" && "value" in list ? list.value : null;
        if (Array.isArray(arr)) {
          for (const w of arr) {
            const c = w?.cwd ?? w?.root;
            if (typeof c === "string" && c) return c;
          }
        }
      } catch {
      }
      return "";
    };
    const readFile = (filePath) => ctx.connection.rpc.call(
      POCKET_RPC_CHANNEL,
      POCKET_ENDPOINTS.fileRead,
      { path: filePath, cwd: getWorkspaceCwd() }
    );
    return startFileGuard(readFile);
  }, "dsh-mobile-nav: file open guard + copy button + hide add-workspace (issue #17)");
  ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
    name: "conversation.session.header.actions",
    id: "mobile-nav-toggle",
    order: 10,
    locale: NS,
    inject: () => ({
      toggleSidebar: () => ctx.layout.toggleSidebar()
    })
  }, MobileNavToggle));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "mobile-nav-overlay",
    order: 10,
    locale: NS,
    inject: () => ({
      toggleSidebar: () => ctx.layout.toggleSidebar()
    })
  }, MobileNavOverlay));
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "mobile-nav-session-log",
    order: 10,
    locale: NS,
    inject: () => ({
      downloadSessionLog: (sessionId) => ctx.sessionLogDownload.download(sessionId),
      toggleSidebar: () => ctx.layout.toggleSidebar()
    })
  }, MobileDrawerFooter));
}

// client/pocket-locales.js
var NS2 = "pocket";
var zh2 = {
  "section": "\u624B\u673A\u8BBF\u95EE",
  "title": "\u{1F4F1} \u624B\u673A\u8BBF\u95EE",
  "subtitle": "\u624B\u673A\u626B\u7801\u6253\u5F00\u7684\u5C31\u662F\u7535\u8111\u4E0A\u7684\u8FD9\u4E2A\u754C\u9762\uFF0C\u5B9E\u65F6\u540C\u6B65",
  "developer": "\u5F00\u53D1\u8005\uFF1A\u7A0B\u5E8F\u5458\u5C11\u5317\u6668",
  "starAsk": "\u2B50 \u987A\u624B\u7559\u9897 Star\uFF0C\u4F5C\u8005\u80FD\u9AD8\u5174\u4E00\u6574\u5929",
  "starCta": "\u884C\uFF0C\u7ED9\u4F60\u4E00\u9897 Star",
  "restarted": "\u{1F504} \u5DF2\u91CD\u542F",
  "ok": "\u77E5\u9053\u4E86",
  "bgHint": "\u8FDB\u7A0B\u5728\u540E\u53F0\u8FD0\u884C\uFF08\u4E0D\u6302\u7EC8\u7AEF\uFF09\u3002\u5982\u9700\u505C\u6B62\uFF1A{cmd}",
  "updatedRestart": "\u2705 \u5DF2\u66F4\u65B0 v{ver}\uFF0C\u91CD\u542F\u751F\u6548",
  "updateAutoRestarting": "\u2705 \u5DF2\u66F4\u65B0 v{ver}\uFF0C\u6B63\u5728\u81EA\u52A8\u91CD\u542F\u2026",
  "updatedOk": "\u2705 \u5DF2\u66F4\u65B0 v{ver}",
  "updateAvailable": "\u{1F4E6} \u65B0\u7248\u672C v{ver}",
  "updating": "\u66F4\u65B0\u4E2D\u2026",
  "updateTo": "\u66F4\u65B0\u5230 v{ver}",
  "restartingNow": "\u6B63\u5728\u91CD\u542F\u751F\u6548\u2026",
  "restarting": "\u91CD\u542F\u4E2D\u2026",
  "restartNow": "\u{1F504} \u91CD\u542F dsh web \u751F\u6548",
  "updatingDetail": "\u23F3 \u66F4\u65B0\u4E2D\uFF08\u901A\u5E38 1-2 \u5206\u949F\uFF09\xB7 \u5DF2\u7B49\u5F85 {s} \u79D2",
  "restartingDetail": "\u23F3 \u6B63\u5728\u91CD\u542F\u751F\u6548\uFF08\u901A\u5E38 10-30 \u79D2\uFF09\xB7 \u5DF2\u7B49\u5F85 {s} \u79D2",
  "updatedAutoDetail": "\u2705 \u5DF2\u66F4\u65B0\uFF0C\u6B63\u5728\u81EA\u52A8\u91CD\u542F\u751F\u6548\uFF0C\u8BF7\u7A0D\u5019\u5237\u65B0",
  "updatedRestartDetail": "\u2705 \u5DF2\u66F4\u65B0\uFF0C\u91CD\u542F dsh web \u751F\u6548",
  "updateFailed": "\u274C \u5931\u8D25\uFF1A{err}\uFF08\u624B\u52A8\u66F4\u65B0\uFF1Adsh plugin --profile web update dsh-pocket --latest -w\uFF09",
  "versionRange": "\u5F53\u524D v{cur} \u2192 \u6700\u65B0 v{latest}",
  "wanAccess": "\u516C\u7F51\u8BBF\u95EE",
  "pinLabel": "\u8BBF\u95EE\u5BC6\u7801",
  "modeLabel": "\u5730\u5740\u6A21\u5F0F",
  "advAddress": "\u9AD8\u7EA7 \xB7 \u624B\u52A8\u9009\u5730\u5740",
  "wanOffHint": "\u5F00\u542F\u540E\u53EF\u4ECE\u4EFB\u4F55\u7F51\u7EDC\u8BBF\u95EE\uFF08\u6BCF\u6B21\u5F00\u542F\u9700\u786E\u8BA4\u514D\u8D23\u58F0\u660E\uFF09",
  "resetFactory": "\u{1F9F9} \u6062\u590D\u51FA\u5382\u8BBE\u7F6E",
  "resetGo": "\u6062\u590D",
  "resetIntro": "\u8BBE\u7F6E\u641E\u51FA\u95EE\u9898\u65F6\u7684\u4E34\u65F6\u515C\u5E95\uFF1A\u6E05\u7A7A\u672C\u673A\u914D\u7F6E\u5E76\u91CD\u8BBE\u968F\u673A\u5BC6\u7801\uFF08DSH \u7684\u4F1A\u8BDD\u3001\u6A21\u578B\u3001\u63D2\u4EF6\u914D\u7F6E\u4E0D\u53D7\u5F71\u54CD\uFF09",
  "resetTitle": "\u26A0\uFE0F \u786E\u8BA4\u6062\u590D\u51FA\u5382\u8BBE\u7F6E\uFF1F",
  "resetBody": "\u5C06\u6E05\u7A7A\u5E76\u6062\u590D\u9ED8\u8BA4\uFF1A\n\u2460 \u5F00\u5173\uFF1A\u5C40\u57DF\u7F51\u8BBF\u95EE=\u5F00\u3001\u8BBF\u95EE\u5BC6\u7801=\u5F00\u3001\u5C40\u57DF\u7F51\u5730\u5740=\u81EA\u52A8\n\u2461 \u516C\u7F51\uFF1A\u6A21\u5F0F\u56DE\u5230\u968F\u673A\u57DF\u540D\uFF0C\u6E05\u7A7A Tunnel Token \u4E0E\u56FA\u5B9A\u57DF\u540D\uFF0C\u5E76\u5173\u95ED\u6B63\u5728\u8FD0\u884C\u7684\u516C\u7F51\n\u2462 \u5BC6\u7801\uFF1A\u516C\u7F51\u548C\u5C40\u57DF\u7F51\u90FD\u6362\u6210\u65B0\u7684\u968F\u673A 8 \u4F4D\u5BC6\u7801\uFF08\u65E7\u5BC6\u7801\u7ACB\u5373\u4F5C\u5E9F\uFF0C\u624B\u673A\u9700\u91CD\u65B0\u8F93\u5165\uFF09\n\nDSH \u81EA\u8EAB\u7684\u4F1A\u8BDD\u3001\u6A21\u578B\u3001\u63D2\u4EF6\u914D\u7F6E\u4E0D\u53D7\u5F71\u54CD\uFF1B\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
  "resetConfirm": "\u786E\u8BA4\u6062\u590D",
  "resetDone": "\u2705 \u5DF2\u6062\u590D\u51FA\u5382\u8BBE\u7F6E\uFF1A\u8BBE\u7F6E\u5DF2\u6E05\u7A7A\uFF0C\u5BC6\u7801\u5DF2\u6362\u65B0\uFF08\u624B\u673A\u9700\u91CD\u65B0\u8F93\u5165\uFF09",
  "resetFailed": "\u274C \u6062\u590D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5",
  "lanTitle": "\u{1F4F6} \u5C40\u57DF\u7F51\uFF08\u540C\u4E00 WiFi\uFF09",
  "lanHint": "\u624B\u673A\u8FDE\u63A5\u540C\u4E00 WiFi \u540E\u626B\u7801\u5373\u53EF\u6253\u5F00",
  "lanAccess": "\u5C40\u57DF\u7F51\u8BBF\u95EE",
  "lanDisabledHint": "\u{1F512} \u5C40\u57DF\u7F51\u8BBF\u95EE\u5DF2\u5173\u95ED\uFF1A\u624B\u673A\u626B\u7801/\u94FE\u63A5\u5747\u4E0D\u53EF\u7528\uFF08\u516C\u7F51\u4E0D\u53D7\u5F71\u54CD\uFF09\u3002\u70B9\u300C\u5F00\u300D\u6062\u590D\u3002",
  "lanToggleTitleOff": "\u5173\u95ED\u5C40\u57DF\u7F51\u8BBF\u95EE",
  "lanToggleBodyOff": "\u5173\u95ED\u540E\uFF0C\u540C\u4E00 WiFi \u4E0B\u7684\u624B\u673A\u5C06\u65E0\u6CD5\u626B\u7801\u8BBF\u95EE\uFF08\u5C40\u57DF\u7F51\u4E8C\u7EF4\u7801/\u94FE\u63A5\u7ACB\u5373\u5931\u6548\uFF09\u3002\u516C\u7F51\u8BBF\u95EE\u4E0D\u53D7\u5F71\u54CD\u3002\u786E\u5B9A\u5173\u95ED\uFF1F",
  "lanToggleTitleOn": "\u5F00\u542F\u5C40\u57DF\u7F51\u8BBF\u95EE",
  "lanToggleBodyOn": "\u5F00\u542F\u540E\uFF0C\u540C\u4E00 WiFi \u7684\u624B\u673A\u626B\u7801\u5373\u53EF\u8BBF\u95EE\uFF08\u9ED8\u8BA4\u9700\u8F93\u5165\u5C40\u57DF\u7F51\u5BC6\u7801\uFF09\u3002\u786E\u5B9A\u5F00\u542F\uFF1F",
  "confirm": "\u786E\u5B9A",
  "lanAddress": "\u5C40\u57DF\u7F51\u5730\u5740",
  "lanAddressAuto": "\u81EA\u52A8\uFF08\u63A8\u8350\uFF09",
  "lanPin": "\u5C40\u57DF\u7F51\u8BBF\u95EE\u5BC6\u7801",
  "on": "\u5F00",
  "off": "\u5173",
  "lanPinValue": "\u{1F510} \u8BBF\u95EE\u5BC6\u7801\uFF1A{pin}\uFF08\u624B\u673A\u6253\u5F00\u9700\u8F93\u5165\uFF1B\u4E0E\u516C\u7F51\u5BC6\u7801\u5206\u5F00\uFF09",
  "lanPinCustomValue": "\u{1F510} \u8BBF\u95EE\u5BC6\u7801\uFF1A{pin}\uFF08\u81EA\u5B9A\u4E49\uFF1B\u624B\u673A\u6253\u5F00\u9700\u8F93\u5165\uFF09",
  "refresh": "\u5237\u65B0",
  "customize": "\u81EA\u5B9A\u4E49",
  "customizing": "\u65B0\u5BC6\u7801\uFF088 \u4F4D\uFF0C\u82F1\u6587\u5B57\u6BCD\u6216\u6570\u5B57\uFF09\uFF1A",
  "save": "\u4FDD\u5B58",
  "cancel": "\u53D6\u6D88",
  "pinInvalid": "\u5BC6\u7801\u5FC5\u987B\u662F 8 \u4F4D\u82F1\u6587\u5B57\u6BCD\u6216\u6570\u5B57",
  "pinCustomHint": "\u81EA\u5B9A\u4E49\u540E\u5F00\u542F\u516C\u7F51\u4E0D\u518D\u81EA\u52A8\u6362\u65B0",
  "lanPinOff": "\u{1F513} \u5BC6\u7801\u5DF2\u5173\u95ED\uFF1A\u626B\u7801\u76F4\u8FDE\uFF0C\u65E0\u9700\u5BC6\u7801\uFF08\u4EC5\u540C\u4E00\u5C40\u57DF\u7F51\u8BBE\u5907\u53EF\u8BBF\u95EE\uFF1B\u516C\u7F51\u4ECD\u8981\u5BC6\u7801\uFF09",
  "lanStarting": "\u4EE3\u7406\u672A\u5C31\u7EEA\u2026",
  "wanTitle": "\u{1F310} \u516C\u7F51\uFF08\u4EBA\u5728\u5916\u9762\uFF09",
  "wanHint": "\u4EFB\u4F55\u7F51\u7EDC\u626B\u7801\u5373\u7528\uFF08URL \u6BCF\u6B21\u91CD\u542F\u81EA\u52A8\u6362\u65B0\uFF09",
  "wanPin": "\u{1F510} \u8BBF\u95EE\u5BC6\u7801\uFF1A{pin}\uFF08\u6BCF\u6B21\u5F00\u542F\u516C\u7F51\u53D8\u65B0\uFF1B\u624B\u673A\u6253\u5F00\u94FE\u63A5\u9700\u8F93\u5165\u6B64\u5BC6\u7801\uFF09",
  "wanPinCustom": "\u{1F510} \u8BBF\u95EE\u5BC6\u7801\uFF1A{pin}\uFF08\u81EA\u5B9A\u4E49\uFF0C\u5F00\u542F\u516C\u7F51\u4E0D\u518D\u81EA\u52A8\u6362\u65B0\uFF09",
  "wanEphemeralWarn": "\u26A0\uFE0F \u516C\u7F51\u94FE\u63A5\u4EC5\u5728\u672C\u6B21\u5F00\u542F\u671F\u95F4\u6709\u6548\uFF1A\u5173\u95ED\u6216\u91CD\u542F\u540E\u5931\u6548\uFF0C\u5E76\u53EF\u80FD\u88AB\u4ED6\u4EBA\u590D\u7528\u4E3A\u964C\u751F\u7F51\u7AD9\u3002\u8BF7\u52FF\u6536\u85CF\uFF0C\u6BCF\u6B21\u4ECE\u672C\u9875\u626B\u300C\u5F53\u524D\u300D\u4E8C\u7EF4\u7801\u3002\u9700\u8981\u56FA\u5B9A\u4E0D\u53D8\u7684\u5730\u5740\u8BF7\u7528\u4E0B\u65B9\u300C\u56FA\u5B9A\u57DF\u540D\u300D\u3002",
  "stopTunnel": "\u5173\u95ED\u516C\u7F51",
  "enable": "\u5F00\u542F\u516C\u7F51\u8BBF\u95EE",
  "opening": "\u5F00\u542F\u4E2D\u2026",
  "tunnelMode": "\u516C\u7F51\u6A21\u5F0F\uFF1A",
  "modeQuick": "\u968F\u673A\u57DF\u540D\uFF08\u9ED8\u8BA4\uFF09",
  "modeNamed": "\u56FA\u5B9A\u57DF\u540D",
  "namedChannelTitle": "\u{1F310} \u56FA\u5B9A\u57DF\u540D Named Tunnel",
  "namedChannelHint": "\u957F\u671F\u7A33\u5B9A\u5165\u53E3\uFF1B\u4E0E\u968F\u673A\u57DF\u540D\u4E0D\u53EF\u540C\u65F6\u542F\u7528",
  "namedPinTransition": "\u672C\u901A\u9053\u5F53\u524D\u4ECD\u4F7F\u7528\u4E0B\u65B9\u516C\u7F51\u8BBF\u95EE\u5BC6\u7801\uFF1B\u540E\u7EED\u7248\u672C\u5C06\u6539\u4E3A\u6BCF\u8BBE\u5907\u72EC\u7ACB\u8BA4\u8BC1",
  "quickChannelTitle": "\u26A1 \u968F\u673A\u57DF\u540D Quick Tunnel",
  "quickChannelHint": "\u4E34\u65F6\u516C\u7F51\u5165\u53E3\uFF1B\u4E0E\u56FA\u5B9A\u57DF\u540D\u4E0D\u53EF\u540C\u65F6\u542F\u7528",
  "namedConfig": "\u56FA\u5B9A\u57DF\u540D\u914D\u7F6E",
  "namedSummary": "\u56FA\u5B9A\u57DF\u540D\uFF1A{host} \xB7 Token {token}",
  "namedTokenSet": "\u5DF2\u914D\u7F6E",
  "namedTokenMissing": "\u672A\u914D\u7F6E",
  "namedEdit": "\u4FEE\u6539",
  "namedHostnameLabel": "\u56FA\u5B9A\u57DF\u540D\uFF1A",
  "namedTokenLabel": "Tunnel Token\uFF08\u7559\u7A7A = \u4FDD\u6301\u4E0D\u53D8\uFF09\uFF1A",
  "namedHow": "\u5728 Cloudflare Zero Trust \u2192 Networks \u2192 Tunnels \u521B\u5EFA\u96A7\u9053\u5E76\u590D\u5236 Token\uFF1B\u628A\u57DF\u540D\u7684 Service \u6307\u5411 http://127.0.0.1:3081\uFF08\u4EE3\u7406\u7AEF\u53E3\uFF09\u3002\u5730\u5740\u56FA\u5B9A\uFF0C\u91CD\u542F\u4E0D\u518D\u53D8\u5316\u3002",
  "namedSecurity": "\u56FA\u5B9A\u57DF\u540D\u957F\u671F\u66B4\u9732\u5728\u516C\u7F51\u3001\u66F4\u6613\u88AB\u626B\u63CF\uFF0C\u5EFA\u8BAE\u540C\u65F6\u8BBE\u7F6E\u81EA\u5B9A\u4E49\u5F3A\u5BC6\u7801\uFF08\u672C\u6A21\u5F0F\u516C\u7F51\u5BC6\u7801\u9ED8\u8BA4\u4E0D\u968F\u91CD\u542F\u8F6E\u6362\uFF09\u3002",
  "namedNeedCfg": "\u8BF7\u5148\u586B\u5199\u56FA\u5B9A\u57DF\u540D\u4E0E Tunnel Token",
  "namedRunningHint": "\u56FA\u5B9A\u57DF\u540D\uFF08Cloudflare \u547D\u540D\u96A7\u9053\uFF09\u2014\u2014\u5730\u5740\u4E0D\u968F\u91CD\u542F\u53D8\u5316",
  "namedTakeEffect": "\u5DF2\u4FDD\u5B58\u56FA\u5B9A\u57DF\u540D\u914D\u7F6E\u2014\u2014\u9700\u5173\u95ED\u5E76\u91CD\u65B0\u5F00\u542F\u516C\u7F51\u8BBF\u95EE\u540E\u751F\u6548",
  "disclaimerTitle": "\u26A0\uFE0F \u5B89\u5168\u514D\u8D23\u58F0\u660E",
  "disclaimerBody": "\u5F00\u542F\u516C\u7F51 = \u628A\u672C\u673A DSH\uFF08\u80FD\u6267\u884C\u4EE3\u7801\uFF09\u66B4\u9732\u5230\u4E92\u8054\u7F51\u3002\u4EFB\u4F55\u4EBA\u62FF\u5230\u516C\u7F51\u94FE\u63A5\u548C\u5BC6\u7801\uFF0C\u90FD\u80FD\u8BBF\u95EE\u751A\u81F3\u64CD\u4F5C\u4F60\u7684\u7535\u8111\u3002\u8BF7\u786E\u8BA4\uFF1A\u2460 \u4F7F\u7528\u81EA\u5B9A\u4E49\u5F3A\u5BC6\u7801\u6216\u59A5\u5584\u4FDD\u7BA1\u81EA\u52A8\u5BC6\u7801\uFF1B\u2461 \u7528\u5B8C\u7ACB\u5373\u300C\u5173\u95ED\u516C\u7F51\u300D\uFF1B\u2462 \u516C\u53F8/\u6D89\u5BC6\u7F51\u7EDC\u8BF7\u5148\u786E\u8BA4\u5408\u89C4\u3002",
  "disclaimerAgree": "\u6211\u5DF2\u77E5\u60C5\uFF0C\u540C\u610F\u5F00\u542F",
  "disclaimerHint": "\u8BF7\u52FE\u9009\u300C\u6211\u5DF2\u77E5\u60C5\u300D\u540E\u518D\u5F00\u542F\u516C\u7F51",
  "downloading": "\u23F3 \u4E0B\u8F7D cloudflared\uFF08\u9996\u6B21\u7EA6 20-50MB\uFF0C\u901A\u5E38 1-2 \u5206\u949F\uFF1B\u4E4B\u540E\u79D2\u5F00\uFF09\xB7 \u5DF2\u7B49\u5F85 {s} \u79D2",
  "connecting": "\u23F3 \u8FDE\u63A5 Cloudflare \u8FB9\u7F18\uFF08\u901A\u5E38 5-30 \u79D2\uFF09\xB7 \u5DF2\u7B49\u5F85 {s} \u79D2{suffix}",
  "slowHint": " \u2014 \u6709\u70B9\u4E45\uFF1F\u68C0\u67E5\u662F\u5426\u5F00\u7740\u4EE3\u7406/VPN\uFF08Clash TUN \u7B49\uFF09",
  "error": "\u274C \u5F00\u542F\u5931\u8D25\uFF1A{detail}\uFF08\u53EF\u91CD\u8BD5\uFF1B\u82E5\u662F\u4EE3\u7406/VPN \u95EE\u9898\u89C1 README \u6392\u969C\uFF09",
  "unknownError": "\u672A\u77E5\u9519\u8BEF",
  "feedback": "\u6709\u95EE\u9898\uFF1F\u6B22\u8FCE\u5230 GitHub Issues \u53CD\u9988 \u{1F64F}"
};
var en2 = {
  "section": "Phone access",
  "title": "\u{1F4F1} Phone access",
  "subtitle": "The phone shows this exact screen, live",
  "developer": "Developer: \u5C11\u5317\u6668 (shaobeichen)",
  "starAsk": "\u2B50 Drop a Star if it helped \u2014 it makes the author\u2019s day",
  "starCta": "\u2605 Give a Star",
  "restarted": "\u{1F504} Restarted",
  "ok": "Got it",
  "bgHint": "Running in the background (not attached to a terminal). To stop: {cmd}",
  "updatedRestart": "\u2705 Updated to v{ver} \u2014 restart to apply",
  "updateAutoRestarting": "\u2705 Updated to v{ver} \u2014 auto-restarting\u2026",
  "updatedOk": "\u2705 Updated to v{ver}",
  "updateAvailable": "\u{1F4E6} Update available: v{ver}",
  "updating": "Updating\u2026",
  "updateTo": "Update to v{ver}",
  "restartingNow": "Restarting to apply\u2026",
  "restarting": "Restarting\u2026",
  "restartNow": "\u{1F504} Restart dsh web now",
  "updatingDetail": "\u23F3 Updating (usually 1-2 min) \xB7 {s}s elapsed",
  "restartingDetail": "\u23F3 Restarting to apply (usually 10-30s) \xB7 {s}s elapsed",
  "updatedAutoDetail": "\u2705 Updated \u2014 auto-restarting in progress, refresh shortly",
  "updatedRestartDetail": "\u2705 Updated \u2014 restart dsh web to apply",
  "updateFailed": "\u274C Failed: {err} (manual update: dsh plugin --profile web update dsh-pocket --latest -w)",
  "versionRange": "Current v{cur} \u2192 latest v{latest}",
  "wanAccess": "Public access",
  "pinLabel": "Access PIN",
  "modeLabel": "Address mode",
  "advAddress": "Advanced \xB7 Pick address",
  "wanOffHint": "Reachable from any network once enabled (a disclaimer is confirmed on each enable)",
  "resetFactory": "\u{1F9F9} Factory reset",
  "resetGo": "Reset",
  "resetIntro": "Temporary fallback when settings break: clear local config and re-roll random PINs (DSH sessions, models and plugin config are untouched)",
  "resetTitle": "\u26A0\uFE0F Confirm factory reset?",
  "resetBody": "This clears and restores defaults:\n\u2460 Switches: LAN access on, access PIN on, LAN address auto\n\u2461 Public: mode back to random URL, Tunnel Token and fixed domain cleared, and any running tunnel is stopped\n\u2462 PINs: both public and LAN become new random 8-character PINs (old ones stop working; the phone must re-enter)\n\nYour DSH sessions, models and plugin config are untouched. This cannot be undone.",
  "resetConfirm": "Reset",
  "resetDone": "\u2705 Factory reset done: settings cleared and PINs re-rolled (re-enter the PIN on your phone)",
  "resetFailed": "\u274C Reset failed \u2014 please retry",
  "lanTitle": "\u{1F4F6} LAN (same Wi-Fi)",
  "lanHint": "Scan to open once your phone is on the same Wi-Fi",
  "lanAccess": "LAN access",
  "lanDisabledHint": '\u{1F512} LAN access is off \u2014 the QR code and link are unavailable (public access is unaffected). Tap "On" to restore.',
  "lanToggleTitleOff": "Turn off LAN access",
  "lanToggleBodyOff": "Once off, phones on the same Wi-Fi can no longer scan to connect (the LAN QR code and link stop working immediately). Public access is unaffected. Turn it off?",
  "lanToggleTitleOn": "Turn on LAN access",
  "lanToggleBodyOn": "Once on, phones on the same Wi-Fi can scan to connect (a LAN PIN is required by default). Turn it on?",
  "confirm": "Confirm",
  "lanAddress": "LAN address",
  "lanAddressAuto": "Auto (recommended)",
  "lanPin": "LAN access PIN",
  "on": "On",
  "off": "Off",
  "lanPinValue": "\u{1F510} PIN: {pin} (required on the phone; separate from the public PIN)",
  "lanPinCustomValue": "\u{1F510} PIN: {pin} (custom; required on the phone)",
  "refresh": "Refresh",
  "customize": "Customize",
  "customizing": "New PIN (8 chars, letters/digits): ",
  "save": "Save",
  "cancel": "Cancel",
  "pinInvalid": "PIN must be exactly 8 characters (letters and digits only)",
  "pinCustomHint": "custom PINs are not rotated on tunnel start",
  "lanPinOff": "\u{1F513} PIN off \u2014 scan & go, no PIN (LAN devices only; public still requires PIN)",
  "lanStarting": "Proxy starting\u2026",
  "wanTitle": "\u{1F310} Anywhere (public)",
  "wanHint": "Scan from any network (the URL changes on every restart)",
  "wanPin": "\u{1F510} PIN: {pin} (changes each time the tunnel is enabled; required on the phone)",
  "wanPinCustom": "\u{1F510} PIN: {pin} (custom \u2014 not rotated on tunnel start)",
  "wanEphemeralWarn": '\u26A0\uFE0F The public link is valid only for this session: it stops working after you close or restart, and may be reused by someone else for an unrelated site. Do not bookmark it \u2014 scan the CURRENT QR code from this page each time. For a permanent address use "Fixed domain" below.',
  "stopTunnel": "Stop",
  "enable": "Enable anywhere",
  "opening": "Enabling\u2026",
  "tunnelMode": "Mode:",
  "modeQuick": "Random URL (default)",
  "modeNamed": "Fixed domain",
  "namedChannelTitle": "\u{1F310} Fixed domain \xB7 Named Tunnel",
  "namedChannelHint": "Stable long-term access; mutually exclusive with Quick Tunnel",
  "namedPinTransition": "This channel still uses the public PIN below; device authentication arrives in a later change",
  "quickChannelTitle": "\u26A1 Random domain \xB7 Quick Tunnel",
  "quickChannelHint": "Temporary public access; mutually exclusive with Named Tunnel",
  "namedConfig": "Fixed domain configuration",
  "namedSummary": "Fixed domain: {host} \xB7 Token {token}",
  "namedTokenSet": "configured",
  "namedTokenMissing": "not set",
  "namedEdit": "Edit",
  "namedHostnameLabel": "Fixed domain:",
  "namedTokenLabel": "Tunnel Token (blank = keep current):",
  "namedHow": "Create a tunnel in Cloudflare Zero Trust \u2192 Networks \u2192 Tunnels and copy the token; point the hostname's Service at http://127.0.0.1:3081 (the proxy port). The URL stays fixed across restarts.",
  "namedSecurity": "A fixed domain is long-lived and easier to scan \u2014 set a strong custom PIN too (the public PIN is not rotated on restart in this mode).",
  "namedNeedCfg": "Set the fixed domain and Tunnel Token first",
  "namedRunningHint": "Fixed domain (Cloudflare named tunnel) \u2014 the URL no longer changes on restart",
  "namedTakeEffect": "Fixed-domain config saved \u2014 turn public access off and on again to take effect",
  "disclaimerTitle": "\u26A0\uFE0F Security disclaimer",
  "disclaimerBody": "Enabling public access exposes this computer\u2019s DSH (which can execute code) to the internet. Anyone with the public link and PIN can reach \u2014 and operate \u2014 your computer. Please confirm: \u2460 use a strong custom PIN or keep the auto-generated one safe; \u2461 turn public access OFF as soon as you\u2019re done; \u2462 on a corporate/classified network, confirm compliance first.",
  "disclaimerAgree": "I understand and agree",
  "disclaimerHint": 'Check "I understand" before enabling public access',
  "downloading": "\u23F3 Downloading cloudflared (first run ~20-50MB, usually 1-2 min; instant afterward) \xB7 {s}s elapsed",
  "connecting": "\u23F3 Connecting to Cloudflare edge (usually 5-30s) \xB7 {s}s elapsed{suffix}",
  "slowHint": " \u2014 taking long? Check for a proxy/VPN (e.g., Clash TUN)",
  "error": "\u274C Failed to enable: {detail} (you can retry; for proxy/VPN issues see the README)",
  "unknownError": "unknown error",
  "feedback": "\u{1F64F} Questions? Open an issue on GitHub"
};

// client/index.jsx
var name = "dsh-pocket";
var inject = ["slots", "connection", "layout", "locale", "sessionLogDownload"];
function fmt(t, key, vars) {
  let s = t(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = String(s).split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
var styles = {
  card: { background: "var(--dsw-alias-bg-layer-1,#fff)", border: "1px solid var(--dsw-alias-border-l2,#e5e7eb)", borderRadius: 12, padding: "16px 20px", maxWidth: 480 },
  block: { borderTop: "1px solid var(--dsw-alias-border-l2,#e5e7eb)", marginTop: 16, paddingTop: 16 },
  muted: { color: "var(--dsw-alias-label-tertiary,#8b93a1)", fontSize: 12, lineHeight: 1.5 },
  code: { fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12, wordBreak: "break-all", margin: "6px 0 10px", color: "var(--dsw-alias-label-primary,inherit)" },
  // 主按钮：官方 md 胶囊形（36px）
  primary: { font: "inherit", cursor: "pointer", border: "none", background: "var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))", color: "var(--dsw-alias-label-primary-foreground, #fff)", height: 36, padding: "0 16px", borderRadius: 999, fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", justifyContent: "center" },
  // 次级按钮：官方 outline/ghost 胶囊形
  btn: { font: "inherit", cursor: "pointer", border: "1px solid var(--dsw-alias-button-ghost-active-border, var(--dsw-alias-border-l2,#d1d5db))", background: "var(--dsw-alias-bg-layer-1,#fff)", color: "var(--dsw-alias-label-primary,inherit)", height: 36, padding: "0 16px", borderRadius: 999, fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center" },
  qr: { width: 220, height: 220, borderRadius: 10, border: "1px solid var(--dsw-alias-border-l2,#e5e7eb)", margin: "8px 0" },
  warn: { color: "var(--dsw-alias-state-warn-primary,#b45309)", fontSize: 12, lineHeight: 1.5 }
};
function PocketSettingsTab({ rpcCall, t }) {
  const [status, setStatus] = (0, import_react2.useState)(null);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const [tunnelState, setTunnelState] = (0, import_react2.useState)(null);
  const [restartNotice, setRestartNotice] = (0, import_react2.useState)(false);
  const [updateInfo, setUpdateInfo] = (0, import_react2.useState)(null);
  const [isDesktop, setIsDesktop] = (0, import_react2.useState)(false);
  const [now, setNow] = (0, import_react2.useState)(Date.now());
  (0, import_react2.useEffect)(() => {
    const t2 = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(t2);
  }, []);
  const elapsed = (startedAt) => startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1e3)) : 0;
  const call = async (endpoint, payload) => {
    const res = await rpcCall(endpoint, payload);
    if (!res?.ok) throw new Error(res?.error?.message ?? "RPC failed");
    return res.value;
  };
  const load = async () => {
    try {
      const s = await call(POCKET_ENDPOINTS.status, {});
      setStatus(s);
      setTunnelState(s.tunnelState ?? null);
      if (s.desktop) setIsDesktop(true);
      if (s.restartNotice) {
        setRestartNotice(true);
        setUpdateInfo(null);
        if (!sessionStorage.getItem("dshp-auto-reloaded")) {
          sessionStorage.setItem("dshp-auto-reloaded", "1");
          setTimeout(() => {
            try {
              location.reload();
            } catch {
            }
          }, 2e3);
        }
      }
    } catch {
    }
  };
  (0, import_react2.useEffect)(() => {
    load();
    const t2 = setInterval(load, 3e3);
    return () => clearInterval(t2);
  }, []);
  (0, import_react2.useEffect)(() => {
    try {
      sessionStorage.removeItem("dshp-auto-reloaded");
    } catch {
    }
  }, []);
  (0, import_react2.useEffect)(() => {
    if (isDesktop) return;
    let alive = true;
    const check = async () => {
      try {
        const v = await call(POCKET_ENDPOINTS.version, {});
        const meta = await (await fetch("https://registry.npmjs.org/dsh-pocket/latest", { cache: "no-store" })).json();
        if (!alive) return;
        const latest = typeof meta?.version === "string" ? meta.version : null;
        if (latest && v.current && compareVersions(latest, v.current) > 0) {
          setUpdateInfo({ current: v.current, latest, updating: false, result: null });
        } else if (v.current && v.loaded && compareVersions(v.current, v.loaded) > 0) {
          setUpdateInfo({ current: v.current, latest: v.current, updating: false, result: "ok", updated: true });
        }
      } catch {
      }
    };
    check();
    const t2 = setInterval(check, 5 * 60 * 1e3);
    return () => {
      alive = false;
      clearInterval(t2);
    };
  }, [isDesktop]);
  const restartPocket = async () => {
    setUpdateInfo((u) => ({ ...u, restarting: true, startedAt: Date.now() }));
    try {
      await Promise.race([
        call(POCKET_ENDPOINTS.restart, {}),
        new Promise((_, rej) => setTimeout(() => rej(new Error("restart requested (no reply within 3s)")), 3e3))
      ]);
      setUpdateInfo((u) => ({ ...u, restarting: true, result: "ok" }));
    } catch (err) {
      const msg = String(err?.message ?? "");
      if (/connection|socket|fetch|network|abort|cancelled|ECONN|disconnect|closed|timeout/i.test(msg)) {
        setUpdateInfo((u) => ({ ...u, restarting: true, result: "ok" }));
        return;
      }
      setUpdateInfo((u) => ({ ...u, restarting: false, result: "fail", output: err.message }));
    }
  };
  const runUpdate = async () => {
    setUpdateInfo((u) => ({ ...u, updating: true, result: null, startedAt: Date.now() }));
    try {
      const r = await call(POCKET_ENDPOINTS.update, {});
      setUpdateInfo((u) => ({
        ...u,
        updating: false,
        result: r.ok ? "ok" : "fail",
        autoRestart: r.autoRestart === true,
        output: r.output ?? r.error
      }));
    } catch (err) {
      setUpdateInfo((u) => ({ ...u, updating: false, result: "fail", output: err.message }));
    }
  };
  const [disclaimerOpen, setDisclaimerOpen] = (0, import_react2.useState)(false);
  const [disclaimerChecked, setDisclaimerChecked] = (0, import_react2.useState)(false);
  const [requestedTunnelMode, setRequestedTunnelMode] = (0, import_react2.useState)(null);
  const doStartTunnel = async () => {
    const mode = requestedTunnelMode ?? status?.tunnelConfig?.mode ?? "quick";
    setBusy(true);
    setError(null);
    try {
      let next = status;
      if (next?.tunnelRunning && next?.tunnelActiveMode !== mode) {
        next = await call(POCKET_ENDPOINTS.tunnelStop, {});
      }
      if (next?.tunnelConfig?.mode !== mode) {
        next = await call(POCKET_ENDPOINTS.tunnelSetConfig, { mode });
      }
      const cfg = next?.tunnelConfig;
      if (mode === "named" && (!cfg?.hostname || !cfg?.tokenSet)) throw new Error(t("namedNeedCfg"));
      setStatus(next);
      setTunnelState({ phase: "starting", detail: "\u6B63\u5728\u5F00\u542F\u2026", startedAt: Date.now() });
      setStatus(await call(POCKET_ENDPOINTS.tunnelStart, { disclaimer: true }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRequestedTunnelMode(null);
      setBusy(false);
    }
  };
  const startTunnel = (mode) => {
    setRequestedTunnelMode(mode);
    setDisclaimerChecked(false);
    setDisclaimerOpen(true);
  };
  const confirmDisclaimer = () => {
    if (!disclaimerChecked) return;
    setDisclaimerOpen(false);
    doStartTunnel();
  };
  const stopTunnel = async () => {
    try {
      setStatus(await call(POCKET_ENDPOINTS.tunnelStop, {}));
    } catch {
    }
  };
  const [tunnelCfg, setTunnelCfg] = (0, import_react2.useState)(null);
  const saveNamedTunnel = async () => {
    try {
      setStatus(await call(POCKET_ENDPOINTS.tunnelSetConfig, {
        mode: "named",
        hostname: tunnelCfg?.hostname ?? "",
        token: tunnelCfg?.token || void 0
        // 留空不覆盖已存 Token
      }));
      setTunnelCfg(null);
    } catch (err) {
      setTunnelCfg((c) => ({ ...c, err: err.message }));
    }
  };
  const [resetOpen, setResetOpen] = (0, import_react2.useState)(false);
  const doFactoryReset = async () => {
    setResetOpen(false);
    setBusy(true);
    setError(null);
    try {
      setStatus(await call(POCKET_ENDPOINTS.pocketReset, { confirm: true }));
      setTunnelCfg(null);
      setCustomPin(null);
      setAdvOpen(false);
      showToast(t("resetDone"));
    } catch (err) {
      setError(err.message);
      showToast(t("resetFailed"));
    } finally {
      setBusy(false);
    }
  };
  const refreshLanPin = async () => {
    try {
      const r = await call(POCKET_ENDPOINTS.lanTokenRefresh, {});
      setStatus((s) => ({ ...s, lanToken: r.lanToken }));
    } catch {
    }
  };
  const setLanAuth = async (on) => {
    try {
      const r = await call(POCKET_ENDPOINTS.lanAuthSetEnabled, { on });
      setStatus((s) => ({ ...s, lanAuthEnabled: r.lanAuthEnabled }));
    } catch {
    }
  };
  const [lanToggleOpen, setLanToggleOpen] = (0, import_react2.useState)(null);
  const requestLanToggle = (on) => setLanToggleOpen(on);
  const confirmLanToggle = async () => {
    const on = lanToggleOpen;
    setLanToggleOpen(null);
    if (on === null) return;
    try {
      const r = await call(POCKET_ENDPOINTS.lanSetEnabled, { on });
      setStatus((s) => ({ ...s, lanEnabled: r.lanEnabled }));
    } catch (err) {
      setError(err.message);
    }
  };
  const setLanAddress = async (ip) => {
    try {
      setStatus(await call(POCKET_ENDPOINTS.lanSetOverride, { ip }));
    } catch (err) {
      setError(err.message);
    }
  };
  const [customPin, setCustomPin] = (0, import_react2.useState)(null);
  const saveCustomPin = async (which) => {
    try {
      const r = await call(POCKET_ENDPOINTS.pinSetCustom, { which, value: customPin?.value ?? "" });
      setStatus((s) => ({
        ...s,
        accessToken: which === "public" ? r.pin : s.accessToken,
        lanToken: which === "lan" ? r.pin : s.lanToken,
        publicPinCustom: which === "public" ? true : s.publicPinCustom,
        lanPinCustom: which === "lan" ? true : s.lanPinCustom
      }));
      setCustomPin(null);
    } catch (err) {
      setCustomPin((c) => ({ ...c, err: err.message }));
    }
  };
  const customPinRow = (which) => (0, import_react2.createElement)(
    "div",
    { style: { marginTop: 6, fontSize: 12, color: "var(--dsw-alias-label-secondary,#6b7280)", lineHeight: 1.5 } },
    t("customizing"),
    (0, import_react2.createElement)("input", {
      style: { width: 130, margin: "0 6px", padding: "4px 8px", fontSize: 14, letterSpacing: 1, textAlign: "center", border: "1px solid var(--dsw-alias-border-l2,#d1d5db)", borderRadius: 6, outline: "none" },
      type: "password",
      maxLength: 8,
      value: customPin?.value ?? "",
      autoFocus: true,
      onChange: (e) => setCustomPin((c) => ({ ...c, value: e.target.value.replace(/[^a-zA-Z0-9]/g, ""), err: null })),
      onKeyDown: (e) => {
        if (e.key === "Enter") saveCustomPin(which);
        if (e.key === "Escape") setCustomPin(null);
      }
    }),
    (0, import_react2.createElement)("button", { style: { ...styles.btn, height: 26, padding: "0 10px", fontSize: 12, marginLeft: 2 }, onClick: () => saveCustomPin(which) }, t("save")),
    (0, import_react2.createElement)("button", { style: { ...styles.btn, height: 26, padding: "0 10px", fontSize: 12 }, onClick: () => setCustomPin(null) }, t("cancel")),
    customPin?.err ? (0, import_react2.createElement)("div", { style: { color: "var(--dsw-alias-state-error-primary,#dc2626)", marginTop: 4 } }, errText(customPin.err)) : null
  );
  const customBtn = (which) => (0, import_react2.createElement)("button", { style: { ...styles.btn, height: 26, padding: "0 10px", fontSize: 12, marginLeft: 8 }, onClick: () => setCustomPin({ which, value: "", err: null }) }, t("customize"));
  const lanUrl = status?.lanUrl;
  const tunnelUrl = status?.tunnelUrl;
  const tunnelPhase = tunnelState?.phase ?? "idle";
  const tunnelStarting = ["downloading", "starting", "registering"].includes(tunnelPhase);
  const tunnelStateDetail = tunnelState?.detail ?? "";
  const tunnelStateStarted = tunnelState?.startedAt ?? null;
  const tunnelModeView = status?.tunnelConfig ?? { mode: "quick", hostname: "", tokenSet: false };
  const activeNamedMode = status?.tunnelActiveMode === "named";
  const errText = (msg) => {
    const s = String(msg ?? "");
    const i = s.indexOf(" | ");
    if (i < 0) return s;
    return (t("ok") === zh2.ok ? s.slice(0, i) : s.slice(i + 3)).trim();
  };
  const [toast, setToast] = (0, import_react2.useState)(null);
  const toastTimer = (0, import_react2.useRef)(null);
  const showToast = (text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };
  (0, import_react2.useEffect)(() => () => clearTimeout(toastTimer.current), []);
  const Switch = (on, onClick) => (0, import_react2.createElement)("button", {
    role: "switch",
    "aria-checked": !!on,
    style: { flexShrink: 0, width: 40, height: 22, borderRadius: 11, border: "none", padding: 0, position: "relative", cursor: "pointer", font: "inherit", background: on ? "var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))" : "var(--dsw-alias-border-l2,#d1d5db)" },
    onClick
  }, (0, import_react2.createElement)("span", { style: { position: "absolute", top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff" } }));
  const qrArea = (src, url, hint) => (0, import_react2.createElement)(
    "div",
    { style: { background: "var(--dsw-alias-bg-layer-2,#f3f4f6)", borderRadius: 10, padding: "10px 12px", textAlign: "center", margin: "10px 0" } },
    (0, import_react2.createElement)("img", { src, alt: "QR", style: styles.qr }),
    (0, import_react2.createElement)("div", { style: styles.code }, url),
    (0, import_react2.createElement)("div", { style: styles.muted }, hint)
  );
  const row = (label, control, extra) => (0, import_react2.createElement)(
    "div",
    { style: { borderTop: "1px solid var(--dsw-alias-border-l2,#e5e7eb)", paddingTop: 9, marginTop: 9 } },
    (0, import_react2.createElement)(
      "div",
      { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
      (0, import_react2.createElement)("span", { style: { fontSize: 13 } }, label),
      control
    ),
    extra ?? null
  );
  const [advOpen, setAdvOpen] = (0, import_react2.useState)(false);
  return (0, import_react2.createElement)(
    "div",
    { style: styles.card },
    (0, import_react2.createElement)(
      "div",
      { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
      (0, import_react2.createElement)(
        "div",
        null,
        (0, import_react2.createElement)("strong", null, t("title")),
        (0, import_react2.createElement)("div", { style: styles.muted }, t("subtitle"))
      ),
      (0, import_react2.createElement)(
        "div",
        { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary,#8b93a1)", textAlign: "right" } },
        (0, import_react2.createElement)("div", { style: { whiteSpace: "nowrap" } }, t("developer")),
        (0, import_react2.createElement)("div", { style: { whiteSpace: "nowrap" } }, t("starAsk")),
        (0, import_react2.createElement)(
          "a",
          { href: "https://github.com/shaobeichen/dsh-pocket", target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-brand-primary,#4f6ef7)", fontSize: 12, lineHeight: 1.6, textDecoration: "underline" } },
          t("starCta")
        )
      )
    ),
    // 桌面端不显示更新/重启横幅（更新由 DSH Desktop 管理），也不需要额外提示
    // 重启后提示（进程在后台运行，停止方法）——左侧蓝色色条（桌面端不会触发本插件的自重启）
    !isDesktop && restartNotice ? (0, import_react2.createElement)(
      "div",
      { style: { ...styles.block, borderLeft: "4px solid var(--dsw-alias-brand-primary,#4f6ef7)", borderRadius: 8, background: "var(--dsw-alias-bg-layer-2,#f3f4f6)", padding: "10px 12px" } },
      (0, import_react2.createElement)(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
        (0, import_react2.createElement)("div", { style: { fontWeight: 600, fontSize: 13 } }, t("restarted")),
        (0, import_react2.createElement)("button", { style: styles.btn, onClick: () => setRestartNotice(false) }, t("ok"))
      ),
      (0, import_react2.createElement)("div", { style: styles.muted, marginTop: 4, wordBreak: "break-all" }, fmt(t, "bgHint", { cmd: status?.killHint ?? `lsof -ti :${status?.dshPort ?? 3080} | xargs kill -9` }))
    ) : null,
    // 更新提示——左侧黄色色条（提示有新版本）；单状态：有更新/更新中/已更新自动重启，不并存
    // 桌面端不渲染（更新由 DSH Desktop 管理）
    !isDesktop && updateInfo ? (0, import_react2.createElement)(
      "div",
      { style: { ...styles.block, borderLeft: "4px solid var(--dsw-alias-state-warn-primary,#b45309)", borderRadius: 8, background: "var(--dsw-alias-bg-layer-2,#f3f4f6)", padding: "10px 12px" } },
      (0, import_react2.createElement)(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
        (0, import_react2.createElement)(
          "div",
          { style: { fontWeight: 600, fontSize: 13 } },
          updateInfo.updated ? fmt(t, "updatedRestart", { ver: updateInfo.current }) : updateInfo.result === "ok" ? updateInfo.autoRestart ? fmt(t, "updateAutoRestarting", { ver: updateInfo.latest }) : fmt(t, "updatedOk", { ver: updateInfo.latest }) : fmt(t, "updateAvailable", { ver: updateInfo.latest })
        ),
        updateInfo.result !== "ok" ? (0, import_react2.createElement)("button", { style: styles.primary, onClick: runUpdate, disabled: updateInfo.updating }, updateInfo.updating ? t("updating") : fmt(t, "updateTo", { ver: updateInfo.latest })) : updateInfo.autoRestart ? (0, import_react2.createElement)("button", { style: styles.btn, disabled: true }, t("restartingNow")) : (0, import_react2.createElement)("button", { style: styles.primary, onClick: restartPocket, disabled: updateInfo.restarting }, updateInfo.restarting ? t("restarting") : t("restartNow"))
      ),
      (0, import_react2.createElement)(
        "div",
        { style: styles.muted, marginTop: 4 },
        updateInfo.updating ? fmt(t, "updatingDetail", { s: elapsed(updateInfo.startedAt) }) : updateInfo.restarting ? fmt(t, "restartingDetail", { s: elapsed(updateInfo.startedAt) }) : updateInfo.result === "ok" ? updateInfo.autoRestart ? t("updatedAutoDetail") : t("updatedRestartDetail") : updateInfo.result === "fail" ? fmt(t, "updateFailed", { err: errText(updateInfo.output) || t("unknownError") }) : fmt(t, "versionRange", { cur: updateInfo.current, latest: updateInfo.latest })
      )
    ) : null,
    // 局域网：标题行自带总开关 → 二维码+地址 → 设置行（访问密码 / 高级·手动选地址）
    (0, import_react2.createElement)(
      "div",
      { style: styles.block },
      (0, import_react2.createElement)(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
        (0, import_react2.createElement)("span", { style: { fontWeight: 600, fontSize: 13 } }, t("lanAccess")),
        Switch(status?.lanEnabled !== false, () => requestLanToggle(status?.lanEnabled === false))
      ),
      status?.lanEnabled === false ? (0, import_react2.createElement)("div", { style: { marginTop: 8, fontSize: 12, color: "var(--dsw-alias-state-warn-primary,#b45309)", lineHeight: 1.5 } }, t("lanDisabledHint")) : lanUrl ? (0, import_react2.createElement)(
        "div",
        null,
        qrArea(status.lanQr, lanUrl, t("lanHint")),
        // 访问密码行：开关 + 值（关闭时提示直连）
        row(
          t("lanPin"),
          Switch(status?.lanAuthEnabled !== false, () => setLanAuth(status?.lanAuthEnabled === false)),
          status?.lanAuthEnabled === false ? (0, import_react2.createElement)("div", { style: { ...styles.muted, marginTop: 6 } }, t("lanPinOff")) : customPin?.which === "lan" ? customPinRow("lan") : (0, import_react2.createElement)(
            "div",
            { style: { marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
            (0, import_react2.createElement)("span", { style: { fontFamily: "ui-monospace,Menlo,monospace", fontSize: 13, letterSpacing: 1 } }, status.lanToken),
            (0, import_react2.createElement)("button", { style: { ...styles.btn, height: 26, padding: "0 10px", fontSize: 12 }, onClick: refreshLanPin }, t("refresh")),
            customBtn("lan"),
            status?.lanPinCustom ? (0, import_react2.createElement)("span", { style: { fontSize: 11, color: "var(--dsw-alias-state-warn-primary,#b45309)" } }, t("pinCustomHint")) : null
          )
        ),
        // 高级：手动选地址（默认收起）
        row(
          t("advAddress"),
          (0, import_react2.createElement)(
            "button",
            { style: { border: "none", background: "none", font: "inherit", cursor: "pointer", fontSize: 12, color: "var(--dsw-alias-label-tertiary,#8b93a1)", padding: 0 }, onClick: () => setAdvOpen((v) => !v) },
            (status?.lanIpOverride || t("lanAddressAuto")) + " \u203A"
          ),
          advOpen ? (0, import_react2.createElement)(
            "div",
            { style: { marginTop: 8 } },
            (0, import_react2.createElement)(
              "label",
              { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dsw-alias-label-secondary,#6b7280)" } },
              t("lanAddress"),
              (0, import_react2.createElement)(
                "select",
                {
                  value: status?.lanIpOverride || "",
                  onChange: (e) => setLanAddress(e.target.value),
                  style: { font: "inherit", height: 30, padding: "0 8px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2,#d1d5db)", background: "var(--dsw-alias-bg-layer-1,#fff)", color: "var(--dsw-alias-label-primary,inherit)" }
                },
                (0, import_react2.createElement)("option", { value: "" }, t("lanAddressAuto")),
                (status?.lanCandidates || []).map((ip) => (0, import_react2.createElement)("option", { key: ip, value: ip }, ip))
              )
            )
          ) : null
        )
      ) : (0, import_react2.createElement)("div", { style: styles.muted }, t("lanStarting"))
    ),
    // 固定域名 Named：独立配置与启停。过渡期（PR2 前）仍使用公网访问密码。
    (0, import_react2.createElement)(
      "div",
      { style: styles.block },
      (0, import_react2.createElement)(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
        (0, import_react2.createElement)(
          "div",
          null,
          (0, import_react2.createElement)("span", { style: { fontWeight: 600, fontSize: 13 } }, t("namedChannelTitle")),
          (0, import_react2.createElement)("div", { style: styles.muted }, t("namedChannelHint"))
        ),
        Switch(Boolean(tunnelUrl && activeNamedMode), () => tunnelUrl && activeNamedMode ? stopTunnel() : startTunnel("named"))
      ),
      !tunnelCfg ? row(
        t("namedConfig"),
        (0, import_react2.createElement)("button", { style: { ...styles.btn, height: 28, padding: "0 12px", fontSize: 12 }, onClick: () => setTunnelCfg({ hostname: tunnelModeView.hostname ?? "", token: "", err: null }) }, t("namedEdit")),
        (0, import_react2.createElement)("div", { style: { ...styles.muted, marginTop: 5 } }, fmt(t, "namedSummary", { host: tunnelModeView.hostname || "\u2014", token: tunnelModeView.tokenSet ? t("namedTokenSet") : t("namedTokenMissing") }))
      ) : null,
      tunnelCfg ? (0, import_react2.createElement)(
        "div",
        { style: { marginTop: 10, fontSize: 12, lineHeight: 1.6 } },
        (0, import_react2.createElement)("label", null, t("namedHostnameLabel")),
        (0, import_react2.createElement)("input", { style: { width: "100%", marginTop: 4, padding: "8px 10px" }, placeholder: "pocket.example.com", value: tunnelCfg.hostname ?? "", onChange: (e) => setTunnelCfg((c) => ({ ...c, hostname: e.target.value.trim(), err: null })) }),
        (0, import_react2.createElement)("label", { style: { display: "block", marginTop: 8 } }, t("namedTokenLabel")),
        (0, import_react2.createElement)("input", { style: { width: "100%", marginTop: 4, padding: "8px 10px", fontFamily: "ui-monospace,Menlo,monospace" }, type: "password", value: tunnelCfg.token ?? "", onChange: (e) => setTunnelCfg((c) => ({ ...c, token: e.target.value.trim(), err: null })) }),
        (0, import_react2.createElement)(
          "div",
          { style: { marginTop: 8, display: "flex", gap: 8 } },
          (0, import_react2.createElement)("button", { style: { ...styles.btn, height: 28 }, onClick: saveNamedTunnel }, t("save")),
          (0, import_react2.createElement)("button", { style: { ...styles.btn, height: 28 }, onClick: () => setTunnelCfg(null) }, t("cancel"))
        ),
        (0, import_react2.createElement)("div", { style: { ...styles.muted, marginTop: 6 } }, t("namedHow")),
        tunnelCfg.err ? (0, import_react2.createElement)("div", { style: { color: "var(--dsw-alias-state-error-primary,#dc2626)", marginTop: 4 } }, errText(tunnelCfg.err)) : null
      ) : null,
      tunnelUrl && activeNamedMode ? qrArea(status.tunnelQr, tunnelUrl, t("namedRunningHint")) : null,
      // 过渡提示：设备认证在下一个 PR 落地
      (0, import_react2.createElement)("div", { style: { ...styles.warn, marginTop: 8 } }, t("namedPinTransition")),
      // 认证过渡期：Named 沿用公网访问密码
      status?.accessToken ? row(
        t("pinLabel"),
        customPin?.which === "public" ? null : (0, import_react2.createElement)(
          "span",
          { style: { display: "inline-flex", alignItems: "center", gap: 8 } },
          (0, import_react2.createElement)("span", { style: { fontFamily: "ui-monospace,Menlo,monospace", fontSize: 13, letterSpacing: 1 } }, status?.accessToken),
          customBtn("public")
        ),
        (0, import_react2.createElement)(
          "div",
          { style: { marginTop: 6 } },
          customPin?.which === "public" ? customPinRow("public") : null,
          status?.publicPinCustom ? (0, import_react2.createElement)("div", { style: { ...styles.warn } }, t("pinCustomHint")) : null
        )
      ) : null
    ),
    // 随机域名 Quick：独立启停与共享密码。
    (0, import_react2.createElement)(
      "div",
      { style: styles.block },
      (0, import_react2.createElement)(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
        (0, import_react2.createElement)("div", null, (0, import_react2.createElement)("span", { style: { fontWeight: 600, fontSize: 13 } }, t("quickChannelTitle")), (0, import_react2.createElement)("div", { style: styles.muted }, t("quickChannelHint"))),
        Switch(Boolean(tunnelUrl && !activeNamedMode), () => tunnelUrl && !activeNamedMode ? stopTunnel() : startTunnel("quick"))
      ),
      tunnelStarting ? (0, import_react2.createElement)("div", { style: { marginTop: 8, fontSize: 12, color: "var(--dsw-alias-label-secondary,#6b7280)" } }, tunnelPhase === "downloading" ? fmt(t, "downloading", { s: elapsed(tunnelStateStarted) }) : fmt(t, "connecting", { s: elapsed(tunnelStateStarted), suffix: elapsed(tunnelStateStarted) > 30 ? t("slowHint") : "" })) : null,
      tunnelPhase === "error" ? (0, import_react2.createElement)("div", { style: { marginTop: 8, fontSize: 12, color: "var(--dsw-alias-state-error-primary,#dc2626)" } }, fmt(t, "error", { detail: errText(tunnelStateDetail) || t("unknownError") })) : null,
      tunnelUrl && !activeNamedMode ? (0, import_react2.createElement)("div", null, qrArea(status.tunnelQr, tunnelUrl, t("wanHint")), (0, import_react2.createElement)("div", { style: { ...styles.warn, marginTop: 8 } }, t("wanEphemeralWarn"))) : null,
      status?.accessToken ? row(
        t("pinLabel"),
        customPin?.which === "public" ? null : (0, import_react2.createElement)("span", { style: { display: "inline-flex", alignItems: "center", gap: 8 } }, (0, import_react2.createElement)("span", { style: { fontFamily: "ui-monospace,Menlo,monospace", fontSize: 13, letterSpacing: 1 } }, status?.accessToken), customBtn("public")),
        (0, import_react2.createElement)("div", { style: { marginTop: 6 } }, customPin?.which === "public" ? customPinRow("public") : null, status?.publicPinCustom ? (0, import_react2.createElement)("div", { style: styles.warn }, t("pinCustomHint")) : null)
      ) : null
    ),
    error ? (0, import_react2.createElement)("div", { style: { color: "var(--dsw-alias-state-error-primary,#dc2626)", fontSize: 12, marginTop: 8 } }, `\u274C ${errText(error)}`) : null,
    // 恢复出厂设置：设置出问题时的临时兜底（最底部，避免误触）
    (0, import_react2.createElement)(
      "div",
      { style: styles.block },
      (0, import_react2.createElement)(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
        (0, import_react2.createElement)("span", { style: { fontWeight: 600, fontSize: 13 } }, t("resetFactory")),
        (0, import_react2.createElement)("button", { style: { ...styles.btn, height: 28, padding: "0 12px", fontSize: 12, color: "var(--dsw-alias-state-error-primary,#dc2626)" }, onClick: () => setResetOpen(true) }, t("resetGo"))
      ),
      (0, import_react2.createElement)("div", { style: { ...styles.muted, marginTop: 6 } }, t("resetIntro"))
    ),
    // 恢复出厂设置确认弹框
    resetOpen ? (0, import_react2.createElement)(
      "div",
      { style: { position: "fixed", inset: 0, zIndex: 1e4, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 } },
      (0, import_react2.createElement)(
        "div",
        { style: { background: "var(--dsw-alias-bg-layer-1,#fff)", borderRadius: 12, maxWidth: 440, width: "100%", padding: "20px 22px", boxShadow: "0 8px 32px rgba(0,0,0,.18)" } },
        (0, import_react2.createElement)("div", { style: { fontWeight: 600, fontSize: 15, color: "var(--dsw-alias-state-warn-primary,#b45309)", marginBottom: 10 } }, t("resetTitle")),
        (0, import_react2.createElement)("div", { style: { fontSize: 13, lineHeight: 1.7, color: "var(--dsw-alias-label-primary,inherit)", whiteSpace: "pre-line" } }, t("resetBody")),
        (0, import_react2.createElement)(
          "div",
          { style: { display: "flex", gap: 8, marginTop: 16 } },
          (0, import_react2.createElement)("button", { style: { ...styles.btn, flex: 1 }, onClick: () => setResetOpen(false) }, t("cancel")),
          (0, import_react2.createElement)("button", { style: { ...styles.primary, flex: 1, background: "var(--dsw-alias-state-error-primary,#dc2626)" }, onClick: doFactoryReset }, t("resetConfirm"))
        )
      )
    ) : null,
    // Toast：重置等操作的即时反馈（固定屏幕正中央，2.6s 自动消失）
    toast ? (0, import_react2.createElement)("div", {
      style: { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 10001, width: "auto", maxWidth: 280, background: "rgba(17,24,39,.92)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, lineHeight: 1.5, textAlign: "center", boxShadow: "0 8px 24px rgba(0,0,0,.22)" }
    }, toast) : null,
    // 局域网访问开关确认弹框（关闭/打开时弹窗提醒）
    lanToggleOpen !== null ? (0, import_react2.createElement)(
      "div",
      { style: { position: "fixed", inset: 0, zIndex: 1e4, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 } },
      (0, import_react2.createElement)(
        "div",
        { style: { background: "var(--dsw-alias-bg-layer-1,#fff)", borderRadius: 12, maxWidth: 420, width: "100%", padding: "20px 22px", boxShadow: "0 8px 32px rgba(0,0,0,.18)" } },
        (0, import_react2.createElement)("div", { style: { fontWeight: 600, fontSize: 15, color: lanToggleOpen ? "var(--dsw-alias-brand-primary,#4f6ef7)" : "var(--dsw-alias-state-warn-primary,#b45309)", marginBottom: 10 } }, t(lanToggleOpen ? "lanToggleTitleOn" : "lanToggleTitleOff")),
        (0, import_react2.createElement)("div", { style: { fontSize: 13, lineHeight: 1.7, color: "var(--dsw-alias-label-primary,inherit)" } }, t(lanToggleOpen ? "lanToggleBodyOn" : "lanToggleBodyOff")),
        (0, import_react2.createElement)(
          "div",
          { style: { display: "flex", gap: 8, marginTop: 16 } },
          (0, import_react2.createElement)("button", { style: { ...styles.btn, flex: 1 }, onClick: () => setLanToggleOpen(null) }, t("cancel")),
          (0, import_react2.createElement)("button", { style: { ...styles.primary, flex: 1 }, onClick: confirmLanToggle }, t("confirm"))
        )
      )
    ) : null,
    // 安全免责声明弹框（issue #31）：每次开启公网访问前确认
    disclaimerOpen ? (0, import_react2.createElement)(
      "div",
      { style: { position: "fixed", inset: 0, zIndex: 1e4, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 } },
      (0, import_react2.createElement)(
        "div",
        { style: { background: "var(--dsw-alias-bg-layer-1,#fff)", borderRadius: 12, maxWidth: 420, width: "100%", padding: "20px 22px", boxShadow: "0 8px 32px rgba(0,0,0,.18)" } },
        (0, import_react2.createElement)("div", { style: { fontWeight: 600, fontSize: 15, color: "var(--dsw-alias-state-warn-primary,#b45309)", marginBottom: 10 } }, t("disclaimerTitle")),
        (0, import_react2.createElement)("div", { style: { fontSize: 13, lineHeight: 1.7, color: "var(--dsw-alias-label-primary,inherit)" } }, t("disclaimerBody")),
        (0, import_react2.createElement)(
          "label",
          { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, cursor: "pointer" } },
          (0, import_react2.createElement)("input", { type: "checkbox", checked: disclaimerChecked, onChange: (e) => setDisclaimerChecked(e.target.checked), style: { width: 16, height: 16 } }),
          t("disclaimerAgree")
        ),
        (0, import_react2.createElement)(
          "div",
          { style: { display: "flex", gap: 8, marginTop: 16 } },
          (0, import_react2.createElement)("button", { style: { ...styles.btn, flex: 1 }, onClick: () => setDisclaimerOpen(false) }, t("cancel")),
          (0, import_react2.createElement)("button", {
            style: { ...styles.primary, flex: 1, opacity: disclaimerChecked ? 1 : 0.5 },
            disabled: !disclaimerChecked,
            onClick: confirmDisclaimer
          }, t("disclaimerAgree"))
        ),
        !disclaimerChecked ? (0, import_react2.createElement)("div", { style: { marginTop: 8, fontSize: 12, color: "var(--dsw-alias-state-error-primary,#dc2626)" } }, t("disclaimerHint")) : null
      )
    ) : null,
    // 页面最底部：反馈入口
    (0, import_react2.createElement)(
      "div",
      { style: { ...styles.block, textAlign: "center" } },
      (0, import_react2.createElement)(
        "a",
        { href: "https://github.com/shaobeichen/dsh-pocket/issues", target: "_blank", rel: "noreferrer", style: { fontSize: 12, color: "var(--dsw-alias-label-secondary,#6b7280)", textDecoration: "none" } },
        t("feedback")
      )
    )
  );
}
function apply(ctx) {
  if (ctx?.connection) {
    try {
      Object.defineProperty(ctx.connection, "isLoopback", { value: true, writable: true, configurable: true });
    } catch {
      try {
        ctx.connection.isLoopback = true;
      } catch {
      }
    }
  }
  mobileApply(ctx);
  const rpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(POCKET_RPC_CHANNEL, endpoint, payload, signal);
  const adminRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(POCKET_ADMIN_RPC_CHANNEL, endpoint, payload, signal);
  const translate = ctx.locale.bind(NS2);
  ctx.effect(() => ctx.locale.register(NS2, { zh: zh2, en: en2 }), "dsh-pocket: pocket locale dictionaries");
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: "pocket",
        order: 1,
        label: () => translate("section"),
        inject: () => ({ rpcCall, t: translate })
      },
      PocketSettingsTab
    )
  );
}

    return module.exports;
  }
});
