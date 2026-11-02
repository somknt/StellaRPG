// PvP（2人の対戦）。星の酒場の PvP の準備画面で、リーダーが選んだフィールド（闘技場・遺跡・跡地）で戦う
//
// しくみ（2人とも同じ立場）
//   相手の主人公は「敵」の1つ（PvpOpponent。Enemy を受けつぐ）として置く。だから、ナイフ・魔法・ターゲットは今のしくみのまま使える
//   相手に当たったかは、攻撃した人の画面で決める（PvpOpponent.takeDamage）。当たった分を相手に送る（'v' の h）
//   受け取った人は、自分の主人公に当てる（回避中ならよけられる。防御力も引く）。本当に減った数を送り返す（a）→ 攻撃した人の画面に数字が出る
//   HP が 0 になった人の負け。制限時間（PvpBattle.TIME_LIMIT 秒）が来たら、HP の割合が多い方の勝ち（同じなら引き分け）
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
        this.state = 'intro';    // 'intro'（カウントダウン） / 'fight' / 'victory' / 'defeat' / 'draw'
        this.claims = [];        // 相手に当てた分（送る）
        this.acks = [];          // 当てられた分の、本当に減った数（送る）
        this.casts = [];         // 撃った魔法（相手の画面にも見た目だけ出す）
        this.incoming = [];      // 届いた、当てられた分（次のフレームで自分に当てる）
        this.seq = 0;
        this.sendT = 0;
        this.atkSeq = 0;
        this.atkAng = 0;
        this.lastSeen = performance.now();
        this.time = 0;
        this.resultTimer = 0;
        this.ui = PvpBattle.getUI();
        // 開始の時刻をサーバーの戦いの始まりにそろえる（2人のカウントダウンが同じ時に終わるように）
        const elapsed = Number(this.battle.elapsed) || 0;
        this.goAt = performance.now() + Math.max(1.2, PvpBattle.COUNTDOWN - elapsed) * 1000;
    }
    
    static getUI() {
        const $ = (id) => document.getElementById(id);
        return {
            hud: $('pvp-hud'), meName: $('pvh-me-name'), meFill: $('pvh-me-fill'), meHp: $('pvh-me-hp'),
            opName: $('pvh-op-name'), opFill: $('pvh-op-fill'), opHp: $('pvh-op-hp'), timer: $('pvh-timer'), field: $('pvh-field'),
            banner: $('battle-banner'), bannerMain: $('battle-banner-main'), bannerSub: $('battle-banner-sub'), count: $('battle-countdown'),
            result: $('pvp-result'), rTitle: $('pvr-title'), rSub: $('pvr-sub'), rStats: $('pvr-stats'), rBack: $('pvr-back')
        };
    }
    
    get isOver() { return this.state === 'victory' || this.state === 'defeat' || this.state === 'draw'; }
    get isFrozen() { return this.state === 'intro'; }
    get isCinematic() { return false; }
    
    // ---------- 始める・やめる ----------
    begin() {
        const game = this.game;
        this.channel = Net.join(`hoshinoko-party-${this.party.id}`, this.pid, { s: this.pid, n: this.me.name || '' }, {
            v: (m) => this.onRemote(m)
        });
        game.startPvpBattle(this);
    }
    
    // game.startPvpBattle から：フィールドと主人公を置いた後
    attach() {
        const game = this.game, map = game.map;
        const p = game.player;
        p.setLevel(PvpBattle.LEVEL);
        p.levelLocked = true;
        // 2人の出てくる所：フィールドのまん中から左右に分かれて、向かい合う（先に参加した人が左）
        const w = map.width * map.tileSize, h = map.height * map.tileSize;
        const c = map.layers && map.layers.pvpCenter ? new Vector2(map.layers.pvpCenter.x, map.layers.pvpCenter.y) : this.fieldCenter(map, w, h);
        const left = this.battle.members.indexOf(this.pid) === 0;
        const off = PvpBattle.SPAWN_DX;
        p.position = map.findFreeSpot(c.add(new Vector2(left ? -off : off, 0)), p.getFootBox(), 200);
        p.direction = left ? 'right' : 'left';
        this.opp = new PvpOpponent(this, c.add(new Vector2(left ? off : -off, 0)), this.other.gender === 'female' ? 'female' : 'male', this.other.name || '？');
        this.opp.puppet.direction = left ? 'left' : 'right';
        this.opp.map = map;
        game.enemySpawner.enemies.push(this.opp);
        game.camera.snapToTarget();
        this.showHud();
        this.showBanner(`VS ${this.other.name || '？'}`, PvpBattle.FIELDS[this.field].name, 'boss');
        playBGM('bgm_boss');
    }
    
    // フィールドの、ふつうの出てくる所とまん中の間（壁や門の近くにならないように）
    fieldCenter(map, w, h) {
        const s = map.getPlayerSpawn();
        return new Vector2(w / 2, (s.y + h / 2) / 2);
    }
    
    stop() {
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
            if (left <= 0) { this.state = 'fight'; this.showCount('GO!', true); playSE('battle_start'); setTimeout(() => this.showCount(''), 700); }
            else if (left <= 3) this.showCount(String(Math.ceil(left)));
        } else if (this.state === 'fight') {
            this.time += dt;
            // 当てられた分を自分の主人公に当てる
            const p = this.game.player;
            for (const h of this.incoming.splice(0)) {
                const [id, dmg, x, y, ult] = h;
                const d = Math.max(0, Math.min(PvpBattle.MAX_HIT, Number(dmg) || 0));
                const before = p.currentHP;
                const got = p.isDead() ? 0 : p.takeDamage(d, new Vector2(Number(x) || p.position.x, Number(y) || p.position.y), ult ? { ult: true } : null);
                this.acks.push([id, Math.max(0, Math.round(before - p.currentHP)) || (got > 0 ? Math.round(got) : 0)]);
            }
            // 時間切れ：HP の割合の多い方の勝ち（ホストが決めて送る。ホストがいない時はそれぞれ決める）
            if (this.time >= PvpBattle.TIME_LIMIT && (this.host || this.time >= PvpBattle.TIME_LIMIT + 3)) this.timeUp();
            // 相手から何も届かない：相手の通信が切れた
            if (now - this.lastSeen > PvpBattle.LOST_MS) this.finish('victory', '相手の通信が切れました');
        } else if (this.isOver && this.resultTimer > 0) {
            this.resultTimer -= dt;
            if (this.resultTimer <= 0) this.showResult();
        }
        this.sendT += dt;
        if (this.sendT >= 1 / PvpBattle.TICK_HZ) { this.sendT = 0; this.sendTick(); }
        this.updateHud();
    }
    
    timeUp() {
        if (this.isOver) return;
        const p = this.game.player, o = this.opp;
        const mine = p.maxHP ? p.currentHP / p.maxHP : 0, theirs = o.maxHP ? o.currentHP / o.maxHP : 0;
        const r = Math.abs(mine - theirs) < 0.005 ? 'draw' : mine > theirs ? 'victory' : 'defeat';
        this.endMsg = { r: r === 'draw' ? 'd' : r === 'victory' ? this.pid : this.other.pid };
        this.finish(r, '時間切れ');
    }
    
    // 自分の HP が 0（game.js が呼ぶ）
    onDefeat() {
        if (this.state !== 'fight') return;
        this.finish('defeat', '');
    }
    
    finish(result, why) {
        if (this.isOver) return;
        this.state = result;
        this.why = why || '';
        this.resultTimer = 2.4;
        this.sendTick();
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
        const p = this.game.player;
        if (p.slashFx && p.slashFx !== this._lastSlash) { this._lastSlash = p.slashFx; this.atkSeq++; this.atkAng = p.slashFx.angle; }
        const msg = {
            s: this.pid, t: Math.round(performance.now()), x: Math.round(p.position.x), y: Math.round(p.position.y), d: p.direction[0],
            mv: p.isMoving ? 1 : 0, ds: p.isDashing ? 1 : 0, as: this.atkSeq, aa: Math.round(this.atkAng * 100) / 100,
            dg: p.isDodging ? 1 : 0, ch: p.isChanting && p.chantMagic ? p.chantMagic.id : '',
            hp: Math.max(0, Math.ceil(p.currentHP)), mhp: p.maxHP, dead: p.isDead() ? 1 : 0, st: this.state[0],
            h: this.claims.splice(0), a: this.acks.splice(0), c: this.casts.splice(0)
        };
        if (this.endMsg) msg.e = this.endMsg;
        this.channel.send('v', msg);
    }
    
    // ---------- 受け取った ----------
    onRemote(m) {
        if (!m || m.s === this.pid || m.s !== this.other.pid) return;
        this.lastSeen = performance.now();
        const o = this.opp;
        if (!o) return;
        o.push(m);
        if (Array.isArray(m.h)) for (const h of m.h) if (Array.isArray(h)) this.incoming.push(h);
        if (Array.isArray(m.a)) for (const [id, dmg] of m.a) {
            const d = Math.round(Number(dmg) || 0);
            if (d > 0) { this.game.damageNumbers.add(d, o); playSE('attack_hit'); o.hitFlashTimer = 0.12; }
        }
        if (Array.isArray(m.c) && m.c.length) this.showRemoteCasts(m.c);
        // 相手が倒れた・時間切れの結果を送ってきた
        if (this.state === 'fight') {
            if (m.dead) { o.currentHP = 0; this.finish('victory', ''); }
            else if (m.e && m.e.r) this.finish(m.e.r === 'd' ? 'draw' : m.e.r === this.pid ? 'victory' : 'defeat', '時間切れ');
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
    showHud() {
        const u = this.ui;
        document.body.dataset.battle = 'pvp';
        document.body.dataset.coop = '1';     // 一時停止のボタンを出さない
        document.body.dataset.waves = 'off';  // ウェーブの表示は出さない
        if (u.meName) u.meName.textContent = this.me.name || Account.playerName || '';
        if (u.opName) u.opName.textContent = this.other.name || '？';
        if (u.field) u.field.textContent = PvpBattle.FIELDS[this.field].name;
        if (u.hud) u.hud.classList.add('show');
        this.updateHud();
    }
    
    updateHud() {
        const u = this.ui, p = this.game.player, o = this.opp;
        if (!u.hud || !p || !o) return;
        const set = (fill, txt, hp, mhp) => {
            const k = mhp > 0 ? Math.max(0, Math.min(1, hp / mhp)) : 0;
            if (fill) fill.style.width = (k * 100).toFixed(1) + '%';
            if (txt) { const s = `${Math.ceil(Math.max(0, hp))} / ${mhp}`; if (txt.textContent !== s) txt.textContent = s; }
        };
        set(u.meFill, u.meHp, p.currentHP, p.maxHP);
        set(u.opFill, u.opHp, o.currentHP, o.maxHP);
        if (u.timer) {
            const left = Math.max(0, Math.ceil(PvpBattle.TIME_LIMIT - this.time));
            const s = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
            if (u.timer.textContent !== s) u.timer.textContent = s;
            u.timer.classList.toggle('low', left <= 20 && this.state === 'fight');
        }
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
        const rows = [
            ['フィールド', PvpBattle.FIELDS[this.field].name],
            ['対戦相手', this.other.name || '？'],
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
    }
    
    push(m) {
        const now = performance.now();
        this.off = Math.min(this.off, now - m.t);
        this.buf.push(m);
        if (this.buf.length > 24) this.buf.shift();
        if (typeof m.mhp === 'number' && m.mhp > 0) this.maxHP = m.mhp;
        if (typeof m.hp === 'number') this.currentHP = Math.max(0, m.hp);
        if (m.dead) this.currentHP = 0;
        if (this.currentHP <= 0) { this.dying = true; this.deathReady = false; }
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
        if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
        if (!b.length) return;
        const dirs = { u: 'up', d: 'down', l: 'left', r: 'right' };
        const rt = performance.now() - this.off - PvpBattle.INTERP_MS;
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
            this.as = cur.as;
            p.isAttacking = true;
            p.attackAnimTimer = p.attackAnimDuration;
            p.aimVector = new Vector2(Math.cos(cur.aa), Math.sin(cur.aa));
            p.slashFlip = !p.slashFlip;
            p.slashFx = { t: 0, angle: cur.aa, flip: p.slashFlip };
        }
        p.updateAttack(dt);
        if (cur.dg && !p.isDodging) { p.isDodging = true; p.dodgeTimer = p.dodgeDuration; }
        if (p.isDodging) { p.dodgeTimer -= dt; if (p.dodgeTimer <= 0 || !cur.dg) p.isDodging = false; }
        if (cur.ch && this.chant !== cur.ch) {
            const m = p.getMagicData(cur.ch);
            if (m) { p.isChanting = true; p.chantMagic = m; p.chantTime = 0; p.chantDuration = (m.chantTime || 1) * Player.CHANT_TIME_MUL; }
        }
        this.chant = cur.ch;
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
PvpBattle.TIME_LIMIT = 180;      // 制限時間（秒）
PvpBattle.COUNTDOWN = 5.5;       // 戦いが始まってから GO! までの秒数
PvpBattle.TICK_HZ = 10;          // 送る回数（1秒に）。2人なので 1秒に 20 回送って 20 回届く
PvpBattle.INTERP_MS = 160;       // 相手は、この時間だけ前の様子をなめらかに出す
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
