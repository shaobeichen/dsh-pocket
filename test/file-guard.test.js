// 移动端文件守卫（issue #17 修正）：手机点文件链接会触发桌面 open 失败，改为弹提示；
// 并隐藏「添加工作区」入口。验证接线、稳定选择器、产物行为与入口样式。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const src = readFileSync(new URL('../client/mobile/fileGuard.ts', import.meta.url), 'utf8');
const apply = readFileSync(new URL('../client/mobile/mobile-apply.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../client/mobile/mobile.css.ts', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');

test('fileGuard 只依赖稳定结构（button/a + 路径文案），不依赖 hash 类名', () => {
  assert.ok(src.includes("closest('button, a')"), '必须用 closest("button, a") 找文件链接');
  assert.ok(src.includes('looksLikeFilePath'), '必须用语义化路径检测，而非按类名');
  // hash 类名形如 [class$="_xxx"]；检测逻辑里绝不能出现按类名的属性选择器
  assert.ok(!/\[class[*^$]?=/.test(src), 'fileGuard.ts 的检测不能出现 class 属性选择器（hash 类名每次构建都变）');
});

test('mobile-apply 已接线 startFileGuard（窄屏生效、传入 readFile，且不再接 fileCopy）', () => {
  assert.ok(apply.includes("import { startFileGuard } from './fileGuard.ts'"), '必须 import 模块');
  assert.ok(apply.includes('startFileGuard(readFile)'), '必须调用 startFileGuard 并传入 readFile 回调');
  assert.ok(apply.includes('POCKET_ENDPOINTS.fileRead'), 'readFile 回调必须打到 fileRead 端点');
  assert.ok(apply.includes('getWorkspaceCwd()'), 'readFile 必须携带工作区 cwd 以精确解析相对路径');
  assert.ok(apply.includes("'dsh-mobile-nav: file open guard + copy button + hide add-workspace (issue #17)'"), 'effect 标签应标注 issue #17');
  assert.ok(apply.includes('if (!narrow.matches) return'), '守卫 effect 必须受 narrow 门控');
  assert.ok(!apply.includes('startFileCopyInjection'), '不应再引用已删除的复制按钮模块');
});

test('源码含提示文案与「添加工作区」隐藏文案（产物会被 esbuild 转义，故查源码）', () => {
  // 提示文案
  assert.ok(src.includes('手机上无法直接打开电脑上的文件'), 'fileGuard.ts 必须定义「无法打开」提示文案');
  // 中英双语隐藏标签
  assert.ok(src.includes('添加工作区') && src.includes('Add workspace'), '必须覆盖中英双语的添加工作区入口');
});

test('打包产物含守卫 + 复制按钮结构标记', () => {
  // esbuild 会把单引号规范成双引号、中文转义成 \\uXXXX，故只查 ASCII 结构标记。
  assert.ok(/closest\(\s*["']button, a["']\s*\)/.test(bundle), '产物必须保留 closest("button, a") 检测——先跑 node client/build.mjs');
  assert.ok(bundle.includes('stopImmediatePropagation'), '产物必须能在捕获阶段阻止桌面 open');
  assert.ok(bundle.includes('file-guard-toast'), '产物必须含 toast 标记');
  assert.ok(bundle.includes('add-workspace'), '产物必须含隐藏添加工作区的逻辑');
  // 复制按钮：注入标记 + 经 RPC 读文件（data-mobile-nav-copy 标记已处理链接，避免重复注入）
  assert.ok(bundle.includes('copy-file'), '产物必须含复制按钮标记 data-mobile-nav="copy-file"');
  assert.ok(bundle.includes('data-mobile-nav-copy'), '产物必须用标记避免重复注入复制按钮');
});

test('CSS 隐藏「添加工作区」图标 + 复制按钮样式（窄屏）', () => {
  assert.ok(css.includes('button[aria-label="添加工作区"]'), 'mobile.css.ts 必须隐藏 zh 添加工作区按钮');
  assert.ok(css.includes('button[aria-label="Add workspace"]'), 'mobile.css.ts 必须隐藏 en 添加工作区按钮');
  // 复制按钮样式必须存在（窄屏才注入/显示）
  assert.ok(css.includes('[data-mobile-nav="copy-file"]'), 'mobile.css.ts 必须含复制按钮样式');
});

test('模型控件放行点击且不注入复制按钮，文件链接继续受保护', () => {
  const start = bundle.indexOf('// client/mobile/fileGuard.ts\n');
  const end = bundle.indexOf('// client/mobile/mobile.css.ts\n', start);
  assert.ok(start >= 0 && end > start, '必须测试实际发布的文件守卫');

  for (const model of [true, false]) {
    const attributes = new Map();
    let onClick;
    let copies = 0;
    let blocked = false;
    // DSH 在模型按钮和 portal 菜单项的标签上都带有这两个属性。
    const element = {
      textContent: '[公益]amd/mimo-v2.6-flash',
      closest: () => element,
      querySelector: selector => model && selector === '[data-provider-id][data-model-id]' ? {} : null,
      getAttribute: name => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
      parentElement: { insertBefore: () => { copies++; } },
    };
    const document = {
      body: { appendChild() {} },
      addEventListener: (name, listener) => { if (name === 'click') onClick = listener; },
      removeEventListener() {},
      querySelectorAll: selector => selector === 'button, a' ? [element] : [],
      createElement: () => ({
        style: {},
        setAttribute() {},
        addEventListener() {},
        remove() {},
      }),
    };
    const startFileGuard = runInNewContext(`${bundle.slice(start, end)}\nstartFileGuard`, {
      document,
      window: { setTimeout() {}, clearTimeout() {} },
      requestAnimationFrame: callback => callback(),
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
    });
    const stop = startFileGuard(() => assert.fail('点击模型或文件链接时不应读取文件'));
    try {
      onClick({
        target: element,
        preventDefault: () => { blocked = true; },
        stopImmediatePropagation() {},
      });
      assert.deepEqual({ blocked, copies }, {
        blocked: !model,
        copies: model ? 0 : 1,
      }, model ? '模型控件应正常接收点击' : '同样的路径文案作为文件链接时仍受保护');
    } finally {
      stop();
    }
  }
});
