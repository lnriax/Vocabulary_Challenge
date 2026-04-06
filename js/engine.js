/**
 * engine.js — SM-2 Spaced Repetition + Session Stats
 *
 * Smart rating:
 *   "Chưa thuộc" → rating 1 (reset, re-queue)
 *   "Thuộc rồi"  → rating 3 (first pass) or 4 (already passed before)
 *
 * Session stats: tracks knownCount / unknownCount for live counter.
 */

import { DataStore } from './data-store.js';

const QUOTES = [
    { text: "The limits of my language mean the limits of my world.", author: "Ludwig Wittgenstein" },
    { text: "One language sets you in a corridor for life. Two languages open every door along the way.", author: "Frank Smith" },
    { text: "To have another language is to possess a second soul.", author: "Charlemagne" },
    { text: "Language is the road map of a culture.", author: "Rita Mae Brown" },
    { text: "A different language is a different vision of life.", author: "Federico Fellini" },
    { text: "Learning is not attained by chance; it must be sought for with ardour.", author: "Abigail Adams" },
    { text: "The man who does not read has no advantage over the man who cannot read.", author: "Mark Twain" },
    { text: "The beautiful thing about learning is that nobody can take it away from you.", author: "B.B. King" },
    { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
    { text: "Education is not the filling of a pail, but the lighting of a fire.", author: "W.B. Yeats" },
];

export function getTodayQuote() {
    const idx = new Date().getDate() % QUOTES.length;
    return QUOTES[idx];
}

export class StudyEngine {
    constructor(vocab) {
        this.vocab = vocab;
        this.queue = [];
        this.current = null;
        this.completedCnt = 0;
        this.totalCnt = 0;
        this.streak = 0;
        this.wrongAnswers = [];
        this.score = 0;
        this.answered = 0;
        this.knownCount = 0;
        this.unknownCount = 0;
    }

    /** Init session — all words or specific subset */
    initSession(onlyWords = null) {
        let pool;
        if (onlyWords && onlyWords.length > 0) {
            pool = this._shuffle(onlyWords);
        } else {
            pool = this._shuffle([...this.vocab]);
        }
        this.queue = pool.map(w => this._initCard(w));
        this.totalCnt = this.queue.length;
        this.completedCnt = 0;
        this.streak = 0;
        this.wrongAnswers = [];
        this.score = 0;
        this.answered = 0;
        this.knownCount = 0;
        this.unknownCount = 0;
        this.current = this.queue[0] || null;
        return this.queue.length > 0;
    }

    _initCard(w) {
        return { ...w, sessionFails: 0, sessionPassed: false, mode: 'flashcard' };
    }

    currentCard()  { return this.current; }
    isFinished()   { return this.queue.length === 0; }
    progress()     { return this.totalCnt > 0 ? (this.completedCnt / this.totalCnt) * 100 : 0; }
    scorePercent() { return this.answered > 0 ? Math.round(this.score / this.answered * 100) : 0; }
    countLabel()   { return `${this.completedCnt}/${this.totalCnt}`; }

    /** Smart SM-2 rating */
    rate(rating /* 1=Chưa thuộc, 3-4=Thuộc */) {
        const card = this.current;
        if (!card) return;

        this.answered++;
        let { interval = 0, ease = 2.5, reps = 0 } = card;

        if (rating >= 3) {
            // ── KNOWN ──
            this.score++;
            this.streak++;
            this.knownCount++;
            DataStore.recordStudy(1);

            // Smart: first pass = 3, already passed before = 4
            const effectiveRating = card.sessionPassed ? 4 : rating;

            if (reps === 0)      interval = 1;
            else if (reps === 1) interval = 6;
            else                 interval = Math.round(interval * ease);

            reps++;
            ease = Math.max(1.3, ease + 0.1 - (5 - effectiveRating) * (0.08 + (5 - effectiveRating) * 0.02));
            this._saveCardSM2(card.word, interval, ease, reps);
            this._complete();
        } else {
            // ── UNKNOWN ──
            this.streak = 0;
            this.unknownCount++;
            reps = 0; interval = 1;
            ease = Math.max(1.3, ease - 0.2);
            this._saveCardSM2(card.word, interval, ease, reps);

            card.sessionFails++;
            card.interval = interval; card.ease = ease; card.reps = reps;

            if (!this.wrongAnswers.find(x => x.word === card.word)) {
                this.wrongAnswers.push({ word: card.word, correctAnswer: card.meaning });
            }
            // Re-queue at position 3
            this.queue.shift();
            const insertAt = Math.min(3, this.queue.length);
            this.queue.splice(insertAt, 0, card);
            this.current = this.queue[0] || null;
        }
    }

    _complete() {
        this.queue.shift();
        this.completedCnt++;
        this.current = this.queue[0] || null;
    }

    _saveCardSM2(word, interval, ease, reps) {
        const nextReview = Date.now() + interval * 86400000;
        const all = DataStore.getVocab();
        const idx = all.findIndex(w => w.word === word);
        if (idx > -1) {
            all[idx] = { ...all[idx], interval, ease, reps, nextReview };
            DataStore.saveVocab(all);
        }
    }

    /** Dashboard stats (static) */
    static getStats(vocab) {
        const now = Date.now();
        return {
            total:    vocab.length,
            due:      vocab.filter(w => !w.nextReview || w.nextReview <= now).length,
            mastered: vocab.filter(w => w.interval > 21).length,
        };
    }

    _shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
}
