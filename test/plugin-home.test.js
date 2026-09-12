import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { apply } from '../lib/index.js';
import { POCKET_ENDPOINTS } from '../client/api.js';

async function waitFor(check, message) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await setTimeout(10);
  }
  assert.fail(message);
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pocket-entry-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  const disposers = [];
  t.after(async () => {
    for (const dispose of disposers.reverse()) await dispose();
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  });
  let starts = 0;
  let restores = 0;
  const originalInfo = console.info;
  t.mock.method(console, 'info', (message, ...args) => {
    if (message.includes('public tunnel auto-restored')) restores += 1;
    originalInfo(message, ...args);
  });
  const marker = (home = dir) => join(home, 'dsh-pocket', 'tunnel-auto.json');
  const hasMarker = async (home) => /"at"\s*:/.test(await readFile(marker(home), 'utf8').catch(() => ''));

  function mount({ desktop = false, home } = {}) {
    let handler;
    let proxyReady = false;
    let disposed = false;
    let cleanup;
    const ctx = {
      webServer: { port: 3080 },
      connection: { rpc: { handle: (_channel, fn) => { handler = fn; return () => {}; } } },
      get: (name) => desktop && name === 'desktopProfiles' ? {} : undefined,
      logger: () => ({
        info(message) { if (message.includes('proxy ready')) proxyReady = true; },
        warn() {}, error() {},
      }),
      effect: (callback) => { cleanup = callback(); },
    };
    // Keep the real entry, service, RPC and filesystem. Only the network/process
    // boundaries are replaced; no service or persistence home is injected by default.
    apply(ctx, {}, {
      ...(home === undefined ? {} : { home }),
      createProxy: async () => ({ port: 3081, close: async () => {} }),
      startTunnel: async () => {
        starts += 1;
        return { url: 'https://example.trycloudflare.com', kill() {} };
      },
      lanIPv4: () => '192.168.1.2',
      lanCandidates: async () => ['192.168.1.2'],
      encodeQr: async () => 'data:qr',
    });
    const dispose = async () => { if (!disposed) { disposed = true; await cleanup(); } };
    disposers.push(dispose);
    return {
      ready: () => waitFor(() => proxyReady, 'entry did not start its proxy'),
      call: (endpoint, payload = {}) => handler(endpoint, payload),
      dispose,
    };
  }
  return { dir, mount, hasMarker, starts: () => starts, restores: () => restores };
}

for (const desktop of [false, true]) {
  test(`plugin entry persists and restores tunnels using DSH_HOME (desktop=${desktop})`, async (t) => {
    const f = await fixture(t);
    const first = f.mount({ desktop });
    await first.ready();
    const started = await first.call(POCKET_ENDPOINTS.tunnelStart, { disclaimer: true });
    assert.equal(started.ok, true);
    assert.equal(f.starts(), 1);
    await waitFor(() => f.hasMarker(), 'production entry did not persist the tunnel marker in DSH_HOME');
    await first.dispose();
    assert.equal(await f.hasMarker(), true, 'unloading keeps the restoration marker');

    const restarted = f.mount({ desktop });
    await restarted.ready();
    await waitFor(() => f.restores() === 1, 'new entry did not finish restoring the previous tunnel');
    assert.equal(f.starts(), 2);
    const stopped = await restarted.call(POCKET_ENDPOINTS.tunnelStop);
    assert.equal(stopped.ok, true);
    await waitFor(async () => !await f.hasMarker(), 'manual stop did not clear the marker');
    await restarted.dispose();
  });
}

test('plugin entry preserves an explicit persistence home override', async (t) => {
  const f = await fixture(t);
  const override = join(f.dir, 'override');
  const entry = f.mount({ home: override });
  await entry.ready();
  assert.equal((await entry.call(POCKET_ENDPOINTS.tunnelStart, { disclaimer: true })).ok, true);
  await waitFor(() => f.hasMarker(override), 'explicit persistence home was not used');
  assert.equal(await f.hasMarker(), false, 'DSH_HOME must not replace an explicit home');
});
