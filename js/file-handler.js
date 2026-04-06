/**
 * file-handler.js — Parses .json and .csv into normalized vocab arrays
 */
export const FileHandler = {
    async readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const raw = file.name.endsWith('.json')
                        ? JSON.parse(e.target.result)
                        : this._parseCSV(e.target.result);
                    resolve(this._normalize(raw));
                } catch(err) { reject('Lỗi đọc file: ' + err.message); }
            };
            reader.onerror = () => reject('Không thể đọc tệp.');
            reader.readAsText(file);
        });
    },

    _parseCSV(text) {
        if (!text.trim()) return [];
        const lines = text.trim().split(/\r?\n/);
        if (lines.length < 2) throw new Error('CSV trống hoặc thiếu dữ liệu.');

        const parseLine = line => {
            const res = []; let cur = ''; let inQ = false;
            for (const ch of line) {
                if (ch === '"') { inQ = !inQ; }
                else if (ch === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
                else cur += ch;
            }
            res.push(cur.trim());
            return res.map(s => s.replace(/^"|"$/g, '').replace(/""/g, '"'));
        };

        const headers = parseLine(lines[0]).map(h => h.toLowerCase().trim());
        return lines.slice(1)
            .filter(l => l.trim())
            .map(l => {
                const vals = parseLine(l);
                const o = {};
                headers.forEach((h, i) => (o[h] = vals[i] || ''));
                return o;
            });
    },

    _normalize(rows) {
        const pa = v => {
            if (!v) return [];
            if (Array.isArray(v)) return v;
            return v.split(/[;,]/).map(s => s.trim()).filter(Boolean);
        };
        return rows.map(r => ({
            word:         r.word        || r.Word        || r.từ         || '',
            meaning:      r.meaning     || r.Meaning     || r.nghĩa      || '',
            type:         r.type        || r.Type        || r.loại       || '',
            phonetic:     r.phonetic    || r.Phonetic    || r.phiên_âm   || '',
            example:      r.example     || r.Example     || r.ví_dụ      || '',
            synonyms:     pa(r.synonyms    || r.Synonyms),
            collocations: pa(r.collocations || r.Collocations),
            // SM-2 fields preserved on re-import
            interval:   Number(r.interval)   || 0,
            ease:       Number(r.ease)        || 2.5,
            reps:       Number(r.reps)        || 0,
            nextReview: Number(r.nextReview)  || 0,
        })).filter(r => r.word && r.meaning);
    }
};