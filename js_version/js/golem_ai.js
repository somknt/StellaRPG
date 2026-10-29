// 魔道ゴーレム（古代星紋遺跡の防衛装置。バトルモード用の暫定設定）
//
// - MagicGolemAI：ボスAI（boss_ai.js の BossAI を使う）。攻撃は *act_<名前> に書き、boss_data.js の phases[].attacks で使う
//     フェーズ1：拳・地面叩きつけ（攻撃後に大きな隙）・腕の振り回し（回りながら近づく。後で目を回す）・衝撃波
//     フェーズ2：＋連続拳・星力弾・範囲衝撃波・危険床・防御
//     フェーズ3：＋3連続拳・魔法陣砲撃（石柱と連動）・広範囲衝撃波・連続危険床
// - ステージ（ruins_map.js の RuinsMap）と連動：フェーズで魔法陣・石柱・星晶石の光り方が変わる。攻撃の予兆で魔法陣が光る
// - 見た目：画像がない間は Enemy.drawGolem（下）でコードで描く仮の姿。
//   画像を置けば assets/enemies/magic_golem/<モーション>_<向き>_<1〜3>.png が使われる（Enemy.getEnemyImage）
//   モーション名：idle / activate / walk / turn / punch / armSwing / slam / stomp / magicCharge / magicShot / shockwave /
//                 shield / phaseChange / hit / stun / breakdown / death

// ---------- 機械の音 ----------
// assets/sounds/se/golem_boot・golem_roar・golem_thud があればそのファイルを鳴らす。ない間は Web Audio で作った音
const GolemSound = {
    ac: null,
    context() {
        // 効果音と同じ Web Audio を使う（音量の設定・一時停止がそのまま効く）
        const sm = window.soundManager;
        if (sm && sm.ac) return sm.ac;
        if (!this.ac) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            try { this.ac = new AC(); } catch (e) { return null; }
        }
        if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
        return this.ac;
    },
    // kind：'boot'（起動） / 'roar'（フェーズ移行の咆哮に当たる機械音） / 'thud'（叩きつけ）
    play(kind) {
        const sm = window.soundManager;
        if (sm && sm.has('golem_' + kind)) { sm.play('golem_' + kind); return; }
        if (sm && sm.muted) return;
        const ac = this.context();
        if (!ac || ac.state !== 'running') return;
        const toSfx = !!(sm && sm.sfxGain && sm.ac === ac); // 効果音の音量につなぐ
        const vol = (toSfx ? 1 : (sm ? sm.sfxVolume : 0.5)) * 0.45;
        const now = ac.currentTime;
        const len = kind === 'roar' ? 1.5 : kind === 'boot' ? 1.2 : 0.35;
        const out = ac.createGain();
        out.gain.setValueAtTime(0.0001, now);
        out.gain.exponentialRampToValueAtTime(vol, now + 0.05);
        out.gain.exponentialRampToValueAtTime(0.0001, now + len);
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(kind === 'thud' ? 260 : 700, now);
        lp.connect(out); out.connect(toSfx ? sm.sfxGain : ac.destination);
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        const f0 = kind === 'boot' ? 40 : kind === 'roar' ? 70 : 90;
        const f1 = kind === 'boot' ? 120 : kind === 'roar' ? 34 : 30;
        o.frequency.setValueAtTime(f0, now);
        o.frequency.exponentialRampToValueAtTime(f1, now + len);
        // うなり（機械のきしみ）
        const lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.frequency.value = kind === 'roar' ? 11 : 6;
        lg.gain.value = kind === 'thud' ? 4 : 14;
        lfo.connect(lg); lg.connect(o.frequency);
        o.connect(lp);
        o.start(now); lfo.start(now);
        o.stop(now + len + 0.05); lfo.stop(now + len + 0.05);
    }
};

class MagicGolemAI extends BossAI {
    constructor(enemy, def) {
        super(enemy, def);
        this.introMode = null;   // 'activate'：開始の演出で、その場で起動する
        this.introT = 0;
        this.stepTimer = 0;
        this.resetPose();
    }
    
    // 見た目のポーズ（毎フレーム 0 に戻し、攻撃側で決める。Enemy.drawGolem が使う）
    resetPose() {
        // spin：両腕を横にまっすぐ広げる（腕の振り回し）
        this.pose = { armL: 0, armR: 0, armsUp: 0, slam: 0, shield: 0, charge: 0, stomp: 0, kneel: 0, dormant: 0, spin: 0,
            core: 0.45 + (this.phase ? this.phase.index : 0) * 0.2 };
    }
    
    get map() { return this.e.map; }
    get stage() { return this.map && this.map.setStagePhase ? this.map : null; }
    // pose は update の最初に resetPose で戻している（BossAI に null にさせない）
    clearFramePose() {}
    
    update(dt) {
        this.resetPose();
        // 開始の演出：眠っている姿 → 魔導核が光って起き上がる
        if (!this.active && this.introMode === 'activate') {
            this.introT += dt;
            const t = this.introT;
            const k = Math.max(0, Math.min(1, (t - 0.6) / 1.4));
            this.pose.dormant = 1 - (1 - (1 - k) * (1 - k));
            this.pose.core = 0.08 + k * 0.92 * (k < 1 ? 0.75 + Math.random() * 0.25 : 1);
            if (!this.booted && t >= 0.6) {
                this.booted = true;
                GolemSound.play('boot');
                this.events.push({ type: 'shake', power: 4, time: 0.8 });
                if (this.stage) this.stage.pulseCircle(1);
            }
            if (!this.introRoared && t >= 2.05) {
                this.introRoared = true;
                this.events.push({ type: 'shake', power: 7, time: 0.4 });
                this.addFx({ type: 'shock', follow: true, feet: true, r0: 30, r1: 240, life: 0.6, width: 6, color: '#bdf3ff' });
            }
        }
        super.update(dt);
        if (!this.active && this.introMode === 'activate' && this.e.isAlive()) {
            this.motion = this.pose.dormant > 0.02 ? 'activate' : 'idle';
        }
    }
    
    // 重い足取りで、ゆっくり向きを変えながら近づく
    idleMove(dt) {
        const want = this.dirToPlayer();
        const cur = Math.atan2(this.facing.y, this.facing.x);
        let diff = Math.atan2(want.y, want.x) - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = 1.7 * this.P.speedMul * dt;
        const a = cur + Math.max(-turn, Math.min(turn, diff));
        this.facing = new Vector2(Math.cos(a), Math.sin(a));
        this.e.faceTowards(this.facing);
        this.lockFacing = true;
        if (this.dist() < 105 * this.R) { this.motion = 'idle'; return; }
        let sp = this.speed;
        if (Math.abs(diff) > 1.0) { sp *= 0.35; this.motion = 'turn'; }
        else this.motion = 'walk';
        this.e.velocity = this.facing.mult(sp);
        // 足音：砂ぼこりと小さな揺れ
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
            this.stepTimer = 0.62 / this.P.speedMul;
            playSE('golem_step');
            this.dust(this.feet(), 3, 'rgba(190, 180, 210, 0.6)');
            this.events.push({ type: 'shake', power: 1.2, time: 0.12 });
        }
    }
    
    // 拳が届かない時は、半分くらいの確率でもう少し歩いて近づく（遠くから叩きつけばかりにならないように）
    chooseAttack(force = false) {
        const punch = this.atk('punch');
        if (!force && punch && this.dist() > punch.range[1] && Math.random() < 0.5) { this.wait = 0.6; return; }
        super.chooseAttack(force);
    }
    
    // ---------- 当たり判定（地面の楕円・楕円の輪） ----------
    // 'ellipse'：地面のだ円（r が横、縦は 0.62 倍）/ 'ering'：地面に広がる楕円の輪。プレイヤーの足元で判定する
    checkHits(player) {
        const pr = 18;
        for (const h of this.hitboxes) {
            if (h.kind !== 'ellipse' && h.kind !== 'ering') continue;
            if (h.used || h.age < (h.delay || 0)) continue;
            const c = this.hitboxCenter(h);
            const dx = player.position.x - c.x, dy = (player.position.y + 28 - c.y) / 0.62;
            const d = Math.hypot(dx, dy);
            const hit = h.kind === 'ellipse' ? d <= h.r + pr : Math.abs(d - this.ringRadius(h)) <= h.band / 2 + pr;
            if (!hit) continue;
            // ジャスト回避の無敵中・必殺技の後の無敵中にふれた攻撃は、使ったことにする（無敵が切れた瞬間に当たらないように）
            if (BossAI.skipHit(player)) { h.used = true; continue; }
            // 飛ばされる時は、当たった攻撃の中心から外へ（中心にいる時はゴーレムから外へ）。必殺技（魔法陣砲撃）は1秒無敵
            const dealt = player.takeDamage(h.damage, d > 0.5 ? new Vector2(c.x, c.y - 28) : this.e.position, h.ult ? { ult: true } : null);
            if (dealt > 0) { h.used = true; this.events.push({ type: 'hit', power: (h.shake || 5) + (h.ult ? 3 : 0) }); }
        }
        super.checkHits(player);
    }
    
    // 時間が来た危険床・砲撃：光って揺れる
    updateFx(dt) {
        super.updateFx(dt);
        for (const f of this.fx) {
            if (f.trigger !== undefined && !f.fired && f.age >= f.trigger) {
                f.fired = true;
                this.events.push({ type: 'shake', power: f.big ? 8 : 4, time: 0.25 });
                // 危険床がはじける音。砲撃の光の柱（big）は golem_beam（どちらもなければ大きい方だけ機械の音）
                if (f.big) { if (!playSE('golem_beam')) GolemSound.play('thud'); }
                else playSE('golem_rune');
            }
        }
    }
    
    // ---------- 攻撃 ----------
    // 拳（hits 回まで続けて殴る。左右の拳を交互に）
    *punches(a, hits) {
        for (let i = 0; i < hits; i++) {
            this.motion = 'punch';
            const dir = this.dirToPlayer();
            this.face(dir);
            const ang = Math.atan2(dir.y, dir.x);
            const arm = i % 2 === 0 ? 'armR' : 'armL';
            const windup = i === 0 ? a.windup : a.windup * 0.7;
            const r = a.reach + this.e.size * 0.3;
            this.addFx({ type: 'arcWarn', warn: true, follow: true, ang, r, spread: 1.15, life: windup });
            // 拳を引いて力をためる
            yield* this.sleep(windup, (p) => {
                this.face(dir);
                this.pose[arm] = -0.6 * p;
                this.pose.core += 0.2 * p;
                this.jitter = p > 0.65 ? 1.2 : 0;
            });
            this.e.moveBy(dir.mult(22));
            this.addHitbox({ kind: 'arc', follow: true, ang, r, spread: 1.15, damage: this.dmg(a.damage), life: 0.12, shake: 6 });
            playSE('golem_punch');
            this.addFx({ type: 'slash', follow: true, ang, r: r * 0.82, spread: 1.0, life: 0.22, color: '#c8f4ff', reverse: i % 2 === 1 });
            this.events.push({ type: 'shake', power: 3, time: 0.15 });
            yield* this.sleep(0.2, () => { this.face(dir); this.pose[arm] = 1; });
            yield* this.sleep(0.08, () => { this.pose[arm] = 0.6; });
        }
        yield* this.recover(a.recover);
    }
    *act_punch(a) { yield* this.punches(a, a.hits || 1); }
    *act_punchCombo(a) { yield* this.punches(a, a.hits || 2); }
    *act_punchTriple(a) { yield* this.punches(a, a.hits || 3); }
    
    // 腕の振り回し：両腕を横に広げて上半身をひねる（予告：足元の丸）→ 体ごと回りながら腕を振り回し、
    // まわりをなぎ払いながらプレイヤーへ近づく（1回転ごとに1回当たる）→ 目が回ってふらつく（攻撃のチャンス）
    *act_armSwing(a) {
        this.motion = 'armSwing';
        this.superArmor = true;
        const spins = (a.spins || 2) + (this.phase.index >= 2 ? 1 : 0);
        const time = a.time * spins / (a.spins || 2);          // 1回転にかかる時間は同じ
        const ang0 = Math.atan2(this.facing.y, this.facing.x);
        this.addFx({ type: 'circleWarn', warn: true, follow: true, feet: true, r: a.radius, life: a.windup });
        // 両腕を広げ、回る向きと逆に上半身をひねって力をためる
        yield* this.sleep(a.windup, (p) => {
            const tw = ang0 - 0.9 * (1 - (1 - p) * (1 - p));
            this.face(new Vector2(Math.cos(tw), Math.sin(tw)));
            this.pose.spin = Math.min(1, p * 1.6);
            this.pose.core += 0.3 * p;
            this.jitter = p > 0.6 ? 1.5 : 0;
        });
        // 回転：まわり（足元の楕円）に当たり判定。1回転ごとに出し直す
        this.addFx({ type: 'circleWarn', warn: true, live: true, follow: true, feet: true, r: a.radius, life: time }); // 回っている間も範囲を見せる（濃いまま）
        const turn = time / spins;
        let box = null, done = -1, nextSlash = 0;
        yield* this.sleep(time, (p, dt) => {
            const k = Math.floor(p * spins - 1e-6);
            if (k !== done) {
                done = k;
                if (box) box.life = 0;
                box = this.addHitbox({ kind: 'ellipse', follow: true, feet: true, r: a.radius * 0.95, damage: this.dmg(a.damage), life: turn, shake: 7 });
                if (!playSE('golem_swing')) GolemSound.play('thud');
            }
            const ang = ang0 - 0.9 + Math.PI * 2 * spins * p;
            this.face(new Vector2(Math.cos(ang), Math.sin(ang)));
            this.pose.spin = 1;
            // 回りながらゆっくりプレイヤーへ近づく
            const to = this.toPlayer();
            if (to.length() > 30) this.e.velocity = to.normalize().mult(this.speed * 0.9);
            // 腕の通った後の光の線（腕の高さで、体のまわりを横に回る）と、足元の砂ぼこり
            nextSlash -= dt;
            if (nextSlash <= 0) {
                nextSlash = 0.05;
                const arm = new Vector2(this.e.position.x, this.e.position.y - this.e.size * 0.15);
                this.addFx({ type: 'slash', x: arm.x, y: arm.y, ang, r: this.e.size * 0.95, sy: 0.42, spread: 1.3, life: 0.2, color: '#c8f4ff' });
                if (Math.random() < 0.5) this.dust(this.feet(), 1, 'rgba(190, 180, 210, 0.6)');
            }
        });
        if (box) box.life = 0;
        this.superArmor = false;
        // 目が回ってふらつく
        playSE('boss_dizzy', { dur: Math.max(0.6, a.dizzy || 0.8) + 0.3 });
        yield* this.sleep(a.dizzy || 0.8, (p) => {
            this.face(this.facing);
            this.pose.spin = Math.max(0, 1 - p * 3);
            this.pose.core = 0.25 + Math.random() * 0.2;
            this.jitter = 2 * (1 - p);
        });
        yield* this.recover(a.recover);
    }
    
    // 地面の叩きつけ：前方の地面に予告 → 両腕で叩きつける → 腕が抜けるまで大きな隙
    *act_slam(a) {
        this.motion = 'slam';
        this.superArmor = true;
        const dir = this.dirToPlayer();
        this.face(dir);
        const at = this.feet().add(dir.mult(this.e.size * 0.4 + a.reach));
        this.addFx({ type: 'circleWarn', warn: true, x: at.x, y: at.y, r: a.radius, life: a.windup });
        yield* this.sleep(a.windup, (p) => {
            this.face(dir);
            this.pose.armsUp = 1 - (1 - p) * (1 - p);
            this.scaleY = 1 + 0.05 * p;
            this.jitter = p > 0.7 ? 1.5 : 0;
        });
        this.addHitbox({ kind: 'ellipse', x: at.x, y: at.y, r: a.radius * 0.95, damage: this.dmg(a.damage), life: 0.1, shake: 9 });
        this.addFx({ type: 'shock', x: at.x, y: at.y, r0: 20, r1: a.radius * 1.15, life: 0.45, width: 12, color: '#c8f4ff' });
        this.addFx({ type: 'crack', x: at.x, y: at.y, r: a.radius * 0.75, life: 1.6, seed: Math.random() * 6, color: 'rgba(40, 30, 60, 1)' });
        this.dust(at, 12, 'rgba(190, 180, 210, 0.7)');
        this.events.push({ type: 'shake', power: 8, time: 0.35 });
        GolemSound.play('thud');
        yield* this.sleep(0.2, () => { this.face(dir); this.pose.slam = 1; this.scaleY = 0.95; });
        this.superArmor = false;
        // 腕が地面にめりこんで動けない（攻撃のチャンス）
        yield* this.sleep(a.stuck || 0.6, () => { this.face(dir); this.pose.slam = 1; });
        yield* this.recover(a.recover);
    }
    
    // 範囲衝撃波：片足を上げて踏みつけ、自分のまわりに広がる輪（waves 回）
    *act_shockwave(a) {
        this.motion = 'stomp';
        this.superArmor = true;
        for (let w = 0; w < (a.waves || 1); w++) {
            const windup = w === 0 ? a.windup : a.windup * 0.7;
            const at = this.feet();
            this.addFx({ type: 'circleWarn', warn: true, x: at.x, y: at.y, r: a.maxRadius, life: windup });
            if (this.stage) this.stage.pulseCircle(0.6);
            yield* this.sleep(windup, (p) => { this.face(this.dirToPlayer()); this.pose.stomp = p; this.pose.core += 0.3 * p; this.jitter = p > 0.6 ? 1.5 : 0; });
            this.motion = 'shockwave';
            this.addHitbox({ kind: 'ering', x: at.x, y: at.y, r0: 30, r1: a.maxRadius, band: a.band, damage: this.dmg(a.damage), life: a.time, shake: 7 });
            this.addFx({ type: 'shock', x: at.x, y: at.y, r0: 30, r1: a.maxRadius, life: a.time, width: a.band, color: 'rgba(110, 210, 255, 0.85)' });
            this.addFx({ type: 'shock', x: at.x, y: at.y, r0: 16, r1: a.maxRadius * 0.82, life: a.time * 1.1, width: 6, color: '#e6fbff' });
            this.dust(at, 8, 'rgba(190, 180, 210, 0.7)');
            this.events.push({ type: 'shake', power: 7, time: 0.35 });
            GolemSound.play('thud');
            yield* this.sleep(0.35, () => { this.scaleY = 0.95; });
            this.motion = 'stomp';
        }
        this.superArmor = false;
        yield* this.recover(a.recover);
    }
    *act_bigShockwave(a) { yield* this.act_shockwave(a); }
    
    // 星力弾：胸の魔導核に力をためて、扇形に弾を撃つ。フェーズ3は光っている石柱からも撃つ
    *act_magicShot(a) {
        this.motion = 'magicCharge';
        const p3 = this.phase.index >= 2;
        const pillars = p3 && this.stage ? this.stage.getRunePillars() : [];
        this.addFx({ type: 'coreCharge', warn: true, follow: true, life: a.windup });
        playSE('golem_charge', { dur: a.windup + 0.1 }); // 胸の魔導核に力がたまる（溜めの間だけ）
        if (pillars.length) {
            this.stage.flashPillars(1);
            for (const pl of pillars) this.addFx({ type: 'pillarCharge', warn: true, x: pl.position.x, y: pl.position.y, life: a.windup + 0.2 });
        }
        yield* this.sleep(a.windup, (p) => { this.face(this.dirToPlayer()); this.pose.charge = p; this.pose.core = 0.6 + 0.4 * p; this.jitter = p > 0.7 ? 1 : 0; });
        this.motion = 'magicShot';
        const volleys = p3 ? 2 : 1;
        const shot = (typeof Enemy !== 'undefined' && Enemy.SCALE.shot) || 1;
        for (let v = 0; v < volleys; v++) {
            const dir = this.dirToPlayer();
            const ang = Math.atan2(dir.y, dir.x) + (v % 2 ? a.spread / 2 : 0);
            const count = a.count + (p3 ? 2 : 0) - v;
            const from = this.corePos().add(dir.mult(this.e.size * 0.25));
            for (let i = 0; i < count; i++) {
                const k = count === 1 ? 0 : i / (count - 1) - 0.5;
                const aa = ang + k * a.spread * (count - 1);
                this.pendingProjectiles.push({ position: from.clone(), velocity: new Vector2(Math.cos(aa), Math.sin(aa)).mult(a.speed),
                    damage: this.dmg(a.damage), radius: 11 * shot, life: 4.0, age: 0, kind: 'star' });
            }
            if (v === 0) {
                for (const pl of pillars) {
                    const d = this.player.position.sub(pl.position);
                    if (d.length() < 1) continue;
                    this.pendingProjectiles.push({ position: pl.position.clone(), velocity: d.normalize().mult(a.speed * 0.85),
                        damage: this.dmg(a.damage), radius: 11 * shot, life: 4.5, age: 0, kind: 'star' });
                }
            }
            this.addFx({ type: 'shock', x: from.x, y: from.y, r0: 6, r1: 50, life: 0.25, width: 5, color: '#c8f4ff' });
            playSE('golem_shot');
            yield* this.sleep(0.4, () => { this.pose.charge = 1; });
        }
        yield* this.recover(a.recover);
    }
    
    // 危険床：床に青白い魔法陣が出る → 約1秒の予備動作 → 強く光ってダメージ（waves 回続ける）
    *act_hazardFloor(a) {
        this.motion = 'magicCharge';
        if (this.stage) this.stage.pulseCircle(1);
        playSE('golem_charge', { dur: 0.6 });
        yield* this.sleep(0.45, (p) => { this.face(this.dirToPlayer()); this.pose.armsUp = p * 0.6; this.pose.charge = p; });
        const waves = a.waves || 1;
        for (let w = 0; w < waves; w++) {
            for (const c of this.hazardSpots(a.count, a.radius)) this.runeFloor(c, a.radius, a.windup, this.dmg(a.damage));
            if (this.stage) this.stage.pulseCircle(0.8);
            yield* this.sleep(w < waves - 1 ? a.between : a.windup + 0.15, () => { this.face(this.dirToPlayer()); this.pose.armsUp = 0.6; this.pose.charge = 1; });
        }
        yield* this.recover(a.recover);
    }
    *act_hazardBarrage(a) { yield* this.act_hazardFloor(a); }
    
    // 危険床を1つ置く（予告の見た目と、時間が来たら出る当たり判定）
    runeFloor(c, r, windup, damage, big = false) {
        this.addFx({ type: 'runeFloor', warn: true, x: c.x, y: c.y, r, trigger: windup, life: windup + 0.55, big });
        this.addHitbox({ kind: 'ellipse', x: c.x, y: c.y, r: r * 0.92, damage, delay: windup, life: windup + 0.14, shake: big ? 9 : 6 });
    }
    
    // 危険床の場所：1つ目はプレイヤーの足元、残りはそのまわり（重ならないように離し、すき間＝安全な場所を残す）
    hazardSpots(count, r) {
        const pl = this.player;
        const feet = new Vector2(pl.position.x, pl.position.y + 28);
        const spots = [feet];
        const ok = (p) => !this.map || !this.map.inWalkArea || this.map.inWalkArea(p.x, p.y);
        for (let tries = 0; spots.length < count && tries < 60; tries++) {
            const ang = Math.random() * Math.PI * 2, d = r * (1.9 + Math.random() * 1.6);
            const p = new Vector2(feet.x + Math.cos(ang) * d, feet.y + Math.sin(ang) * d * 0.7);
            if (!ok(p)) continue;
            if (spots.some(s => Math.hypot(s.x - p.x, (s.y - p.y) / 0.62) < r * 2.1)) continue;
            spots.push(p);
        }
        return spots;
    }
    
    // 魔法陣砲撃：プレイヤーのいる場所に大きな魔法陣が次々に出て、光の柱が落ちる → 撃ち終わると機能停止（大きな隙）
    *act_magicCannon(a) {
        this.motion = 'magicCharge';
        this.superArmor = true;
        if (this.stage) { this.stage.flashPillars(1); this.stage.pulseCircle(1); }
        playSE('golem_charge', { dur: 0.65 });
        yield* this.sleep(0.5, (p) => { this.face(this.dirToPlayer()); this.pose.charge = p; this.pose.armsUp = p; this.pose.core = 1; this.jitter = 1; });
        this.motion = 'magicShot';
        for (let i = 0; i < a.count; i++) {
            const pl = this.player.position;
            this.runeFloor(new Vector2(pl.x, pl.y + 28), a.radius, a.windup, this.dmg(a.damage), true);
            if (this.stage) this.stage.flashPillars(0.8);
            yield* this.sleep(a.between, () => { this.face(this.dirToPlayer()); this.pose.armsUp = 1; this.pose.core = 1; });
        }
        yield* this.sleep(Math.max(0, a.windup - a.between) + 0.2, () => { this.pose.armsUp = 1; this.pose.core = 1; });
        this.superArmor = false;
        yield* this.breakdown(a.breakdown || 1.6);
        yield* this.recover(a.recover);
    }
    
    // 機能停止（力を使いすぎて片ひざをつく）。この間は攻撃のチャンス
    *breakdown(t) {
        this.motion = 'breakdown';
        yield* this.sleep(t, (p, dt) => {
            const down = Math.min(1, p * 6) * (p > 0.85 ? (1 - p) / 0.15 : 1);
            this.pose.kneel = down;
            this.pose.core = 0.12 + Math.random() * 0.2;
            if (Math.random() < dt * 8) this.addFx({ type: 'spark', x: this.e.position.x + (Math.random() - 0.5) * this.e.size * 0.8, y: this.e.position.y - Math.random() * this.e.size * 0.5, life: 0.4 });
        });
    }
    
    // 防御：腕を組んで星の盾を張る（ダメージを受けない）→ 盾を解く衝撃で押し返す
    *act_shield(a) {
        this.motion = 'shield';
        this.invulnerable = true;
        this.addFx({ type: 'barrier', follow: true, life: a.time + 0.45 });
        playSE('golem_shield');
        yield* this.sleep(a.time, (p) => { this.face(this.dirToPlayer()); this.pose.shield = Math.min(1, p * 5); });
        const at = this.feet();
        this.addFx({ type: 'circleWarn', warn: true, x: at.x, y: at.y, r: a.maxRadius, life: 0.45 });
        yield* this.sleep(0.45, () => { this.pose.shield = 1; this.jitter = 1.5; });
        this.invulnerable = false;
        this.addHitbox({ kind: 'ering', x: at.x, y: at.y, r0: 20, r1: a.maxRadius, band: a.band, damage: this.dmg(a.damage), life: 0.45, shake: 6 });
        this.addFx({ type: 'shock', x: at.x, y: at.y, r0: 20, r1: a.maxRadius, life: 0.45, width: a.band, color: 'rgba(150, 225, 255, 0.85)' });
        this.events.push({ type: 'shake', power: 5, time: 0.25 });
        yield* this.sleep(0.3);
        yield* this.recover(a.recover);
    }
    
    // ---------- フェーズ移行：一時停止 → 魔導核が強く光る → 機械の咆哮 → ステージが起動 ----------
    *transition(index) {
        this.motion = 'phaseChange';
        this.superArmor = true;
        this.invulnerable = true;
        yield* this.sleep(0.55, (p) => { this.face(this.dirToPlayer()); this.pose.core = 0.6 + 0.4 * p; this.pose.armsUp = p * 0.3; this.jitter = p; });
        this.roarVoice('golem_roar');
        this.events.push({ type: 'shake', power: 10, time: 1.0 });
        this.roarBlast(); // 咆哮の衝撃で、必ず吹き飛ばされる
        if (this.stage) { this.stage.setStagePhase(index + 1); this.stage.pulseCircle(1); this.stage.flashPillars(1); }
        let next = 0;
        yield* this.sleep(1.4, (p, dt) => {
            this.face(this.dirToPlayer());
            this.pose.core = index >= 2 ? (Math.sin(this.time * 40) > 0 ? 1 : 0.35) : 1;
            this.pose.armsUp = 0.75;
            this.scaleY = 1.04; this.jitter = 2;
            next -= dt;
            if (next <= 0) {
                next = 0.32;
                this.addFx({ type: 'shock', follow: true, feet: true, r0: 30, r1: 260, life: 0.6, width: 6, color: '#bdf3ff' });
                this.addFx({ type: 'roar', follow: true, life: 0.4, seed: Math.random(), color: '#d8f8ff' });
            }
            // 起動の衝撃で、近くのプレイヤーを少し押し返す（ダメージなし）
            this.roarPush(dt);
        });
        // フェーズ3：床の複数箇所に危険な魔法陣（プレイヤーの近くには出さない）
        if (index >= 2) {
            const C = this.map && this.map.layers && this.map.layers.magicCircle;
            const cx = C ? C.x : this.e.position.x, cy = C ? C.y : this.e.position.y;
            const hf = this.atk('hazardFloor');
            const r = hf ? hf.radius : 52 * this.R; // 危険床と同じ大きさ
            const pl = this.player.position;
            for (let i = 0; i < 7; i++) {
                const ang = i / 7 * Math.PI * 2 + 0.3;
                const p = new Vector2(cx + Math.cos(ang) * 400, cy + Math.sin(ang) * 260);
                if (Math.hypot(p.x - pl.x, (p.y - pl.y - 28) / 0.62) < r + 120) continue;
                this.runeFloor(p, r, 1.3, this.dmg(1.0));
            }
            yield* this.sleep(0.5, () => { this.pose.armsUp = 0.6; this.pose.charge = 1; });
        }
        this.invulnerable = false;
    }
    
    // 胸の魔導核の位置（ワールド）
    corePos() { return new Vector2(this.e.position.x, this.e.position.y - this.e.size * 0.13 - this.lift); }
    
    // ---------- 描画 ----------
    drawGround(ctx, cam) {
        // 足元の星力の輪（フェーズが進むほど強く）
        if (this.e.isAlive()) {
            const p = this.feet().sub(cam);
            const k = 0.25 + this.phase.index * 0.2;
            const r = this.e.size * 0.6;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            g.addColorStop(0, `rgba(90, 190, 255, ${0.22 * k})`);
            g.addColorStop(1, 'rgba(90, 190, 255, 0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
        super.drawGround(ctx, cam);
        // 危険床
        const img = window.assetManager ? window.assetManager.get('ruins_floor_rune') : null;
        for (const f of this.fx) {
            if (f.type !== 'runeFloor') continue;
            const p = new Vector2(f.x, f.y).sub(cam);
            const rx = f.r, ry = f.r * 0.62;
            ctx.save();
            if (f.age < f.trigger) {
                // 予告：魔法陣が点滅しながら、だんだん速く・明るくなる。中が満ちていき、出る直前はふちが白と赤で点滅する
                // （色は全ボス共通の攻撃範囲の赤。BossAI.warnLook）
                const q = f.age / f.trigger;
                const L = BossAI.warnLook(q, this.time);
                const blink = 0.5 + 0.5 * Math.sin(this.time * (8 + 16 * q));
                const col = this.warnColor;
                const shape = () => { ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2); };
                shape();
                ctx.globalAlpha = L.fill;
                ctx.fillStyle = col;
                ctx.fill();
                ctx.save();
                ctx.clip();
                ctx.globalAlpha = 0.45 + 0.45 * q * blink;
                if (img) {
                    // 魔法陣の模様も同じ色で塗って描く
                    ctx.imageSmoothingEnabled = true;
                    ctx.drawImage(Enemy.getWhiteSilhouette(img, col), p.x - rx * 1.05, p.y - ry * 1.05, rx * 2.1, ry * 2.1);
                }
                ctx.restore();
                // 中が満ちていく（あと何秒かがわかる）
                ctx.globalAlpha = L.inner * 0.8;
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.ellipse(p.x, p.y, rx * q, ry * q, 0, 0, Math.PI * 2); ctx.fill();
                BossAI.strokeWarn(ctx, f.big ? { ...L, width: L.width + 1 } : L, shape);
            } else {
                // 発動：強く光って消える
                const q = Math.min(1, (f.age - f.trigger) / (f.life - f.trigger));
                ctx.globalCompositeOperation = 'lighter';
                const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rx);
                g.addColorStop(0, `rgba(230, 250, 255, ${0.95 * (1 - q)})`);
                g.addColorStop(0.6, `rgba(110, 210, 255, ${0.6 * (1 - q)})`);
                g.addColorStop(1, 'rgba(60, 140, 255, 0)');
                ctx.translate(p.x, p.y); ctx.scale(1, 0.62);
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(0, 0, rx * (1 + q * 0.15), 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
        }
    }
    
    drawAbove(ctx, cam) {
        super.drawAbove(ctx, cam);
        const e = this.e;
        for (const f of this.fx) {
            const t = Math.min(1, f.age / f.life);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            if (f.type === 'runeFloor' && f.age >= f.trigger) {
                // 光の柱（砲撃は太く高い）
                const q = Math.min(1, (f.age - f.trigger) / (f.life - f.trigger));
                const p = new Vector2(f.x, f.y).sub(cam);
                const w = f.r * (f.big ? 0.9 : 0.55) * (1 - q * 0.5), h = (f.big ? 420 : 170) * (1 - q * 0.3);
                const g = ctx.createLinearGradient(0, p.y - h, 0, p.y);
                g.addColorStop(0, 'rgba(120, 210, 255, 0)');
                g.addColorStop(0.7, `rgba(170, 235, 255, ${0.7 * (1 - q)})`);
                g.addColorStop(1, `rgba(240, 252, 255, ${0.9 * (1 - q)})`);
                ctx.fillStyle = g;
                ctx.fillRect(p.x - w / 2, p.y - h, w, h);
            } else if (f.type === 'coreCharge') {
                // 胸の前に魔法陣が開く
                const p = this.corePos().sub(cam);
                const r = 10 + t * 26;
                ctx.globalAlpha = 0.5 + 0.5 * t;
                ctx.strokeStyle = '#bdf3ff'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
                ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.6, this.time * 4, this.time * 4 + Math.PI * 1.4); ctx.stroke();
                const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.4);
                g.addColorStop(0, 'rgba(230, 250, 255, 0.9)');
                g.addColorStop(1, 'rgba(90, 190, 255, 0)');
                ctx.fillStyle = g;
                ctx.fillRect(p.x - r * 1.4, p.y - r * 1.4, r * 2.8, r * 2.8);
            } else if (f.type === 'pillarCharge') {
                const p = new Vector2(f.x, f.y).sub(cam);
                const r = 14 + t * 18;
                const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
                g.addColorStop(0, 'rgba(230, 250, 255, 0.9)');
                g.addColorStop(1, 'rgba(90, 190, 255, 0)');
                ctx.fillStyle = g;
                ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
            } else if (f.type === 'barrier' && e.isAlive()) {
                // 星の盾（六角形の光の膜）
                const p = e.position.sub(cam);
                const fade = f.age > f.life - 0.2 ? (f.life - f.age) / 0.2 : Math.min(1, f.age * 5);
                const rx = e.size * 0.72, ry = e.size * 0.8;
                ctx.globalAlpha = 0.55 * fade;
                ctx.strokeStyle = '#bdf3ff'; ctx.lineWidth = 3;
                ctx.beginPath();
                for (let i = 0; i <= 6; i++) {
                    const a = i / 6 * Math.PI * 2 + Math.PI / 6;
                    const x = p.x + Math.cos(a) * rx, y = p.y - e.size * 0.1 + Math.sin(a) * ry;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
                ctx.globalAlpha = (0.12 + 0.06 * Math.sin(this.time * 10)) * fade;
                ctx.fillStyle = '#7fe6ff';
                ctx.fill();
            } else if (f.type === 'spark') {
                const p = new Vector2(f.x, f.y - t * 20).sub(cam);
                ctx.globalAlpha = 1 - t;
                ctx.fillStyle = Math.random() < 0.5 ? '#e8fbff' : '#7fe6ff';
                ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3);
            }
            ctx.restore();
        }
        // フェーズ3：関節から星力がもれ出す
        if (e.isAlive() && this.phase.index >= 2) {
            const s = e.position.sub(cam);
            const r = e.size * 0.5;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const joints = [[-0.85, -0.6], [0.85, -0.6], [-0.38, 0.45], [0.38, 0.45]];
            for (let i = 0; i < 10; i++) {
                const j = joints[i % 4];
                const t = (this.time * 0.9 + i * 0.137) % 1;
                ctx.globalAlpha = (1 - t) * 0.8;
                ctx.fillStyle = i % 2 ? '#bdf3ff' : '#5fc8ff';
                ctx.fillRect(Math.round(s.x + j[0] * r + Math.sin(i * 3.1 + this.time * 2) * 6), Math.round(s.y + j[1] * r - this.lift - t * 34), 3, 3);
            }
            ctx.restore();
        }
    }
}

// ---------- 魔道ゴーレムの仮の見た目（画像が届くまで。コードで描く） ----------
// 石の体・金属の部品・胸の魔導核・関節の魔法陣。向き（down/up/left/right）とポーズ（MagicGolemAI.pose）で形が変わる
Enemy.drawGolem = function (e, ctx, s, hop) {
    const ai = e.ai;
    const P = ai && ai.pose ? ai.pose : { armL: 0, armR: 0, armsUp: 0, slam: 0, shield: 0, charge: 0, stomp: 0, kneel: 0, dormant: 0, core: 0.6 };
    const r = e.size * 0.5;
    const dir = e.direction;
    const side = dir === 'left' || dir === 'right';
    const back = dir === 'up';
    // 被弾した瞬間は白（魔法の有利属性は赤・不利属性は青）、ジャスト回避のスロー中は薄い水色
    const hitColor = e.hitFlashTimer > 0 ? e.hitFlashColor : null;
    const colored = hitColor === '#ff3030' || hitColor === '#3a7dff';
    const slow = Enemy.slowMotion && !colored;
    const flash = e.hitFlashTimer > 0 || slow;
    const C = colored
        ? (hitColor === '#ff3030'
            ? { stone: '#ff4a4a', light: '#ff8a8a', dark: '#c42020', line: '#5a0e0e', metal: '#e83a3a', metalL: '#ff9a9a', gold: '#ffb0b0' }
            : { stone: '#4a86ff', light: '#8ab4ff', dark: '#2253c4', line: '#0e2560', metal: '#3a70e8', metalL: '#9ac0ff', gold: '#b0ccff' })
        : slow
        ? { stone: '#c8f0ff', light: '#e4f9ff', dark: '#9fd8ee', line: '#5a9ab8', metal: '#b4e6fa', metalL: '#dcf6ff', gold: '#e4f9ff' }
        : flash
        ? { stone: '#ffffff', light: '#ffffff', dark: '#e6e6f0', line: '#c8c8d8', metal: '#f2f2ff', metalL: '#ffffff', gold: '#ffffff' }
        : { stone: '#968ca4', light: '#c3b9cf', dark: '#625870', line: '#231d31', metal: '#5d6d86', metalL: '#93a6c0', gold: '#d2ad62' };
    const glow = '#7fe8ff';
    const core = Math.max(0, Math.min(1, P.core));
    const t = ai ? ai.time : performance.now() / 1000;
    const moving = e.velocity && e.velocity.length() > 1;
    const swing = moving ? Math.sin(t * 7) : 0;
    const down = (P.kneel * 0.3 + P.dormant * 0.34) * r;      // ひざをつく・眠っている時は体が下がる
    const bow = P.dormant * 0.22 * r;                          // 眠っている時は頭を下げる
    const cx = Math.round(s.x), cy = Math.round(s.y - hop + down);
    const footY = Math.round(s.y - hop + r * 1.08);
    
    ctx.save();
    if (dir === 'left') { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); }  // 左向きは右向きを反転
    ctx.lineJoin = 'miter';
    
    // 石のブロック（ふち取り・上の明るい面・下の影）
    const block = (x, y, w, h, fill, light, dark) => {
        x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
        ctx.fillStyle = C.line;
        ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = light;
        ctx.fillRect(x, y, w, Math.max(2, Math.round(h * 0.2)));
        ctx.fillStyle = dark;
        ctx.fillRect(x, y + h - Math.max(2, Math.round(h * 0.18)), w, Math.max(2, Math.round(h * 0.18)));
    };
    // 関節の魔法陣（光る小さな輪）
    const joint = (x, y, rad) => {
        ctx.save();
        ctx.globalAlpha = flash ? 1 : 0.45 + core * 0.55;
        ctx.strokeStyle = flash ? '#ffffff' : glow;
        ctx.lineWidth = 2;
        // ひし形の古代文字（遺跡の床・石柱と同じ模様）
        x = Math.round(x); y = Math.round(y);
        ctx.beginPath(); ctx.moveTo(x, y - rad); ctx.lineTo(x + rad * 0.7, y); ctx.lineTo(x, y + rad); ctx.lineTo(x - rad * 0.7, y); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = flash ? '#ffffff' : '#e6fbff';
        ctx.fillRect(x - 1, y - 1, 3, 3);
        ctx.restore();
    };
    // 腕：肩から拳まで太い石の腕、先に大きな拳
    const arm = (sx, sy, fx, fy, k, dim) => {
        ctx.save();
        ctx.lineCap = 'square';
        ctx.strokeStyle = C.line; ctx.lineWidth = r * 0.38 * k + 6;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.strokeStyle = dim ? C.dark : C.stone; ctx.lineWidth = r * 0.38 * k;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.restore();
        // ひじの金属の輪
        joint((sx + fx) / 2, (sy + fy) / 2, r * 0.1 * k);
        const fw = r * 0.62 * k, fh = r * 0.5 * k;
        block(fx - fw / 2, fy - fh * 0.35, fw, fh, dim ? C.dark : C.stone, dim ? C.stone : C.light, C.dark);
        // 拳の金属のふち
        ctx.fillStyle = C.metal;
        ctx.fillRect(Math.round(fx - fw / 2), Math.round(fy - fh * 0.35), Math.round(fw), Math.max(3, Math.round(fh * 0.16)));
    };
    // 拳の位置（ポーズで決める）。sgn：-1 = 画面の左の腕、+1 = 右の腕
    const lerp = (a, b, k) => a + (b - a) * k;
    const fist = (sgn) => {
        const ext = sgn > 0 ? P.armR : P.armL;
        let x, y, k = 1;
        if (side) {
            const front = sgn > 0;
            x = (front ? 0.2 : -0.12) * r; y = (0.32 + (front ? swing : -swing) * 0.06) * r;
            if (ext > 0 && front) { x = (0.2 + 1.0 * ext) * r; y = 0.05 * r; k = 1 + 0.1 * ext; }
            else if (ext < 0 && front) { x = (0.2 + 0.45 * ext) * r; y = 0.15 * r; }
            else if (ext > 0) { x = (-0.12 + 0.9 * ext) * r; y = 0.1 * r; }
            x = lerp(x, (front ? 0.3 : 0.05) * r, P.armsUp); y = lerp(y, -1.45 * r, P.armsUp);
            x = lerp(x, (front ? 1.0 : 0.85) * r, P.slam); y = lerp(y, 0.92 * r, P.slam);
            x = lerp(x, 0.45 * r, P.shield); y = lerp(y, -0.25 * r, P.shield);
            x = lerp(x, (front ? 0.6 : 0.5) * r, P.charge); y = lerp(y, -0.1 * r, P.charge);
            // 腕の振り回し：手前の腕は前へ、奥の腕は後ろへまっすぐ伸ばす
            x = lerp(x, (front ? 1.35 : -1.2) * r, P.spin); y = lerp(y, -0.3 * r, P.spin);
        } else {
            x = sgn * 0.98 * r; y = (0.35 + sgn * swing * 0.06) * r;
            if (ext > 0) {
                x = sgn * (0.98 - 0.55 * ext) * r;
                y = (back ? 0.35 - 0.45 * ext : 0.35 + 0.38 * ext) * r;
                k = back ? 1 - 0.15 * ext : 1 + 0.3 * ext;
            } else if (ext < 0) { x = sgn * 1.05 * r; y = (0.35 + 0.35 * ext) * r; }
            x = lerp(x, sgn * 0.55 * r, P.armsUp); y = lerp(y, -1.45 * r, P.armsUp);
            x = lerp(x, sgn * 0.42 * r, P.slam); y = lerp(y, (back ? 0.1 : 0.95) * r, P.slam);
            if (P.slam > 0 && !back) k = lerp(k, 1.2, P.slam);
            x = lerp(x, -sgn * 0.22 * r, P.shield); y = lerp(y, -0.22 * r, P.shield);
            x = lerp(x, sgn * 0.5 * r, P.charge); y = lerp(y, -0.05 * r, P.charge);
            // 腕の振り回し：両腕を横にまっすぐ広げる
            x = lerp(x, sgn * 1.6 * r, P.spin); y = lerp(y, -0.3 * r, P.spin);
        }
        // ひざをついた・眠っている時は腕を地面につく
        const rest = Math.max(P.kneel, P.dormant);
        if (rest > 0) { x = lerp(x, (side ? 0.55 : sgn * 0.85) * r, rest); y = lerp(y, 0.75 * r - down, rest); }
        return { x: cx + x, y: cy + y, k };
    };
    
    // ----- 脚 -----
    const legTop = cy + r * 0.42;
    const leg = (lx, lift, dim) => {
        const top = legTop, bottom = footY - lift;
        const h = Math.max(r * 0.2, bottom - top - r * 0.14);
        block(lx - r * 0.2, top, r * 0.4, h, dim ? C.dark : C.stone, dim ? C.stone : C.light, C.dark);
        block(lx - r * 0.26, bottom - r * 0.16, r * 0.52, r * 0.16, C.metal, C.metalL, C.dark);   // 金属の足
        joint(lx, top + h * 0.35, r * 0.09);
    };
    const stompLift = P.stomp * r * 0.3;
    // ----- 胴体 -----
    const torso = () => {
        const tw = side ? r * 1.05 : r * 1.55, bw = side ? r * 0.85 : r * 1.0;
        const ty = cy - r * 0.78 + bow * 0.4, by = cy + r * 0.42;
        const ox = side ? r * 0.05 : 0;
        ctx.beginPath();
        ctx.moveTo(cx + ox - tw / 2, ty); ctx.lineTo(cx + ox + tw / 2, ty);
        ctx.lineTo(cx + ox + bw / 2, by); ctx.lineTo(cx + ox - bw / 2, by); ctx.closePath();
        ctx.fillStyle = C.line; ctx.lineWidth = 6; ctx.strokeStyle = C.line; ctx.stroke();
        ctx.fillStyle = C.stone; ctx.fill();
        // 上の明るい面と、下の影
        ctx.fillStyle = C.light;
        ctx.fillRect(Math.round(cx + ox - tw / 2), Math.round(ty), Math.round(tw), Math.round(r * 0.16));
        ctx.fillStyle = C.dark;
        ctx.fillRect(Math.round(cx + ox - bw / 2), Math.round(by - r * 0.14), Math.round(bw), Math.round(r * 0.14));
        // 石の継ぎ目
        ctx.fillStyle = C.dark;
        ctx.fillRect(Math.round(cx + ox - tw * 0.42), Math.round(cy - r * 0.42), Math.round(tw * 0.84), 2);
        ctx.fillRect(Math.round(cx + ox - bw * 0.46), Math.round(cy + r * 0.12), Math.round(bw * 0.92), 2);
        // 腰の金属の帯（金のふち）
        block(cx + ox - bw * 0.56, cy + r * 0.24, bw * 1.12, r * 0.2, C.metal, C.metalL, C.dark);
        ctx.fillStyle = C.gold;
        ctx.fillRect(Math.round(cx + ox - bw * 0.56), Math.round(cy + r * 0.24), Math.round(bw * 1.12), 2);
        // 古代文字（体に刻まれた光る線）
        ctx.save();
        ctx.globalAlpha = flash ? 1 : 0.3 + core * 0.5;
        ctx.fillStyle = flash ? '#ffffff' : glow;
        const marks = back ? [[-0.4, -0.55], [0.3, -0.55], [-0.05, 0.0], [-0.3, -0.15], [0.32, -0.12]] : [[-0.5, -0.6], [0.42, -0.6], [-0.38, 0.0], [0.34, 0.02]];
        for (const [mx, my] of marks) {
            if (side && Math.abs(mx) > 0.35) continue;
            ctx.fillRect(Math.round(cx + ox + mx * r), Math.round(cy + my * r), Math.round(r * 0.12), 2);
            ctx.fillRect(Math.round(cx + ox + mx * r + r * 0.05), Math.round(cy + my * r - r * 0.06), 2, Math.round(r * 0.14));
        }
        ctx.restore();
        // 背中：大きな魔法陣の刻印
        if (back) joint(cx, cy - r * 0.32, r * 0.24);
    };
    // ----- 胸の魔導核 -----
    const coreGem = () => {
        if (back) return;
        const gx = cx + (side ? r * 0.36 : 0), gy = cy - r * 0.26 + bow * 0.4;
        const gr = side ? r * 0.13 : r * 0.2;
        ctx.fillStyle = C.line; ctx.beginPath(); ctx.arc(gx, gy, gr + 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(gx, gy, gr + 3, 0, Math.PI * 2); ctx.fill();
        if (!flash) {
            const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
            g.addColorStop(0, `rgba(240, 253, 255, ${0.35 + core * 0.65})`);
            g.addColorStop(0.5, `rgba(110, 220, 255, ${0.3 + core * 0.7})`);
            g.addColorStop(1, `rgba(30, 80, 160, ${0.8})`);
            ctx.fillStyle = g;
        } else ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill();
        if (!flash && core > 0.1) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const h = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr * (2.4 + core * 1.6));
            h.addColorStop(0, `rgba(140, 230, 255, ${0.45 * core})`);
            h.addColorStop(1, 'rgba(80, 160, 255, 0)');
            ctx.fillStyle = h;
            ctx.beginPath(); ctx.arc(gx, gy, gr * (2.4 + core * 1.6), 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
    };
    // ----- 頭 -----
    const head = () => {
        const hw = side ? r * 0.5 : r * 0.62, hh = r * 0.44;
        const hx = cx + (side ? r * 0.22 : 0) - hw / 2, hy = cy - r * 1.16 + bow;
        block(hx, hy, hw, hh, C.stone, C.light, C.dark);
        // 金属のかぶと
        ctx.fillStyle = C.metal;
        ctx.fillRect(Math.round(hx), Math.round(hy), Math.round(hw), Math.round(hh * 0.22));
        ctx.fillStyle = C.gold;
        ctx.fillRect(Math.round(hx + hw / 2 - 2), Math.round(hy - 6), 4, 8);
        if (!back) {
            // 目のすき間（光る）
            ctx.fillStyle = flash ? '#ffffff' : `rgba(150, 235, 255, ${0.35 + core * 0.65})`;
            const ex = side ? hx + hw * 0.45 : hx + hw * 0.16, ew = side ? hw * 0.5 : hw * 0.68;
            ctx.fillRect(Math.round(ex), Math.round(hy + hh * 0.45), Math.round(ew), 4);
        }
    };
    // ----- 肩 -----
    const shoulder = (sgn, dim) => {
        const sx = side ? cx + sgn * r * 0.12 : cx + sgn * r * 0.86, sy = cy - r * 0.62 + bow * 0.4;
        const w = side ? r * 0.56 : r * 0.58, h = r * 0.44;
        block(sx - w / 2, sy - h / 2, w, h, dim ? C.metal : C.metalL, dim ? C.metalL : '#c2d0e2', C.metal);
        ctx.fillStyle = C.gold;
        ctx.fillRect(Math.round(sx - w / 2), Math.round(sy + h / 2 - 3), Math.round(w), 3);
        joint(sx, sy, r * 0.12);
        return { x: sx, y: sy + h * 0.2 };
    };
    
    if (side) {
        // 奥の腕・奥の脚 → 胴体 → 手前の脚・手前の腕
        const sb = { x: cx - r * 0.02, y: cy - r * 0.5 + bow * 0.4 };
        const fb = fist(-1);
        arm(sb.x, sb.y, fb.x, fb.y, fb.k * 0.92, true);
        leg(cx - r * 0.2 - swing * r * 0.16, Math.max(0, -swing) * r * 0.1, true);
        torso();
        leg(cx + r * 0.22 + swing * r * 0.16, Math.max(0, swing) * r * 0.1 + stompLift, false);
        head();
        coreGem();
        const sf = shoulder(1, false);
        const ff = fist(1);
        arm(sf.x, sf.y, ff.x, ff.y, ff.k, false);
    } else {
        leg(cx - r * 0.38, Math.max(0, swing) * r * 0.1, false);
        leg(cx + r * 0.38, Math.max(0, -swing) * r * 0.1 + stompLift, false);
        // 叩きつけ・背中：腕は体のうしろ
        const armsBehind = back && (P.slam > 0.3 || P.armR > 0.3 || P.armL > 0.3);
        const sL = { x: cx - r * 0.86, y: cy - r * 0.5 + bow * 0.4 }, sR = { x: cx + r * 0.86, y: cy - r * 0.5 + bow * 0.4 };
        const fL = fist(-1), fR = fist(1);
        if (armsBehind) { arm(sL.x, sL.y, fL.x, fL.y, fL.k, true); arm(sR.x, sR.y, fR.x, fR.y, fR.k, true); }
        torso();
        coreGem();
        head();
        shoulder(-1, false); shoulder(1, false);
        if (!armsBehind) { arm(sL.x, sL.y, fL.x, fL.y, fL.k, false); arm(sR.x, sR.y, fR.x, fR.y, fR.k, false); }
    }
    ctx.restore();
};

// boss_data.js の ai: 'MagicGolemAI' で使えるように登録
BOSS_AI_CLASSES.MagicGolemAI = MagicGolemAI;
window.MagicGolemAI = MagicGolemAI;
window.GolemSound = GolemSound;
