// 回归：公网访问开启失败时，同一条错误被渲染两次。
//
// 失败信息有两条互不相干的前端通道，共享同一个 err.message：
//   ① doStartTunnel 的 catch 调 setError() → 页面底部（「手机端右边栏」说明之后、
//      「恢复出厂设置」之前）渲染 `❌ <原因>`。那条没有区块归属，紧贴在右边栏开关下面，
//      读起来像「这个开关设置失败」；
//   ② service.mjs 把同一句话写进 tunnelState.detail → 3 秒轮询带回前端 →
//      「公网访问」卡片内渲染 `❌ 开启失败：<原因>（可重试；…）`。
//
// 修法：只保留 ②。开机自动恢复隧道失败时用户根本没点过按钮，全局 error 恒为 null，
// 只有 tunnelState 有值 —— 卡片那条才是能覆盖全部场景的通道。
//
// 断言刻意瞄准"哪条通道被写"，而不是"某个字符串还在不在"：底部那条渲染行**必须保留**，
// 恢复出厂设置 / 手机端右边栏开关等其它操作还在用它，删掉会连带丢错误提示。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** 源码与打包产物两处都要查：只改源码不重建，运行的是旧 bundle。 */
const SOURCES = [
  ['client/index.jsx', '../client/index.jsx'],
  ['client/client.js', '../client/client.js'],
]

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 截取 doStartTunnel 的函数体（到下一个同级 const 为止）。源码与 bundle 的写法一致。 */
function doStartTunnelBody(text, file) {
  const start = text.indexOf('const doStartTunnel')
  assert.notEqual(start, -1, file + '：找不到 doStartTunnel')
  const end = text.indexOf('const startTunnel', start)
  assert.notEqual(end, -1, file + '：找不到 doStartTunnel 的结束边界')
  return text.slice(start, end)
}

for (const [file, rel] of SOURCES) {
  test(file + '：开启公网失败只写 tunnelState，不再写全局 error', () => {
    const body = doStartTunnelBody(read(rel), file)

    assert.match(
      body,
      /setTunnelState\(\{\s*phase:\s*['"]error['"]/,
      '失败必须写进 tunnelState（卡片内是唯一展示通道）',
    )
    // setError(null) 是清旧错误，保留；这里禁的是把失败信息塞进全局 error。
    assert.ok(
      !/\bsetError\(\s*(?!null)/.test(body),
      'doStartTunnel 内不允许 setError(失败信息)：页面底部会重复渲染同一条错误',
    )
  })
}

test('卡片内的错误分支仍在（自动恢复失败只靠它，不能连它一起删）', () => {
  const bundle = read('../client/client.js')
  assert.ok(bundle.includes('tunnelPhase === "error"'), 'bundle 保留「公网访问」卡片内的 error 分支')
  assert.ok(bundle.includes('s.tunnelState'), '轮询 load() 仍把服务端 tunnelState 灌进前端状态')
})

test('页面底部的全局错误行保留（恢复出厂 / 右边栏开关等其它操作仍在使用）', () => {
  const bundle = read('../client/client.js')
  assert.ok(bundle.includes('errText(error)'), '全局 error 渲染行仍在')
})
