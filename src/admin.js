import { createRemoteJWKSet, jwtVerify } from 'jose';
import { validateLinks } from './validation.js';
import { renderAdmin } from './page.js';

const keySets = new Map();
const MAX_BYTES = 256 * 1024;
const securityHeaders = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
};
function json(value, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
}
export async function verifyAdmin(request, env) {
    // Pin the issuer to configuration, never to claims in the incoming token.
    const issuer = String(env.ADMIN_ACCESS_TEAM_DOMAIN || '').replace(/\/$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !env.ADMIN_ACCESS_AUD) return false;
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token || token.length > 16384) return false;
    try {
        if (!keySets.has(issuer)) keySets.set(issuer, createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'), { timeoutDuration: 5000 }));
        const { payload } = await jwtVerify(token, keySets.get(issuer), {
            issuer, audience: env.ADMIN_ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email']
        });
        // Explicit email allowlist also rejects service tokens and other identities.
        const allowed = String(env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        return typeof payload.email === 'string' && allowed.includes(payload.email.toLowerCase());
    } catch { return false; }
}

export async function handleAdmin(request, env) {
    if (!await verifyAdmin(request, env)) return json({ error: '请通过已配置的 Cloudflare Access 登录后台；未配置认证时后台保持关闭。' }, 403);
    const url = new URL(request.url);
    if (!['/admin', '/admin/', '/admin/api/links'].includes(url.pathname)) return json({ error: '页面不存在' }, 404);
    try {
        if (url.pathname === '/admin/api/links') {
            if (!env.KV) return json({ error: '未绑定 KV' }, 503);
            if (request.method === 'GET') {
                const content = (await env.KV.get('LINK.txt')) ?? (await env.KV.get('/LINK.txt')) ?? '';
                return json({ content });
            }
            if (request.method !== 'POST') return json({ error: '不支持此请求方法' }, 405);
            // The browser cannot forge this header cross-origin without a CORS preflight.
            if (request.headers.get('Origin') !== url.origin || request.headers.get('X-Admin-Request') !== '1' || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: '请求来源不合法' }, 403);
            if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'text/plain') return json({ error: '需要纯文本内容' }, 415);
            const content = await readLimited(request, MAX_BYTES);
            if (content === null) return json({ error: '内容超过 256 KiB 限制' }, 413);
            const result = validateLinks(content);
            if (result.errors.length) return json({ error: '请修正以下格式问题后保存', ...result }, 422);
            await env.KV.put('LINK.txt', content);
            return json({ saved: true, ...result });
        }
        if (request.method !== 'GET') return json({ error: '不支持此请求方法' }, 405);
        const nonce = crypto.randomUUID().replaceAll('-', '');
        return new Response(renderAdmin(env, nonce), { headers: {
            ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`
        } });
    } catch {
        console.warn('admin_operation_failed');
        return json({ error: '操作失败，请稍后重试' }, 500);
    }
}
async function readLimited(request, limit) {
    if (Number(request.headers.get('Content-Length')) > limit) return null;
    if (!request.body) return '';
    const reader = request.body.getReader(), chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); return null; }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
