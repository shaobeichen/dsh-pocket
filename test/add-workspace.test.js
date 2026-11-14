// 移动端「隐藏添加工作区入口」（issue #17）。这个模块原名 fileGuard，另外两件事都已
// 过时并被删掉：拦截文件链接点击（DSH 现在在侧边栏预览文件）与「复制」按钮注入
// （侧边栏预览已能看文件，pocket.fileRead RPC 也一并删了）。
// 测试只验证「接线 + 不依赖 hash 类名 + 不再残留复制/拦截逻辑 + 产物与 CSS」，
// 与 mobile-nav.test.js 同风格（不引 jsdom，读源码/产物断言）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const src = readFileSync(new URL('../client/mobile/add-workspace.ts', import.meta.url), 'utf8');
const apply = readFileSync(new URL('../client/mobile/mobile-apply.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../client/api.js', import.meta.url), 'utf8');
const rpc = readFileSync(new URL('../lib/web-rpc.js', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');

test('隐藏逻辑只按文案匹配，不依赖 hash 类名', () => {
  assert.ok(src.includes('startAddWorkspaceHider'), '必须导出 startAddWorkspaceHider');
  assert.ok(src.includes('MutationObserver'), '下拉菜单项是后渲染的，必须用 MutationObserver 兜底');
  // hash 类名形如 [class$="_xxx"]；检测逻辑里绝不能出现按类名的属性选择器
  assert.ok(!/\[class[*^$]?=/.test(src), '不能出现 class 属性选择器（hash 类名每次构建都变）');
  assert.ok(src.includes('添加工作区') && src.includes('Add workspace'), '必须覆盖中英双语文案');
});

test('不再有文件链接相关的拦截 / 复制按钮（两者都已过时）', () => {
  // 拦截：document 捕获阶段 click → preventDefault + stopImmediatePropagation + 弹提示
  assert.ok(!src.includes('stopImmediatePropagation'), '不能再用 stopImmediatePropagation 掐断事件');
  assert.ok(!/document\.addEventListener\(\s*['"]click['"]/.test(src), '不能在 document 上挂 click 拦截');
  assert.ok(!src.includes('手机上无法直接打开电脑上的文件'), '过时的「无法打开」提示文案必须删掉');
  // 复制按钮：注入标记 + 路径启发式 + 主机 RPC
  assert.ok(!src.includes('copy-file'), '不应再注入「复制」按钮');
  assert.ok(!src.includes('looksLikeFilePath'), '不应再按文案猜文件路径');
  assert.ok(!src.includes('pocket.fileRead'), '不应再调用主机 fileRead');
  // 旧模块文件已删除
  assert.ok(!existsSync(new URL('../client/mobile/fileGuard.ts', import.meta.url)), 'fileGuard.ts 应已删除');
});

test('mobile-apply 已接线 startAddWorkspaceHider（窄屏生效、不再传 readFile）', () => {
  assert.ok(apply.includes("import { startAddWorkspaceHider } from './add-workspace.ts'"), '必须 import 新模块');
  assert.ok(apply.includes('startAddWorkspaceHider()'), '必须无参调用');
  assert.ok(apply.includes("'dsh-mobile-nav: hide add-workspace (issue #17)'"), 'effect 标签应标注 issue #17');
  assert.ok(apply.includes('if (!narrow.matches) return'), 'effect 必须受 narrow 门控');
  assert.ok(!apply.includes('startFileGuard'), '不应再引用已删除的 fileGuard');
  assert.ok(!apply.includes('POCKET_ENDPOINTS.fileRead'), '不应再引用 fileRead 端点');
  assert.ok(!apply.includes('getWorkspaceCwd'), '不再需要解析工作区 cwd（只服务 fileRead）');
});

test('主机侧 pocket.fileRead 端点已移除（客户端不再需要，少一个任意文件读取面）', () => {
  assert.ok(!api.includes('fileRead'), 'client/api.js 不应再定义 fileRead 端点');
  assert.ok(!rpc.includes('fileRead'), 'lib/web-rpc.js 不应再有 fileRead 处理分支');
  assert.ok(!rpc.includes('FILE_READ_MAX'), '读取上限常量应一并删除');
  assert.ok(!rpc.includes("from 'node:fs'"), 'fs 只为 fileRead 引入，应一并删除');
});

test('打包产物含隐藏逻辑、不含已删除的复制按钮 / 拦截逻辑', () => {
  // esbuild 会把单引号规范成双引号、中文转义成 \\uXXXX，故只查 ASCII 结构标记。
  assert.ok(bundle.includes('data-mobile-nav-hide'), '产物必须含隐藏标记——先跑 node client/build.mjs');
  assert.ok(bundle.includes('add-workspace'), '产物必须含 add-workspace 标记');
  assert.ok(!bundle.includes('copy-file'), '产物不应再含复制按钮');
  assert.ok(!bundle.includes('file-guard-toast'), '产物不应再含守卫 toast');
  assert.ok(!bundle.includes('pocket.fileRead'), '产物不应再含 fileRead 端点调用');
  assert.ok(!bundle.includes('stopImmediatePropagation'), '产物不应再含事件拦截');
});

test('CSS 隐藏「添加工作区」图标，且不再有复制按钮样式', () => {
  assert.ok(css.includes('button[aria-label="添加工作区"]'), 'mobile.css.ts 必须隐藏 zh 添加工作区按钮');
  assert.ok(css.includes('button[aria-label="Add workspace"]'), 'mobile.css.ts 必须隐藏 en 添加工作区按钮');
  assert.ok(!css.includes('[data-mobile-nav="copy-file"]'), '复制按钮样式应已删除');
});
