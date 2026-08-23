/**
 * IMAGE-OPTIMIZER.JS v1.0
 * ✅ Ferramenta de uso único (Admin Supremo) pra comprimir fotos que já
 *    estavam no ar ANTES da compressão automática existir (ver
 *    window.compressImage, em config.js — usada por products.js e
 *    ads.js só em uploads NOVOS). Fotos de produto/anúncio cadastradas
 *    antes dessa correção continuam no tamanho original da câmera
 *    (8-15MB cada), e são elas que hoje demoram muito pra aparecer na
 *    vitrine e no banner — mesmo com tudo o mais do sistema já rápido.
 * ✅ Idempotente: pode rodar quantas vezes quiser sem problema — imagem
 *    que já está pequena (abaixo do limite de compressão) é pulada
 *    sozinha, sem gastar tempo à toa reprocessando o que já está ok.
 * ✅ Baixa a imagem original de dentro do próprio navegador do Admin,
 *    comprime com window.compressImage() (mesmo mecanismo usado em
 *    upload novo), sobe a versão leve com um nome novo, e atualiza o
 *    registro no banco pra apontar pra ela — a imagem antiga e pesada
 *    fica órfã no Storage (não é apagada automaticamente, pra não
 *    correr risco de apagar algo em uso por engano — pode ser limpada
 *    manualmente depois, se quiser).
 */

const ImageOptimizer = {
    _log(container, msg) {
        if (!container) { console.log(msg); return; }
        const line = document.createElement('div');
        line.textContent = msg;
        container.appendChild(line);
        container.scrollTop = container.scrollHeight;
    },

    async _fetchAsFile(url, filename) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar a imagem original`);
        const blob = await res.blob();
        return new File([blob], filename, { type: blob.type || 'image/jpeg' });
    },

    /**
     * Baixa 1 imagem, comprime, sobe a versão leve. Devolve {skipped:true}
     * se não valeu a pena mexer (já estava pequena, ou compressão não
     * ajudou nesse caso específico).
     */
    async _reoptimizeOne({ url, bucket, pathHint }) {
        const originalFile = await this._fetchAsFile(url, pathHint);

        if (originalFile.size < 300 * 1024) {
            return { skipped: true, reason: 'já estava pequena' };
        }

        const compressed = await window.compressImage(originalFile);

        if (!compressed || compressed.size >= originalFile.size) {
            return { skipped: true, reason: 'compressão não ajudou nesse caso' };
        }

        const newFileName = `optimized-${Date.now()}-${Math.random().toString(36).slice(2)}-${compressed.name}`;
        const { error: uploadError } = await _supabase.storage.from(bucket).upload(newFileName, compressed);
        if (uploadError) throw uploadError;

        const { data: publicUrl } = _supabase.storage.from(bucket).getPublicUrl(newFileName);

        return {
            skipped: false,
            newUrl: publicUrl.publicUrl,
            beforeKB: Math.round(originalFile.size / 1024),
            afterKB: Math.round(compressed.size / 1024)
        };
    },

    async runProducts(logEl) {
        this._log(logEl, '📦 Buscando fotos de produto já publicadas...');

        const { data: mediaRows, error } = await _supabase
            .from('product_media')
            .select('id, product_id, media_url, media_type')
            .eq('media_type', 'image');

        if (error) { this._log(logEl, `❌ Erro ao buscar fotos de produto: ${error.message}`); return; }

        this._log(logEl, `🔎 ${mediaRows.length} foto(s) de produto encontrada(s). Processando...`);

        let done = 0, skipped = 0, failed = 0;

        for (const row of mediaRows) {
            try {
                const result = await this._reoptimizeOne({
                    url: row.media_url,
                    bucket: 'product-images',
                    pathHint: `produto-${row.product_id}.jpg`
                });

                if (result.skipped) { skipped++; continue; }

                const { error: updateError } = await _supabase
                    .from('product_media')
                    .update({ media_url: result.newUrl })
                    .eq('id', row.id);

                if (updateError) throw updateError;

                done++;
                this._log(logEl, `✅ Produto: ${result.beforeKB}KB → ${result.afterKB}KB`);
            } catch (err) {
                failed++;
                this._log(logEl, `⚠️ Falhou 1 foto de produto: ${err.message}`);
            }
        }

        this._log(logEl, `🏁 Produtos concluído: ${done} otimizada(s), ${skipped} já estavam ok, ${failed} falharam.`);
    },

    async runAds(logEl) {
        this._log(logEl, '📢 Buscando imagens de anúncio já publicadas...');

        const { data: ads, error } = await _supabase
            .from('ads')
            .select('id, image_url')
            .not('image_url', 'is', null);

        if (error) { this._log(logEl, `❌ Erro ao buscar anúncios: ${error.message}`); return; }

        this._log(logEl, `🔎 ${ads.length} anúncio(s) com imagem. Processando...`);

        let done = 0, skipped = 0, failed = 0;

        for (const ad of ads) {
            try {
                const result = await this._reoptimizeOne({
                    url: ad.image_url,
                    bucket: 'ad-images',
                    pathHint: `anuncio-${ad.id}.jpg`
                });

                if (result.skipped) { skipped++; continue; }

                const { error: updateError } = await _supabase
                    .from('ads')
                    .update({ image_url: result.newUrl })
                    .eq('id', ad.id);

                if (updateError) throw updateError;

                done++;
                this._log(logEl, `✅ Anúncio: ${result.beforeKB}KB → ${result.afterKB}KB`);
            } catch (err) {
                failed++;
                this._log(logEl, `⚠️ Falhou 1 anúncio: ${err.message}`);
            }
        }

        this._log(logEl, `🏁 Anúncios concluído: ${done} otimizado(s), ${skipped} já estavam ok, ${failed} falharam.`);
    },

    async runAll() {
        const btn = document.getElementById('image-optimizer-btn');
        const logEl = document.getElementById('image-optimizer-log');
        if (logEl) logEl.innerHTML = '';
        if (btn) { btn.disabled = true; btn.innerText = '⏳ Otimizando... (não feche esta aba)'; }

        this._log(logEl, '🚀 Iniciando otimização das imagens já publicadas...');
        this._log(logEl, 'ℹ️ Isso baixa cada foto, comprime e sobe de novo — pode levar alguns minutos se o catálogo for grande.');

        try {
            await this.runProducts(logEl);
            await this.runAds(logEl);
            this._log(logEl, '🎉 Concluído! Recarregue a página pra ver as fotos mais leves em ação.');
        } catch (err) {
            this._log(logEl, `❌ Erro geral: ${err.message}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '🗜️ Otimizar Imagens Antigas'; }
        }
    }
};

window.ImageOptimizer = ImageOptimizer;
