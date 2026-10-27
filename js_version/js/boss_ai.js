// ボスAI（巨大森イノシシ・黒蝕狼。魔道ゴーレムは今後）
//
// しくみ
// - BossPhaseManager：HP の割合でフェーズ1→2→3 に進める（一度進んだら戻らない・移行は1回だけ通知）
// - BossAI：全ボス共通の土台。攻撃は「ジェネレーター関数」で書く（yield で1フレーム待つ）
//     *act_<攻撃名>(数値) を作り、boss_data.js の phases[].attacks に名前と重みを書くと使われる
// - 攻撃の当たり判定は hitboxes（丸・扇・輪）、予告や演出は fx に入れる
// - 見た目の動き（motion）は今は仮アニメーション（拡大縮小・揺れ・浮き）。
//   画像を置けば Enemy.getEnemyImage が motion 名の画像を使う

class BossPhaseManager {
    constructor(phases) {
        this.phases = phases;
        this.index = 0;
        this.changed = null;
    }
    
    // ratio：残りHPの割合（0〜1）
    update(ratio) {
        let target = this.index;
        for (let i = this.index + 1; i < this.phases.length; i++) {
            if (ratio <= this.phases[i].hp) target = i;
        }
        // 一気に2段階減った時は、最後のフェーズの演出だけ1回出す
        if (target > this.index) {
            this.index = target;
            this.changed = target;
        }
    }
    
    // フェーズが変わった直後なら、その番号（0始まり）を1回だけ返す
    consume() {
        const c = this.changed;
        this.changed = null;
        return c;
    }
    
    get current() { return this.phases[this.index]; }
    get number() { return this.index + 1; }
}

class BossAI {
    constructor(enemy, def) {
        this.e = enemy;
        // 攻撃の範囲・速さに Enemy.SCALE をかける（元の BOSS_DATA は書きかえない）
        const S = (typeof Enemy !== 'undefined' && Enemy.SCALE) || {};
        this.def = { ...def, attacks: BossAI.scaleAttacks(def.attacks || {}),
            attackInterval: (def.attackInterval || 1) * (S.cooldown || 1) };
        this.phase = new BossPhaseManager(def.phases);
        this.active = false;        // 開始の演出中は false（動かない）
        this.action = null;         // 実行中の攻撃（ジェネレーター）
        this.actionName = '';
        this.lastAttack = '';
        this.wait = 0.8;            // 次の攻撃までの時間
        this.motionTime = 0;        // 今のモーションになってからの時間（画像のコマ送りに使う）
        this.pose = null;           // 画像のコマ（0〜2）を攻撃側で決める時に入れる。null なら時間でくり返す
        this.motion = 'idle';
        this.superArmor = false;    // true の間はひるまない（突進・踏みつけ・咆哮など）
        this.invulnerable = false;  // true の間はダメージを受けない（影の高速移動・回避）
        this.lockFacing = false;    // true の間は移動方向ではなく facing の向きを向く
        this.hitboxes = [];
        this.fx = [];
        this.events = [];           // BossBattle が読む（phase / shake / hit）
        this.pendingProjectiles = [];
        this.facing = new Vector2(0, 1);
        this.blocked = false;       // 前のフレームで壁にぶつかったか（Enemy.update が入れる）
        this.time = 0;
        this.introTarget = null;    // 開始の演出で歩いていく場所
        // 見た目の仮アニメーション（毎フレーム攻撃側で決める）
        this.lift = 0;
        this.scaleX = 1;
        this.scaleY = 1;
        this.jitter = 0;
        this.warnColor = def.theme && def.theme.warn || '#ff3a2a';
    }
    
    // 攻撃データの距離（届く距離・範囲・攻撃を選ぶ距離）と速さに倍率をかけたコピーを作る
    // 時間（溜め・硬直）はそのまま：見てから避けられるように
    static scaleAttacks(attacks) {
        const S = (typeof Enemy !== 'undefined' && Enemy.SCALE) || { range: 1, speed: 1 };
        const DIST = ['reach', 'radius', 'maxRadius', 'band', 'dist'];
        const out = {};
        for (const [name, a] of Object.entries(attacks)) {
            const b = { ...a };
            for (const k of DIST) if (typeof b[k] === 'number') b[k] *= S.range;
            if (typeof b.speed === 'number') b.speed *= S.speed;
            if (Array.isArray(b.range)) b.range = b.range.map(v => v * S.range);
            out[name] = b;
        }
        return out;
    }
    // モーションが変わったら、コマ送りの時間を0に戻す
    get motion() { return this._motion; }
    set motion(v) { if (v !== this._motion) { this._motion = v; this.motionTime = 0; } }
    // ボスの絵（画像）が読み込まれているか。仮の見た目用の動き（浮く・のびる）を控えめにする
    get hasArt() {
        const key = this.def.look && this.def.look.key;
        return !!(key && window.assetManager && window.assetManager.get(`${key}_right_1`));
    }
    // エフェクト画像（assets/effects/boss/<名前>.png）
    static fxImage(name) { return window.assetManager ? window.assetManager.get(`bossfx_${name}`) : null; }
    
    get R() { return (typeof Enemy !== 'undefined' && Enemy.SCALE) ? Enemy.SCALE.range : 1; }  // 距離の倍率
    get SP() { return (typeof Enemy !== 'undefined' && Enemy.SCALE) ? Enemy.SCALE.speed : 1; } // 速さの倍率
    
    get P() { return this.phase.current; }
    get player() { return this.e.target; }
    atk(name) { return this.def.attacks[name]; }
    dmg(mul) { return Math.max(1, Math.round(this.e.attack * mul)); }
    toPlayer() { return this.player.position.sub(this.e.position); }
    dist() { return this.player ? this.toPlayer().length() : 9999; }
    dirToPlayer() { const v = this.toPlayer(); return v.length() > 0.01 ? v.normalize() : new Vector2(0, 1); }
    feet() { return new Vector2(this.e.position.x, this.e.position.y + this.e.size * 0.45); }
    get speed() { return this.e.speed * this.P.speedMul; }
    
    face(v) {
        if (v.length() < 0.01) return;
        this.facing = v.normalize();
        this.e.faceTowards(this.facing);
        this.lockFacing = true;
    }
    
    // ---------- 毎フレーム ----------
    update(dt) {
        this.time += dt;
        this.motionTime += dt;
        this.updateFx(dt);
        this.lift = 0; this.scaleX = 1; this.scaleY = 1; this.jitter = 0; this.pose = null;
        this.lockFacing = false;
        const e = this.e;
        e.velocity = new Vector2(0, 0);
        
        // 開始の演出：決められた場所まで歩くだけ
        if (!this.active) {
            if (this.introTarget) {
                const v = this.introTarget.sub(e.position);
                if (v.length() > 4) {
                    e.velocity = v.normalize().mult(Math.min(this.e.speed * 1.2, v.length() / dt));
                    this.motion = 'walk';
                } else {
                    this.introTarget = null;
                    this.face(new Vector2(0, 1));
                }
            }
            if (!this.introTarget) { this.motion = 'idle'; this.face(new Vector2(0, 1)); }
            return;
        }
        
        // フェーズ移行（HP50%以下・25%以下）
        this.phase.update(e.currentHP / e.maxHP);
        const changed = this.phase.consume();
        if (changed !== null) {
            this.cancel();
            this.events.push({ type: 'phase', index: changed });
            this.startAction('transition', this.transition(changed));
        }
        
        if (this.action) {
            const r = this.action.next(dt);
            if (r.done) this.endAction();
        } else {
            this.wait -= dt;
            this.idleMove(dt);
            if (this.wait <= 0) this.chooseAttack();
        }
    }
    
    // 戦闘開始（カウントダウンの後）
    startFight() {
        this.active = true;
        this.introTarget = null;
        this.startAction('detect', this.act_detect());
    }
    
    startAction(name, gen) {
        this.action = gen;
        this.actionName = name;
        const r = gen.next(); // 最初の yield まで進める
        if (r.done) this.endAction();
    }
    
    endAction() {
        this.action = null;
        this.actionName = '';
        this.superArmor = false;
        this.invulnerable = false;
        this.motion = 'idle';
        this.wait = this.def.attackInterval * this.P.intervalMul * (0.75 + Math.random() * 0.5);
    }
    
    cancel() {
        if (this.action) this.action.return();
        this.action = null;
        this.actionName = '';
        this.superArmor = false;
        this.invulnerable = false;
        this.hitboxes = [];
        this.fx = this.fx.filter(f => !f.warn); // 予告は消す（演出は残す）
    }
    
    // 大きくひるんだ（ひるみ値がたまった）：攻撃を中断
    interrupt() {
        this.cancel();
        this.motion = 'stun';
        this.wait = 0.5;
    }
    
    onDeath() {
        this.cancel();
        this.active = false;
        this.motion = 'death';
    }
    
    // フェーズで使える攻撃から、距離が合う物を重みで選ぶ（同じ攻撃が続きにくいように）
    chooseAttack() {
        const d = this.dist();
        const list = [];
        for (const [name, w] of Object.entries(this.P.attacks)) {
            const a = this.atk(name);
            if (!a || !this['act_' + name]) {
                if (!this._warned) { this._warned = true; console.warn('ボスAIに攻撃がありません:', name); }
                continue;
            }
            if (d < a.range[0] || d > a.range[1]) continue;
            list.push([name, name === this.lastAttack ? w * 0.4 : w]);
        }
        if (!list.length) { this.wait = 0.15; return; }
        const total = list.reduce((s, x) => s + x[1], 0);
        let roll = Math.random() * total, pick = list[0][0];
        for (const [name, w] of list) { roll -= w; if (roll < 0) { pick = name; break; } }
        this.lastAttack = pick;
        this.startAction(pick, this['act_' + pick](this.atk(pick)));
    }
    
    // 攻撃していない間の動き（ボスごとに上書き）
    idleMove(dt) {}
    
    // ---------- 攻撃を書くための道具 ----------
    // t 秒待つ。tick(進み具合0→1, dt) が毎フレーム呼ばれる
    *sleep(t, tick) {
        let el = 0;
        while (el < t) {
            const dt = yield;
            el += dt;
            if (tick) tick(Math.min(1, el / t), dt);
        }
    }
    
    *recover(t) {
        this.motion = 'idle';
        yield* this.sleep(t * this.P.recoverMul, () => this.face(this.dirToPlayer()));
    }
    
    *act_detect() {
        this.motion = 'detect';
        this.addFx({ type: 'mark', follow: true, life: 0.8 });
        yield* this.sleep(0.75, (p) => { this.face(this.dirToPlayer()); this.scaleY = 1 + Math.sin(p * Math.PI) * 0.06; });
    }
    
    // フェーズ移行の演出（ボスごとに上書き）
    *transition(index) {
        yield* this.sleep(1.0);
    }
    
    // ---------- 当たり判定 ----------
    // kind：'circle'（x,y,r） / 'arc'（扇：r, ang, spread） / 'ring'（輪：r0→r1 に広がる, band=太さ）
    // follow：true ならボスの位置についていく（fwd＝向きの方へずらす距離）
    addHitbox(h) {
        const box = { age: 0, life: 0.1, used: false, ...h };
        this.hitboxes.push(box);
        return box;
    }
    
    hitboxCenter(h) {
        if (!h.follow) return new Vector2(h.x, h.y);
        const p = h.feet ? this.feet() : this.e.position;
        const f = h.fwd || 0;
        return new Vector2(p.x + Math.cos(h.ang || 0) * f, p.y + Math.sin(h.ang || 0) * f);
    }
    
    checkHits(player) {
        const pr = 18; // プレイヤーの体の半径
        for (const h of this.hitboxes) {
            if (h.used || h.age < (h.delay || 0)) continue;
            const c = this.hitboxCenter(h);
            const v = player.position.sub(c);
            const d = v.length();
            let hit = false;
            if (h.kind === 'circle') hit = d <= h.r + pr;
            else if (h.kind === 'arc') {
                if (d <= h.r + pr) {
                    let da = Math.atan2(v.y, v.x) - h.ang;
                    while (da > Math.PI) da -= Math.PI * 2;
                    while (da < -Math.PI) da += Math.PI * 2;
                    hit = d < 30 || Math.abs(da) <= h.spread / 2;
                }
            } else if (h.kind === 'ring') {
                const r = this.ringRadius(h);
                hit = Math.abs(d - r) <= h.band / 2 + pr;
            }
            if (!hit) continue;
            const dealt = player.takeDamage(h.damage);
            if (dealt > 0) {
                h.used = true;
                this.events.push({ type: 'hit', power: h.shake || 4 });
            }
        }
    }
    
    ringRadius(h) {
        const p = Math.min(1, h.age / h.life);
        return h.r0 + (h.r1 - h.r0) * (1 - (1 - p) * (1 - p));
    }
    
    // ---------- 演出 ----------
    addFx(f) {
        const fx = { age: 0, life: 0.5, ...f };
        this.fx.push(fx);
        return fx;
    }
    
    updateFx(dt) {
        for (const f of this.fx) f.age += dt;
        this.fx = this.fx.filter(f => f.age < f.life);
        for (const h of this.hitboxes) h.age += dt;
        this.hitboxes = this.hitboxes.filter(h => h.age < h.life);
    }
    
    dust(pos, n = 1, color = 'rgba(205, 175, 125, 0.75)') {
        for (let i = 0; i < n; i++) {
            this.addFx({ type: 'dust', x: pos.x + (Math.random() - 0.5) * 20, y: pos.y + (Math.random() - 0.5) * 8,
                vx: (Math.random() - 0.5) * 40, vy: -10 - Math.random() * 20, r: 5 + Math.random() * 6, life: 0.5 + Math.random() * 0.3, color });
        }
    }
    
    fxPos(f) {
        if (!f.follow) return new Vector2(f.x, f.y);
        const p = f.feet ? this.feet() : this.e.position;
        const fw = f.fwd || 0;
        return new Vector2(p.x + Math.cos(f.ang || 0) * fw, p.y + Math.sin(f.ang || 0) * fw);
    }
    
    // 地面に描く物（予告の範囲・衝撃波・残像など）。キャラより下
    drawGround(ctx, cam) {
        for (const f of this.fx) {
            const p = this.fxPos(f).sub(cam);
            const t = Math.min(1, f.age / f.life);
            ctx.save();
            switch (f.type) {
                case 'circleWarn': {
                    // 予告の円：外側の線 + 中が時間とともに満ちていく
                    const col = f.color || this.warnColor;
                    ctx.globalAlpha = 0.16 + 0.12 * Math.sin(this.time * 18);
                    ctx.fillStyle = col;
                    ctx.beginPath(); ctx.ellipse(p.x, p.y, f.r, f.r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.globalAlpha = 0.45;
                    ctx.beginPath(); ctx.ellipse(p.x, p.y, f.r * t, f.r * 0.62 * t, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.globalAlpha = 0.9;
                    ctx.strokeStyle = col; ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.ellipse(p.x, p.y, f.r, f.r * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
                    break;
                }
                case 'laneWarn': {
                    // 突進・影の移動の予告：進む方向の帯
                    const col = f.color || this.warnColor;
                    ctx.translate(p.x, p.y + (f.dy || 0));
                    ctx.rotate(f.ang);
                    ctx.globalAlpha = 0.15 + 0.3 * t;
                    ctx.fillStyle = col;
                    ctx.fillRect(0, -f.width / 2, f.len * t, f.width);
                    ctx.globalAlpha = 0.75;
                    ctx.strokeStyle = col; ctx.lineWidth = 2;
                    ctx.setLineDash([10, 6]);
                    ctx.strokeRect(0, -f.width / 2, f.len, f.width);
                    // 矢印
                    ctx.setLineDash([]);
                    ctx.globalAlpha = 0.5 + 0.5 * t;
                    ctx.fillStyle = col;
                    for (let i = 1; i <= 3; i++) {
                        const ax = f.len * (i / 4);
                        ctx.beginPath(); ctx.moveTo(ax + 12, 0); ctx.lineTo(ax - 6, -f.width * 0.28); ctx.lineTo(ax - 6, f.width * 0.28); ctx.closePath(); ctx.fill();
                    }
                    break;
                }
                case 'arcWarn': {
                    const col = f.color || this.warnColor;
                    ctx.globalAlpha = 0.2 + 0.35 * t;
                    ctx.fillStyle = col;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.arc(p.x, p.y, f.r * (0.5 + 0.5 * t), f.ang - f.spread / 2, f.ang + f.spread / 2);
                    ctx.closePath(); ctx.fill();
                    ctx.globalAlpha = 0.8; ctx.strokeStyle = col; ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, f.r, f.ang - f.spread / 2, f.ang + f.spread / 2); ctx.closePath(); ctx.stroke();
                    break;
                }
                case 'shock': {
                    // 衝撃波の輪
                    const r = f.r0 + (f.r1 - f.r0) * (1 - (1 - t) * (1 - t));
                    // ring：輪の画像（'boar' = 土と岩 / 'corrupt' = 紫の侵蝕）を地面に寝かせて広げる
                    const ring = f.ring && [1, 2, 3].map(i => BossAI.fxImage(`${f.ring}_ring_${i}`));
                    if (ring && ring[0]) {
                        const img = ring[Math.min(2, Math.floor(t * 3))] || ring[0];
                        const w = r * 2.2; // 画像の輪（明るい所）が当たり判定の輪に重なる大きさ
                        ctx.save();
                        ctx.globalAlpha = (f.ringAlpha || 1) * (t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55);
                        ctx.drawImage(img, p.x - w / 2, p.y - w * 0.31, w, w * 0.62);
                        ctx.restore();
                    }
                    ctx.globalAlpha = (1 - t) * (ring && ring[0] ? 0.55 : 0.9);
                    ctx.strokeStyle = f.color || '#fff1c8';
                    ctx.lineWidth = (f.width || 10) * (1 - t * 0.6) * (ring && ring[0] ? 0.6 : 1);
                    ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
                    break;
                }
                case 'img': if (f.ground) this.drawFxImage(ctx, f, p, t); break;
                case 'crack': {
                    ctx.globalAlpha = t < 0.7 ? 0.6 : 0.6 * (1 - (t - 0.7) / 0.3);
                    ctx.strokeStyle = f.color || 'rgba(70, 45, 25, 1)';
                    ctx.lineWidth = 3;
                    for (let i = 0; i < 7; i++) {
                        const a = i / 7 * Math.PI * 2 + (f.seed || 0);
                        ctx.beginPath();
                        ctx.moveTo(p.x + Math.cos(a) * f.r * 0.2, p.y + Math.sin(a) * f.r * 0.12);
                        ctx.lineTo(p.x + Math.cos(a + 0.2) * f.r * 0.6, p.y + Math.sin(a + 0.2) * f.r * 0.37);
                        ctx.lineTo(p.x + Math.cos(a - 0.1) * f.r, p.y + Math.sin(a - 0.1) * f.r * 0.62);
                        ctx.stroke();
                    }
                    break;
                }
                case 'after': {
                    // 残像（影の高速移動）
                    ctx.globalAlpha = 0.45 * (1 - t);
                    // 画像があれば、その時の絵を紫の影にして残す
                    if (f.img) {
                        const size = this.e.size * (f.mul || 1.5);
                        ctx.globalAlpha = 0.55 * (1 - t);
                        ctx.drawImage(Enemy.getWhiteSilhouette(f.img, '#4a1f73'), p.x - size / 2, p.y - size / 2, size, size);
                        ctx.globalAlpha = 0.3 * (1 - t);
                        ctx.drawImage(f.img, p.x - size / 2, p.y - size / 2, size, size);
                        break;
                    }
                    const saveP = this.e.position, saveD = this.e.direction, saveF = this.e.hitFlashTimer;
                    this.e.position = new Vector2(f.x, f.y);
                    this.e.direction = f.dir;
                    this.e.hitFlashTimer = 0;
                    this.e.drawBeastFallback(ctx, new Vector2(p.x, p.y), 0);
                    this.e.position = saveP; this.e.direction = saveD; this.e.hitFlashTimer = saveF;
                    break;
                }
            }
            ctx.restore();
        }
    }
    
    // キャラより手前に描く物（斬撃・砂ぼこり・「！」など）
    drawAbove(ctx, cam) {
        for (const f of this.fx) {
            const p = this.fxPos(f).sub(cam);
            const t = Math.min(1, f.age / f.life);
            ctx.save();
            switch (f.type) {
                case 'slash': {
                    ctx.globalAlpha = 1 - t;
                    ctx.strokeStyle = f.color || '#ffffff';
                    ctx.lineWidth = 7 * (1 - t) + 2;
                    ctx.lineCap = 'round';
                    const a0 = f.ang - f.spread / 2, a1 = f.ang + f.spread / 2;
                    const from = f.reverse ? a1 : a0, to = f.reverse ? a0 : a1;
                    const sweep = Math.min(1, t * 3);
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, f.r, Math.min(from, from + (to - from) * sweep), Math.max(from, from + (to - from) * sweep));
                    ctx.stroke();
                    break;
                }
                case 'dust': {
                    const x = p.x + f.vx * f.age, y = p.y + f.vy * f.age;
                    ctx.globalAlpha = 1 - t;
                    ctx.fillStyle = f.color;
                    ctx.beginPath(); ctx.arc(x, y, f.r * (1 + t), 0, Math.PI * 2); ctx.fill();
                    break;
                }
                case 'mark': {
                    // 発見の「！」
                    const y = p.y - this.e.size * 0.95 - Math.sin(Math.min(1, t * 4) * Math.PI / 2) * 10;
                    ctx.globalAlpha = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
                    ctx.font = 'bold 34px "DotGothic16", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.lineWidth = 5; ctx.strokeStyle = '#2a0d05';
                    ctx.strokeText('！', p.x, y);
                    ctx.fillStyle = '#ffe14a';
                    ctx.fillText('！', p.x, y);
                    break;
                }
                case 'roar': {
                    // 咆哮・遠吠え：放射状の線
                    ctx.globalAlpha = (1 - t) * 0.8;
                    ctx.strokeStyle = f.color || '#fff3c0';
                    ctx.lineWidth = 3;
                    for (let i = 0; i < 12; i++) {
                        const a = i / 12 * Math.PI * 2 + f.seed;
                        const r0 = this.e.size * (0.6 + t * 0.8), r1 = r0 + 26;
                        ctx.beginPath();
                        ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0 * 0.8);
                        ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1 * 0.8);
                        ctx.stroke();
                    }
                    break;
                }
                case 'orb': {
                    // 侵蝕弾を溜める光
                    const r = 6 + t * 14;
                    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2);
                    g.addColorStop(0, '#f6d8ff');
                    g.addColorStop(0.4, 'rgba(190, 80, 255, 0.85)');
                    g.addColorStop(1, 'rgba(90, 0, 140, 0)');
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2); ctx.fill();
                    break;
                }
                case 'flash': {
                    // 攻撃直前の体の光（予告）。画像があれば体の形のまま光らせる
                    const img = this.hasArt && this.e.getEnemyImage();
                    if (img) {
                        const size = this.e.size * (this.e._drawMul || 1.5);
                        const s = this.e.position.sub(cam);
                        ctx.globalAlpha = 0.2 + 0.4 * t;
                        ctx.drawImage(Enemy.getWhiteSilhouette(img, f.color || this.warnColor), s.x - size / 2, s.y - size / 2 - this.lift, size, size);
                        break;
                    }
                    ctx.globalAlpha = 0.25 + 0.35 * t;
                    ctx.fillStyle = f.color || this.warnColor;
                    ctx.beginPath(); ctx.ellipse(p.x, p.y, this.e.size * 0.62, this.e.size * 0.48, 0, 0, Math.PI * 2); ctx.fill();
                    break;
                }
                case 'img': if (!f.ground) this.drawFxImage(ctx, f, p, t); break;
            }
            ctx.restore();
        }
    }
    
    // エフェクト画像を出す。keys：画像の名前（複数ならコマ送り） / w：横幅 / s0→s1：大きさの変化
    // rot：回転 / flip：左右反転 / flat：縦につぶす（地面に寝かせる） / hold：この割合まで濃いまま、その後消える
    fxImg(keys, opt) {
        const list = Array.isArray(keys) ? keys : [keys];
        if (!BossAI.fxImage(list[0])) return null;
        // ground：true（ふつう）= 体より下に描く / false = 体より手前（牙・爪・口の光など）
        return this.addFx({ type: 'img', keys: list, w: 100, s0: 1, s1: 1, hold: 0.5, ground: true, ...opt });
    }
    
    drawFxImage(ctx, f, p, t) {
        const imgs = f.keys.map(k => BossAI.fxImage(k)).filter(Boolean);
        if (!imgs.length) return;
        const img = imgs[Math.min(imgs.length - 1, Math.floor(t * imgs.length))];
        const s = f.s0 + (f.s1 - f.s0) * (1 - (1 - t) * (1 - t));
        const w = f.w * s, h = w * img.height / img.width * (f.flat || 1);
        ctx.globalAlpha = (f.alpha || 1) * (t < f.hold ? 1 : 1 - (t - f.hold) / (1 - f.hold));
        if (f.add) ctx.globalCompositeOperation = 'lighter';
        ctx.translate(p.x + (f.vx || 0) * f.age, p.y + (f.dy || 0) + (f.vy || 0) * f.age);
        if (f.rot) ctx.rotate(f.rot);
        if (f.flip) ctx.scale(-1, 1);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
}

// ==========================================================
// 巨大森イノシシ：重い動き・牙・突進（壁に当たると目を回す）・踏みつけ
// ==========================================================
class ForestBoarAI extends BossAI {
    constructor(enemy, def) {
        super(enemy, def);
        this.warnColor = '#ff3a2a';
    }
    
    // ゆっくり向きを変えながら追いかける（急には曲がれない＝重さ）
    idleMove(dt) {
        const want = this.dirToPlayer();
        const cur = Math.atan2(this.facing.y, this.facing.x);
        let diff = Math.atan2(want.y, want.x) - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = 2.4 * this.P.speedMul * dt;
        const a = cur + Math.max(-turn, Math.min(turn, diff));
        this.facing = new Vector2(Math.cos(a), Math.sin(a));
        this.e.faceTowards(this.facing);
        this.lockFacing = true;
        const d = this.dist();
        if (d < 85 * this.R) { this.motion = 'idle'; return; }
        let sp = this.speed;
        if (Math.abs(diff) > 1.1) { sp *= 0.3; this.motion = 'turn'; }     // 方向転換中は遅い
        else if (d > 380 * this.R) { sp *= 1.5; this.motion = 'run'; }
        else this.motion = 'walk';
        this.e.velocity = this.facing.mult(sp);
    }
    
    // ---- 牙攻撃 ----
    *tuskStrike(a, windup, k = 0) {
        this.motion = 'tuskAttack';
        const dir = this.dirToPlayer();
        this.face(dir);
        const ang = Math.atan2(dir.y, dir.x);
        const r = a.reach + this.e.size * 0.3;
        this.addFx({ type: 'arcWarn', warn: true, follow: true, ang, r, spread: 1.7, life: windup });
        // 頭を下げて力をためる
        yield* this.sleep(windup, (p) => { this.face(dir); this.pose = 0; this.scaleX = 1 + 0.05 * p; this.scaleY = 1 - 0.07 * p; this.jitter = p > 0.6 ? 1.5 : 0; });
        // 突き上げる
        this.e.moveBy(dir.mult(24));
        this.addHitbox({ kind: 'arc', follow: true, ang, r, spread: 1.7, damage: this.dmg(a.damage), life: 0.12 });
        this.addFx({ type: 'slash', follow: true, ang, r: r * 0.85, spread: 1.5, life: 0.25, reverse: k % 2 === 1 });
        // 前足でふんばった所に土煙
        const f = this.feet().add(dir.mult(this.e.size * 0.35));
        this.fxImg('dust_cloud', { x: f.x, y: f.y - 6, w: this.e.size * 0.9, s0: 0.5, s1: 1.1, life: 0.45, hold: 0.3, alpha: 0.8 });
        yield* this.sleep(0.2, (p) => { this.face(dir); this.pose = p < 0.45 ? 1 : 2; this.scaleY = 1.04; });
    }
    
    *act_tusk(a) {
        yield* this.tuskStrike(a, a.windup);
        yield* this.recover(a.recover);
    }
    
    // フェーズ3：牙の連続攻撃
    *act_tuskCombo(a) {
        for (let i = 0; i < a.hits; i++) {
            yield* this.tuskStrike(a, i === 0 ? a.windup : a.windup * 0.6, i);
            yield* this.sleep(0.06);
        }
        yield* this.recover(a.recover);
    }
    
    // ---- 突進（count 回続けて突っ込む） ----
    *act_charge(a) {
        this.crashed = false;
        for (let i = 0; i < a.count; i++) {
            yield* this.chargeOnce(a, i === 0 ? a.prepare : a.between + 0.25);
            if (this.crashed) return; // 壁に激突して目を回した：連続突進はそこで終わり
        }
        yield* this.recover(a.recover);
    }
    *act_doubleCharge(a) { yield* this.act_charge(a); }
    *act_tripleCharge(a) { yield* this.act_charge(a); }
    
    *chargeOnce(a, prepare) {
        this.motion = 'chargePrepare';
        let dir = this.dirToPlayer();
        const warn = this.addFx({ type: 'laneWarn', warn: true, follow: true, ang: Math.atan2(dir.y, dir.x), len: a.speed * a.duration * 0.8,
            width: this.e.size * 0.95, dy: this.e.size * 0.3, life: prepare });
        // 予備動作：前半はプレイヤーに向きを合わせ、後半は向きを固定して地面をかく
        yield* this.sleep(prepare, (p, dt) => {
            if (p < 0.65) { dir = this.dirToPlayer(); warn.ang = Math.atan2(dir.y, dir.x); }
            this.face(dir);
            this.jitter = 1 + p * 2.5;
            this.scaleX = 1 - 0.05 * p; this.scaleY = 1 + 0.05 * p;
            if (Math.random() < dt * 10) this.dust(this.feet().sub(dir.mult(this.e.size * 0.4)));
            // 前足で地面をかいた土煙（後ろへ飛ぶ）
            if (Math.random() < dt * 4) {
                const f = this.feet().sub(dir.mult(this.e.size * 0.3));
                this.fxImg('dust_cloud', { x: f.x, y: f.y - 4, vx: -dir.x * 50, vy: -12, w: this.e.size * 0.55, s0: 0.5, s1: 1.1, life: 0.5, hold: 0.25, alpha: 0.75 });
            }
        });
        this.motion = 'charge';
        this.superArmor = true;
        const body = this.addHitbox({ kind: 'circle', follow: true, r: this.e.size * 0.55, damage: this.dmg(a.damage), life: a.duration + 0.1, shake: 7 });
        this.blocked = false;
        let t = 0;
        while (t < a.duration) {
            const dt = yield;
            t += dt;
            this.face(dir);
            this.e.velocity = dir.mult(a.speed);
            this.scaleX = 1.04; this.scaleY = 0.97;
            if (Math.random() < dt * 25) this.dust(this.feet(), 1);
            // 走った後ろに土煙が残る
            if (Math.random() < dt * 9) {
                const f = this.feet().sub(dir.mult(this.e.size * 0.45));
                this.fxImg('dust_cloud', { ground: true, x: f.x, y: f.y - 6, w: this.e.size * 0.8, s0: 0.6, s1: 1.3, life: 0.6, hold: 0.2, alpha: 0.7 });
            }
            if (this.blocked) {
                body.life = 0;
                yield* this.wallCrash(dir);
                return;
            }
        }
        body.life = 0;
        this.superArmor = false;
        // 突進の終わり：すべりながら止まる
        this.motion = 'chargeEnd';
        yield* this.sleep(0.35, (p, dt) => {
            this.face(dir);
            this.e.velocity = dir.mult(a.speed * 0.45 * (1 - p));
            if (Math.random() < dt * 20) this.dust(this.feet(), 1);
            if (Math.random() < dt * 8) {
                const f = this.feet().add(dir.mult(this.e.size * 0.3));
                this.fxImg('dust_cloud', { x: f.x, y: f.y - 4, w: this.e.size * 0.8, s0: 0.6, s1: 1.2, life: 0.5, hold: 0.25, alpha: 0.8 });
            }
        });
    }
    
    // 突進で壁に激突：しばらく目を回す（攻撃のチャンス）
    *wallCrash(dir) {
        this.crashed = true;
        this.superArmor = false;
        this.motion = 'stun';
        this.events.push({ type: 'shake', power: 9, time: 0.35 });
        this.addFx({ type: 'shock', follow: true, fwd: this.e.size * 0.5, ang: Math.atan2(dir.y, dir.x), r0: 10, r1: 80, life: 0.35, width: 8 });
        this.dust(this.e.position.add(dir.mult(this.e.size * 0.5)), 8);
        // 壁にぶつかった所：岩がくだけて土煙
        const hit = this.e.position.add(dir.mult(this.e.size * 0.55));
        this.fxImg('rock_burst', { ground: false, x: hit.x, y: hit.y, w: this.e.size * 1.0, s0: 0.5, s1: 1.15, life: 0.55, hold: 0.45 });
        this.fxImg('dust_cloud', { x: hit.x, y: hit.y + this.e.size * 0.3, w: this.e.size * 1.4, s0: 0.6, s1: 1.3, life: 0.8, hold: 0.3, alpha: 0.85 });
        const stun = this.phase.index === 2 ? 1.4 : 1.9;
        this.e.crashTimer = stun;
        yield* this.sleep(0.2, (p) => { this.e.velocity = dir.mult(-160 * this.SP * (1 - p)); }); // 跳ね返る
        yield* this.sleep(stun, (p) => { this.scaleY = 0.96 + Math.sin(p * 30) * 0.02; });
    }
    
    // ---- 踏みつけ（地面を踏み鳴らす範囲攻撃） ----
    *act_stomp(a) {
        this.motion = 'stomp';
        this.superArmor = true;
        for (let w = 0; w < a.waves; w++) {
            const windup = w === 0 ? a.windup : 0.5;
            const at = this.feet();
            this.addFx({ type: 'circleWarn', warn: true, x: at.x, y: at.y, r: a.radius, life: windup });
            // 前脚を上げる（体が浮いて縦にのびる）
            // 画像があるときは「後ろ足で立ち上がる絵」なので体は浮かせない
            const art = this.hasArt;
            yield* this.sleep(windup, (p) => {
                this.face(this.dirToPlayer());
                this.pose = p < 0.8 ? 0 : 1;
                this.lift = art ? 0 : Math.sin(p * Math.PI / 2) * 20;
                this.scaleY = 1 + (art ? 0.03 : 0.08) * p;
            });
            // 着地
            this.addHitbox({ kind: 'circle', x: at.x, y: at.y, r: a.radius * 0.95, damage: this.dmg(a.damage), life: 0.1, shake: 8 });
            this.addFx({ type: 'shock', x: at.x, y: at.y, r0: 20, r1: a.radius * 1.1, life: 0.5, width: 12, ring: 'boar', ringAlpha: 0.8 });
            this.addFx({ type: 'crack', x: at.x, y: at.y, r: a.radius * 0.7, life: 1.4, seed: Math.random() * 6 });
            // 前足の下で地面がくだけ、土煙が広がる
            const front = at.add(this.facing.mult(this.e.size * 0.3));
            // 地面の物なのでボスの体より下に描く（顔を隠さないように）
            this.fxImg('rock_burst', { ground: true, x: front.x, y: front.y - this.e.size * 0.1, w: this.e.size * 0.95, s0: 0.5, s1: 1.05, life: 0.55, hold: 0.45 });
            this.fxImg('dust_cloud', { ground: true, x: at.x, y: at.y - 4, w: a.radius * 1.3, s0: 0.5, s1: 1.2, life: 0.8, hold: 0.3, alpha: 0.75 });
            this.dust(at, 10);
            this.events.push({ type: 'shake', power: 6 + w * 2, time: 0.3 });
            yield* this.sleep(0.18, () => { this.pose = 2; this.scaleY = 0.95; this.scaleX = 1.04; });
        }
        this.superArmor = false;
        yield* this.recover(a.recover);
    }
    // フェーズ3：強力な踏みつけ（範囲が広く、2回踏み鳴らす）
    *act_bigStomp(a) { yield* this.act_stomp(a); }
    
    // ---- フェーズ移行：咆哮 ----
    *transition(index) {
        this.motion = 'roar';
        this.superArmor = true;
        this.invulnerable = true;
        yield* this.sleep(0.35, (p) => { this.face(this.dirToPlayer()); this.scaleY = 1 - 0.06 * p; });
        this.events.push({ type: 'shake', power: 10, time: 0.9 });
        let next = 0;
        yield* this.sleep(1.2, (p, dt) => {
            this.face(this.dirToPlayer());
            this.scaleY = 1.07; this.scaleX = 1.03; this.jitter = 2.5;
            next -= dt;
            if (next <= 0) {
                next = 0.3;
                this.addFx({ type: 'shock', follow: true, feet: true, r0: 30, r1: 230, life: 0.6, width: 6, color: '#ffd9a0', ring: 'boar', ringAlpha: 0.45 });
                const f = this.feet();
                this.fxImg('dust_cloud', { ground: true, x: f.x + (Math.random() - 0.5) * this.e.size, y: f.y, w: this.e.size * 1.1, s0: 0.6, s1: 1.4, life: 0.7, hold: 0.2, alpha: 0.6 });
                this.addFx({ type: 'roar', follow: true, life: 0.4, seed: Math.random() });
            }
            // 咆哮の風圧で、近くのプレイヤーを少し押し返す（ダメージなし）
            const v = this.toPlayer();
            if (v.length() < 220 && this.player.moveBy) this.player.moveBy(v.normalize().mult(140 * dt));
        });
        this.invulnerable = false;
    }
}

// ==========================================================
// 黒蝕狼：素早く回り込む・噛みつき・爪・飛びかかり・影の高速移動・侵蝕弾・侵蝕波動
// ==========================================================
class BlackWolfAI extends BossAI {
    constructor(enemy, def) {
        super(enemy, def);
        this.warnColor = '#ff3ad0';
        this.orbitSign = Math.random() < 0.5 ? 1 : -1;
        this.orbitTimer = 2;
        this.dodgeCooldown = 0;
        this.playerWasAttacking = false;
    }
    
    update(dt) {
        if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;
        // プレイヤーが攻撃・詠唱を始めた瞬間に、近ければ確率で回避する
        if (this.active && this.player) {
            const atk = !!(this.player.isAttacking || this.player.isChanting);
            const started = atk && !this.playerWasAttacking;
            this.playerWasAttacking = atk;
            const canDodge = !this.action; // 攻撃中は避けない（攻撃後の隙を狙える）
            if (started && canDodge && this.dodgeCooldown <= 0 && this.dist() < 140 * this.R && Math.random() < (this.P.dodgeChance || 0)) {
                this.dodgeCooldown = 1.2;
                this.cancel();
                this.startAction('dodge', this.act_dodge());
            }
        }
        super.update(dt);
    }
    
    // プレイヤーのまわりを回りながら、ちょうどいい距離を保つ
    idleMove(dt) {
        this.orbitTimer -= dt;
        if (this.orbitTimer <= 0) { this.orbitSign *= -1; this.orbitTimer = 1.2 + Math.random() * 1.5; }
        const to = this.toPlayer();
        const d = to.length();
        const n = to.normalize();
        const tangent = new Vector2(-n.y * this.orbitSign, n.x * this.orbitSign);
        const radial = n.mult(Math.max(-1, Math.min(1, (d - 200 * this.R) / (80 * this.R))));
        const v = tangent.mult(0.85).add(radial).normalize();
        this.e.velocity = v.mult(this.speed * 0.8);
        if (this.blocked) this.orbitSign *= -1;
        this.face(n);
        this.motion = this.speed > 160 * this.SP ? 'run' : 'walk';
    }
    
    // 近づく（max 秒まで）
    *approach(range, max = 1.0) {
        let t = 0;
        this.motion = 'run';
        while (this.dist() > range && t < max) {
            const dt = yield;
            t += dt;
            const dir = this.dirToPlayer();
            this.face(dir);
            this.e.velocity = dir.mult(this.speed * 1.6);
        }
    }
    
    // 攻撃の後、距離を取る
    *backOff(time = 0.35) {
        this.motion = 'run';
        const side = Math.random() < 0.5 ? 1 : -1;
        yield* this.sleep(time, () => {
            const n = this.dirToPlayer();
            this.face(n);
            const away = n.mult(-1).add(new Vector2(-n.y * side, n.x * side).mult(0.5)).normalize();
            this.e.velocity = away.mult(this.speed * 1.3);
        });
    }
    
    afterImage() {
        const img = this.hasArt ? this.e.getEnemyImage() : null;
        this.addFx({ type: 'after', x: this.e.position.x, y: this.e.position.y - this.lift, dir: this.e.direction, life: 0.32, img, mul: this.e._drawMul });
    }
    
    // ---- 噛みつき ----
    *act_bite(a) {
        yield* this.approach(80 * this.R);
        for (let i = 0; i < a.hits; i++) {
            this.motion = 'bite';
            const dir = this.dirToPlayer();
            const ang = Math.atan2(dir.y, dir.x);
            const windup = i === 0 ? a.windup : a.windup * 0.75;
            this.addFx({ type: 'flash', warn: true, follow: true, life: windup });
            yield* this.sleep(windup, (p) => { this.face(dir); this.pose = 0; this.scaleY = 1 - 0.1 * p; this.scaleX = 1 + 0.05 * p; });
            this.addHitbox({ kind: 'circle', follow: true, ang, fwd: this.e.size * 0.7, r: 40 * this.R, damage: this.dmg(a.damage), life: 0.14 });
            // かみついた所に紫の牙（画像がなければ白い線）
            if (!this.fxImg('bite_fangs', { ground: false, follow: true, ang, fwd: this.e.size * 0.85, dy: -this.e.size * 0.15, w: 50 * this.R, s0: 1.35, s1: 0.9, life: 0.26, hold: 0.45 })) {
                this.addFx({ type: 'slash', follow: true, ang, fwd: this.e.size * 0.55, r: 22 * this.R, spread: 2.4, life: 0.2 });
            }
            yield* this.sleep(0.14, () => { this.face(dir); this.pose = 1; this.e.velocity = dir.mult(380 * this.SP); });
            yield* this.sleep(0.08, () => { this.pose = 2; });
        }
        this.motion = 'idle';
        yield* this.sleep(a.recover * this.P.recoverMul * 0.6);
        yield* this.backOff();
    }
    *act_doubleBite(a) { yield* this.act_bite(a); }
    
    // ---- 爪攻撃（フェーズ3は3連続） ----
    *act_claw(a) {
        yield* this.approach(90 * this.R);
        for (let i = 0; i < a.hits; i++) {
            this.motion = 'claw';
            const dir = this.dirToPlayer();
            const ang = Math.atan2(dir.y, dir.x) + (i % 2 ? 0.25 : -0.25);
            const windup = i === 0 ? a.windup : a.windup * 0.6;
            this.addFx({ type: 'arcWarn', warn: true, follow: true, ang, r: a.reach, spread: 1.9, life: windup });
            yield* this.sleep(windup, (p) => { this.face(dir); this.pose = 0; this.scaleX = 1 - 0.06 * p; this.jitter = p > 0.5 ? 1 : 0; });
            this.e.moveBy(dir.mult(18));
            this.addHitbox({ kind: 'arc', follow: true, ang, r: a.reach, spread: 1.9, damage: this.dmg(a.damage), life: 0.12 });
            this.addFx({ type: 'slash', follow: true, ang, r: a.reach * 0.8, spread: 1.8, life: 0.24, color: '#e9c6ff', reverse: i % 2 === 1 });
            // 爪の跡（3本の紫の光）。連続攻撃は交互に向きを変える
            this.fxImg('claw_slash', { ground: false, follow: true, ang, fwd: a.reach * 0.55, dy: -this.e.size * 0.2, w: a.reach * 0.95, s0: 0.8, s1: 1.1,
                // 画像の爪あとは右上がり（約60度）。攻撃の向きと直角になるように回す
                rot: ang - 0.52 + (i % 2 ? 0.35 : -0.35), life: 0.3, hold: 0.4, add: true });
            yield* this.sleep(0.12, (p) => { this.face(dir); this.pose = p < 0.5 ? 1 : 2; });
        }
        this.motion = 'idle';
        yield* this.sleep(a.recover * this.P.recoverMul * 0.6);
        yield* this.backOff();
    }
    *act_tripleClaw(a) { yield* this.act_claw(a); }
    
    // ---- 飛びかかり ----
    *leap(a, prepare, time) {
        this.motion = 'leapPrepare';
        const start = this.e.position.clone();
        // 着地点：プレイヤーの少し先（最大 380px）
        let target = this.player.position.add((this.player.velocity || new Vector2(0, 0)).mult(0.25));
        let v = target.sub(start);
        const maxLeap = 380 * this.R;
        if (v.length() > maxLeap) target = start.add(v.normalize().mult(maxLeap));
        const land = new Vector2(target.x, target.y + this.e.size * 0.45);
        this.addFx({ type: 'circleWarn', warn: true, x: land.x, y: land.y, r: a.radius, life: prepare + time });
        // 身をかがめる
        yield* this.sleep(prepare, (p) => { this.face(target.sub(start)); this.pose = Math.min(2, Math.floor(p * 3)); this.scaleY = 1 - 0.14 * p; this.scaleX = 1 + 0.06 * p; this.jitter = p > 0.5 ? 1 : 0; });
        this.motion = 'leap';
        this.superArmor = true;
        const vel = target.sub(start).mult(1 / time);
        yield* this.sleep(time, (p) => { this.face(vel); this.pose = Math.min(2, Math.floor(p * 3)); this.e.velocity = vel; this.lift = Math.sin(p * Math.PI) * 48; this.scaleY = 1.06; });
        this.superArmor = false;
        // 着地
        const at = this.feet();
        this.addHitbox({ kind: 'circle', x: at.x, y: at.y, r: a.radius, damage: this.dmg(a.damage), life: 0.12, shake: 6 });
        this.addFx({ type: 'shock', x: at.x, y: at.y, r0: 16, r1: a.radius * 1.2, life: 0.4, width: 8, color: '#d59cff', ring: 'corrupt', ringAlpha: 0.85 });
        this.dust(at, 6, 'rgba(120, 70, 150, 0.6)');
        this.events.push({ type: 'shake', power: 4, time: 0.2 });
        yield* this.sleep(0.12, () => { this.scaleY = 0.9; });
    }
    
    *act_leap(a) {
        yield* this.leap(a, a.prepare, a.time);
        yield* this.recover(a.recover);
        yield* this.backOff(0.3);
    }
    
    // ---- 影の高速移動（瞬間移動ではなく、短い距離をすばやく走り抜ける） ----
    *shadowDash(a) {
        this.motion = 'shadowDash';
        const n = this.dirToPlayer();
        const side = Math.random() < 0.5 ? 1 : -1;
        // プレイヤーの横（斜め前）に回り込む
        const perp = new Vector2(-n.y * side, n.x * side);
        let dest = this.player.position.add(perp.mult(150 * this.R)).add(n.mult(-40 * this.R));
        let v = dest.sub(this.e.position);
        if (v.length() > a.dist) dest = this.e.position.add(v.normalize().mult(a.dist));
        v = dest.sub(this.e.position);
        const ang = Math.atan2(v.y, v.x);
        this.addFx({ type: 'laneWarn', warn: true, follow: true, ang, len: v.length(), width: 26, dy: this.e.size * 0.3, life: a.prepare, color: '#b14dff' });
        this.motion = 'leapPrepare'; // 身を低くしてから走り抜ける
        yield* this.sleep(a.prepare, (p) => { this.face(v); this.pose = p < 0.5 ? 1 : 2; this.scaleY = 1 - 0.1 * p; this.jitter = 1.5; });
        this.motion = 'shadowDash';
        this.invulnerable = true;
        const vel = v.mult(1 / a.time);
        let next = 0;
        yield* this.sleep(a.time, (p, dt) => {
            this.face(vel);
            this.e.velocity = vel;
            this.scaleX = 1.12; this.scaleY = 0.9;
            next -= dt;
            if (next <= 0) { next = 0.03; this.afterImage(); }
        });
        this.invulnerable = false;
        this.face(this.dirToPlayer());
    }
    
    *act_shadowDash(a) {
        yield* this.shadowDash(a);
        yield* this.sleep(a.recover);
        this.wait = 0.1; // すぐ次の攻撃へ
    }
    
    // フェーズ3：影の高速移動からそのまま飛びかかる
    *act_shadowLeap(a) {
        yield* this.shadowDash(a);
        yield* this.leap(a, a.leapPrepare, a.leapTime);
        yield* this.recover(a.recover);
        yield* this.backOff(0.3);
    }
    
    // ---- 暗紫色の侵蝕弾 ----
    *act_corruptionShot(a) {
        this.motion = 'corruptionAttack';
        const count = this.phase.index >= 2 ? a.count + 2 : a.count;
        const dir0 = this.dirToPlayer();
        const ang0 = Math.atan2(dir0.y, dir0.x);
        this.addFx({ type: 'orb', warn: true, follow: true, ang: ang0, fwd: this.e.size * 0.5, life: a.windup });
        yield* this.sleep(a.windup, (p) => { this.face(this.dirToPlayer()); this.pose = 0; this.jitter = p * 1.5; this.scaleY = 1 + 0.05 * p; });
        const dir = this.dirToPlayer();
        const ang = Math.atan2(dir.y, dir.x);
        const mouth = this.e.position.add(dir.mult(this.e.size * 0.5));
        for (let i = 0; i < count; i++) {
            const k = count === 1 ? 0 : i / (count - 1) - 0.5;
            const aa = ang + k * a.spread * (count - 1);
            this.pendingProjectiles.push({
                position: mouth.clone(), velocity: new Vector2(Math.cos(aa), Math.sin(aa)).mult(a.speed),
                damage: this.dmg(a.damage), radius: 10 * ((typeof Enemy !== 'undefined' && Enemy.SCALE.shot) || 1), life: 3.0, age: 0, kind: 'corrupt'
            });
        }
        this.addFx({ type: 'shock', follow: true, ang, fwd: this.e.size * 0.5, r0: 6, r1: 40, life: 0.25, width: 5, color: '#c77dff' });
        this.fxImg(['corrupt_ring_1', 'corrupt_ring_2', 'corrupt_ring_3'], { ground: false, x: mouth.x, y: mouth.y, w: 50 * this.R, s0: 0.5, s1: 1.2, life: 0.3, hold: 0.3, add: true });
        yield* this.sleep(0.2);
        yield* this.recover(a.recover);
        yield* this.backOff(0.25);
    }
    
    // ---- 広範囲の侵蝕波動（広がる輪。回避か、輪の外へ逃げる） ----
    *act_corruptionWave(a) {
        this.motion = 'corruptionAttack';
        this.superArmor = true;
        const at = this.feet();
        this.addFx({ type: 'circleWarn', warn: true, x: at.x, y: at.y, r: a.maxRadius, life: a.windup, color: '#b14dff' });
        // 絵：身を低くして力をため（leapPrepare）、放つ瞬間に吠える（howl）
        this.motion = 'leapPrepare';
        yield* this.sleep(a.windup, (p) => { this.face(this.dirToPlayer()); this.pose = Math.min(2, Math.floor(p * 3)); this.scaleY = 1 - 0.1 * p; this.jitter = p * 2.5; });
        this.motion = 'howl';
        this.addHitbox({ kind: 'ring', x: at.x, y: at.y, r0: 20, r1: a.maxRadius, band: a.band, damage: this.dmg(a.damage), life: a.time, shake: 6 });
        this.addFx({ type: 'shock', x: at.x, y: at.y, r0: 20, r1: a.maxRadius, life: a.time, width: a.band, color: 'rgba(170, 60, 255, 0.85)', ring: 'corrupt', ringAlpha: 0.3 });
        this.addFx({ type: 'shock', x: at.x, y: at.y, r0: 10, r1: a.maxRadius * 0.8, life: a.time * 1.1, width: 6, color: '#f0c8ff' });
        this.events.push({ type: 'shake', power: 6, time: 0.4 });
        yield* this.sleep(a.time, () => { this.pose = 1; this.scaleY = 1.03; });
        this.superArmor = false;
        yield* this.recover(a.recover);
    }
    
    // ---- 回避（後ろ・横へ跳ぶ） ----
    *act_dodge() {
        this.motion = 'dodge';
        this.invulnerable = true;
        const n = this.dirToPlayer();
        const side = Math.random() < 0.5 ? 1 : -1;
        const away = n.mult(-1).add(new Vector2(-n.y * side, n.x * side)).normalize();
        let next = 0;
        yield* this.sleep(0.2, (p, dt) => {
            this.face(n);
            this.e.velocity = away.mult(560 * this.SP * (1 - p * 0.5));
            this.lift = Math.sin(p * Math.PI) * 14;
            next -= dt;
            if (next <= 0) { next = 0.05; this.afterImage(); }
        });
        this.invulnerable = false;
        yield* this.sleep(0.15);
        this.wait = 0.25;
    }
    
    // ---- フェーズ移行：遠吠え ----
    *transition(index) {
        this.motion = 'howl';
        this.superArmor = true;
        this.invulnerable = true;
        yield* this.sleep(0.3, (p) => { this.scaleY = 1 - 0.08 * p; });
        this.events.push({ type: 'shake', power: 7, time: 0.8 });
        let next = 0;
        yield* this.sleep(1.2, (p, dt) => {
            this.face(new Vector2(0, 1));
            this.scaleY = 1.1; this.jitter = 1.5;
            next -= dt;
            if (next <= 0) {
                next = 0.28;
                this.addFx({ type: 'shock', follow: true, feet: true, r0: 30, r1: 260, life: 0.7, width: 7, color: '#b46bff', ring: 'corrupt', ringAlpha: 0.5 });
                this.addFx({ type: 'roar', follow: true, life: 0.45, seed: Math.random(), color: '#e2b8ff' });
            }
        });
        this.invulnerable = false;
    }
    
    // 侵蝕のもや：フェーズが進むほど濃くなる
    drawGround(ctx, cam) {
        if (this.e.isAlive()) {
            const aura = this.P.aura || 0;
            const p = this.feet().sub(cam);
            const r = this.e.size * (0.9 + aura * 0.35);
            const pulse = 0.8 + Math.sin(this.time * 4) * 0.2;
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            g.addColorStop(0, `rgba(120, 30, 170, ${(0.25 + aura * 0.15) * pulse})`);
            g.addColorStop(1, 'rgba(60, 0, 90, 0)');
            ctx.save();
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
        super.drawGround(ctx, cam);
    }
    
    drawAbove(ctx, cam) {
        if (this.e.isAlive()) {
            const aura = this.P.aura || 0;
            const n = 3 + aura * 5;
            const s = this.e.position.sub(cam);
            ctx.save();
            for (let i = 0; i < n; i++) {
                const t = (this.time * (0.8 + aura * 0.3) + i / n) % 1;
                const x = s.x + Math.sin(i * 2.7 + this.time * 0.7) * this.e.size * 0.55;
                const y = s.y + this.e.size * 0.3 - t * this.e.size * 1.3 - this.lift;
                ctx.globalAlpha = (1 - t) * (0.35 + aura * 0.2);
                ctx.fillStyle = i % 3 === 0 ? '#d58bff' : '#5a1f80';
                ctx.beginPath(); ctx.arc(x, y, (3 + aura * 1.5) * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
            }
            // フェーズ3：体のまわりに紫の稲妻
            if (aura >= 2 && Math.sin(this.time * 13) > 0.3) {
                ctx.globalAlpha = 0.8;
                ctx.strokeStyle = '#e7b5ff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                let x = s.x - this.e.size * 0.5, y = s.y - this.e.size * 0.3 - this.lift;
                ctx.moveTo(x, y);
                for (let k = 0; k < 5; k++) { x += this.e.size * 0.22; y += (Math.random() - 0.5) * 18; ctx.lineTo(x, y); }
                ctx.stroke();
            }
            ctx.restore();
        }
        super.drawAbove(ctx, cam);
    }
}

// boss_data.js の ai の名前 → クラス
const BOSS_AI_CLASSES = {
    ForestBoarAI,
    BlackWolfAI
    // MagicGolemAI：今後実装
};

window.BossPhaseManager = BossPhaseManager;
window.BossAI = BossAI;
window.BOSS_AI_CLASSES = BOSS_AI_CLASSES;
