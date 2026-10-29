import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { request } from 'node:http';

// Run as root: credentials stay out of command arguments, logs and HTTP output.
const config = Object.fromEntries(readFileSync('/etc/cf-workers-sub.env', 'utf8').trim().split('\n').map(line => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), JSON.parse(line.slice(separator + 1))];
}));
const base = 'http://127.0.0.1:3080';
const headers = config.PUBLIC_ORIGIN ? { Host: new URL(config.PUBLIC_ORIGIN).host } : {};
// Native HTTP preserves the explicitly selected virtual Host on loopback.
async function probe(path, options = {}) {
    return new Promise((resolve, reject) => {
        const req = request(base + path, { method: options.method || 'GET', headers: { ...headers, ...options.headers }, timeout: 5000 }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => resolve({ status: response.statusCode, headers: new Headers(response.headers), text: async () => Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Probe timed out')));
        req.end(options.body);
    });
}
let health;
for (let i = 0; i < 10; i++) {
    try { health = await (await fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) })).json(); break; }
    catch { await setTimeout(500); }
}
assert.equal(health?.status, 'ok');
const response = await probe('/' + encodeURIComponent(config.TOKEN) + '?b64');
assert.equal(response.status, 200);
assert.match(response.headers.get('cache-control'), /no-store/);
const output = await response.text();
if (process.argv[2]) assert.equal(createHash('sha256').update(output).digest('hex'), process.argv[2]);
assert.equal((await probe('/admin')).status, 403);
assert.equal((await probe('/admin/api/links', { headers: { 'Cf-Access-Jwt-Assertion': 'invalid' } })).status, 403);
assert.equal((await probe('/' + encodeURIComponent(config.TOKEN), { method: 'POST', body: 'blocked-write' })).status, 405);
const unchanged = await (await probe('/' + encodeURIComponent(config.TOKEN) + '?b64')).text();
assert.equal(unchanged, output);
console.log(JSON.stringify({ health: 'ok', subscriptionBytes: output.length, anonymousAdmin: 'blocked', forgedLogin: 'blocked', legacyWrite: 'blocked', dataUnchanged: true }));
