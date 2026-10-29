export function nodeLabel(value) {
    const line = value.trim();
    const fragment = line.indexOf('#');
    if (fragment !== -1 && line.slice(fragment + 1)) {
        try { return decodeURIComponent(line.slice(fragment + 1)); }
        catch { return line.slice(fragment + 1); }
    }
    if (/^vmess:\/\//i.test(line)) {
        try {
            const encoded = line.slice(8).replace(/-/g, '+').replace(/_/g, '/');
            const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
            if (typeof data.ps === 'string' && data.ps.trim()) return data.ps;
        } catch { /* Incomplete links remain editable. */ }
    }
    return '未命名节点';
}
