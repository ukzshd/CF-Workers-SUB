function safeJSON(value) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'); }
export function renderAdmin(env, nonce) {
    const settings = safeJSON({ name: env.SUBNAME || 'CF-Workers-SUB', token: env.TOKEN || 'auto' });
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>节点管理</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:900px;margin:40px auto;padding:0 20px;line-height:1.6}header{display:flex;justify-content:space-between;align-items:center;gap:16px}h1{font-size:26px;margin-bottom:4px}.muted{opacity:.7}textarea{box-sizing:border-box;width:100%;min-height:340px;padding:14px;font:14px/1.7 ui-monospace,monospace;border:1px solid #8888;border-radius:8px}button{cursor:pointer;padding:9px 16px;border:1px solid #8888;border-radius:6px}button:disabled{cursor:wait;opacity:.5}.actions{display:flex;align-items:center;gap:16px;margin:14px 0;flex-wrap:wrap}.error{color:light-dark(#b42318,#ffaaaa)}.link-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #8884}#issues{white-space:pre-wrap}a{color:inherit}details{margin-top:28px}summary{cursor:pointer}#status{overflow-wrap:anywhere}
</style></head><body>
<header><div><h1 id="name">节点管理</h1><div class="muted">管理权限独立于订阅链接</div></div><a href="/cdn-cgi/access/logout">退出登录</a></header>
<p id="hint">每行一个节点或订阅链接。保存前检查格式；校验不会连接节点。</p>
<textarea id="content" aria-label="节点链接" spellcheck="false" disabled></textarea>
<div class="actions"><button id="save" disabled>保存</button><label><input id="autosave" type="checkbox"> 停止输入 5 秒后自动保存</label><span id="status" role="status" aria-live="polite">正在读取…</span></div>
<div id="issues" role="alert"></div>
<details><summary>复制订阅地址</summary><p class="muted">订阅链接包含访问凭证，请勿公开分享。转换格式时会继续使用原来的外部转换后端和规则。</p><div id="links"></div></details>
<script nonce="${nonce}">
const settings = ${settings};
document.getElementById('name').textContent = settings.name + ' · 节点管理';
const editor = document.getElementById('content'), button = document.getElementById('save'), status = document.getElementById('status'), issues = document.getElementById('issues'), autosave = document.getElementById('autosave');
let saved = '', busy = false, timer;
const endpoint = '/admin/api/links';
function message(text, error = false) { status.textContent = text; status.className = error ? 'error' : ''; }
async function save() {
    clearTimeout(timer);
    if (busy) return;
    const content = editor.value;
    if (content === saved) { issues.textContent = ''; message('内容未变化'); return; }
    busy = true; button.disabled = true; issues.textContent = ''; message('正在校验并保存…');
    try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Admin-Request': '1' }, body: content, cache: 'no-store', redirect: 'error' });
        if (response.status === 403) throw new Error('登录已失效或请求被拒绝，请刷新页面重新登录');
        const result = await response.json();
        const diagnostics = [...(result.errors || []), ...(result.warnings || [])];
        issues.textContent = diagnostics.map(item => '第 ' + item.line + ' 行：' + item.message).join('\\n');
        if (!response.ok) throw new Error(result.error || '保存失败');
        saved = content;
        message('已保存 · ' + result.count + ' 条链接 · ' + new Date().toLocaleTimeString());
    } catch (error) { message(error.message || '保存失败，请重试', true); }
    finally { busy = false; button.disabled = false; }
    if (autosave.checked && editor.value !== content) timer = setTimeout(save, 5000);
}
button.addEventListener('click', save);
editor.addEventListener('input', () => { message('有未保存的修改'); clearTimeout(timer); if (autosave.checked) timer = setTimeout(save, 5000); });
autosave.addEventListener('change', () => { clearTimeout(timer); if (autosave.checked && editor.value !== saved) timer = setTimeout(save, 5000); });
window.addEventListener('beforeunload', event => { if (editor.value !== saved) { event.preventDefault(); event.returnValue = ''; } });
for (const [name, query] of [['自适应', ''], ['Base64 / v2rayN', '?b64'], ['Clash', '?clash'], ['sing-box', '?sb'], ['Surge', '?surge'], ['Loon', '?loon'], ['Quantumult X', '?quanx']]) {
    const row = document.createElement('div'); row.className = 'link-row';
    const label = document.createElement('span'); label.textContent = name;
    const copy = document.createElement('button'); copy.textContent = '复制地址';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.origin + '/' + encodeURIComponent(settings.token) + query); message('已复制 ' + name + ' 订阅地址'); } catch { message('复制失败，请检查浏览器剪贴板权限', true); } });
    row.append(label, copy); document.getElementById('links').append(row);
}
(async () => {
    try {
        const response = await fetch(endpoint, { cache: 'no-store', redirect: 'error' });
        if (!response.ok) throw new Error('读取失败，请确认登录有效且 KV 已绑定');
        const result = await response.json();
        editor.value = result.content; saved = result.content;
        editor.disabled = false; button.disabled = false; message('已读取节点列表');
    } catch (error) { message(error.message || '读取失败', true); }
})();
</script></body></html>`;
}
