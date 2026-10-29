// Syntax checks only: never contact a node or disclose its credentials in errors.
export function validateLinks(content) {
    const errors = [], warnings = [], seen = new Set();
    const lines = content.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((raw, index) => {
        const line = raw.trim();
        if (!line) return;
        const fail = message => errors.push({ line: index + 1, message });
        if (seen.has(line)) warnings.push({ line: index + 1, message: '重复链接，输出订阅时会去重' });
        seen.add(line);
        const scheme = line.match(/^([a-z0-9+-]+):\/\//i)?.[1]?.toLowerCase();
        if (!scheme) return fail('缺少协议头，例如 vless://');
        if (/\s|[<>"'|]/.test(line)) return fail('包含空白或未编码的特殊字符，请使用客户端导出的完整链接');
        try {
            if (scheme === 'vmess') {
                const encoded = line.slice(8).split('#')[0].replace(/-/g, '+').replace(/_/g, '/');
                const node = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
                if (!node.add || !validPort(node.port) || !validUUID(node.id)) fail('VMess 缺少有效服务器、端口或 UUID');
            } else if (['vless', 'trojan', 'ss', 'hysteria', 'hysteria2', 'hy2', 'tuic', 'socks', 'socks5', 'http', 'https'].includes(scheme)) {
                // Legacy Shadowsocks may encode the entire user@server:port part.
                let parsed = line;
                if (scheme === 'ss' && !line.includes('@')) parsed = 'ss://' + atob(line.slice(5).split('#')[0].replace(/-/g, '+').replace(/_/g, '/'));
                const url = new URL(parsed);
                if (!url.hostname) return fail('缺少服务器地址');
                if (scheme === 'http' || scheme === 'https') {
                    if (url.username || url.password) fail('HTTP 订阅地址不支持内嵌用户名密码');
                    return;
                }
                // QUIC protocols may omit :443; URL.port also validates range.
                if (!url.port && !['hysteria', 'hysteria2', 'hy2', 'tuic'].includes(scheme)) return fail('缺少有效端口');
                if (scheme === 'vless' && !validUUID(decodeURIComponent(url.username))) return fail('VLESS UUID 格式不正确');
                if (['trojan', 'ss', 'tuic'].includes(scheme) && !url.username) fail('缺少认证参数');
            } else {
                // Do not reject uncommon protocols previously accepted by the aggregator.
                warnings.push({ line: index + 1, message: '暂不支持校验此协议，请自行确认格式' });
            }
        } catch { fail('链接结构或编码不正确'); }
    });
    return { errors, warnings, count: seen.size };
}
function validPort(value) { return /^\d+$/.test(String(value)) && Number(value) > 0 && Number(value) <= 65535; }
function validUUID(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || ''); }
