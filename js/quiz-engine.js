/**
 * quiz-engine.js
 * ───────────────
 * Logic for the Test (quiz) mode with 5 question types + Mixed Mode.
 *
 * Question Types:
 *   1. recognition  — word → meaning (4 choices)
 *   2. reverse      — meaning → word (4 choices)
 *   3. spelling     — meaning + phonetic → type word (text input)
 *   4. context      — example with blank → type word (text input)
 *   5. synonym      — synonyms shown → word (4 choices)
 *   6. mixed        — Wave system: 60% recognition+reverse, 30% spelling, 10% context
 */

export class QuizEngine {

    /**
     * @param {Array<Object>} data - Array of word objects
     * @param {string} quizType - One of: recognition, reverse, spelling, context, synonym, mixed
     */
    constructor(data, quizType = 'recognition') {
        this.originalData = data;
        this.quizType = quizType;
        this.score = 0;
        this.streak = 0;
        this.maxStreak = 0;
        this.wrongAnswers = [];

        // Build question queue
        this.questions = this._buildQuestionQueue(data, quizType);
        this.total = this.questions.length;
        this.index = 0;
    }

    // ─── Fisher-Yates Shuffle ───

    _shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ─── Build Question Queue ───

    _buildQuestionQueue(data, type) {
        if (type === 'mixed') {
            return this._buildMixedQueue(data);
        }

        // For synonym type, filter to words that have synonyms
        let pool = [...data];
        if (type === 'synonym') {
            pool = pool.filter(w => w.synonyms && w.synonyms.length > 0);
        }
        // For context type, filter to words that have examples containing the word
        if (type === 'context') {
            pool = pool.filter(w => w.example && w.example.toLowerCase().includes(w.word.toLowerCase()));
        }

        // Fallback: if filtered pool is too small, use full data with recognition
        if (pool.length < 2) {
            pool = [...data];
            type = 'recognition';
        }

        const shuffled = this._shuffle(pool);
        return shuffled.map(word => ({
            type,
            word,
        }));
    }

    /**
     * Build Mixed Mode queue with 3 waves.
     * Wave 1 (60%): recognition + reverse (random mix)
     * Wave 2 (30%): spelling
     * Wave 3 (10%): context fill
     */
    _buildMixedQueue(data) {
        const total = data.length;
        const wave1Count = Math.max(1, Math.round(total * 0.6));
        const wave2Count = Math.max(1, Math.round(total * 0.3));
        const wave3Count = Math.max(1, total - wave1Count - wave2Count);

        // Shuffle all words
        const shuffled = this._shuffle(data);

        // Split into waves
        const wave1Words = shuffled.slice(0, wave1Count);
        const wave2Words = shuffled.slice(wave1Count, wave1Count + wave2Count);
        
        // Wave 3: only use words that have examples containing the word
        let wave3Candidates = shuffled.slice(wave1Count + wave2Count);
        wave3Candidates = wave3Candidates.filter(w => 
            w.example && w.example.toLowerCase().includes(w.word.toLowerCase())
        );

        // If not enough context candidates, backfill with recognition
        const remainingWords = shuffled.slice(wave1Count + wave2Count);
        if (wave3Candidates.length < wave3Count) {
            const backfill = remainingWords.filter(w => !wave3Candidates.includes(w));
            wave3Candidates = [...wave3Candidates, ...backfill].slice(0, wave3Count);
        }

        // Build questions per wave
        const wave1 = this._shuffle(wave1Words).map(word => ({
            type: Math.random() < 0.5 ? 'recognition' : 'reverse',
            word,
            wave: 1,
        }));

        const wave2 = this._shuffle(wave2Words).map(word => ({
            type: 'spelling',
            word,
            wave: 2,
        }));

        const wave3 = this._shuffle(wave3Candidates).slice(0, wave3Count).map(word => ({
            type: word.example && word.example.toLowerCase().includes(word.word.toLowerCase()) 
                  ? 'context' 
                  : 'recognition',
            word,
            wave: 3,
        }));

        // Concatenate waves in order
        return [...wave1, ...wave2, ...wave3];
    }

    // ─── Generate Question Data ───

    /**
     * Generate the current question with all display data.
     * @returns {Object} question data
     */
    generateQuestion() {
        const q = this.questions[this.index];
        const word = q.word;

        const base = {
            type: q.type,
            wave: q.wave || null,
            word: word,
        };

        switch (q.type) {
            case 'recognition':
                return {
                    ...base,
                    display: word.word,
                    displayPhonetic: word.phonetic,
                    displayType: word.type,
                    prompt: 'Nghĩa của từ này là gì?',
                    correctAnswer: word.meaning,
                    options: this._generateMCOptions(word.meaning, 'meaning'),
                    inputMode: 'choice',
                };

            case 'reverse':
                return {
                    ...base,
                    display: word.meaning,
                    displayPhonetic: '',
                    displayType: '',
                    prompt: 'Từ tiếng Anh nào có nghĩa này?',
                    correctAnswer: word.word,
                    options: this._generateMCOptions(word.word, 'word'),
                    inputMode: 'choice',
                };

            case 'spelling':
                return {
                    ...base,
                    display: word.meaning,
                    displayPhonetic: word.phonetic,
                    displayType: word.type,
                    prompt: 'Gõ lại từ tiếng Anh',
                    correctAnswer: word.word,
                    inputMode: 'text',
                };

            case 'context': {
                const sentence = this._maskWord(word.example, word.word);
                return {
                    ...base,
                    display: '',
                    contextSentence: sentence,
                    prompt: 'Điền từ vào chỗ trống',
                    correctAnswer: word.word,
                    inputMode: 'text',
                };
            }

            case 'synonym':
                return {
                    ...base,
                    display: '',
                    synonyms: word.synonyms || [],
                    prompt: 'Từ nào có các từ đồng nghĩa trên?',
                    correctAnswer: word.word,
                    options: this._generateMCOptions(word.word, 'word'),
                    inputMode: 'choice',
                };

            default:
                return { ...base, inputMode: 'choice', options: [] };
        }
    }

    // ─── Multiple Choice Helpers ───

    /**
     * Generate 4 MC options including the correct answer.
     * @param {string} correctValue - The correct answer string
     * @param {string} field - 'meaning' or 'word' — the field to pull distractors from
     * @returns {string[]} 4 shuffled options
     */
    _generateMCOptions(correctValue, field) {
        const allValues = this.originalData
            .map(w => w[field])
            .filter(v => v && v !== correctValue);

        // Pick 3 unique distractors
        const distractors = this._pickRandom(allValues, 3);
        return this._shuffle([correctValue, ...distractors]);
    }

    /**
     * Pick N random unique items from an array.
     */
    _pickRandom(arr, count) {
        const pool = [...new Set(arr)]; // deduplicate
        const result = [];
        const maxPick = Math.min(count, pool.length);
        for (let i = 0; i < maxPick; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            result.push(pool.splice(idx, 1)[0]);
        }
        return result;
    }

    // ─── Context Fill Helpers ───

    /**
     * Replace the target word in a sentence with "______".
     * Case-insensitive replacement of the first occurrence.
     */
    _maskWord(sentence, word) {
        if (!sentence || !word) return sentence || '';
        const regex = new RegExp(`\\b${this._escapeRegex(word)}\\b`, 'i');
        return sentence.replace(regex, '______');
    }

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ─── Answer Checking ───

    /**
     * Check the user's answer.
     * @param {string} answer - User's answer
     * @returns {{ isCorrect: boolean, correctAnswer: string }}
     */
    checkAnswer(answer) {
        const q = this.questions[this.index];
        const correctAnswer = q.type === 'recognition' 
            ? q.word.meaning 
            : q.word.word;

        let isCorrect;

        // Text input types: case-insensitive comparison
        if (q.type === 'spelling' || q.type === 'context') {
            isCorrect = answer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
        } else {
            isCorrect = answer === correctAnswer;
        }

        if (isCorrect) {
            this.score++;
            this.streak++;
            if (this.streak > this.maxStreak) this.maxStreak = this.streak;
        } else {
            this.streak = 0;
            this.wrongAnswers.push({
                word: q.word.word,
                correctMeaning: q.word.meaning,
                correctAnswer,
                userAnswer: answer,
                questionType: q.type,
            });
        }

        return { isCorrect, correctAnswer };
    }

    /** Advance to the next question. */
    advance() {
        this.index++;
    }

    /** Check if quiz is complete. */
    isFinished() {
        return this.index >= this.total;
    }

    /** Get progress 0–100. */
    getProgress() {
        return (this.index / this.total) * 100;
    }

    /** Get position label like "3 / 20". */
    getPositionLabel() {
        return `${Math.min(this.index + 1, this.total)} / ${this.total}`;
    }

    /** Get final score percentage. */
    getScorePercent() {
        return Math.round((this.score / this.total) * 100);
    }

    /** Get current wave number (for mixed mode). */
    getCurrentWave() {
        if (this.index >= this.total) return null;
        return this.questions[this.index].wave || null;
    }
}