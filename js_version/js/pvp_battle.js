// PvP（2人の対戦）。星の酒場の PvP の扉 → 対戦の設定（制限時間・何点先取。リーダーが決める）→ 準備画面（フィールド・装備）→ 対戦
//
// しくみ（2人とも同じ立場）
//   相手の主人公は「敵」の1つ（PvpOpponent。Enemy を受けつぐ）として置く。だから、ナイフ・魔法・ターゲットは今のしくみのまま使える
//   相手に当たったかは、攻撃した人の画面で決める（PvpOpponent.takeDamage）。当たった分を相手に送る（'v' の h）
//   受け取った人は、自分の画面に相手の攻撃が見えてから少しして（PvpBattle.HIT_GRACE_MS）自分の主人公に当てる
//     その間は足元が赤く光る（敵の攻撃の予告と同じ）。回避が間に合えばよけられて、ジャスト回避になる（スロー・無敵）
//     本当に減った数を送り返す（a）→ 攻撃した人の画面に数字が出る（よけられた時は「回避！」）
//   相手の攻撃は、敵の攻撃と同じように赤い範囲で出す（ナイフを振った所・詠唱中の魔法のねらい）
//   ラウンド制：相手を倒すと1点。先に「何点先取」の点を取った方の勝ち。1点ごとに、HP・SP を戻して最初の場所からやり直す
//   制限時間（ラウンドの間の休みは数えない）が来たら、点の多い方の勝ち。同じ点なら HP の割合が多い方（同じなら引き分け）
//   相手から何も届かなくなったら（PvpBattle.LOST_MS）、残った人の勝ち
//   結果はサーバー（hk_mp_finish）に知らせる。PvP に報酬はない
//
// 通信：Realtime のチャンネル hoshinoko-party-<パーティーの id>（協力プレイと同じ）。'v' を 1秒に PvpBattle.TICK_HZ 回
class PvpBattle {
    constructor(game, tavern, party, pid) {
        this.game = game;
        this.tavern = tavern;
        this.party = party;
        this.battle = party.battle;
        this.pid = pid;
        this.host = !!party.battle.host_is_me;
        this.field = String(this.battle.boss || '').replace(/^pvp:/, '') || party.field || 'arena';
        if (!PvpBattle.FIELDS[this.field]) this.field = 'arena';
        const otherId = this.battle.members.find(id => id !== pid);
        this.me = party.members.find(m => m.pid === pid) || { pid, name: Account.playerName };
        this.other = party.members.find(m => m.pid === otherId) || { pid: otherId, name: '？', gender: 'male' };
        // 対戦の設定（酒場の対戦の設定の画面でリーダーが決めた物。始まった後は、ホスト＝リーダーの物にそろえる）
        this.setRule(PvpBattle.ruleFor(tavern, party));
        this.state = 'intro';    // 'intro'（カウントダウン） / 'fight' / 'ko'（ラウンドの間） / 'victory' / 'defeat' / 'draw'
        this.round = 1;
        this.points = { me: 0, op: 0 };   // 決まった点
        this.myKo = 0;           // 自分が倒れたラウンド
        this.opKo = 0;           // 相手が倒れたラウンド（相手から届いた）
        this.breakT = 0;
        this.claims = [];        // 相手に当てた分（送る）
        this.acks = [];          // 当てられた分の、本当に減った数（送る）
        this.casts = [];         // 撃った魔法（相手の画面にも見た目だけ出す）
        this.pending = [];       // 届いた、当てられた分（相手の攻撃が見えてから当てる）
        this.castQ = [];         // 届いた相手の魔法（相手の動きに合わせて出す）
        this.pops = [];          // 「回避！」などの文字
        this.seq = 0;
        this.sendT = 0;
        this.atkSeq = 0;
        this.atkAng = 0;
        this.lastSeen = performance.now();
        this.time = 0;
        this.trail = 1;
        this.resultTimer = 0;
        this.ui = PvpBattle.getUI();
        // 開始の時刻をサーバーの戦いの始まりにそろえる（2人のカウントダウンが同じ時に終わるように）
        const elapsed = Number(this.battle.elapsed) || 0;
        this.goAt = performance.now() + Math.max(1.2, PvpBattle.COUNTDOWN - elapsed) * 1000;
    }
    
    // この パーティーの対戦の設定（tavern.js の pvpCfg）。なければ初めの値
    static ruleFor(tavern, party) {
        const c = tavern && tavern.pvpCfg;
        return PvpBattle.normRule(c && party && c.p === party.id ? c : null);
    }
    static normRule(c) {
        const D = PvpBattle.DEFAULT_RULE;
        const tm = c && PvpBattle.RULE_TIMES.includes(Number(c.tm)) ? Number(c.tm) : D.tm;
        const pt = c && PvpBattle.RULE_POINTS.includes(Number(c.pt)) ? Number(c.pt) : D.pt;
        return { tm, pt };
    }
    static ruleText(r) { return `${r.tm}分・${r.pt}点先取`; }
    setRule(r) {
        this.rule = PvpBattle.normRule(r);
        this.timeLimit = this.rule.tm * 60;
        this.winPoints = this.rule.pt;
    }
    
    static getUI() {
        const $ = (id) => document.getElementById(id);
        return {
            hud: $('pvp-hud'), meName: $('pvh-me-name'), meFill: $('pvh-me-fill'), meHp: $('pvh-me-hp'),
            opName: $('pvh-op-name'), opFill: $('pvh-op-fill'), opHp: $('pvh-op-hp'), opTrail: $('pvh-op-trail'),
            timer: $('pvh-timer'), field: $('pvh-field'), round: $('pvh-round'),
            plMe: $('pvh-pl-me'), plOp: $('pvh-pl-op'), ptsMe: $('pvh-pts-me'), ptsOp: $('pvh-pts-op'),
            banner: $('battle-banner'), bannerMain: $('battle-banner-main'), bannerSub: $('battle-banner-sub'), count: $('battle-countdown'),
            result: $('pvp-result'), rTitle: $('pvr-title'), rSub: $('pvr-sub'), rStats: $('pvr-stats'), rBack: $('pvr-back')
        };
    }
    
    get isOver() { return this.state === 'victory' || this.state === 'defeat' || this.state === 'draw'; }
    // カウントダウン中・ラウンドの間は、だれも動かない
    get isFrozen() { return this.state === 'intro' || this.state === 'ko'; }
    get isCinematic() { return false; }
    // 今の点（ラウンドの間は、そのラウンドの分も足して見せる）
    get score() {
        const s = { me: this.points.me, op: this.points.op };
        if (this.state === 'ko' || this.isOver) {
            const r = this.roundWinner();
            if (r === 'me' && !this._counted) s.me++;
            if (r === 'op' && !this._counted) s.op++;
        }
        return s;
    }
    // 今のラウンドで倒れた方（'me' = 自分が勝った / 'op' = 相手が勝った / 'both' = 相打ち / null）
    roundWinner() {
        const meDown = this.myKo === this.round, opDown = this.opKo === this.round;
        return meDown && opDown ? 'both' : opDown ? 'me' : meDown ? 'op' : null;
    }
    
    // ---------- 始める・やめる ----------
    begin() {
        const game = this.game;
        this.channel = Net.join(`hoshinoko-party-${this.party.id}`, this.pid, { s: this.pid, n: this.me.name || '' }, {
            v: (m) => this.onRemote(m)
        });
        game.startPvpBattle(this);
        // 対戦開始を押した人：酒場の人に「対戦している」と知らせる（観戦できるように。watch.js）
        if (this.host && window.WatchBeacon && this.tavern) {
            const start = this.goAt - PvpBattle.COUNTDOWN * 1000;
            const g = (m) => (m.gender === 'female' ? 'female' : 'male');
            this.beacon = new WatchBeacon(this.tavern, () => ({
                p: this.party.id, b: this.battle.id, k: 'pvp', f: this.field, h: this.pid,
                m: this.battle.members.map(id => { const m = id === this.pid ? this.me : this.other; return [id, m.name || '', g(m)]; }),
                at: Math.round((performance.now() - start) / 1000), cf: [this.rule.tm, this.rule.pt]
            }));
        }
    }
    
    stopBeacon() {
        if (this.beacon) this.beacon.stop();
        this.beacon = null;
    }
    
    // game.startPvpBattle から：フィールドと主人公を置いた後
    attach() {
        const game = this.game, map = game.map;
        const p = game.player;
        p.setLevel(PvpBattle.LEVEL);
        p.levelLocked = true;
        // 2人の出てくる所：フィールドのまん中から左右に分かれて、向かい合う（先に参加した人が左）
        const w = map.width * map.tileSize, h = map.height * map.tileSize;
        this.center = map.layers && map.layers.pvpCenter ? new Vector2(map.layers.pvpCenter.x, map.layers.pvpCenter.y) : this.fieldCenter(map, w, h);
        const c = this.center;
        this.left = this.battle.members.indexOf(this.pid) === 0;
        this.placeMe();
        const off = PvpBattle.SPAWN_DX;
        this.opp = new PvpOpponent(this, c.add(new Vector2(this.left ? off : -off, 0)), this.other.gender === 'female' ? 'female' : 'male', this.other.name || '？');
        this.opp.puppet.direction = this.left ? 'left' : 'right';
        this.opp.map = map;
        game.enemySpawner.enemies.push(this.opp);
        game.camera.snapToTarget();
        this.showHud();
        this.showBanner(`VS ${this.other.name || '？'}`, `${PvpBattle.FIELDS[this.field].name}　─　${PvpBattle.ruleText(this.rule)}`, 'boss');
        playBGM('bgm_boss');
    }
    
    // 自分の主人公を最初の場所へ
    placeMe() {
        const map = this.game.map, p = this.game.player;
        const off = PvpBattle.SPAWN_DX;
        p.position = map.findFreeSpot(this.center.add(new Vector2(this.left ? -off : off, 0)), p.getFootBox(), 200);
        p.direction = this.left ? 'right' : 'left';
    }
    
    // フィールドの、ふつうの出てくる所とまん中の間（壁や門の近くにならないように）
    fieldCenter(map, w, h) {
        const s = map.getPlayerSpawn();
        return new Vector2(w / 2, (s.y + h / 2) / 2);
    }
    
    stop() {
        if (this.stopBeacon) this.stopBeacon();
        if (this.channel) this.channel.leave();
        this.channel = null;
        if (this.ui.hud) this.ui.hud.classList.remove('show');
        if (this.ui.result) this.ui.result.classList.remove('show');
        document.body.classList.remove('battle-result-open');
        this.showCount('');
        if (this.ui.banner) this.ui.banner.className = '';
        document.body.dataset.battle = '';
        document.body.dataset.coop = '';
        document.body.dataset.waves = '';
    }
    
    // ---------- 毎フレーム（game.js が呼ぶ） ----------
    update(dt) {
        const now = performance.now();
        // カウントダウン：3・2・1・GO
        if (this.state === 'intro') {
            const left = (this.goAt - now) / 1000;
            if (left <= 0) { this.state = 'fight'; this.showCount('GO!', true); playSE('battle_start'); setTimeout(() => { if (this.state === 'fight') this.showCount(''); }, 700); }
            else if (left <= 3) this.showCount(String(Math.ceil(left)));
            if (now - this.lastSeen > PvpBattle.LOST_MS && this.round > 1) this.finish('victory', '相手の通信が切れました');
        } else if (this.state === 'fight') {
            this.time += dt;
            this.applyIncoming(now);
            // 時間切れ：点の多い方の勝ち（ホストが決めて送る。ホストがいない時はそれぞれ決める）
            if (this.time >= this.timeLimit && (this.host || this.time >= this.timeLimit + 3)) this.timeUp();
            // 相手から何も届かない：相手の通信が切れた
            if (now - this.lastSeen > PvpBattle.LOST_MS) this.finish('victory', '相手の通信が切れました');
        } else if (this.state === 'ko') {
            this.breakT -= dt;
            if (this.breakT <= 0) this.endRound();
            else if (now - this.lastSeen > PvpBattle.LOST_MS) this.finish('victory', '相手の通信が切れました');
        } else if (this.isOver && this.resultTimer > 0) {
            this.resultTimer -= dt;
            if (this.resultTimer <= 0) this.showResult();
        }
        // 相手の魔法：相手の動き（少し前の様子）に合わせて出す
        if (this.castQ.length && !this.isOver) {
            const ready = this.castQ.filter(c => c.due <= now);
            if (ready.length) { this.castQ = this.castQ.filter(c => c.due > now); this.showRemoteCasts(ready.map(c => c.c)); }
        }
        for (const p of this.pops) p.t += dt;
        this.pops = this.pops.filter(p => p.t < 0.9);
        this.sendT += dt;
        if (this.sendT >= 1 / PvpBattle.TICK_HZ) { this.sendT = 0; this.sendTick(); }
        this.updateHud(dt);
    }
    
    // 届いた、当てられた分：相手の攻撃が自分の画面に見えた後、時間が来た物を当てる
    // 回避中・ジャスト回避の無敵中なら 0（回避中ならジャスト回避が決まる。game.js の consumeJustDodge）
    applyIncoming(now) {
        if (!this.pending.length) return;
        const p = this.game.player;
        const due = this.pending.filter(x => x.due <= now);
        if (!due.length) return;
        this.pending = this.pending.filter(x => x.due > now);
        for (const { h } of due) {
            const [id, dmg, x, y, ult] = h;
            const d = Math.max(0, Math.min(PvpBattle.MAX_HIT, Number(dmg) || 0));
            const before = p.currentHP;
            const dodge = p.isDodging || (p.isGuarded && p.isGuarded());
            const got = p.isDead() ? 0 : p.takeDamage(d, new Vector2(Number(x) || p.position.x, Number(y) || p.position.y), ult ? { ult: true } : null);
            const real = Math.max(0, Math.round(before - p.currentHP)) || (got > 0 ? Math.round(got) : 0);
            this.acks.push([id, real, real <= 0 && dodge ? 1 : 0]);
        }
    }
    
    timeUp() {
        if (this.isOver || this.state !== 'fight') return;
        const p = this.game.player, o = this.opp;
        const s = this.points;
        let r;
        if (s.me !== s.op) r = s.me > s.op ? 'victory' : 'defeat';
        else {
            const mine = p.maxHP ? p.currentHP / p.maxHP : 0, theirs = o.maxHP ? o.currentHP / o.maxHP : 0;
            r = Math.abs(mine - theirs) < 0.005 ? 'draw' : mine > theirs ? 'victory' : 'defeat';
        }
        this.finish(r, '時間切れ', 't');
    }
    
    // 自分の HP が 0（game.js が呼ぶ）
    onDefeat() {
        if (this.state !== 'fight') return;
        this.myKo = this.round;
        this.startBreak();
    }
    
    // ラウンドが決まった：少しの間止めて、K.O. を見せる
    startBreak() {
        if (this.state === 'ko') return;
        this.state = 'ko';
        this.pending = [];
        this.castQ = [];
        this.breakT = PvpBattle.KO_BREAK;
        this._counted = false;
        this.sendTick();
        const w = this.roundWinner();
        const s = this.score;
        const last = s.me >= this.winPoints || s.op >= this.winPoints;
        const sub = w === 'me' ? `${this.other.name || '相手'}を倒した！` : w === 'op' ? `${this.other.name || '相手'}に倒された……` : '相打ち';
        this.showBanner('K.O.!', last ? sub : `${sub}　${s.me} - ${s.op}`, w === 'me' ? 'victory' : 'defeat');
        playSE(w === 'me' ? 'boss_down' : 'ui_cancel');
    }
    
    // ラウンドの間が終わった：点を決めて、勝ちが決まっていれば終わり。まだなら次のラウンド
    endRound() {
        const w = this.roundWinner();
        if (w === 'me') this.points.me++;
        if (w === 'op') this.points.op++;
        this._counted = true;
        const s = this.points;
        if (s.me >= this.winPoints || s.op >= this.winPoints) {
            this.finish(s.me === s.op ? 'draw' : s.me > s.op ? 'victory' : 'defeat', `${s.me} - ${s.op}`, 'ko');
            return;
        }
        this.nextRound();
    }
    
    nextRound() {
        const game = this.game, p = game.player;
        this.round++;
        // HP・SP を戻して、最初の場所から
        p.currentHP = p.maxHP;
        p.currentSP = p.maxSP;
        if (p.isChanting) p.cancelChant();
        p.readyCast = null;
        p.cancelAttack();
        p.attackCancelled = false;
        p.isDodging = false;
        p.dodgedAttack = false;
        p.justGuardTime = 0;
        p.invincibleTime = 0;
        p.hitStun = 0;
        p.knockTimer = 0;
        p.knockSpeed = 0;
        p.hitChain = 0;
        p.velocity = new Vector2(0, 0);
        this.placeMe();
        game.justDodgeTimer = 0;
        Enemy.slowMotion = false;
        game.magicSystem.clear();
        game.camera.snapToTarget();
        this.pending = [];
        this.castQ = [];
        this.state = 'intro';
        this.goAt = performance.now() + PvpBattle.ROUND_COUNT * 1000;
        this.showBanner(`ROUND ${this.round}`, `${this.points.me} - ${this.points.op}　（${this.winPoints}点先取）`, 'boss');
        this.sendTick();
    }
    
    // why：結果の理由（画面に出す） / kind：'t' = 時間切れ・'ko' = 点が決まった（相手にも同じ結果を送る）
    finish(result, why, kind = '') {
        if (this.isOver) return;
        this.state = result;
        this.why = why || '';
        this.resultTimer = 2.4;
        this.pending = [];
        if (kind) this.endMsg = { r: result === 'draw' ? 'd' : result === 'victory' ? this.pid : this.other.pid, k: kind, w: why || '' };
        this.sendTick();
        this.stopBeacon();
        const T = { victory: ['WIN!', '勝利！'], defeat: ['LOSE…', '敗北……'], draw: ['DRAW', '引き分け'] }[result];
        this.showBanner(T[0], why || T[1], result === 'victory' ? 'victory' : 'defeat');
        playSE(result === 'victory' ? 'boss_down' : 'ui_cancel');
        if (result === 'victory') playBGM('jingle_victory');
        // サーバーに知らせる（先に知らせた方の結果を使う。報酬はない）
        const win = result === 'draw' ? null : result === 'victory';
        Net.rpc('hk_mp_finish', { p_battle: this.battle.id, p_win: win }).catch((e) => console.warn('PvP の結果をサーバーに送れませんでした:', e.code || e));
    }
    
    sendTick() {
        if (!this.channel) return;
        const game = this.game, p = game.player;
        if (p.slashFx && p.slashFx !== this._lastSlash) { this._lastSlash = p.slashFx; this.atkSeq++; this.atkAng = p.slashFx.angle; }
        const s = this.score;
        const msg = {
            s: this.pid, t: Math.round(performance.now()), x: Math.round(p.position.x), y: Math.round(p.position.y), d: p.direction[0],
            mv: p.isMoving ? 1 : 0, ds: p.isDashing ? 1 : 0, as: this.atkSeq, aa: Math.round(this.atkAng * 100) / 100,
            dg: p.isDodging ? 1 : 0, ch: p.isChanting && p.chantMagic ? p.chantMagic.id : '',
            hp: Math.max(0, Math.ceil(p.currentHP)), mhp: p.maxHP, dead: p.isDead() ? 1 : 0, st: this.state === 'ko' ? 'k' : this.state[0],
            rd: this.round, sc: [s.me, s.op], tl: Math.max(0, Math.ceil(this.timeLimit - this.time)),
            h: this.claims.splice(0), a: this.acks.splice(0), c: this.casts.splice(0)
        };
        // 詠唱中の魔法のねらい（相手の画面に赤い範囲で出す）
        const a = game.castAim;
        if (msg.ch && a) {
            const r = (v) => Math.round(v);
            if (a.kind === 'shot' && a.dir) msg.ca = ['s', Math.round(a.dir.x * 100) / 100, Math.round(a.dir.y * 100) / 100, r(a.reach || 300), r(a.radius || 30)];
            else if (a.target) msg.ca = ['t', r(a.target.x), r(a.target.y), r(a.radius || 45)];
        }
        if (this.host) msg.cf = [this.rule.tm, this.rule.pt];
        if (this.endMsg) msg.e = this.endMsg;
        this.channel.send('v', msg);
    }
    
    // ---------- 受け取った ----------
    onRemote(m) {
        if (!m || m.s === this.pid || m.s !== this.other.pid) return;
        const now = performance.now();
        this.lastSeen = now;
        const o = this.opp;
        if (!o) return;
        o.push(m);
        // ホスト（リーダー）の設定にそろえる（始まる前だけ）
        if (!this.host && Array.isArray(m.cf) && this.round === 1 && this.state === 'intro') {
            const r = PvpBattle.normRule({ tm: m.cf[0], pt: m.cf[1] });
            if (r.tm !== this.rule.tm || r.pt !== this.rule.pt) { this.setRule(r); this.updateHud(0); }
        }
        // 当てられた分：相手の動きは少し前の様子を出しているので、その攻撃が見えてから当てる（それまで足元が赤く光る）
        const due = Math.min(now + PvpBattle.MAX_WAIT_MS, m.t + o.off + PvpBattle.INTERP_MS + PvpBattle.HIT_GRACE_MS);
        if (Array.isArray(m.h) && this.state === 'fight') for (const h of m.h) if (Array.isArray(h)) this.pending.push({ h, due });
        if (Array.isArray(m.a)) for (const a of m.a) {
            if (!Array.isArray(a)) continue;
            const d = Math.round(Number(a[1]) || 0);
            if (d > 0) { this.game.damageNumbers.add(d, o); playSE('attack_hit'); o.hitFlashTimer = 0.12; }
            else if (a[2]) this.pops.push({ text: '回避！', x: o.position.x, y: o.position.y - 70, t: 0 });
        }
        if (Array.isArray(m.c) && m.c.length && !this.isOver) {
            const cd = Math.min(now + PvpBattle.MAX_WAIT_MS, m.t + o.off + PvpBattle.INTERP_MS);
            for (const c of m.c.slice(0, 6)) this.castQ.push({ c, due: cd });
        }
        if (this.isOver) return;
        // 相手が結果を送ってきた（時間切れ・点が決まった）
        if (m.e && m.e.r) {
            const r = m.e.r === 'd' ? 'draw' : m.e.r === this.pid ? 'victory' : 'defeat';
            // 点の文字（「相手の点 - 自分の点」で届く）は、自分から見た順に直す
            const w = String(m.e.w || '').split(' - ');
            this.finish(r, m.e.k === 't' ? '時間切れ' : w.length === 2 ? `${w[1]} - ${w[0]}` : '');
            return;
        }
        // 相手が倒れた（このラウンドで）
        if (m.dead && Number(m.rd) === this.round && (this.state === 'fight' || this.state === 'ko')) {
            if (this.opKo !== this.round) {
                this.opKo = this.round;
                if (this.state === 'fight') this.startBreak();
                else this.showBanner('K.O.!', '相打ち', 'defeat');
            }
        }
    }
    
    // 相手に当てた（PvpOpponent.takeDamage）。数字は相手が本当に減った数を返してきた時に出す
    claim(damage, from, kind) {
        if (this.state !== 'fight') return;
        const id = ++this.seq;
        this.claims.push([id, Math.round(Math.min(PvpBattle.MAX_HIT, damage) * 10) / 10, Math.round(from.x), Math.round(from.y), 0]);
    }
    
    // 自分が撃った魔法（game.js が呼ぶ）
    onLocalCast(cast, target) {
        const r = (v) => Math.round(v);
        this.casts.push({ m: cast.magic.id, px: r(cast.position.x), py: r(cast.position.y), dx: Math.round(cast.direction.x * 1000) / 1000,
            dy: Math.round(cast.direction.y * 1000) / 1000, cx: r((cast.circlePos || cast.position).x), cy: r((cast.circlePos || cast.position).y),
            cr: Math.round(cast.circleRadius || 46), tx: target ? r(target.x) : null, ty: target ? r(target.y) : null,
            cs: cast.circleShape ? { sx: cast.circleShape.sx, sy: cast.circleShape.sy } : null });
    }
    
    // 相手の魔法：見た目だけ（当たったかは相手の画面で決めて、届く）
    showRemoteCasts(list) {
        const ms = this.game.magicSystem;
        for (const c of list) {
            const magic = this.game.player.getMagicData(c.m) || ((window.gameData && gameData.magicCircles) || []).find(x => x.id === c.m);
            if (!magic || magic.category === '治癒') continue;
            const before = { p: ms.projectiles.length, s: ms.strikes.length, t: ms.tornados.length };
            const target = c.tx !== null && c.tx !== undefined ? new Vector2(c.tx, c.ty) : null;
            ms.castMagic(magic, new Vector2(c.px, c.py), new Vector2(c.dx, c.dy), new Vector2(c.cx, c.cy), [], c.cs || undefined, c.cr || 46, target);
            for (const p of ms.projectiles.slice(before.p)) p.remote = true;
            for (const s of ms.strikes.slice(before.s)) s.remote = true;
            for (const t of ms.tornados.slice(before.t)) t.remote = true;
        }
    }
    
    // ---------- 表示 ----------
    // 自分の HP は左上のいつもの表示にあるので、上のまん中は相手の HP・点・残り時間
    showHud() {
        const u = this.ui;
        document.body.dataset.battle = 'pvp';
        document.body.dataset.coop = '1';     // 一時停止のボタンを出さない
        document.body.dataset.waves = 'off';  // ウェーブの表示は出さない
        if (u.hud) u.hud.dataset.mode = 'play';
        if (u.opName) u.opName.textContent = this.other.name || '？';
        if (u.plMe) u.plMe.textContent = 'あなた';
        if (u.plOp) u.plOp.textContent = this.other.name || '相手';
        if (u.hud) u.hud.classList.add('show');
        this._ptsKey = '';
        this.updateHud(0);
    }
    
    updateHud(dt = 0) {
        const u = this.ui, o = this.opp;
        if (!u.hud || !o) return;
        const k = o.maxHP > 0 ? Math.max(0, Math.min(1, o.currentHP / o.maxHP)) : 0;
        // 減った分は白く残って、少しずつ追いつく（ボスの HP と同じ）
        this.trail = k >= this.trail ? k : Math.max(k, this.trail - dt * 0.5);
        if (u.opFill) u.opFill.style.width = (k * 100).toFixed(1) + '%';
        if (u.opTrail) u.opTrail.style.width = (this.trail * 100).toFixed(1) + '%';
        if (u.opHp) { const s = `${Math.ceil(Math.max(0, o.currentHP))} / ${o.maxHP}`; if (u.opHp.textContent !== s) u.opHp.textContent = s; }
        PvpBattle.setPoints(u, this.score.me, this.score.op, this.winPoints, this);
        PvpBattle.setTimer(u, this.timeLimit - this.time, this.state === 'fight');
        const rd = `ROUND ${this.round}`;
        if (u.round && u.round.textContent !== rd) u.round.textContent = rd;
        const f = `${PvpBattle.FIELDS[this.field].name}　${PvpBattle.ruleText(this.rule)}`;
        if (u.field && u.field.textContent !== f) u.field.textContent = f;
    }
    
    // 点の印（◆ = 取った点 / ◇ = まだ）
    static setPoints(u, a, b, n, keyOwner) {
        const key = `${a}|${b}|${n}`;
        if (keyOwner._ptsKey === key) return;
        keyOwner._ptsKey = key;
        const pips = (v) => Array.from({ length: n }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('');
        if (u.ptsMe) u.ptsMe.innerHTML = pips(a);
        if (u.ptsOp) u.ptsOp.innerHTML = pips(b);
    }
    static setTimer(u, leftSec, live) {
        if (!u.timer) return;
        const left = Math.max(0, Math.ceil(leftSec));
        const s = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (u.timer.textContent !== s) u.timer.textContent = s;
        u.timer.classList.toggle('low', left <= 20 && live);
    }
    
    showBanner(main, sub, kind) {
        const u = this.ui;
        if (!u.banner) return;
        u.bannerMain.textContent = main;
        u.bannerSub.textContent = sub || '';
        u.banner.className = '';
        void u.banner.offsetWidth;
        u.banner.className = 'show ' + (kind || '');
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
        if (!last) playSE('ui_cursor');
    }
    
    showResult() {
        const u = this.ui;
        if (!u.result) return;
        const p = this.game.player, o = this.opp;
        const T = { victory: ['WIN!', '勝利！'], defeat: ['LOSE…', '敗北……'], draw: ['DRAW', '引き分け'] }[this.state];
        u.rTitle.textContent = T[0];
        u.rSub.textContent = this.why ? `${T[1]}（${this.why}）` : T[1];
        u.result.classList.toggle('win', this.state === 'victory');
        const t = Math.floor(this.time);
        const s = this.score;
        const rows = [
            ['フィールド', PvpBattle.FIELDS[this.field].name],
            ['対戦相手', this.other.name || '？'],
            ['ルール', PvpBattle.ruleText(this.rule)],
            ['点（あなた - 相手）', `${s.me} - ${s.op}`],
            ['戦った時間', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
            ['自分の残りHP', `${Math.max(0, Math.ceil(p.currentHP))} / ${p.maxHP}`],
            ['相手の残りHP', `${Math.max(0, Math.ceil(o.currentHP))} / ${o.maxHP}`]
        ];
        u.rStats.innerHTML = '';
        for (const [k, v] of rows) {
            const d = document.createElement('div');
            const a = document.createElement('span'); a.textContent = k;
            const b = document.createElement('b'); b.textContent = v;
            d.append(a, b);
            u.rStats.appendChild(d);
        }
        u.result.classList.add('show');
        document.body.classList.add('battle-result-open');
        this.nav = new UINav(u.result.querySelector('.battle-panel'), 'vertical');
    }
    
    handleResultKeys(input) {
        if (this.nav) this.nav.handle(input);
    }
    
    // ---------- 描画（game.js の drawWorld） ----------
    // 地面：相手の攻撃の範囲（赤）と、当たりそうな時の自分の足元（赤く光る）
    drawGround(ctx, cam) {
        if (this.opp) PvpBattle.drawThreat(ctx, cam, this.opp);
        if (this.pending.length && this.state === 'fight') {
            const p = this.game.player;
            const t = performance.now() / 1000;
            const x = p.position.x - cam.x, y = p.position.y - cam.y + p.drawSize * 0.32;
            ctx.save();
            ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 40);
            ctx.fillStyle = 'rgba(255, 40, 40, 0.35)';
            ctx.strokeStyle = '#ff6a6a';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(x, y, 34, 13, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }
    
    // 相手の攻撃の予告（敵の攻撃と同じ赤）：ナイフを振った所の扇形・詠唱中の魔法の通り道・落とす場所
    static drawThreat(ctx, cam, o) {
        const p = o.puppet;
        if (!p || !o.isAlive()) return;
        const t = performance.now() / 1000;
        const px = p.position.x - cam.x, py = p.position.y - cam.y + 8;
        ctx.save();
        // ナイフ：振った方向の扇形（短い間）
        const sw = o.swing;
        if (sw && sw.t < sw.life) {
            const k = 1 - sw.t / sw.life;
            const r = (p.weapon && p.weapon.range ? p.weapon.range : 90) + 18;
            const arc = (p.weapon && p.weapon.arc ? p.weapon.arc : Math.PI * 0.8) / 2;
            ctx.globalAlpha = 0.25 + 0.5 * k;
            const g = ctx.createRadialGradient(px, py, 10, px, py, r);
            g.addColorStop(0, 'rgba(255, 60, 60, 0.15)');
            g.addColorStop(1, 'rgba(255, 30, 30, 0.55)');
            ctx.fillStyle = g;
            ctx.strokeStyle = '#ff5050';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.arc(px, py, r, sw.ang - arc, sw.ang + arc);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        // 詠唱中の魔法のねらい
        const a = p.isChanting ? o.aim : null;
        if (a) {
            const pulse = 0.5 + 0.5 * Math.sin(t * 10);
            ctx.globalAlpha = 0.55 + 0.3 * pulse;
            ctx.strokeStyle = '#ff5a5a';
            ctx.fillStyle = 'rgba(255, 40, 40, 0.22)';
            ctx.lineWidth = 2;
            if (a[0] === 's') {
                const ang = Math.atan2(a[2], a[1]), len = Math.min(900, a[3]), w = Math.max(14, a[4] * 1.1);
                ctx.translate(px, py);
                ctx.rotate(ang);
                ctx.fillRect(24, -w, Math.max(0, len - 24), w * 2);
                ctx.setLineDash([10, 8]);
                ctx.lineDashOffset = -t * 40;
                ctx.strokeRect(24, -w, Math.max(0, len - 24), w * 2);
            } else {
                const x = a[1] - cam.x, y = a[2] - cam.y, r = Math.max(20, a[3]);
                ctx.beginPath();
                ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.beginPath();
                ctx.ellipse(x, y, r * (0.3 + 0.7 * pulse), r * 0.6 * (0.3 + 0.7 * pulse), 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.restore();
    }
    
    drawWorld(ctx, cam) {
        const o = this.opp;
        if (!o) return;
        // 相手の名前と HP（頭の上）
        const p = o.puppet;
        const x = Math.round(p.position.x - cam.x), y = Math.round(p.position.y - cam.y - p.drawSize / 2 - 6);
        ctx.save();
        ctx.font = 'bold 15px "DotGothic16", sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(10, 6, 20, 0.9)';
        ctx.strokeText(o.label, x, y - 10);
        ctx.fillStyle = '#ffb3c0';
        ctx.fillText(o.label, x, y - 10);
        const w = 60, k = o.maxHP > 0 ? Math.max(0, o.currentHP / o.maxHP) : 0;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x - w / 2 - 1, y - 6, w + 2, 7);
        ctx.fillStyle = k > 0.3 ? '#ff6a7a' : '#ff3a3a';
        ctx.fillRect(x - w / 2, y - 5, w * k, 5);
        // 「回避！」（自分の攻撃が、相手の回避でよけられた）
        ctx.font = 'bold 20px "DotGothic16", sans-serif';
        for (const q of this.pops) {
            const a = Math.min(1, (0.9 - q.t) / 0.3);
            ctx.globalAlpha = Math.max(0, a);
            const qy = q.y - cam.y - q.t * 30;
            ctx.strokeText(q.text, q.x - cam.x, qy);
            ctx.fillStyle = '#bfefff';
            ctx.fillText(q.text, q.x - cam.x, qy);
        }
        ctx.restore();
    }
}

// 相手の主人公（敵として置く。動きは届いた様子で出す。当たった分は相手へ送る）
class PvpOpponent extends Enemy {
    constructor(pvp, pos, gender, name) {
        super({ name: 'pvp_opponent', enemyId: 'pvp', displayName: name, hp: 1, attack: 0, defense: 0, exp: 0, size: 64, speed: 0 }, pos);
        this.pvp = pvp;
        this.size = 64;            // 主人公の当たり判定と同じ（Enemy.SCALE で変えない）
        this.noBody = true;        // 体はすり抜けられる（通信の遅れで引っかからないように）。体当たりのダメージもない
        this.label = name;
        this.puppet = new Player(pos.x, pos.y, gender);
        this.puppet.setLevel(PvpBattle.LEVEL);
        this.maxHP = this.puppet.maxHP;
        this.currentHP = this.maxHP;
        this.buf = [];
        this.off = Infinity;
        this.as = 0;
        this.chant = '';
        this.rd = 1;
        this.aim = null;           // 詠唱中の魔法のねらい（届いた ca）
        this.swing = null;         // ナイフを振った所（赤い扇形の予告）
        this.lastT = performance.now();
    }
    
    push(m) {
        const now = performance.now();
        this.off = Math.min(this.off, now - m.t);
        // 次のラウンドで最初の場所に戻った：前の位置からすべらせない
        if (m.rd !== undefined && Number(m.rd) !== this.rd) { this.rd = Number(m.rd); this.buf = []; }
        this.buf.push(m);
        if (this.buf.length > 24) this.buf.shift();
        if (typeof m.mhp === 'number' && m.mhp > 0) this.maxHP = m.mhp;
        if (typeof m.hp === 'number') this.currentHP = Math.max(0, m.hp);
        if (m.dead) this.currentHP = 0;
        if (this.currentHP <= 0) { this.dying = true; this.deathReady = false; }
        else this.dying = false;
    }
    
    isAlive() { return this.currentHP > 0 && !this.dying; }
    getDrops() { return { exp: 0, items: [] }; }
    
    // 攻撃した人の画面で当たった：相手へ送る（数字は返事が来た時）
    takeDamage(damage, direction = null, canStagger = true, kind = '', knock = 0) {
        const res = { damage: 0, position: this.position.clone(), staggered: false };
        if (!this.isAlive()) return res;
        const from = this.position.sub(direction && direction.length && direction.length() > 0.01 ? direction.normalize().mult(60) : new Vector2(0, 60));
        this.pvp.claim(damage, from, kind);
        return res;
    }
    
    update(dt) {
        const p = this.puppet, b = this.buf;
        // ジャスト回避のスローでも、相手の動きは本当の時間で出す（相手は別の人なので）
        const now = performance.now();
        const rdt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000));
        this.lastT = now;
        dt = rdt;
        if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
        if (this.swing) this.swing.t += dt;
        if (!b.length) return;
        const dirs = { u: 'up', d: 'down', l: 'left', r: 'right' };
        const rt = now - this.off - PvpBattle.INTERP_MS;
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
        this.position = p.position;
        p.direction = dirs[cur.d] || p.direction;
        this.direction = p.direction;
        p.isMoving = !!cur.mv;
        p.isDashing = !!cur.ds && p.isMoving;
        p.currentHP = this.currentHP; p.maxHP = this.maxHP;
        if (cur.as !== this.as) {
            const first = this.as === 0 && this.swing === null && cur.as > 1;
            this.as = cur.as;
            if (!first) {
                p.isAttacking = true;
                p.attackAnimTimer = p.attackAnimDuration;
                p.aimVector = new Vector2(Math.cos(cur.aa), Math.sin(cur.aa));
                p.slashFlip = !p.slashFlip;
                p.slashFx = { t: 0, angle: cur.aa, flip: p.slashFlip };
                this.swing = { t: 0, life: 0.32, ang: cur.aa };
            }
        }
        p.updateAttack(dt);
        if (cur.dg && !p.isDodging) { p.isDodging = true; p.dodgeTimer = p.dodgeDuration; }
        if (p.isDodging) { p.dodgeTimer -= dt; if (p.dodgeTimer <= 0 || !cur.dg) p.isDodging = false; }
        if (cur.ch && this.chant !== cur.ch) {
            const m = p.getMagicData(cur.ch);
            if (m) { p.isChanting = true; p.chantMagic = m; p.chantTime = 0; p.chantDuration = (m.chantTime || 1) * Player.CHANT_TIME_MUL; }
        }
        this.chant = cur.ch;
        this.aim = cur.ch && Array.isArray(cur.ca) ? cur.ca : null;
        if (!cur.ch) { p.isChanting = false; p.chantMagic = null; }
        if (p.isChanting) { p.updateChant(dt); p.readyCast = null; if (!p.isChanting && cur.ch) { p.isChanting = true; p.chantMagic = p.getMagicData(cur.ch); } }
        if (p.isDashing) {
            p.dashFrameTimer += dt;
            if (p.dashFrameTimer >= p.dashFrameSpeed) { p.dashFrameTimer = 0; p.dashFrame = (p.dashFrame + 1) % p.actionFrameCount; }
        }
        if (p.isMoving) {
            p.animationTimer += dt;
            if (p.animationTimer >= p.animationSpeed * (p.isDashing ? 0.55 : 1)) { p.animationTimer = 0; p.animationFrame = (p.animationFrame + 1) % 3; }
        } else p.animationFrame = 1;
    }
    
    draw(ctx, cam) {
        ctx.save();
        if (!this.isAlive()) ctx.globalAlpha = 0.5;
        this.puppet.draw(ctx, cam);
        // 当たった時の白い光
        if (this.hitFlashTimer > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#ffffff';
            const s = this.puppet.drawSize;
            ctx.beginPath();
            ctx.ellipse(this.position.x - cam.x, this.position.y - cam.y, s * 0.28, s * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

PvpBattle.LEVEL = 10;            // 2人とも、このレベルのステータスで戦う
PvpBattle.RULE_TIMES = [1, 2, 3, 5];    // 選べる制限時間（分）
PvpBattle.RULE_POINTS = [1, 2, 3, 5];   // 選べる「何点先取」
PvpBattle.DEFAULT_RULE = { tm: 3, pt: 3 };
PvpBattle.TIME_LIMIT = 180;      // 初めの制限時間（秒）。観戦で設定が分からない時にも使う
PvpBattle.COUNTDOWN = 5.5;       // 戦いが始まってから GO! までの秒数
PvpBattle.KO_BREAK = 2.6;        // 1点が決まってから次のラウンド（または結果）までの秒数
PvpBattle.ROUND_COUNT = 3.4;     // 次のラウンドの GO! までの秒数
PvpBattle.TICK_HZ = 10;          // 送る回数（1秒に）。2人なので 1秒に 20 回送って 20 回届く
PvpBattle.INTERP_MS = 160;       // 相手は、この時間だけ前の様子をなめらかに出す
PvpBattle.HIT_GRACE_MS = 150;    // 相手の攻撃が見えてから当たるまで（この間に回避すればよけられる。ジャスト回避になる）
PvpBattle.MAX_WAIT_MS = 520;     // 届いた攻撃を待つのは、長くてもこの時間まで
PvpBattle.LOST_MS = 8000;        // 相手からこの間なにも届かなかったら、通信が切れたことにする
PvpBattle.MAX_HIT = 300;         // 1回で当てられるダメージの上限（おかしな値を送られても）
PvpBattle.SPAWN_DX = 230;        // まん中から、2人の出てくる所までの横の距離
PvpBattle.FIELDS = {
    arena: { name: '星の闘技場' },
    ruins: { name: '古代星紋遺跡' },
    battlefield: { name: '歴戦の跡地' }
};

window.PvpBattle = PvpBattle;
window.PvpOpponent = PvpOpponent;
