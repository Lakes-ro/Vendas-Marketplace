/**
 * ADMIN-WARNINGS.JS
 * Sistema de advertências para usuários
 */

const AdminWarnings = {
    warnings: [],

    async loadWarnings() {
        try {
            if (!window.APP.auth.isSupreme()) {
                log('❌ Acesso negado', 'error');
                return;
            }

            const { data, error } = await _supabase
                .from('user_warnings')
                .select(`
                    id,
                    user_id,
                    reason,
                    severity,
                    created_at,
                    profiles!user_id(id, full_name, email)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            this.warnings = data || [];
            this.renderWarnings();
            log('✅ Advertências carregadas', 'success');
        } catch (err) {
            log(`❌ Erro ao carregar advertências: ${err.message}`, 'error');
        }
    },

    renderWarnings() {
        const list = document.getElementById('warnings-list');
        if (!list) return;

        if (this.warnings.length === 0) {
            list.innerHTML = '<div class="text-slate-600 text-sm text-center py-8">Nenhuma advertência</div>';
            return;
        }

        list.innerHTML = this.warnings.map(w => {
            const color = w.severity === 'high' ? 'text-red-500' : w.severity === 'medium' ? 'text-yellow-500' : 'text-blue-500';
            return `
                <div class="flex justify-between items-center bg-slate-900/50 p-4 rounded-2xl border border-white/5">
                    <div class="flex-1">
                        <span class="font-bold text-white block">${w.profiles?.full_name}</span>
                        <span class="text-xs text-slate-500 mt-1">${w.profiles?.email}</span>
                        <span class="text-xs text-slate-400 mt-2">${w.reason}</span>
                        <span class="text-xs ${color} font-bold mt-1 block">${w.severity.toUpperCase()}</span>
                    </div>
                    <button onclick="window.APP.adminWarnings.deleteWarning('${w.id}')" class="text-red-500 p-2 hover:bg-red-500/10 rounded-lg">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            `;
        }).join('');

        if (window.lucide) lucide.createIcons();
    },

    openModal() {
        const m = document.getElementById('warning-modal');
        if (m) m.classList.remove('hidden');
    },

    closeModal() {
        const m = document.getElementById('warning-modal');
        if (m) m.classList.add('hidden');
    },

    async createWarning(event) {
        event.preventDefault();

        const userIdEl = document.getElementById('warning-user-id');
        const reasonEl = document.getElementById('warning-reason');
        const severityEl = document.getElementById('warning-severity');
        if (!userIdEl || !reasonEl || !severityEl) return;
        const userId = userIdEl.value;
        const reason = reasonEl.value;
        const severity = severityEl.value;

        try {
            const { error } = await _supabase
                .from('user_warnings')
                .insert([{
                    user_id: userId,
                    admin_id: window.APP.auth.userId,
                    reason,
                    severity
                }]);

            if (error) throw error;

            log('✅ Advertência criada', 'success');
            alert('✅ Advertência registrada!');
            this.closeModal();
            await this.loadWarnings();
        } catch (err) {
            log(`❌ Erro: ${err.message}`, 'error');
            alert('❌ Erro: ' + err.message);
        }
    },

    async deleteWarning(warningId) {
        if (!confirm('Remover advertência?')) return;

        try {
            const { error } = await _supabase
                .from('user_warnings')
                .delete()
                .eq('id', warningId);

            if (error) throw error;

            log('✅ Advertência removida', 'success');
            await this.loadWarnings();
        } catch (err) {
            log(`❌ Erro: ${err.message}`, 'error');
        }
    }
};