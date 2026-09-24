/**
 * ADMIN-WARNINGS.JS v1.1
 * Advertências para usuários — só Admin Supremo.
 * v1.1 (auditoria): textos escapados (XSS), severidade validada,
 * erro do banco checado.
 */

const AdminWarnings = {
    warnings: [],
    SEVERITY: {
        high: ['text-red-500', 'ALTA'],
        medium: ['text-yellow-500', 'MÉDIA'],
        low: ['text-blue-500', 'BAIXA']
    },

    async loadWarnings() {
        if (!window.APP?.auth?.isSupreme()) return;
        try {
            const { data, error } = await _supabase
                .from('user_warnings')
                .select('id, user_id, reason, severity, created_at, profiles!user_id(id, full_name, email)')
                .order('created_at', { ascending: false });
            if (error) throw error;
            this.warnings = data || [];
            this.renderWarnings();
        } catch (err) {
            log(`❌ Erro ao carregar advertências: ${err.message}`, 'error');
        }
    },

    renderWarnings() {
        const list = document.getElementById('warnings-list');
        if (!list) return;
        if (!this.warnings.length) {
            list.innerHTML = '<div class="text-slate-600 text-sm text-center py-8">Nenhuma advertência</div>';
            return;
        }

        list.innerHTML = this.warnings.map(w => {
            const [color, label] = this.SEVERITY[w.severity] || ['text-slate-400', String(w.severity || '').toUpperCase()];
            return `
                <div class="flex justify-between items-center bg-slate-900/50 p-4 rounded-2xl border border-white/5">
                    <div class="flex-1 min-w-0">
                        <span class="font-bold text-white block">${escapeHtml(w.profiles?.full_name || 'Usuário')}</span>
                        <span class="text-xs text-slate-500 mt-1 block">${escapeHtml(w.profiles?.email || '')}</span>
                        <span class="text-xs text-slate-400 mt-2 block whitespace-pre-wrap">${escapeHtml(w.reason)}</span>
                        <span class="text-xs ${color} font-bold mt-1 block">${escapeHtml(label)}</span>
                    </div>
                    <button onclick="window.APP.adminWarnings.deleteWarning('${escapeHtml(w.id)}')" class="text-red-500 p-2 hover:bg-red-500/10 rounded-lg" aria-label="Remover">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>`;
        }).join('');

        if (window.lucide) lucide.createIcons();
    },

    openModal()  { document.getElementById('warning-modal')?.classList.remove('hidden'); },
    closeModal() { document.getElementById('warning-modal')?.classList.add('hidden'); },

    async createWarning(event) {
        event?.preventDefault?.();
        const userId = document.getElementById('warning-user-id')?.value?.trim();
        const reason = document.getElementById('warning-reason')?.value?.trim();
        const severity = document.getElementById('warning-severity')?.value;

        if (!userId || !reason) { alert('❌ Preencha usuário e motivo'); return; }
        if (!this.SEVERITY[severity]) { alert('❌ Escolha a gravidade'); return; }

        try {
            const { error } = await _supabase.from('user_warnings').insert([{
                user_id: userId,
                admin_id: window.APP.auth.userId,
                reason,
                severity
            }]);
            if (error) throw error;
            alert('✅ Advertência registrada!');
            this.closeModal();
            await this.loadWarnings();
        } catch (err) {
            alert('❌ Erro: ' + err.message);
        }
    },

    async deleteWarning(warningId) {
        if (!confirm('Remover advertência?')) return;
        try {
            const { data, error } = await _supabase.from('user_warnings').delete().eq('id', warningId).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('O banco recusou a exclusão');
            await this.loadWarnings();
        } catch (err) {
            alert('❌ Erro: ' + err.message);
        }
    }
};
