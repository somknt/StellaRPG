// サウンド（効果音・BGM）
//
// 音のファイルを置くだけで鳴る（コードを書きかえなくてよい）
//   効果音      → assets/sounds/se/<名前>.mp3    例：assets/sounds/se/attack.mp3
//   BGM・ジングル → assets/sounds/bgm/<名前>.mp3   例：assets/sounds/bgm/bgm_title.mp3
//   形式は mp3 / ogg / wav のどれでもよい（同じ名前が2つあれば mp3 → ogg → wav の順で使う）
// 名前の一覧は下の SoundManager.LIST（assets/sounds/📋ここに音声ファイルを置いてください.txt にも同じ一覧）
// 置いていない音は鳴らないだけ（エラーにならない）。fallback がある音は、代わりにその音を鳴らす
//
// しくみ：効果音は Web Audio（重ねて鳴らせる・遅れが少ない）。BGM は <audio> で流し、音量は Web Audio で調整する
// ブラウザ・スマホは「最初に画面をさわるまで音を出せない」ので、最初のタップ・クリック・キーで音を有効にする
// （その前に頼まれた BGM は、有効になった時に流れ始める）

class SoundManager {
    constructor() {
        this.ac = null;          // Web Audio（使えないブラウザでは null。その時は <audio> で鳴らす）
        this.sfxGain = null;
        this.bgmGain = null;
        this.buffers = {};       // 効果音：名前 → 音のデータ
        this.seUrls = {};        // 効果音：名前 → ファイルの場所（Web Audio が使えない時）
        this.bgmUrls = {};       // BGM：名前 → ファイルの場所
        this.loaded = false;     // 全部のファイルを探し終わったか
        this.bgm = null;         // 今流れている BGM { key, slot, vol, ended }
        this.pausedBGM = null;   // pauseBGM で止めている BGM（続きから流せる）
        this.bgmSlots = [];      // BGM を流す <audio> 2つ（切りかえの時に重ねてフェードする。最初のタップで使えるようにする）
        this.wantBGM = null;     // 流したい BGM（音が有効になる前・読み込みの前に頼まれた物）
        // 音量（0〜1。設定の画面で変えられる。settings.js が入れる）
        //   master：全体 / bgm：BGM / ui・battle・enemy・voice：効果音の種類ごと（SoundManager.CATS）
        this.volumes = { ...SoundManager.DEFAULT_VOLUMES };
        this.catGains = {};      // 効果音の種類ごとの音量（Web Audio）
        this.muted = false;
        this.duck = 1;           // 一時停止中は BGM を小さくする
        this.unlocked = false;   // 画面をさわって、音を出せるようになったか
        this.lastPlay = {};      // 同じ効果音が重なりすぎないように、最後に鳴らした時間
        this.active = {};        // 鳴っている効果音（名前 → [{ src, g }]。stop で止める）
        this.entries = {};
        for (const e of SoundManager.LIST) this.entries[e.key] = e;
        this.initContext();
        this.bindUnlock();
        this.ready = this.loadAll();
    }
    
    initContext() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
            this.ac = new AC();
            // つなぎ方：効果音 → 種類ごとの音量 → 効果音全体 ─┐
            //           BGM ──────────────→ BGM の音量 ───┴→ 全体の音量 → リミッター → スピーカー
            // リミッター：大きな声（咆哮）が重なっても音が割れないように、いちばん大きい所だけ抑える
            this.masterGain = this.ac.createGain();
            this.limiter = this.ac.createDynamicsCompressor();
            const L = SoundManager.LIMITER;
            this.limiter.threshold.value = L.threshold;
            this.limiter.knee.value = L.knee;
            this.limiter.ratio.value = L.ratio;
            this.limiter.attack.value = L.attack;
            this.limiter.release.value = L.release;
            this.masterGain.connect(this.limiter);
            this.limiter.connect(this.ac.destination);
            this.sfxGain = this.ac.createGain();
            this.bgmGain = this.ac.createGain();
            this.sfxGain.connect(this.masterGain);
            this.bgmGain.connect(this.masterGain);
            for (const cat of Object.keys(SoundManager.CATS)) {
                const g = this.ac.createGain();
                g.connect(this.sfxGain);
                this.catGains[cat] = g;
            }
            this.applyVolumes();
        } catch (e) {
            this.ac = null;
        }
    }
    
    // ---------- 読み込み ----------
    // 一覧の名前のファイルが se/・bgm/ にあるか探す（ない物は何もしない）
    async loadAll() {
        if (location.protocol === 'file:') {
            // ファイルを直接開いた時は読み込めない（サーバー・Vercel で開くと鳴る）
            this.loaded = true;
            return;
        }
        await Promise.all(SoundManager.LIST.map(e => this.loadOne(e).catch(() => {})));
        this.loaded = true;
        const se = SoundManager.LIST.filter(e => !e.bgm), bgm = SoundManager.LIST.filter(e => e.bgm);
        const nSe = se.filter(e => this.buffers[e.key] || this.seUrls[e.key]).length;
        const nBgm = bgm.filter(e => this.bgmUrls[e.key]).length;
        console.info(`サウンド：効果音 ${nSe}/${se.length}・BGM ${nBgm}/${bgm.length} を読み込みました（一覧は soundManager.status()）`);
        if (this.wantBGM) this.playBGM(this.wantBGM);
    }
    
    // 効果音は <名前>_2・<名前>_3… も探す（あれば、鳴らすたびにどれか1つをランダムに選ぶ）
    async loadOne(e) {
        if (e.bgm) {
            const url = await this.findFile('bgm', e.key, true);
            if (url) this.bgmUrls[e.key] = url;
            return;
        }
        for (let n = 1; n <= SoundManager.MAX_VARIANTS; n++) {
            const name = n === 1 ? e.key : `${e.key}_${n}`;
            const found = await this.findFile('se', name, false);
            if (!found) break;
            if (!this.ac) { (this.seUrls[e.key] = this.seUrls[e.key] || []).push(found.url); continue; }
            try {
                const buf = await new Promise((ok, ng) => this.ac.decodeAudioData(found.data, ok, ng));
                (this.buffers[e.key] = this.buffers[e.key] || []).push({ buf, start: SoundManager.leadingSilence(buf) });
            } catch (err) {
                console.warn('効果音を読めませんでした（形式を確認してください）:', found.url);
            }
        }
    }
    
    // mp3 → ogg → wav の順に探す。BGM はあるかどうかだけ調べて場所を返す（大きいので、流す時に読み込む）
    // 効果音は中身（ArrayBuffer）も返す
    async findFile(folder, name, headOnly) {
        for (const ext of SoundManager.EXTS) {
            const url = `${SoundManager.DIR}/${folder}/${name}.${ext}`;
            let r;
            try {
                // no-cache：あとからファイルを足した時に、前の「ない」という答えを使わないように毎回たしかめる
                r = await fetch(url, { method: headOnly ? 'HEAD' : 'GET', cache: 'no-cache' });
                if (headOnly && (r.status === 405 || r.status === 501)) r = await fetch(url, { cache: 'no-cache' });
            } catch (err) { continue; }
            if (!r.ok || !SoundManager.isAudioResponse(r)) continue;
            if (headOnly) return url;
            try { return { url, data: await r.arrayBuffer() }; } catch (err) { continue; }
        }
        return null;
    }
    
    // 音の最初の無音（ダウンロードした効果音によくある）の長さ（秒）。そこを飛ばして、押した瞬間に鳴るようにする
    static leadingSilence(buf) {
        const ch = [];
        for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
        let peak = 0;
        for (const d of ch) for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
        const th = Math.max(0.004, peak * 0.05);
        const len = buf.length;
        for (let i = 0; i < len; i++) {
            for (const d of ch) if (Math.abs(d[i]) > th) return Math.max(0, i / buf.sampleRate - 0.006);
        }
        return 0;
    }
    
    // サーバーによっては、ないファイルの代わりにページ（HTML）を返すので、それは音として使わない
    static isAudioResponse(r) {
        const t = (r.headers.get('content-type') || '').toLowerCase();
        return !t.includes('text/html');
    }
    
    // 名前の音がない時は fallback をたどる。どれもなければ null
    resolve(key) {
        let k = key;
        for (let i = 0; k && i < 6; i++) {
            if (this.buffers[k] || this.seUrls[k] || this.bgmUrls[k]) return k;
            const e = this.entries[k];
            k = e && e.fallback;
        }
        return null;
    }
    has(key) { return !!this.resolve(key); }
    
    // 読み込めた音・まだない音の一覧（コンソールで soundManager.status() と打つと見られる）
    status() {
        const out = { loaded: [], missing: [] };
        for (const e of SoundManager.LIST) {
            const ok = this.buffers[e.key] || this.seUrls[e.key] || this.bgmUrls[e.key];
            (ok ? out.loaded : out.missing).push(`${e.bgm ? 'bgm' : 'se'}/${e.key}（${e.label}）`);
        }
        return out;
    }
    
    // ---------- 音を有効にする ----------
    bindUnlock() {
        const unlock = () => {
            if (this.ac && this.ac.state !== 'running') this.ac.resume().catch(() => {});
            if (this.ac && !this.silentPlayed) {
                // iPhone：最初のタップの中で無音を1回鳴らすと、そのあと音が出るようになる
                this.silentPlayed = true;
                try {
                    const s = this.ac.createBufferSource();
                    s.buffer = this.ac.createBuffer(1, 1, 22050);
                    s.connect(this.ac.destination);
                    s.start(0);
                } catch (e) { /* 鳴らせなくても続ける */ }
            }
            // スマホは「指を離した時」に音が有効になるので、うまく流れ出すまで毎回たしかめる
            this.unlocked = true;
            this.primeBGMSlots();
            if (this.bgm) {
                const el = this.bgm.slot.el;
                if (el.paused && !this.bgm.ended && !this.muted) el.play().then(() => { this.bgm && (this.bgm.slot.primed = true); }).catch(() => {});
            } else if (this.wantBGM) {
                this.playBGM(this.wantBGM);
            }
        };
        for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) window.addEventListener(ev, unlock, true);
        // 別のアプリ・タブに切りかえたら音を止め、戻ったら続きから
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.ac) this.ac.suspend().catch(() => {});
                if (this.bgm) this.bgm.slot.el.pause();
            } else if (this.unlocked) {
                if (this.ac) this.ac.resume().catch(() => {});
                if (this.bgm && !this.bgm.ended && !this.muted) this.bgm.slot.el.play().catch(() => {});
            }
        });
    }
    
    // BGM の <audio> を2つ作る（Web Audio につないで音量を変えられるようにする。iPhone は <audio> の音量を変えられないため）
    makeBGMSlots() {
        if (this.bgmSlots.length) return;
        for (let i = 0; i < 2; i++) {
            const el = new Audio();
            el.preload = 'auto';
            const slot = { el, gain: null, token: 0 };
            if (this.ac) {
                try {
                    const src = this.ac.createMediaElementSource(el);
                    slot.gain = this.ac.createGain();
                    slot.gain.gain.value = 0;
                    src.connect(slot.gain);
                    slot.gain.connect(this.bgmGain);
                } catch (err) { slot.gain = null; }
            }
            // 曲が終わった：頭の無音を飛ばす曲（start）は、無音の後からくり返す。ジングル（1回だけの曲）はそこで終わり
            el.addEventListener('ended', () => {
                const b = this.bgm;
                if (!b || b.slot !== slot) return;
                if (b.loopFrom !== null && b.loopFrom !== undefined) {
                    try { el.currentTime = b.loopFrom; } catch (err) { /* 先頭から */ }
                    if (!this.muted) el.play().catch(() => {});
                    return;
                }
                b.ended = true;
                this.bgm = null;
            });
            this.bgmSlots.push(slot);
        }
    }
    
    // iPhone：最初のタップの中で一度鳴らした <audio> は、あとから（タップの外でも）曲を流せるようになる
    // （今 BGM を流している方と、もう使えるようになった方はそのまま）
    primeBGMSlots() {
        this.makeBGMSlots();
        for (const slot of this.bgmSlots) {
            if (slot.primed || slot.priming || (this.bgm && this.bgm.slot === slot)) continue;
            const t = slot.token;
            slot.priming = true;
            slot.el.src = SoundManager.SILENT_WAV;
            const p = slot.el.play();
            if (p && p.then) {
                p.then(() => { slot.primed = true; if (slot.token === t) slot.el.pause(); })
                 .catch(() => {})
                 .finally(() => { slot.priming = false; });
            } else {
                slot.priming = false;
            }
        }
    }
    
    // ---------- 効果音 ----------
    // opts：volume（音量の倍率）/ rate（再生の速さ＝音の高さ）/ gap（同じ音を続けて鳴らせる間隔・秒）/ vary（音の高さのゆらぎ）
    //       offset（頭から飛ばす秒）/ dur（この秒数だけ鳴らして、ふっと消す）
    // 設定は「opts → 頼まれた名前の一覧の設定 → 代わりに鳴らす音の設定」の順に使う
    //   例：magic_water_hit（rate 0.75）は、ファイルがない時 magic_water の音を少し低くして鳴らす
    // 戻り値：鳴らせたか（ファイルがない・音を出せない時は false）
    play(key, opts = {}) {
        const cat = this.categoryOf(key);
        if (this.muted || this.volumes.master <= 0 || !(this.volumes[cat] > 0)) return false;
        const k = this.resolve(key);
        if (!k) return false;
        const e0 = this.entries[key] || {};
        const e = this.entries[k] || {};
        const pick = (name, def) => opts[name] !== undefined ? opts[name] : e0[name] !== undefined ? e0[name] : e[name] !== undefined ? e[name] : def;
        const now = performance.now();
        if (this.lastPlay[key] && now - this.lastPlay[key] < pick('gap', 0.04) * 1000) return false;
        const vol = pick('volume', 1);
        const rate = pick('rate', 1);
        const offset = pick('offset', 0);
        const dur = pick('dur', 0);
        const list = this.buffers[k];
        if (list && this.ac) {
            // 画面をさわる前は鳴らさない（さわった時にまとめて鳴り出さないように）
            // さわった直後（音を有効にしている途中）は、そのまま鳴らせば有効になった瞬間に鳴る
            if (this.ac.state !== 'running' && !this.unlocked) return false;
            this.lastPlay[key] = now;
            const v = list[Math.floor(Math.random() * list.length)];
            const src = this.ac.createBufferSource();
            src.buffer = v.buf;
            // 同じ音でも少しだけ高さを変えて、くり返しても単調にならないようにする
            const vary = pick('vary', 0.04);
            src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
            const g = this.ac.createGain();
            src.connect(g);
            g.connect(this.catGains[cat] || this.sfxGain); // 種類ごとの音量につなぐ
            const t = this.ac.currentTime;
            const from = Math.min(v.buf.duration - 0.01, v.start + offset);
            g.gain.setValueAtTime(vol, t);
            if (dur > 0) {
                // 長い音は途中で切る（最後の 0.12 秒でふっと小さくする）。dur は聞こえる長さ（秒）
                const fade = Math.min(0.12, dur * 0.4);
                g.gain.setValueAtTime(vol, t + dur - fade);
                g.gain.linearRampToValueAtTime(0.0001, t + dur);
                src.start(t, from);
                src.stop(t + dur + 0.02);
            } else {
                src.start(t, from);
            }
            // 鳴っている音を覚えておく（stop で途中で止められるように）
            const node = { src, g };
            const act = this.active[key] = (this.active[key] || []);
            act.push(node);
            src.onended = () => { const i = act.indexOf(node); if (i >= 0) act.splice(i, 1); };
            return true;
        }
        const urls = this.seUrls[k];
        if (urls && urls.length) {
            this.lastPlay[key] = now;
            const a = new Audio(urls[Math.floor(Math.random() * urls.length)]);
            a.volume = Math.max(0, Math.min(1, vol * this.volumes[cat] * this.volumes.master));
            a.playbackRate = rate;
            if (offset) a.currentTime = offset;
            a.play().catch(() => {});
            if (dur > 0) setTimeout(() => a.pause(), dur * 1000);
            return true;
        }
        return false;
    }
    playSFX(key, opts) { return this.play(key, opts); } // 前の名前（互換用）
    
    // 鳴っている効果音を途中で止める（fade 秒でふっと小さくする）。詠唱をキャンセルした時など
    stop(key, fade = 0.08) {
        const act = this.active[key];
        if (!act || !act.length || !this.ac) return;
        const t = this.ac.currentTime;
        for (const n of act.splice(0)) {
            try {
                n.g.gain.cancelScheduledValues(t);
                n.g.gain.setValueAtTime(n.g.gain.value, t);
                n.g.gain.linearRampToValueAtTime(0.0001, t + fade);
                n.src.stop(t + fade + 0.02);
            } catch (e) { /* もう止まっている */ }
        }
    }
    
    // ---------- BGM ----------
    // 同じ曲がもう流れていれば何もしない（画面を移っても曲が途切れない）。ない曲なら今の曲を止める
    // opts.resume：pauseBGM で止めた曲と同じなら、止めた所から続きを流す（ボスの形態が変わっても同じ曲の時）
    playBGM(key, opts = {}) {
        this.wantBGM = key;
        if (!this.loaded) return;                 // 探し終わったら流す
        const k = this.resolve(key);
        if (this.bgm && this.bgm.key === k && !this.bgm.ended) return;
        const paused = this.pausedBGM;
        this.pausedBGM = null;
        if (opts.resume && paused && paused.key === k && this.unlocked && !this.bgm) {
            // 止めた所から続ける
            paused.slot.token++;
            this.lastSlot = paused.slot;
            this.bgm = paused;
            if (!this.muted) paused.slot.el.play().catch(() => {});
            this.fadeBGMTo(paused, 1, 0.8);
            return;
        }
        this.fadeOutBGM(0.6);
        if (!k || !this.unlocked) return;         // 画面をさわった時に流す
        this.makeBGMSlots();
        const e = this.entries[k] || {};
        // 今フェードアウトしている方ではない <audio> を使う（2つを交互に）
        const slot = this.bgmSlots.find(s => s !== this.lastSlot) || this.bgmSlots[0];
        this.lastSlot = slot;
        slot.token++;                             // 前の曲の「あとで止める」を取り消す
        const el = slot.el;
        // 頭の無音を飛ばす曲（start）は、自分でくり返す（ended で start の位置に戻す。くり返すたびに無音が入らないように）
        const loopFrom = e.loop !== false && e.start ? e.start : null;
        el.loop = e.loop !== false && loopFrom === null;
        el.src = this.bgmUrls[k];
        // start：曲の頭の無音を飛ばす（秒）。読み込みの前に入れた位置は使われないことがあるので、読めた時にもう一度入れる
        if (e.start) {
            const at = e.start, t = slot.token;
            try { el.currentTime = at; } catch (err) { /* 読めてから入れる */ }
            el.addEventListener('loadedmetadata', () => { if (slot.token === t && el.currentTime < at) el.currentTime = at; }, { once: true });
        }
        const b = { key: k, slot, vol: e.volume !== undefined ? e.volume : 1, ended: false, loopFrom };
        this.bgm = b;
        if (slot.gain) slot.gain.gain.value = 0;
        // 流れなかった時（まだ音が有効でない）は、次に画面をさわった時にもう一度流す（bindUnlock）
        if (!this.muted) el.play().then(() => { slot.primed = true; }).catch(() => {});
        // ジングル（1回だけの曲）はすぐ大きく、ループの曲はふわっと始める
        this.fadeBGMTo(b, 1, e.loop === false ? 0.05 : 0.8);
    }
    
    fadeBGMTo(b, level, time) {
        const v = level * b.vol;
        const g = b.slot.gain;
        if (g && this.ac) {
            const t = this.ac.currentTime;
            g.gain.cancelScheduledValues(t);
            g.gain.setValueAtTime(g.gain.value, t);
            g.gain.linearRampToValueAtTime(v, t + time);
        } else {
            b.slot.el.volume = Math.max(0, Math.min(1, v * this.volumes.bgm * this.volumes.master * this.duck));
        }
    }
    
    fadeOutBGM(time = 0.6) {
        const b = this.bgm;
        if (!b) return;
        this.bgm = null;
        this.fadeBGMTo(b, 0, time);
        const slot = b.slot, t = slot.token;
        setTimeout(() => { if (slot.token === t) slot.el.pause(); }, time * 1000 + 60);
    }
    
    stopBGM() {
        this.wantBGM = null;
        this.pausedBGM = null;
        this.fadeOutBGM(0.3);
    }
    
    // BGM を一時的に止める（ボスの形態が変わる時：BGM を消して、吠える声だけにする）
    // 止めた所は覚えておき、playBGM(同じ曲, { resume: true }) で続きから流せる
    // （止めている間は、画面をさわっても BGM が流れ出さないように wantBGM を消す）
    pauseBGM(fade = 0.3) {
        this.wantBGM = null;
        const b = this.bgm;
        if (!b) return;
        this.bgm = null;
        this.pausedBGM = b;
        this.fadeBGMTo(b, 0, fade);
        const slot = b.slot, t = slot.token;
        setTimeout(() => { if (slot.token === t) slot.el.pause(); }, fade * 1000 + 60);
    }
    
    // 効果音の長さ（秒。頭の無音を除く。ランダムの物は1つ目）。読み込めていない時は 0
    durationOf(key) {
        const k = this.resolve(key);
        const list = k && this.buffers[k];
        if (!list || !list.length) return 0;
        const e0 = this.entries[key] || {};
        const rate = e0.rate || 1;
        const len = list[0].buf.duration - list[0].start - (e0.offset || 0);
        return Math.max(0, e0.dur ? Math.min(e0.dur, len / rate) : len / rate);
    }
    
    // 一時停止中は BGM を小さくする（on：true で小さく / false で元に戻す）
    setDuck(on) {
        this.duck = on ? 0.35 : 1;
        this.applyVolumes();
    }
    
    // ---------- 音量 ----------
    applyVolumes() {
        const V = this.volumes;
        if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : V.master;
        if (this.sfxGain) this.sfxGain.gain.value = this.muted ? 0 : 1;
        if (this.bgmGain) this.bgmGain.gain.value = this.muted ? 0 : V.bgm * this.duck;
        for (const [cat, g] of Object.entries(this.catGains)) g.gain.value = V[cat];
        if (this.bgm && !this.bgm.slot.gain) this.bgm.slot.el.volume = Math.max(0, Math.min(1, this.bgm.vol * V.bgm * V.master * this.duck));
    }
    
    // 音量を変える（name：'master' / 'bgm' / 'ui' / 'battle' / 'enemy' / 'voice'。volume：0〜1）
    setVolume(name, volume) {
        if (!(name in this.volumes)) return;
        this.volumes[name] = Math.max(0, Math.min(1, Number(volume) || 0));
        this.applyVolumes();
    }
    
    // 前の名前（互換用）
    setBGMVolume(volume) { this.setVolume('bgm', volume); }
    setSFXVolume(volume) { for (const c of Object.keys(SoundManager.CATS)) this.setVolume(c, volume); }
    get bgmVolume() { return this.volumes.bgm; }
    get sfxVolume() { return this.volumes.battle; }
    
    // その効果音の種類（SoundManager.CATS のどれか）。一覧の cat、なければ名前で決める
    categoryOf(key) {
        const e = this.entries[key];
        if (e && e.cat) return e.cat;
        return SoundManager.guessCategory(key);
    }
    
    static guessCategory(key) {
        for (const [cat, c] of Object.entries(SoundManager.CATS)) {
            if (c.keys && c.keys.includes(key)) return cat;
        }
        for (const [cat, c] of Object.entries(SoundManager.CATS)) {
            if (c.match && c.match.test(key)) return cat;
        }
        return 'battle';
    }
    
    toggleMute() {
        this.muted = !this.muted;
        this.applyVolumes();
        if (this.bgm) { if (this.muted) this.bgm.slot.el.pause(); else this.bgm.slot.el.play().catch(() => {}); }
        return this.muted;
    }
}

// 効果音の種類（設定の画面で、種類ごとに音量を変えられる）
//   keys：この種類にする音の名前 / match：名前がこれに合う音（keys を先に見る。どれでもなければ battle）
SoundManager.CATS = {
    voice:  { label: '敵の声（咆哮・鳴き声）', keys: ['boar_cry', 'boar_roar', 'wolf_howl', 'golem_roar', 'golem_roar_rumble', 'golem_boot', 'boss_intro'] },
    ui:     { label: 'メニュー・合図の音', keys: ['battle_start', 'boss_down', 'boss_phase'], match: /^(ui_|target_|coin_)/ },
    enemy:  { label: '敵の攻撃の音', match: /^(boar_|wolf_|golem_|boss_|enemy_)/ },
    battle: { label: '主人公の音（攻撃・回避・魔法）', match: /^(attack|dodge|just_dodge|damage|chant|magic|levelup|heal)/ }
};
// 音量の初期値（設定の「初期値に戻す」もこの値。settings.js の DEFAULTS と同じにする）
// BGM は戦いの曲が聞こえるように大きめ、メニューの音は少し小さめ、主人公の音（攻撃・回避・魔法）は小さめ、敵の声は大きく
SoundManager.DEFAULT_VOLUMES = { master: 1, bgm: 0.8, ui: 0.6, battle: 0.5, enemy: 0.7, voice: 1 };
// リミッター（いちばん大きい所だけ抑えて、音が割れないようにする）
SoundManager.LIMITER = { threshold: -4, knee: 4, ratio: 16, attack: 0.003, release: 0.25 };

SoundManager.DIR = 'assets/sounds';
SoundManager.EXTS = ['mp3', 'ogg', 'wav'];
SoundManager.MAX_VARIANTS = 4; // 効果音は <名前>_2 〜 <名前>_4 まで、ちがう音を置ける（ランダムに鳴る）
// 無音の短い WAV（最初のタップで BGM の <audio> を使えるようにする時に鳴らす）
SoundManager.SILENT_WAV = (() => {
    const n = 64, buf = new Uint8Array(44 + n);
    const dv = new DataView(buf.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    str(36, 'data'); dv.setUint32(40, n, true);
    buf.fill(128, 44); // 8ビットの無音
    let s = '';
    for (const b of buf) s += String.fromCharCode(b);
    return 'data:audio/wav;base64,' + btoa(s);
})();

// ---------- 音の一覧 ----------
// key：ファイルの名前（拡張子なし） / bgm：true なら bgm/ フォルダ、なければ se/ フォルダ / label：いつ鳴るか
// fallback：その音がない時に代わりに鳴らす音（rate・volume などは、この行に書いた値で鳴らす）
// loop：false なら1回だけ（ジングル） / volume：音量の倍率（ファイルごとの大きさのちがいをそろえる）
// rate：再生の速さ（1 より小さいと低く重い音、大きいと高く軽い音） / dur：この秒数で切る（長い音）
// gap：同じ音を続けて鳴らせる間隔（秒。連続ヒットでうるさくならないように） / vary：鳴らすたびの高さのゆらぎ
// ★ = ファイルを置いてある音（2026/10/29。もとのファイル名は assets/sounds/📋ここに音声ファイルを置いてください.txt）。それ以外は、置けばその音に変わる
// start（BGM）：曲の頭の無音を飛ばす秒数 / offset（効果音）：頭から飛ばす秒数（だんだん大きくなる音を、すぐ大きく鳴らす）
SoundManager.LIST = [
    // ===== BGM（assets/sounds/bgm/）=====
    { key: 'bgm_title',      bgm: true, label: 'タイトル・メインメニュー・設定' },
    { key: 'bgm_select',     bgm: true, label: 'モンスター選択・主人公選択・マイベスト', fallback: 'bgm_title', volume: 0.6, start: 0.25 },   // ★ 酒場BGM
    { key: 'bgm_boss',       bgm: true, label: 'ボス戦（3体共通。ボスごとの曲がない時に使う）' },
    // ボス戦の曲は大きめ（前は 0.75〜0.8）。メニューの曲（bgm_select）は小さめのまま
    { key: 'bgm_boss_boar',  bgm: true, label: '巨大森イノシシ戦', fallback: 'bgm_boss', volume: 1.0 },    // ★ イノシシBGM
    { key: 'bgm_boss_wolf',  bgm: true, label: '黒蝕狼戦', fallback: 'bgm_boss', volume: 1.0 },            // ★ 狼BGM
    { key: 'bgm_boss_golem',    bgm: true, label: '魔道ゴーレム戦・第1形態', fallback: 'bgm_boss', volume: 1.0, start: 0.75 },           // ★ 魔道ゴーレムノーマル
    { key: 'bgm_boss_golem_p2', bgm: true, label: '魔道ゴーレム戦・第2形態（HP50%以下）', fallback: 'bgm_boss_golem', volume: 1.0, start: 1.95 }, // ★ 魔道ゴーレム第2形態
    { key: 'bgm_boss_golem_p3', bgm: true, label: '魔道ゴーレム戦・第3形態（HP25%以下）', fallback: 'bgm_boss_golem_p2', volume: 1.0, start: 1.95 }, // ★ 魔道ゴーレムBGM第三形態
    { key: 'bgm_battle',     bgm: true, label: 'フリーバトル（スライム・ウサギ）', fallback: 'bgm_boss' },
    { key: 'bgm_field',      bgm: true, label: '村・フィールド（ストーリー用）', fallback: 'bgm_title' },
    { key: 'jingle_victory', bgm: true, label: '勝利（GAME CLEAR。1回だけ流れる短い曲）', loop: false, volume: 0.9 },   // ★ jingle_12（オルガン）
    { key: 'jingle_defeat',  bgm: true, label: '敗北（GAME OVER。1回だけ流れる短い曲）', loop: false, volume: 0.9 },    // ★ jingle_11（和風）
    
    // ===== メニュー（assets/sounds/se/）=====
    { key: 'ui_move',   label: 'メニューのカーソル移動', volume: 0.3, gap: 0.05, vary: 0 },              // ★ 選択6
    { key: 'ui_select', label: '決定', volume: 0.75, vary: 0 },                                           // ★ 決定15
    { key: 'ui_cancel', label: '戻る', volume: 0.35, vary: 0 },                                           // ★ キャンセル
    { key: 'ui_error',  label: '選べない（今後実装予定のボスなど）', fallback: 'ui_cancel', volume: 0.35, rate: 0.7, vary: 0 },
    { key: 'ui_start',  label: 'タイトルで決定（Press Enter）', fallback: 'ui_select', vary: 0 },
    { key: 'ui_pause',  label: '一時停止・再開', volume: 0.55, vary: 0 },                                 // ★ 確認2
    { key: 'target_lock', label: '敵をターゲット（ロックオン）にした', fallback: 'ui_move', volume: 0.5, rate: 1.3, vary: 0 },
    { key: 'target_unlock', label: 'ターゲット（ロックオン）を解除した', fallback: 'ui_move', volume: 0.4, rate: 0.85, vary: 0 },
    { key: 'coin_get',  label: 'バトルコインをもらった（結果画面）', fallback: 'ui_select', volume: 0.6, rate: 1.4, vary: 0 },
    
    // ===== 主人公 =====
    { key: 'attack',       label: 'ナイフを振る（attack_2 とランダム）', volume: 0.7, gap: 0.08 },        // ★ 斬撃1・斬撃2
    { key: 'attack_hit',   label: 'ナイフが敵に当たる（attack_hit_2 とランダム）', volume: 0.38, gap: 0.05 }, // ★ 打撃4・打撃3 (1)
    { key: 'dodge',        label: '回避（ローリング）', volume: 0.75 },                                    // ★ 回避
    { key: 'just_dodge',   label: 'ジャスト回避が決まった（スローになる）', volume: 0.9, vary: 0 },       // ★ 高速移動
    { key: 'damage',       label: '主人公がダメージを受ける（damage_2 とランダム）', volume: 1.0, gap: 0.06 }, // ★ 打撃2・打撃6
    { key: 'chant',        label: '魔法の詠唱（詠唱の間だけ鳴る。chant_2 とランダム）', volume: 0.55, vary: 0.02 }, // ★ 魔法詠唱1・2
    { key: 'chant_cancel', label: '詠唱をキャンセル（回避・攻撃に当たった時）' },
    { key: 'magic_switch', label: '魔法の切りかえ（1〜5キー・パレット）', fallback: 'ui_move', volume: 0.22, rate: 1.25, gap: 0.05, vary: 0 },
    { key: 'levelup',      label: 'レベルアップ（ストーリー用）', vary: 0 },
    { key: 'heal',         label: '回復（ストーリー用）' },
    
    // ===== 魔法（発動と、敵に当たった時）=====
    { key: 'magic',           label: '魔法の発動（属性ごとの音がない時に使う）' },
    { key: 'magic_hit',       label: '魔法が当たる（属性ごとの音がない時に使う）' },
    { key: 'magic_fire',      label: 'ファイヤーボールを撃つ', fallback: 'magic', volume: 0.8 },                       // ★ 着火1
    { key: 'magic_fire_hit',  label: 'ファイヤーボールが当たって爆発', fallback: 'magic_fire', volume: 0.72, dur: 0.9 },  // ★ 爆発2
    { key: 'magic_water',     label: 'ウォーターボールを撃つ', fallback: 'magic', volume: 1, dur: 0.9 },              // ★ ぴちょん単発
    { key: 'magic_water_hit', label: 'ウォーターボールが当たって水しぶき', fallback: 'magic_water', volume: 0.9, rate: 0.75, dur: 0.8 },
    { key: 'magic_wind',      label: 'テンペストの竜巻が出る', fallback: 'magic', volume: 0.75 },                      // ★ 強風2
    { key: 'magic_wind_hit',  label: '竜巻が敵を巻きこむ（何度も当たる）', fallback: 'magic_hit', gap: 0.35, volume: 0.65 },   // ★ 強風3
    { key: 'magic_earth',     label: 'ストーンキャノンを撃つ', fallback: 'dodge', volume: 0.44 },                      // ★ 大砲2
    { key: 'magic_earth_hit', label: '岩が当たって砕ける', fallback: 'magic_hit', volume: 1.0, dur: 0.9 },              // ★ 破壊音_短い
    { key: 'magic_thunder',   label: 'ライトニングの雷が落ちる', fallback: 'magic', volume: 0.75 },                   // ★ 雷4
    { key: 'magic_weak',      label: '有利属性で当たった（よく効いた）', volume: 0.7, gap: 0.3, vary: 0 },          // ★ 会心の一撃1
    { key: 'magic_resist',    label: '不利属性で当たった（効きにくい）', volume: 0.4, rate: 0.75, gap: 0.3, vary: 0 }, // ★ 打撃5（低く）
    
    // ===== ボス戦（共通）=====
    { key: 'boss_intro',   label: 'ボスの名前が出る（ボスごとの鳴き声がない時。魔道ゴーレム）', volume: 0.85, vary: 0 },     // ★ モンスター召喚
    { key: 'battle_start', label: 'BATTLE START（フリーバトルのウェーブ開始も）', fallback: 'ui_pause', volume: 0.8, vary: 0 }, // ★ 衝撃
    { key: 'boss_phase',   label: 'ボスが強化される（HP50%・25%。この後にボスが吠える）', vary: 0 },
    { key: 'boss_down',    label: 'ボスを倒した', volume: 0.85, vary: 0 },                                          // ★ 完了2
    { key: 'boss_dizzy',   label: 'ボスが目を回す（イノシシが壁に激突・ゴーレムの振り回しの後）', volume: 0.7, dur: 1.6, vary: 0 }, // ★ めまい
    
    // ===== 巨大森イノシシ =====
    // 鳴き声・咆哮は元の音が小さいので大きく（咆哮の間は BGM を止めるので、声だけがはっきり聞こえる）
    // 大きくしても割れないように、全体の出口でリミッターをかけている（SoundManager.LIMITER）
    { key: 'boar_cry',    label: '鳴き声（名前が出た時）', volume: 3.0, vary: 0.03 },                               // ★ イノシシの鳴き声
    { key: 'boar_roar',   label: '咆哮（強化の時）', volume: 3.4, vary: 0 },                                        // ★ ライオンの鳴き声2
    { key: 'boar_snort',  label: '突進の前に鼻を鳴らして地面をかく（溜めの間だけ鳴る）', volume: 1.2, vary: 0.03 },  // ★ イノシシが鼻をフンフン
    { key: 'boar_tusk',   label: '牙で突き上げる', fallback: 'attack', volume: 0.65, rate: 0.85 },                  // ★ 振り回す2（低く）
    { key: 'boar_charge', label: '突進を始める（地響き）', volume: 0.7, offset: 1.2, dur: 1.2 },                     // ★ 地響き2短
    { key: 'boar_crash',  label: '突進で壁に激突（目を回す）', fallback: 'boar_cry', volume: 1.1 },                 // ★ 破壊音2
    { key: 'boar_stomp',  label: '踏みつけ', volume: 0.6 },                                                         // ★ 発砲1（低い衝撃）
    
    // ===== 黒蝕狼 =====
    { key: 'wolf_howl', label: '遠吠え（名前が出た時・強化の時。元の音が小さいので大きく）', volume: 3.8, vary: 0 }, // ★ オオカミの遠吠え
    { key: 'wolf_bite', label: '噛みつき', fallback: 'attack', volume: 0.85, rate: 1.15 },                          // ★ 斬撃4（高く）
    { key: 'wolf_claw', label: '爪でひっかく（wolf_claw_2 とランダム）', fallback: 'attack', volume: 0.9 },          // ★ 斬撃6・斬撃7
    { key: 'wolf_leap', label: '飛びかかりの着地', volume: 1.0, rate: 0.85 },                                       // ★ 打撃1（低く）
    { key: 'wolf_dash', label: '影の高速移動・回避', fallback: 'dodge', volume: 0.6, rate: 0.85, gap: 0.15 },
    { key: 'wolf_shot', label: '侵蝕弾を撃つ', volume: 1.0, dur: 1.2 },                                             // ★ 暗黒エネルギー
    { key: 'wolf_wave', label: '侵蝕波動（必殺技。広がる紫の輪）', volume: 1.0, dur: 2.2 },                          // ★ 不気味な出現音3
    
    // ===== 魔道ゴーレム（boot・roar・thud はファイルがない時、機械の音をプログラムで作って鳴らす）=====
    // 石の巨体らしく、全部低い音（rate を 1 より小さくして、さらに低く重くしている）
    // 叩きつけ・衝撃波・砲撃・咆哮には、低い地響き（golem_rumble・golem_roar_rumble）を重ねる（golem_ai.js の GolemSound）
    { key: 'golem_boot',   label: '起動する（戦いの始まり。低いうなり）', volume: 1.3, rate: 0.75, dur: 2.6, vary: 0 },  // ★ 不気味な出現音1
    { key: 'golem_roar',   label: '機械の咆哮（強化の時。低くうなる）', volume: 1.8, rate: 0.6, dur: 3.4, vary: 0 },    // ★ 不気味な出現音2
    { key: 'golem_roar_rumble', label: '咆哮に重ねる地響き', volume: 1.2, offset: 2.4, dur: 3.0, vary: 0 },              // ★ 地響き1短
    { key: 'golem_thud',   label: '地面の叩きつけ・踏みつけ（石がくだける）', volume: 1.1, rate: 0.6, dur: 1.5 },        // ★ 破壊音
    { key: 'golem_rumble', label: '叩きつけ・衝撃波・砲撃に重ねる地響き', volume: 1.2, offset: 2.3, dur: 1.7, gap: 0.2 }, // ★ 地響き3短
    { key: 'golem_punch',  label: '拳で殴る（重い打撃。golem_punch_2 とランダム）', fallback: 'attack', volume: 0.75, rate: 0.7 }, // ★ 大砲2・打撃2
    { key: 'golem_swing',  label: '腕を振り回す（1回転ごと。低い風切り。golem_swing_2 とランダム）', fallback: 'attack', volume: 1.0, rate: 0.55 }, // ★ 振り回す3・1
    { key: 'golem_shot',   label: '星力弾を撃つ（低い発射音）', volume: 0.9, rate: 0.65, dur: 1.2 },                   // ★ 大砲1
    { key: 'golem_charge', label: '胸の魔導核に力をためる（星力弾・危険床・魔法陣砲撃の溜め）', volume: 0.75, rate: 0.6, vary: 0 }, // ★ エネルギーを集める
    { key: 'golem_rune',   label: '危険床（床の魔法陣）が光ってはじける', volume: 0.75, rate: 0.75, dur: 1.0, gap: 0.12 }, // ★ 爆発2
    { key: 'golem_beam',   label: '魔法陣砲撃（必殺技）の光の柱が落ちる', fallback: 'golem_rune', volume: 0.9, rate: 0.55, dur: 1.8 }, // ★ 爆発
    { key: 'golem_shield', label: '星の盾を張る（低くうなる）', volume: 0.9, rate: 0.6, dur: 1.7 },                    // ★ 気を溜める1
    { key: 'golem_step',   label: '重い足音（歩いている間）', volume: 0.6, rate: 0.55, dur: 0.6, gap: 0.25 },          // ★ 発砲1
    
    // ===== ふつうの敵（フリーバトル）=====
    { key: 'enemy_defeat', label: '敵が倒れて星になる', gap: 0.08 }
];

// グローバルインスタンス
window.SoundManager = SoundManager;
window.soundManager = new SoundManager();

// どこからでも短く書けるように（ファイルがなければ何もしない）
window.playSE = (key, opts) => (window.soundManager ? window.soundManager.play(key, opts) : false);
window.playBGM = (key) => { if (window.soundManager) window.soundManager.playBGM(key); };
