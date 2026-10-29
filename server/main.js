import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import worker from '../_worker.js';
import { SQLiteKV } from './storage.js';

const MAX_BODY = 256 * 1024;
export async function createService(config) {
    if (!config.TOKEN || config.TOKEN === 'auto') throw new Error('A non-default subscription token is required');
    let origin;
    if (config.PUBLIC_ORIGIN) {
        const parsed = new URL(config.PUBLIC_ORIGIN);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin');
        origin = parsed.origin;
    }
    const kv = new SQLiteKV(config.DATABASE_PATH || 'nodes.sqlite');
    try {
        // Import once, without overwriting later edits or an intentionally empty list.
        if (await kv.get('LINK.txt') === null && config.INITIAL_LINKS_BASE64 !== undefined) {
            const encoded = config.INITIAL_LINKS_BASE64;
            if (encoded.length > 4 * MAX_BODY / 3 + 8 || !/^[A-Za-z0-9+/=\r\n]*$/.test(encoded)) throw new Error('Invalid initial data');
            const bytes = Buffer.from(encoded, 'base64');
            if (bytes.byteLength > MAX_BODY) throw new Error('Initial data exceeds limit');
            await kv.put('LINK.txt', new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        }
    } catch (error) { kv.close(); throw error; }
    const env = { ...config, KV: kv, md5: text => createHash('md5').update(text).digest('hex') };
    const server = createServer(async (incoming, outgoing) => {
        outgoing.setHeader('Cache-Control', 'private, no-store');
        outgoing.setHeader('X-Content-Type-Options', 'nosniff');
        outgoing.setHeader('Referrer-Policy', 'no-referrer');
        try {
            // PUBLIC_ORIGIN is configured later during the DNS/TLS cutover.
            // Never trust Host/X-Forwarded-* to construct converter callback URLs.
            if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) { outgoing.writeHead(400); outgoing.end(); return; }
            const url = new URL((origin || 'http://127.0.0.1') + incoming.url);
            if (url.pathname === '/healthz' && incoming.method === 'GET') {
                outgoing.writeHead(200, { 'Content-Type': 'application/json' });
                outgoing.end(JSON.stringify({ status: 'ok', publicOriginConfigured: Boolean(origin) })); return;
            }
            const remote = incoming.socket.remoteAddress;
            if (!origin && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
                outgoing.writeHead(503); outgoing.end('Domain configuration pending'); return;
            }
            if (origin && incoming.headers.host !== new URL(origin).host) {
                outgoing.writeHead(421); outgoing.end('Unexpected host'); return;
            }
            if (Number(incoming.headers['content-length']) > MAX_BODY) { outgoing.writeHead(413); outgoing.end(); return; }
            const chunks = []; let size = 0;
            for await (const chunk of incoming) {
                size += chunk.byteLength;
                if (size > MAX_BODY) { outgoing.writeHead(413); outgoing.end(); return; }
                chunks.push(chunk);
            }
            const headers = new Headers();
            // Forward only application inputs; Access JWT is always verified by the app.
            for (const name of ['user-agent', 'origin', 'content-type', 'sec-fetch-site', 'x-admin-request', 'cf-access-jwt-assertion', 'subconverter-request', 'subconverter-version']) {
                if (typeof incoming.headers[name] === 'string') headers.set(name, incoming.headers[name]);
            }
            const method = incoming.method || 'GET';
            const request = new Request(url, { method, headers, ...(!['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(chunks) } : {}) });
            const response = await worker.fetch(request, env);
            for (const [key, value] of response.headers) outgoing.setHeader(key, value);
            outgoing.writeHead(response.status);
            if (method === 'HEAD' || !response.body) outgoing.end();
            else await pipeline(Readable.fromWeb(response.body), outgoing);
        } catch {
            console.warn('http_request_failed');
            if (!outgoing.headersSent) outgoing.writeHead(500);
            outgoing.end('Request failed');
        }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    return { server, kv };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        process.umask(0o077);
        const { server, kv } = await createService(process.env);
        server.listen(Number(process.env.PORT || 3080), process.env.HOST || '127.0.0.1', () => console.log('subscription_service_ready'));
        const stop = () => { server.close(() => { kv.close(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); };
        process.on('SIGTERM', stop); process.on('SIGINT', stop);
    } catch { console.error('subscription_service_start_failed'); process.exitCode = 1; }
}
