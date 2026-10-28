// ボス戦の進行（バトルモード → ソロプレイ → モンスター選択 → 主人公選択 のあと）
//
// 1. ボスのフィールドを読み込み、主人公を南、ボスを北に置く（game.startBossBattle）
//    星の闘技場（巨大森イノシシ・黒蝕狼）/ 古代星紋遺跡（魔道ゴーレム。map.getBossStage がある）
// 2. 開始演出：門が開いてボスが出てくる（遺跡はその場で起動）→ ボス名 → BATTLE START と同時に戦闘開始
//    def.countdown: true のボスは BATTLE START の後に 3・2・1・GO!（その間は操作も敵AIも止まる。今は使っているボスなし）
// 3. 戦闘：ボスの HP バー（なめらかに減る・フェーズ表示）。フェーズ移行の演出はボスAIが1回だけ知らせてくる
// 4. GAME CLEAR（ボスの HP 0）/ GAME OVER（主人公の HP 0）→ 結果画面（もう一度・モンスター選択・メインメニュー）
//    クリアした時は battle_records.js に記録：クリアタイムのランク（SS〜D）・バトルコイン・マイベスト
//
// プレイヤー・魔術・ナイフ・回避などは game.js の共通処理をそのまま使う

class BossBattle {
    constructor(game) {
        this.game = game;
        this.state = 'idle';   // 'intro'（開始演出） / 'fight' / 'victory' / 'defeat'
        this.ui = BossBattle.getUI();
        this.flash = 0;
        this.bindButtons();
    }
    
    static getUI() {
        const $ = (id) => document.getElementById(id);
        return {
            hud: $('boss-hud'), name: $('bh2-name'), phase: $('bh2-phase'), phaseLabel: $('bh2-phase-label'),
            fill: $('bh2-fill'), trail: $('bh2-trail'), hp: $('bh2-hp'),
            banner: $('battle-banner'), bannerMain: $('battle-banner-main'), bannerSub: $('battle-banner-sub'),
            count: $('battle-countdown'),
            pause: $('battle-pause'),
            result: $('boss-result'), resultTitle: $('br-title'), resultSub: $('br-sub'), resultStats: $('br-stats'),
            rank: $('br-rank'), rankLetter: $('br-rank-letter'), rankNote: $('br-rank-note'),
            retry: $('br-retry')
        };
    }
    
    bindButtons() {
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
        };
        on('br-retry', () => this.game.restartBattle());
        on('br-monster', () => this.game.leaveBattle('monster_select'));
        on('br-menu', () => this.game.leaveBattle('main_menu'));
    }
    
    get isOver() { return this.state === 'victory' || this.state === 'defeat'; }
    // 開始演出中はプレイヤーも敵も動かない
    get isFrozen() { return this.state === 'intro'; }
    
    // ---------- 開始 ----------
    start(map, def) {
        const game = this.game;
        this.map = map;
        this.def = def;
        this.state = 'intro';
        this.t = 0;              // 開始演出の経過時間
        this.time = 0;           // 戦った時間
        this.step = 0;           // 演出の進み具合
        this.resultTimer = 0;
        this.flash = 0;
        this.hpShown = 1;
        this.hpTrail = 1;
        this.trailDelay = 0;
        this.lastHP = null;
        this.maxPhase = 1;
        this.record = null;      // クリアした時の記録（BattleRecords.recordClear の結果）
        
        const AIClass = BOSS_AI_CLASSES[def.ai];
        const stage = map.getBossStage ? map.getBossStage() : null;
        if (stage) {
            // 専用ステージ（古代星紋遺跡）：ボスは中央北側でその場で起動する。主人公は南側
            this.boss = game.enemySpawner.spawnEnemyAt({ ...def.enemy }, stage.boss);
            this.ai = new AIClass(this.boss, def);
            this.ai.introMode = stage.intro;
            game.player.position = stage.player.clone();
        } else {
            // 星の闘技場：ボスは北の門の中から出てくる
            const gate = map.getEnemySpawnPoints().north[0].position;
            this.boss = game.enemySpawner.spawnEnemyAt({ ...def.enemy }, gate);
            this.ai = new AIClass(this.boss, def);
            this.ai.introTarget = new Vector2(gate.x, 560);
            // 主人公は南側（入口の少し内側）
            game.player.position = new Vector2(map.getPlayerSpawn().x, 900);
            map.setGateOpen(true);
        }
        this.boss.ai = this.ai;
        this.boss.target = game.player;
        this.boss.direction = 'down';
        game.camera.snapToTarget();
        this.countStep = 0;
        // HP バーの目印を、そのボスのフェーズが変わる所（HP50%・25%）に置く
        const ticks = this.ui.hud ? this.ui.hud.querySelectorAll('.bh2-tick') : [];
        def.phases.slice(1).forEach((ph, i) => { if (ticks[i]) ticks[i].style.left = (ph.hp * 100) + '%'; });
        
        // カメラ：最初はボスの方を映す
        this.camProxy = { position: game.player.position.clone() };
        game.camera.follow(this.camProxy);
        
        this.hideResult();
        this.hidePause();
        this.clearBanner();
        this.showCount('');
        document.body.dataset.waves = 'off';     // ウェーブの表示は出さない
        document.body.dataset.battle = 'boss';
        document.body.dataset.boss = def.id;
        if (this.ui.hud) this.ui.hud.classList.remove('show');
        if (this.ui.name) this.ui.name.textContent = def.name;
        this.updateHUD(0, true);
        // ボスごとの BGM（boss_data.js の bgm。ファイルがなければ共通の bgm_boss）
        playBGM(def.bgm || 'bgm_boss');
    }
    
    // 開始演出を飛ばす（Enter・クリック・タップ）
    skipIntro() {
        if (this.state !== 'intro' || this.t >= 4.0) return;
        this.t = 4.0;
        this.step = 3;
        this.boss.position = this.ai.introTarget ? this.ai.introTarget.clone() : this.boss.position;
        this.ai.introTarget = null;
        if (this.ai.introMode) this.ai.introT = Math.max(this.ai.introT || 0, 2.2); // 起動の演出も終わらせる
        this.map.setGateOpen(false);
        this.game.camera.follow(this.game.player);
        this.clearBanner();
        if (this.ui.hud) this.ui.hud.classList.add('show');
    }
    
    // ---------- 毎フレーム ----------
    update(dt) {
        if (this.state === 'idle') return;
        const game = this.game;
        this.map.update(dt);
        if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
        
        // ボスAIからの知らせ（フェーズ移行・画面の揺れ）
        for (const ev of this.ai.events) {
            if (ev.type === 'phase') this.onPhaseChange(ev.index);
            else if (ev.type === 'shake') game.addShake(ev.power, ev.time || 0.25);
            else if (ev.type === 'hit') game.addShake(ev.power, 0.2);
        }
        this.ai.events = [];
        if (!this.boss.isAlive()) this.ai.updateFx(dt); // 倒れた後も演出は消えるまで動かす
        
        if (this.state === 'intro') this.updateIntro(dt);
        else if (this.state === 'fight') {
            this.time += dt;
            if (!this.boss.isAlive()) {
                this.state = 'victory';
                this.resultTimer = 2.6; // ボスが光になって消えるのを見せてから
                // クリアの記録：バトルコイン（ボスの基本＋ランクのボーナス）とクリアタイム（マイベスト）
                const p = game.player;
                this.record = window.BattleRecords ? BattleRecords.recordClear(this.def, this.time, p && p.gender) : null;
                this.showBanner('GAME CLEAR', '勝利！', 'victory');
                playSE('boss_down');
                playBGM('jingle_victory');
            }
        } else if (this.isOver && this.resultTimer > 0) {
            this.resultTimer -= dt;
            if (this.resultTimer <= 0) this.showResult();
        }
        this.updateHUD(dt);
    }
    
    updateIntro(dt) {
        const game = this.game;
        this.t += dt;
        const t = this.t;
        // カメラ：ボスの方へゆっくり動かし、ボス名の後で主人公に戻す
        if (t < 3.4) {
            const goal = this.boss.position.add(new Vector2(0, 80));
            const k = Math.min(1, dt * 2.5);
            this.camProxy.position = this.camProxy.position.add(goal.sub(this.camProxy.position).mult(k));
        }
        if (this.step === 0 && t >= 1.6) {
            this.step = 1;
            const d = this.def.difficulty;
            const stars = '★'.repeat(d) + '☆'.repeat(Math.max(0, 3 - d));
            this.showBanner(this.def.name, `難易度 ${stars}　${this.def.fieldName}`, this.def.theme && this.def.theme.banner || 'boss');
            // ボスごとの鳴き声（boss_data.js の introSE。なければ共通の boss_intro）
            if (!(this.def.introSE && playSE(this.def.introSE))) playSE('boss_intro');
        }
        if (this.step === 1 && t >= 3.4) {
            this.step = 2;
            this.map.setGateOpen(false);
            game.camera.follow(game.player);
            if (this.ui.hud) this.ui.hud.classList.add('show');
        }
        // BATTLE START が出たら戦闘開始。カウントダウンのあるボス（def.countdown）は 3・2・1 の後
        if (this.step < 4 && t >= 4.0) {
            this.step = 4;
            this.showBanner('BATTLE START', '', 'start');
            playSE('battle_start');
            if (!this.def.countdown) this.beginFight();
        }
        if (this.step === 4 && this.def.countdown) {
            // カウントダウン中は操作もボスAIも止まったまま（isFrozen）
            const marks = [[4.7, '3'], [5.4, '2'], [6.1, '1'], [6.8, 'GO!']];
            while (this.countStep < marks.length && t >= marks[this.countStep][0]) {
                const [, text] = marks[this.countStep++];
                this.showCount(text, text === 'GO!');
                if (text === 'GO!') this.beginFight();
            }
        }
    }
    
    beginFight() {
        this.state = 'fight';
        this.ai.startFight();
    }
    
    onPhaseChange(index) {
        const n = index + 1;
        this.maxPhase = Math.max(this.maxPhase, n);
        // 形態が変わった時は文字を出さない（画面の光と揺れ、ボスの咆哮・遠吠えだけ）
        this.flash = 0.5;
        this.game.addShake(8, 0.5);
        playSE('boss_phase');
    }
    
    onDefeat() {
        if (this.isOver) return;
        this.state = 'defeat';
        this.resultTimer = 1.6;
        this.ai.cancel();
        this.ai.active = false; // ボスはその場で止まる
        this.record = null;
        this.showBanner('GAME OVER', '敗北……', 'defeat');
        playBGM('jingle_defeat');
    }
    
    // ---------- HP バー ----------
    updateHUD(dt, force) {
        const u = this.ui;
        if (!u.hud || !this.boss) return;
        const b = this.boss;
        const ratio = Math.max(0, b.currentHP / b.maxHP);
        if (this.lastHP !== null && b.currentHP < this.lastHP) this.trailDelay = 0.55;
        this.lastHP = b.currentHP;
        // 本体のゲージはすぐ近くまで、うしろの白いゲージは少し遅れてゆっくり減る
        this.hpShown += (ratio - this.hpShown) * Math.min(1, dt * 12);
        if (force) { this.hpShown = ratio; this.hpTrail = ratio; }
        if (this.trailDelay > 0) this.trailDelay -= dt;
        else if (this.hpTrail > this.hpShown) this.hpTrail = Math.max(this.hpShown, this.hpTrail - dt * 0.45);
        if (this.hpTrail < this.hpShown) this.hpTrail = this.hpShown;
        u.fill.style.width = (this.hpShown * 100).toFixed(2) + '%';
        u.trail.style.width = (this.hpTrail * 100).toFixed(2) + '%';
        const hpText = `${Math.ceil(b.currentHP)} / ${b.maxHP}`;
        if (u.hp.textContent !== hpText) u.hp.textContent = hpText;
        const n = this.ai.phase.number;
        if (u.phase.dataset.phase !== String(n)) {
            u.phase.dataset.phase = String(n);
            u.hud.dataset.phase = String(n);
            for (const pip of u.phase.querySelectorAll('i')) pip.classList.toggle('on', Number(pip.dataset.n) <= n);

        }
    }
    
    // ---------- 描画 ----------
    drawGround(ctx, cam) {
        if (this.ai) this.ai.drawGround(ctx, cam);
    }
    
    drawWorld(ctx, cam) {
        if (this.ai) this.ai.drawAbove(ctx, cam);
    }
    
    // 画面全体に重ねる物（黒蝕狼戦の紫の色味・フェーズ移行の光）
    drawScreen(ctx) {
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const tint = this.def && this.def.theme && this.def.theme.arenaTint;
        if (tint) {
            ctx.save();
            ctx.fillStyle = tint;
            ctx.fillRect(0, 0, W, H);
            const vig = this.def.theme.vignette || 'rgba(40, 0, 60, 0.6)';
            const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
            g.addColorStop(0, vig.replace(/[\d.]+\)$/, '0)')); // 同じ色の透明から
            g.addColorStop(1, vig);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }
        if (this.flash > 0) {
            ctx.save();
            ctx.globalAlpha = this.flash / 0.5 * 0.45;
            const th = this.def.theme || {};
            ctx.fillStyle = th.flash || (th.banner === 'corrupt' ? '#b45cff' : '#ff9a6a');
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }
    }
    
    // ---------- 文字の表示 ----------
    showBanner(main, sub, kind = '') {
        const u = this.ui;
        if (!u.banner) return;
        u.bannerMain.textContent = main;
        u.bannerSub.textContent = sub || '';
        u.banner.className = '';
        void u.banner.offsetWidth; // アニメーションを最初から
        u.banner.className = 'show ' + kind;
    }
    
    clearBanner() {
        if (this.ui.banner) this.ui.banner.className = '';
    }
    
    showCount(text, last = false) {
        const el = this.ui.count;
        if (!el || el.dataset.text === text) return;
        el.dataset.text = text;
        el.textContent = text;
        el.className = '';
        if (!text) return;
        void el.offsetWidth;
        el.className = 'show' + (last ? ' go' : '');
    }
    
    // ---------- 結果画面 ----------
    showResult() {
        const u = this.ui;
        if (!u.result) return;
        const win = this.state === 'victory';
        const R = window.BattleRecords;
        const rec = win ? this.record : null;
        const timeText = R ? R.formatTime(this.time) : `${Math.floor(this.time / 60)}:${String(Math.floor(this.time) % 60).padStart(2, '0')}`;
        const p = this.game.player;
        u.resultTitle.textContent = win ? 'GAME CLEAR' : 'GAME OVER';
        u.resultSub.textContent = win ? '勝利！' : '敗北……';
        u.retry.textContent = win ? 'もう一度戦う' : '再挑戦';
        u.result.classList.toggle('win', win);
        // クリアタイムのランク（大きな文字）と、自己ベストの時の「NEW RECORD!」
        if (u.rank) {
            u.rank.hidden = !rec;
            if (rec) {
                u.rankLetter.textContent = rec.rank;
                u.rankLetter.dataset.rank = rec.rank;
                u.rankNote.textContent = rec.best ? 'NEW RECORD!' : '';
            }
        }
        const hero = p && p.gender === 'female' ? '女の子' : '男の子';
        const rows = [
            ['対戦モンスター', this.def.name],
            ['主人公', hero],
            [win ? 'クリアタイム' : '戦った時間', timeText]
        ];
        if (win) {
            rows.push(['残りHP', `${p ? Math.ceil(p.currentHP) : 0} / ${p ? p.maxHP : 0}`]);
            if (rec) {
                rows.push(['獲得バトルコイン', `<i class="coin-icon"></i>+${rec.gained}枚 <small>（基本${rec.base}＋ランク${rec.bonus}）</small>`]);
                rows.push(['所持バトルコイン', `<i class="coin-icon"></i>${rec.coins}枚`]);
                rows.push(['マイベスト', rec.place ? `${rec.place}位${rec.best ? '（自己ベスト！）' : ''}` : '圏外']);
            }
        } else {
            rows.push(['到達フェーズ', `${this.maxPhase} / ${this.def.phases.length}`]);
            rows.push(['ボスの残りHP', `${Math.round(this.boss.currentHP / this.boss.maxHP * 100)}%`]);
        }
        u.resultStats.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
        if (rec) playSE('coin_get');
        u.result.classList.add('show');
        document.body.classList.add('battle-result-open');
        const panel = u.result.querySelector('.battle-panel');
        this.fitPanel(panel);
        this.nav = new UINav(panel, 'vertical');
    }
    
    // 画面が小さい時（スマホは --hud-scale で拡大している）も、パネルが全部見えるように縮める
    fitPanel(panel) {
        if (!panel) return;
        panel.style.setProperty('--fit', '1');
        const hud = parseFloat(getComputedStyle(panel).getPropertyValue('--hud-scale')) || 1;
        const roomH = this.ui.result.clientHeight - 16;
        const roomW = this.ui.result.clientWidth - 16;
        const fit = Math.min(1, roomH / (panel.offsetHeight * hud), roomW / (panel.offsetWidth * hud));
        if (fit > 0 && fit < 1) panel.style.setProperty('--fit', fit.toFixed(3));
    }
    
    hideResult() {
        if (this.ui.result) this.ui.result.classList.remove('show');
        document.body.classList.remove('battle-result-open');
        this.resultTimer = 0;
        this.nav = null;
    }
    
    // 結果画面のキーボード操作（上下で選んで Enter）
    handleResultKeys(input) {
        if (this.nav && this.ui.result.classList.contains('show')) this.nav.handle(input);
    }
    
    showPause() { if (this.ui.pause) this.ui.pause.classList.add('show'); }
    hidePause() { if (this.ui.pause) this.ui.pause.classList.remove('show'); }
    
    stop() {
        this.state = 'idle';
        this.hideResult();
        this.hidePause();
        this.clearBanner();
        this.showCount('');
        if (this.ui.hud) this.ui.hud.classList.remove('show');
        document.body.dataset.battle = '';
        document.body.dataset.boss = '';
    }
}

window.BossBattle = BossBattle;
