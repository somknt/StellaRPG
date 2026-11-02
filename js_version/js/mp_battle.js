// 協力プレイのボス戦（2〜4人。星の酒場の準備画面でリーダーが「バトル開始」を押した後）
//
// しくみ（ホストが決める方式）
//   ホスト（バトル開始を押したリーダー）の端末だけがボスAIを動かす。ボスの HP・フェーズ・攻撃・ねらう人はホストが決める
//   ほかの人の端末（ミラー）は、ホストから届くボスの様子（位置・モーション・HP・フェーズ）を少し遅らせてなめらかに出し、
//   ボスが出した攻撃（予告・当たり判定・弾・風刃・効果音）も、ホストと同じ時間の並びで出す
//   ボスへのダメージ：当てた人の端末が計算して、ホストへ送る（ホストがボスの HP を減らす。ボスの HP はホストの値が正しい）
//   主人公へのダメージ：その人の端末が、自分の画面のボスの攻撃で判定する（見えている攻撃に当たる）
//   勝ち・負け：ホストが決めて、全員に送る。報酬はホストがサーバー（hk_mp_finish）に知らせて、サーバーが全員に1回だけ配る
//
// 通信：Realtime のチャンネル hoshinoko-party-<パーティーの id>
//   'c'（ホスト以外 → みんな）：自分の主人公の様子・ボスに当てたダメージ・撃った魔法
//   'h'（ホスト → みんな）：ボスの様子・ボスが出した物・ホストの主人公の様子・勝ち負け
//   送る回数：2人 1秒に8回・3人 6回・4人 5回（Realtime の 1秒に100回までに収めるため）
//   観戦（watch.js）：ホストは酒場のルームに戦いの id を知らせるので、同じルームの人がこのチャンネルを見られる
//     パーティーの人以外から届いた 'c'・'h' は使わない
//
// 人数による強さ（CoopBattle.HP_MUL・RANGE_MUL・SPEED_MUL）：ボスの HP（2人 2倍・3人 3倍・4人 4倍）・範囲攻撃の広さ・速さ
//   協力プレイではボスはノックバックしない（怨嗟の鎧の分身がいる間だけ例外。CoopBattle.CLONE_HITS）
//   ねらう人：攻撃が終わるたびに、生きている人からでたらめに選ぶ。範囲攻撃（CoopBattle.AREA_ATTACKS）の時は、
//   主人公がいちばん多く集まっている所の人をねらう
class CoopBattle {
    constructor(game, tavern, party, pid, opts = {}) {
        this.game = game;
        this.tavern = tavern;
        this.party = party;
        this.battle = party.battle;
        this.pid = pid;
        // spectator：観戦（watch.js）。パーティーの人ではなく、見るだけ（何も送らない・自分の主人公は出さない）
        this.spectator = !!opts.spectator;
        this.host = !this.spectator && !!party.battle.host_is_me;
        this.watchIdx = 0;
        const order = this.battle.members;
        this.members = order.map(id => party.members.find(m => m.pid === id) || { pid: id, name: '？', gender: 'male' });
        this.n = Math.max(2, order.length);
        this.hz = CoopBattle.TICK_HZ[this.n] || 5;
        this.mult = CoopBattle.HP_MUL[this.n] || Number(this.battle.hp_mult) || 1;
        this.rangeMul = CoopBattle.RANGE_MUL[this.n] || 1;
        this.speedMul = CoopBattle.SPEED_MUL[this.n] || 1;
        this.speedNow = this.speedMul;   // 今の速さ（ノックバック中は 1。ホストが決めて送る）
        this.remotes = new Map();
        this.out = [];          // ホスト：次に送る、ボスが出した物
        this.queue = [];        // ミラー：届いた、ボスが出した物（時間が来たら出す）
        this.snaps = [];        // ミラー：届いたボスの様子
        this.claims = [];       // ボスに当てたダメージ（ホストへ送る）
        this.casts = [];        // 撃った魔法（ほかの人の画面にも出す）
        this.ids = new WeakMap();
        this.byId = new Map();
        this.tracked = [];
        this.seq = 0;
        this.sendT = 0;
        this.hostOff = Infinity;
        this.lastHostAt = 0;
        this.atkSeq = 0;
        this.atkAng = 0;
        this.localDead = false;
        this.ended = false;
        this.result = null;
        this.capturing = false;
        this.muteSE = false;
        this.dmgWindow = new Map();
    }
    
    get myIndex() { return Math.max(0, this.battle.members.indexOf(this.pid)); }
    get clock() { return performance.now() / 1000; }
    
    // ---------- 始める・やめる ----------
    begin() {
        const me = this.members.find(m => m.pid === this.pid) || {};
        if (this.spectator) {
            // 観戦：presence には「観戦の人」として入る（席の数を数えるため）。何も送らない
            this.watchKey = `w-${this.pid || Math.random().toString(36).slice(2, 10)}`;
            this.channel = Net.join(`hoshinoko-party-${this.party.id}`, this.watchKey, { w: 1, at: Date.now() }, {
                c: (m) => this.onClient(m),
                h: (m) => this.onHost(m),
                presence: (list) => this.checkSeat(list)
            });
        } else {
            this.channel = Net.join(`hoshinoko-party-${this.party.id}`, this.pid, { s: this.pid, n: me.name || '' }, {
                c: (m) => this.onClient(m),
                h: (m) => this.onHost(m)
            });
        }
        this.lastHostAt = performance.now();
        this.installSE();
        this.game.startBossBattle(this.battle.boss, Account.gender, this);
        // HUD のプレイヤー名
        this.game.playerName = Account.playerName;
        // ホスト：酒場の人に「この戦いをしている」と知らせる（観戦できるように）
        if (this.host && window.WatchBeacon && this.tavern) {
            this.beacon = new WatchBeacon(this.tavern, () => this.beaconInfo());
        }
    }
    
    beaconInfo() {
        return {
            p: this.party.id, b: this.battle.id, k: 'coop', boss: this.battle.boss, h: this.pid,
            m: this.members.map(m => [m.pid, m.name || '', m.gender === 'female' ? 'female' : 'male']),
            at: Math.round(this.bb ? this.bb.time : 0)
        };
    }
    
    stopBeacon() {
        if (this.beacon) this.beacon.stop();
        this.beacon = null;
    }
    
    // 観戦の席（1つの戦いに CoopBattle.MAX_WATCH 人まで）
    checkSeat(list) {
        if (this.seatChecked || this.ended) return;
        if (!list.some(x => x.key === this.watchKey)) return;
        this.seatChecked = true;
        if (!WatchBar.seatOk(list, this.watchKey)) {
            this.tavern.toast(`観戦の席がいっぱいです（1つの戦いに${CoopBattle.MAX_WATCH}人まで）`, 4);
            this.ended = true;
            WatchBar.leaveSoon(this.game);
        }
    }
    
    // 観戦：見る人を変える（WatchBar の ◀ ▶・←→）
    switchWatch(d) {
        const list = [...this.remotes.values()];
        if (!list.length) return;
        this.watchIdx = (this.watchIdx + d + list.length) % list.length;
        this.followWatched(true);
        playSE('ui_cursor');
    }
    
    followWatched(snap = false) {
        const list = [...this.remotes.values()];
        const r = list[this.watchIdx % Math.max(1, list.length)];
        if (!r) return;
        const cam = this.game.camera;
        if (cam.target !== r.p) { cam.follow(r.p); if (snap) cam.snapToTarget(); }
        WatchBar.setName(`${r.name || '？'} を見ています${r.dead ? '（戦闘不能）' : ''}`);
    }
    
    stop() {
        this.stopBeacon();
        if (this.spectator && window.WatchBar) WatchBar.hide();
        if (this.channel) this.channel.leave();
        this.channel = null;
        if (this._origSE) { window.playSE = this._origSE; this._origSE = null; }
        if (this._origGolem && window.GolemSound) { GolemSound.play = this._origGolem; this._origGolem = null; }
        if (this.game.enemySpawner) this.game.enemySpawner.onBossShots = null;
        this.remotes.clear();
    }
    
    // 効果音：ホストはボスが鳴らした音を覚えて送る / ミラーは自分の画面のボスAIの音は鳴らさない（送られてきた音を鳴らす）
    installSE() {
        const orig = window.playSE;
        this._origSE = orig;
        window.playSE = (key, opts) => {
            if (this.capturing) this.record({ k: 'se', key, o: opts ? CoopBattle.plain(opts) : null });
            if (this.muteSE) return false;
            return orig(key, opts);
        };
        if (window.GolemSound) {
            const g = GolemSound.play.bind(GolemSound);
            this._origGolem = GolemSound.play;
            GolemSound.play = (key) => {
                if (this.capturing) this.record({ k: 'gs', key });
                if (this.muteSE) return false;
                return g(key);
            };
        }
    }
    
    // ---------- BossBattle.start から：ボスと主人公を置いた後 ----------
    attach(bb) {
        const game = this.game;
        this.bb = bb;
        this.boss = bb.boss;
        this.ai = bb.ai;
        const base = game.player.position.clone();
        const offs = CoopBattle.SPAWN_OFFSETS;
        game.player.position = game.map.findFreeSpot(base.add(new Vector2(...offs[this.myIndex % offs.length])), game.player.getFootBox(), 120);
        game.camera.snapToTarget();
        // ほかの人（主人公の姿。動きは届いた様子で出す）
        const lv = bb.def.playerLevel || 1;
        this.battle.members.forEach((id, i) => {
            if (id === this.pid) return;
            const m = this.members[i];
            const p = new Player(0, 0, m.gender === 'female' ? 'female' : 'male');
            p.position = game.map.findFreeSpot(base.add(new Vector2(...offs[i % offs.length])), p.getFootBox(), 120);
            p.setLevel(lv);
            p.map = game.map;
            p.direction = 'up';
            this.remotes.set(id, { p, name: m.name || '', buf: [], off: Infinity, lastSeen: performance.now(), dead: false, as: 0, chant: '' });
        });
        // ボスの HP（人数の倍率）
        const e = this.boss;
        e.maxHP = Math.round(e.maxHP * this.mult);
        e.currentHP = e.maxHP;
        // ノックバックしない（怨嗟の鎧の分身がいる間だけ、CoopBattle.CLONE_HITS 回で本体がひるむ）
        const ai0 = this.ai, cloneHits = CoopBattle.CLONE_HITS[this.n] || CoopBattle.CLONE_HITS[4];
        Object.defineProperty(e, 'staggerHits', {
            configurable: true,
            get: () => (ai0.liveClones && ai0.liveClones().length ? cloneHits : Infinity),
            set: () => {}
        });
        if (this.host) this.attachHost();
        else this.attachMirror();
        // 観戦：自分の主人公は出さない・当たらない（game.js の watching）。ボスの名前の「観戦中」は update で出す
        if (this.spectator) {
            game.hidePlayerForWatch();
            WatchBar.show(this);
            this.followWatched(true);
        }
        // 暗闇の明かり（怨嗟の鎧）：自分の主人公のまわりだけ（ねらわれている人のまわりではなく）
        if (this.ai.lights) {
            const lights = this.ai.lights.bind(this.ai);
            this.ai.lights = () => this.withTarget(game.player, () => lights());
        }
    }
    
    // ボスAIの「主人公」（this.player = e.target）を一時的に入れかえて fn を呼ぶ
    withTarget(t, fn) {
        const e = this.boss, keep = e.target;
        e.target = t;
        try { return fn(); } finally { e.target = keep; }
    }
    
    attachHost() {
        const game = this.game, e = this.boss, ai = this.ai;
        e.keepTarget = true;
        e.target = game.player;
        // 範囲攻撃を少し広く（攻撃の種類ごと。予告も当たり判定も同じ大きさになる）
        const list = CoopBattle.RANGE_ATTACKS[this.bb.def.id] || [];
        for (const [name, keys] of list) {
            const a = ai.def.attacks[name];
            if (!a) continue;
            for (const k of keys) if (typeof a[k] === 'number') a[k] *= this.rangeMul;
        }
        // ボスが出した物を覚える
        const addFx = ai.addFx.bind(ai);
        ai.addFx = (f) => { const o = addFx(f); this.track('fx', o); return o; };
        const addHitbox = ai.addHitbox.bind(ai);
        ai.addHitbox = (h) => { const o = addHitbox(h); this.track('hb', o); return o; };
        if (ai.spawnBlade) {
            const spawn = ai.spawnBlade.bind(ai);
            ai.spawnBlade = (...args) => { spawn(...args); const b = ai.blades[ai.blades.length - 1]; if (b) this.record({ k: 'bl', o: CoopBattle.plain(b) }); };
        }
        if (ai.say) {
            const say = ai.say.bind(ai);
            ai.say = (...args) => { say(...args); const t = ai.texts[ai.texts.length - 1]; if (t) this.record({ k: 'say', o: CoopBattle.plain(t) }); };
        }
        // 咆哮の風圧：ホストの主人公にも当てて、ほかの人にも知らせる
        const blast = ai.roarBlast.bind(ai);
        ai.roarBlast = (dist) => { this.withTarget(game.player, () => blast(dist)); this.record({ k: 'blast', dist: dist === undefined ? null : dist }); };
        const push = ai.roarPush.bind(ai);
        ai.roarPush = (dt, range, power) => this.withTarget(game.player, () => push(dt, range, power));
        // 攻撃が終わるたびに、ねらう人を選び直す（でたらめに）
        const end = ai.endAction.bind(ai);
        ai.endAction = () => { end(); this.pickTarget(); };
        // 範囲攻撃を始める時は、主人公がいちばん多く集まっている所をねらう（攻撃の中身が動き出す前に、ねらう人を変える）
        const area = new Set(CoopBattle.AREA_ATTACKS[this.bb.def.id] || []);
        const startAction = ai.startAction.bind(ai);
        ai.startAction = (name, gen) => { if (area.has(name)) this.pickCluster(); return startAction(name, gen); };
        // 魔道ゴーレムの危険床：ねらっている人だけでなく、ほかの人の足元にも出す（すき間は残す）
        if (ai.hazardSpots) {
            const spots = ai.hazardSpots.bind(ai);
            ai.hazardSpots = (count, r) => {
                const s = spots(count, r);
                for (const t of this.targets()) {
                    if (t === e.target) continue;
                    const f = new Vector2(t.position.x, t.position.y + 28);
                    if (s.some(q => Math.hypot(q.x - f.x, (q.y - f.y) / 0.62) < r * 2.1)) continue;
                    s.push(f);
                }
                return s;
            };
        }
        // 魔道ゴーレムのステージ（魔法陣・石柱が光る）
        const map = game.map;
        for (const fn of ['pulseCircle', 'flashPillars', 'setStagePhase']) {
            if (typeof map[fn] !== 'function') continue;
            const f = map[fn].bind(map);
            map[fn] = (v) => { f(v); this.record({ k: 'st', fn, v }); };
        }
        // ボスの弾（黒蝕狼の侵蝕弾・ゴーレムの星力弾）：人数の分だけ速く（飛ぶ距離は同じ）
        game.enemySpawner.onBossShots = (list) => {
            for (const p of list) {
                if (this.speedMul !== 1 && p.velocity && !p._fast) {
                    p._fast = true;
                    p.velocity = p.velocity.mult(this.speedMul);
                    if (typeof p.life === 'number') p.life /= this.speedMul;
                }
            }
            for (const p of list) this.record({ k: 'pr', x: p.position.x, y: p.position.y, vx: p.velocity.x, vy: p.velocity.y, d: p.damage, r: p.radius, l: p.life, kind: p.kind || '' });
        };
        // ボスの更新の間に鳴った音を覚える。人数の分だけ、ボスの時間を速く進める（ノックバック中はふつう）
        const upd = e.update.bind(e);
        e.update = (dt, pl) => {
            const knocked = e.staggerTimer > 0 || e.knockTime < e.knockDuration;
            this.speedNow = knocked ? 1 : this.speedMul;
            this.capturing = true;
            try { upd(dt * this.speedNow, pl); } finally { this.capturing = false; }
        };
    }
    
    attachMirror() {
        const e = this.boss, ai = this.ai;
        e.mirror = (dt) => this.mirrorStep(dt);
        // ノックバック中も動かす物（怨嗟の鎧の風刃・分身）も、ホストと同じ速さで
        if (ai.preUpdate) {
            const pre = ai.preUpdate.bind(ai);
            ai.preUpdate = (dt) => pre(dt * this.speedNow);
        }
        ai.startFight = () => { ai.active = true; ai.introTarget = null; };
        if (ai.materialize) { ai.materialize = () => {}; ai.dematerialize = () => {}; }
        // 自分の画面のボスAIの音（危険床がはじけた音など）は鳴らさない。ホストから届いた音を鳴らす
        const fx = ai.updateFx.bind(ai);
        ai.updateFx = (dt) => { this.muteSE = true; try { fx(dt); } finally { this.muteSE = false; } };
        // ボスへのダメージ：自分の画面で計算して、ホストへ送る（HP はホストから届いた値）
        e.takeDamage = (damage, direction = null, canStagger = true, kind = '', knock = 0) => {
            const res = { damage: 0, position: e.position.clone(), staggered: false };
            if (!e.isAlive() || this.ended) return res;
            if (ai.invulnerable) { res.staggered = true; return res; }
            if (ai.blocksDamage && ai.blocksDamage(kind)) return res;
            const def = kind === 'magic' && e.magicDefense !== null && e.magicDefense !== undefined ? e.magicDefense : e.defense;
            res.damage = Math.max(1, Math.round((damage - def) * (e.damageTakenMul || 1)));
            e.hitFlashTimer = 0.1;
            e.hitFlashColor = '#ffffff';
            const d = direction && direction.length && direction.length() > 0.01 ? direction.normalize() : new Vector2(0, 0);
            this.claims.push([Math.round(damage * 10) / 10, kind || '', Math.round(d.x * 100) / 100, Math.round(d.y * 100) / 100, canStagger ? 1 : 0, Math.round(knock || 0)]);
            return res;
        };
    }
    
    // ---------- ホスト：ボスが出した物を覚えて送る ----------
    record(ev) {
        if (!this.host) return;
        ev.t = Math.round(this.clock * 1000) / 1000;
        this.out.push(ev);
    }
    
    track(kind, obj) {
        if (!obj) return;
        const id = ++this.seq;
        this.ids.set(obj, id);
        this.tracked.push({ id, obj, kind, sig: CoopBattle.sig(obj) });
        this.record({ k: kind, id, o: CoopBattle.plain(obj) });
    }
    
    // 出した後に変わった値（突進の予告の向き・攻撃を途中でやめた時の life など）を送る
    collectUpdates() {
        const live = new Set([...this.ai.fx, ...this.ai.hitboxes]);
        this.tracked = this.tracked.filter(x => live.has(x.obj));
        for (const x of this.tracked) {
            const s = CoopBattle.sig(x.obj);
            if (s === x.sig) continue;
            x.sig = s;
            this.record({ k: 'up', id: x.id, o: CoopBattle.nums(x.obj) });
        }
    }
    
    // ねらえる人（生きていて、つながっている人）
    targets() {
        const list = [];
        if (!this.localDead && !this.game.player.isDead()) list.push(this.game.player);
        const now = performance.now();
        for (const r of this.remotes.values()) if (!r.dead && now - r.lastSeen < CoopBattle.GONE_MS) list.push(r.p);
        return list;
    }
    
    // ねらう人を選ぶ（攻撃が終わるたび）：生きている人から、でたらめに
    pickTarget() {
        const e = this.boss, list = this.targets();
        if (!list.length) return;
        e.target = list[Math.floor(Math.random() * list.length)];
    }
    
    // 範囲攻撃の時：主人公がいちばん多く集まっている所の人（まわりの人がいちばん多い人）をねらう
    // みんな離れている時（まわりに人がいない）は、今ねらっている人のまま
    pickCluster() {
        const e = this.boss, list = this.targets();
        if (list.length < 2) return;
        const R = CoopBattle.CLUSTER_R;
        let best = [], bestN = 0;
        for (const t of list) {
            let n = 0;
            for (const u of list) if (u !== t && t.position.distance(u.position) <= R) n++;
            if (n > bestN) { bestN = n; best = [t]; }
            else if (n === bestN && n > 0) best.push(t);
        }
        if (!bestN) return;
        // 同じ数の人がいくつかいる時は、集まりのまん中に近い人
        const pick = (g) => {
            let sx = 0, sy = 0, k = 0;
            for (const u of list) if (u.position.distance(g.position) <= R) { sx += u.position.x; sy += u.position.y; k++; }
            return Math.hypot(g.position.x - sx / k, g.position.y - sy / k);
        };
        best.sort((a, b) => pick(a) - pick(b));
        e.target = best[0];
    }
    
    snapshot() {
        const e = this.boss, ai = this.ai;
        const r = (v, k = 10) => Math.round(v * k) / k;
        const s = {
            x: r(e.position.x), y: r(e.position.y), d: e.direction[0], hp: Math.ceil(e.currentHP), mhp: e.maxHP, ph: ai.phase.index,
            mo: ai.motion, mt: r(ai.motionTime, 100), li: r(ai.lift), sx: r(ai.scaleX, 1000), sy: r(ai.scaleY, 1000), ji: r(ai.jitter),
            fx: r(ai.facing.x, 1000), fy: r(ai.facing.y, 1000), an: ai.actionName, k: r(this.speedNow, 100),
            fl: (ai.invulnerable ? 1 : 0) | (ai.superArmor ? 2 : 0) | (ai.airborne ? 4 : 0) | (e.isAlive() ? 8 : 0) | (ai.active ? 16 : 0) | (e.hitFlashTimer > 0 ? 32 : 0)
        };
        if (typeof MagicGolemAI === 'function' && ai instanceof MagicGolemAI) { s.gp = CoopBattle.plain(ai.pose); s.gf = ai.frame; }
        else s.po = ai.pose;
        if (ai.clones) {
            const map = this.game.map;
            s.ar = { bl: ai.blade ? CoopBattle.plain(ai.blade) : null, cr: r(ai.crouch, 100), fa: r(ai.fade, 100), bo: ai.bladeOut ? 1 : 0,
                dk: ai.dark ? 1 : 0, ma: ai.materialized ? 1 : 0, sf: r(ai.shotFlash || 0, 100),
                cl: ai.clones.map(c => [c.id, r(c.x), r(c.y), r(c.fade, 100), c.hidden ? 1 : 0, c.dying ? 1 : 0, r(c.shimmer, 100), r(c.flash, 100)]),
                dt: map && map.darkTarget !== undefined ? map.darkTarget : 0,
                fs: map && map.fires ? map.fires.map(f => (f.state === 'lit' ? 1 : 0)).join('') : '' };
        }
        return s;
    }
    
    // 自分の主人公の様子（みんなに送る）
    myState() {
        const p = this.game.player;
        if (p.slashFx && p.slashFx !== this._lastSlash) { this._lastSlash = p.slashFx; this.atkSeq++; this.atkAng = p.slashFx.angle; }
        return {
            s: this.pid, t: Math.round(performance.now()), x: Math.round(p.position.x), y: Math.round(p.position.y), d: p.direction[0],
            mv: p.isMoving ? 1 : 0, ds: p.isDashing ? 1 : 0, as: this.atkSeq, aa: Math.round(this.atkAng * 100) / 100,
            dg: p.isDodging ? 1 : 0, ch: p.isChanting && p.chantMagic ? p.chantMagic.id : '',
            hp: Math.ceil(p.currentHP), mhp: p.maxHP, dead: this.localDead || p.isDead() ? 1 : 0
        };
    }
    
    // 自分が撃った魔法（game.js が呼ぶ）。ほかの人の画面にも、当たり判定のない見た目だけの魔法を出す
    onLocalCast(cast, target) {
        const r = (v) => Math.round(v);
        this.casts.push({ m: cast.magic.id, px: r(cast.position.x), py: r(cast.position.y), dx: Math.round(cast.direction.x * 1000) / 1000,
            dy: Math.round(cast.direction.y * 1000) / 1000, cx: r((cast.circlePos || cast.position).x), cy: r((cast.circlePos || cast.position).y),
            cr: Math.round(cast.circleRadius || 46), tx: target ? r(target.x) : null, ty: target ? r(target.y) : null,
            cs: cast.circleShape ? CoopBattle.plain(cast.circleShape) : null });
    }
    
    // ---------- 毎フレーム（BossBattle.update が呼ぶ） ----------
    update(dt) {
        const now = performance.now();
        this.updateRemotes(dt);
        if (this.spectator) {
            // 観戦：途中から見るので、開始の演出は飛ばす。カメラは見ている人を追う
            if (this.bb && this.bb.state === 'intro' && this.bb.t < 4.0) this.bb.t = 4.0;
            const nm = this.bb && this.bb.ui && this.bb.ui.name, label = `${this.bb ? this.bb.def.name : ''}（協力 ${this.n}人・観戦中）`;
            if (nm && nm.textContent !== label) nm.textContent = label;
            WatchBar.handleKeys(this, this.game.input);
            this.followWatched();
            if (!this.ended && this.bb && !this.bb.isOver && now - this.lastHostAt > CoopBattle.HOST_LOST_MS) this.abort();
            return;
        }
        if (this.host) {
            // ねらっている人が倒れた・いなくなった：すぐ選び直す
            const tg = this.boss.target;
            const alive = this.targets();
            if (alive.length && !alive.includes(tg)) this.pickTarget();
            this.checkAllDown();
        } else if (!this.ended && this.bb && !this.bb.isOver && now - this.lastHostAt > CoopBattle.HOST_LOST_MS) {
            this.abort();
        }
        this.sendT += dt;
        if (this.sendT >= 1 / this.hz) {
            this.sendT = 0;
            this.sendTick();
        }
    }
    
    sendTick() {
        if (!this.channel || this.spectator) return;   // 観戦の人は何も送らない
        if (this.host) {
            this.collectUpdates();
            const msg = { t: Math.round(this.clock * 1000) / 1000, b: this.snapshot(), me: this.myState(), c: this.casts, ev: this.out };
            this.out = [];
            this.casts = [];
            this.channel.send('h', msg);
        } else {
            const msg = { ...this.myState(), h: this.claims, c: this.casts };
            this.claims = [];
            this.casts = [];
            this.channel.send('c', msg);
        }
    }
    
    // ---------- 受け取った ----------
    // ほかの人（ホスト以外）の様子。ホストは、その人がボスに当てたダメージをボスに与える
    onClient(m) {
        // パーティーの人（戦いのメンバー）からの物だけ使う
        if (!m || m.s === this.pid || !this.remotes.has(m.s)) return;
        this.applyPlayerState(m);
        if (m.c && m.c.length) this.showRemoteCasts(m.c);
        if (this.host && m.h && m.h.length && this.boss && !this.ended) {
            for (const c of m.h) this.applyClaim(m.s, c);
        }
    }
    
    onHost(m) {
        if (!m || this.host) return;
        // ホストからの物だけ使う（サーバーの答えにホストがある時）
        if (this.battle.host && (!m.me || m.me.s !== this.battle.host)) return;
        const now = this.clock;
        this.lastHostAt = performance.now();
        this.hostOff = Math.min(this.hostOff, now - m.t);
        if (m.b) { this.snaps.push({ t: m.t, s: m.b }); if (this.snaps.length > 40) this.snaps.shift(); }
        if (m.ev) for (const ev of m.ev) this.queue.push(ev);
        if (m.me) this.applyPlayerState(m.me);
        if (m.c && m.c.length) this.showRemoteCasts(m.c);
    }
    
    applyClaim(pid, c) {
        const [dmg, kind, dx, dy, st, kn] = c;
        const now = performance.now();
        // 1人が 10秒で与えられるダメージには上限（おかしな値を送られても、ボスがすぐ倒れないように）
        const w = this.dmgWindow.get(pid) || { at: now, sum: 0 };
        if (now - w.at > 10000) { w.at = now; w.sum = 0; }
        const d = Math.max(0, Math.min(CoopBattle.MAX_CLAIM, Number(dmg) || 0));
        if (w.sum + d > CoopBattle.MAX_DPS10) return;
        w.sum += d;
        this.dmgWindow.set(pid, w);
        const res = this.boss.takeDamage(d, new Vector2(dx || 0, dy || 0), !!st, kind || '', kn || 0);
        if (res && res.damage > 0) this.game.damageNumbers.add(res.damage, this.boss);
    }
    
    applyPlayerState(m) {
        const r = this.remotes.get(m.s);
        if (!r) return;
        const now = performance.now();
        r.lastSeen = now;
        r.off = Math.min(r.off, now - m.t);
        r.buf.push(m);
        if (r.buf.length > 20) r.buf.shift();
        r.hp = m.hp; r.mhp = m.mhp;
        r.dead = !!m.dead;
    }
    
    showRemoteCasts(list) {
        const ms = this.game.magicSystem;
        for (const c of list) {
            const magic = this.game.player.getMagicData(c.m) || ((window.gameData && gameData.magicCircles) || []).find(x => x.id === c.m);
            if (!magic) continue;
            const before = { p: ms.projectiles.length, s: ms.strikes.length, t: ms.tornados.length };
            const target = c.tx !== null && c.tx !== undefined ? new Vector2(c.tx, c.ty) : null;
            ms.castMagic(magic, new Vector2(c.px, c.py), new Vector2(c.dx, c.dy), new Vector2(c.cx, c.cy), [], c.cs || undefined, c.cr || 46, target);
            // 見た目だけ（当たり判定は撃った人の端末。ここで当たったことにすると、ダメージが2回になる）
            for (const p of ms.projectiles.slice(before.p)) p.remote = true;
            for (const s of ms.strikes.slice(before.s)) s.remote = true;
            for (const t of ms.tornados.slice(before.t)) t.remote = true;
        }
    }
    
    // ほかの人の主人公：少し前の様子をなめらかに出す（攻撃・回避・詠唱の絵も）
    updateRemotes(dt) {
        const now = performance.now();
        const dirs = { u: 'up', d: 'down', l: 'left', r: 'right' };
        for (const r of this.remotes.values()) {
            const p = r.p;
            p.gone = now - r.lastSeen > CoopBattle.GONE_MS;
            const b = r.buf;
            if (!b.length) continue;
            const rt = now - r.off - CoopBattle.INTERP_MS;
            let a = b[0], c = b[b.length - 1];
            for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
            let x = c.x, y = c.y, cur = c;
            if (rt < c.t && c.t > a.t) {
                const k = Math.max(0, Math.min(1, (rt - a.t) / (c.t - a.t)));
                x = a.x + (c.x - a.x) * k; y = a.y + (c.y - a.y) * k;
                cur = k < 0.5 ? a : c;
            }
            const old = p.position;
            p.position = new Vector2(x, y);
            p.velocity = dt > 0 ? new Vector2((x - old.x) / dt, (y - old.y) / dt) : new Vector2(0, 0);
            p.direction = dirs[cur.d] || p.direction;
            p.isMoving = !!cur.mv;
            p.isDashing = !!cur.ds && p.isMoving;
            p.currentHP = Math.max(0, cur.hp || 0);
            p.maxHP = cur.mhp || p.maxHP;
            // 攻撃：数が増えたら、斬るモーションと斬撃を出す
            if (cur.as !== r.as) {
                r.as = cur.as;
                p.isAttacking = true;
                p.attackAnimTimer = p.attackAnimDuration;
                p.aimVector = new Vector2(Math.cos(cur.aa), Math.sin(cur.aa));
                p.slashFlip = !p.slashFlip;
                p.slashFx = { t: 0, angle: cur.aa, flip: p.slashFlip };
            }
            p.updateAttack(dt);
            // 回避
            if (cur.dg && !p.isDodging) { p.isDodging = true; p.dodgeTimer = p.dodgeDuration; }
            if (p.isDodging) { p.dodgeTimer -= dt; if (p.dodgeTimer <= 0 || !cur.dg) p.isDodging = false; }
            // 詠唱
            if (cur.ch && r.chant !== cur.ch) {
                const m = p.getMagicData(cur.ch);
                if (m) { p.isChanting = true; p.chantMagic = m; p.chantTime = 0; p.chantDuration = (m.chantTime || 1) * Player.CHANT_TIME_MUL; }
            }
            r.chant = cur.ch;
            if (!cur.ch) { p.isChanting = false; p.chantMagic = null; }
            if (p.isChanting) { p.updateChant(dt); p.readyCast = null; if (!p.isChanting && cur.ch) { p.isChanting = true; p.chantMagic = p.getMagicData(cur.ch); } }
            // 歩きのコマ送り
            if (p.isDashing) {
                p.dashFrameTimer += dt;
                if (p.dashFrameTimer >= p.dashFrameSpeed) { p.dashFrameTimer = 0; p.dashFrame = (p.dashFrame + 1) % p.actionFrameCount; }
            }
            if (p.isMoving) {
                p.animationTimer += dt;
                if (p.animationTimer >= p.animationSpeed * (p.isDashing ? 0.55 : 1)) { p.animationTimer = 0; p.animationFrame = (p.animationFrame + 1) % 3; }
            } else p.animationFrame = 1;
        }
    }
    
    // ---------- ミラー：ボスを、ホストから届いた様子で動かす（Enemy.update が毎フレーム呼ぶ） ----------
    mirrorStep(dt) {
        const e = this.boss, ai = this.ai;
        // ホストと同じ速さで、予告・当たり判定・演出を進める
        const sdt = dt * this.speedNow;
        if (!this.snaps.length) { ai.time += sdt; ai.updateFx(sdt); return; }
        const rt = this.clock - this.hostOff - (1 / this.hz + CoopBattle.EXTRA_DELAY);
        // 時間が来た「ボスが出した物」を出す
        this.queue.sort((a, b) => a.t - b.t);
        while (this.queue.length && this.queue[0].t <= rt) this.applyEvent(this.queue.shift(), rt);
        // ボスの様子：rt の前後の2つの間をなめらかに
        const S = this.snaps;
        let s1 = S[0], s2 = null;
        for (let i = 0; i < S.length; i++) { if (S[i].t <= rt) s1 = S[i]; else { s2 = S[i]; break; } }
        while (S.length > 2 && S[1].t <= rt) S.shift();
        const a = s1.s;
        let x = a.x, y = a.y;
        if (s2 && s2.t > s1.t && rt >= s1.t) {
            const k = Math.max(0, Math.min(1, (rt - s1.t) / (s2.t - s1.t)));
            x = a.x + (s2.s.x - a.x) * k;
            y = a.y + (s2.s.y - a.y) * k;
        }
        const old = e.position;
        e.position = new Vector2(x, y);
        e.velocity = dt > 0 ? new Vector2((x - old.x) / dt, (y - old.y) / dt) : new Vector2(0, 0);
        this.applySnap(a, Math.max(0, rt - s1.t));
        ai.time += dt * this.speedNow;
        ai.updateFx(dt * this.speedNow);
        // 咆哮の間、近くの主人公を押し返す（自分の主人公だけ）
        if (ai.actionName === 'transition' && e.isAlive() && ai.roarPush) ai.roarPush(dt * this.speedNow);
    }
    
    applySnap(s, late) {
        const e = this.boss, ai = this.ai;
        const dirs = { u: 'up', d: 'down', l: 'left', r: 'right' };
        e.direction = dirs[s.d] || e.direction;
        e.maxHP = s.mhp;
        if (e.isAlive()) e.currentHP = Math.max(1, s.hp);
        if (s.ph !== ai.phase.index) {
            ai.phase.index = s.ph;
            ai.applyPhaseBuff(s.ph);
        }
        if (typeof s.k === 'number' && s.k > 0) this.speedNow = s.k;
        ai.motion = s.mo;
        ai.motionTime = s.mt + late * this.speedNow;
        ai.lift = s.li; ai.scaleX = s.sx; ai.scaleY = s.sy; ai.jitter = s.ji;
        ai.facing = new Vector2(s.fx, s.fy);
        ai.actionName = s.an || '';
        ai.invulnerable = !!(s.fl & 1); ai.superArmor = !!(s.fl & 2); ai.airborne = !!(s.fl & 4); ai.active = !!(s.fl & 16);
        if (s.fl & 32) e.hitFlashTimer = Math.max(e.hitFlashTimer, 0.06);
        if (s.gp) { Object.assign(ai.pose, s.gp); ai.frame = s.gf; }
        else if ('po' in s) ai.pose = s.po;
        if (s.ar) this.applyArmor(s.ar);
        if (!(s.fl & 8) && e.isAlive()) this.mirrorDie();
    }
    
    applyArmor(A) {
        const ai = this.ai, map = this.game.map;
        ai.blade = A.bl; ai.crouch = A.cr; ai.fade = A.fa; ai.bladeOut = !!A.bo; ai.dark = !!A.dk; ai.materialized = !!A.ma; ai.shotFlash = A.sf;
        const old = new Map(ai.clones.map(c => [c.id, c]));
        ai.clones = A.cl.map(([id, x, y, fade, hidden, dying, shimmer, flash]) => {
            const c = old.get(id) || { id, t: 0, facing: new Vector2(0, 1), dir: 'down', fade };
            Object.assign(c, { x, y, fade, hidden: !!hidden, dying: !!dying, shimmer, flash });
            return c;
        });
        if (map && map.setDarkness && map.darkTarget !== A.dt) map.setDarkness(A.dt);
        if (map && map.fires && A.fs) {
            map.fires.forEach((f, i) => {
                const lit = A.fs[i] === '1';
                if (lit && f.state !== 'lit') map.relight(f, true);
                else if (!lit && f.state === 'lit') map.extinguish(f, true);
            });
        }
    }
    
    mirrorDie() {
        const e = this.boss;
        e.currentHP = 0;
        if (e.dying) return;
        e.dying = true;
        e.deathReady = false;
        this.ai.onDeath();
        const dir = this.lastDeathDir || new Vector2(0, -1);
        if (e.startKnockback) e.startKnockback(dir, 70 * Math.max(0.6, e.knockbackScale || 1), 0.3, 0.6, true);
    }
    
    // ホストから届いた「ボスが出した物」を、自分の画面のボスAIに出す
    applyEvent(ev, rt) {
        const ai = this.ai, game = this.game;
        const age = Math.max(0, rt - ev.t);
        switch (ev.k) {
            case 'fx': case 'hb': {
                const o = CoopBattle.revive(ev.o);
                if (o._img) { o.img = o.type === 'armorGhost' && Enemy.armorSprite ? Enemy.armorSprite(this.boss, o.dir) : this.boss.getEnemyImage(); delete o._img; }
                o.age = Math.min(age, 0.05);
                if (ev.k === 'hb') { o.used = false; ai.hitboxes.push(o); } else ai.fx.push(o);
                this.byId.set(ev.id, o);
                break;
            }
            case 'up': { const o = this.byId.get(ev.id); if (o) Object.assign(o, ev.o); break; }
            case 'pr':
                game.enemySpawner.projectiles.push({ position: new Vector2(ev.x, ev.y), velocity: new Vector2(ev.vx, ev.vy), damage: ev.d, radius: ev.r, life: ev.l, age: 0, kind: ev.kind || undefined });
                break;
            case 'bl': if (ai.blades) ai.blades.push({ ...ev.o, px: ev.o.x, py: ev.o.y }); break;
            case 'say': if (ai.texts) ai.texts.push({ ...ev.o, age: 0 }); break;
            case 'se': if (this._origSE) this._origSE(ev.key, ev.o || undefined); break;
            case 'gs': if (this._origGolem && window.GolemSound) this._origGolem.call(GolemSound, ev.key); break;
            case 'ev': {
                const e2 = ev.e;
                if (e2.type === 'phase') { ai.phase.index = e2.index; ai.applyPhaseBuff(e2.index); }
                ai.events.push(e2);
                break;
            }
            case 'blast': if (this.boss.isAlive()) ai.roarBlast(ev.dist === null ? undefined : ev.dist); break;
            case 'st': { const m = game.map; if (typeof m[ev.fn] === 'function') m[ev.fn](ev.v); break; }
            case 'die': this.lastDeathDir = new Vector2(ev.dx || 0, ev.dy || -1); this.mirrorDie(); break;
            case 'end': this.onEnd(ev); break;
        }
    }
    
    // ---------- 戦闘不能・勝ち・負け ----------
    // 自分の主人公の HP が 0（game.js が呼ぶ）。ほかの人が戦っている間は見守る
    onLocalDead() {
        if (this.localDead) return;
        this.localDead = true;
        if (this.bb && !this.bb.isOver) this.bb.showBanner('戦闘不能', '仲間の戦いを見守ろう', 'defeat');
        const alive = [...this.remotes.values()].find(r => !r.dead && !r.p.gone);
        if (alive) this.game.camera.follow(alive.p);
    }
    
    // ホスト：全員が戦闘不能（つながっている人だけ数える）なら負け
    checkAllDown() {
        if (this.ended || !this.bb || this.bb.state !== 'fight') return;
        if (!(this.localDead || this.game.player.isDead())) return;
        const now = performance.now();
        const others = [...this.remotes.values()].filter(r => now - r.lastSeen < CoopBattle.GONE_MS);
        if (others.some(r => !r.dead)) {
            const alive = others.find(r => !r.dead);
            if (alive && this.game.camera.target === this.game.player) this.game.camera.follow(alive.p);
            return;
        }
        this.record({ k: 'end', win: false });
        this.sendTick();
        this.stopBeacon();
        this.ended = true;
        this.bb.onDefeat(true);
        this.finishServer(false);
    }
    
    // 勝った（BossBattle.update がボスの HP 0 を見つけた）。表示する報酬（サーバーが確定する）を返す
    onVictory(time) {
        // 観戦：報酬・記録はない
        if (this.spectator) { this.ended = true; return null; }
        if (this.host && !this.ended) {
            this.ended = true;
            const d = this.boss.knockDir || new Vector2(0, -1);
            this.record({ k: 'die', dx: d.x, dy: d.y });
            this.record({ k: 'end', win: true, time });
            this.sendTick();
            this.stopBeacon();
            this.finishServer(true);
        }
        this.ended = true;
        const R = window.BattleRecords;
        const r = R ? R.rankFor(time) : { rank: '-', bonus: 0 };
        const base = R ? R.baseCoins(this.bb.def) : 0;
        this.pendingReward = { rank: r.rank, base, bonus: r.bonus, gained: base + r.bonus, coins: null, place: null, best: false, coop: true, confirmed: false };
        this.fetchReward();
        return this.pendingReward;
    }
    
    onEnd(ev) {
        if (ev.win) return; // 勝ちはボスの HP 0 で分かる（mirrorDie）
        this.ended = true;
        if (this.bb && !this.bb.isOver) this.bb.onDefeat(true);
    }
    
    // ホストがいなくなった（8秒なにも届かない）：戦いをやめる
    abort() {
        this.ended = true;
        const bb = this.bb;
        if (!bb) return;
        bb.coopLost = true;
        bb.onDefeat(true);
        bb.showBanner('通信が切れました', 'ホストとつながらなくなりました', 'defeat');
        if (!this.spectator) this.finishServer(false);
    }
    
    async finishServer(win) {
        try {
            const r = await Net.rpc('hk_mp_finish', { p_battle: this.battle.id, p_win: !!win });
            if (r && this.pendingReward && r.result) this.applyReward(r.result, r.reward);
        } catch (e) {
            console.warn('戦いの結果をサーバーに送れませんでした:', e.code || e);
        }
    }
    
    // 報酬（サーバーで決まった物）を読みこんで、結果画面に出す
    async fetchReward(tries = 0) {
        if (this.host) return;
        try {
            const r = await Net.rpc('hk_mp_state', { p_board: false });
            const last = r && r.party && r.party.last;
            if (last && last.id === this.battle.id && last.result) { this.applyReward(last.result, last.reward); return; }
        } catch (e) { /* もう一度 */ }
        if (tries < 8) setTimeout(() => this.fetchReward(tries + 1), 1500);
    }
    
    async applyReward(result, reward) {
        const pr = this.pendingReward;
        if (!pr) return;
        pr.confirmed = true;
        pr.serverResult = result;
        pr.gained = result === 'win' ? reward : 0;
        if (Account.refresh) await Account.refresh(true);
        pr.coins = window.BattleRecords ? BattleRecords.getCoins() : null;
        if (this.bb && this.bb.updateCoopReward) this.bb.updateCoopReward(pr);
    }
    
    // ---------- 描画 ----------
    getDepthDrawables() {
        const out = [];
        for (const r of this.remotes.values()) {
            const p = r.p;
            out.push({ sortY: p.position.y + p.drawSize * 0.4, draw: (ctx, cam) => {
                ctx.save();
                if (r.dead || p.gone) ctx.globalAlpha = 0.45;
                p.draw(ctx, cam);
                ctx.restore();
            } });
        }
        return out;
    }
    
    // ほかの人の名前と HP（頭の上）
    drawAbove(ctx, cam) {
        for (const r of this.remotes.values()) {
            const p = r.p;
            const x = Math.round(p.position.x - cam.x), y = Math.round(p.position.y - cam.y - p.drawSize / 2 - 6);
            ctx.save();
            ctx.font = 'bold 15px "DotGothic16", sans-serif';
            ctx.textAlign = 'center';
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(10, 6, 20, 0.9)';
            const label = r.dead ? `${r.name}（戦闘不能）` : p.gone ? `${r.name}（通信待ち）` : r.name;
            ctx.strokeText(label, x, y - 10);
            ctx.fillStyle = r.dead ? '#ff9e8e' : '#d8f0ff';
            ctx.fillText(label, x, y - 10);
            const w = 54, k = p.maxHP > 0 ? Math.max(0, p.currentHP / p.maxHP) : 0;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(x - w / 2 - 1, y - 6, w + 2, 7);
            ctx.fillStyle = k > 0.3 ? '#5be37a' : '#ff6a5a';
            ctx.fillRect(x - w / 2, y - 5, w * k, 5);
            ctx.restore();
        }
    }
    
    // ---------- 小さな道具 ----------
    // 送れる形にする（Vector2 は {__v:[x,y]}、画像は _img の印だけ、関数は捨てる）
    static plain(o) {
        if (!o || typeof o !== 'object') return o;
        const out = {};
        for (const [k, v] of Object.entries(o)) {
            if (typeof v === 'function') continue;
            if (v && typeof v === 'object') {
                if (typeof Vector2 === 'function' && v instanceof Vector2) out[k] = { __v: [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100] };
                else if ((typeof HTMLImageElement !== 'undefined' && v instanceof HTMLImageElement) || (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement)) out._img = 1;
                else if (Array.isArray(v)) out[k] = v.map(x => (x && typeof x === 'object' ? CoopBattle.plain(x) : x));
                else out[k] = CoopBattle.plain(v);
            } else out[k] = typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
        }
        return out;
    }
    
    static revive(o) {
        if (!o || typeof o !== 'object') return o;
        if (Array.isArray(o)) return o.map(x => CoopBattle.revive(x));
        if (o.__v) return new Vector2(o.__v[0], o.__v[1]);
        const out = {};
        for (const [k, v] of Object.entries(o)) out[k] = v && typeof v === 'object' ? CoopBattle.revive(v) : v;
        return out;
    }
    
    // 出した後に変わる値だけ（数の値。age・used・fired は端末ごとに進むので比べない）
    static nums(o) {
        const out = {};
        for (const [k, v] of Object.entries(o)) {
            if (typeof v !== 'number' || k === 'age' || k === 'used' || k === 'fired') continue;
            out[k] = Math.round(v * 1000) / 1000;
        }
        return out;
    }
    
    static sig(o) {
        let s = '';
        for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && k !== 'age' && k !== 'used' && k !== 'fired') s += k + Math.round(v * 100) + ',';
        return s;
    }
}

// 送る回数（1秒に何回。人数ごと）
CoopBattle.TICK_HZ = { 2: 8, 3: 6, 4: 5 };
// ボスの範囲攻撃の広さの倍率（人数ごと）と、広くする攻撃（boss_data.js の attacks の名前と、広くする値）
// 回避できない攻撃にならないように、広くするのは決まった攻撃の、輪・円の大きさだけ
CoopBattle.RANGE_MUL = { 2: 1.25, 3: 1.4, 4: 1.55 };
// ボスの速さの倍率（人数ごと）：動き・攻撃の出る早さ・予告・弾の速さがみんな速くなる。
// ノックバックで飛ばされている間は、ふつうの速さ（動けない時間は短くならない）
CoopBattle.SPEED_MUL = { 2: 1.1, 3: 1.18, 4: 1.25 };
// ボスの HP の倍率（人数ごと）。サーバーの hp_mult より、こちらを使う（前の版の SQL のままでも同じ強さになるように）
CoopBattle.HP_MUL = { 2: 2, 3: 3, 4: 4 };
// 協力プレイ（2人以上）では、ボスはノックバックしない
// ただし怨嗟の鎧の分身（本体をノックバックした時だけ消える）がいる間だけは、みんなの攻撃を合わせてこの回数続けて当たると
// 本体がひるんで分身が消える（そうしないと第2形態を進められないため）。ひとりの時（10回）より多い
CoopBattle.CLONE_HITS = { 2: 15, 3: 20, 4: 25 };
// 範囲攻撃（ボスごとの攻撃の名前）。これを出す時は、主人公がいちばん多く集まっている所の人をねらう
// それ以外の攻撃は、生きている人からでたらめに選んでねらう
CoopBattle.AREA_ATTACKS = {
    giant_forest_boar: ['stomp', 'bigStomp'],
    black_corrupted_wolf: ['leap', 'shadowLeap', 'corruptionShot', 'corruptionWave'],
    magic_golem: ['armSwing', 'slam', 'shockwave', 'bigShockwave', 'magicShot', 'hazardFloor', 'hazardBarrage', 'magicCannon'],
    grudge_armor: ['windSlash', 'sixWind']
};
CoopBattle.CLUSTER_R = 240;      // この距離より近い主人公を「集まっている」と数える（px）
// 観戦
CoopBattle.MAX_WATCH = 2;        // 1つの戦いを観戦できる人数（Realtime の上限があるので少なめ）
CoopBattle.BEACON_SEC = 3;       // ホストが酒場へ「戦っている」と知らせる間隔（秒）
CoopBattle.RANGE_ATTACKS = {
    giant_forest_boar: [['stomp', ['radius']], ['bigStomp', ['radius']]],                       // 踏みつけの衝撃波
    black_corrupted_wolf: [['corruptionWave', ['maxRadius']]],                                  // 侵蝕波動
    magic_golem: [['hazardFloor', ['radius']], ['hazardBarrage', ['radius']], ['shockwave', ['maxRadius']], ['bigShockwave', ['maxRadius']]], // 危険床・衝撃波
    grudge_armor: [['windSlash', ['radius']], ['sixWind', ['radius']]]                          // 風刃
};
// 主人公の出てくる所（ふつうの出てくる所からのずれ。参加した順）
CoopBattle.SPAWN_OFFSETS = [[0, 0], [-120, 20], [120, 20], [0, 90]];
CoopBattle.INTERP_MS = 260;      // ほかの主人公は、この時間だけ前の様子を出す
CoopBattle.EXTRA_DELAY = 0.12;   // ボスは、送る間隔＋この秒数だけ前の様子を出す（届くのが遅れても、ちぎれないように）
CoopBattle.GONE_MS = 6000;       // この間なにも届かない人は「通信待ち」（ねらわれない）
CoopBattle.HOST_LOST_MS = 8000;  // ホストからこの間なにも届かなかったら、戦いをやめる
CoopBattle.MAX_CLAIM = 4000;     // 1回の攻撃のダメージの上限
CoopBattle.MAX_DPS10 = 40000;    // 1人が 10秒で与えられるダメージの上限

window.CoopBattle = CoopBattle;
