// バトルモード（闘技場のウェーブバトル）
//
// ストーリーとは関係なく、闘技場で敵のウェーブと戦う。
// プレイヤー・敵・魔術・攻撃の処理は game.js / player.js / enemy.js / magic.js の共通の物をそのまま使い、
// ここでは「どの敵をいつどこに出すか」「勝ち負け」「画面の表示」だけを受け持つ。

class BattleMode {
    constructor(game) {
        this.game = game;
        this.state = 'idle';     // 'intro'（Wave 表示）/ 'fight' / 'clear'（次のウェーブ待ち）/ 'victory' / 'defeat'
        this.waveIndex = -1;
        this.kills = 0;
        this.time = 0;           // 戦っていた時間（秒）
        this.stateTimer = 0;
        this.spawnQueue = [];    // これから出す敵 { data, point, delay }
        this.spawnFx = [];       // 出現の演出 { position, age, data, enemy }
        this.spawned = [];       // このウェーブで出した敵（撃破数を数えるため）
        this.gateCloseTimer = 0;
        this.ui = BattleMode.getUI();
        this.bindButtons();
    }
    
    // ウェーブを使うか。false = ウェーブなし（敵が少しずつ出続けるフリーバトル）
    // true に戻すと、下の WAVES の5ウェーブ（ボスあり・勝利画面あり）になる
    static USE_WAVES = false;
    
    // ウェーブなしの時：最初に出す数、同時に出ている最大の数、次の敵が出るまでの秒数
    static FREE = { first: 3, maxEnemies: 6, interval: 4.0 };
    
    // ---------- ウェーブの内容 ----------
    // from：出現する場所（arena_map.js の spawnPoints.enemies の名前）
    static WAVES = [
        { enemies: [{ name: '角ウサギ', count: 3, from: ['north', 'west', 'east'] }] },
        { enemies: [{ name: '草原狼', count: 3, from: ['north', 'northWest', 'northEast'] }] },
        { enemies: [{ name: '角ウサギ', count: 2, from: ['west', 'east'] }, { name: '草原狼', count: 3, from: ['north', 'northWest', 'northEast'] }] },
        { enemies: [{ name: '侵蝕狼', count: 3, from: ['north', 'west', 'east'] }] },
        { boss: true, enemies: [{ name: '森イノシシ', count: 1, from: ['north'] }] }
    ];
    
    // 闘技場用の調整（見つける距離を広くして、すぐ追いかけてくるように。ボスは大きく強く）
    static TUNING = {
        '角ウサギ':   { detectionRange: 1400 },
        '草原狼':     { speed: 118, size: 38, detectionRange: 1400, attackRange: 46, attackCooldown: 1.3, attackWindupTime: 0.32 },
        '侵蝕狼':     { speed: 128, size: 40, detectionRange: 1400, attackRange: 48, attackCooldown: 1.2, attackWindupTime: 0.28, hpScale: 0.75, atkScale: 0.7 },
        '森イノシシ': { displayName: '森の大猪', isBoss: true, size: 68, hpScale: 4, speed: 72, detectionRange: 2400,
                        attackRange: 80, attackCooldown: 1.8, chargeSpeed: 430, chargeMaxDuration: 0.75, chargePreparationTime: 0.7 }
    };
    
    // 敵データ（data/enemies.json が読めなかった時の予備）
    static FALLBACK_ENEMIES = {
        '角ウサギ':   { enemyId: 'enemy_001', name: '角ウサギ', hp: 25, attack: 7, defense: 1, exp: 5 },
        '星光スライム': { enemyId: 'enemy_007', name: '星光スライム', hp: 35, attack: 9, defense: 2, exp: 9 },
        '草原狼':     { enemyId: 'enemy_002', name: '草原狼', hp: 55, attack: 13, defense: 3, exp: 14 },
        '森イノシシ': { enemyId: 'enemy_003', name: '森イノシシ', hp: 100, attack: 19, defense: 7, exp: 28 },
        '侵蝕狼':     { enemyId: 'enemy_013', name: '侵蝕狼', hp: 145, attack: 29, defense: 8, exp: 55 }
    };
    
    getEnemyData(name) {
        // index.html を直接開いた（file://）時は allEnemies が無いので、enemies → 予備データの順に探す
        const gd = window.gameData || {};
        const all = [...(gd.allEnemies || []), ...(gd.enemies || [])];
        const base = all.find(e => e.name === name) || BattleMode.FALLBACK_ENEMIES[name]
            || { name, hp: 30, attack: 8, defense: 1, exp: 5 };
        const t = BattleMode.TUNING[name] || {};
        const data = { ...base, ...t };
        data.hp = Math.round(base.hp * (t.hpScale || 1));
        data.attack = Math.round(base.attack * (t.atkScale || 1));
        return data;
    }
    
    // ---------- 開始・進行 ----------
    start(map) {
        this.map = map;
        this.points = map.getEnemySpawnPoints();
        this.state = 'idle';
        this.waveIndex = -1;
        this.kills = 0;
        this.time = 0;
        this.spawnQueue = [];
        this.spawnFx = [];
        this.spawned = [];
        this.hideResult();
        this.hidePause();
        document.body.dataset.waves = BattleMode.USE_WAVES ? 'on' : 'off';
        this.updateHUD();
        if (BattleMode.USE_WAVES) this.nextWave();
        else this.startFree();
    }
    
    // ---------- ウェーブなし：フリーバトル（敵が少しずつ出続ける） ----------
    startFree() {
        this.state = 'fight';
        this.freeTimer = BattleMode.FREE.interval;
        for (let i = 0; i < BattleMode.FREE.first; i++) this.queueFreeEnemy(0.8 + i * 0.5);
    }
    
    // 出す敵：data/enemies.json の草原の敵（角ウサギ・星光スライム）から出現率に合わせて選ぶ
    queueFreeEnemy(delay) {
        const list = (window.gameData && window.gameData.enemies) || [];
        if (!list.length) return;
        const total = list.reduce((s, e) => s + (e.spawnWeight || 1), 0);
        let roll = Math.random() * total, pick = list[list.length - 1];
        for (const e of list) { roll -= (e.spawnWeight || 1); if (roll < 0) { pick = e; break; } }
        const all = Object.values(this.points).flat();
        const point = all[Math.floor(Math.random() * all.length)];
        this.spawnQueue.push({ data: this.getEnemyData(pick.name), point, delay });
    }
    
    updateFree(deltaTime) {
        // 倒した敵はリストから外す（長く遊んでも増え続けないように）
        this.spawned = this.spawned.filter(e => e.isAlive() || !e._counted);
        const alive = this.spawned.filter(e => e.isAlive()).length + this.spawnQueue.length;
        this.freeTimer -= deltaTime;
        if (this.freeTimer <= 0) {
            this.freeTimer = BattleMode.FREE.interval;
            if (alive < BattleMode.FREE.maxEnemies) this.queueFreeEnemy(0.3);
        }
    }
    
    get totalWaves() { return BattleMode.WAVES.length; }
    get isOver() { return this.state === 'victory' || this.state === 'defeat'; }
    
    nextWave() {
        this.waveIndex++;
        const wave = BattleMode.WAVES[this.waveIndex];
        this.spawned = [];
        this.spawnQueue = [];
        // 出す順番：場所ごとに少しずつ時間をずらす
        const used = {};
        let delay = 1.3; // Wave の文字が出てから最初の敵が出るまで
        for (const group of wave.enemies) {
            for (let i = 0; i < group.count; i++) {
                const from = group.from[i % group.from.length];
                const list = this.points[from] || this.points.north;
                used[from] = (used[from] || 0);
                const point = list[used[from] % list.length];
                used[from]++;
                this.spawnQueue.push({ data: this.getEnemyData(group.name), point, delay });
                delay += 0.45;
            }
        }
        this.state = 'intro';
        this.stateTimer = 1.3;
        const n = this.waveIndex + 1;
        if (wave.boss) this.showBanner(`FINAL WAVE`, 'ボス　' + (BattleMode.TUNING['森イノシシ'].displayName), 'boss');
        else this.showBanner(`WAVE ${n}`, `敵 ${this.spawnQueue.length} 体`);
        playSE('battle_start');
        this.updateHUD();
    }
    
    update(deltaTime) {
        if (this.state === 'idle') return;
        this.map.update(deltaTime);
        for (const f of this.spawnFx) f.age += deltaTime;
        this.spawnFx = this.spawnFx.filter(f => f.age < 0.7);
        if (this.isOver) {
            if (this.resultTimer > 0) {
                this.resultTimer -= deltaTime;
                if (this.resultTimer <= 0) this.showResult();
            }
            return;
        }
        this.time += deltaTime;
        
        // 敵を出す（門から出る敵は、少し前に門を開ける）
        for (const s of this.spawnQueue) {
            s.delay -= deltaTime;
            if (s.point.gate && s.delay < 0.7) { this.map.setGateOpen(true); this.gateCloseTimer = 1.4; }
        }
        const ready = this.spawnQueue.filter(s => s.delay <= 0);
        this.spawnQueue = this.spawnQueue.filter(s => s.delay > 0);
        for (const s of ready) {
            const enemy = this.game.enemySpawner.spawnEnemyAt(s.data, s.point.position);
            enemy.spawnTime = 0;
            this.spawned.push(enemy);
            this.spawnFx.push({ position: enemy.position.clone(), age: 0, size: enemy.size, gate: s.point.gate });
        }
        if (this.gateCloseTimer > 0 && !this.spawnQueue.some(s => s.point.gate)) {
            this.gateCloseTimer -= deltaTime;
            if (this.gateCloseTimer <= 0) this.map.setGateOpen(false);
        }
        
        // 撃破数（倒れた瞬間に数える）
        for (const e of this.spawned) {
            if (!e.isAlive() && !e._counted) { e._counted = true; this.kills++; }
        }
        
        const alive = this.spawned.filter(e => e.isAlive()).length;
        this.remaining = alive + this.spawnQueue.length;
        
        // ウェーブなし：勝ち負けは HP が 0 になった時の敗北だけ
        if (!BattleMode.USE_WAVES) {
            this.updateFree(deltaTime);
            this.updateHUD();
            return;
        }
        
        if (this.state === 'intro') {
            this.stateTimer -= deltaTime;
            if (this.stateTimer <= 0) this.state = 'fight';
        }
        if ((this.state === 'fight' || this.state === 'intro') && this.remaining === 0 && this.spawned.length > 0) {
            if (this.waveIndex >= this.totalWaves - 1) {
                this.state = 'victory';
                this.resultTimer = 1.6; // 最後の敵の星のエフェクトを見せてから
                this.showBanner('GAME CLEAR', '全ウェーブ クリア', 'victory');
                playBGM('jingle_victory');
            } else {
                this.state = 'clear';
                this.stateTimer = 3.0;   // 数秒後に次のウェーブ
                this.showBanner('WAVE CLEAR', `次のウェーブまで 3 秒`, 'clear');
            }
        }
        if (this.state === 'clear') {
            this.stateTimer -= deltaTime;
            this.setBannerSub(`次のウェーブまで ${Math.max(1, Math.ceil(this.stateTimer))} 秒`);
            if (this.stateTimer <= 0) this.nextWave();
        }
        this.updateHUD();
    }
    
    // プレイヤーの HP が 0 になった
    onDefeat() {
        if (this.isOver) return;
        this.state = 'defeat';
        this.resultTimer = 1.2;
        this.showBanner('GAME OVER', '', 'defeat');
        playBGM('jingle_defeat');
        this.updateHUD();
    }
    
    // ---------- 出現の演出（敵の足元に光の輪と砂ぼこり） ----------
    drawWorld(ctx, camera) {
        for (const f of this.spawnFx) {
            const s = f.position.sub(camera);
            const t = f.age / 0.7;
            const fy = s.y + f.size * 0.5;
            ctx.save();
            ctx.globalAlpha = 1 - t;
            ctx.strokeStyle = '#ffe6a0';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(s.x, fy, f.size * (0.5 + t * 0.9), f.size * (0.18 + t * 0.3), 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(214, 186, 130, 0.7)';
            for (let i = 0; i < 6; i++) {
                const a = i / 6 * Math.PI * 2;
                ctx.beginPath();
                ctx.arc(s.x + Math.cos(a) * f.size * (0.4 + t), fy + Math.sin(a) * f.size * 0.3 * (0.4 + t), 4 + t * 5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }
    
    // ---------- 画面の表示（HTML） ----------
    static getUI() {
        const $ = (id) => document.getElementById(id);
        return {
            hud: $('battle-hud'), wave: $('bh-wave'), waveTotal: $('bh-wave-total'), remaining: $('bh-remaining'), kills: $('bh-kills'),
            boss: $('boss-bar'), bossName: $('boss-name'), bossFill: $('boss-fill'),
            banner: $('battle-banner'), bannerMain: $('battle-banner-main'), bannerSub: $('battle-banner-sub'),
            pause: $('battle-pause'), result: $('battle-result'), resultTitle: $('result-title'), resultStats: $('result-stats'),
            pauseBtn: $('pause-btn')
        };
    }
    
    bindButtons() {
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
        };
        // 一時停止の画面のボタンは game.js でまとめて登録している（ボス戦と共通）
        on('result-retry', () => this.game.restartBattle());
        on('result-select', () => this.game.leaveBattle('equip'));
    }
    
    updateHUD() {
        const u = this.ui;
        if (!u.hud) return;
        const n = Math.max(1, this.waveIndex + 1);
        setText(u.wave, n);
        setText(u.waveTotal, this.totalWaves);
        setText(u.remaining, this.remaining ?? this.spawnQueue.length);
        setText(u.kills, this.kills);
        // ボスの HP バー
        const boss = this.spawned.find(e => e.isBoss);
        if (u.boss) {
            const show = !!boss && !this.isOver;
            u.boss.classList.toggle('show', show);
            if (boss) {
                setText(u.bossName, boss.displayName);
                u.bossFill.style.setProperty('--ratio', Math.max(0, boss.currentHP / boss.maxHP).toFixed(3));
            }
        }
        function setText(el, v) { if (el && el.textContent !== String(v)) el.textContent = v; }
    }
    
    showBanner(main, sub, kind = '') {
        const u = this.ui;
        if (!u.banner) return;
        u.bannerMain.textContent = main;
        u.bannerSub.textContent = sub || '';
        u.banner.className = '';
        void u.banner.offsetWidth; // アニメーションを最初から
        u.banner.className = 'show ' + kind;
    }
    
    setBannerSub(text) {
        if (this.ui.bannerSub && this.ui.bannerSub.textContent !== text) this.ui.bannerSub.textContent = text;
    }
    
    showResult() {
        const u = this.ui;
        if (!u.result) return;
        const win = this.state === 'victory';
        const t = Math.floor(this.time);
        const timeText = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
        u.resultTitle.textContent = win ? 'GAME CLEAR' : 'GAME OVER';
        u.result.classList.toggle('win', win);
        u.resultStats.innerHTML =
            (BattleMode.USE_WAVES ? `<div><span>到達ウェーブ</span><b>${this.waveIndex + 1} / ${this.totalWaves}</b></div>` : '') +
            `<div><span>撃破数</span><b>${this.kills}</b></div>` +
            `<div><span>${win ? 'クリアタイム' : '戦った時間'}</span><b>${timeText}</b></div>` +
            `<div><span>レベル</span><b>${this.game.player ? this.game.player.level : 1}</b></div>`;
        u.result.classList.add('show');
        document.body.classList.add('battle-result-open');
    }
    
    hideResult() {
        if (this.ui.result) this.ui.result.classList.remove('show');
        document.body.classList.remove('battle-result-open');
        this.resultTimer = 0;
    }
    
    showPause() {
        if (this.ui.pause) this.ui.pause.classList.add('show');
    }
    
    hidePause() {
        if (this.ui.pause) this.ui.pause.classList.remove('show');
    }
    
    // 終了（キャラ選択へ戻る時など）
    stop() {
        this.state = 'idle';
        this.hideResult();
        this.hidePause();
        if (this.ui.banner) this.ui.banner.className = '';
        if (this.ui.boss) this.ui.boss.classList.remove('show');
    }
}

window.BattleMode = BattleMode;
