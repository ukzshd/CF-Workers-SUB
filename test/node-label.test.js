import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeLabel } from '../src/node-label.js';

test('card labels decode fragments without displaying credentials or changing links', () => {
    assert.equal(nodeLabel('vless://secret@example.com:443#PPFUSCN2'), 'PPFUSCN2');
    assert.equal(nodeLabel('trojan://secret@example.com:443#%E9%A6%99%E6%B8%AF%20A'), '香港 A');
    assert.equal(nodeLabel('vless://secret@example.com:443#broken%ZZ'), 'broken%ZZ');
    assert.equal(nodeLabel('vless://secret@example.com:443'), '未命名节点');
    assert.equal(nodeLabel(''), '未命名节点');
});
test('VMess card names support embedded UTF-8 remarks and incomplete data', () => {
    const encoded = Buffer.from(JSON.stringify({ ps: '东京节点', add: 'example.com' })).toString('base64');
    assert.equal(nodeLabel('vmess://' + encoded), '东京节点');
    assert.equal(nodeLabel('vmess://' + encoded + '#override'), 'override');
    assert.equal(nodeLabel('vmess://invalid'), '未命名节点');
});
