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
        this.warnColor = BossAI.WARN_COLOR; // 攻撃範囲の予告の色（全ボス共通のはっきりした赤）
        this.airborne = false;      // true の間は宙に浮いている（狼の飛びかかり）。体当たり・体の押し出しはしない
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
    
    // 画像のコマ（pose）を毎フレーム戻す。ゴーレムは pose が体の形の値なので自分で戻す（上書き）
    clearFramePose() { this.pose = null; }
    
    // ---------- 毎フレーム ----------
    update(dt) {
        this.time += dt;
        this.motionTime += dt;
        this.updateFx(dt);
        this.lift = 0; this.scaleX = 1; this.scaleY = 1; this.jitter = 0;
        this.clearFramePose();
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
            this.applyPhaseBuff(changed);
            this.cancel();
            this.events.push({ type: 'phase', index: changed });
            this.startAction('transition', this.transition(changed));
        }
        
        if (this.action) {
            const r = this.action.next(dt);
            if (r.done) this.endAction();
        } else {
            this.wait -= dt;
            // 後ろに回りこまれた：すぐに振り向いて、待たずに攻撃する
            if (this.playerBehind()) {
                this.face(this.dirToPlayer());
                this.motion = 'turn';
                this.wait = 0;
                this.chooseAttack(true);
                return;
            }
            this.idleMove(dt);
            if (this.wait <= 0) this.chooseAttack();
        }
    }
    
    // フェーズが変わった時の強化（boss_data.js の phaseBuff。なければ全ボス共通の BossAI.PHASE_BUFF）
    // 攻撃力は元の値に倍率をかけ直す（何回呼んでも重ならない）。防御は「受けるダメージの倍率」（Enemy.takeDamage）
    applyPhaseBuff(index) {
        if (this.baseAttack === undefined) this.baseAttack = this.e.attack;
        const list = this.def.phaseBuff || BossAI.PHASE_BUFF;
        const b = list[Math.min(index, list.length - 1)];
        this.e.attack = Math.max(1, Math.round(this.baseAttack * b.attack));
        this.e.damageTakenMul = b.damageTaken;
    }
    
    // プレイヤーがボスの後ろ（向いている方向から 100度以上うしろ）の近くにいるか
    playerBehind() {
        if (!this.player || this.dist() > BossAI.TUNING.behindRange * this.R) return false;
        const n = this.dirToPlayer();
        return this.facing.x * n.x + this.facing.y * n.y < -0.17;
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
        this.wait = this.def.attackInterval * this.P.intervalMul * BossAI.TUNING.interval * (0.75 + Math.random() * 0.5);
    }
    
    cancel() {
        if (this.action) this.action.return();
        this.action = null;
        this.actionName = '';
        this.superArmor = false;
        this.invulnerable = false;
        this.airborne = false;
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
    // force = true（後ろに回られた時）：距離が合う攻撃がなくても、いちばん距離が近い攻撃を出す
    chooseAttack(force = false) {
        const d = this.dist();
        const list = [];
        let near = null, nearGap = Infinity;
        for (const [name, w] of Object.entries(this.P.attacks)) {
            const a = this.atk(name);
            if (!a || !this['act_' + name]) {
                if (!this._warned) { this._warned = true; console.warn('ボスAIに攻撃がありません:', name); }
                continue;
            }
            if (d < a.range[0] || d > a.range[1]) {
                const gap = d < a.range[0] ? a.range[0] - d : d - a.range[1];
                if (w > 0 && gap < nearGap) { nearGap = gap; near = name; }
                continue;
            }
            list.push([name, name === this.lastAttack ? w * 0.4 : w]);
        }
        if (!list.length && force && near) list.push([near, 1]);
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
        yield* this.sleep(t * this.P.recoverMul * BossAI.TUNING.recover, () => this.face(this.dirToPlayer()));
    }
    
    // 形態が変わる時の大きな声（咆哮・遠吠え・機械の咆哮）。BossBattle に知らせて、声が終わってから次の BGM を流す
    roarVoice(key) {
        if (key === 'golem_roar' && window.GolemSound) GolemSound.play('roar'); // ファイルがない時はコードで作った機械の音
        else playSE(key);
        this.events.push({ type: 'roar', key });
    }
    
    // 咆哮・遠吠えの風圧：範囲の中のプレイヤーを必ず吹き飛ばす（回避中・無敵中でも飛ばされる。ダメージはない）
    roarBlast(dist = BossAI.TUNING.roarKnock) {
        const p = this.player;
        if (!p || !p.knockback) return;
        const v = this.toPlayer();
        const d = v.length();
        if (d > BossAI.TUNING.roarRange * this.R) return;
        const dir = d > 0.01 ? v : this.facing;
        p.knockback(dir, dist * (1 - 0.4 * d / (BossAI.TUNING.roarRange * this.R)), 0.35, true);
        this.events.push({ type: 'shake', power: 6, time: 0.25 });
    }
    // 咆哮の間ずっと、近くのプレイヤーを押し返し続ける
    roarPush(dt, range = 280, power = 220) {
        if (this.player && this.player.isGuarded && this.player.isGuarded()) return; // ジャスト回避の無敵中は押されない
        const v = this.toPlayer();
        if (v.length() < range * this.R && v.length() > 0.01 && this.player.moveBy) this.player.moveBy(v.normalize().mult(power * dt));
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
    // ult：必殺技（boss_data.js の ultimate）の当たり。今の攻撃が必殺技なら自動で付く（主人公は少し飛ばされて1秒無敵になる）
    addHitbox(h) {
        const box = { age: 0, life: 0.1, used: false, ult: this.isUltimate(), ...h };
        this.hitboxes.push(box);
        return box;
    }
    
    // 今の攻撃（name を省略したら、いま出している攻撃）が、このボスの必殺技か
    isUltimate(name = this.actionName) {
        const u = this.def.ultimate;
        if (!u || !name) return false;
        return Array.isArray(u) ? u.includes(name) : u === name;
    }
    
    // この当たり判定を、主人公に当てずに「使ったこと」にするか
    // （ジャスト回避の無敵中・必殺技の後の無敵中にふれた攻撃。無敵が切れた瞬間に当たらないように）
    static skipHit(player) {
        if (player.isGuarded && player.isGuarded() && !player.isDodging) return true;
        return !!(player.isInvincible && player.isInvincible());
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
            // ジャスト回避の無敵中・必殺技の後の無敵中にふれた攻撃は、使ったことにする（無敵が切れた瞬間に当たらないように）
            if (BossAI.skipHit(player)) { h.used = true; continue; }
            // 飛ばされる時は、当たった攻撃の中心から外へ（中心にいる時はボスから外へ）
            const dealt = player.takeDamage(h.damage, d > 0.01 ? c : this.e.position, h.ult ? { ult: true } : null);
            if (dealt > 0) {
                h.used = true;
                this.events.push({ type: 'hit', power: (h.shake || 4) + (h.ult ? 3 : 0) });
                // knock：当たったらプレイヤーを外へ飛ばす（必殺技は Player.ULT_HIT の少しのノックバックだけ）
                if (h.knock && !h.ult && player.knockback) player.knockback(d > 0.01 ? v : this.facing, h.knock, 0.28, true);
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
                    // 予告の円：中が時間とともに満ちていき、攻撃が出る直前はふちが白と赤で点滅する（全ボス共通の赤。BossAI.warnLook）
                    // live：攻撃している間ずっと出す範囲（ゴーレムの腕の振り回しの回転中）。満ちていかず、濃いまま
                    const col = this.warnColor, L = BossAI.warnLook(t, this.time, f.live);
                    const rx = f.r, ry = f.r * 0.62;
                    const shape = () => { ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2); };
                    ctx.fillStyle = col;
                    ctx.globalAlpha = L.fill; shape(); ctx.fill();
                    if (!f.live) { ctx.globalAlpha = L.inner; ctx.beginPath(); ctx.ellipse(p.x, p.y, rx * t, ry * t, 0, 0, Math.PI * 2); ctx.fill(); }
                    BossAI.strokeWarn(ctx, L, shape);
                    break;
                }
                case 'laneWarn': {
                    // 突進・影の移動の予告：進む方向の帯（中が先へ満ちていく）と矢印
                    const col = this.warnColor, L = BossAI.warnLook(t, this.time);
                    const w = f.width;
                    ctx.translate(p.x, p.y + (f.dy || 0));
                    ctx.rotate(f.ang);
                    ctx.fillStyle = col;
                    ctx.globalAlpha = L.fill; ctx.fillRect(0, -w / 2, f.len, w);
                    ctx.globalAlpha = L.inner; ctx.fillRect(0, -w / 2, f.len * t, w);
                    BossAI.strokeWarn(ctx, L, () => { ctx.beginPath(); ctx.rect(0, -w / 2, f.len, w); });
                    // 矢印
                    ctx.globalAlpha = 0.7 + 0.3 * t;
                    ctx.fillStyle = L.line;
                    ctx.strokeStyle = BossAI.WARN_DARK; ctx.lineWidth = 2;
                    for (let i = 1; i <= 3; i++) {
                        const ax = f.len * (i / 4);
                        ctx.beginPath(); ctx.moveTo(ax + 12, 0); ctx.lineTo(ax - 6, -w * 0.28); ctx.lineTo(ax - 6, w * 0.28); ctx.closePath();
                        ctx.stroke(); ctx.fill();
                    }
                    break;
                }
                case 'arcWarn': {
                    // 扇の予告（牙・爪・拳）：中が外へ満ちていく
                    const col = this.warnColor, L = BossAI.warnLook(t, this.time);
                    const a0 = f.ang - f.spread / 2, a1 = f.ang + f.spread / 2;
                    const fan = (r) => { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, r, a0, a1); ctx.closePath(); };
                    ctx.fillStyle = col;
                    ctx.globalAlpha = L.fill; fan(f.r); ctx.fill();
                    ctx.globalAlpha = L.inner; fan(f.r * t); ctx.fill();
                    BossAI.strokeWarn(ctx, L, () => fan(f.r));
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
                    const s0 = Math.min(from, from + (to - from) * sweep), s1 = Math.max(from, from + (to - from) * sweep);
                    ctx.beginPath();
                    // sy：縦につぶす（体のまわりを横に回る線。ゴーレムの腕の振り回し）
                    if (f.sy) ctx.ellipse(p.x, p.y, f.r, f.r * f.sy, 0, s0, s1);
                    else ctx.arc(p.x, p.y, f.r, s0, s1);
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
                    // 攻撃直前の体の光（予告）。画像があれば体の形のまま光らせる。出る直前は白と赤で点滅する
                    const L = BossAI.warnLook(t, this.time);
                    const col = L.hot && L.line === '#ffffff' ? '#ffffff' : (f.color || this.warnColor);
                    const a = L.hot ? 0.8 : 0.3 + 0.45 * t;
                    const img = this.hasArt && this.e.getEnemyImage();
                    if (img) {
                        const size = this.e.size * (this.e._drawMul || 1.5);
                        const s = this.e.position.sub(cam);
                        ctx.globalAlpha = a;
                        ctx.drawImage(Enemy.getWhiteSilhouette(img, col), s.x - size / 2, s.y - size / 2 - this.lift, size, size);
                        break;
                    }
                    ctx.globalAlpha = a;
                    ctx.fillStyle = col;
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

// 全部のボス（イノシシ・黒蝕狼・ゴーレム）の共通の調整
// interval    ：攻撃と攻撃の間の待ち時間の倍率（小さいほど、すぐ次の攻撃へ）
// recover     ：攻撃の後の硬直の倍率（溜め＝予告の時間は変えない。見てから避けられるように）
// behindRange ：この距離（× Enemy.SCALE.range）より近くで後ろに回られたら、すぐ振り向いて攻撃
// roarRange / roarKnock：咆哮・遠吠えでプレイヤーが必ず吹き飛ばされる範囲と距離(px)
BossAI.TUNING = { interval: 0.35, recover: 0.55, behindRange: 300, roarRange: 330, roarKnock: 260 };
// 攻撃範囲の予告（円・扇・突進の帯・ゴーレムの危険床・体の光）の色。全ボス共通のはっきりした赤
// WARN_DARK：ふちの下に敷く濃い色（明るい地面でも見えるように）
// WARN_HOT ：溜めの最後のこの割合は「もうすぐ来る」（中が濃くなり、ふちが白と赤ですばやく点滅する）
BossAI.WARN_COLOR = '#ff2020';
BossAI.WARN_DARK = '#4a0000';
BossAI.WARN_HOT = 0.22;
// 予告の見た目。t：溜めの進み具合（0→1。1 になった瞬間に攻撃が出る） / live：攻撃している間ずっと出す範囲
// 戻り値：fill（範囲全体の濃さ）/ inner（満ちていく部分の濃さ）/ line（ふちの色）/ width（ふちの太さ）/ hot（もうすぐ来る）
BossAI.warnLook = function (t, time, live = false) {
    if (live) return { fill: 0.36 + 0.06 * Math.sin(time * 10), inner: 0, line: BossAI.WARN_COLOR, width: 4, hot: false };
    const hot = t >= 1 - BossAI.WARN_HOT;
    const flick = hot && Math.sin(time * 42) > 0;
    return {
        fill: (hot ? 0.42 : 0.22 + 0.12 * t) + 0.05 * Math.sin(time * 14),
        inner: hot ? 0.72 : 0.5,
        line: flick ? '#ffffff' : BossAI.WARN_COLOR,
        width: hot ? 5 : 4,
        hot
    };
};
// 予告のふち：下に濃い色の太い線、その上に赤（点滅中は白）の線。path() で形を作る
BossAI.strokeWarn = function (ctx, L, path) {
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = BossAI.WARN_DARK;
    ctx.lineWidth = L.width + 4;
    path(); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = L.line;
    ctx.lineWidth = L.width;
    path(); ctx.stroke();
};
// フェーズごとの強化（[通常, HP50%以下, HP25%以下]）。boss_data.js に phaseBuff があるボス（魔道ゴーレム）はそちらを使う
// attack：攻撃力の倍率 / damageTaken：受けるダメージの倍率（0.85 なら 15% 減る＝防御力アップ）
BossAI.PHASE_BUFF = [
    { attack: 1.0,  damageTaken: 1.0 },
    { attack: 1.0,  damageTaken: 0.85 },  // HP50%以下：少し硬くなる
    { attack: 1.25, damageTaken: 0.7 }    // HP25%以下：もっと硬く、攻撃力も上がる
];

// ==========================================================
// 巨大森イノシシ：重い動き・牙・突進（壁に当たると目を回す）・踏みつけ
// ==========================================================
class ForestBoarAI extends BossAI {
    constructor(enemy, def) {
        super(enemy, def);
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
        const spread = a.spread || 1.7;
        this.addFx({ type: 'arcWarn', warn: true, follow: true, ang, r, spread, life: windup });
        // 頭を下げて力をためる
        yield* this.sleep(windup, (p) => { this.face(dir); this.pose = 0; this.scaleX = 1 + 0.05 * p; this.scaleY = 1 - 0.07 * p; this.jitter = p > 0.6 ? 1.5 : 0; });
        // 突き上げる
        this.e.moveBy(dir.mult(24));
        this.addHitbox({ kind: 'arc', follow: true, ang, r, spread, damage: this.dmg(a.damage), life: 0.12 });
        playSE('boar_tusk');
        this.addFx({ type: 'slash', follow: true, ang, r: r * 0.85, spread: spread * 0.88, life: 0.25, reverse: k % 2 === 1 });
        // 前足でふんばった所に土煙
        const f = this.feet().add(dir.mult(this.e.size * 0.35));
        this.fxImg('dust_cloud', { x: f.x, y: f.y - 6, w: this.e.size * 0.9, s0: 0.5, s1: 1.1, life: 0.45, hold: 0.3, alpha: 0.8 });
        yield* this.sleep(0.2, (p) => { this.face(dir); this.pose = p < 0.45 ? 1 : 2; this.scaleY = 1.04; });
    }
    
    *act_tusk(a) {
        // hits 回まで続けて突き上げる（2回目からは溜めが windup2。なければ windup の 0.6 倍）
        for (let i = 0; i < (a.hits || 1); i++) {
            yield* this.tuskStrike(a, i === 0 ? a.windup : (a.windup2 || a.windup * 0.6), i);
            yield* this.sleep(0.05);
        }
        yield* this.recover(a.recover);
    }
    
    // フェーズ3：牙の連続攻撃
    *act_tuskCombo(a) {
        for (let i = 0; i < a.hits; i++) {
            yield* this.tuskStrike(a, i === 0 ? a.windup : (a.windup2 || a.windup * 0.6), i);
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
        // 鼻を鳴らして地面をかく音（溜めの間だけ）
        playSE('boar_snort', { dur: Math.max(0.4, prepare) });
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
        playSE('boar_charge');
        const body = this.addHitbox({ kind: 'circle', follow: true, r: this.e.size * (a.body || 0.55), damage: this.dmg(a.damage), life: a.duration + 0.1, shake: 7 });
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
        playSE('boar_crash');
        this.events.push({ type: 'shake', power: 9, time: 0.35 });
        this.addFx({ type: 'shock', follow: true, fwd: this.e.size * 0.5, ang: Math.atan2(dir.y, dir.x), r0: 10, r1: 80, life: 0.35, width: 8 });
        this.dust(this.e.position.add(dir.mult(this.e.size * 0.5)), 8);
        // 壁にぶつかった所：岩がくだけて土煙
        const hit = this.e.position.add(dir.mult(this.e.size * 0.55));
        this.fxImg('rock_burst', { ground: false, x: hit.x, y: hit.y, w: this.e.size * 1.0, s0: 0.5, s1: 1.15, life: 0.55, hold: 0.45 });
        this.fxImg('dust_cloud', { x: hit.x, y: hit.y + this.e.size * 0.3, w: this.e.size * 1.4, s0: 0.6, s1: 1.3, life: 0.8, hold: 0.3, alpha: 0.85 });
        const stun = this.phase.index === 2 ? 1.4 : 1.9;
        this.e.crashTimer = stun;
        playSE('boss_dizzy', { dur: stun }); // 目を回している間
        yield* this.sleep(0.2, (p) => { this.e.velocity = dir.mult(-160 * this.SP * (1 - p)); }); // 跳ね返る
        yield* this.sleep(stun, (p) => { this.scaleY = 0.96 + Math.sin(p * 30) * 0.02; });
    }
    
    // ---- 踏みつけ（地面を踏み鳴らす範囲攻撃） ----
    *act_stomp(a) {
        this.motion = 'stomp';
        this.superArmor = true;
        for (let w = 0; w < a.waves; w++) {
            const windup = w === 0 ? a.windup : (a.windup2 || 0.5);
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
            playSE('boar_stomp');
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
        this.roarVoice('boar_roar');
        this.roarBlast(); // 吠えた瞬間の風圧で、必ず吹き飛ばされる
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
            // 咆哮の風圧で、近くのプレイヤーを押し返し続ける（ダメージなし）
            this.roarPush(dt);
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
            // chain：2回目からの溜めの倍率 / follow：噛みついた後の動きの時間の倍率（boss_data.js）
            const windup = i === 0 ? a.windup : a.windup * (a.chain || 0.75);
            const fo = a.follow || 1;
            this.addFx({ type: 'flash', warn: true, follow: true, life: windup });
            yield* this.sleep(windup, (p) => { this.face(dir); this.pose = 0; this.scaleY = 1 - 0.1 * p; this.scaleX = 1 + 0.05 * p; });
            this.addHitbox({ kind: 'circle', follow: true, ang, fwd: this.e.size * 0.7, r: a.radius || 40 * this.R, damage: this.dmg(a.damage), life: 0.14 });
            playSE('wolf_bite');
            // かみついた所に紫の牙（画像がなければ白い線）
            if (!this.fxImg('bite_fangs', { ground: false, follow: true, ang, fwd: this.e.size * 0.85, dy: -this.e.size * 0.15, w: 50 * this.R, s0: 1.35, s1: 0.9, life: 0.26, hold: 0.45 })) {
                this.addFx({ type: 'slash', follow: true, ang, fwd: this.e.size * 0.55, r: 22 * this.R, spread: 2.4, life: 0.2 });
            }
            yield* this.sleep(0.14 * fo, () => { this.face(dir); this.pose = 1; this.e.velocity = dir.mult(380 / fo * this.SP); });
            yield* this.sleep(0.08 * fo, () => { this.pose = 2; });
        }
        yield* this.recover(a.recover * 0.6);
        yield* this.backOff(0.25);
    }
    *act_doubleBite(a) { yield* this.act_bite(a); }
    
    // ---- 爪攻撃（フェーズ3は3連続） ----
    *act_claw(a) {
        yield* this.approach(90 * this.R);
        for (let i = 0; i < a.hits; i++) {
            this.motion = 'claw';
            const dir = this.dirToPlayer();
            const ang = Math.atan2(dir.y, dir.x) + (i % 2 ? 0.25 : -0.25);
            const windup = i === 0 ? a.windup : a.windup * (a.chain || 0.6);
            const fo = a.follow || 1;
            const spread = a.spread || 1.9;
            this.addFx({ type: 'arcWarn', warn: true, follow: true, ang, r: a.reach, spread, life: windup });
            yield* this.sleep(windup, (p) => { this.face(dir); this.pose = 0; this.scaleX = 1 - 0.06 * p; this.jitter = p > 0.5 ? 1 : 0; });
            this.e.moveBy(dir.mult(18));
            this.addHitbox({ kind: 'arc', follow: true, ang, r: a.reach, spread, damage: this.dmg(a.damage), life: 0.12 });
            playSE('wolf_claw');
            this.addFx({ type: 'slash', follow: true, ang, r: a.reach * 0.8, spread: spread * 0.95, life: 0.24, color: '#e9c6ff', reverse: i % 2 === 1 });
            // 爪の跡（3本の紫の光）。連続攻撃は交互に向きを変える
            this.fxImg('claw_slash', { ground: false, follow: true, ang, fwd: a.reach * 0.55, dy: -this.e.size * 0.2, w: a.reach * 0.95, s0: 0.8, s1: 1.1,
                // 画像の爪あとは右上がり（約60度）。攻撃の向きと直角になるように回す
                rot: ang - 0.52 + (i % 2 ? 0.35 : -0.35), life: 0.3, hold: 0.4, add: true });
            yield* this.sleep(0.12 * fo, (p) => { this.face(dir); this.pose = p < 0.5 ? 1 : 2; });
        }
        yield* this.recover(a.recover * 0.6);
        yield* this.backOff(0.25);
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
        // 宙に浮いている間は、下にプレイヤーがいても当たらない（体当たり・体の押し出しなし）。当たるのは着地の円だけ
        this.airborne = true;
        const vel = target.sub(start).mult(1 / time);
        yield* this.sleep(time, (p) => { this.face(vel); this.pose = Math.min(2, Math.floor(p * 3)); this.e.velocity = vel; this.lift = Math.sin(p * Math.PI) * 48; this.scaleY = 1.06; });
        this.airborne = false;
        this.superArmor = false;
        // 着地
        const at = this.feet();
        this.addHitbox({ kind: 'circle', x: at.x, y: at.y, r: a.radius, damage: this.dmg(a.damage), life: 0.12, shake: 6 });
        playSE('wolf_leap');
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
        this.addFx({ type: 'laneWarn', warn: true, follow: true, ang, len: v.length(), width: 26, dy: this.e.size * 0.3, life: a.prepare });
        this.motion = 'leapPrepare'; // 身を低くしてから走り抜ける
        yield* this.sleep(a.prepare, (p) => { this.face(v); this.pose = p < 0.5 ? 1 : 2; this.scaleY = 1 - 0.1 * p; this.jitter = 1.5; });
        this.motion = 'shadowDash';
        this.invulnerable = true;
        playSE('wolf_dash');
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
        playSE('wolf_shot');
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
        this.addFx({ type: 'circleWarn', warn: true, x: at.x, y: at.y, r: a.maxRadius, life: a.windup });
        // 絵：身を低くして力をため（leapPrepare）、放つ瞬間に吠える（howl）
        this.motion = 'leapPrepare';
        yield* this.sleep(a.windup, (p) => { this.face(this.dirToPlayer()); this.pose = Math.min(2, Math.floor(p * 3)); this.scaleY = 1 - 0.1 * p; this.jitter = p * 2.5; });
        this.motion = 'howl';
        this.addHitbox({ kind: 'ring', x: at.x, y: at.y, r0: 20, r1: a.maxRadius, band: a.band, damage: this.dmg(a.damage), life: a.time, shake: 6, knock: 140 });
        playSE('wolf_wave');
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
        playSE('wolf_dash');
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
        this.roarVoice('wolf_howl');
        this.roarBlast(); // 遠吠えの風圧で、必ず吹き飛ばされる
        let next = 0;
        yield* this.sleep(1.2, (p, dt) => {
            this.face(new Vector2(0, 1));
            this.scaleY = 1.1; this.jitter = 1.5;
            this.roarPush(dt);
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
