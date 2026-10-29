import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createService } from '../server/main.js';

const node = 'vless://12345678-1234-1234-1234-123456789abc@example.com:443?security=tls#demo';
async function fixture(t, overrides = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'subscription-test-'));
    const config = { TOKEN: 'test-token', DATABASE_PATH: join(dir, 'nodes.sqlite'), INITIAL_LINKS_BASE64: Buffer.from(node).toString('base64'), ...overrides };
    const app = await createService(config);
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    t.after(async () => { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); app.kv.close(); await rm(dir, { recursive: true, force: true }); });
    return { ...app, origin, config };
}
test('Node runtime serves the original Base64 nodes using SQLite and native MD5', async t => {
    const app = await fixture(t);
    const response = await fetch(app.origin + '/test-token?b64');
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.text(), 'base64').toString().trim(), node);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await (await fetch(app.origin + '/healthz')).json(), { status: 'ok', publicOriginConfigured: false });
});
test('Node runtime refuses anonymous admin and legacy token writes', async t => {
    const app = await fixture(t);
    assert.equal((await fetch(app.origin + '/admin')).status, 403);
    assert.equal((await fetch(app.origin + '/admin/api/links', { method: 'POST', body: 'changed', headers: { 'Cf-Access-Jwt-Assertion': 'fake' } })).status, 403);
    assert.equal((await fetch(app.origin + '/test-token', { method: 'POST', body: 'changed' })).status, 405);
    assert.equal(await app.kv.get('LINK.txt'), node);
});
test('SQLite data survives reopening and bootstrap does not overwrite an empty saved list', async t => {
    const app = await fixture(t);
    await app.kv.put('LINK.txt', '');
    const second = await createService(app.config);
    try { assert.equal(await second.kv.get('LINK.txt'), ''); } finally { second.kv.close(); }
});
test('configured origin rejects Host and forwarded-host spoofing', async t => {
    const app = await fixture(t, { PUBLIC_ORIGIN: 'https://sub.example.com' });
    const response = await fetch(app.origin + '/test-token?clash', { headers: { 'X-Forwarded-Host': 'sub.example.com', 'X-Forwarded-Proto': 'https' } });
    assert.equal(response.status, 421);
});
test('Node runtime bounds the body before authentication and refuses default credentials', async t => {
    const app = await fixture(t);
    assert.equal((await fetch(app.origin + '/admin/api/links', { method: 'POST', body: 'x'.repeat(256 * 1024 + 1) })).status, 413);
    await assert.rejects(createService({ TOKEN: 'auto' }), /non-default/);
    await assert.rejects(createService({ TOKEN: 'test-token', PUBLIC_ORIGIN: 'http://example.com' }), /HTTPS/);
});
