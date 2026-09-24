/**
 * IMAGE-OPTIMIZER.JS v2.0
 * Painel "Comprimir fotos" no Admin (só Admin Supremo).
 *
 * 1. Analisar: lista as fotos de produtos e anúncios e mede o tamanho
 *    de cada uma (sem baixar a imagem inteira).
 * 2. Comprimir: para cada foto pesada, baixa, comprime com compressImage()
 *    (o mesmo dos uploads novos), envia a versão leve, troca o endereço no
 *    banco (função admin_replace_image_url) e apaga o arquivo antigo.
 *
 * Pode rodar quantas vezes quiser: foto já leve é pulada.
 * Precisa do SQL supabase/sql/03-comprimir-imagens.sql aplicado.
 */

const ImageOptimizer = {
    HEAVY_BYTES: 300 * 1024,
    _items: [],
    _running: false,

    // ------------------------------------------------------------
    // Tela
    // ------------------------------------------------------------

    renderPanel() {
        const host = document.getElementById('image-optimizer-panel');
        if (!host) return;
        if (!window.APP?.auth?.isSupreme?.()) { host.innerHTML = ''; delete host.dataset.ready; return; }
        if (host.dataset.ready) return;
        host.dataset.ready = '1';

        host.innerHTML = `
            <div class="io-card">
                <div class="io-head">
                    <div>
                        <div class="io-title">🗜️ Comprimir fotos</div>
                        <div class="io-sub">Fotos pesadas deixam a loja lenta e gastam o limite de tráfego. Analise e comprima as que passaram de 300 KB.</div>
                    </div>
                    <div class="io-actions">
                        <button id="io-analyze-btn" class="io-btn io-btn-ghost" onclick="window.ImageOptimizer.analyze()">🔎 Analisar</button>
                        <button id="io-run-btn" class="io-btn io-btn-main hidden" onclick="window.ImageOptimizer.run()">🗜️ Comprimir</button>
                    </div>
                </div>
                <div id="io-summary" class="io-summary hidden"></div>
                <div id="io-progress" class="io-progress hidden"><div id="io-progress-bar"></div></div>
                <div id="io-log" class="io-log hidden"></div>
            </div>`;
        this._injectStyles();
    },

    _injectStyles() {
        if (document.getElementById('io-styles')) return;
        const st = document.createElement('style');
        st.id = 'io-styles';
        st.textContent = `
            #image-optimizer-panel { margin-bottom: 1.5rem; }
            .io-card { border: 1px solid rgba(148,163,184,.18); background: rgba(15,23,42,.6); border-radius: 1rem; padding: 1rem 1.25rem; }
            .io-head { display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap; }
            .io-title { font-weight: 900; color: #fff; font-size: 1rem; }
            .io-sub { color: #94a3b8; font-size: .8rem; margin-top: .25rem; max-width: 36rem; }
            .io-actions { display: flex; gap: .5rem; }
            .io-btn { font-weight: 800; font-size: .85rem; padding: .6rem 1rem; border-radius: .75rem; transition: .15s; }
            .io-btn:disabled { opacity: .5; cursor: not-allowed; }
            .io-btn-ghost { background: rgba(148,163,184,.12); color: #e2e8f0; }
            .io-btn-ghost:hover:not(:disabled) { background: rgba(148,163,184,.22); }
            .io-btn-main { background: #16a34a; color: #fff; }
            .io-btn-main:hover:not(:disabled) { background: #15803d; }
            .io-summary { margin-top: .9rem; color: #cbd5e1; font-size: .85rem; line-height: 1.5; }
            .io-summary b { color: #fff; }
            .io-progress { margin-top: .75rem; height: 6px; background: rgba(148,163,184,.15); border-radius: 99px; overflow: hidden; }
            #io-progress-bar { height: 100%; width: 0; background: #22c55e; transition: width .2s; }
            .io-log { margin-top: .75rem; max-height: 180px; overflow-y: auto; font-size: .75rem; color: #94a3b8; font-family: ui-monospace, monospace; }
            html[data-theme="light"] .io-card { background: #fff; border-color: #e2e8f0; }
            html[data-theme="light"] .io-title { color: #0f172a; }
            html[data-theme="light"] .io-summary { color: #334155; }
            html[data-theme="light"] .io-summary b { color: #0f172a; }
            html[data-theme="light"] .io-btn-ghost { background: #f1f5f9; color: #0f172a; }
        `;
        document.head.appendChild(st);
    },

    _el(id) { return document.getElementById(id); },

    _log(msg) {
        const box = this._el('io-log');
        if (!box) { log(msg); return; }
        box.classList.remove('hidden');
        const line = document.createElement('div');
        line.textContent = msg;
        box.appendChild(line);
        box.scrollTop = box.scrollHeight;
    },

    _progress(done, total) {
        const wrap = this._el('io-progress');
        const bar = this._el('io-progress-bar');
        if (!wrap || !bar) return;
        wrap.classList.toggle('hidden', !total);
        bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
    },

    _fmt(bytes) {
        if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
        return `${Math.round(bytes / 1024)} KB`;
    },

    _setBusy(busy, label) {
        this._running = busy;
        const a = this._el('io-analyze-btn');
        const r = this._el('io-run-btn');
        if (a) a.disabled = busy;
        if (r) { r.disabled = busy; if (label) r.innerText = label; }
    },

    // ------------------------------------------------------------
    // Coleta
    // ------------------------------------------------------------

    /** Endereço público → { bucket, path } do Storage deste projeto. */
    _storagePath(url) {
        const m = String(url || '').match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+?)(\?.*)?$/);
        if (!m) return null;
        const bucket = m[1];
        if (bucket !== 'product-images' && bucket !== 'ad-images') return null;
        return { bucket, path: decodeURIComponent(m[2]) };
    },

    async _collectUrls() {
        const [media, prods, ads] = await Promise.all([
            _supabase.from('product_media').select('media_url').eq('media_type', 'image'),
            _supabase.from('products').select('image_url').not('image_url', 'is', null),
            _supabase.from('ads').select('image_url').not('image_url', 'is', null)
        ]);
        for (const r of [media, prods, ads]) if (r.error) throw r.error;

        const urls = new Set();
        (media.data || []).forEach(r => r.media_url && urls.add(r.media_url));
        (prods.data || []).forEach(r => r.image_url && urls.add(r.image_url));
        (ads.data || []).forEach(r => r.image_url && urls.add(r.image_url));

        return [...urls]
            .map(url => ({ url, ...this._storagePath(url) }))
            .filter(i => i.bucket);
    },

    async _measure(url) {
        try {
            const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
            const len = Number(res.headers.get('content-length'));
            if (res.ok && len) return len;
        } catch { /* cai no plano B */ }
        // plano B: sem content-length, baixa pra medir
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.blob()).size;
    },

    // ------------------------------------------------------------
    // 1) Analisar
    // ------------------------------------------------------------

    async analyze() {
        if (this._running) return;
        if (!window.APP?.auth?.isSupreme?.()) return;

        const summary = this._el('io-summary');
        const logBox = this._el('io-log');
        const runBtn = this._el('io-run-btn');
        if (logBox) { logBox.innerHTML = ''; logBox.classList.add('hidden'); }
        runBtn?.classList.add('hidden');
        summary?.classList.remove('hidden');
        if (summary) summary.textContent = '⏳ Procurando fotos...';

        this._setBusy(true);
        try {
            const items = await this._collectUrls();
            let done = 0;

            // mede em grupos de 6 pra não travar a rede
            const queue = [...items];
            const worker = async () => {
                while (queue.length) {
                    const it = queue.shift();
                    try { it.size = await this._measure(it.url); }
                    catch { it.size = 0; it.broken = true; }
                    this._progress(++done, items.length);
                }
            };
            await Promise.all(Array.from({ length: 6 }, worker));
            this._progress(0, 0);

            const heavy = items.filter(i => i.size >= this.HEAVY_BYTES).sort((a, b) => b.size - a.size);
            const total = items.reduce((s, i) => s + (i.size || 0), 0);
            const heavyTotal = heavy.reduce((s, i) => s + i.size, 0);
            const broken = items.filter(i => i.broken).length;
            this._items = heavy;

            if (summary) {
                summary.innerHTML = `
                    <b>${items.length}</b> foto(s) no ar, somando <b>${this._fmt(total)}</b>.<br>
                    ${heavy.length
                        ? `<b>${heavy.length}</b> pesada(s) (acima de 300 KB), somando <b>${this._fmt(heavyTotal)}</b>. A maior tem ${this._fmt(heavy[0].size)}.`
                        : '✅ Nenhuma foto pesada. Está tudo leve.'}
                    ${broken ? `<br>⚠️ ${broken} foto(s) não abriram (arquivo apagado ou endereço quebrado).` : ''}`;
            }
            if (heavy.length && runBtn) {
                runBtn.innerText = `🗜️ Comprimir ${heavy.length} foto(s)`;
                runBtn.classList.remove('hidden');
            }
        } catch (err) {
            if (summary) summary.textContent = `❌ Não foi possível analisar: ${err.message}`;
        } finally {
            this._setBusy(false);
        }
    },

    // ------------------------------------------------------------
    // 2) Comprimir
    // ------------------------------------------------------------

    async _optimizeOne(item) {
        const res = await fetch(item.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar`);
        const blob = await res.blob();
        const original = new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' });

        const compressed = await window.compressImage(original, { maxWidth: 1600, maxHeight: 1600, quality: 0.75, minSizeToCompress: 1 });
        if (!compressed || compressed.size >= original.size * 0.9) {
            return { skipped: true };
        }

        const userId = window.APP?.auth?.userId;
        const base = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-otimizada.jpg`;
        // fotos de produto precisam ficar na pasta de quem envia (regra do Storage)
        const newPath = item.bucket === 'product-images' ? `${userId}/${base}` : base;

        const up = await _supabase.storage.from(item.bucket).upload(newPath, compressed, {
            contentType: 'image/jpeg',
            cacheControl: '31536000'
        });
        if (up.error) throw up.error;

        const newUrl = _supabase.storage.from(item.bucket).getPublicUrl(newPath).data.publicUrl;

        const { data: changed, error: rpcError } = await _supabase.rpc('admin_replace_image_url', { p_old: item.url, p_new: newUrl });
        if (rpcError) {
            await _supabase.storage.from(item.bucket).remove([newPath]).catch(() => {});
            if (/admin_replace_image_url|function/i.test(rpcError.message)) {
                throw new Error('falta rodar o SQL 03-comprimir-imagens.sql no Supabase');
            }
            throw rpcError;
        }

        // só apaga o arquivo antigo depois que o banco já aponta pro novo
        let removed = false;
        if (changed > 0) {
            const del = await _supabase.storage.from(item.bucket).remove([item.path]);
            removed = !del.error && (del.data || []).length > 0;
        }

        return { skipped: false, before: original.size, after: compressed.size, removed };
    },

    async run() {
        if (this._running || !this._items.length) return;
        if (!window.APP?.auth?.isSupreme?.()) { alert('❌ Apenas o Admin Supremo pode comprimir as fotos.'); return; }
        if (!confirm(`Comprimir ${this._items.length} foto(s)?\n\nNão feche esta aba até terminar.`)) return;

        const logBox = this._el('io-log');
        if (logBox) logBox.innerHTML = '';
        this._setBusy(true, '⏳ Comprimindo... não feche a aba');

        let ok = 0, skipped = 0, failed = 0, saved = 0, done = 0;
        const total = this._items.length;

        for (const item of this._items) {
            try {
                const r = await this._optimizeOne(item);
                if (r.skipped) {
                    skipped++;
                } else {
                    ok++;
                    saved += r.before - r.after;
                    this._log(`✅ ${this._fmt(r.before)} → ${this._fmt(r.after)}${r.removed ? '' : ' (arquivo antigo mantido)'}`);
                }
            } catch (err) {
                failed++;
                this._log(`⚠️ Falhou: ${err.message}`);
                if (/SQL 03/.test(err.message)) break;
            }
            this._progress(++done, total);
        }

        this._progress(0, 0);
        this._items = [];
        this._el('io-run-btn')?.classList.add('hidden');
        this._setBusy(false, '🗜️ Comprimir');

        const summary = this._el('io-summary');
        if (summary) {
            summary.innerHTML = `🏁 Pronto: <b>${ok}</b> comprimida(s), economia de <b>${this._fmt(saved)}</b>.
                ${skipped ? `<br>${skipped} já estavam no melhor tamanho.` : ''}
                ${failed ? `<br>⚠️ ${failed} falharam (veja abaixo).` : ''}`;
        }

        if (ok) {
            try { await window.APP?.products?.fetchAll?.(); } catch { /* ignora */ }
            try { await window.APP?.ads?.loadAds?.(); } catch { /* ignora */ }
        }
    }
};

window.ImageOptimizer = ImageOptimizer;
