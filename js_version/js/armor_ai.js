// 怨嗟の鎧（戦争の遺物・星喰いの残響。バトルモード用の設定。ストーリーの歴史とは別）
// 黒鉄のひび割れた鎧に、ちぎれた布。紫に光る目と長い刀。黒い霧をまとい、少し透けて、すべるように動く
// （中に人がいるのか、亡霊なのかは分からないまま）
//
// - GrudgeArmorAI：ボスAI（boss_ai.js の BossAI を使う）。攻撃は *act_<名前> に書き、boss_data.js の phases[].attacks で使う
//     開始      ：刀を納めて待つ → BATTLE START → 柄を握り、抜刀（音と光）→ 主人公へまっすぐ駆けて斬る（帯の予告つき）
//     第1形態「亡霊剣士」  ：抜刀斬り・高速踏み込み斬り・二連斬り・集中居合い（集中を始めた時に向きが決まる）
//                           中距離では集中居合い、近くでは二連斬りを選びやすい。攻撃の後は下がる
//     第2形態「六影の怨嗟」：刀を地面に突き立て、霧の中に6つの点 → 本体＋分身5体が円の 0・60・120・180・240・300 度に並ぶ
//                           六影風刃：6体が 0.2〜0.4 秒ずつずらして風刃を撃ち続ける
//                           分身は本体をノックバックした時だけ消える（ふつうに当てても消えない。分身を斬ってもすり抜ける）
//                           消えたら本体は気絶 → ふつうの攻撃（三連斬り・風刃・踏み込み）。分身召喚にはクールダウン
//     第3形態「常闇の剣鬼」：ステージ中を駆けて火をすべて斬り消す → 黒い霧 → 暗闇（主人公だけ見える）→ 遠くに目だけが光る
//                           闇の居合い・幽影連斬（1回ごとに目の位置が変わる）・黒霧の突進（残像を残す）
//                           実体化している時だけ物理攻撃が効く。火の明かりに入ると実体化（最低 1.5 秒は斬れる）
//                           ボスは時間で火を消しに来る（1回に消す数と間隔は TUNING。全部の火を続けて消すことはない）
//     魔法の直接のダメージは効かない（炎の魔法は、消えた火に当てて灯すのに使う。battlefield_map.js）
// - ステージ（battlefield_map.js の BattlefieldMap）と連動：火の明かり・暗闇・炎の魔法で火を灯す
// - 見た目：画像が届くまでは Enemy.drawGrudgeArmor（下）でコードで描く仮の姿
//   画像は assets/enemies/grudge_armor/<モーション>_<向き>_<1〜3>.png に置き、assets.js の BEAST_SPRITES_READY・
//   BOSS_MOTION_SPRITES_READY に足すと使われる（モーション名は boss_data.js の motions）
// - 状態（state）：idle / chase / attack / recovery / phaseTransition / cloneSummon / darkness / materialized /
//   dematerialized / stunned / dead（デバッグ用。game.enemySpawner.enemies[0].ai.state で見られる）

class GrudgeArmorAI extends BossAI {
    constructor(enemy, def) {
        super(enemy, def);
        this.introMode = null;     // 'sheathed'：開始の演出で、刀を納めて待つ
        this.introT = 0;
        this.bladeOut = false;     // 刀を抜いているか（開始の演出では鞘の中）
        this.blade = null;         // 刀の構え（毎フレーム攻撃側で決める）{ mode, side, p }。null = 抜いていればふつうの構え
        this.crouch = 0;           // 身を低くする（0〜1。居合いの溜め）
        this.fade = 1;             // 体の濃さ（霧になって消える・現れる演出）
        this.recovering = false;   // 攻撃の後の隙
        this.clones = [];          // 分身 { id, x, y, t, fade, dying, hidden, shimmer, flash, dir, facing }
        this.cloneSeq = 0;
        this.cloneCooldown = 0;
        this.blades = [];          // 風刃 { id, x, y, px, py, vx, vy, r, damage, age, travel, max, owner }
        this.bladeSeq = 0;
        this.shotQueue = [];       // これから撃つ風刃 { at, src（'body' か分身の id）, dir }
        this.clock = 0;            // preUpdate の時計（ノックバック中も進む）
        this.dark = false;         // 第3形態の暗闇が始まったか
        this.materialized = false; // 暗闇の中で実体化しているか（している時だけ斬れる）
        this.materialUntil = 0;
        this.extinguishTimer = 0;
        this.pendingStun = 0;      // 分身を消されたノックバックの後の気絶（秒）
        this.feedbackAt = -9;
        this.texts = [];           // 小さな文字（「魔法無効」「すり抜けた」）
        this.playerWasAttacking = false;
        this.orbitSign = Math.random() < 0.5 ? 1 : -1;
        this.orbitTimer = 2;
    }
    
    get T() { return GrudgeArmorAI.TUNING; }
    get map() { return this.e.map && this.e.map.fires ? this.e.map : null; }
    
    // 体の濃さ（Enemy.drawGrudgeArmor）：いつも少し透けている。暗闇で実体化していない時はほとんど見えない
    get bodyAlpha() {
        let a = 0.9 * this.fade;
        if (this.dark && !this.materialized && this.e.isAlive()) a *= 0.1;
        return a;
    }
    
    // ロックオン・自動でねらう敵にしない（分身がいる間・暗闇で実体化していない間。game.js）
    get hideTarget() { return this.liveClones().length > 0 || (this.dark && !this.materialized); }
    
    get state() {
        const e = this.e;
        if (!e.isAlive()) return 'dead';
        if (this.actionName === 'transition') return 'phaseTransition';
        if (e.staggerTimer > 0 || this.actionName === 'stunned') return 'stunned';
        if (this.summoning) return 'cloneSummon';
        if (this.dark) return this.materialized ? 'materialized' : this.action ? 'darkness' : 'dematerialized';
        if (this.recovering) return 'recovery';
        if (this.action) return 'attack';
        return e.velocity.length() > 1 ? 'chase' : 'idle';
    }
    
    darkLevel() { return this.map ? this.map.darkness : 0; }
    liveClones() { return this.clones.filter(c => !c.dying); }
    
    // ---------- 毎フレーム（ノックバック中も。Enemy.update が呼ぶ） ----------
    preUpdate(dt) {
        this.clock += dt;
        if (this.cloneCooldown > 0) this.cloneCooldown -= dt;
        const p = this.player;
        // 分身：現れる・消える・すり抜けた時のゆらぎ
        for (const c of this.clones) {
            c.t += dt;
            const goal = c.dying || c.hidden ? 0 : 1;
            c.fade += Math.sign(goal - c.fade) * Math.min(Math.abs(goal - c.fade), dt / (c.dying ? 0.45 : 0.35));
            if (c.shimmer > 0) c.shimmer = Math.max(0, c.shimmer - dt);
            if (c.flash > 0) c.flash = Math.max(0, c.flash - dt);
            if (p) {
                const v = p.position.sub(new Vector2(c.x, c.y));
                if (v.length() > 1) { c.facing = v.normalize(); c.dir = GrudgeArmorAI.dirName(c.facing); }
            }
        }
        this.clones = this.clones.filter(c => !(c.dying && c.fade <= 0));
        
        // 予告の後に風刃を撃つ
        for (const q of this.shotQueue) {
            if (q.done || this.clock < q.at) continue;
            q.done = true;
            const src = this.shooterPos(q.src);
            if (!src) continue;
            this.spawnBlade(src, q.dir, this.atk('sixWind'), q.src);
            const c = this.clones.find(k => k.id === q.src);
            if (c) c.flash = 0.25;
        }
        this.shotQueue = this.shotQueue.filter(q => !q.done);
        
        // 風刃を動かす（ステージの外へ出たら消える）
        const map = this.map;
        for (const b of this.blades) {
            b.px = b.x; b.py = b.y;
            b.x += b.vx * dt; b.y += b.vy * dt;
            b.age += dt;
            b.travel += Math.hypot(b.vx, b.vy) * dt;
            if (b.travel > b.max || (map && b.travel > 60 && !map.inWalkArea(b.x, b.y + 30))) b.dead = true;
        }
        this.blades = this.blades.filter(b => !b.dead);
        
        for (const t of this.texts) t.age += dt;
        this.texts = this.texts.filter(t => t.age < t.life);
        
        // 主人公が分身を斬った：手ごたえなく、すり抜ける（本体のダメージにならない）
        if (p) {
            const atk = !!p.isAttacking;
            if (atk && !this.playerWasAttacking && this.clones.length) this.checkCloneSwing(p);
            this.playerWasAttacking = atk;
        }
        
        // 第3形態：火の明かりに入ったら実体化（最低 TUNING.materializeMin 秒は斬れる）。明かりの外で時間が過ぎたら霧に戻る
        if (this.dark && this.e.isAlive() && this.actionName !== 'transition' && map) {
            const lit = map.isLit(this.feet());
            if (lit && !this.materialized) this.materialize();
            if (this.materialized) {
                if (lit) this.materialUntil = Math.max(this.materialUntil, this.clock + 0.25);
                else if (this.clock >= this.materialUntil) this.dematerialize();
            }
            if (this.extinguishTimer > 0) this.extinguishTimer -= dt;
        }
    }
    
    update(dt) {
        this.blade = null;
        this.crouch = 0;
        this.recovering = false;
        // 分身を消された後のノックバックが終わった：しばらく気絶してから、ふつうの動きに戻る
        if (this.pendingStun > 0 && this.active && !this.action && this.e.isAlive()) {
            const t = this.pendingStun;
            this.pendingStun = 0;
            this.startAction('stunned', this.act_stunned(t));
        }
        super.update(dt);
        // 亡霊らしく、少し浮いてすべるように動く（足元の影はそのまま）
        this.lift += 7 + Math.sin(this.time * 2.1) * 3;
    }
    
    endAction() {
        super.endAction();
        this.fade = 1;
        this.airborne = false;
    }
    
    cancel() {
        super.cancel();
        this.fade = 1;
        this.summoning = false;
        this.shotQueue = [];
        this.e.velocity = new Vector2(0, 0);
    }
    
    // 大きくひるんだ（続けて斬られた）。分身がいる時は、分身が消えて弾幕が止まり、本体は気絶する
    interrupt() {
        const had = this.liveClones().length > 0;
        super.interrupt();
        this.motion = 'knockback';
        if (had) {
            this.dispelClones();
            this.cloneCooldown = this.T.cloneCooldown;
            this.pendingStun = this.T.stun;
            this.events.push({ type: 'shake', power: 6, time: 0.35 });
            this.say('分身が消えた！', '#ffe6a0', 1.2);
        }
    }
    
    onDeath() {
        super.onDeath();
        this.dispelClones(true);
        this.blades = [];
        this.materialized = true;  // 倒れる姿ははっきり見せる
        this.fade = 1;
        // 暗闇が晴れて、火がすべて灯る
        if (this.map) { this.map.setDarkness(0); this.map.relightAll(); }
    }
    
    // 魔法は効かない。暗闇で実体化していない時は、斬ってもすり抜ける（Enemy.takeDamage が呼ぶ。true = ダメージなし）
    blocksDamage(kind) {
        if (kind === 'magic') { this.feedback('魔法無効', '#cdb8ff'); return true; }
        if (this.dark && !this.materialized) { this.feedback('すり抜けた', '#9d8cff'); return true; }
        return false;
    }
    
    feedback(text, color) {
        if (this.clock - this.feedbackAt < this.T.feedbackGap) return;
        this.feedbackAt = this.clock;
        this.say(text, color);
        this.addFx({ type: 'ward', follow: true, life: 0.35 });
        playSE('armor_immune');
    }
    
    say(text, color = '#e6dcff', life = 0.9) {
        this.texts.push({ text, color, x: this.e.position.x, y: this.e.position.y - this.e.size * 1.25, age: 0, life });
    }
    
    // 主人公のナイフの扇に分身が入っていたら、その分身がゆらいで「すり抜けた」
    checkCloneSwing(p) {
        const w = p.weapon || { range: 100, arc: Math.PI * 0.8 };
        const aim = p.aimVector && p.aimVector.length() > 0.01 ? p.aimVector.normalize() : new Vector2(0, -1);
        const cos = Math.cos(w.arc / 2);
        let hit = false;
        for (const c of this.liveClones()) {
            const v = new Vector2(c.x - p.position.x, c.y - p.position.y);
            const d = v.length();
            if (d > w.range + this.e.size * 0.5) continue;
            if (d > this.e.size * 0.5 && (v.x * aim.x + v.y * aim.y) / d < cos) continue;
            c.shimmer = 0.5;
            hit = true;
        }
        if (hit && this.clock - this.feedbackAt >= this.T.feedbackGap) {
            this.feedbackAt = this.clock;
            const c = this.clones.find(k => k.shimmer >= 0.49);
            if (c) this.texts.push({ text: 'すり抜けた', color: '#b9a8ff', x: c.x, y: c.y - this.e.size * 1.25, age: 0, life: 0.8 });
            playSE('armor_immune');
        }
    }
    
    // ---------- 実体化（第3形態） ----------
    materialize() {
        this.materialized = true;
        this.materialUntil = this.clock + this.T.materializeMin;
        this.motion = this.action ? this.motion : 'materialize';
        this.addFx({ type: 'materialize', follow: true, life: 0.5 });
        playSE('armor_materialize');
    }
    
    dematerialize() {
        this.materialized = false;
        this.addFx({ type: 'mistBurst', x: this.e.position.x, y: this.feet().y, r: this.e.size * 0.7, life: 0.6, n: 5 });
    }
    
    // ---------- 開始：柄を握る → 抜刀 → まっすぐ駆けて斬る ----------
    startFight() {
        this.active = true;
        this.introTarget = null;
        this.startAction('opening', this.act_opening(this.atk('drawSlash')));
    }
    
    *act_opening(a) {
        // 集中の間ずっと帯の予告。0.45 秒で柄を握り、抜刀の音と光の後に駆け出す
        // 北の階段の前から南の主人公まで届くように、この時だけ長く駆ける
        yield* this.dashSlash(a, { focus: 1.15, lockAt: 0.72, drawAt: 0.4, chargeMotion: 'drawSword', dist: 1500 });
        yield* this.recover(a.recover);
        yield* this.sheathe();
        yield* this.backOff(0.35);
    }
    
    // ---------- 動き ----------
    // 第1・第2形態：主人公のまわりを回りながら、中くらいの距離を保つ / 暗闇：霧の中を回る
    idleMove(dt) {
        this.orbitTimer -= dt;
        if (this.orbitTimer <= 0) { this.orbitSign *= -1; this.orbitTimer = 1.4 + Math.random() * 1.6; }
        const to = this.toPlayer();
        const d = to.length();
        const n = d > 0.01 ? to.normalize() : new Vector2(0, 1);
        const keep = this.dark ? this.T.keepDistDark : this.T.keepDist;
        const tangent = new Vector2(-n.y * this.orbitSign, n.x * this.orbitSign);
        const radial = n.mult(Math.max(-1, Math.min(1, (d - keep) / 140)));
        const v = tangent.mult(0.7).add(radial.mult(1.2)).normalize();
        const far = d > keep + 320;
        this.e.velocity = v.mult(this.speed * (far ? 1.5 : 0.75));
        if (this.blocked) this.orbitSign *= -1;
        this.face(n);
        this.motion = this.dark ? 'ghostMove' : far ? 'run' : 'walk';
    }
    
    // 近づく（max 秒まで）
    *approach(range, max = 1.0) {
        let t = 0;
        while (this.dist() > range && t < max) {
            const dt = yield;
            t += dt;
            const dir = this.dirToPlayer();
            this.face(dir);
            this.motion = this.dark ? 'ghostMove' : 'run';
            this.e.velocity = dir.mult(this.speed * 1.7);
        }
    }
    
    // 攻撃の後、すべるように下がる
    *backOff(time = 0.35) {
        const side = Math.random() < 0.5 ? 1 : -1;
        yield* this.sleep(time, () => {
            const n = this.dirToPlayer();
            this.face(n);
            this.motion = this.dark ? 'ghostMove' : 'walk';
            const away = n.mult(-1).add(new Vector2(-n.y * side, n.x * side).mult(0.5)).normalize();
            this.e.velocity = away.mult(this.speed * 1.4);
        });
    }
    
    // ある場所へ霧のようにすべって行く（壁はすり抜けない）
    *ghostShift(dest, maxT = 1.0, speed = null) {
        const sp = speed || this.speed * 2.2;
        let t = 0, next = 0;
        while (t < maxT) {
            const v = dest.sub(this.e.position);
            if (v.length() < 18) break;
            const dt = yield;
            t += dt;
            if (t > 0.15 && this.blocked && this.e.velocity.length() > 1 && v.length() < 140) break;
            this.motion = 'ghostMove';
            this.face(v);
            this.e.velocity = v.normalize().mult(Math.min(sp, v.length() / Math.max(dt, 0.001)));
            next -= dt;
            if (next <= 0) { next = 0.07; this.ghostAfter(0.4, true); }
        }
        this.e.velocity = new Vector2(0, 0);
    }
    
    // 霧になって消え、別の所に現れる（dest は歩ける所にしてから渡す）
    *mistWarp(dest) {
        this.addFx({ type: 'mistBurst', x: this.e.position.x, y: this.feet().y, r: this.e.size * 0.7, life: 0.5, n: 5, seen: true });
        yield* this.sleep(0.25, (p) => { this.fade = 1 - p; this.motion = 'ghostMove'; });
        this.e.position = dest.clone();
        this.addFx({ type: 'mistBurst', x: dest.x, y: this.feet().y, r: this.e.size * 0.7, life: 0.5, n: 5, seen: true });
        yield* this.sleep(0.25, (p) => { this.fade = p; this.motion = 'ghostMove'; });
        this.fade = 1;
    }
    
    *recover(t) {
        this.recovering = true;
        this.motion = 'idle';
        yield* this.sleep(t * this.P.recoverMul * BossAI.TUNING.recover, () => { this.recovering = true; this.face(this.dirToPlayer()); });
        this.recovering = false;
    }
    
    // 刀を抜いていなければ、すばやく抜く
    *readyBlade() {
        if (this.bladeOut) return;
        this.motion = 'drawSword';
        yield* this.sleep(0.16, (p) => { this.face(this.dirToPlayer()); this.blade = { mode: 'hilt', p }; });
        this.bladeOut = true;
        playSE('armor_draw');
        this.addFx({ type: 'glint', follow: true, life: 0.3 });
    }
    
    *sheathe() {
        if (!this.bladeOut) return;
        this.motion = 'sheathSword';
        yield* this.sleep(0.32, (p) => { this.face(this.dirToPlayer()); this.blade = { mode: 'sheathing', p }; });
        this.bladeOut = false;
        playSE('armor_sheath');
    }
    
    *act_stunned(t) {
        this.e.crashTimer = t; // 頭の上で星が回る（Enemy.draw）
        playSE('boss_dizzy');
        yield* this.sleep(t, () => { this.motion = 'hit'; this.crouch = 0.45; this.recovering = true; });
    }
    
    // ---------- 攻撃を選ぶ ----------
    // 距離が合う攻撃から重みで選ぶ（BossAI.chooseAttack と同じ。使えない攻撃を除いて、距離で選びやすさを変える）
    chooseAttack(force = false) {
        // 第3形態：時間が来たら火を消しに行く
        if (this.dark && this.extinguishTimer <= 0 && this.map) {
            this.extinguishTimer = this.T.extinguishInterval;
            if (this.map.litFires().length >= 2) { this.startAction('extinguishFire', this.act_extinguishFire(this.atk('extinguishFire'))); return; }
        }
        if (this.opener) { this.useOpener(force); return; }
        const d = this.dist();
        const list = [];
        let near = null, nearGap = Infinity;
        for (const [name, w0] of Object.entries(this.P.attacks)) {
            const a = this.atk(name);
            if (!a || !this['act_' + name] || !this.canUse(name)) continue;
            let w = w0;
            if (name === 'focusIai' && d > 300 && d < 820) w *= 2.2;                         // 中距離は集中居合い
            if ((name === 'doubleSlash' || name === 'tripleSlash') && d < 250) w *= 2.5;     // 近くは連続斬り
            if (name === 'cloneSummon') w *= 2;
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
    
    canUse(name) {
        if (name === 'cloneSummon') return this.cloneCooldown <= 0 && !this.liveClones().length;
        return true;
    }
    
    // ---------- 攻撃を書くための道具 ----------
    // 向き dir に len まで進めるか（足元の箱で壁を調べる）。進める長さを返す（予告の帯と、実際に止まる所を合わせる）
    clampDash(dir, len) {
        const map = this.e.map;
        if (!map || !map.isBoxBlocked) return len;
        const f = this.e.getFootBox();
        const p0 = this.e.position;
        for (let d = 16; d <= len; d += 16) {
            const x = p0.x + dir.x * d, y = p0.y + dir.y * d;
            if (map.isBoxBlocked(x + f.ox, y + f.oy, f.hw, f.hh)) return Math.max(0, d - 16);
        }
        return len;
    }
    
    // 残像（駆け抜けた所に体の形の影を残す）。dark = true：黒い霧の残像（暗闇でも見える）
    ghostAfter(life = 0.3, dark = false) {
        this.addFx({ type: 'armorGhost', x: this.e.position.x, y: this.e.position.y, lift: this.lift, dir: this.e.direction,
            facing: this.facing.clone(), life, dark, seen: dark });
    }
    
    // 集中（帯の予告）→ 駆け抜けて斬る（主人公をすり抜ける）
    // o.focus：集中の秒数 / o.lockAt：集中のこの割合までは主人公の方へ向き直す（0 = 集中を始めた時に決まる）
    // o.drawAt：集中のこの割合で刀を抜く（開始の抜刀）。書かなければ鞘に納めたまま、駆け出す時に抜く（居合い）
    *dashSlash(a, o = {}) {
        const focus = o.focus ?? a.focus;
        const lockAt = o.lockAt ?? 0;
        const over = (a.over || 60) * this.R;
        const maxLen = o.dist || a.dist;   // o.dist：この時だけの最大の距離（開始の抜刀は遠くから届く）
        const lenFor = (dir) => this.clampDash(dir, Math.min(maxLen, this.dist() + over));
        // 居合い：刀を鞘に納めてから集中する（予告の帯は集中の間ずっと出す）
        if (o.drawAt == null && !o.keepBlade && this.bladeOut) yield* this.sheathe();
        let dir = this.dirToPlayer();
        const start = this.e.position.clone();
        const warn = this.addFx({ type: 'laneWarn', warn: true, x: start.x, y: start.y, dy: this.e.size * 0.3,
            ang: Math.atan2(dir.y, dir.x), len: lenFor(dir), width: a.radius * 2, life: focus });
        const m = o.chargeMotion || 'iaiCharge';
        this.motion = m;
        playSE('armor_charge');
        yield* this.sleep(focus, (p) => {
            if (p <= lockAt) { dir = this.dirToPlayer(); warn.ang = Math.atan2(dir.y, dir.x); warn.len = lenFor(dir); }
            this.face(dir);
            if (o.drawAt != null && !this.bladeOut && p >= o.drawAt) {
                this.bladeOut = true;
                playSE('armor_draw');
                this.addFx({ type: 'glint', follow: true, life: 0.4 });
            }
            // 開始の抜刀：柄を握っている間は drawSword、抜いた後は iaiCharge
            this.motion = m === 'drawSword' && this.bladeOut ? 'iaiCharge' : m;
            this.blade = this.bladeOut ? { mode: 'ready', p } : { mode: 'hilt', p };
            this.crouch = Math.min(1, p * 1.5);
            this.jitter = p > 0.8 ? 1 : 0;
        });
        yield* this.dash(dir, warn.len, a, o);
    }
    
    // まっすぐ駆け抜ける（壁では止まる。Enemy.moveBy が細かく区切って動かすので、速くても壁をすり抜けない）
    *dash(dir, len, a, o = {}) {
        this.motion = o.attackMotion || 'iaiAttack';
        this.bladeOut = true;
        this.airborne = true;      // 主人公をすり抜ける（体で押さない・体当たりしない）
        this.superArmor = true;
        const hb = this.addHitbox({ kind: 'circle', follow: true, r: a.radius, damage: this.dmg(a.damage), life: 99, shake: 5 });
        playSE(o.se || 'armor_iai');
        const from = this.e.position.clone();
        let t = 0, next = 0, moved = 0, last = from.clone();
        const maxT = len / a.speed + 0.2;
        while (moved < len - 4 && t < maxT) {
            const dt = yield;
            t += dt;
            moved += this.e.position.distance(last);
            last = this.e.position.clone();
            if (t > 0.04 && this.blocked) break;
            this.face(dir);
            this.blade = { mode: 'trail' };
            this.e.velocity = dir.mult(Math.min(a.speed, (len - moved) / Math.max(dt, 0.001)));
            next -= dt;
            if (next <= 0) { next = o.after || 0.04; this.ghostAfter(o.ghost ? 0.8 : 0.28, !!o.ghost); }
        }
        hb.used = true;
        hb.life = 0;
        this.e.velocity = new Vector2(0, 0);
        this.airborne = false;
        this.superArmor = false;
        const ang = Math.atan2(dir.y, dir.x);
        this.addFx({ type: 'iaiLine', x0: from.x, y0: from.y, x1: this.e.position.x, y1: this.e.position.y, life: 0.45, dark: !!o.ghost });
        this.addFx({ type: 'slash', follow: true, ang: ang + Math.PI, r: a.radius * 1.7, spread: 2.4, life: 0.3, color: o.ghost ? '#8d5cd6' : '#eedcff' });
        yield* this.sleep(0.12, () => { this.blade = { mode: 'trail' }; this.motion = o.attackMotion || 'iaiAttack'; });
    }
    
    // 扇の斬撃を1回（予告 → 一歩踏み込んで斬る）。k：何回目か（左右交互に振る）
    *slashOnce(a, windup, k, motion) {
        const dir = this.dirToPlayer();
        const side = k % 2 ? -1 : 1;
        const ang = Math.atan2(dir.y, dir.x) + side * 0.15;
        const r = a.reach + this.e.size * 0.35;
        const spread = a.spread || 1.9;
        this.addFx({ type: 'arcWarn', warn: true, follow: true, ang, r, spread, life: windup });
        this.motion = motion;
        yield* this.sleep(windup, (p) => { this.face(dir); this.motion = motion; this.blade = { mode: 'raised', side, p }; this.crouch = 0.3 * p; });
        this.e.moveBy(dir.mult(26));
        this.addHitbox({ kind: 'arc', follow: true, ang, r, spread, damage: this.dmg(a.damage), life: 0.12 });
        playSE('armor_slash');
        this.addFx({ type: 'slash', follow: true, ang, r: r * 0.9, spread: spread * 0.92, life: 0.26, color: this.dark ? '#b48cff' : '#ecdcff', reverse: side < 0 });
        yield* this.sleep(0.16, (p) => { this.face(dir); this.motion = motion; this.blade = { mode: 'swing', side, p }; });
    }
    
    // ---------- 第1形態 ----------
    // 抜刀斬り：約0.7秒の集中（途中まで主人公の方へ向き直す）→ 駆け抜けて斬る → 少しの隙
    *act_drawSlash(a) {
        yield* this.dashSlash(a, { lockAt: 0.6 });
        yield* this.recover(a.recover);
        yield* this.sheathe();
        yield* this.backOff(0.3);
    }
    
    // 集中居合い：集中を始めた時に向きが決まる（その後は追ってこない）。長い帯の予告 → とても速く駆け抜ける → 長めの隙
    *act_focusIai(a) {
        yield* this.dashSlash(a, { lockAt: 0 });
        yield* this.recover(a.recover);
        yield* this.sheathe();
    }
    
    // 高速踏み込み斬り：短い帯と、着いた所の扇の予告 → 一気に踏み込んで斬る
    *act_stepSlash(a) {
        yield* this.readyBlade();
        const dir = this.dirToPlayer();
        const ang = Math.atan2(dir.y, dir.x);
        const len = this.clampDash(dir, Math.max(0, Math.min(a.dist, this.dist() - a.reach * 0.5)));
        const r = a.reach + this.e.size * 0.35;
        const from = this.e.position.clone();
        const to = from.add(dir.mult(len));
        this.addFx({ type: 'laneWarn', warn: true, x: from.x, y: from.y, dy: this.e.size * 0.3, ang, len, width: this.e.size * 0.6, life: a.windup });
        this.addFx({ type: 'arcWarn', warn: true, x: to.x, y: to.y, ang, r, spread: a.spread, life: a.windup });
        this.motion = 'slash1';
        yield* this.sleep(a.windup, (p) => { this.face(dir); this.blade = { mode: 'raised', side: 1, p }; this.crouch = 0.5 * p; this.jitter = p > 0.75 ? 1 : 0; });
        this.airborne = true;
        yield* this.sleep(0.13, () => { this.face(dir); this.blade = { mode: 'raised', side: 1, p: 1 }; this.e.velocity = dir.mult(len / 0.13); });
        this.airborne = false;
        this.e.velocity = new Vector2(0, 0);
        this.addHitbox({ kind: 'arc', follow: true, ang, r, spread: a.spread, damage: this.dmg(a.damage), life: 0.12 });
        playSE('armor_slash');
        this.addFx({ type: 'slash', follow: true, ang, r: r * 0.9, spread: a.spread * 0.92, life: 0.26, color: '#ecdcff' });
        yield* this.sleep(0.18, (p) => { this.blade = { mode: 'swing', side: 1, p }; this.motion = 'slash1'; });
        yield* this.recover(a.recover);
        yield* this.backOff(0.3);
    }
    
    // 二連斬り（近く）
    *act_doubleSlash(a) {
        yield* this.readyBlade();
        yield* this.approach(150 * this.R, 0.7);
        yield* this.slashOnce(a, a.windup, 0, 'doubleSlash');
        yield* this.slashOnce(a, a.windup2, 1, 'doubleSlash');
        yield* this.recover(a.recover);
        yield* this.backOff(0.35);
    }
    
    // ---------- 第2形態 ----------
    // 三連斬り
    *act_tripleSlash(a) {
        yield* this.readyBlade();
        yield* this.approach(150 * this.R, 0.8);
        for (let i = 0; i < (a.hits || 3); i++) yield* this.slashOnce(a, i === 0 ? a.windup : a.windup2, i, 'tripleSlash');
        yield* this.recover(a.recover);
        yield* this.backOff(0.35);
    }
    
    // 風刃（本体だけ）：刀を振って、扇形に風の刃を飛ばす
    *act_windSlash(a) {
        yield* this.readyBlade();
        this.motion = 'windSlash';
        const dir0 = this.dirToPlayer();
        const ang0 = Math.atan2(dir0.y, dir0.x);
        for (let i = 0; i < a.count; i++) {
            const k = a.count === 1 ? 0 : i / (a.count - 1) - 0.5;
            this.addFx({ type: 'windWarn', warn: true, x: this.e.position.x, y: this.e.position.y, ang: ang0 + k * a.spread * (a.count - 1), len: 520, width: a.radius * 2, life: a.windup });
        }
        yield* this.sleep(a.windup, (p) => { this.face(dir0); this.motion = 'windSlash'; this.blade = { mode: 'raised', side: 1, p }; });
        for (let i = 0; i < a.count; i++) {
            const k = a.count === 1 ? 0 : i / (a.count - 1) - 0.5;
            const aa = ang0 + k * a.spread * (a.count - 1);
            this.spawnBlade(this.e.position, new Vector2(Math.cos(aa), Math.sin(aa)), a, 'body');
        }
        this.addFx({ type: 'slash', follow: true, ang: ang0, r: this.e.size * 0.9, spread: 2.2, life: 0.26, color: '#d8f0ff' });
        yield* this.sleep(0.2, (p) => { this.blade = { mode: 'swing', side: 1, p }; });
        yield* this.recover(a.recover);
        yield* this.backOff(0.3);
    }
    
    // 風刃を1つ出す
    spawnBlade(from, dir, a, owner) {
        const d = dir.normalize();
        this.blades.push({ id: `wind_${++this.bladeSeq}`, x: from.x, y: from.y, px: from.x, py: from.y,
            vx: d.x * a.speed, vy: d.y * a.speed, r: a.radius, damage: this.dmg(a.damage), age: 0, travel: 0, max: a.dist || 1100, owner });
        playSE('armor_wind');
    }
    
    shooterPos(id) {
        if (id === 'body') return this.e.isAlive() ? this.e.position.clone() : null;
        const c = this.clones.find(k => k.id === id && !k.dying);
        return c ? new Vector2(c.x, c.y) : null;
    }
    
    // 分身の並ぶ6つの点：主人公を中心にした円の 0・60・120・180・240・300 度
    // ステージの外や置き物に重なる点があれば、円ごとステージの中心の方へずらす（それでもだめな点は近くの置ける所へ）
    circlePoints() {
        const map = this.e.map, foot = this.e.getFootBox(), R0 = this.T.cloneRadius;
        const ok = (q) => !map || !map.isBoxBlocked(q.x + foot.ox, q.y + foot.oy, foot.hw, foot.hh);
        const base = this.player.position.clone();
        const toC = map && map.center ? map.center.sub(base) : new Vector2(0, 0);
        const ring = (c, R) => [0, 1, 2, 3, 4, 5].map(i => new Vector2(c.x + Math.cos(i * Math.PI / 3) * R, c.y + Math.sin(i * Math.PI / 3) * R));
        // 主人公を囲めるように、まず円を小さくしてみて、それでも置けない時だけ円を中心の方へずらす
        for (let step = 0; step <= 12; step++) {
            for (const k of [1, 0.85, 0.72]) {
                const pts = ring(base.add(toC.mult(step / 12)), R0 * k);
                if (pts.every(ok)) return pts;
            }
        }
        return ring(base, R0).map(q => (map ? map.findFreeSpot(q, foot, 260) : q));
    }
    
    makeClone(p) {
        const v = this.player.position.sub(p);
        const facing = v.length() > 1 ? v.normalize() : new Vector2(0, 1);
        return { id: `clone_${++this.cloneSeq}`, x: p.x, y: p.y, t: 0, fade: 0, dying: false, hidden: false, shimmer: 0, flash: 0,
            facing, dir: GrudgeArmorAI.dirName(facing) };
    }
    
    // 分身が消える（本体をノックバックした時・形態が変わる時）。風刃と撃つ予定も消える
    dispelClones(quiet = false) {
        const live = this.liveClones();
        for (const c of live) {
            c.dying = true;
            this.addFx({ type: 'mistBurst', x: c.x, y: c.y + this.e.size * 0.45, r: this.e.size * 0.75, life: 0.7, n: 6 });
        }
        for (const b of this.blades) this.addFx({ type: 'mistBurst', x: b.x, y: b.y, r: 26, life: 0.35, n: 3 });
        this.blades = [];
        this.shotQueue = [];
        this.fx = this.fx.filter(f => f.type !== 'windWarn' && f.type !== 'cloneMark');
        if (live.length && !quiet) playSE('armor_clone_break');
    }
    
    // 分身召喚：刀を地面に突き立てる → 黒い霧 → 6つの点が光る → 本体と分身5体が現れる
    *summonClones() {
        this.superArmor = true;
        this.invulnerable = true;
        this.summoning = true;
        yield* this.readyBlade();
        this.motion = 'cloneSummon';
        yield* this.sleep(0.3, (p) => { this.blade = { mode: 'raise', p }; this.face(this.dirToPlayer()); });
        playSE('armor_stab');
        const at = this.feet();
        this.events.push({ type: 'shake', power: 5, time: 0.3 });
        this.addFx({ type: 'crack', x: at.x, y: at.y, r: this.e.size * 1.1, life: 1.6, seed: Math.random(), color: 'rgba(120, 60, 170, 1)' });
        this.addFx({ type: 'mistBurst', x: at.x, y: at.y, r: this.e.size * 1.3, life: 1.0, n: 9 });
        const pts = this.circlePoints();
        for (const q of pts) this.addFx({ type: 'cloneMark', x: q.x, y: q.y + this.e.size * 0.45, life: 1.3 });
        playSE('armor_clone');
        yield* this.sleep(0.65, () => { this.motion = 'cloneSummon'; this.blade = { mode: 'stab' }; this.crouch = 0.5; });
        // 本体が霧になって消え、6つの点のどれかに現れる。残りの5つには分身
        yield* this.sleep(0.3, (p) => { this.fade = 1 - p; this.blade = { mode: 'stab' }; });
        const bodyIdx = Math.floor(Math.random() * 6);
        this.e.position = pts[bodyIdx].clone();
        this.clones = pts.filter((_, i) => i !== bodyIdx).map(q => this.makeClone(q));
        this.face(this.dirToPlayer());
        yield* this.sleep(0.35, (p) => { this.fade = p; this.motion = 'cloneSummon'; });
        this.fade = 1;
        this.superArmor = false;
        this.invulnerable = false;
        this.summoning = false;
    }
    
    // 分身召喚（クールダウンが終わった時に選ばれる）→ そのまま六影風刃
    *act_cloneSummon(a) {
        yield* this.summonClones();
        yield* this.barrage(this.atk('sixWind'));
    }
    
    // 六影風刃：分身がいなければ呼んでから
    *act_sixWind(a) {
        if (!this.liveClones().length) yield* this.summonClones();
        yield* this.barrage(a);
    }
    
    // 6体（本体＋分身）が順番に風刃を撃ち続ける（0.2〜0.4 秒ずつずらす）。本体がノックバックするまで止まらない
    // 撃つ前に、撃つ体から主人公への線の予告（a.warn 秒。線の向きにまっすぐ飛ぶ）
    // shuffleEvery 回撃つごとに、6体が霧になって主人公のまわりに並び直す（本体の場所も変わる）
    *barrage(a) {
        let volley = 0;
        while (true) {
            const ids = ['body', ...this.liveClones().map(c => c.id)];
            for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
            for (const id of ids) {
                const src = this.shooterPos(id);
                if (!src) continue;
                const v = this.player.position.sub(src);
                const dir = v.length() > 1 ? v.normalize() : new Vector2(0, 1);
                this.addFx({ type: 'windWarn', warn: true, x: src.x, y: src.y, ang: Math.atan2(dir.y, dir.x), len: Math.min(a.dist, v.length() + 260), width: a.radius * 2, life: a.warn, owner: id });
                this.shotQueue.push({ at: this.clock + a.warn, src: id, dir });
                const gap = a.gapMin + Math.random() * (a.gapMax - a.gapMin);
                yield* this.sleep(gap, () => { this.face(this.dirToPlayer()); this.motion = 'windSlash'; this.blade = { mode: 'raised', side: 1, p: 0.7 }; });
            }
            yield* this.sleep(a.volleyGap, () => { this.face(this.dirToPlayer()); this.motion = 'idle'; });
            volley++;
            if (a.shuffleEvery && volley % a.shuffleEvery === 0) yield* this.reshuffle();
        }
    }
    
    // 6体が霧になって消え、主人公のまわりの新しい円に並び直す（分身の id はそのまま）
    *reshuffle() {
        this.invulnerable = true;
        for (const c of this.liveClones()) c.hidden = true;
        yield* this.sleep(0.35, (p) => { this.fade = 1 - p; });
        const pts = this.circlePoints();
        const bodyIdx = Math.floor(Math.random() * 6);
        this.e.position = pts[bodyIdx].clone();
        const live = this.liveClones();
        pts.filter((_, i) => i !== bodyIdx).forEach((q, i) => { if (live[i]) { live[i].x = q.x; live[i].y = q.y; } });
        for (const q of pts) this.addFx({ type: 'cloneMark', x: q.x, y: q.y + this.e.size * 0.45, life: 0.7 });
        for (const c of live) c.hidden = false;
        yield* this.sleep(0.35, (p) => { this.fade = p; this.face(this.dirToPlayer()); });
        this.fade = 1;
        this.invulnerable = false;
    }
    
    // ---------- 第3形態 ----------
    // 主人公のまわり（radius px、ang の向き）の、ボスが立てる所。画面の中に収まる所を選ぶ
    pointAround(radius, ang) {
        const map = this.e.map, foot = this.e.getFootBox(), p = this.player.position;
        for (let k = 0; k < 8; k++) {
            const a = ang + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45;
            const q = new Vector2(p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius * 0.85);
            if (!map || !map.isBoxBlocked(q.x + foot.ox, q.y + foot.oy, foot.hw, foot.hh)) return q;
        }
        return map ? map.findFreeSpot(this.e.position, foot, 200) : this.e.position.clone();
    }
    
    // 闇の居合い：霧の中で間合いを取る → 目が強く光る（予告）→ 帯の予告 → 駆け抜けて斬る
    *act_darkIai(a) {
        const n = this.dirToPlayer().mult(-1);
        yield* this.ghostShift(this.pointAround(a.dist * 0.55, Math.atan2(n.y, n.x) + (Math.random() - 0.5) * 1.2), 0.6);
        this.addFx({ type: 'eyesFlare', follow: true, life: a.eyes, seen: true });
        playSE('armor_eyes');
        yield* this.sleep(a.eyes, () => { this.face(this.dirToPlayer()); this.motion = 'glowingEyes'; this.blade = this.bladeOut ? { mode: 'ready' } : { mode: 'hilt' }; });
        yield* this.dashSlash(a, { lockAt: 0.5, chargeMotion: 'darkIai', attackMotion: 'darkIai' });
        yield* this.recover(a.recover);
    }
    
    // 幽影連斬：霧になって消え、主人公のまわりの別の所に現れて斬る（1回ごとに目の位置が変わる）
    *act_shadowCombo(a) {
        yield* this.readyBlade();
        const base = Math.random() * Math.PI * 2;
        for (let i = 0; i < a.hits; i++) {
            const ang = base + i * (Math.PI * 2 / a.hits) + (Math.random() - 0.5) * 0.6;
            const dest = this.pointAround(a.around * this.R, ang);
            this.addFx({ type: 'mistBurst', x: this.e.position.x, y: this.feet().y, r: this.e.size * 0.6, life: 0.45, n: 4, seen: true });
            this.e.position = dest;
            this.face(this.dirToPlayer());
            this.addFx({ type: 'mistBurst', x: dest.x, y: this.feet().y, r: this.e.size * 0.6, life: 0.45, n: 4, seen: true });
            this.addFx({ type: 'eyesFlare', follow: true, life: 0.35, seen: true });
            yield* this.slashOnce(a, i === 0 ? a.windup : a.windup2, i, 'shadowCombo');
        }
        yield* this.recover(a.recover);
        yield* this.backOff(0.3);
    }
    
    // 黒霧の突進：帯の予告 → 黒い霧になって突き抜ける（残像を残す）
    *act_mistRush(a) {
        yield* this.readyBlade();
        yield* this.dashSlash(a, { lockAt: 0.4, keepBlade: true, chargeMotion: 'darkAura', attackMotion: 'ghostMove', ghost: true, after: 0.03, se: 'armor_rush' });
        yield* this.recover(a.recover);
    }
    
    // 火を消しに行く：灯っている火のそばへ行って斬り消す（1回で TUNING.extinguishPerWave 個まで。最後の1つは残す）
    *act_extinguishFire(a) {
        const map = this.map;
        if (!map) return;
        const lit = map.litFires();
        const n = Math.min(this.T.extinguishPerWave, lit.length - 1);
        if (n <= 0) return;
        for (let i = lit.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lit[i], lit[j]] = [lit[j], lit[i]]; }
        yield* this.readyBlade();
        for (const f of lit.slice(0, n)) {
            if (f.state !== 'lit' || map.litFires().length <= 1) continue;
            yield* this.ghostShift(f.stand, 1.8, a.speed);
            // 壁の角などで届かなかった：霧になって火のそばへ移る（立つ所は歩ける所なので、壁の中には出ない）
            if (this.e.position.distance(f.stand) > 90) yield* this.mistWarp(f.stand);
            if (f.state !== 'lit' || map.litFires().length <= 1) continue;
            const v = new Vector2(f.x - this.e.position.x, f.y - this.e.position.y);
            this.motion = 'extinguishFire';
            yield* this.sleep(0.28, (p) => { this.face(v); this.motion = 'extinguishFire'; this.blade = { mode: 'raised', side: 1, p }; });
            this.addFx({ type: 'slash', follow: true, ang: Math.atan2(v.y, v.x), r: this.e.size * 1.0, spread: 2.4, life: 0.25, color: '#e8d8ff', seen: true });
            playSE('armor_slash');
            map.extinguish(f);
            yield* this.sleep(a.slash, (p) => { this.blade = { mode: 'swing', side: 1, p }; });
        }
        yield* this.sleep(0.2);
    }
    
    // ステージの火を回る順番（近い順につないでいく）
    fireRoute() {
        const map = this.map;
        if (!map) return [];
        const rest = map.battleFires.filter(f => f.state !== 'extinguished');
        const out = [];
        let at = this.e.position;
        while (rest.length) {
            let bi = 0, bd = Infinity;
            rest.forEach((f, i) => { const d = f.stand.distance(at); if (d < bd) { bd = d; bi = i; } });
            const f = rest.splice(bi, 1)[0];
            out.push(f);
            at = f.stand;
        }
        return out;
    }
    
    // 主人公から離れた、画面の中に収まる所（暗闇の始まりに目だけを光らせる所）
    farPoint() {
        const map = this.e.map, foot = this.e.getFootBox(), p = this.player.position;
        let best = null, bd = -1;
        for (let i = 0; i < 24; i++) {
            const a = i / 24 * Math.PI * 2;
            for (const r of [560, 470, 380]) {
                const q = new Vector2(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.55);
                if (Math.abs(q.x - p.x) > 560 || Math.abs(q.y - p.y) > 300) continue;
                if (map && map.isBoxBlocked(q.x + foot.ox, q.y + foot.oy, foot.hw, foot.hh)) continue;
                const d = q.distance(p) + Math.random() * 40;
                if (d > bd) { bd = d; best = q; }
                break;
            }
        }
        return best || this.e.position.clone();
    }
    
    // ---------- フェーズ移行 ----------
    *transition(index) {
        this.superArmor = true;
        this.invulnerable = true;
        if (index === 1) yield* this.phase2Start();
        else yield* this.phase3Start();
        this.superArmor = false;
        this.invulnerable = false;
    }
    
    // 第2形態「六影の怨嗟」：怨嗟の声 → 刀を地面に突き立てる → 霧の中に6つの点 → 本体と分身（この後の大技は六影風刃）
    *phase2Start() {
        this.motion = 'phase2Start';
        this.roarVoice('armor_roar');
        this.roarBlast();
        yield* this.sleep(0.6, (p, dt) => { this.motion = 'phase2Start'; this.face(new Vector2(0, 1)); this.jitter = 1.5; this.roarPush(dt); });
        yield* this.summonClones();
        this.superArmor = true;
        this.invulnerable = true;
    }
    
    // 第3形態「常闇の剣鬼」：怨嗟の咆哮 → ステージ中を駆けて火をすべて斬り消す → 黒い霧 → 暗闇 → 遠くに目だけが光る
    // カメラ（BossAI.finalTransition）：咆哮から火を斬り消し終わるまではボスを追いかけ、暗闇になる所で主人公に戻す
    *phase3Start() {
        const map = this.map, T = this.T;
        this.motion = 'phase3Start';
        this.dispelClones(true);
        // 怨嗟の咆哮：紫の衝撃波と黒い霧
        this.roarVoice('armor_roar');
        this.events.push({ type: 'shake', power: 8, time: 0.8 });
        this.addFx({ type: 'darkAura', follow: true, life: T.p3Roar + 0.5 });
        let wave = 0;
        yield* this.sleep(T.p3Roar, (p, dt) => {
            this.motion = 'phase3Start';
            this.face(new Vector2(0, 1));
            this.jitter = 1.8;
            this.roarPush(dt);
            wave -= dt;
            if (wave <= 0) {
                wave = 0.3;
                this.addFx({ type: 'shock', follow: true, feet: true, r0: 30, r1: 250, life: 0.65, width: 6, color: '#b98aff' });
                this.addFx({ type: 'roar', follow: true, life: 0.42, seed: Math.random(), color: '#e0ccff' });
            }
        });
        yield* this.readyBlade();
        // 火を1つずつ斬り消す（演出なので、壁があっても霧になって通る。止まる所は火のそばの歩ける所）
        // ステージ中を速く駆けるので、カメラも速く追いかける
        this.cineCamera(true, T.fireCam);
        for (const f of this.fireRoute()) {
            const from = this.e.position.clone(), to = f.stand;
            let next = 0;
            yield* this.sleep(T.fireDash, (p, dt) => {
                this.motion = 'ghostMove';
                this.e.position = from.add(to.sub(from).mult(1 - (1 - p) * (1 - p)));
                this.face(to.sub(from));
                next -= dt;
                if (next <= 0) { next = 0.04; this.ghostAfter(0.35, true); }
            });
            const v = new Vector2(f.x - this.e.position.x, f.y - this.e.position.y);
            this.face(v);
            this.motion = 'extinguishFire';
            this.addFx({ type: 'slash', follow: true, ang: Math.atan2(v.y, v.x), r: this.e.size * 1.0, spread: 2.6, life: 0.3, color: '#f0e0ff' });
            playSE('armor_slash');
            if (map) map.extinguish(f);
            yield* this.sleep(T.fireHold, (p) => { this.blade = { mode: 'swing', side: 1, p }; });
        }
        // 外の城壁の松明も、風で一度に消える
        if (map) { for (const f of map.fires) if (f.ambient) map.extinguish(f, true); }
        playSE('fire_out');
        // 黒い霧 → 暗闇。主人公だけが見える
        const at = this.feet();
        this.addFx({ type: 'mistBurst', x: at.x, y: at.y, r: this.e.size * 2.2, life: 1.4, n: 14 });
        this.motion = 'darkAura';
        if (map) map.setDarkness(1);
        // カメラを主人公に戻す（暗闇の中で主人公だけが見え、遠くに目が光るのを映す）
        this.cineCamera(false);
        this.dark = true;
        this.materialized = false;
        yield* this.sleep(0.9, (p) => { this.fade = 1 - p; this.motion = 'darkAura'; });
        // 遠くに移って、しばらくしてから目だけが光る
        this.e.position = this.farPoint();
        this.face(this.dirToPlayer());
        yield* this.sleep(0.8, () => { this.fade = 0; });
        this.fade = 1;
        this.addFx({ type: 'eyesFlare', follow: true, life: 1.0, seen: true });
        playSE('armor_eyes');
        yield* this.sleep(0.7, () => { this.motion = 'glowingEyes'; this.face(this.dirToPlayer()); });
        this.extinguishTimer = this.T.firstExtinguish;
    }
    
    // ---------- 当たり判定（風刃） ----------
    checkHits(player) {
        super.checkHits(player);
        const pr = 18;
        for (const b of this.blades) {
            if (b.used) continue;
            // 前のフレームの位置から今の位置までの線で調べる（速くても主人公をすり抜けない）
            const ax = b.px, ay = b.py, dx = b.x - ax, dy = b.y - ay;
            const L2 = dx * dx + dy * dy;
            const k = L2 > 0 ? Math.max(0, Math.min(1, ((player.position.x - ax) * dx + (player.position.y - ay) * dy) / L2)) : 0;
            const d = Math.hypot(player.position.x - (ax + dx * k), player.position.y - (ay + dy * k));
            if (d > b.r + pr) continue;
            if (BossAI.skipHit(player)) { b.used = true; continue; }
            if (player.isDodging) { player.takeDamage(b.damage, new Vector2(b.x, b.y)); continue; } // ジャスト回避の判定だけ
            const dealt = player.takeDamage(b.damage, new Vector2(b.x - b.vx * 0.05, b.y - b.vy * 0.05));
            if (dealt > 0) {
                b.used = true;
                b.dead = true;
                this.events.push({ type: 'hit', power: 4 });
            }
        }
    }
    
    // ---------- 奥行き順に描く物（分身。game.js が主人公・置き物と一緒に並べる） ----------
    getDepthDrawables() {
        return this.clones.map(c => ({ sortY: c.y + this.e.size * 0.55, draw: (ctx, cam) => this.drawClone(ctx, cam, c) }));
    }
    
    // 分身：半透明で、足元の影がない。目は本体より少し暗い。斬られるとゆらぐ
    drawClone(ctx, cam, c) {
        if (c.fade <= 0.01) return;
        const s = new Vector2(c.x - cam.x, c.y - cam.y);
        const flick = c.shimmer > 0 ? 0.45 + 0.55 * Math.abs(Math.sin(c.shimmer * 40)) : 1;
        const wob = c.shimmer > 0 ? Math.sin(c.shimmer * 60) * 6 : 0;
        Enemy.drawGrudgeArmor(this.e, ctx, new Vector2(s.x + wob, s.y), this.lift, {
            clone: true, alpha: 0.5 * c.fade * flick, dir: c.dir, facing: c.facing, eyes: 0.55, flash: c.flash > 0 ? 0.6 : 0 });
    }
    
    // ---------- 描画 ----------
    // fx を一時的にしぼって描く（暗闇の時、予告と残像だけを暗闇の上に描き直す）
    withFx(pred, fn) {
        const all = this.fx;
        this.fx = all.filter(pred);
        try { fn(); } finally { this.fx = all; }
    }
    
    drawGround(ctx, cam) {
        const dark = this.darkLevel() > 0.02;
        // 暗闇の時、予告と「見える」残像は暗闇の上に描く（drawAbove）
        this.withFx(f => !(dark && (f.warn || f.seen)), () => { super.drawGround(ctx, cam); this.drawMyGround(ctx, cam); });
        // 黒い霧のもや（足元）
        if (this.e.isAlive() && this.bodyAlpha > 0.05) {
            const p = this.feet().sub(cam);
            const r = this.e.size * 0.95;
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            g.addColorStop(0, `rgba(40, 10, 60, ${0.35 * this.bodyAlpha})`);
            g.addColorStop(1, 'rgba(20, 0, 30, 0)');
            ctx.save();
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
    }
    
    drawAbove(ctx, cam) {
        const dark = this.darkLevel();
        if (dark > 0.01 && this.map) {
            this.map.drawDarkness(ctx, cam, this.lights());
            // 暗闇の上に描き直す：攻撃の予告・霧の残像・目
            this.withFx(f => f.warn || f.seen, () => { super.drawGround(ctx, cam); this.drawMyGround(ctx, cam); this.drawMyAbove(ctx, cam); });
            if (this.e.isAlive()) this.drawEyes(ctx, cam);
        }
        this.drawBlades(ctx, cam);
        this.withFx(f => !(dark > 0.02 && f.seen), () => { super.drawAbove(ctx, cam); this.drawMyAbove(ctx, cam); });
        this.drawTexts(ctx, cam);
    }
    
    // 暗闇の中の明かり：主人公のまわり（自分だけ見える）・魔法の弾や炎・実体化したボスの紫の光
    lights() {
        const L = [];
        const p = this.player;
        if (p) L.push({ x: p.position.x, y: p.position.y + 6, r: 150, k: 1 });
        const ms = window.game && window.game.magicSystem;
        if (ms) {
            for (const pr of ms.projectiles) if (pr.active) L.push({ x: pr.position.x, y: pr.position.y, r: pr.magic.element === '炎' ? 170 : 90, k: 0.9 });
            for (const f of ms.firePatches) L.push({ x: f.position.x, y: f.position.y, r: 110, k: 0.8 });
            for (const s of ms.strikes) L.push({ x: s.position.x, y: s.position.y, r: 240, k: 0.9 });
            for (const t of ms.tornados) L.push({ x: t.position.x, y: t.position.y, r: 90, k: 0.6 });
        }
        if (this.materialized && this.e.isAlive()) L.push({ x: this.e.position.x, y: this.e.position.y, r: 170, k: 0.55 });
        return L;
    }
    
    // 目（暗闇の上）：Enemy.drawGrudgeArmor が描いた時の目の位置に、光る点
    drawEyes(ctx, cam) {
        const eyes = this.e._armorEyes;
        if (!eyes || this.fade <= 0.01) return;
        const flare = this.fx.some(f => f.type === 'eyesFlare') ? 1 : 0;
        const k = (this.materialized ? 0.7 : 1) * (1 + flare * 0.8) * this.fade;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const q of eyes) {
            const r = (10 + flare * 10) * (q.k || 1);
            const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
            g.addColorStop(0, `rgba(255, 240, 255, ${Math.min(1, 0.95 * k)})`);
            g.addColorStop(0.3, `rgba(200, 120, 255, ${Math.min(1, 0.8 * k)})`);
            g.addColorStop(1, 'rgba(120, 40, 200, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(q.x - r, q.y - r, r * 2, r * 2);
        }
        ctx.restore();
    }
    
    // 風刃：白く光る三日月（進む向きに）
    drawBlades(ctx, cam) {
        ctx.save();
        for (const b of this.blades) {
            const x = b.x - cam.x, y = b.y - cam.y;
            const ang = Math.atan2(b.vy, b.vx);
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(ang);
            ctx.globalCompositeOperation = 'lighter';
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, b.r * 2.2);
            g.addColorStop(0, 'rgba(210, 240, 255, 0.5)');
            g.addColorStop(1, 'rgba(120, 90, 255, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(-b.r * 2.2, -b.r * 2.2, b.r * 4.4, b.r * 4.4);
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(120, 80, 220, 0.6)';
            ctx.lineWidth = 9;
            ctx.beginPath(); ctx.arc(-b.r * 0.6, 0, b.r * 1.4, -1.0, 1.0); ctx.stroke();
            ctx.strokeStyle = '#f2f8ff';
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(-b.r * 0.6, 0, b.r * 1.4, -0.95, 0.95); ctx.stroke();
            // 後ろの風の筋
            ctx.strokeStyle = 'rgba(220, 235, 255, 0.45)';
            ctx.lineWidth = 2;
            for (const oy of [-0.6, 0, 0.6]) { ctx.beginPath(); ctx.moveTo(-b.r * 0.9, oy * b.r); ctx.lineTo(-b.r * 3.2, oy * b.r * 1.3); ctx.stroke(); }
            ctx.restore();
        }
        ctx.restore();
    }
    
    drawTexts(ctx, cam) {
        if (!this.texts.length) return;
        ctx.save();
        ctx.font = 'bold 20px "DotGothic16", sans-serif';
        ctx.textAlign = 'center';
        for (const t of this.texts) {
            const k = t.age / t.life;
            const x = t.x - cam.x, y = t.y - cam.y - k * 26;
            ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
            ctx.lineWidth = 4; ctx.strokeStyle = '#120618';
            ctx.strokeText(t.text, x, y);
            ctx.fillStyle = t.color;
            ctx.fillText(t.text, x, y);
        }
        ctx.restore();
    }
    
    // 地面に描く物（この鎧だけの演出）
    drawMyGround(ctx, cam) {
        for (const f of this.fx) {
            const t = Math.min(1, f.age / f.life);
            ctx.save();
            if (f.type === 'cloneMark') {
                // 分身の出る印：紫の魔法陣が地面に光る
                const img = window.assetManager && window.assetManager.get('bf_magic_circle');
                const x = f.x - cam.x, y = f.y - cam.y;
                const a = t < 0.2 ? t / 0.2 : t > 0.75 ? (1 - t) / 0.25 : 1;
                const w = this.e.size * 1.6 * (0.7 + 0.3 * Math.min(1, t * 3)), h = w * 0.5;
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = a * 0.85;
                if (img) ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
                else { ctx.strokeStyle = '#b77bff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
                const g = ctx.createRadialGradient(x, y - 30, 0, x, y - 30, 70);
                g.addColorStop(0, `rgba(210, 160, 255, ${0.7 * a})`);
                g.addColorStop(1, 'rgba(120, 40, 200, 0)');
                ctx.fillStyle = g;
                ctx.fillRect(x - 70, y - 100, 140, 140);
            } else if (f.type === 'windWarn') {
                // 風刃の予告：撃つ体から、飛んでいく向きの細い帯
                const col = this.warnColor, L = BossAI.warnLook(t, this.time);
                const x = f.x - cam.x, y = f.y - cam.y;
                ctx.translate(x, y);
                ctx.rotate(f.ang);
                ctx.fillStyle = col;
                ctx.globalAlpha = L.fill * 0.9; ctx.fillRect(0, -f.width / 2, f.len, f.width);
                ctx.globalAlpha = L.inner * 0.8; ctx.fillRect(0, -f.width / 4, f.len * t, f.width / 2);
                BossAI.strokeWarn(ctx, L, () => { ctx.beginPath(); ctx.rect(0, -f.width / 2, f.len, f.width); });
            } else if (f.type === 'armorGhost') {
                // 残像：体の形の紫の影（黒霧の突進は黒い霧の影で、長く残る）
                const s = new Vector2(f.x - cam.x, f.y - cam.y);
                Enemy.drawGrudgeArmor(this.e, ctx, s, f.lift || 0, { clone: true, alpha: (f.dark ? 0.55 : 0.4) * (1 - t), dir: f.dir, facing: f.facing,
                    tint: f.dark ? '#1a0826' : '#7a45c8', eyes: f.dark ? 0.4 : 0 });
            }
            ctx.restore();
        }
    }
    
    // キャラより手前に描く物（この鎧だけの演出）
    drawMyAbove(ctx, cam) {
        for (const f of this.fx) {
            const t = Math.min(1, f.age / f.life);
            const p = this.fxPos(f).sub(cam);
            ctx.save();
            switch (f.type) {
                case 'iaiLine': {
                    // 居合いの跡：駆け抜けた道に残る光の線（黒霧の突進は暗い紫）
                    const x0 = f.x0 - cam.x, y0 = f.y0 - cam.y, x1 = f.x1 - cam.x, y1 = f.y1 - cam.y;
                    ctx.lineCap = 'round';
                    ctx.globalAlpha = (1 - t) * 0.8;
                    ctx.strokeStyle = f.dark ? '#4a1d78' : '#a77cff';
                    ctx.lineWidth = 12 * (1 - t) + 2;
                    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
                    ctx.globalAlpha = 1 - t;
                    ctx.strokeStyle = f.dark ? '#b48cff' : '#ffffff';
                    ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
                    break;
                }
                case 'glint': {
                    // 刀を抜いた光
                    const x = p.x + this.facing.x * this.e.size * 0.5, y = p.y - this.e.size * 0.55 - this.lift;
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.globalAlpha = 1 - t;
                    ctx.fillStyle = '#ffffff';
                    const s = 18 * (1 - t * 0.5);
                    ctx.beginPath();
                    ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.18, y - s * 0.18); ctx.lineTo(x + s, y); ctx.lineTo(x + s * 0.18, y + s * 0.18);
                    ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.18, y + s * 0.18); ctx.lineTo(x - s, y); ctx.lineTo(x - s * 0.18, y - s * 0.18);
                    ctx.closePath(); ctx.fill();
                    break;
                }
                case 'mistBurst': {
                    // 黒い霧が広がって消える
                    const img = window.assetManager && window.assetManager.get(`bf_mist_${1 + ((f.n || 5) % 5)}`);
                    const n = f.n || 5;
                    for (let i = 0; i < n; i++) {
                        const a = i / n * Math.PI * 2 + (f.seed || 0);
                        const rr = f.r * (0.3 + t * 0.9);
                        const x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr * 0.45 - t * 20;
                        ctx.globalAlpha = (1 - t) * 0.65;
                        if (img) {
                            const w = f.r * 0.9 * (0.6 + t * 0.6), h = w * img.height / img.width;
                            ctx.drawImage(img, x - w / 2, y - h * 0.7, w, h);
                        } else {
                            ctx.fillStyle = i % 2 ? 'rgba(60, 20, 90, 0.8)' : 'rgba(15, 5, 25, 0.8)';
                            ctx.beginPath(); ctx.arc(x, y - 10, f.r * 0.25 * (1 + t), 0, Math.PI * 2); ctx.fill();
                        }
                    }
                    break;
                }
                case 'ward': {
                    // 魔法が効かない・すり抜けた：紫の膜が一瞬光る
                    const rx = this.e.size * 0.7, ry = this.e.size * 0.95;
                    const cy = p.y - this.e.size * 0.35 - this.lift;
                    ctx.globalAlpha = (1 - t) * 0.7;
                    ctx.strokeStyle = '#cdb8ff'; ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.ellipse(p.x, cy, rx * (1 + t * 0.2), ry * (1 + t * 0.2), 0, 0, Math.PI * 2); ctx.stroke();
                    ctx.globalAlpha = (1 - t) * 0.18;
                    ctx.fillStyle = '#8f6cff';
                    ctx.fill();
                    break;
                }
                case 'materialize': {
                    // 実体化：紫の輪が縮まり、体が光る
                    ctx.globalCompositeOperation = 'lighter';
                    const cy = p.y - this.e.size * 0.3 - this.lift;
                    ctx.globalAlpha = (1 - t) * 0.9;
                    ctx.strokeStyle = '#e2c8ff'; ctx.lineWidth = 4;
                    const r = this.e.size * (1.6 - t * 0.9);
                    ctx.beginPath(); ctx.ellipse(p.x, cy + this.e.size * 0.6, r, r * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
                    const g = ctx.createRadialGradient(p.x, cy, 0, p.x, cy, this.e.size);
                    g.addColorStop(0, `rgba(220, 180, 255, ${0.5 * (1 - t)})`);
                    g.addColorStop(1, 'rgba(120, 60, 220, 0)');
                    ctx.fillStyle = g;
                    ctx.fillRect(p.x - this.e.size, cy - this.e.size, this.e.size * 2, this.e.size * 2);
                    break;
                }
                case 'darkAura': {
                    // 黒い炎のような霧が体から立ちのぼる
                    for (let i = 0; i < 10; i++) {
                        const k = (t * 1.6 + i / 10) % 1;
                        const x = p.x + Math.sin(i * 2.4 + this.time * 3) * this.e.size * 0.5;
                        const y = p.y + this.e.size * 0.4 - k * this.e.size * 1.6 - this.lift;
                        ctx.globalAlpha = (1 - k) * 0.6 * (1 - t * 0.5);
                        ctx.fillStyle = i % 3 === 0 ? '#7a3cc0' : '#160a22';
                        ctx.beginPath(); ctx.arc(x, y, 8 * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
                    }
                    break;
                }
            }
            ctx.restore();
        }
    }
}

// 向きの名前（down / up / left / right）
GrudgeArmorAI.dirName = function (v) {
    if (Math.abs(v.x) > Math.abs(v.y) * 1.05) return v.x < 0 ? 'left' : 'right';
    return v.y < 0 ? 'up' : 'down';
};

// 怨嗟の鎧の調整（攻撃ごとの数値は boss_data.js の attacks）
// keepDist / keepDistDark：攻撃していない時に保つ距離(px)（暗闇では少し遠くを回る）
// cloneRadius：分身が並ぶ円の半径(px) / cloneCooldown：分身が消えてから、また呼べるまでの秒数 / stun：分身を消された後の気絶(秒)
// materializeMin：実体化してから最低この秒数は斬れる
// extinguishInterval：第3形態で火を消しに行く間隔(秒) / extinguishPerWave：1回で消す火の数（灯っている火が1つなら消さない。最後の1つは残す）
// firstExtinguish：暗闇になってから、最初に火を消しに行くまで(秒) / feedbackGap：「魔法無効」などの文字を出す間隔(秒)
// 第3形態への移行（phase3Start）：p3Roar = 咆哮の長さ(秒) / fireDash = 次の火まで駆ける時間(秒) / fireHold = 火を斬った後に止まる時間(秒)
//   fireCam = 火を回る間、カメラがボスを追いかける速さ（ふつうは BossBattle.CINE.speed）
GrudgeArmorAI.TUNING = {
    keepDist: 420, keepDistDark: 470,
    cloneRadius: 330, cloneCooldown: 10, stun: 1.5,
    materializeMin: 1.5,
    extinguishInterval: 13, extinguishPerWave: 2, firstExtinguish: 16,
    feedbackGap: 0.6,
    p3Roar: 1.1, fireDash: 0.22, fireHold: 0.1, fireCam: 9
};

// ---------- 怨嗟の鎧の仮の見た目（画像が届くまで。コードで描く） ----------
// 黒鉄のひび割れた鎧（胴・肩の大袖・草摺）、ちぎれた布、兜の三日月の前立て、紫に光る目、長い刀と黒い鞘、足元の黒い霧
// 向き（down / up / left / right）と、AI の刀の構え（ai.blade）・身の低さ（ai.crouch）で形が変わる
// o.clone：分身・残像（影なし） / o.alpha：濃さ / o.dir・o.facing：向き / o.eyes：目の明るさ / o.tint：1色の影にする
Enemy.ARMOR_COLORS = {
    normal: { iron: '#2b2933', ironL: '#4f4b5c', ironD: '#141219', line: '#060508', cloth: '#4a1a2c', clothD: '#26101a',
              crack: '#c58cff', gold: '#7e6a4a', blade: '#d8dbe8', bladeE: '#ffffff', hilt: '#2e1b26', saya: '#0f0b10', void: '#05030a' },
    flash:  { iron: '#ffffff', ironL: '#ffffff', ironD: '#e4e2f0', line: '#c8c4d8', cloth: '#f4eef6', clothD: '#e0d8e6',
              crack: '#ffffff', gold: '#ffffff', blade: '#ffffff', bladeE: '#ffffff', hilt: '#f0eaf0', saya: '#e8e4ec', void: '#d8d0e0' },
    slow:   { iron: '#b8e6f6', ironL: '#dcf6ff', ironD: '#90c6dc', line: '#5a90a8', cloth: '#c6e8f4', clothD: '#a6d2e2',
              crack: '#ffffff', gold: '#e0f6ff', blade: '#ffffff', bladeE: '#ffffff', hilt: '#a8d4e4', saya: '#86b8cc', void: '#6a9cb2' }
};

Enemy.drawGrudgeArmor = function (e, ctx, s, hop, o = {}) {
    const ai = e.ai;
    const r = e.size * 0.5;
    const clone = !!o.clone;
    const alpha = o.alpha ?? (ai ? ai.bodyAlpha : 0.92);
    if (alpha <= 0.01) return;
    const t = ai ? ai.time : performance.now() / 1000;
    const flash = !clone && e.hitFlashTimer > 0;
    const C = flash ? Enemy.ARMOR_COLORS.flash : (Enemy.slowMotion && !clone) ? Enemy.ARMOR_COLORS.slow : Enemy.ARMOR_COLORS.normal;
    const facing = o.facing || (ai ? ai.facing : (e.direction === 'left' ? new Vector2(-1, 0.2) : new Vector2(1, 0.2)));
    const dir = o.dir || e.direction;
    const side = dir === 'left' || dir === 'right';
    const back = dir === 'up';
    const bladeOut = ai ? ai.bladeOut : true;
    const B = (ai && ai.blade) || (bladeOut ? { mode: 'low' } : { mode: 'idleSheathed' });
    const crouch = Math.max(ai ? ai.crouch : 0, e.hurtPose ? 0.35 : 0);
    const phase = ai && ai.phase ? ai.phase.index : 0;
    
    // ---- 足元の黒い霧（体より先に、直接描く）----
    const feetY = s.y + r * 0.9;
    ctx.save();
    for (let i = 0; i < 6; i++) {
        const k = (t * 0.55 + i / 6) % 1;
        const x = s.x + Math.sin(i * 2.1 + t * 1.3) * r * 0.75;
        const y = feetY - k * r * 0.9;
        ctx.globalAlpha = alpha * (1 - k) * 0.5;
        ctx.fillStyle = i % 2 ? 'rgba(70, 25, 110, 1)' : 'rgba(18, 6, 28, 1)';
        ctx.beginPath(); ctx.ellipse(x, y, r * 0.32 * (1 - k * 0.4), r * 0.18 * (1 - k * 0.4), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    
    // ---- 体はいったん別のキャンバスに描いて、まとめて透かす（部品の重なりが透けて見えないように）----
    const W = Math.ceil(r * 6.4), H = Math.ceil(r * 5.6);
    let cv = Enemy._armorCanvas;
    if (!cv) cv = Enemy._armorCanvas = document.createElement('canvas');
    if (cv.width < W || cv.height < H) { cv.width = Math.max(cv.width, W); cv.height = Math.max(cv.height, H); }
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    const fx = W / 2, fy = H - r * 0.75;   // キャンバスの中の足元
    g.save();
    if (dir === 'left') { g.translate(fx * 2, 0); g.scale(-1, 1); } // 左向きは右向きを反転
    const fv = dir === 'left' ? new Vector2(-facing.x, facing.y) : facing;
    const sway = Math.sin(t * 2.3) * 0.08;
    const lower = crouch * r * 0.28;                 // 身を低くした分だけ上半身が下がる
    const waistY = fy - r * 1.12 + lower * 0.6;
    const chestY = fy - r * 2.0 + lower;
    const headY = fy - r * 2.42 + lower;
    const bodyW = side ? r * 0.82 : r * 1.12;
    
    const poly = (pts, fill, stroke = C.line, lw = 2) => {
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.fillStyle = fill; g.fill();
        if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
    };
    const tatter = (x0, x1, yTop, yBot, n, color, phaseK) => {
        // ちぎれた布：下のふちがぎざぎざで、ゆれる。下へ行くほど霧に溶ける
        const grd = g.createLinearGradient(0, yTop, 0, yBot);
        grd.addColorStop(0, color);
        grd.addColorStop(0.7, color);
        grd.addColorStop(1, 'rgba(20, 6, 20, 0)');
        g.beginPath();
        g.moveTo(x0, yTop);
        g.lineTo(x1, yTop);
        const wx = x1 + (x1 - x0) * 0.12;
        g.lineTo(wx, yBot - r * 0.2);
        for (let i = n; i >= 0; i--) {
            const x = x0 - (x1 - x0) * 0.12 + (wx - (x0 - (x1 - x0) * 0.12)) * (i / n);
            const deep = i % 2 ? r * (0.25 + 0.15 * Math.sin(i * 1.7 + t * 3 + phaseK)) : 0;
            g.lineTo(x + Math.sin(t * 2.6 + i + phaseK) * r * 0.06, yBot - r * 0.2 + deep + Math.sin(t * 3 + i * 0.9) * r * 0.05);
        }
        g.closePath();
        g.fillStyle = grd;
        g.fill();
    };
    
    // ---- 刀（抜いている時）：手の位置と向き ----
    const fa = Math.atan2(fv.y, fv.x);
    let bladeAng = null, handX = fx, handY = chestY + r * 0.5;
    const bs = B.side || 1;
    if (bladeOut || B.mode === 'sheathing') {
        switch (B.mode) {
            case 'raised': bladeAng = fa + Math.PI + bs * (0.6 + 0.35 * (B.p || 0)); handY = chestY + r * 0.1; break;              // 振りかぶる
            case 'swing': bladeAng = fa + Math.PI + bs * 0.95 - bs * (Math.PI + 0.9) * Math.min(1, (B.p || 0) * 1.6); break;     // 振り抜く
            case 'trail': bladeAng = fa + Math.PI - 0.35; handY = chestY + r * 0.55; break;                                        // 駆け抜ける（刀は後ろへ）
            case 'stab': bladeAng = Math.PI / 2; handX = fx + (side ? r * 0.35 : 0); handY = waistY - r * 0.1; break;              // 地面に突き立てる
            case 'raise': bladeAng = -Math.PI / 2 + 0.2; handY = chestY - r * 0.2; break;
            case 'ready': bladeAng = fa + 0.45 + Math.sin(t * 9) * 0.03; handY = chestY + r * 0.55; break;                       // 抜刀直後の構え
            case 'sheathing': bladeAng = Math.PI / 2 + 0.9 - (B.p || 0) * 0.6; handX = fx + (side ? -r * 0.1 : r * 0.42); handY = waistY - r * 0.05; break;
            default: bladeAng = fa + 0.75 + sway * 0.5; handY = chestY + r * 0.6;                                                  // ふつうの構え（下段）
        }
        if (B.mode !== 'stab' && B.mode !== 'sheathing') {
            handX = fx + Math.cos(fa) * r * (side ? 0.45 : 0.35) + (side ? 0 : -r * 0.18);
            handY += Math.sin(fa) * r * 0.12;
        }
    }
    const drawBlade = () => {
        if (bladeAng === null) return;
        const len = r * 2.25 * (B.mode === 'sheathing' ? 1 - (B.p || 0) * 0.85 : 1);
        const cs = Math.cos(bladeAng), sn = Math.sin(bladeAng);
        const hx0 = handX - cs * r * 0.42, hy0 = handY - sn * r * 0.42;
        // 柄
        g.lineCap = 'round';
        g.strokeStyle = C.line; g.lineWidth = 7;
        g.beginPath(); g.moveTo(hx0, hy0); g.lineTo(handX, handY); g.stroke();
        g.strokeStyle = C.hilt; g.lineWidth = 4;
        g.beginPath(); g.moveTo(hx0, hy0); g.lineTo(handX, handY); g.stroke();
        // 鍔
        g.fillStyle = C.gold;
        g.beginPath(); g.ellipse(handX, handY, r * 0.1, r * 0.07, bladeAng, 0, Math.PI * 2); g.fill();
        // 刃（少し反った長い刀）
        const tx = handX + cs * len, ty = handY + sn * len;
        const nx = -sn, ny = cs;
        const mx = (handX + tx) / 2 + nx * r * 0.12, my = (handY + ty) / 2 + ny * r * 0.12;
        g.strokeStyle = C.line; g.lineWidth = 6;
        g.beginPath(); g.moveTo(handX, handY); g.quadraticCurveTo(mx, my, tx, ty); g.stroke();
        g.strokeStyle = C.blade; g.lineWidth = 3.5;
        g.beginPath(); g.moveTo(handX, handY); g.quadraticCurveTo(mx, my, tx, ty); g.stroke();
        g.strokeStyle = C.bladeE; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(handX + nx, handY + ny); g.quadraticCurveTo(mx + nx * 1.5, my + ny * 1.5, tx, ty); g.stroke();
        // 手（籠手）
        g.fillStyle = C.ironD; g.strokeStyle = C.line; g.lineWidth = 2;
        g.beginPath(); g.ellipse(handX - cs * r * 0.16, handY - sn * r * 0.16, r * 0.14, r * 0.12, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    };
    // 刀が体の奥にある時（上に向けている。後ろ向きなら前に構えている時）は、体より先に描く
    const bladeBehind = bladeAng !== null && (back ? Math.sin(bladeAng) < 0.2 : Math.sin(bladeAng) < -0.35);
    
    // ---- 鞘（左の腰）。刀を納めている時は柄も出ている ----
    const drawSaya = () => {
        const sx0 = side ? fx - r * 0.2 : fx + r * 0.42, sy0 = waistY - r * 0.12;
        const ang = side ? Math.PI - 0.5 : 0.9;
        const L = r * 1.9;
        g.lineCap = 'round';
        g.strokeStyle = C.line; g.lineWidth = 8;
        g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(sx0 + Math.cos(ang) * L, sy0 + Math.sin(ang) * L); g.stroke();
        g.strokeStyle = C.saya; g.lineWidth = 5;
        g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(sx0 + Math.cos(ang) * L, sy0 + Math.sin(ang) * L); g.stroke();
        if (!bladeOut && B.mode !== 'sheathing') {
            // 柄（前・上へ出ている）。柄を握っている時は手も
            const ha = ang + Math.PI;
            const hx = sx0 + Math.cos(ha) * r * 0.48, hy = sy0 + Math.sin(ha) * r * 0.48;
            g.strokeStyle = C.line; g.lineWidth = 7;
            g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(hx, hy); g.stroke();
            g.strokeStyle = C.hilt; g.lineWidth = 4;
            g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(hx, hy); g.stroke();
            g.fillStyle = C.gold;
            g.beginPath(); g.ellipse(sx0, sy0, r * 0.1, r * 0.07, ha, 0, Math.PI * 2); g.fill();
            if (B.mode === 'hilt') {
                g.fillStyle = C.ironD; g.strokeStyle = C.line; g.lineWidth = 2;
                g.beginPath(); g.ellipse(hx, hy, r * 0.14, r * 0.12, 0, 0, Math.PI * 2); g.fill(); g.stroke();
            }
        }
    };
    
    // ---- 後ろの布（背中のちぎれたマント）----
    const capeTop = chestY + r * 0.05;
    if (!back) tatter(fx - bodyW * 0.62, fx + bodyW * 0.62, capeTop, fy + r * 0.05, 8, C.clothD, 1.3);
    if (bladeBehind) drawBlade();
    if (!back && side) drawSaya();
    
    // ---- 下半身：ちぎれた袴（霧に溶ける。足は見えない）----
    tatter(fx - bodyW * 0.5, fx + bodyW * 0.5, waistY, fy + r * 0.1, 7, C.cloth, 0);
    // 草摺（腰の板）：3段
    for (let row = 0; row < 3; row++) {
        const y = waistY - r * 0.04 + row * r * 0.17;
        const n = side ? 3 : 4;
        const w = bodyW * (1.02 + row * 0.06) / n;
        for (let i = 0; i < n; i++) {
            const x = fx - bodyW * (0.51 + row * 0.03) + i * w;
            g.fillStyle = (i + row) % 2 ? C.iron : C.ironD;
            g.fillRect(Math.round(x), Math.round(y), Math.ceil(w - 2), Math.round(r * 0.16));
            g.strokeStyle = C.line; g.lineWidth = 1.5;
            g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.ceil(w - 2), Math.round(r * 0.16));
            g.fillStyle = C.ironL;
            g.fillRect(Math.round(x) + 1, Math.round(y) + 1, Math.ceil(w - 4), 2);
        }
    }
    
    // ---- 胴（黒鉄のひび割れた鎧）----
    const tw = bodyW * 0.5, ww = bodyW * 0.44;
    poly([[fx - tw, chestY], [fx + tw, chestY], [fx + ww, waistY], [fx - ww, waistY]], C.iron);
    g.fillStyle = C.ironL;
    g.fillRect(Math.round(fx - tw + 3), Math.round(chestY + 2), Math.round(tw * 2 - 6), 3);
    for (let i = 1; i <= 3; i++) {
        const y = chestY + (waistY - chestY) * i / 4;
        g.strokeStyle = C.ironD; g.lineWidth = 2;
        g.beginPath(); g.moveTo(fx - tw + (tw - ww) * i / 4 + 2, y); g.lineTo(fx + tw - (tw - ww) * i / 4 - 2, y); g.stroke();
    }
    if (back) {
        // 背中：大きなちぎれた布をかけている
        tatter(fx - bodyW * 0.6, fx + bodyW * 0.6, chestY - r * 0.05, fy - r * 0.15, 8, C.clothD, 2.1);
    } else {
        // 胸のひび割れ：紫に光る（形態が進むほど明るい）
        const glow = 0.55 + 0.25 * Math.sin(t * 3.2) + phase * 0.15;
        g.strokeStyle = C.crack; g.lineWidth = 2;
        g.globalAlpha = Math.min(1, glow);
        g.beginPath();
        g.moveTo(fx - tw * 0.2, chestY + r * 0.12);
        g.lineTo(fx + tw * 0.05, chestY + r * 0.35);
        g.lineTo(fx - tw * 0.15, chestY + r * 0.55);
        g.lineTo(fx + tw * 0.25, chestY + r * 0.8);
        g.moveTo(fx + tw * 0.05, chestY + r * 0.35);
        g.lineTo(fx + tw * 0.45, chestY + r * 0.3);
        g.stroke();
        g.globalAlpha = 1;
    }
    
    // ---- 大袖（肩の板）：左右（横向きは手前の1つ）----
    const sode = (sx, flipX) => {
        const w = r * 0.46, h = r * 0.62, x = sx - w / 2, y = chestY - r * 0.06;
        const sk = flipX * r * 0.08;
        poly([[x, y], [x + w, y], [x + w + sk, y + h], [x + sk, y + h]], C.iron);
        for (let i = 1; i <= 3; i++) {
            const yy = y + h * i / 4;
            g.strokeStyle = C.ironD; g.lineWidth = 2;
            g.beginPath(); g.moveTo(x + sk * i / 4 + 1, yy); g.lineTo(x + w + sk * i / 4 - 1, yy); g.stroke();
        }
        g.fillStyle = C.ironL; g.fillRect(Math.round(x + 2), Math.round(y + 2), Math.round(w - 4), 2);
        // 紐（布の色）
        g.fillStyle = C.cloth; g.fillRect(Math.round(x + w * 0.45), Math.round(y + 2), 3, Math.round(h * 0.8));
    };
    if (side) sode(fx + r * 0.05, 1);
    else { sode(fx - bodyW * 0.62, -1); sode(fx + bodyW * 0.62, 1); }
    if (!back && !side) drawSaya();
    
    // ---- 兜：しころ（首を守る板）・鉢・吹返し・三日月の前立て。顔の中は暗く、紫の目だけが光る ----
    const hr = r * 0.4;
    const hx = fx + (side ? r * 0.08 : 0), hy = headY;
    // しころ
    for (let i = 2; i >= 0; i--) {
        const w = hr * (1.25 + i * 0.22), y = hy + hr * 0.2 + i * hr * 0.22;
        poly([[hx - w * 0.85, y - hr * 0.1], [hx + w * 0.85, y - hr * 0.1], [hx + w, y + hr * 0.24], [hx - w, y + hr * 0.24]], i % 2 ? C.ironD : C.iron, C.line, 1.5);
    }
    // 鉢（丸い頭）
    g.fillStyle = C.iron; g.strokeStyle = C.line; g.lineWidth = 2;
    g.beginPath(); g.arc(hx, hy, hr, Math.PI, 0); g.lineTo(hx + hr, hy + hr * 0.25); g.lineTo(hx - hr, hy + hr * 0.25); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = C.ironL; g.lineWidth = 1.5;
    for (const k of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(hx + k * hr, hy - hr * 0.92 * Math.cos(k)); g.lineTo(hx + k * hr * 1.1, hy + hr * 0.1); g.stroke(); }
    if (!back) {
        // 顔の中（暗い）と面頬
        const fw = side ? hr * 0.55 : hr * 0.8, fxx = side ? hx + hr * 0.38 : hx;
        g.fillStyle = C.void;
        g.fillRect(Math.round(fxx - fw / 2), Math.round(hy - hr * 0.05), Math.round(fw), Math.round(hr * 0.5));
        g.fillStyle = C.ironD;
        g.fillRect(Math.round(fxx - fw / 2), Math.round(hy + hr * 0.3), Math.round(fw), Math.round(hr * 0.25));
        // 吹返し（左右の小さな板）
        if (!side) {
            poly([[hx - hr * 1.0, hy - hr * 0.05], [hx - hr * 0.72, hy - hr * 0.05], [hx - hr * 0.8, hy + hr * 0.35], [hx - hr * 1.12, hy + hr * 0.25]], C.ironD, C.line, 1.5);
            poly([[hx + hr * 1.0, hy - hr * 0.05], [hx + hr * 0.72, hy - hr * 0.05], [hx + hr * 0.8, hy + hr * 0.35], [hx + hr * 1.12, hy + hr * 0.25]], C.ironD, C.line, 1.5);
        }
    }
    // 三日月の前立て（くすんだ金）
    const cx0 = side ? hx + hr * 0.45 : hx, cy0 = hy - hr * 0.75;
    g.fillStyle = C.gold; g.strokeStyle = C.line; g.lineWidth = 1.5;
    g.beginPath();
    if (side) {
        g.moveTo(cx0 - hr * 0.1, cy0 + hr * 0.1);
        g.quadraticCurveTo(cx0 + hr * 0.6, cy0 - hr * 0.2, cx0 + hr * 0.75, cy0 - hr * 0.95);
        g.quadraticCurveTo(cx0 + hr * 0.4, cy0 - hr * 0.25, cx0 - hr * 0.1, cy0 - hr * 0.05);
    } else {
        g.moveTo(cx0, cy0 + hr * 0.12);
        g.quadraticCurveTo(cx0 - hr * 0.9, cy0 - hr * 0.05, cx0 - hr * 1.15, cy0 - hr * 0.95);
        g.quadraticCurveTo(cx0 - hr * 0.7, cy0 - hr * 0.3, cx0, cy0 - hr * 0.12);
        g.quadraticCurveTo(cx0 + hr * 0.7, cy0 - hr * 0.3, cx0 + hr * 1.15, cy0 - hr * 0.95);
        g.quadraticCurveTo(cx0 + hr * 0.9, cy0 - hr * 0.05, cx0, cy0 + hr * 0.12);
    }
    g.closePath(); g.fill(); g.stroke();
    
    if (!bladeBehind) drawBlade();
    g.restore();
    
    // 1色の影（残像）
    if (o.tint) {
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = o.tint;
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
    }
    
    // ---- 画面に描く（まとめて透かす）----
    const dx = Math.round(s.x - fx), dy = Math.round(feetY - hop - fy);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawImage(cv, 0, 0, W, H, dx, dy, W, H);
    // 分身の撃つ瞬間・被弾：体が白く光る
    if (o.flash) {
        ctx.globalAlpha = alpha * o.flash;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(cv, 0, 0, W, H, dx, dy, W, H);
    }
    ctx.restore();
    
    // ---- 目（紫に光る）。本体は分身より少し明るい ----
    const eyeK = o.eyes ?? 1;
    const eyes = [];
    const ey = dy + headY + hr * 0.12;
    const mirror = (x) => (dir === 'left' ? dx + (fx * 2 - x) : dx + x);
    if (back) {
        // 後ろ向き：兜のすき間から光がもれる
        eyes.push({ x: mirror(hx - hr * 0.85), y: ey - hr * 0.1, k: 0.55 }, { x: mirror(hx + hr * 0.85), y: ey - hr * 0.1, k: 0.55 });
    } else if (side) {
        eyes.push({ x: mirror(hx + hr * 0.5), y: ey, k: 1 });
    } else {
        eyes.push({ x: mirror(hx - hr * 0.24), y: ey, k: 1 }, { x: mirror(hx + hr * 0.24), y: ey, k: 1 });
    }
    if (eyeK > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const a = Math.min(1, alpha * 2.2) * eyeK * (flash ? 0.5 : 1);
        for (const q of eyes) {
            const rr = 7 * (q.k || 1) * (clone ? 0.9 : 1.15);
            const gr = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rr * 2);
            gr.addColorStop(0, `rgba(255, 235, 255, ${a})`);
            gr.addColorStop(0.35, `rgba(200, 120, 255, ${a * 0.85})`);
            gr.addColorStop(1, 'rgba(120, 40, 200, 0)');
            ctx.fillStyle = gr;
            ctx.fillRect(q.x - rr * 2, q.y - rr * 2, rr * 4, rr * 4);
        }
        ctx.restore();
    }
    // 本体の目の位置（暗闇の上に目を描き直す時に使う。drawEyes）。画面の座標（同じフレームの、同じ揺れの中で使う）
    if (!clone && ai) e._armorEyes = eyes;
};

window.GrudgeArmorAI = GrudgeArmorAI;
if (typeof BOSS_AI_CLASSES !== 'undefined') BOSS_AI_CLASSES.GrudgeArmorAI = GrudgeArmorAI;
