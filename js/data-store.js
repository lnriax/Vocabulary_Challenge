/**
 * data-store.js — localStorage persistence + export/streak
 */
const VOCAB_KEY   = 'vc_vocab';
const HISTORY_KEY = 'vc_history';

export const DataStore = {
    getVocab() {
        try { return JSON.parse(localStorage.getItem(VOCAB_KEY) || '[]'); }
        catch { return []; }
    },
    saveVocab(d) { localStorage.setItem(VOCAB_KEY, JSON.stringify(d)); },
    clearVocab() { localStorage.removeItem(VOCAB_KEY); },

    getHistory() {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); }
        catch { return {}; }
    },
    recordStudy(n = 1) {
        const h = this.getHistory();
        const today = new Date().toISOString().split('T')[0];
        h[today] = (h[today] || 0) + n;
        localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    },
    clearHistory() { localStorage.removeItem(HISTORY_KEY); },
    clearAll() { this.clearVocab(); this.clearHistory(); },

    /** Export all data as downloadable JSON */
    exportJSON() {
        const data = {
            vocab: this.getVocab(),
            history: this.getHistory(),
            exportedAt: new Date().toISOString(),
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `vocab-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    /** Count consecutive study days ending today */
    getStudyStreak() {
        const hist = this.getHistory();
        let streak = 0;
        const d = new Date();
        while (true) {
            const key = d.toISOString().split('T')[0];
            if (hist[key] && hist[key] > 0) { streak++; d.setDate(d.getDate() - 1); }
            else break;
        }
        return streak;
    },

    /** Words studied today */
    getTodayCount() {
        const hist = this.getHistory();
        const key  = new Date().toISOString().split('T')[0];
        return hist[key] || 0;
    }
};
