// dsh-pocket 核心：Host/Origin 改写反向代理
//
// 为什么需要它：DSH 的 /api 浏览器信任栅栏只认 loopback（127.0.0.1）或
// `--trusted-host` 白名单（且官方禁了 0.0.0.0 绑定，防止把远程执行代码暴露给网络）。
// 本代理把入站请求的 Host / Origin 统一改写成 loopback 权威（127.0.0.1:3080），
// 转发给本机 dsh web——栅栏永远看到 loopback，于是：
//   - 局域网：手机直接访问 http://<电脑IP>:端口
//   - 公网：cloudflared 隧道指到本代理，任意域名都能进
// 都不需要改 dsh 的任何配置。
//
// 同步保证：普通请求与 WebSocket upgrade（/api/events.host 流式推送）都原样透传，
// 手机看到的界面与电脑完全一致、实时。

import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createGzip, createBrotliCompress, constants as zlibConstants } from 'node:zlib';

const DEFAULT_UPSTREAM = { host: '127.0.0.1', port: 3080 };

/**
 * 非安全上下文（http://<LAN-IP>:端口）里浏览器没有 crypto.randomUUID，
 * 前端（DSH 连接层 mint RPC id 用）会直接抛 "crypto.randomUUID is not a function"。
 * 通过代理给 HTML 文档注入 polyfill（只在缺少时生效，用 getRandomValues 实现 v4）。
 * 带 data-dsh-pocket-polyfill 标记：注入判重用它，而不是搜索 "crypto.randomUUID"
 * 字样（dsh 页面源码里可能恰好出现该字符串，导致误判为已注入而跳过）。
 */
const RANDOM_UUID_POLYFILL = `<script data-dsh-pocket-polyfill="1">!function(){try{if(self.crypto&&!self.crypto.randomUUID){self.crypto.randomUUID=function(){var b=new Uint8Array(16);self.crypto.getRandomValues(b);b[6]=b[6]&15|64;b[8]=b[8]&63|128;var h="";for(var i=0;i<16;i++){var x=b[i].toString(16);h+=(x.length<2?"0":"")+x;if(i===3||i===5||i===7||i===9)h+="-";}return h;}}}catch(e){}}();</script>`;

const INJECT_MARK = 'data-dsh-pocket-polyfill="1"';

/**
 * DSH Desktop（桌面版）渲染进程兼容补丁。
 *
 * 桌面版 profile 里的 dsh-plugin-desktop client 会在页面加载时从 URL query 读
 * `dsh-desktop-mode` 与 `dsh-desktop-platform`，缺失即抛
 * "invalid or missing dsh-desktop-mode null" → 页面崩（手机扫码访问桌面版时正是如此，
 * 见 issue #3/#4）。本脚本在页面加载前用 history.replaceState 把这两个参数补上
 * （无跳转、不重载），取最轻的 `compatibility` 模式——不激活桌面布局，避免与
 * 移动端适配叠加。
 * 仅宿主在桌面版（isDesktop）时由 lib/index.js 追加进 injectHtml。
 */
export function desktopEnvPatchScript(platform) {
  const p = ['darwin', 'win32', 'linux'].includes(platform) ? platform : 'linux';
  return `<script data-dsh-pocket-desktop-patch="1">!function(){try{var s=new URLSearchParams(location.search);if(!s.has('dsh-desktop-mode')||!s.has('dsh-desktop-platform')){s.set('dsh-desktop-mode','compatibility');s.set('dsh-desktop-platform','${p}');var u=new URL(location.href);u.search=s.toString();history.replaceState(null,'',u);}}catch(e){}}();</script>`;
}

/** 上游响应是否压缩过（压缩流不能做文本注入，会损坏页面）。 */
function isCompressed(headers) {
  return /(^|,\s*)(gzip|br|deflate)(\s*,|$)/i.test(String(headers['content-encoding'] ?? ''));
}

/** 默认注入到经代理的 HTML 文档里：crypto.randomUUID polyfill（非安全上下文必需）。 */
export const DEFAULT_INJECT = RANDOM_UUID_POLYFILL;

/**
 * DSH Desktop advanced 模式不支持的提示覆盖层（issue #19）。
 * advanced 组合会禁用网页版 ui-layout，而桌面 layout 只在 advanced client 提供——
 * 手机页面被注入 compatibility 后无任何 layout 服务 → 启动白屏（Failed to load plugins）。
 * 该脚本在页面上叠加一个固定警告层，让用户明确知道原因（而不是无解白屏）。
 */
export function advancedNoticeScript() {
  return `<script data-dsh-pocket-advanced-notice="1">!function(){try{var d=document.createElement('div');d.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);color:#fff;font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;padding:24px';d.textContent='DSH Desktop is in advanced mode — phone access is not supported yet. Switch back to compatibility in the desktop app and restart.';document.documentElement.appendChild(d);}catch(e){}}();</script>`;
}

// ---------- 可选访问令牌认证（issue #13） ----------
// 只对公网隧道 Host（trycloudflare.com）强制；局域网免密码。
// 登录成功后种 HttpOnly 会话 cookie（浏览器关闭失效）→ SPA 内部 API/WS 自动携带。
const TOKEN_COOKIE = 'dsh_pocket_token';

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** 登录页：按访问来源显示提示（局域网 / 公网）。 */
function loginPageHtml(error, isPublic) {
  const where = isPublic ? 'This public address' : 'This LAN address';
  const whereEn = isPublic ? 'This public address' : 'This LAN address';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH Pocket · Access</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 24px;max-width:320px;width:calc(100% - 48px);text-align:center}
h1{font-size:16px;margin:0 0 4px;color:#111827}
p{font-size:13px;color:#6b7280;margin:0 0 16px}
input{width:100%;box-sizing:border-box;padding:10px 12px;font-size:18px;letter-spacing:6px;text-align:center;border:1px solid #d1d5db;border-radius:8px;outline:none;margin-bottom:12px}
input:focus{border-color:#4f6ef7}
button{width:100%;padding:10px;font-size:15px;background:#4f6ef7;color:#fff;border:none;border-radius:8px;cursor:pointer}
.err{color:#dc2626;font-size:12px;margin-bottom:10px;min-height:16px}
</style></head><body><div class="card">
<h1>🔐 DSH Pocket</h1>
<p>${where} is password-protected — enter the 8-digit PIN</p>
<div class="err">${error ? 'Wrong PIN, try again' : ''}</div>
<form method="post" action="/pocket-login">
<input name="token" type="password" inputmode="numeric" maxlength="8" autocomplete="one-time-code" autofocus required>
<button type="submit">Enter</button>
</form>
</div></body></html>`;
}

/** 该 Host 是否受访问密码保护（公网隧道；局域网 IP 直连免密码）。 */
function isProtectedHost(host, isProtected) {
  return isProtected ? isProtected(host) : /trycloudflare\.com$/i.test(String(host ?? ''));
}

/** 请求是否期望 HTML（浏览器导航 → 返回登录页；API/WS → 401）。 */
function isHtmlRequest(req) {
  const accept = String(req.headers.accept ?? '');
  return accept.includes('text/html') || req.url === '/' || /\.html?$/i.test(String(req.url));
}

/** 校验请求是否已认证；返回 true 放行。 */
function authCheck(req, token) {
  if (!token) return true; // 无 token（未配置密码）→ 放行
  const cookieTok = parseCookies(req.headers.cookie)[TOKEN_COOKIE];
  if (cookieTok === token) return true;
  const qTok = new URL(req.url ?? '/', 'http://x').searchParams.get('token');
  return qTok === token;
}

/** 把浏览器可见的权威改写成 loopback 权威（Host 和 Origin 都改）。 */
function loopbackAuthority(headers, upstream) {
  const authority = `${upstream.host}:${upstream.port}`;
  headers.Host = authority;
  if (headers.origin) headers.origin = `http://${authority}`;
  if (headers.Origin) headers.Origin = `http://${authority}`;
  return headers;
}

/**
 * 启动 dsh-pocket 代理。
 * @param {object} opts
 * @param {number} [opts.port]      监听端口（默认 3081；dsh web 保持 3080）
 * @param {string} [opts.host]      监听地址（默认 0.0.0.0：LAN 与隧道都能到）
 * @param {{host:string,port:number}} [opts.upstream] 上游 dsh web（默认 127.0.0.1:3080）
 * @param {string} [opts.injectHtml] 注入 HTML 的内容（默认 polyfill + 移动端适配；传 '' 关闭）
 * @param {object} [opts.auth]       可选访问令牌认证（issue #13）：{ getToken, isProtected }
 * @returns {Promise<{server:import('node:http').Server, close:()=>Promise<void>}>}
 */
export function createPocketProxy({ port = 3081, host = '0.0.0.0', upstream = DEFAULT_UPSTREAM, log = null, injectHtml = DEFAULT_INJECT, auth = null } = {}) {
  const server = createServer((req, res) => {
    // 访问令牌认证（issue #13 + #18）：局域网与公网都要求密码
    if (auth) {
      const host = String(req.headers.host ?? '');
      const isPublic = /trycloudflare\.com$/i.test(host);
      const protectedHost = isProtectedHost(host, auth.isProtected);
      const token = protectedHost ? (auth.getToken?.(host) ?? null) : null;
      if (protectedHost && token) {
        // 登录提交：校验密码 → 种 HttpOnly 会话 cookie → 回首页
        if (req.method === 'POST' && req.url?.startsWith('/pocket-login')) {
          let body = '';
          req.on('data', (c) => { body += c; if (body.length > 1024) req.destroy(); });
          req.on('end', () => {
            const submitted = String(new URLSearchParams(body).get('token') ?? '');
            if (submitted === token) {
              res.writeHead(302, {
                location: '/',
                'set-cookie': `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`,
                'cache-control': 'no-store',
              });
              res.end();
            } else {
              res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
              res.end(loginPageHtml(true, isPublic));
            }
          });
          return;
        }
        if (!authCheck(req, token)) {
          if (isHtmlRequest(req)) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(loginPageHtml(false, isPublic));
          } else {
            res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            res.end('{"error":"unauthorized"}');
          }
          return;
        }
      }
    }
    const headers = loopbackAuthority({ ...req.headers }, upstream);
    const proxyReq = httpRequest(
      { host: upstream.host, port: upstream.port, method: req.method, path: req.url, headers, agent: false },
      (proxyRes) => {
        log?.(`${req.method} ${req.url} -> ${proxyRes.statusCode}`);
        const contentType = String(proxyRes.headers['content-type'] ?? '');
        // 只给**未压缩**的 HTML 文档注入（SSE/WS/JS/CSS 原样透传；压缩流注入会损坏页面）；
        // 注入后修正 Content-Length
        if (injectHtml && contentType.includes('text/html') && !isCompressed(proxyRes.headers)) {
          const chunks = [];
          proxyRes.on('data', (c) => chunks.push(c));
          proxyRes.on('end', () => {
            let html = Buffer.concat(chunks).toString('utf8');
            if (!html.includes(INJECT_MARK)) {
              html = html.replace(/<head[^>]*>/i, (m) => `${m}${injectHtml}`);
            }
            const out = Buffer.from(html, 'utf8');
            const outHeaders = { ...proxyRes.headers };
            delete outHeaders['content-length'];
            delete outHeaders['transfer-encoding'];
            outHeaders['content-length'] = String(out.length);
            res.writeHead(proxyRes.statusCode ?? 200, outHeaders);
            res.end(out);
          });
          proxyRes.on('error', () => res.destroy());
          return;
        }
        // 大 JSON/text 响应**流式压缩**（issue #12）：长会话历史一次返回 17MB+，
        // 局域网直连与隧道段都吃满带宽；压缩到 ~1MB。跳过已压缩、SSE 流
        // （/api/events.* 原样透传）、HTML（走上面的注入分支）。
        // brotli 质量选 6（issue #25）：zlib 默认 q11 压 17MB 要 40s+，手机直接超时；
        // q6 实测 128ms（比 gzip 的 88ms 略慢但同档）且输出更小（1.00MB vs 1.20MB）。
        const acceptEncoding = String(req.headers['accept-encoding'] ?? '');
        const canGzip = /\bgzip\b/.test(acceptEncoding);
        const canBr = /\bbr\b/.test(acceptEncoding);
        const isEventStream = contentType.includes('text/event-stream');
        const knownLen = Number(proxyRes.headers['content-length'] || 0);
        const shouldCompress = (canGzip || canBr)
          && !isCompressed(proxyRes.headers)
          && !isEventStream
          && (contentType.includes('application/json') || contentType.startsWith('text/'))
          && (knownLen === 0 || knownLen >= 1024);
        if (shouldCompress) {
          const enc = canBr ? 'br' : 'gzip';
          const outHeaders = { ...proxyRes.headers };
          delete outHeaders['content-length'];
          delete outHeaders['transfer-encoding'];
          outHeaders['content-encoding'] = enc;
          res.writeHead(proxyRes.statusCode ?? 200, outHeaders);
          const z = enc === 'br'
            ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 } })
            : createGzip();
          proxyRes.pipe(z).pipe(res);
          // 任一端断开都要清理（含压缩流）。注意：不能用 proxyRes 的 'close'
          // 来掐 res——正常结束后 close 也会触发，此时压缩流可能还没写完，
          // 会误杀连接；异常中止用 'aborted'。
          res.on('close', () => { proxyRes.destroy(); z.destroy(); });
          proxyRes.on('error', () => { z.destroy(); res.destroy(); });
          proxyRes.on('aborted', () => { z.destroy(); res.destroy(); });
          z.on('error', () => res.destroy());
          return;
        }
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
        // 任一端断开都要清理另一端：客户端断连销毁上游流（不留僵尸），
        // 上游流中途断开也要掐断客户端（否则响应头已发、体没发完 → 悬挂）
        res.on('close', () => proxyRes.destroy());
        proxyRes.on('error', () => res.destroy());
        proxyRes.on('close', () => { if (!res.writableEnded) res.destroy(); });
      },
    );
    proxyReq.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`dsh-pocket: cannot connect to upstream dsh web (${upstream.host}:${upstream.port}) — start dsh web first | ${err.message}`);
    });
    req.pipe(proxyReq);
  });

  // WebSocket upgrade（DSH 的 /api/events.mux + events.host 流式通道）原样透传
  server.on('upgrade', (req, socket, head) => {
    // WebSocket 同样校验（防止绕过 HTTP 认证从 WS 进入）
    if (auth) {
      const host = String(req.headers.host ?? '');
      const token = isProtectedHost(host, auth.isProtected) ? (auth.getToken?.(host) ?? null) : null;
      if (token && !authCheck(req, token)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    const headers = loopbackAuthority({ ...req.headers }, upstream);
    const proxyReq = httpRequest({
      host: upstream.host, port: upstream.port, method: req.method, path: req.url, headers, agent: false,
    });
    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      // 原样回传上游的 upgrade 头（Sec-WebSocket-Accept 等）
      const raw = [];
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        raw.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
      }
      socket.write(`${raw.join('\r\n')}\r\n\r\n`);
      if (proxyHead?.length) socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      // 任一端断开都要清理另一端（避免上游残留僵尸连接占用 dsh 连接槽）
      const teardown = () => { try { proxySocket.destroy(); } catch {} try { socket.destroy(); } catch {} };
      proxySocket.on('close', teardown);
      socket.on('close', teardown);
    });
    // 上游返回普通 HTTP 响应（非 101）：把状态码/头回写后断开，别让客户端永久挂起
    proxyReq.on('response', (proxyRes) => {
      if (proxyRes.statusCode === 101) return; // 理论上 101 走 upgrade 事件
      try {
        const raw = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage ?? ''}`.trim()];
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          raw.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
        }
        // end 会 flush 响应头再 FIN——不要紧跟 destroy()，否则排队的头会被丢弃
        socket.end(raw.join('\r\n') + '\r\n\r\n');
        proxyRes.resume(); // 消费掉上游响应体，释放连接
      } catch { socket.destroy(); }
    });
    proxyReq.on('error', () => socket.destroy());
    // 关键：浏览器在握手请求后可能立即发出首帧（如 mux 流的初始 RPC），
    // node 把它放在 upgrade 事件的 head 里。必须先于 end() 写入 proxyReq，
    // 让上游在 upgrade 事件里就拿到它（与直连行为一致）；等 101 之后再写
    // 会变成迟到的 socket 数据，DSH 的 mux 协议可能错过这个窗口。
    if (head?.length) proxyReq.write(head);
    proxyReq.end();
    socket.on('error', () => socket.destroy());
  });

  // 跟踪所有 TCP 连接（含 WebSocket upgrade 后的 socket——Node 的
  // closeAllConnections 不包含它们，不手动销毁 close() 会永远等）
  const clientSockets = new Set();
  server.on('connection', (sock) => {
    clientSockets.add(sock);
    sock.on('close', () => clientSockets.delete(sock));
    sock.on('error', () => {}); // 防未处理 error 崩进程
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actualPort = server.address().port;
      resolve({
        server,
        port: actualPort,
        close: () => new Promise((r) => {
          for (const s of clientSockets) { try { s.destroy(); } catch { /* 忽略 */ } }
          server.close(() => r());
        }),
      });
    });
  });
}
