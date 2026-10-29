import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, createFetchMock } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { validateLinks } from '../src/validation.js';
import { renderAdmin } from '../src/page.js';

const issuer = 'https://test-team.cloudflareaccess.com';
const node = 'vless://12345678-1234-1234-1234-123456789abc@example.com:443?security=tls&type=ws#Test';
let mf, kv, privateKey, token;
const mock = createFetchMock();
mock.disableNetConnect();
before(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    const jwk = { ...await exportJWK(pair.publicKey), kid: 'test', alg: 'RS256', use: 'sig' };
    mock.get(issuer).intercept({ path: '/cdn-cgi/access/certs' }).reply(200, JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } }).persist();
    mf = new Miniflare({ modules: true, scriptPath: 'dist/_worker.js', compatibilityDate: '2025-01-19', kvNamespaces: ['KV'], fetchMock: mock,
        bindings: { TOKEN: 'subscription-only', ADMIN_ACCESS_TEAM_DOMAIN: issuer, ADMIN_ACCESS_AUD: 'test-aud', ADMIN_EMAILS: 'owner@example.com' } });
    kv = await mf.getKVNamespace('KV');
    await kv.put('LINK.txt', node);
    token = await signed();
});
after(async () => { await mf?.dispose(); await mock.close(); });
async function signed(overrides = {}, key = privateKey) {
    return new SignJWT({ email: 'owner@example.com', ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuedAt().setSubject('owner').setIssuer(issuer).setAudience('test-aud').setExpirationTime('1h').sign(key);
}
function request(path, { auth = token, ...options } = {}) {
    return mf.dispatchFetch('https://sub.example.com' + path, { ...options, headers: { ...(auth ? { 'Cf-Access-Jwt-Assertion': auth } : {}), ...options.headers } });
}
function save(content, headers = {}) { return request('/admin/api/links', { method: 'POST', body: content, headers: { Origin: 'https://sub.example.com', 'Content-Type': 'text/plain', 'X-Admin-Request': '1', ...headers } }); }

test('subscription credentials and spoofed identity headers never grant admin access', async () => {
    for (const path of ['/admin', '/admin/api/links', '/admin?token=subscription-only']) {
        assert.equal((await request(path, { auth: null, headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com' } })).status, 403);
    }
    assert.equal((await request('/admin', { auth: 'not.a.jwt' })).status, 403);
    assert.equal((await request('/admin', { auth: await signed({ email: 'other@example.com' }) })).status, 403);
    const badKey = await generateKeyPair('RS256');
    assert.equal((await request('/admin', { auth: await signed({}, badKey.privateKey) })).status, 403);
    const expired = await new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('owner').setIssuedAt().setIssuer(issuer).setAudience('test-aud').setExpirationTime(1).sign(privateKey);
    assert.equal((await request('/admin', { auth: expired })).status, 403);
    const wrongAudience = await new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('owner').setIssuedAt().setIssuer(issuer).setAudience('other').setExpirationTime('1h').sign(privateKey);
    assert.equal((await request('/admin', { auth: wrongAudience })).status, 403);
});
test('unconfigured admin stays closed while subscriptions remain available', async () => {
    const bare = new Miniflare({ modules: true, scriptPath: 'dist/_worker.js', compatibilityDate: '2025-01-19', bindings: { TOKEN: 'test-only', LINK: node } });
    try {
        assert.equal((await bare.dispatchFetch('https://other.pages.dev/admin')).status, 403);
        assert.equal((await bare.dispatchFetch('https://other.pages.dev/admin/api/links', { method: 'POST', body: node })).status, 403);
        const sub = await bare.dispatchFetch('https://other.pages.dev/test-only?b64');
        assert.equal(atob(await sub.text()).trim(), node);
    } finally { await bare.dispose(); }
});
test('valid Access JWT can read admin; no cache, strict CSP, no raw KV HTML', async () => {
    const response = await request('/admin');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const html = await response.text();
    assert.ok(!html.includes(node));
    assert.ok(!html.includes('cdn.jsdelivr.net'));
    assert.equal((await (await request('/admin/api/links')).json()).content, node);
    const injected = renderAdmin({ SUBNAME: '</script><img src=x onerror=alert(1)>', TOKEN: '</script>' }, 'nonce');
    assert.ok(!injected.includes('</script><img'));
    assert.match(injected, /editor.value = result.content/);
});
test('CSRF, unsupported method, content type, and oversized bodies cannot write KV', async () => {
    assert.equal((await save(node, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await save(node, { 'X-Admin-Request': '' })).status, 403);
    assert.equal((await save(node, { 'Content-Type': 'application/json' })).status, 415);
    assert.equal((await request('/admin/api/links', { method: 'DELETE' })).status, 405);
    assert.equal((await save('x'.repeat(256 * 1024 + 1))).status, 413);
    assert.equal(await kv.get('LINK.txt'), node);
});
test('old browser editor and token POST are removed, existing Base64 subscription stays compatible', async () => {
    const response = await request('/subscription-only?b64', { auth: null, headers: { 'User-Agent': 'Mozilla/5.0' } });
    assert.equal(response.status, 200);
    assert.equal(atob(await response.text()).trim(), node);
    assert.equal((await request('/subscription-only', { auth: null, method: 'POST', body: 'overwrite' })).status, 405);
    assert.equal(await kv.get('LINK.txt'), node);
});
test('save validates server side without echoing secrets; valid links and empty lists persist', async () => {
    const bad = await save('vless://secret-password@host:443');
    assert.equal(bad.status, 422);
    assert.ok(!(await bad.text()).includes('secret-password'));
    assert.equal(await kv.get('LINK.txt'), node);
    assert.equal((await save(node + '\n' + node)).status, 200);
    assert.equal((await save('')).status, 200);
    assert.equal(await kv.get('LINK.txt'), '');
    const empty = await request('/subscription-only?b64');
    assert.equal(atob(await empty.text()).trim(), '');
    await save(node);
});
test('Clash, sing-box and other output formats retain converter and config template', async () => {
    for (const [query, format] of [['clash', 'clash'], ['sb', 'singbox'], ['surge', 'surge'], ['loon', 'loon'], ['quanx', 'quanx']]) {
        mock.get('https://SUBAPI.cmliussss.net').intercept({ path: path => path.includes('target=' + format) && path.includes('ACL4SSR_Online_MultiCountry.ini') }).reply(200, 'converted:' + format);
        const response = await request('/subscription-only?' + query, { auth: null, headers: { 'User-Agent': 'Mozilla/5.0' } });
        assert.equal(await response.text(), 'converted:' + format);
    }
});
test('upstream fetch sends no client cookies, authorization or Access credentials', async () => {
    await kv.put('LINK.txt', 'https://upstream.example/private-token');
    mock.get('https://upstream.example').intercept({ path: '/private-token', headers: headers => !('cookie' in headers) && !('authorization' in headers) && !('cf-access-jwt-assertion' in headers) }).reply(200, node);
    const response = await request('/subscription-only?b64', { headers: { Cookie: 'secret-cookie', Authorization: 'Bearer secret' } });
    assert.equal(atob(await response.text()).trim(), node);
    await kv.put('LINK.txt', node);
});
test('format validation supports common nodes and warns on unknown protocols and duplicates', () => {
    assert.equal(validateLinks(node).errors.length, 0);
    assert.equal(validateLinks('trojan://password@host:443#name').errors.length, 0);
    assert.equal(validateLinks('ss://' + btoa('aes-256-gcm:password') + '@host:443').errors.length, 0);
    assert.equal(validateLinks('hy2://password@host').errors.length, 0);
    assert.equal(validateLinks('tuic://uuid:password@host:443').errors.length, 0);
    assert.equal(validateLinks('vmess://' + btoa(JSON.stringify({ add: 'host', port: 443, id: '12345678-1234-1234-1234-123456789abc' }))).errors.length, 0);
    assert.equal(validateLinks('vless://broken@host:443').errors.length, 1);
    assert.equal(validateLinks('trojan://pass@host:99999').errors.length, 1);
    assert.equal(validateLinks(node + '\n' + node).warnings.length, 1);
    assert.equal(validateLinks('custom://anything').warnings.length, 1);
});
