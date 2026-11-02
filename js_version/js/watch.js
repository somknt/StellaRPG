// 観戦（星の酒場）
//
// しくみ
//   戦っているパーティーのホスト（協力プレイのホスト・PvP の対戦開始を押した人）が、酒場のルームの観戦のチャンネル
//   hoshinoko-watch-<ルーム> に「この戦いをしている」と WatchBeacon で知らせる（CoopBattle.BEACON_SEC 秒ごと）
//   酒場にいて、パーティーに入っていない人は、扉を調べると今の戦いの一覧が出る。選ぶと、その戦いのチャンネル
//   hoshinoko-party-<パーティーの id> に入って、送られてくる様子を見るだけ（自分からは何も送らない）
//     協力プレイ：CoopBattle をミラー（ホスト以外の人と同じ）で動かし、自分の主人公は出さない（mp_battle.js の spectator）
//     PvP：PvpWatch（2人の主人公を、届いた様子で動かす）
//   1つの戦いを観戦できるのは CoopBattle.MAX_WATCH 人まで（Realtime の上限のため）。presence の入った順で決める
//   データベースには何も書かない。観戦しても報酬・記録はない

// ---------- ホスト：酒場へ「戦っている」と知らせる ----------
// 酒場の観戦のチャンネル（TavernScene.ensureWatchCh。戦いの間もつないだまま）で送る
class WatchBeacon {
    constructor(tavern, info) {
        this.tavern = tavern;
        this.info = info;   // () => 知らせる中身
        this.on = true;
        this.timer = setInterval(() => this.send(), CoopBattle.BEACON_SEC * 1000);
        setTimeout(() => this.send(), 500);
    }
    
    channel() { return this.tavern && this.tavern.active ? this.tavern.ensureWatchCh() : null; }
    
    send() {
        if (!this.on) return;
        const ch = this.channel();
        const m = this.info();
        if (ch && m) ch.send('b', m);
    }
    
    // 戦いが終わった：一覧から消してもらう
    stop() {
        if (!this.on) return;
        this.on = false;
        clearInterval(this.timer);
        const ch = this.tavern && this.tavern.watchCh;
        const m = this.info();
        if (ch && m) ch.send('x', { p: m.p });
    }
}

// ---------- 届いた知らせを確かめる（おかしな物は捨てる） ----------
const WatchInfo = {
    LIFE_MS: 10000,   // この間なにも届かなかった戦いは、一覧から消す
    
    parse(m) {
        if (!m || typeof m !== 'object') return null;
        const id = (v) => typeof v === 'string' && /^[0-9a-f-]{8,40}$/i.test(v);
        if (!id(m.p) || !id(m.b) || !id(m.h)) return null;
        if (m.k !== 'coop' && m.k !== 'pvp') return null;
        if (!Array.isArray(m.m) || m.m.length < 2 || m.m.length > 4) return null;
        const members = [];
        for (const x of m.m) {
            if (!Array.isArray(x) || !id(x[0])) return null;
            const name = window.Account ? Account.cleanName(String(x[1] || '')) : String(x[1] || '').slice(0, 12);
            members.push({ pid: x[0], name: name || '？', gender: x[2] === 'female' ? 'female' : 'male' });
        }
        if (!members.some(x => x.pid === m.h)) return null;
        const out = { p: m.p, b: m.b, k: m.k, h: m.h, members, at: Math.max(0, Math.min(3600, Number(m.at) || 0)) };
        if (m.k === 'coop') {
            const def = typeof getBossData === 'function' ? getBossData(m.boss) : null;
            if (!def || def.status !== 'playable') return null;
            out.boss = m.boss;
            out.title = `${def.name}討伐（${members.length}人）`;
        } else {
            if (members.length !== 2 || !PvpBattle.FIELDS[m.f]) return null;
            out.field = m.f;
            out.rule = PvpBattle.normRule(Array.isArray(m.cf) ? { tm: m.cf[0], pt: m.cf[1] } : null);
            out.title = `PvP：${members[0].name} vs ${members[1].name}（${PvpBattle.FIELDS[m.f].name}・${PvpBattle.ruleText(out.rule)}）`;
        }
        return out;
    }
};

// ---------- 観戦中の画面の帯（上のまん中：見ている人の名前・◀ ▶・観戦をやめる） ----------
const WatchBar = {
    el() { return document.getElementById('watch-bar'); },
    show(watcher) {
        const el = this.el();
        document.body.dataset.watch = '1';
        if (!el) return;
        el.hidden = false;
        this.watcher = watcher;
        if (!this.bound) {
            this.bound = true;
            const on = (id, fn) => {
                const b = document.getElementById(id);
                if (b) b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (window.pressEffect) pressEffect(b); fn(); });
            };
            on('wb-prev', () => this.watcher && this.watcher.switchWatch(-1));
            on('wb-next', () => this.watcher && this.watcher.switchWatch(1));
            on('wb-leave', () => { if (window.game && !game.screens.busy) game.leaveBattle('tavern'); });
        }
    },
    setName(text) {
        const n = document.getElementById('wb-name');
        if (n && n.textContent !== text) n.textContent = text;
    },
    hide() {
        const el = this.el();
        if (el) el.hidden = true;
        document.body.dataset.watch = '';
        this.watcher = null;
    },
    // ←→（A・D）で見る人を変える
    handleKeys(watcher, input) {
        if (!input) return;
        if (input.isKeyPressed('ArrowLeft') || input.isKeyPressed('KeyA')) watcher.switchWatch(-1);
        if (input.isKeyPressed('ArrowRight') || input.isKeyPressed('KeyD')) watcher.switchWatch(1);
    },
    // 観戦をやめて酒場へ（画面の切りかえの途中なら、終わってから）
    leaveSoon(game, tries = 0) {
        if (!game.watching) return;
        if (game.screens.busy && tries < 50) { setTimeout(() => this.leaveSoon(game, tries + 1), 200); return; }
        game.leaveBattle('tavern');
    },
    // 観戦の席：presence の入った順で CoopBattle.MAX_WATCH 番目まで。それより後なら false
    seatOk(list, myKey) {
        const w = list.filter(x => x.meta && x.meta.w).sort((a, b) => ((a.meta.at || 0) - (b.meta.at || 0)) || (a.key < b.key ? -1 : 1));
        const i = w.findIndex(x => x.key === myKey);
        return i < 0 || i < CoopBattle.MAX_WATCH;
    }
};

// ---------- PvP の観戦 ----------
class PvpWatch {
    constructor(game, tavern, info) {
        this.game = game;
        this.tavern = tavern;
        this.spectator = true;
        this.info = info;
        this.party = { id: info.p };
        this.battle = { id: info.b };
        this.field = info.field;
        this.members = info.members;
        this.key = `w-${tavern.pid || Math.random().toString(36).slice(2, 10)}`;
        this.puppets = new Map();     // pid → PvpOpponent
        this.lastSeen = new Map();
        this.watchIdx = 0;
        this.state = 'intro';         // 'intro'（カウントダウン） / 'fight' / 'over'
        this.rule = info.rule || PvpBattle.normRule(null);   // 対戦の設定（ホストの 'v' の cf でも直す）
        this.sc = new Map();          // pid → [その人の点, 相手の点]（届いた物）
        this.tl = null;               // 残り時間（2人から届いた物の小さい方）
        this.ko = new Map();          // pid → 倒れたラウンド（K.O. を1回だけ出す）
        this.time = Math.max(0, info.at - PvpBattle.COUNTDOWN);
        this.goAt = performance.now() + Math.max(0, PvpBattle.COUNTDOWN - info.at) * 1000;
        this.resultTimer = 0;
        this.winner = null;
        this.why = '';
        this.ui = PvpBattle.getUI();
    }
    
    get isOver() { return this.state === 'over'; }
    get isFrozen() { return false; }
    get isCinematic() { return false; }
    
    begin() {
        const now = performance.now();
        for (const m of this.members) this.lastSeen.set(m.pid, now);
        this.channel = Net.join(`hoshinoko-party-${this.party.id}`, this.key, { w: 1, at: Date.now() }, {
            v: (m) => this.onRemote(m),
            presence: (list) => this.checkSeat(list)
        });
        this.game.startPvpBattle(this);
    }
    
    checkSeat(list) {
        if (this.seatChecked || this.isOver) return;
        if (!list.some(x => x.key === this.key)) return;
        this.seatChecked = true;
        if (!WatchBar.seatOk(list, this.key)) {
            this.tavern.toast(`観戦の席がいっぱいです（1つの戦いに${CoopBattle.MAX_WATCH}人まで）`, 4);
            WatchBar.leaveSoon(this.game);
        }
    }
    
    // game.startPvpBattle から：フィールドを置いた後
    attach() {
        const game = this.game, map = game.map;
        const w = map.width * map.tileSize, h = map.height * map.tileSize;
        const c = PvpBattle.prototype.fieldCenter.call(this, map, w, h);
        game.player.position = c.clone();
        game.hidePlayerForWatch();
        this.members.forEach((m, i) => {
            const pos = map.findFreeSpot(c.add(new Vector2(i === 0 ? -PvpBattle.SPAWN_DX : PvpBattle.SPAWN_DX, 0)), game.player.getFootBox(), 200);
            const o = new PvpOpponent(this, pos, m.gender, m.name);
            o.puppet.direction = i === 0 ? 'right' : 'left';
            o.map = map;
            game.enemySpawner.enemies.push(o);
            this.puppets.set(m.pid, o);
        });
        this.followWatched(true);
        this.showHud();
        WatchBar.show(this);
        this.updateWatchName();
        this.showBanner('観戦中', `${this.members[0].name} vs ${this.members[1].name}　─　${PvpBattle.FIELDS[this.field].name}`, 'boss');
        playBGM('bgm_boss');
    }
    
    claim() {}   // 観戦する人は当てない
    
    stop() {
        if (this.channel) this.channel.leave();
        this.channel = null;
        WatchBar.hide();
        PvpBattle.prototype.stop.call(this);
    }
    
    // ---------- 見る人 ----------
    switchWatch(d) {
        this.watchIdx = (this.watchIdx + d + this.members.length) % this.members.length;
        this.followWatched(true);
        this.updateWatchName();
        playSE('ui_cursor');
    }
    
    watched() { return this.puppets.get(this.members[this.watchIdx].pid); }
    
    followWatched(snap = false) {
        const o = this.watched();
        if (!o) return;
        const cam = this.game.camera;
        if (cam.target !== o.puppet) { cam.follow(o.puppet); if (snap) cam.snapToTarget(); }
    }
    
    updateWatchName() { WatchBar.setName(`${this.members[this.watchIdx].name} を見ています`); }
    
    // ---------- 毎フレーム ----------
    update(dt) {
        const now = performance.now();
        WatchBar.handleKeys(this, this.game.input);
        this.followWatched();
        if (this.state === 'intro') {
            const left = (this.goAt - now) / 1000;
            if (left <= 0) { this.state = 'fight'; this.showCount('GO!', true); setTimeout(() => this.showCount(''), 700); }
            else if (left <= 3) this.showCount(String(Math.ceil(left)));
        } else if (this.state === 'fight') {
            this.time += dt;
            // 通信が切れた人：もう1人の勝ち（2人とも切れた時は、観戦を終わる）
            const lost = this.members.filter(m => now - (this.lastSeen.get(m.pid) || 0) > PvpBattle.LOST_MS);
            if (lost.length === 2) this.finish(null, '2人とも通信が切れました', true);
            else if (lost.length === 1) this.finish(this.members.find(m => m !== lost[0]).pid, `${lost[0].name}の通信が切れました`);
            // 時間切れなのに結果が届かない
            else if (this.time > this.rule.tm * 60 + 30 + 6 * this.rule.pt) this.finish(null, '結果が届きませんでした', true);
        } else if (this.resultTimer > 0) {
            this.resultTimer -= dt;
            if (this.resultTimer <= 0) this.showResult();
        }
        this.updateHud();
    }
    
    // 2人の様子（'v'）。ほかの人（観戦の人など）からの物は使わない
    onRemote(m) {
        if (!m || !this.puppets.has(m.s)) return;
        this.lastSeen.set(m.s, performance.now());
        const o = this.puppets.get(m.s);
        o.push(m);
        if (this.state === 'intro' && m.st === 'f') { this.state = 'fight'; this.showCount(''); }
        // 当てられた人が送ってきた、本当に減った数：その人の上に数字を出す
        if (Array.isArray(m.a)) for (const a of m.a) {
            const d = Array.isArray(a) ? Math.round(Number(a[1]) || 0) : 0;
            if (d > 0 && d <= PvpBattle.MAX_HIT) { this.game.damageNumbers.add(d, o); o.hitFlashTimer = 0.12; }
        }
        if (Array.isArray(m.c) && m.c.length) PvpBattle.prototype.showRemoteCasts.call(this, m.c.slice(0, 4));
        // 点・残り時間・設定（ホストの物）
        if (Array.isArray(m.sc)) this.sc.set(m.s, [Number(m.sc[0]) || 0, Number(m.sc[1]) || 0]);
        if (typeof m.tl === 'number') this.tl = this.tl === null ? m.tl : Math.min(this.tl + 1, Math.max(m.tl, this.tl - 1));
        if (Array.isArray(m.cf) && m.s === this.info.h) this.rule = PvpBattle.normRule({ tm: m.cf[0], pt: m.cf[1] });
        if (this.isOver) return;
        const other = this.members.find(x => x.pid !== m.s);
        // 結果（時間切れ・点が決まった）
        if (m.e && m.e.r === 'd') { this.finish(null, m.e.k === 't' ? '時間切れ' : ''); return; }
        if (m.e && this.puppets.has(m.e.r)) { this.finish(m.e.r, m.e.k === 't' ? '時間切れ' : this.scoreText(m.e.r)); return; }
        if (m.st === 'v') { this.finish(m.s, this.scoreText(m.s)); return; }
        // 1点（そのラウンドで倒れた）：K.O. を出す
        if (m.dead && this.ko.get(m.s) !== m.rd) {
            this.ko.set(m.s, m.rd);
            this.showBanner('K.O.!', `${other.name}が1点`, 'boss');
            playSE('boss_down');
        }
    }
    // 勝った人から見た点（例 3 - 1）
    scoreText(pid) { const a = this.sc.get(pid); return a ? `${a[0]} - ${a[1]}` : ''; }
    nameOf(pid) { const m = this.members.find(x => x.pid === pid); return m ? m.name : '？'; }
    
    finish(winner, why, lostAll = false) {
        if (this.isOver) return;
        this.state = 'over';
        this.winner = winner;
        this.why = why || '';
        this.lostAll = lostAll;
        this.resultTimer = 2.4;
        const main = lostAll ? '観戦終了' : winner ? `${this.nameOf(winner)}の勝ち！` : '引き分け';
        this.showBanner(main, this.why, winner ? 'victory' : 'defeat');
        playSE(winner ? 'boss_down' : 'ui_cancel');
        if (winner) {
            const o = this.puppets.get(winner);
            if (o) this.game.camera.follow(o.puppet);
        }
    }
    
    // ---------- 表示 ----------
    // 観戦の時は、2人の HP（上が1人目・下が2人目）と、2人の点
    showHud() {
        const u = this.ui;
        document.body.dataset.battle = 'pvp';
        document.body.dataset.coop = '1';
        document.body.dataset.waves = 'off';
        if (u.hud) u.hud.dataset.mode = 'watch';
        if (u.meName) u.meName.textContent = this.members[0].name;
        if (u.opName) u.opName.textContent = this.members[1].name;
        if (u.plMe) u.plMe.textContent = this.members[0].name;
        if (u.plOp) u.plOp.textContent = this.members[1].name;
        if (u.hud) u.hud.classList.add('show');
        this._ptsKey = '';
        this.updateHud();
    }
    updateHud() {
        const u = this.ui;
        const a = this.puppets.get(this.members[0].pid), b = this.puppets.get(this.members[1].pid);
        if (!u.hud || !a || !b) return;
        const set = (fill, txt, hp, mhp) => {
            const k = mhp > 0 ? Math.max(0, Math.min(1, hp / mhp)) : 0;
            if (fill) fill.style.width = (k * 100).toFixed(1) + '%';
            if (txt) { const s = `${Math.ceil(Math.max(0, hp))} / ${mhp}`; if (txt.textContent !== s) txt.textContent = s; }
        };
        set(u.meFill, u.meHp, a.currentHP, a.maxHP);
        set(u.opFill, u.opHp, b.currentHP, b.maxHP);
        if (u.opTrail) u.opTrail.style.width = '0%';
        // 点：その人が送ってきた自分の点（届いていなければ、相手が送ってきた「相手の点」）
        const pts = (i) => {
            const me = this.sc.get(this.members[i].pid), ot = this.sc.get(this.members[1 - i].pid);
            return Math.max(me ? me[0] : 0, ot ? ot[1] : 0);
        };
        PvpBattle.setPoints(u, pts(0), pts(1), this.rule.pt, this);
        PvpBattle.setTimer(u, this.tl !== null ? this.tl : this.rule.tm * 60 - this.time, this.state === 'fight');
        const rd = Math.max(a.rd || 1, b.rd || 1);
        const r = `ROUND ${rd}`;
        if (u.round && u.round.textContent !== r) u.round.textContent = r;
        const f = `${PvpBattle.FIELDS[this.field].name}（観戦中）　${PvpBattle.ruleText(this.rule)}`;
        if (u.field && u.field.textContent !== f) u.field.textContent = f;
    }    showResult() {
        const u = this.ui;
        if (!u.result) return;
        u.rTitle.textContent = '観戦終了';
        u.rSub.textContent = this.lostAll ? this.why : this.winner ? `${this.nameOf(this.winner)}の勝利${this.why ? `（${this.why}）` : ''}` : `引き分け${this.why ? `（${this.why}）` : ''}`;
        u.result.classList.remove('win');
        const t = Math.floor(this.time);
        const rows = [['フィールド', PvpBattle.FIELDS[this.field].name], ['ルール', PvpBattle.ruleText(this.rule)], ['戦った時間', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`]];
        for (const m of this.members) {
            const o = this.puppets.get(m.pid);
            rows.push([`${m.name}の残りHP`, o ? `${Math.max(0, Math.ceil(o.currentHP))} / ${o.maxHP}` : '─']);
        }
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
    
    handleResultKeys(input) { if (this.nav) this.nav.handle(input); }
    
    // 2人の名前と HP（頭の上）
    drawWorld(ctx, cam) {
        this.members.forEach((m, i) => {
            const o = this.puppets.get(m.pid);
            if (!o) return;
            const p = o.puppet;
            const x = Math.round(p.position.x - cam.x), y = Math.round(p.position.y - cam.y - p.drawSize / 2 - 6);
            ctx.save();
            ctx.font = 'bold 15px "DotGothic16", sans-serif';
            ctx.textAlign = 'center';
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(10, 6, 20, 0.9)';
            ctx.strokeText(o.label, x, y - 10);
            ctx.fillStyle = i === 0 ? '#ffe9a0' : '#ffb3c0';
            ctx.fillText(o.label, x, y - 10);
            const w = 60, k = o.maxHP > 0 ? Math.max(0, o.currentHP / o.maxHP) : 0;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(x - w / 2 - 1, y - 6, w + 2, 7);
            ctx.fillStyle = i === 0 ? '#5be37a' : '#ff6a7a';
            ctx.fillRect(x - w / 2, y - 5, w * k, 5);
            ctx.restore();
        });
    }
}
PvpWatch.prototype.showBanner = PvpBattle.prototype.showBanner;
PvpWatch.prototype.showCount = PvpBattle.prototype.showCount;

window.WatchBeacon = WatchBeacon;
window.WatchInfo = WatchInfo;
window.WatchBar = WatchBar;
window.PvpWatch = PvpWatch;
