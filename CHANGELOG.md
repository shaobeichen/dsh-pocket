# [2.13.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.12.0...v2.13.0) (2026-11-14)


### Bug Fixes

* **client:** 二维码失败提示、composer 几何与抽屉工作区高度 ([#181](https://github.com/shaobeichen/dsh-pocket/issues/181) [#196](https://github.com/shaobeichen/dsh-pocket/issues/196) [#203](https://github.com/shaobeichen/dsh-pocket/issues/203)) ([aa9e28c](https://github.com/shaobeichen/dsh-pocket/commit/aa9e28c9cf7a0cdc347e72134a5f0ed329019249)), closes [#211](https://github.com/shaobeichen/dsh-pocket/issues/211) [#170](https://github.com/shaobeichen/dsh-pocket/issues/170)
* **client:** 公网开启失败只在「公网访问」卡片内显示一次错误 ([#194](https://github.com/shaobeichen/dsh-pocket/issues/194)) ([1db3fa5](https://github.com/shaobeichen/dsh-pocket/commit/1db3fa591a7b3428d3d490f3a9b4666eabd01122)), closes [#159](https://github.com/shaobeichen/dsh-pocket/issues/159)
* **mobile:** 会话头部放不下时改为横向滚动，不再让按钮互相压盖 ([#198](https://github.com/shaobeichen/dsh-pocket/issues/198)) ([f0bc21e](https://github.com/shaobeichen/dsh-pocket/commit/f0bc21e98cf3dfcbbaece0b2d1f38a5fca11019f))
* **mobile:** 只在桌面宿主隐藏「添加工作区」，CLI/Linux 保留入口 ([#205](https://github.com/shaobeichen/dsh-pocket/issues/205)) ([458a79d](https://github.com/shaobeichen/dsh-pocket/commit/458a79d1932c7d28d307647d34446aae334c7703)), closes [#197](https://github.com/shaobeichen/dsh-pocket/issues/197)
* **mobile:** 清理过时的文件链接处理（去掉「无法打开」拦截与「复制」按钮，删除 pocket.fileRead） ([#197](https://github.com/shaobeichen/dsh-pocket/issues/197)) ([f8c40d6](https://github.com/shaobeichen/dsh-pocket/commit/f8c40d6e1a5ca74b215c53f942a86082a4b5c556))
* **mobile:** 让 body 级 portal 浮层压过抽屉，修复「更多」菜单被遮挡 ([#191](https://github.com/shaobeichen/dsh-pocket/issues/191)) ([e1a24a1](https://github.com/shaobeichen/dsh-pocket/commit/e1a24a1a3f231d120fae57a6ec5138c23a8f19ba))
* **mobile:** 适配 DSH 0.2.2 自带抽屉，按类名定位 AppFrame 列 ([#200](https://github.com/shaobeichen/dsh-pocket/issues/200)) ([6db75aa](https://github.com/shaobeichen/dsh-pocket/commit/6db75aace0344dea1704173cc50b4d758c85743e)), closes [191/#198](https://github.com/shaobeichen/dsh-pocket/issues/198) [#191](https://github.com/shaobeichen/dsh-pocket/issues/191) [179/#215](https://github.com/shaobeichen/dsh-pocket/issues/215) [#207](https://github.com/shaobeichen/dsh-pocket/issues/207) [#208](https://github.com/shaobeichen/dsh-pocket/issues/208) [#209](https://github.com/shaobeichen/dsh-pocket/issues/209) [#222](https://github.com/shaobeichen/dsh-pocket/issues/222)
* **proxy:** recover rejected DSH browser sessions ([#217](https://github.com/shaobeichen/dsh-pocket/issues/217)) ([0ad6c4b](https://github.com/shaobeichen/dsh-pocket/commit/0ad6c4b1929123e020d59c4884e225eba70840e2))
* **proxy:** 精确判定会话 cookie 并放宽 WS 心跳容忍度 ([#185](https://github.com/shaobeichen/dsh-pocket/issues/185) [#221](https://github.com/shaobeichen/dsh-pocket/issues/221)) ([7b7cc7f](https://github.com/shaobeichen/dsh-pocket/commit/7b7cc7fe8c1529d59ca000e066f3ab748749976c))


### Features

* **i18n:** add Japanese (ja) locale ([#192](https://github.com/shaobeichen/dsh-pocket/issues/192)) ([f0236cc](https://github.com/shaobeichen/dsh-pocket/commit/f0236cc80d117f9efa99844b937adc114897eee0))
* **settings:** mask access PINs by default with show/hide toggle ([#179](https://github.com/shaobeichen/dsh-pocket/issues/179)) ([88a1429](https://github.com/shaobeichen/dsh-pocket/commit/88a1429981e8a44df1dd51f76d12912f14ab7beb))
* **tunnel:** 就绪度探活 + 自动重建，修复「进程活着但边缘失联」导致手机 1016 且不自愈 ([#215](https://github.com/shaobeichen/dsh-pocket/issues/215)) ([3c89245](https://github.com/shaobeichen/dsh-pocket/commit/3c89245c6fac3241f6572b705b63009b7370295e)), closes [#45](https://github.com/shaobeichen/dsh-pocket/issues/45)
* 支持 settings.json blacklist 字段，按网卡名或 IP 排除自动选择的网卡 ([#182](https://github.com/shaobeichen/dsh-pocket/issues/182)) ([9eb8f69](https://github.com/shaobeichen/dsh-pocket/commit/9eb8f693a337311395b4064c567851e8d5abd828))

# [2.12.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.11.0...v2.12.0) (2026-10-17)


### Bug Fixes

* allow clearing custom public and lan access pins ([c6e2ce1](https://github.com/shaobeichen/dsh-pocket/commit/c6e2ce19d304f87d1b4d67ca4aeee0ce9b8b87ee)), closes [#166](https://github.com/shaobeichen/dsh-pocket/issues/166)
* **client:** release the stats band for real when pocketStats is opte… ([8e60d4e](https://github.com/shaobeichen/dsh-pocket/commit/8e60d4ef40b4c7ada8904809f01450e278c40bbe)), closes [#172](https://github.com/shaobeichen/dsh-pocket/issues/172) [#172](https://github.com/shaobeichen/dsh-pocket/issues/172) [#165](https://github.com/shaobeichen/dsh-pocket/issues/165) [#172](https://github.com/shaobeichen/dsh-pocket/issues/172) [#175](https://github.com/shaobeichen/dsh-pocket/issues/175)
* **client:** 设置页开关圆钮硬编码 #fff，深色主题下白钮贴白轨看不出状态 ([f24c6de](https://github.com/shaobeichen/dsh-pocket/commit/f24c6de9ac3c6f88b8f50284819b95ad65a55405)), closes [#4f6ef7](https://github.com/shaobeichen/dsh-pocket/issues/4f6ef7) [#d1d5db](https://github.com/shaobeichen/dsh-pocket/issues/d1d5db) [21/#20](https://github.com/shaobeichen/dsh-pocket/issues/20) [#e6e8eb](https://github.com/shaobeichen/dsh-pocket/issues/e6e8eb) [#3a3f46](https://github.com/shaobeichen/dsh-pocket/issues/3a3f46) [#0f1115](https://github.com/shaobeichen/dsh-pocket/issues/0f1115) [#8b9198](https://github.com/shaobeichen/dsh-pocket/issues/8b9198) [#fff](https://github.com/shaobeichen/dsh-pocket/issues/fff) [#fff](https://github.com/shaobeichen/dsh-pocket/issues/fff) [#178](https://github.com/shaobeichen/dsh-pocket/issues/178)
* **desktop:** 用 Electron 运行时特征判定 isDesktop ([#177](https://github.com/shaobeichen/dsh-pocket/issues/177)) ([41245a9](https://github.com/shaobeichen/dsh-pocket/commit/41245a9fc6e4dd89d37ea974e2a99841d78d0826))
* **lan:** 排除 Windows 移动热点/ICS 虚拟网卡 (selectLanIPv4 [#176](https://github.com/shaobeichen/dsh-pocket/issues/176)) ([a80c5d3](https://github.com/shaobeichen/dsh-pocket/commit/a80c5d3cf45f195bea3d5b36ab7998bc2bc042ca))
* **mobile:** 360px composer 底栏允许换行 ([#170](https://github.com/shaobeichen/dsh-pocket/issues/170)) ([db1ddaf](https://github.com/shaobeichen/dsh-pocket/commit/db1ddafb7f17a78082eb6e1a1d119ff31fcefc01))
* **mobile:** 手机工作区图标崩溃——新增 icon-compat 兼容层 ([#161](https://github.com/shaobeichen/dsh-pocket/issues/161)/[#171](https://github.com/shaobeichen/dsh-pocket/issues/171)) ([dc9d5dc](https://github.com/shaobeichen/dsh-pocket/commit/dc9d5dc9cda6af1c41f0055c0217a788350078f3)), closes [#140](https://github.com/shaobeichen/dsh-pocket/issues/140)
* **proxy:** 公网隧道继承本机代理环境变量导致 1033 通道错误 ([9f91e54](https://github.com/shaobeichen/dsh-pocket/commit/9f91e54d1e1e8679f45a7ca0e54d429f41593fa1))
* **proxy:** 远程访问也能用「设置 → 模型」（issue [#58](https://github.com/shaobeichen/dsh-pocket/issues/58)） ([48297a7](https://github.com/shaobeichen/dsh-pocket/commit/48297a75187e8114b7bc314536678a712a4944be)), closes [#100](https://github.com/shaobeichen/dsh-pocket/issues/100) [#130](https://github.com/shaobeichen/dsh-pocket/issues/130) [#150](https://github.com/shaobeichen/dsh-pocket/issues/150) [#151](https://github.com/shaobeichen/dsh-pocket/issues/151) [#169](https://github.com/shaobeichen/dsh-pocket/issues/169)


### Features

* **auth:** improve PIN autofill and password visibility ([8b9c27a](https://github.com/shaobeichen/dsh-pocket/commit/8b9c27a56395e8693dc8c3a723841ca052a09283)), closes [#168](https://github.com/shaobeichen/dsh-pocket/issues/168)

# [2.11.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.6...v2.11.0) (2026-10-12)


### Bug Fixes

* **docs:** 在 README 中添加 Trendshift badge ([ffe894e](https://github.com/shaobeichen/dsh-pocket/commit/ffe894e842867d4ef297e80d47011c6377d583e7))
* **mobile:** avoid locale namespace clash with dsh-web-mobile and scope stats strip ([#162](https://github.com/shaobeichen/dsh-pocket/issues/162), [#165](https://github.com/shaobeichen/dsh-pocket/issues/165)) ([d917a77](https://github.com/shaobeichen/dsh-pocket/commit/d917a7760093693555d590b81fca54e29971dfb3))
* **mobile:** restore right sidebar entry ([d2e0b46](https://github.com/shaobeichen/dsh-pocket/commit/d2e0b4680b7c1e3d6ef5ef84fcae5980d935a03f)), closes [#122](https://github.com/shaobeichen/dsh-pocket/issues/122)
* **tunnel:** use the DSH home for plugin auto-restore state ([cab1e24](https://github.com/shaobeichen/dsh-pocket/commit/cab1e24cee3b7930a0158488633e0a6d2070f842)), closes [#121](https://github.com/shaobeichen/dsh-pocket/issues/121)


### Features

* **auth:** allow longer custom access PINs ([230039f](https://github.com/shaobeichen/dsh-pocket/commit/230039fdba07feee2ba28754fabd8b74b5986ad8))

## [2.10.6](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.5...v2.10.6) (2026-09-10)


### Bug Fixes

* **mobile:** 替换手机端模型设置加载失败提示为引导信息，增加本地真机冒烟测试 ([5ab2ad4](https://github.com/shaobeichen/dsh-pocket/commit/5ab2ad444ba276c5df2bf87fa104c4b16b2081f9))

## [2.10.5](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.4...v2.10.5) (2026-09-10)


### Bug Fixes

* **rpc:** 以方法形式调用 requestRejection 保留 this 绑定，修复 /dsh-pocket/* 全部 403（issue [#117](https://github.com/shaobeichen/dsh-pocket/issues/117)） ([282f71c](https://github.com/shaobeichen/dsh-pocket/commit/282f71c1d844b0e6123b9c976ad0401c3c4a84e7))

## [2.10.4](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.3...v2.10.4) (2026-09-10)


### Bug Fixes

* **client:** prevent iOS Safari input auto-zoom on mobile ([8d5b3fa](https://github.com/shaobeichen/dsh-pocket/commit/8d5b3fa1a14385816e61f92bd83fb239f7d8e74f)), closes [#114](https://github.com/shaobeichen/dsh-pocket/issues/114)
* **mobile:** 侧边栏先开后弹出 aria-modal 弹窗时自动收起，修复卡死 ([#99](https://github.com/shaobeichen/dsh-pocket/issues/99)) ([f2e60b0](https://github.com/shaobeichen/dsh-pocket/commit/f2e60b0eb03ac1b065788e231590a56316a7cfcf))
* **proxy:** shim transport.createApiClient for dsh 0.1.1-rc.2 (issue [#96](https://github.com/shaobeichen/dsh-pocket/issues/96)) ([61cadf8](https://github.com/shaobeichen/dsh-pocket/commit/61cadf871ec817f51135277b7fb3085d9492959e))
* **proxy:** 移除与 DSH Desktop 2.0.4+ 不兼容的 LOOPBACK_ENV_PATCH，修复远程/手机访问白屏 ([#105](https://github.com/shaobeichen/dsh-pocket/issues/105)) ([a1b813d](https://github.com/shaobeichen/dsh-pocket/commit/a1b813d854da5900b55c5893f3190a272cd4a0fc)), closes [#100](https://github.com/shaobeichen/dsh-pocket/issues/100) [#58](https://github.com/shaobeichen/dsh-pocket/issues/58)
* **rpc:** 适配 dsh v0.1.5-alpha.1 的 webServer inject 收缩，堵住启动崩溃 ([#112](https://github.com/shaobeichen/dsh-pocket/issues/112)) ([2ac8efd](https://github.com/shaobeichen/dsh-pocket/commit/2ac8efdb46de19959c1fc59eeddf2f12b42cb909)), closes [#109](https://github.com/shaobeichen/dsh-pocket/issues/109) [#113](https://github.com/shaobeichen/dsh-pocket/issues/113) [#111](https://github.com/shaobeichen/dsh-pocket/issues/111)
* **security:** 收紧限速身份键与登录比较，修隧道失败态残留，移除已删功能的 README 残留 ([517eb00](https://github.com/shaobeichen/dsh-pocket/commit/517eb004ce869f5e140159dfa118ab833a37fd6c)), closes [#69](https://github.com/shaobeichen/dsh-pocket/issues/69)
* **tunnel:** 进程退出不再清除自动恢复标记，修复重启后公网隧道不自动恢复 ([#107](https://github.com/shaobeichen/dsh-pocket/issues/107)) ([db1e5c4](https://github.com/shaobeichen/dsh-pocket/commit/db1e5c418cae91ae1e56f4d6c5c05413ddea02c2)), closes [#11](https://github.com/shaobeichen/dsh-pocket/issues/11) [#106](https://github.com/shaobeichen/dsh-pocket/issues/106)

## [2.10.3](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.2...v2.10.3) (2026-09-03)


### Bug Fixes

* **security:** CLI 模式默认开启访问密码，堵住 0.0.0.0 上的无认证访问（issue [#90](https://github.com/shaobeichen/dsh-pocket/issues/90) [#8](https://github.com/shaobeichen/dsh-pocket/issues/8)） ([5d3a6d0](https://github.com/shaobeichen/dsh-pocket/commit/5d3a6d03e4e1c4fe84626fd3dfd7a4fec28641cc))

## [2.10.2](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.1...v2.10.2) (2026-09-03)


### Bug Fixes

* **mobile:** restore compact usable composer ([#89](https://github.com/shaobeichen/dsh-pocket/issues/89)) ([#93](https://github.com/shaobeichen/dsh-pocket/issues/93)) ([5c56d24](https://github.com/shaobeichen/dsh-pocket/commit/5c56d24c2953022c4300973627dae4d3aebcfbb2))
* **mobile:** snap composer popups to viewport sheet; scroll containers clipped them half-visible on phones ([#88](https://github.com/shaobeichen/dsh-pocket/issues/88)) ([7209de8](https://github.com/shaobeichen/dsh-pocket/commit/7209de8540cf324dd578b18f10bec6b1ff8ea3c4))
* **mobile:** 触摸切换会话等宿主完成导航后再关抽屉 ([#85](https://github.com/shaobeichen/dsh-pocket/issues/85)) ([80b9d16](https://github.com/shaobeichen/dsh-pocket/commit/80b9d16369e3e33457afe8d9c1a48dfa42dc4397)), closes [#84](https://github.com/shaobeichen/dsh-pocket/issues/84)
* **proxy:** loopback trust patch so remote browsers can load settings (issue [#58](https://github.com/shaobeichen/dsh-pocket/issues/58)) ([#87](https://github.com/shaobeichen/dsh-pocket/issues/87)) ([1d67152](https://github.com/shaobeichen/dsh-pocket/commit/1d67152a8a1808d36743162ff24abe3a061cedcd))
* **security:** 堵住 ?token=/WS 的限速旁路，PIN 改 CSPRNG，Host 头伪造按源地址收紧（issue [#90](https://github.com/shaobeichen/dsh-pocket/issues/90)） ([0bfe15a](https://github.com/shaobeichen/dsh-pocket/commit/0bfe15a56c2063e14f1eea5de2ef0cd4e1e54b0d))

## [2.10.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.0...v2.10.1) (2026-09-03)


### Bug Fixes

* **proxy:** 打断 Safari 局域网入口的 303 无限重定向（issue [#91](https://github.com/shaobeichen/dsh-pocket/issues/91)） ([4dd4c01](https://github.com/shaobeichen/dsh-pocket/commit/4dd4c017d5ad4b11ac003058dbda1d8d6507f079))

# [2.10.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.9.1...v2.10.0) (2026-08-30)


### Features

* **security:** 移除会话指纹防钓鱼机制（issue [#82](https://github.com/shaobeichen/dsh-pocket/issues/82)/[#83](https://github.com/shaobeichen/dsh-pocket/issues/83) 后续） ([8f91960](https://github.com/shaobeichen/dsh-pocket/commit/8f91960a8379ac7ec16a7c3577ff0134cb2f6204))

## [2.9.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.9.0...v2.9.1) (2026-08-30)


### Bug Fixes

* **security:** 防钓鱼校验只在公网启用，局域网不再误报（issue [#83](https://github.com/shaobeichen/dsh-pocket/issues/83)） ([059163e](https://github.com/shaobeichen/dsh-pocket/commit/059163e26457a15a9f9ce1b21aea539db9ecb803))

# [2.9.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.8.0...v2.9.0) (2026-08-30)


### Bug Fixes

* **auth:** Tailscale/CGNAT(100.64/10) 与手动局域网地址覆盖走局域网密码（issue [#79](https://github.com/shaobeichen/dsh-pocket/issues/79)） ([e3c2e7b](https://github.com/shaobeichen/dsh-pocket/commit/e3c2e7b97700b375bdc17a68ed3523588796ba21)), closes [#66](https://github.com/shaobeichen/dsh-pocket/issues/66)
* **tunnel:** 把 --no-autoupdate 移到全局位置，兼容 cloudflared 2026.x（issue [#78](https://github.com/shaobeichen/dsh-pocket/issues/78)） ([4abc6b9](https://github.com/shaobeichen/dsh-pocket/commit/4abc6b9f9400443bc691d52e7e13c2f7b93aee58))


### Features

* **proxy:** 上游桌面门禁 403 forbidden 对导航请求返回可操作提示页（issue [#81](https://github.com/shaobeichen/dsh-pocket/issues/81)） ([ff003b6](https://github.com/shaobeichen/dsh-pocket/commit/ff003b66a63f55eebc10b4b96f06b2b1984fdc8c))
* **security:** 公网会话指纹 + 链接 ephemeral 提示，防快速隧道子域复用跳陌生站点（issue [#82](https://github.com/shaobeichen/dsh-pocket/issues/82)） ([5bfc039](https://github.com/shaobeichen/dsh-pocket/commit/5bfc0399a1c4d6765fdc815043b6861b08ad5267))

# [2.8.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.7.1...v2.8.0) (2026-08-29)


### Bug Fixes

* **mobile:** 去掉 isInsidePocket 误杀，让对话文件链接在手机上弹提示并注入复制按钮（issue [#17](https://github.com/shaobeichen/dsh-pocket/issues/17)） ([5fca020](https://github.com/shaobeichen/dsh-pocket/commit/5fca0202623df513e11b4654868210f287ea6ffd))


### Features

* **mobile:** 文件链接旁「复制」按钮经主机 RPC 读取正文（issue [#17](https://github.com/shaobeichen/dsh-pocket/issues/17) 内容复制） ([06f69fd](https://github.com/shaobeichen/dsh-pocket/commit/06f69fdef5fd1706846d433ece8bc10944549563))

## [2.7.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.7.0...v2.7.1) (2026-08-29)


### Bug Fixes

* **mobile:** 移动端拦截文件链接点击改提示、隐藏添加工作区，移除冗余复制按钮（issue [#17](https://github.com/shaobeichen/dsh-pocket/issues/17)） ([96ed896](https://github.com/shaobeichen/dsh-pocket/commit/96ed896201045b009068b198e6f5f444a43cfb23))

# [2.7.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.6.3...v2.7.0) (2026-08-29)


### Features

* **mobile:** 文件块支持「复制内容」按钮（issue [#17](https://github.com/shaobeichen/dsh-pocket/issues/17)），移除放大输入 ([c7351ac](https://github.com/shaobeichen/dsh-pocket/commit/c7351acefb8f78b2c26218d812d59a648cd22c7d))

## [2.6.3](https://github.com/shaobeichen/dsh-pocket/compare/v2.6.2...v2.6.3) (2026-08-29)


### Bug Fixes

* 移除临时访问 PIN 功能并修复撤销时的崩溃 ([238864c](https://github.com/shaobeichen/dsh-pocket/commit/238864c92999f73b2a42c103163180053fd10c49)), closes [#69](https://github.com/shaobeichen/dsh-pocket/issues/69)

## [2.6.2](https://github.com/shaobeichen/dsh-pocket/compare/v2.6.1...v2.6.2) (2026-08-29)


### Bug Fixes

* **client:** 补上 MobileComposerFullscreen 缺的 import（P0） ([a71319d](https://github.com/shaobeichen/dsh-pocket/commit/a71319dd66f6b3e70a8f904ce3dca236e6615dbd))

## [2.6.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.6.0...v2.6.1) (2026-08-29)


### Bug Fixes

* **tunnel:** linux 改用裸二进制，不再下载上游已下架的 .tgz (issue [#45](https://github.com/shaobeichen/dsh-pocket/issues/45)) ([26bdb69](https://github.com/shaobeichen/dsh-pocket/commit/26bdb69a9dc8480c67d99bc4dba76fcdc79052e0))

# [2.6.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.5.1...v2.6.0) (2026-08-29)


### Features

* **mobile:** 'expand composer' button on phone (issue [#23](https://github.com/shaobeichen/dsh-pocket/issues/23)) ([ec6f115](https://github.com/shaobeichen/dsh-pocket/commit/ec6f115655964fca882df1e99171cbb5fc59efab))

## [2.5.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.5.0...v2.5.1) (2026-08-29)


### Bug Fixes

* **proxy:** support `?token=<raw pin>` and seed the auth cookie (issue [#35](https://github.com/shaobeichen/dsh-pocket/issues/35)) ([734afbd](https://github.com/shaobeichen/dsh-pocket/commit/734afbdb800ed4b2a1d4dff085cdf2ef074917db))

# [2.5.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.4.0...v2.5.0) (2026-08-29)


### Bug Fixes

* **proxy:** 转发前清掉历史遗留的 dsh-desktop-* 参数 (issue [#75](https://github.com/shaobeichen/dsh-pocket/issues/75)) ([8979594](https://github.com/shaobeichen/dsh-pocket/commit/89795940e2aeb28675b79a1541862331fe3aef5f))


### Features

* **tunnel:** honor a custom cloudflared path (issue [#45](https://github.com/shaobeichen/dsh-pocket/issues/45)) ([b9c0c9f](https://github.com/shaobeichen/dsh-pocket/commit/b9c0c9f0ea37aecdcf004fccfb9e0f5bfc1fd381)), closes [#proxy](https://github.com/shaobeichen/dsh-pocket/issues/proxy)

# [2.4.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.3.0...v2.4.0) (2026-08-29)


### Features

* **auth:** temporary access PINs with auto-expiry (issue [#69](https://github.com/shaobeichen/dsh-pocket/issues/69)) ([965195e](https://github.com/shaobeichen/dsh-pocket/commit/965195e21841e3cfba719e6d6bf6424036e149ad))

# [2.3.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.2.0...v2.3.0) (2026-08-29)


### Features

* **proxy:** make the proxy port configurable from settings.json (issue [#70](https://github.com/shaobeichen/dsh-pocket/issues/70)) ([20bb1b5](https://github.com/shaobeichen/dsh-pocket/commit/20bb1b50eaa06a0d7070e97f516cc44d3cdc475b))

# [2.2.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.1.4...v2.2.0) (2026-08-29)


### Features

* **mobile:** add layout mode switch for wide-screen phones (issue [#74](https://github.com/shaobeichen/dsh-pocket/issues/74)) ([018aef0](https://github.com/shaobeichen/dsh-pocket/commit/018aef0db644093a13d6cb1db427655138c86799))

## [2.1.4](https://github.com/shaobeichen/dsh-pocket/compare/v2.1.3...v2.1.4) (2026-08-29)


### Bug Fixes

* **mobile:** 抽屉层级压过 dsh-web-ui-all 的全屏遮罩 (issue [#67](https://github.com/shaobeichen/dsh-pocket/issues/67)) ([88605d9](https://github.com/shaobeichen/dsh-pocket/commit/88605d93a145af61e345f91b96db2850bb8f1e56))

## [2.1.3](https://github.com/shaobeichen/dsh-pocket/compare/v2.1.2...v2.1.3) (2026-08-29)


### Bug Fixes

* **mobile:** 抽屉里的工作区菜单点不动，并给 iOS 触摸加自愈 (issue [#72](https://github.com/shaobeichen/dsh-pocket/issues/72)) ([9f7c427](https://github.com/shaobeichen/dsh-pocket/commit/9f7c4279049c499f2f33b6ded45f2bd92625b476))

## [2.1.2](https://github.com/shaobeichen/dsh-pocket/compare/v2.1.1...v2.1.2) (2026-08-29)


### Bug Fixes

* **desktop:** stop injecting dsh-desktop-* markers into proxied pages ([17c2d97](https://github.com/shaobeichen/dsh-pocket/commit/17c2d97e6c2da5951a11e171efdd1e436184b04c)), closes [3/#4](https://github.com/shaobeichen/dsh-pocket/issues/4)

## [2.1.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.1.0...v2.1.1) (2026-08-29)


### Bug Fixes

* **proxy:** complete the dsh web browser-session handshake (issue [#77](https://github.com/shaobeichen/dsh-pocket/issues/77)) ([ffc12dd](https://github.com/shaobeichen/dsh-pocket/commit/ffc12ddfcd2113ee4ba80424b2346efee85c0c0f))

# [2.1.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.0.0...v2.1.0) (2026-08-29)


### Bug Fixes

* **ui:** center the toast and narrow it to 280px ([2bcaff0](https://github.com/shaobeichen/dsh-pocket/commit/2bcaff0a3db7847f4cc9941293026ab78b1398c4))
* **ui:** show only the current language half of backend error messages ([bd79283](https://github.com/shaobeichen/dsh-pocket/commit/bd79283d5bad1888933a9fceda886204f59d450c))


### Features

* **pocket:** factory reset entry at the bottom of the settings page ([672b31b](https://github.com/shaobeichen/dsh-pocket/commit/672b31ba04083e4223c15ef1f326fab9a6e5faf7))
* **ui:** toast feedback after factory reset ([074744d](https://github.com/shaobeichen/dsh-pocket/commit/074744d2524584e48de19fdc1b301e85cbd7623e))

# [2.0.0](https://github.com/shaobeichen/dsh-pocket/compare/v1.16.1...v2.0.0) (2026-08-29)


* feat!: redesign settings page layout into structured cards ([1b7d494](https://github.com/shaobeichen/dsh-pocket/commit/1b7d494554ed80eadd701c1e2574760ff130580c))


### BREAKING CHANGES

* the settings page DOM structure and locale keys changed
(lanAddressHint removed; wanAccess/pinLabel/modeLabel/advAddress/
wanOffHint added). Custom styles or scripts targeting the old settings
DOM/keys need updating.

## [1.16.1](https://github.com/shaobeichen/dsh-pocket/compare/v1.16.0...v1.16.1) (2026-08-29)


### Bug Fixes

* **ui:** mode selector only after public access enabled; selected-state highlight; drop lan address hint ([cf6abc0](https://github.com/shaobeichen/dsh-pocket/commit/cf6abc091ac398158e9e8213d9bddcf554b8f87a)), closes [#66](https://github.com/shaobeichen/dsh-pocket/issues/66)

# [1.16.0](https://github.com/shaobeichen/dsh-pocket/compare/v1.15.0...v1.16.0) (2026-08-29)


### Features

* **tunnel:** named tunnel mode (fixed public hostname) + fail-closed host trust boundary ([a7bf98e](https://github.com/shaobeichen/dsh-pocket/commit/a7bf98e54b25e59d03c6dc03c08bc2b4a74d84f5))

# [1.15.0](https://github.com/shaobeichen/dsh-pocket/compare/v1.14.5...v1.15.0) (2026-08-29)


### Bug Fixes

* **ci:** drop setup-node registry-url to avoid .npmrc conflict with semantic-release ([bb41482](https://github.com/shaobeichen/dsh-pocket/commit/bb41482cf499533741cd22a28b5004be253d4f4f))


### Features

* **pin:** allow 8-char alphanumeric custom PINs (letters + digits) ([527abba](https://github.com/shaobeichen/dsh-pocket/commit/527abbac7097a4b7748180ec093f6d5f48a8ce39)), closes [#33](https://github.com/shaobeichen/dsh-pocket/issues/33)
