import { once } from 'node:events';
import { createServer, request } from 'node:http';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPocketProxy } from '../lib/proxy.mjs';

async function fixture(t, handler, options = {}) {
  const upstream = createServer(handler);
  t.after(async () => {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const proxy = await createPocketProxy({
    port: 0,
    host: '127.0.0.1',
    upstream: { host: '127.0.0.1', port: upstream.address().port },
    ...options,
  });
  t.after(() => proxy.close());
  return proxy;
}

function clientRequest(t, proxy, options = {}) {
  const client = request({ host: '127.0.0.1', port: proxy.port, path: '/api/session/search', ...options });
  const closed = new Promise((resolve) => client.once('close', resolve));
  client.on('error', (error) => {
    assert.equal(error.code, 'ECONNRESET');
  });
  t.after(async () => {
    client.destroy();
    await closed;
  });
  return { client, closed };
}

for (const method of ['GET', 'POST']) {
  test(`cancelling ${method} before response headers closes the upstream request`, async (t) => {
    const received = Promise.withResolvers();
    const proxy = await fixture(t, (req, res) => {
      req.resume();
      req.once('end', () => received.resolve({ req, res }));
    });
    const { client, closed } = clientRequest(t, proxy, { method });
    client.end(method === 'POST' ? JSON.stringify({ query: 'fixture' }) : undefined);
    const upstream = await received.promise;
    assert.equal(upstream.req.complete, true);
    assert.equal(upstream.res.headersSent, false);
    const cancelled = once(upstream.res, 'close', { signal: AbortSignal.timeout(2_000) });

    client.destroy();
    await closed;
    await cancelled;

    assert.equal(upstream.res.destroyed, true);
    assert.equal(upstream.req.socket.destroyed, true);
  });
}

test('cancelling an unfinished upload closes the upstream without an unhandled error', async (t) => {
  const received = Promise.withResolvers();
  const proxy = await fixture(t, (req, res) => {
    req.on('error', (error) => assert.equal(error.code, 'ECONNRESET'));
    req.once('data', () => received.resolve({ req, res }));
  });
  const { client, closed } = clientRequest(t, proxy, { method: 'POST', headers: { 'content-length': '1000' } });
  client.write('partial');
  const upstream = await received.promise;
  assert.equal(upstream.req.complete, false);
  const cancelled = once(upstream.res, 'close', { signal: AbortSignal.timeout(2_000) });

  client.destroy();
  await closed;
  await cancelled;

  assert.equal(upstream.req.socket.destroyed, true);
});

for (const scenario of [
  { name: 'buffered HTML', status: 200, type: 'text/html', body: '<html><head></head><body>pending' },
  { name: 'buffered 403', status: 403, type: 'text/plain', body: 'forbid' },
  { name: 'compressed JSON', status: 200, type: 'application/json', body: '{"pending":"' + 'fixture '.repeat(2000) },
]) {
  test(`cancelling a ${scenario.name} response closes the upstream`, async (t) => {
    const headers = Promise.withResolvers();
    let upstream;
    const proxy = await fixture(t, (req, res) => {
      upstream = res;
      res.writeHead(scenario.status, { 'content-type': scenario.type });
      res.write(scenario.body);
    }, { log: () => headers.resolve() });
    const { client, closed } = clientRequest(t, proxy, {
      headers: { accept: 'text/html', 'accept-encoding': 'gzip' },
    });
    client.end();
    await headers.promise;
    const cancelled = once(upstream, 'close', { signal: AbortSignal.timeout(2_000) });

    client.destroy();
    await closed;
    await cancelled;

    assert.equal(upstream.destroyed, true);
  });
}

test('a completed request body keeps waiting for its delayed response', async (t) => {
  const received = Promise.withResolvers();
  const proxy = await fixture(t, (req, res) => {
    req.resume();
    req.once('end', () => received.resolve(res));
  });
  const { client } = clientRequest(t, proxy, { method: 'POST' });
  const response = once(client, 'response');
  client.end('complete');
  const upstream = await received.promise;
  upstream.writeHead(200, { 'content-type': 'application/json' });
  upstream.end('{"ok":true}');
  const [res] = await response;
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  assert.equal(res.statusCode, 200);
  assert.equal(Buffer.concat(chunks).toString('utf8'), '{"ok":true}');
});
