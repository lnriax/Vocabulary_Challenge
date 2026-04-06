/**
 * main.js — Full Orchestrator (Optimized)
 *
 * Features:
 *  - Init routing: data → dashboard, no data → upload
 *  - Sakura + firefly particle canvas (pauses when tab hidden)
 *  - Click vs swipe conflict resolved with movement detection
 *  - Drag visual feedback (card tilt + direction overlay)
 *  - Live known/unknown counter in focus mode
 *  - Sound feedback (AudioContext oscillator, no files needed)
 *  - Confirm before mid-session exit
 *  - Data search filter
 *  - JSON export
 *  - Confetti burst on ≥90%
 */

import { FileHandler }  from './file-handler.js';
import { DataStore }    from './data-store.js';
import { StudyEngine, getTodayQuote } from './engine.js';
import { QuizEngine }   from './quiz-engine.js';

/* ── DOM ──────────────────────────── */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
function show(id) {
    $$('.frame').forEach(f => { f.classList.remove('active'); f.classList.add('hidden'); });
    const f = $(id);
    if (f) { f.classList.remove('hidden'); void f.offsetWidth; f.classList.add('active'); }
}

/* ── State ────────────────────────── */
let studyEng = null, quizEng = null;
let curQuizType = 'recognition';
let isFlipped = false, inFocus = false, inTest = false;
let lastSource = 'focus', lastWrong = [];

/* ═══════════════════════════════════════
 *  SOUND FEEDBACK (AudioContext)
 * ═══════════════════════════════════════ */
let audioCtx = null;
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}
function playTone(freq, dur, type = 'sine', vol = 0.08) {
    try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + dur);
    } catch(e) { /* silent fail */ }
}
function sndCorrect() { playTone(880, 0.12, 'sine', 0.06); setTimeout(() => playTone(1100, 0.15, 'sine', 0.05), 80); }
function sndWrong()   { playTone(220, 0.2, 'triangle', 0.07); }
function sndFlip()    { playTone(600, 0.05, 'sine', 0.03); }

/* ═══════════════════════════════════════
 *  AUDIO — Lofi background
 * ═══════════════════════════════════════ */
const audioEl = $('lofi-audio'), musicBtn = $('btn-music');
let audioOn = false;

function syncMusic() {
    musicBtn.textContent = audioOn ? '🎵' : '🔇';
    musicBtn.classList.toggle('active', audioOn);
}
function tryPlay() {
    audioEl.volume = 0.3;
    audioEl.play().then(() => { audioOn = true; syncMusic(); }).catch(() => { audioOn = false; syncMusic(); });
}
musicBtn.addEventListener('click', () => {
    if (audioOn) { audioEl.pause(); audioOn = false; } else tryPlay();
    syncMusic();
});
document.addEventListener('pointerdown', function fp() {
    if (!audioOn) tryPlay();
    document.removeEventListener('pointerdown', fp);
}, { once: true });

/* ═══════════════════════════════════════
 *  PARTICLE CANVAS — Sakura + Fireflies
 *  Pauses when tab hidden (Page Visibility)
 * ═══════════════════════════════════════ */
const particleEngine = (function() {
    const c = $('particle-canvas');
    if (!c) return { burst() {} };
    const ctx = c.getContext('2d');
    let W, H, running = true, rafId = null;

    // — Sakura petals
    const PETAL_N = 35;
    const petals = [];
    function mkPetal(fresh) {
        return {
            x: Math.random() * (W || 1000), y: fresh ? -20 : Math.random() * (H || 800),
            r: 3 + Math.random() * 5, rot: Math.random() * 6.28,
            vx: (Math.random() - .5) * .5, vy: .4 + Math.random() * 1,
            vr: (Math.random() - .5) * .03, al: .25 + Math.random() * .4,
            sx: .6 + Math.random() * .6
        };
    }
    function drawPetal(p) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(p.sx, 1);
        ctx.globalAlpha = p.al; ctx.beginPath();
        ctx.moveTo(0, -p.r);
        ctx.bezierCurveTo(p.r * .8, -p.r, p.r * .8, p.r * .25, 0, p.r * .7);
        ctx.bezierCurveTo(-p.r * .8, p.r * .25, -p.r * .8, -p.r, 0, -p.r);
        ctx.fillStyle = '#f4a7c3'; ctx.fill(); ctx.restore();
    }

    // — Fireflies
    const FLY_N = 18;
    const flies = [];
    function mkFly() {
        return {
            x: Math.random() * (W || 1000), y: Math.random() * (H || 800),
            r: 1.2 + Math.random() * 2, phase: Math.random() * 6.28,
            speed: .15 + Math.random() * .25,
            dx: (Math.random() - .5) * .3, dy: (Math.random() - .5) * .2
        };
    }
    function drawFly(f, t) {
        const glow = .3 + .7 * (.5 + .5 * Math.sin(t * f.speed + f.phase));
        ctx.save(); ctx.globalAlpha = glow * .65;
        // Outer glow
        const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 6);
        grad.addColorStop(0, 'rgba(255, 255, 200, .35)');
        grad.addColorStop(.4, 'rgba(255, 240, 160, .1)');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 6, 0, 6.28); ctx.fill();
        // Core
        ctx.globalAlpha = glow * .9;
        ctx.fillStyle = '#fef3a0';
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.28); ctx.fill();
        ctx.restore();
    }

    // — Confetti burst particles
    let confetti = [];
    function burst(count = 60) {
        const cx = W / 2, cy = H * .35;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * 6.28;
            const speed = 2 + Math.random() * 5;
            confetti.push({
                x: cx, y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 2,
                r: 2 + Math.random() * 4,
                hue: Math.random() * 360,
                life: 1, decay: .008 + Math.random() * .012,
                rot: Math.random() * 6.28, vr: (Math.random() - .5) * .2
            });
        }
    }
    function drawConfetti() {
        confetti = confetti.filter(p => p.life > 0);
        confetti.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.vy += .1; p.rot += p.vr; p.life -= p.decay;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.globalAlpha = p.life * .8;
            ctx.fillStyle = `hsl(${p.hue}, 80%, 70%)`;
            ctx.fillRect(-p.r / 2, -p.r, p.r, p.r * 2); ctx.restore();
        });
    }

    function resize() { W = c.width = innerWidth; H = c.height = innerHeight; }

    function tick() {
        if (!running) return;
        ctx.clearRect(0, 0, W, H);
        const t = Date.now() * .001;

        // Petals
        petals.forEach(p => {
            p.x += p.vx + Math.sin(t + p.y * .01) * .25;
            p.y += p.vy; p.rot += p.vr;
            if (p.y > H + 30) Object.assign(p, mkPetal(true));
            drawPetal(p);
        });

        // Fireflies
        flies.forEach(f => {
            f.x += f.dx + Math.sin(t * .7 + f.phase) * .4;
            f.y += f.dy + Math.cos(t * .5 + f.phase) * .3;
            if (f.x < -20) f.x = W + 20;
            if (f.x > W + 20) f.x = -20;
            if (f.y < -20) f.y = H + 20;
            if (f.y > H + 20) f.y = -20;
            drawFly(f, t);
        });

        // Confetti
        if (confetti.length) drawConfetti();

        rafId = requestAnimationFrame(tick);
    }

    // Visibility API — pause when tab hidden
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { running = false; if (rafId) cancelAnimationFrame(rafId); }
        else { running = true; tick(); }
    });

    resize(); addEventListener('resize', resize);
    for (let i = 0; i < PETAL_N; i++) petals.push(mkPetal(false));
    for (let i = 0; i < FLY_N; i++) flies.push(mkFly());
    tick();

    return { burst };
})();

/* ═══════════════════════════════════════
 *  DATA MANAGER
 * ═══════════════════════════════════════ */
$('btn-data').addEventListener('click', openDataMgr);
$('btn-data-close').addEventListener('click', () => {
    DataStore.getVocab().length > 0 ? goToDash() : show('f-upload');
});
$('btn-export').addEventListener('click', () => DataStore.exportJSON());

function openDataMgr() { refreshDataMgr(); show('f-data'); $('data-search').value = ''; }

function refreshDataMgr(filter = '') {
    const v = DataStore.getVocab();
    $('stored-cnt').textContent = v.length;
    const list = $('stored-list');
    list.innerHTML = '';
    if (v.length) {
        $('btn-clear').classList.remove('hidden');
        const filtered = filter
            ? v.filter(w => w.word.toLowerCase().includes(filter) || w.meaning.toLowerCase().includes(filter))
            : v;
        filtered.slice(0, 80).forEach(w => {
            list.innerHTML += `<div class="s-item"><span class="s-word">${w.word}</span><span class="s-mean">${w.meaning}</span></div>`;
        });
        if (!filtered.length) list.innerHTML = '<p style="color:var(--text-2);font-size:.8rem;text-align:center;padding:10px">Không tìm thấy.</p>';
    } else {
        $('btn-clear').classList.add('hidden');
        list.innerHTML = '<p style="color:var(--text-2);font-size:.8rem;text-align:center;padding:10px">Chưa có dữ liệu.</p>';
    }
}

// Search filter
$('data-search').addEventListener('input', e => refreshDataMgr(e.target.value.toLowerCase().trim()));

setupDrop($('dz-mgr'), $('fi-mgr'), handleImport);
$('fi-mgr').addEventListener('change', e => { if (e.target.files[0]) handleImport(e.target.files[0]); });

async function handleImport(file) {
    try {
        const parsed = await FileHandler.readFile(file);
        const mode = document.querySelector('input[name="im"]:checked').value;
        let final;
        if (mode === 'append') {
            final = [...DataStore.getVocab()];
            parsed.forEach(nw => { if (!final.find(o => o.word === nw.word)) final.push(nw); });
        } else { final = parsed; DataStore.clearHistory(); }
        DataStore.saveVocab(final);
        alert(`✅ Đã lưu ${final.length} từ vựng!`);
        refreshDataMgr();
    } catch (e) { alert('❌ ' + e); }
    $('fi-mgr').value = '';
}

$('btn-clear').addEventListener('click', () => {
    if (confirm('Xóa toàn bộ dữ liệu và lịch sử học?')) {
        DataStore.clearAll(); refreshDataMgr(); show('f-upload');
    }
});

/* ── Upload ── */
setupDrop($('dz-main'), $('fi-main'), handleFirstUpload);
$('fi-main').addEventListener('change', e => { if (e.target.files[0]) handleFirstUpload(e.target.files[0]); });

async function handleFirstUpload(file) {
    try {
        const parsed = await FileHandler.readFile(file);
        DataStore.saveVocab(parsed);
        alert(`✅ Đã tải ${parsed.length} từ vựng!`);
        goToDash();
    } catch (e) { alert('❌ ' + e); }
    $('fi-main').value = '';
}

function setupDrop(zone, input, handler) {
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
    });
}

/* ═══════════════════════════════════════
 *  DASHBOARD
 * ═══════════════════════════════════════ */
function goToDash() {
    inFocus = false; inTest = false;
    $('topbar').classList.remove('hidden-bar');
    show('f-dash');

    const q = getTodayQuote();
    $('quote-text').textContent = `"${q.text}"`;
    $('quote-author').textContent = `— ${q.author}`;

    const vocab = DataStore.getVocab();
    const stats = StudyEngine.getStats(vocab);
    $('st-total').textContent = stats.total;
    $('st-due').textContent = stats.due;
    $('st-mastered').textContent = stats.mastered;
    $('st-streak').textContent = DataStore.getStudyStreak();

    renderHeatmap();
    renderDeck(vocab);
}

function renderHeatmap() {
    const hm = $('heatmap'); hm.innerHTML = '';
    const hist = DataStore.getHistory();
    const today = new Date();
    for (let i = 83; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        const cnt = hist[key] || 0;
        let op = cnt === 0 ? .06 : cnt <= 5 ? .28 : cnt <= 15 ? .55 : cnt <= 30 ? .82 : 1;
        const cell = document.createElement('div');
        cell.className = 'hm-cell'; cell.style.opacity = op; cell.title = `${key}: ${cnt} từ`;
        hm.appendChild(cell);
    }
}

function renderDeck(vocab) {
    const list = $('deck-list'), empty = $('deck-empty');
    const now = Date.now();
    const due = vocab.filter(w => !w.nextReview || w.nextReview <= now);
    list.querySelectorAll('.deck-item').forEach(e => e.remove());

    const reviewBtn = $('btn-review'), quizBtn = $('btn-quiz-mode');
    if (vocab.length > 0) { reviewBtn.classList.remove('hidden'); quizBtn.classList.remove('hidden'); }
    else { reviewBtn.classList.add('hidden'); quizBtn.classList.add('hidden'); }

    if (due.length > 0) {
        empty.style.display = 'none';
        due.slice(0, 12).forEach(w => {
            const el = document.createElement('div'); el.className = 'deck-item';
            el.innerHTML = `<span class="di-word">${w.word}</span><span class="di-mean">${w.meaning}</span>`;
            list.appendChild(el);
        });
    } else if (vocab.length > 0) {
        empty.textContent = '🎉 Hôm nay không còn từ nào cần ôn!';
        empty.style.display = 'block';
    } else {
        empty.innerHTML = 'Chưa có dữ liệu — nhấn <strong>📂</strong> để thêm.';
        empty.style.display = 'block';
    }
}

$('btn-review').addEventListener('click', () => startFocus());
$('btn-quiz-mode').addEventListener('click', () => { $('topbar').classList.add('hidden-bar'); show('f-qtype'); });

/* ═══════════════════════════════════════
 *  FOCUS MODE — Flashcard
 * ═══════════════════════════════════════ */
function startFocus(onlyWords) {
    const vocab = DataStore.getVocab();
    if (!vocab.length) return alert('Không có dữ liệu!');
    studyEng = new StudyEngine(vocab);
    if (!studyEng.initSession(onlyWords || null)) return alert('Không có gì cần ôn!');
    inFocus = true; inTest = false;
    $('topbar').classList.add('hidden-bar');
    show('f-focus');
    renderFC();
}

function renderFC() {
    if (studyEng.isFinished()) { showFocusResults(); return; }
    $('focus-bar').style.width = `${studyEng.progress()}%`;
    $('focus-cnt').textContent = studyEng.countLabel();
    $('lc-known').textContent = `✅ ${studyEng.knownCount}`;
    $('lc-unknown').textContent = `❌ ${studyEng.unknownCount}`;

    const fc = $('fc');
    fc.classList.remove('flip', 'anim-easy', 'anim-again', 'dragging');
    fc.style.transform = '';
    isFlipped = false;
    $('rating-bar').classList.add('hidden');
    $('swipe-left-ol').style.opacity = '0';
    $('swipe-right-ol').style.opacity = '0';

    const card = studyEng.currentCard();
    $('fc-type').textContent = card.type || 'word';
    $('fc-word').textContent = card.word;
    $('fc-phone').textContent = card.phonetic || '';
    $('bk-meaning').textContent = card.meaning;
    $('bk-example').textContent = card.example || '—';
    tagRow('bk-syn-row', 'bk-synonyms', card.synonyms);
    tagRow('bk-col-row', 'bk-collocations', card.collocations);
}

function tagRow(rid, eid, items) {
    const row = $(rid), el = $(eid);
    if (items && items.length) { row.style.display = 'flex'; el.innerHTML = items.map(t => `<span class="tag-chip">${t}</span>`).join(''); }
    else row.style.display = 'none';
}

/* ── Click vs Swipe — movement detection ── */
const scene = $('fc-scene');
let pointerStart = null;   // { x, y, time }
let isDragging = false;
const CLICK_THRESHOLD = 12;  // px — less than this = click
const SWIPE_THRESHOLD = 80;  // px — more than this = swipe

scene.addEventListener('pointerdown', e => {
    if (!inFocus) return;
    pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() };
    isDragging = false;
});

scene.addEventListener('pointermove', e => {
    if (!pointerStart || !inFocus || !isFlipped) return;
    const dx = e.clientX - pointerStart.x;
    const absDx = Math.abs(dx);

    if (absDx > CLICK_THRESHOLD) {
        isDragging = true;
        // Visual drag feedback
        const fc = $('fc');
        fc.classList.add('dragging');
        const tilt = Math.max(-15, Math.min(15, dx * 0.05));
        const shift = Math.max(-60, Math.min(60, dx * 0.3));
        fc.style.transform = `rotateY(180deg) translateX(${shift}px) rotate(${tilt}deg)`;

        // Direction overlays
        const pct = Math.min(1, absDx / SWIPE_THRESHOLD);
        if (dx < 0) {
            $('swipe-left-ol').style.opacity = pct;
            $('swipe-right-ol').style.opacity = '0';
        } else {
            $('swipe-right-ol').style.opacity = pct;
            $('swipe-left-ol').style.opacity = '0';
        }
    }
});

scene.addEventListener('pointerup', e => {
    if (!pointerStart || !inFocus) { pointerStart = null; return; }
    const dx = e.clientX - pointerStart.x;
    const absDx = Math.abs(dx);
    pointerStart = null;

    // Reset drag visuals
    const fc = $('fc');
    fc.classList.remove('dragging');
    $('swipe-left-ol').style.opacity = '0';
    $('swipe-right-ol').style.opacity = '0';

    if (isDragging && isFlipped && absDx >= SWIPE_THRESHOLD) {
        // Swipe: right = thuộc, left = chưa thuộc
        doRate(dx > 0 ? 4 : 1);
    } else if (!isDragging) {
        // Click: flip
        flipCard();
    } else {
        // Dragged but not far enough → snap back
        fc.style.transform = isFlipped ? 'rotateY(180deg)' : '';
    }

    isDragging = false;
});

// Prevent pointer capture issues
scene.addEventListener('pointerleave', () => {
    if (isDragging) {
        const fc = $('fc');
        fc.classList.remove('dragging');
        fc.style.transform = isFlipped ? 'rotateY(180deg)' : '';
        $('swipe-left-ol').style.opacity = '0';
        $('swipe-right-ol').style.opacity = '0';
        isDragging = false; pointerStart = null;
    }
});

function flipCard() {
    if (!inFocus) return;
    sndFlip();
    isFlipped = !isFlipped;
    $('fc').style.transform = '';
    $('fc').classList.toggle('flip', isFlipped);
    $('rating-bar').classList.toggle('hidden', !isFlipped);
}

/* ── Rate ── */
$('rb-dont').addEventListener('click', e => { e.stopPropagation(); doRate(1); });
$('rb-know').addEventListener('click', e => { e.stopPropagation(); doRate(4); });

function doRate(r) {
    if (!isFlipped) return;
    r >= 3 ? sndCorrect() : sndWrong();
    const fc = $('fc');
    fc.classList.remove('anim-easy', 'anim-again', 'dragging');
    fc.style.transform = '';
    void fc.offsetWidth;
    fc.classList.add(r >= 3 ? 'anim-easy' : 'anim-again');
    studyEng.rate(r);
    setTimeout(renderFC, r >= 3 ? 460 : 520);
}

$('btn-exit-focus').addEventListener('click', () => {
    if (studyEng && !studyEng.isFinished()) {
        if (!confirm('Thoát sẽ mất tiến trình phiên này. Tiếp tục?')) return;
    }
    goToDash();
});

function showFocusResults() {
    inFocus = false;
    $('topbar').classList.remove('hidden-bar');
    lastSource = 'focus';
    lastWrong = studyEng.wrongAnswers;
    renderResults(studyEng.scorePercent(), studyEng.score, studyEng.answered, lastWrong);
}

/* ═══════════════════════════════════════
 *  QUIZ TYPE → TEST
 * ═══════════════════════════════════════ */
$('back-to-dash-from-qtype').addEventListener('click', goToDash);
$('back-to-qtype').addEventListener('click', () => {
    if (quizEng && !quizEng.isFinished()) {
        if (!confirm('Thoát sẽ mất tiến trình. Tiếp tục?')) return;
    }
    inTest = false;
    $('topbar').classList.add('hidden-bar');
    show('f-qtype');
});

$$('.qtype-btn').forEach(btn => {
    btn.addEventListener('click', () => { curQuizType = btn.dataset.quiz; startTest(curQuizType); });
});

function startTest(type) {
    const vocab = DataStore.getVocab();
    if (!vocab.length) return alert('Không có dữ liệu!');
    quizEng = new QuizEngine(vocab, type);
    inTest = true; inFocus = false;
    $('topbar').classList.add('hidden-bar');
    show('f-test');
    renderQ();
    updProg();
}

function updProg() {
    $('test-bar').style.width = `${quizEng.getProgress()}%`;
    $('test-lbl').textContent = quizEng.getPositionLabel();
}

function renderQ() {
    if (quizEng.isFinished()) { showTestResults(); return; }
    $('q-opts').innerHTML = ''; $('q-opts').classList.remove('hidden');
    $('q-inp-wrap').classList.add('hidden');
    $('q-context').classList.add('hidden');
    $('q-syns').classList.add('hidden');
    $('q-fb').classList.add('hidden');
    $('q-display').innerHTML = '';

    const qd = quizEng.generateQuestion();

    // Wave
    const wr = $('wave-row');
    if (qd.wave) {
        wr.classList.remove('hidden');
        [1, 2, 3].forEach(i => wr.querySelector(`.wd${i}`).classList.toggle('on', i === qd.wave));
        $('wave-text').textContent = { 1: 'Sóng 1 · Trắc nghiệm', 2: 'Sóng 2 · Điền từ', 3: 'Sóng 3 · Hoàn thành câu' }[qd.wave] || '';
    } else wr.classList.add('hidden');

    const badges = { recognition: '📖 Trắc nghiệm xuôi', reverse: '🔄 Trắc nghiệm ngược', spelling: '✍️ Điền từ', context: '💬 Hoàn thành câu', synonym: '🔗 Liên tưởng' };
    $('qt-badge').textContent = badges[qd.type] || qd.type;
    $('q-prompt').textContent = qd.prompt || '';

    switch (qd.type) {
        case 'recognition':
            $('q-display').innerHTML = `<span class="q-type-pill">${qd.displayType || ''}</span><div class="q-big-word">${qd.display}</div><div class="q-phone-text">${qd.displayPhonetic || ''}</div>`;
            mkOpts(qd.options, qd.correctAnswer); break;
        case 'reverse':
            $('q-display').innerHTML = `<div class="q-big-word" style="color:var(--green);font-size:1.5rem">${qd.display}</div>`;
            mkOpts(qd.options, qd.correctAnswer); break;
        case 'spelling':
            $('q-display').innerHTML = `<div class="q-big-word" style="color:var(--gold);font-size:1.5rem">${qd.display}</div><div class="q-phone-text">${qd.displayPhonetic || ''}</div>`;
            $('q-opts').classList.add('hidden'); mkInput(qd.correctAnswer); break;
        case 'context':
            if (qd.contextSentence) {
                $('q-context').innerHTML = qd.contextSentence.replace('______', '<span class="ctx-blank">______</span>');
                $('q-context').classList.remove('hidden');
            }
            $('q-opts').classList.add('hidden'); mkInput(qd.correctAnswer); break;
        case 'synonym':
            $('q-syns').innerHTML = (qd.synonyms || []).map(s => `<span class="syn-chip">${s}</span>`).join('');
            $('q-syns').classList.remove('hidden');
            mkOpts(qd.options, qd.correctAnswer); break;
    }
}

function mkOpts(opts, correct) {
    const g = $('q-opts');
    (opts || []).forEach(o => {
        const b = document.createElement('button'); b.className = 'opt-btn'; b.textContent = o;
        b.addEventListener('click', () => {
            if (b.classList.contains('opt-ok') || b.classList.contains('opt-err')) return;
            const { isCorrect } = quizEng.checkAnswer(o);
            isCorrect ? sndCorrect() : sndWrong();
            g.querySelectorAll('.opt-btn').forEach(x => {
                if (x.textContent === correct) x.classList.add('opt-ok');
                else if (x === b && !isCorrect) x.classList.add('opt-err');
                else if (!x.classList.contains('opt-ok')) x.classList.add('opt-dim');
            });
            showQFB(isCorrect, correct, isCorrect);
        });
        g.appendChild(b);
    });
}

function mkInput(correct) {
    const wrap = $('q-inp-wrap'), inp = $('q-inp');
    wrap.classList.remove('hidden');
    inp.value = ''; inp.disabled = false; inp.className = 'q-inp';
    const old = $('q-sub'); const sub = old.cloneNode(true); old.parentNode.replaceChild(sub, old);
    const submit = () => {
        if (!inp.value.trim() || inp.disabled) return;
        inp.disabled = true;
        const { isCorrect } = quizEng.checkAnswer(inp.value);
        isCorrect ? sndCorrect() : sndWrong();
        inp.classList.add(isCorrect ? 'inp-ok' : 'inp-err');
        if (!isCorrect) inp.value += `  →  ${correct}`;
        showQFB(isCorrect, correct, false);
    };
    sub.addEventListener('click', submit);
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    setTimeout(() => inp.focus(), 100);
}

function showQFB(ok, correct, autoAdv) {
    const fb = $('q-fb');
    fb.classList.remove('hidden', 'fb-ok', 'fb-err');
    $('q-fb-msg').textContent = ok ? '✓ Chính xác!' : `✗ Đáp án: ${correct}`;
    fb.classList.add(ok ? 'fb-ok' : 'fb-err');
    if (autoAdv) { setTimeout(() => { quizEng.advance(); renderQ(); updProg(); }, 700); return; }
    const old = $('q-next'); const btn = old.cloneNode(true); old.parentNode.replaceChild(btn, old);
    const go = () => { quizEng.advance(); renderQ(); updProg(); document.removeEventListener('keydown', kn); };
    btn.addEventListener('click', go);
    const kn = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    setTimeout(() => document.addEventListener('keydown', kn), 200);
}

function showTestResults() {
    inTest = false;
    $('topbar').classList.remove('hidden-bar');
    lastSource = 'test';
    lastWrong = quizEng.wrongAnswers;
    renderResults(quizEng.getScorePercent(), quizEng.score, quizEng.total, lastWrong);
}

/* ═══════════════════════════════════════
 *  RESULTS
 * ═══════════════════════════════════════ */
function renderResults(pct, score, total, wrongs) {
    show('f-result');
    $('res-emoji').textContent = pct >= 90 ? '🏆' : pct >= 70 ? '🎉' : pct >= 50 ? '💪' : '📖';
    $('res-detail').textContent = `Đúng ${score} / ${total} câu`;

    // Ring animation
    const ring = $('ring-fill'), circ = 326.73;
    ring.style.transition = 'none'; ring.style.strokeDashoffset = circ;
    void ring.offsetWidth;
    ring.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(.23,1,.32,1)';
    ring.style.strokeDashoffset = circ - (pct / 100) * circ;
    ring.style.stroke = pct >= 70 ? 'var(--green)' : pct >= 50 ? 'var(--gold)' : 'var(--red)';
    animN('ring-val', 0, pct, 1200);

    // Confetti burst for ≥90%
    if (pct >= 90) setTimeout(() => particleEngine.burst(80), 400);

    // Wrong list
    const wd = $('res-wrong'), wl = $('wrong-list');
    wl.innerHTML = '';
    const unique = [...new Map((wrongs || []).map(x => [x.word, x])).values()];
    if (unique.length > 0) {
        wd.classList.remove('hidden');
        unique.forEach(x => {
            wl.innerHTML += `<div class="wrong-item"><span class="wi-word">${x.word}</span><span class="wi-ans">→ ${x.correctAnswer || ''}</span></div>`;
        });
    } else wd.classList.add('hidden');

    $('btn-retry-wrong').disabled = unique.length === 0;
}

function animN(id, from, to, dur) {
    const el = $(id), t0 = performance.now();
    const step = t => { const p = Math.min((t - t0) / dur, 1); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
}

$('btn-retry').addEventListener('click', () => { lastSource === 'focus' ? startFocus() : startTest(curQuizType); });
$('btn-retry-wrong').addEventListener('click', () => {
    if (!lastWrong || !lastWrong.length) return;
    const vocab = DataStore.getVocab();
    const wrongWords = lastWrong.map(w => vocab.find(v => v.word === w.word)).filter(Boolean);
    if (!wrongWords.length) return alert('Không tìm được từ sai!');
    startFocus(wrongWords);
});
$('btn-new-type').addEventListener('click', () => { $('topbar').classList.add('hidden-bar'); show('f-qtype'); });
$('btn-to-dash').addEventListener('click', goToDash);

/* ═══════════════════════════════════════
 *  KEYBOARD SHORTCUTS
 * ═══════════════════════════════════════ */
document.addEventListener('keydown', e => {
    // Global: M for music
    if (e.key.toLowerCase() === 'm' && !e.target.matches('input')) { musicBtn.click(); return; }

    if (!inFocus && !inTest) {
        if ($('f-dash').classList.contains('active')) {
            if (e.key.toLowerCase() === 'r') { e.preventDefault(); $('btn-review').click(); }
            if (e.key.toLowerCase() === 't') { e.preventDefault(); $('btn-quiz-mode').click(); }
        }
        return;
    }
    if (inFocus) {
        if ((e.key === ' ' || e.key === 'Spacebar') && !e.target.matches('input')) { e.preventDefault(); flipCard(); }
        if (isFlipped) {
            if (e.key === '1' || e.key === 'ArrowLeft') { e.preventDefault(); doRate(1); }
            if (e.key === '4' || e.key === 'ArrowRight') { e.preventDefault(); doRate(4); }
        }
        if (e.key === 'Escape') $('btn-exit-focus').click();
        return;
    }
    if (inTest) {
        const opts = $('q-opts').querySelectorAll('.opt-btn:not(.opt-ok):not(.opt-err):not(.opt-dim)');
        const n = parseInt(e.key);
        if (n >= 1 && n <= opts.length) { e.preventDefault(); opts[n - 1].click(); }
        if (e.key === 'Escape') { $('back-to-qtype').click(); }
    }
});

/* ═══════════════════════════════════════
 *  INIT
 * ═══════════════════════════════════════ */
(function init() {
    const vocab = DataStore.getVocab();
    if (vocab.length > 0) goToDash();
    else show('f-upload');
    tryPlay();
})();