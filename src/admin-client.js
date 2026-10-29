// Serialized into the nonce-protected page; keep browser dependencies explicit.
export function adminClient(settings, nodeLabel) {
    const $ = id => document.getElementById(id);
    $('name').textContent = settings.name + ' · 节点管理';
    const list = $('nodes'), saveButton = $('save'), status = $('status'), issues = $('issues'), autosave = $('autosave');
    let nodes = [], original = '', saved = '', dirty = false, busy = false, loaded = false, timer;
    let newline = '\n', ending = '';
    const endpoint = '/admin/api/links';
    const content = () => dirty ? nodes.map(n => n.value).join(newline) + (nodes.length ? ending : '') : original;
    function message(text, error = false) { status.textContent = text; status.className = error ? 'error' : ''; }
    function changed() {
        dirty = true; issues.textContent = ''; message('有未保存的修改'); clearTimeout(timer);
        if (autosave.checked) timer = setTimeout(save, 5000);
    }
    function setControls() {
        $('count').textContent = nodes.length + ' 个节点';
        nodes.forEach((node, index) => {
            node.number.textContent = String(index + 1).padStart(2, '0');
            node.up.disabled = index === 0; node.down.disabled = index === nodes.length - 1;
            node.first.disabled = index === 0; node.last.disabled = index === nodes.length - 1;
            list.append(node.card);
        });
        $('empty').hidden = nodes.length !== 0;
    }
    function move(node, to) {
        const from = nodes.indexOf(node);
        if (from < 0 || to < 0 || to >= nodes.length || from === to) return;
        nodes.splice(from, 1); nodes.splice(to, 0, node); setControls(); changed();
        node.card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function action(label, title, handler) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title; button.setAttribute('aria-label', title); button.addEventListener('click', handler); return button;
    }
    function add(value = '', focus = false) {
        const node = { value };
        node.card = document.createElement('article'); node.card.className = 'node-card';
        const head = document.createElement('div'); head.className = 'node-head';
        const handle = document.createElement('span'); handle.className = 'drag-handle'; handle.textContent = '⠿'; handle.title = '拖动调整顺序，也可使用右侧排序按钮';
        node.number = document.createElement('span'); node.number.className = 'node-number';
        const title = document.createElement('strong'); title.className = 'node-title'; title.textContent = nodeLabel(value);
        const protocol = document.createElement('span'); protocol.className = 'protocol';
        function updateTitle() { title.textContent = nodeLabel(node.value); protocol.textContent = node.value.trim().match(/^([a-z0-9+-]+):\/\//i)?.[1]?.toUpperCase() || '待填写'; }
        updateTitle();
        const buttons = document.createElement('div'); buttons.className = 'node-tools';
        node.first = action('置顶', '移到第一位', () => move(node, 0));
        node.up = action('↑', '上移节点', () => move(node, nodes.indexOf(node) - 1));
        node.down = action('↓', '下移节点', () => move(node, nodes.indexOf(node) + 1));
        node.last = action('置底', '移到最后一位', () => move(node, nodes.length - 1));
        const remove = action('删除', '删除此节点', () => { if (!confirm('删除“' + nodeLabel(node.value) + '”？保存后生效。')) return; nodes.splice(nodes.indexOf(node), 1); node.card.remove(); setControls(); changed(); }); remove.className = 'remove';
        buttons.append(node.first, node.up, node.down, node.last, remove);
        head.append(handle, node.number, title, protocol, buttons);
        const editor = document.createElement('textarea'); editor.rows = 2; editor.spellcheck = false; editor.autocomplete = 'off'; editor.setAttribute('aria-label', '节点链接'); editor.value = value; editor.placeholder = '粘贴完整节点链接，# 后的名称会显示在上方';
        editor.addEventListener('input', () => { node.value = editor.value; updateTitle(); changed(); });
        editor.addEventListener('paste', event => {
            const text = event.clipboardData?.getData('text');
            const lines = text?.split(/\r\n?|\n/).filter(line => line.trim());
            if (!lines || lines.length < 2 || editor.value.trim()) return;
            event.preventDefault(); node.value = lines.shift(); editor.value = node.value; updateTitle();
            const position = nodes.indexOf(node) + 1;
            const extra = lines.map(line => add(line));
            nodes.splice(position, 0, ...nodes.splice(nodes.length - extra.length, extra.length)); setControls(); changed();
        });
        let pointer = null, target = null, startY = 0;
        function clearDrag() { pointer = target = null; node.card.classList.remove('dragging'); list.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target')); }
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || pointer !== null) return;
            event.preventDefault(); pointer = event.pointerId; startY = event.clientY; handle.setPointerCapture(pointer);
        });
        handle.addEventListener('pointermove', event => {
            if (event.pointerId !== pointer || Math.abs(event.clientY - startY) < 6) return;
            node.card.classList.add('dragging');
            list.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
            const card = document.elementFromPoint(event.clientX, event.clientY)?.closest('.node-card');
            target = nodes.find(item => item.card === card && item !== node) || null;
            target?.card.classList.add('drop-target');
            if (event.clientY > window.innerHeight - 48) window.scrollBy(0, 16);
            else if (event.clientY < 48) window.scrollBy(0, -16);
        });
        handle.addEventListener('pointerup', event => { if (event.pointerId !== pointer) return; const to = target ? nodes.indexOf(target) : -1; clearDrag(); if (to !== -1) move(node, to); });
        handle.addEventListener('pointercancel', clearDrag);
        handle.addEventListener('lostpointercapture', clearDrag);
        node.card.append(head, editor); nodes.push(node); list.append(node.card);
        if (focus) editor.focus(); return node;
    }
    async function save() {
        clearTimeout(timer); if (busy || !loaded) return;
        const snapshot = content();
        if (snapshot === saved) { issues.textContent = ''; message('内容未变化'); return; }
        if (nodes.some(node => /[\r\n]/.test(node.value))) { message('每个小框只放一个节点；请将多行内容拆成多个节点', true); return; }
        if (nodes.some(node => !node.value.trim())) { message('请填写或删除空白节点后再保存', true); return; }
        busy = true; saveButton.disabled = true; issues.textContent = ''; message('正在校验并保存…');
        try {
            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Admin-Request': '1' }, body: snapshot, cache: 'no-store', redirect: 'error' });
            if (response.status === 403) throw new Error('登录已失效或请求被拒绝，请刷新页面重新登录');
            const result = await response.json();
            issues.textContent = [...(result.errors || []), ...(result.warnings || [])].map(item => '第 ' + item.line + ' 个节点：' + item.message).join('\n');
            if (!response.ok) throw new Error(result.error || '保存失败');
            saved = snapshot; message('已保存 · ' + result.count + ' 条链接 · ' + new Date().toLocaleTimeString());
        } catch (error) { message(error.message || '保存失败，请重试', true); }
        finally { busy = false; saveButton.disabled = false; }
        if (autosave.checked && content() !== snapshot) timer = setTimeout(save, 5000);
    }
    saveButton.addEventListener('click', save);
    $('add').addEventListener('click', () => { add('', true); setControls(); changed(); });
    autosave.addEventListener('change', () => { clearTimeout(timer); if (autosave.checked && content() !== saved) timer = setTimeout(save, 5000); });
    window.addEventListener('beforeunload', event => { if (content() !== saved) { event.preventDefault(); event.returnValue = ''; } });
    for (const [name, query] of [['自适应', ''], ['Base64 / v2rayN', '?b64'], ['Clash', '?clash'], ['sing-box', '?sb'], ['Surge', '?surge'], ['Loon', '?loon'], ['Quantumult X', '?quanx']]) {
        const row = document.createElement('div'); row.className = 'link-row';
        const label = document.createElement('span'); label.textContent = name;
        const copy = action('复制地址', '复制 ' + name + ' 订阅地址', async () => { try { await navigator.clipboard.writeText(location.origin + '/' + encodeURIComponent(settings.token) + query); message('已复制 ' + name + ' 订阅地址'); } catch { message('复制失败，请检查浏览器剪贴板权限', true); } });
        row.append(label, copy); $('links').append(row);
    }
    (async () => {
        try {
            const response = await fetch(endpoint, { cache: 'no-store', redirect: 'error' });
            if (!response.ok) throw new Error('读取失败，请确认登录有效');
            const result = await response.json(); original = saved = result.content;
            newline = original.includes('\r\n') ? '\r\n' : '\n'; ending = original.match(/(?:\r\n|\n|\r)+$/)?.[0] || '';
            original.split(/\r\n?|\n/).filter(line => line.trim()).forEach(line => add(line));
            setControls(); loaded = true; saveButton.disabled = false; $('add').disabled = false; message('已读取 · ' + nodes.length + ' 个节点');
        } catch (error) { message(error.message || '读取失败，请重试', true); }
    })();
}
