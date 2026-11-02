// 星の酒場（マルチプレイのロビー）
//
// 流れ：バトルモード → マルチプレイ → 星の酒場（南の魔法陣から出てくる）
//   マスターに話す → 協力プレイ（モンスター選択でクエストを受注。受けた人がリーダー）/ PvP（対戦相手の募集）/ やめる
//   クエスト掲示板 → 募集中のクエストに参加する（協力プレイは4人まで・PvP は2人まで）
//   扉 → 自分のパーティーの扉だけが開く。入ると待機（扉の上に「入った人数/最大人数」）
//   リーダーが募集を締め切り、パーティーの全員が扉に入ると準備画面（screens.js の mp_prep）→ バトル開始（mp_battle.js）
//
// 通信（net.js）
//   位置・向き・頭の上の印：Realtime のチャンネル hoshinoko-tavern-<ルーム>（broadcast 'p'。presence でだれがいるか）
//   パーティー・扉・準備：データベースの関数 hk_mp_*（2秒ごとに読み直す。変えた人は 'nudge' を送り、ほかの人はすぐ読み直す）
//   ルームは 1つ TavernScene.ROOM_CAP 人まで。いっぱいなら次のルームへ（パーティーの人は、リーダーのルームに集まる）
class TavernScene {
    constructor(game) {
        this.game = game;
        this.active = false;      // 酒場に来ている間（クエスト選択・準備画面・協力プレイの戦いの間も）
        this.inScene = false;     // 酒場を歩いている（gameState 'tavern'）
        this.session = Math.random().toString(36).slice(2, 10);
        const q = new URLSearchParams(location.search).get('room');
        this.baseRoom = q && /^[A-Za-z0-9_-]{1,20}$/.test(q) ? q : '1';
        this.room = this.baseRoom;
        this.remotes = new Map();  // session → { p: Player, name, mark, buf, lastSeen, joinedAt }
        this.state = null;         // hk_mp_state の答え { pid, party, board }
        this.view = 'walk';        // 'walk' / 'dialog' / 'board' / 'wait' / 'leave'
        this.nav = null;
        this.fx = [];
        this.time = 0;
        this.ui = TavernScene.getUI();
        this.bindUI();
    }
    
    static getUI() {
        const $ = (id) => document.getElementById(id);
        return {
            root: $('tavern-ui'), room: $('tv-room'), online: $('tv-online'), exit: $('tv-exit'),
            party: $('tv-party'), partyTitle: $('tvp-title'), partySub: $('tvp-sub'), partyList: $('tvp-list'),
            partyClose: $('tvp-close'), partyLeave: $('tvp-leave'),
            act: $('tv-act'), dialog: $('tv-dialog'), dText: $('tvd-text'), dChoices: $('tvd-choices'),
            board: $('tv-board'), bList: $('tvb-list'), bClose: $('tvb-close'),
            wait: $('tv-wait'), wTitle: $('tvw-title'), wText: $('tvw-text'), wClose: $('tvw-close'), wCancel: $('tvw-cancel'),
            confirm: $('tv-confirm'), cYes: $('tvc-yes'), cNo: $('tvc-no'), toast: $('tv-toast'),
            run: $('tv-run'), chatBtn: $('tv-chat-btn'), chatLog: $('tv-chatlog'), chatForm: $('tvm-form'), chatInput: $('tvm-input'),
            chatSend: $('tvm-send'), chatClose: $('tvm-close')
        };
    }
    
    bindUI() {
        const u = this.ui;
        const on = (el, fn) => { if (el) el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (!this.game.screens.busy) { if (window.pressEffect) pressEffect(el); fn(el); } }); };
        on(u.act, () => this.interact());
        on(u.exit, () => this.openView('leave'));
        on(u.bClose, () => this.openView('walk'));
        on(u.cNo, () => this.openView('walk'));
        on(u.cYes, () => this.exit('battle_select'));
        on(u.wCancel, () => this.enterDoor(false));
        on(u.wClose, () => this.setClosed(true));
        on(u.partyClose, () => { const p = this.party; if (p) this.setClosed(!p.closed); });
        on(u.partyLeave, (el) => this.confirmLeaveParty(el));
        // 走る（押すたびに 走る ⇔ 歩く。PC は Shift を押している間も走る）
        on(u.run, () => this.setRunning(!this.running));
        // チャット
        on(u.chatBtn, () => this.openChat(!this.chatOpen));
        on(u.chatClose, () => this.openChat(false));
        if (u.chatForm) u.chatForm.addEventListener('submit', (e) => { e.preventDefault(); this.sendChat(); });
        if (u.chatInput) u.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); this.openChat(false); }
            e.stopPropagation();
        });
    }
    
    // ---------- 走る ----------
    setRunning(v) {
        this.running = !!v;
        try { localStorage.setItem('hoshinoko.tavern.run', this.running ? '1' : '0'); } catch (e) { /* 保存できない端末 */ }
        const b = this.ui.run;
        if (b) {
            // 丸いボタン（走るシルエット）：光っている時は走る、暗い時は歩く
            b.classList.toggle('on', this.running);
            b.setAttribute('aria-pressed', this.running ? 'true' : 'false');
            b.setAttribute('aria-label', `走る・歩くの切りかえ（今は${this.running ? '走る' : '歩く'}）`);
        }
    }
    
    // ---------- チャット（同じルームの人みんなに見える。Realtime の 'chat'。データベースには残さない） ----------
    openChat(v) {
        const u = this.ui;
        this.chatOpen = !!v && this.inScene;
        if (u.chatForm) u.chatForm.hidden = !this.chatOpen;
        if (u.chatBtn) u.chatBtn.classList.toggle('on', this.chatOpen);
        document.body.dataset.tvchat = this.chatOpen ? '1' : '';
        if (this.chatOpen) {
            if (u.chatInput) setTimeout(() => u.chatInput.focus(), 0);
        } else if (u.chatInput) {
            u.chatInput.blur();
        }
        this.renderChat();
        if (this.game.input) this.game.input.resetAll();
    }
    
    // 送れる文字にする：前後の空白・改行・制御文字を消して、TavernScene.CHAT_MAX 文字まで
    static cleanChat(s) {
        const t = String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
        return Array.from(t).slice(0, TavernScene.CHAT_MAX).join('');
    }
    
    sendChat() {
        const u = this.ui;
        const text = TavernScene.cleanChat(u.chatInput && u.chatInput.value);
        if (!text) { this.openChat(false); return; }
        const now = performance.now();
        if (now - (this._chatAt || 0) < TavernScene.CHAT_GAP_MS) { this.toast('少し待ってから送ってください'); return; }
        if (!this.lobby || !this.lobby.joined) { this.toast('つながっていないので送れません'); return; }
        this._chatAt = now;
        this.lobby.send('chat', { s: this.session, n: Account.playerName, t: text });
        this.addChat(Account.playerName, text, true);
        this.myBubble = { text, until: now + TavernScene.BUBBLE_MS };
        u.chatInput.value = '';
        playSE('ui_select');
        // スマホ：1回送ったら閉じる（キーボードで画面が隠れたままにならないように）。PC は続けて打てる
        if (document.body.classList.contains('touch')) this.openChat(false);
    }
    
    onChat(m) {
        if (!m || m.s === this.session) return;
        const text = TavernScene.cleanChat(m.t);
        if (!text) return;
        // 1人が短い間にたくさん送ってきた分は出さない（5秒に5回まで）
        const now = performance.now();
        const w = (this._chatIn = this._chatIn || new Map()).get(m.s) || [];
        const recent = w.filter(t => now - t < 5000);
        if (recent.length >= 5) return;
        recent.push(now);
        this._chatIn.set(m.s, recent);
        const r = this.remotes.get(m.s);
        const name = String((r && r.name) || m.n || '？').slice(0, 12);
        if (r) r.bubble = { text, until: now + TavernScene.BUBBLE_MS };
        this.addChat(name, text, false);
        if (!this.chatOpen) playSE('ui_cursor');
    }
    
    addChat(name, text, me) {
        this.chatLines = this.chatLines || [];
        this.chatLines.push({ name, text, me, at: performance.now() });
        if (this.chatLines.length > TavernScene.CHAT_KEEP) this.chatLines.shift();
        this.renderChat();
    }
    
    // チャットの一覧：開いている時は全部、閉じている時は新しい物だけ少しの間
    renderChat() {
        const el = this.ui.chatLog;
        if (!el) return;
        const now = performance.now();
        const list = (this.chatLines || []).filter(l => this.chatOpen || now - l.at < TavernScene.CHAT_SHOW_MS).slice(this.chatOpen ? -TavernScene.CHAT_KEEP : -5);
        const key = list.map(l => l.at).join(',') + (this.chatOpen ? 'o' : '');
        if (key === this._chatKey) return;
        this._chatKey = key;
        el.innerHTML = '';
        for (const l of list) {
            const row = document.createElement('div');
            row.className = 'tvm-line' + (l.me ? ' me' : '');
            const b = document.createElement('b');
            b.textContent = l.name;
            const s = document.createElement('span');
            s.textContent = l.text;
            row.append(b, s);
            el.appendChild(row);
        }
        el.classList.toggle('open', this.chatOpen);
        el.hidden = !list.length;
        el.scrollTop = el.scrollHeight;
    }
    
    get party() { return this.state && this.state.party; }
    get me() { const p = this.party; return p ? p.members.find(m => m.me) : null; }
    get pid() { return this.state ? this.state.pid : null; }
    
    // ---------- 入る・出る ----------
    // バトルモードの「マルチプレイ」から（screens.js の transition の中で呼ぶ）
    enter() {
        const game = this.game;
        game.stopBattles();
        this.active = true;
        this.map = new TavernMap(createTavernMapData());
        const sp = this.map.randomSpawn();
        this.player = new Player(sp.x, sp.y, Account.gender);
        document.body.dataset.hero = Account.gender;   // 走るボタンのシルエットを主人公に合わせる
        this.player.map = this.map;
        this.player.direction = 'up';
        this.player.setMoveMode('walk');
        this.player.baseSpeed = TavernScene.WALK_SPEED;
        this.camera = new Camera(0, 0, game.canvas.width, game.canvas.height);
        this.camera.follow(this.player);
        this.camera.setBounds(TV_W, TV_H);
        this.camera.snapToTarget();
        this.remotes.clear();
        this.state = null;
        this.pollT = 0;
        this.chatLines = [];
        this.myBubble = null;
        let run = true;
        try { run = localStorage.getItem('hoshinoko.tavern.run') !== '0'; } catch (e) { /* 保存できない端末 */ }
        this.setRunning(run);
        this.fx = [{ kind: 'spawn', x: sp.x, y: sp.y, t: 0, life: 1.4 }];
        playSE('battle_start');
        this.showScene();
        this.joinLobby();
        this.poll(true);
    }
    
    // 酒場を歩く画面にする（クエスト選択・準備画面・戦いから戻った時も）
    showScene() {
        const game = this.game;
        game.screens.hideAll();
        game.screens.mp = null;
        game.screens.equipReturn = null;
        this.inScene = true;
        game.gameState = 'tavern';
        document.body.dataset.mode = 'tavern';
        this.ui.root.classList.add('show');
        this.openView(this.me && this.me.entered ? 'wait' : 'walk');
        this.refreshUI();
        playBGM('bgm_tavern');
        game.input.resetAll();
    }
    
    hideScene() {
        if (this.chatOpen) this.openChat(false);
        this.inScene = false;
        this.ui.root.classList.remove('show');
        this.nav = null;
        document.body.dataset.tvview = '';
    }
    
    // 酒場を出る（パーティーからも抜ける）
    exit(to = 'battle_select') {
        this.game.screens.transition(() => this.exitNow(to));
    }
    
    // 画面の切り替えの中から（フェードの途中で）
    exitNow(to) {
        if (this.party) { this.nudge(); Net.rpc('hk_mp_leave').catch(() => {}); }
        this.leaveLobby();
        this.active = false;
        this.hideScene();
        this.state = null;
        document.body.dataset.mode = '';
        if (this.game.coop) { this.game.coop.stop(); this.game.coop = null; }
        if (this.game.pvp) { this.game.pvp.stop(); this.game.pvp = null; }
        this.leaveWatchCh();   // 戦いの「終わった」の知らせを送った後で
        this.game.screens.mp = null;
        this.game.screens.equipReturn = null;
        this.game.screens.setScreen(to);
    }
    
    // ---------- 酒場のチャンネル ----------
    joinLobby() {
        this.leaveLobby();
        const topic = `hoshinoko-tavern-${this.room}`;
        this.lobby = Net.join(topic, this.session, { s: this.session, n: Account.playerName }, {
            p: (m) => this.onRemoteState(m),
            hi: (m) => { if (m.s !== this.session) this.sendState(true); },
            nudge: (m) => { if (this.party && m.p === this.party.id) this.pollSoon(); },
            chat: (m) => this.onChat(m),
            presence: (list) => this.onPresence(list),
            status: (s) => {
                if (s === 'SUBSCRIBED') { this.lobby.send('hi', { s: this.session }); this.sendState(true); }
                this.refreshUI();
            }
        });
        this.sendT = 0;
        this.lastSent = null;
        this.ensureWatchCh();
    }
    
    leaveLobby() {
        if (this.lobby) this.lobby.leave();
        this.lobby = null;
        this.remotes.clear();
        this.presentKeys = null;
    }
    
    // 観戦のチャンネル hoshinoko-watch-<ルーム>：今このルームで戦っているパーティーの知らせ（watch.js の WatchBeacon）
    // 酒場にいる間は、戦い・観戦の間もつないだまま（戦っているホストも、このチャンネルで知らせる。
    // 同じ名前のチャンネルを2つ作ると supabase-js が同じ物を返すので、1つだけにしておく）
    ensureWatchCh() {
        if (this.watchCh && this.watchRoom === this.room) return this.watchCh;
        this.leaveWatchCh();
        this.watchRoom = this.room;
        this.liveBattles = new Map();
        this.watchCh = Net.join(`hoshinoko-watch-${this.room}`, `l-${this.session}`, null, {
            b: (m) => this.onBeacon(m),
            x: (m) => { if (m && typeof m.p === 'string' && this.liveBattles) this.liveBattles.delete(m.p); }
        });
        return this.watchCh;
    }
    
    leaveWatchCh() {
        if (this.watchCh) this.watchCh.leave();
        this.watchCh = null;
        this.watchRoom = null;
        if (this.liveBattles) this.liveBattles.clear();
    }
    
    // ---------- 観戦 ----------
    onBeacon(m) {
        const info = window.WatchInfo ? WatchInfo.parse(m) : null;
        if (!info) return;
        // 自分のパーティーの戦いは出さない
        if (this.party && this.party.id === info.p) return;
        if (this.liveBattles.size >= 20 && !this.liveBattles.has(info.p)) return;
        this.liveBattles.set(info.p, { info, at: performance.now() });
    }
    
    // 観戦できる戦い（kind：'coop' / 'pvp'）。しばらく知らせが来ない物は消す
    watchList(kind) {
        const now = performance.now();
        const out = [];
        if (!this.liveBattles) return out;
        for (const [id, x] of this.liveBattles) {
            if (now - x.at > WatchInfo.LIFE_MS) { this.liveBattles.delete(id); continue; }
            if (x.info.k === kind) out.push(x.info);
        }
        return out;
    }
    
    // 扉を調べた：今の戦いの一覧（選ぶと観戦）
    openWatchList(kind) {
        const list = this.watchList(kind);
        const u = this.ui;
        this.openView('dialog');
        u.dText.textContent = list.length
            ? `今、${kind === 'pvp' ? '対戦' : '戦い'}をしているパーティーがあります。\n観戦しますか？（見るだけです。報酬はありません）`
            : '今は、だれも戦っていないようだ。';
        u.dChoices.innerHTML = '';
        const add = (label, fn, cls = '') => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ui-btn tvd-choice ' + cls;
            b.dataset.nav = '';
            b.textContent = label;
            b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (window.pressEffect) pressEffect(b); fn(); });
            u.dChoices.appendChild(b);
        };
        for (const info of list.slice(0, 4)) add(`観戦する：${info.title}`, () => this.startWatch(info));
        add('やめる', () => this.openView('walk'), 'back');
        this.nav = new UINav(u.dialog, 'vertical');
    }
    
    startWatch(info) {
        const game = this.game;
        if (this.party) { this.openView('walk'); this.toast('パーティーに入っている間は観戦できません'); return; }
        if (game.coop || game.pvp || this._pvpStarting || game.screens.busy) return;   // 画面の切りかえの途中は待つ
        // まだ戦っているか（知らせが古くなっていないか）
        if (!this.watchList(info.k).some(x => x.p === info.p)) { this.openView('walk'); this.toast('その戦いは終わったようです'); return; }
        const screens = game.screens;
        game.loadout = Account.normalizeLoadout(Account.loadout);
        game.playerName = Account.playerName;
        this._watchKind = info.k;
        this.openView('walk');
        this.hideScene();
        this.leaveLobby();
        playSE('ui_select');
        screens.equipReturn = null;
        if (info.k === 'pvp') {
            const w = new PvpWatch(game, this, info);
            this._pvpStarting = true;
            screens.transition(() => { this._pvpStarting = false; screens.hideAll(); w.begin(); });
        } else {
            // 協力プレイ：ホスト以外の人（ミラー）と同じしくみで、見るだけ
            const party = {
                id: info.p, kind: 'coop', members: info.members,
                battle: { id: info.b, boss: info.boss, host: info.h, host_is_me: false, members: info.members.map(m => m.pid), hp_mult: 0 }
            };
            game.coop = new CoopBattle(game, this, party, this.pid || `w${this.session}`, { spectator: true });
            screens.transition(() => { screens.hideAll(); game.coop.begin(); });
        }
    }
    
    switchRoom(room) {
        if (!room || room === this.room) return;
        this.room = room;
        if (this.lobby) this.joinLobby();
        this.refreshUI();
    }
    
    onPresence(list) {
        const here = new Set(list.map(x => x.key));
        // 前の一覧にいて、今の一覧から消えた人だけ「出て行った」（一覧が途中までしか届いていない時に、消さないように）
        const before = this.presentKeys || new Set();
        for (const [s, r] of this.remotes) if (before.has(s) && !here.has(s)) r.leftAt = r.leftAt || performance.now();
        this.presentKeys = here;
        // ルームがいっぱい：パーティーに入っていなければ、次のルームへ
        if (list.length > TavernScene.ROOM_CAP && !this.party && !this._roomChecked) {
            this._roomChecked = true;
            const n = /^\d+$/.test(this.room) ? Number(this.room) + 1 : null;
            if (n && n <= 9) { this.toast(`ルーム${this.room}がいっぱいなので、ルーム${n}に移りました`); this.switchRoom(String(n)); }
        }
        this.onlineCount = list.length;
        this.refreshTop();
    }
    
    // 自分の今の様子を送る（動いている間は 1秒に4回まで、止まっている時は 2.5秒に1回）
    sendState(force = false) {
        if (!this.lobby || !this.player) return;
        const p = this.player;
        const mk = this.markCode();
        const st = { s: this.session, x: Math.round(p.position.x), y: Math.round(p.position.y), d: p.direction[0], m: p.isMoving ? 1 : 0,
            r: p.isDashing ? 1 : 0, t: Math.round(performance.now()), n: Account.playerName, g: Account.gender, k: mk };
        const L = this.lastSent;
        const changed = !L || L.x !== st.x || L.y !== st.y || L.d !== st.d || L.m !== st.m || L.r !== st.r || JSON.stringify(L.k) !== JSON.stringify(mk);
        const now = performance.now();
        const gap = now - (this.sentAt || 0);
        if (!force && !(changed && gap >= TavernScene.SEND_MS) && gap < TavernScene.IDLE_MS) return;
        if (force && gap < 120) return;
        this.sentAt = now;
        this.lastSent = st;
        this.lobby.send('p', st);
    }
    
    // 頭の上の印（ほかの人へ送る形）。パーティーに入っていなければ 0
    markCode() {
        const p = this.party, m = this.me;
        if (!p || !m) return 0;
        return { p: p.id, r: m.leader ? 'L' : 'M', e: m.entered ? 1 : 0, y: m.ready ? 1 : 0, q: p.kind === 'pvp' ? 'v' : 'c',
            o: m.leader && p.status === 'open' && !p.closed && p.count < p.cap ? 1 : 0 };
    }
    
    onRemoteState(m) {
        if (!m || m.s === this.session || typeof m.x !== 'number') return;
        const now = performance.now();
        let r = this.remotes.get(m.s);
        if (!r) {
            const p = new Player(m.x, m.y, m.g === 'female' ? 'female' : 'male');
            p.drawSize = this.player ? this.player.drawSize : p.drawSize;
            r = { p, buf: [], off: Infinity, joinedAt: now };
            this.remotes.set(m.s, r);
            this.fx.push({ kind: 'spawn', x: m.x, y: m.y, t: 0, life: 1.0 });
        }
        r.name = String(m.n || '').slice(0, 12);
        r.mark = m.k || null;
        r.lastSeen = now;
        r.leftAt = 0;
        if (r.p.gender !== m.g && (m.g === 'male' || m.g === 'female')) r.p.gender = m.g;
        // 送った人の時計と、こちらの時計の差（いちばん小さい物＝遅れのいちばん少ない時）
        r.off = Math.min(r.off, now - m.t);
        r.buf.push({ t: m.t, x: m.x, y: m.y, d: m.d, m: m.m, r: m.r ? 1 : 0 });
        if (r.buf.length > 20) r.buf.shift();
    }
    
    // ほかの人の位置：少し前（INTERP_MS）の位置を、受け取った2つの間でなめらかにつなぐ
    updateRemotes(dt) {
        const now = performance.now();
        const dirs = { u: 'up', d: 'down', l: 'left', r: 'right' };
        for (const [s, r] of this.remotes) {
            if ((r.leftAt && now - r.leftAt > 2500 && r.lastSeen < r.leftAt) || now - r.lastSeen > 9000) { this.remotes.delete(s); continue; }
            const rt = now - r.off - TavernScene.INTERP_MS;
            const b = r.buf;
            let a = b[0], c = b[b.length - 1];
            for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
            let x = c.x, y = c.y, cur = c;
            if (rt < c.t && c.t > a.t) {
                const k = Math.max(0, Math.min(1, (rt - a.t) / (c.t - a.t)));
                x = a.x + (c.x - a.x) * k; y = a.y + (c.y - a.y) * k;
                cur = k < 0.5 ? a : c;
            }
            const p = r.p;
            const moved = Math.hypot(x - p.position.x, y - p.position.y);
            p.position = new Vector2(x, y);
            p.direction = dirs[cur.d] || 'down';
            p.isMoving = !!cur.m || moved > 0.5;
            // 走っている：ダッシュの絵（4コマ）
            p.isDashing = p.isMoving && !!(cur.r || c.r);
            if (p.isDashing) {
                p.dashFrameTimer += dt;
                if (p.dashFrameTimer >= p.dashFrameSpeed) { p.dashFrameTimer = 0; p.dashFrame = (p.dashFrame + 1) % p.actionFrameCount; }
            } else { p.dashFrame = 0; p.dashFrameTimer = 0; }
            if (p.isMoving) {
                p.animationTimer += dt;
                if (p.animationTimer >= p.animationSpeed * (p.isDashing ? 0.55 : 1)) { p.animationTimer = 0; p.animationFrame = (p.animationFrame + 1) % 3; }
            } else p.animationFrame = 1;
        }
    }
    
    // ---------- パーティー（データベース） ----------
    async poll(board = false) {
        if (!this.active || this._polling) return;
        this._polling = true;
        try {
            const r = await Net.rpc('hk_mp_state', { p_board: board || this.view === 'board' });
            this.applyState(r);
            this.serverOk = true;
        } catch (e) {
            this.serverOk = false;
            if (e.code === 'NOT_SETUP' && !this._warnedSetup) {
                this._warnedSetup = true;
                this.toast('サーバーの準備がまだです（online/supabase_setup.sql をもう一度 Run してください）', 6);
            } else if (e.code === 'SESSION') {
                this.toast(Account.message('SESSION'), 4);
            }
        } finally {
            this._polling = false;
            this.pollT = 0;
        }
    }
    
    pollSoon() { this.pollT = Math.max(this.pollT, this.pollInterval() - 0.25); }
    
    pollInterval() {
        if (this.game.coop || this.game.pvp || this._pvpStarting) return 5;
        if (this.game.screens.current === 'mp_prep') return 1;
        return 2;
    }
    
    // パーティーを変える関数を呼んで、答えの様子を使う。ほかの人にも知らせる（nudge）
    async act(fn, args = {}) {
        try {
            const r = await Net.rpc(fn, args);
            this.applyState(r);
            this.nudge();
            return r;
        } catch (e) {
            playSE('ui_error');
            this.toast(TavernScene.errorText(e.code));
            return null;
        }
    }
    
    nudge() {
        const id = (this.party && this.party.id) || this._lastPartyId;
        if (this.lobby && id) this.lobby.send('nudge', { p: id });
    }
    
    applyState(r) {
        if (!r || !r.ok) return;
        const old = this.state && this.state.party;
        if (!r.board && this.state && this.state.board) r.board = this.state.board;
        this.state = r;
        const p = r.party;
        if (p) this._lastPartyId = p.id;
        this.diffParty(old, p);
        // パーティーの人は、リーダーのルームに集まる
        if (p && p.room && p.room !== this.room && this.inScene) this.switchRoom(p.room);
        const screens = this.game.screens;
        // 全員が扉に入った：準備画面へ
        const fighting = !!(this.game.coop || this.game.pvp || this._pvpStarting);
        if (p && p.status === 'prep' && !fighting && screens.current !== 'mp_prep' && screens.current !== 'equip' && !screens.busy) {
            this.openPrep();
        }
        // 準備画面のまま、だれかが戻った：酒場へ
        if ((!p || p.status === 'open') && (screens.current === 'mp_prep' || (screens.current === 'equip' && screens.equipReturn === 'mp_prep')) && !screens.busy) {
            const msg = p ? 'パーティーの人が準備画面から戻りました' : 'パーティーがなくなりました';
            screens.equipReturn = null;
            screens.transition(() => { this.showScene(); this.toast(msg); });
        }
        // リーダーがバトル開始：みんなで戦いへ
        if (p && p.status === 'battle' && p.battle && !fighting && p.battle.members.includes(r.pid) && !screens.busy) {
            if (p.kind === 'pvp') this.startPvp(p);
            else this.startCoop(p);
        }
        if (screens.current === 'mp_prep') screens.refreshMpPrep();
        this.refreshUI();
        this.sendState(true);
    }
    
    // パーティーの人が増えた・減った・リーダーが変わった：知らせる
    diffParty(a, b) {
        if (!a && b && !b.leader_is_me) this.toast(`パーティーに参加しました（リーダー：${(b.members.find(m => m.leader) || {}).name || ''}）`);
        if (a && !b) { this.toast('パーティーから抜けました'); return; }
        if (!a || !b || a.id !== b.id) return;
        const names = (p) => new Set(p.members.map(m => m.pid));
        const A = names(a), B = names(b);
        for (const m of b.members) if (!A.has(m.pid)) this.toast(`${m.name || 'だれか'}がパーティーに参加しました`);
        for (const m of a.members) if (!B.has(m.pid)) this.toast(`${m.name || 'だれか'}がパーティーを抜けました`);
        if (a.leader !== b.leader) {
            const L = b.members.find(m => m.leader);
            this.toast(L && L.me ? 'あなたが新しいリーダーになりました' : `${L ? L.name : ''}が新しいリーダーになりました`);
        }
    }
    
    // ---------- 操作 ----------
    // マスターに話しかける
    talk() {
        this.openView('dialog');
        this.masterMix = 0; // カクテルを作るしぐさ
        const lines = ['ようこそ、星の酒場へ。', '今日はどんな冒険をお探しかな？'];
        this.dialogLines = lines;
        this.dialogStep = 0;
        this.showDialog();
    }
    
    showDialog() {
        const u = this.ui;
        const step = this.dialogStep;
        u.dText.textContent = this.dialogLines.slice(0, step + 1).join('\n');
        u.dChoices.innerHTML = '';
        const add = (label, fn, cls = '') => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ui-btn tvd-choice ' + cls;
            b.dataset.nav = '';
            b.textContent = label;
            b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (window.pressEffect) pressEffect(b); fn(); });
            u.dChoices.appendChild(b);
        };
        if (step < this.dialogLines.length - 1) {
            add('▼ 次へ', () => { this.dialogStep++; this.showDialog(); });
        } else if (this.dialogKind === 'info') {
            add('わかった', () => this.openView('walk'), 'back');
        } else {
            add('協力プレイ', () => this.chooseCoop());
            add('PvP', () => this.choosePvp());
            add('やめる', () => this.openView('walk'), 'back');
        }
        this.dialogKind = null;
        this.nav = new UINav(u.dialog, 'vertical');
    }
    
    // マスターのひとこと（選ぶ物がない時）
    masterSay(lines) {
        this.openView('dialog');
        this.dialogLines = lines;
        this.dialogStep = lines.length - 1;
        this.dialogKind = 'info';
        this.showDialog();
    }
    
    chooseCoop() {
        if (this.party) {
            this.masterSay([this.party.kind === 'coop' ? 'もうクエストを受けているね。' : 'もう対戦の募集をしているね。',
                'パーティーを抜けると、新しいクエストを受けられるよ。']);
            return;
        }
        // モンスター選択（ソロプレイと同じ画面。後ろは酒場のまま）
        const screens = this.game.screens;
        screens.mp = { kind: 'coop' };
        screens.transition(() => { this.hideScene(); screens.setScreen('monster_select'); });
    }
    
    // モンスター選択でボスを選んだ（screens.js の chooseMonster）
    async acceptQuest(bossId) {
        const r = await this.act('hk_mp_create', { p_kind: 'coop', p_boss: bossId, p_room: this.room });
        const screens = this.game.screens;
        if (!r) return;
        const b = getBossData(bossId);
        screens.transition(() => {
            this.showScene();
            this.toast(`クエストを受注しました：${b ? b.name : ''}討伐（協力プレイの扉が開きました）`, 4);
        });
        playSE('coin_get');
    }
    
    // モンスター選択から戻る（クエストを受けない）
    cancelQuestSelect() {
        this.game.screens.transition(() => this.showScene());
    }
    
    async choosePvp() {
        if (this.party) { this.chooseCoop(); return; }
        const r = await this.act('hk_mp_create', { p_kind: 'pvp', p_room: this.room });
        if (!r) return;
        this.masterSay(['対戦相手の募集を出しておいたよ。', 'PvP の扉が開いた。相手が来たら、2人で扉に入りなさい。']);
        playSE('coin_get');
    }
    
    async joinParty(id) {
        const r = await this.act('hk_mp_join', { p_party: id });
        if (r && r.party) {
            playSE('coin_get');
            this.openView('walk');
            this.toast(`${TavernScene.questName(r.party)}に参加しました。扉が開きました`, 4);
        }
    }
    
    async enterDoor(on) {
        if (on) {
            const d = this.doorFor(this.party);
            if (d) {
                // 扉の前で待つ所：パーティーに入った順に少しずつずらす（みんなが同じ所に重ならないように）
                const i = Math.max(0, this.party.members.findIndex(m => m.me));
                const [ox, oy] = TavernScene.DOOR_SPOTS[i % TavernScene.DOOR_SPOTS.length];
                this.player.position = this.map.findFreeSpot(d.interact.add(new Vector2(ox, oy)), this.player.getFootBox(), 120);
                this.player.direction = 'up';
            }
        }
        const r = await this.act('hk_mp_enter', { p_entered: !!on });
        if (r) {
            playSE(on ? 'ui_select' : 'ui_cancel');
            this.openView(on && this.me && this.me.entered ? 'wait' : 'walk');
        }
    }
    
    setClosed(v) {
        return this.act('hk_mp_close', { p_closed: !!v }).then((r) => { if (r) this.toast(v ? '募集を締め切りました' : 'もう一度、募集を始めました'); });
    }
    
    kick(pid) { return this.act('hk_mp_kick', { p_pid: pid }); }
    
    confirmLeaveParty(btn) {
        if (!btn.classList.contains('confirm')) {
            btn.classList.add('confirm');
            btn.textContent = 'もう一度押すと抜ける';
            clearTimeout(this._leaveTimer);
            this._leaveTimer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = 'パーティーを抜ける'; }, 3000);
            return;
        }
        clearTimeout(this._leaveTimer);
        btn.classList.remove('confirm');
        btn.textContent = 'パーティーを抜ける';
        this.act('hk_mp_leave').then(() => this.openView('walk'));
    }
    
    // ---------- 準備画面 ----------
    openPrep() {
        const screens = this.game.screens;
        screens.equipReturn = null;
        screens.transition(() => { this.hideScene(); screens.setScreen('mp_prep'); });
        playSE('battle_start');
    }
    
    toggleReady() {
        const m = this.me;
        if (!m) return;
        const lo = Account.normalizeLoadout(Account.loadout);
        this.sentLoadout = JSON.stringify(lo);
        return this.act('hk_mp_ready', { p_ready: !m.ready, p_loadout: TavernScene.loadoutForServer(lo) });
    }
    
    // 装備画面から戻った：装備を変えていたら準備完了を解除して、新しい装備をみんなに見せる
    afterEquip() {
        const lo = Account.normalizeLoadout(Account.loadout);
        const s = JSON.stringify(lo);
        const m = this.me;
        const was = this.sentLoadout;
        if (m && s !== was) {
            this.sentLoadout = s;
            this.act('hk_mp_ready', { p_ready: false, p_loadout: TavernScene.loadoutForServer(lo) });
            if (m.ready) this.toast('装備を変えたので、準備完了を解除しました');
        }
    }
    
    async startBattle() {
        const p = this.party;
        if (!p || !p.leader_is_me) return;
        await this.act('hk_mp_start');
    }
    
    // PvP の準備画面：リーダーがフィールドを選ぶ（変えると2人とも準備完了をやり直す）
    async setField(field) {
        const p = this.party;
        if (!p || p.kind !== 'pvp') return;
        if (!p.leader_is_me) { playSE('ui_error'); this.toast('フィールドはリーダーが選びます'); return; }
        if (p.field === field) return;
        const r = await this.act('hk_mp_field', { p_field: field });
        if (r) playSE('ui_select');
    }
    
    // PvP の戦いへ（pvp_battle.js）
    startPvp(party) {
        const game = this.game;
        if (game.pvp || this._pvpStarting) return;
        const screens = game.screens;
        game.loadout = Account.normalizeLoadout(Account.loadout);
        game.playerName = Account.playerName;
        this.hideScene();
        this.leaveLobby();
        const pvp = new PvpBattle(game, this, party, this.pid);
        this._pvpStarting = true;
        screens.equipReturn = null;
        screens.transition(() => { this._pvpStarting = false; screens.hideAll(); pvp.begin(); });
    }
    
    // 準備画面の「戻る」：扉から出て、酒場へ戻る（パーティーのみんなも酒場へ）
    async backFromPrep() {
        await this.act('hk_mp_enter', { p_entered: false });
        this.game.screens.transition(() => this.showScene());
    }
    
    // ---------- 協力プレイの戦い ----------
    startCoop(party) {
        const game = this.game;
        if (game.coop) return;
        const screens = game.screens;
        game.loadout = Account.normalizeLoadout(Account.loadout);
        game.playerName = Account.playerName;
        this.hideScene();
        this.leaveLobby();
        game.coop = new CoopBattle(game, this, party, this.pid);
        screens.equipReturn = null;
        screens.transition(() => { screens.hideAll(); game.coop.begin(); });
    }
    
    // 戦いが終わって酒場へ（boss_battle.js の結果画面の「酒場に戻る」・通信が切れた時）
    returnFromBattle() {
        const game = this.game;
        if (game.coop) { game.coop.stop(); game.coop = null; }
        if (game.pvp) { game.pvp.stop(); game.pvp = null; }
        // 観戦の後は、観戦した扉の前に戻る
        const kind = this.party ? this.party.kind : (this._watchKind || 'coop');
        this._watchKind = null;
        this.player.position = this.map.findFreeSpot(this.doorFor({ kind }).interact.clone(), this.player.getFootBox(), 160);
        this.player.direction = 'down';
        this.camera.follow(this.player);
        this.camera.snapToTarget();
        this.joinLobby();
        this.showScene();
        this.poll(true);
        // サーバーが足した報酬を読みこむ
        if (Account.refresh) setTimeout(() => Account.refresh(true), 300);
    }
    
    // ---------- 毎フレーム ----------
    // 酒場に来ている間はずっと（クエスト選択・準備画面・戦いの間も）。パーティーの様子を読み直す・自分の様子を送る
    backgroundUpdate(dt) {
        if (!this.active) return;
        this.pollT += dt;
        if (this.pollT >= this.pollInterval()) { this.pollT = 0; this.poll(); }
        if (this.inScene || this.game.screens.current === 'mp_prep') this.sendState();
    }
    
    update(dt, input) {
        this.time += dt;
        this.map.update(dt);
        for (const f of this.fx) f.t += dt;
        this.fx = this.fx.filter(f => f.t < f.life);
        if (this.masterMix !== null && this.masterMix !== undefined) this.masterMix += dt;
        const busy = this.game.screens.busy;
        // 扉に入って待っている間・パネルを開いている間は歩けない
        const frozen = this.view !== 'walk' || (this.me && this.me.entered) || this.chatOpen;
        const zero = new Vector2(0, 0);
        // 走る：ボタンで切りかえ。PC は Shift を押している間、反対にする（歩く ⇔ 走る）
        const shift = input.isSprintPressed && input.isSprintPressed();
        this.player.setMoveMode((this.running !== !!shift) ? 'run' : 'walk');
        if (this.chatOpen || this._chatT === undefined || (this._chatT += dt) > 0.5) { this._chatT = 0; this.renderChat(); }
        this.player.update(dt, {
            getMovementVector: () => (frozen || busy ? zero : input.getMovementVector()),
            isDodgePressed: () => false, isKeyPressed: () => false, consumeMagicSelection: () => null
        });
        this.updateRemotes(dt);
        this.camera.update(dt);
        this.findFocus();
        this.refreshTop();
        if (busy) return;
        const esc = input.isKeyPressed('Escape') || input.isKeyPressed('Backspace');
        const ok = input.isKeyPressed('KeyE') || input.isKeyPressed('Enter') || input.isKeyPressed('Space');
        if (this.chatOpen) return;   // 文字を打っている間（入力欄のキーはゲームに届かない）
        if (input.isKeyPressed('KeyT') && this.view === 'walk') { this.openChat(true); return; }
        if (this.view === 'walk') {
            if (esc) { playSE('ui_cancel'); this.openView('leave'); return; }
            if (ok && this.focus) { this.interact(); return; }
        } else {
            if (esc) {
                playSE('ui_cancel');
                if (this.view === 'wait') this.enterDoor(false);
                else this.openView('walk');
                return;
            }
            if (this.nav) this.nav.handle(input);
        }
    }
    
    // 近くの調べられる物（マスター・掲示板・扉）
    findFocus() {
        const L = this.map.layers, p = this.player.position;
        const feet = new Vector2(p.x, p.y + this.player.drawSize * 0.36);
        let best = null, bd = Infinity;
        const check = (kind, ref, pt, r) => {
            const d = Math.hypot(feet.x - pt.x, feet.y - pt.y);
            if (d <= r && d < bd) { bd = d; best = { kind, ref }; }
        };
        check('master', L.master, L.master.interact, L.master.r);
        check('board', L.board, L.board.interact, L.board.r);
        for (const d of L.doors) check('door', d, d.interact, d.r);
        this.focus = this.view === 'walk' ? best : null;
        const act = this.ui.act;
        if (act) {
            act.hidden = !this.focus || !this.inScene;
            if (this.focus) {
                const t = this.actLabel(this.focus);
                if (act.textContent !== t) act.textContent = t;
            }
        }
    }
    
    actLabel(f) {
        if (f.kind === 'master') return '話す';
        if (f.kind === 'board') return '掲示板を見る';
        if (f.ref.kind === 'locked') return '調べる';
        if (this.doorOpenFor(f.ref)) return '扉に入る';
        if (!this.party && this.watchList(f.ref.kind).length) return '観戦する';
        return '調べる';
    }
    
    interact() {
        const f = this.focus;
        if (!f || this.view !== 'walk') return;
        playSE('ui_select');
        if (f.kind === 'master') { this.talk(); return; }
        if (f.kind === 'board') { this.openView('board'); this.poll(true); return; }
        const d = f.ref;
        if (d.kind === 'locked') { this.toast('かたく閉ざされている……。（今後、新しいモードが追加される予定です）'); return; }
        if (this.doorOpenFor(d)) { this.enterDoor(true); return; }
        const p = this.party;
        // ほかのパーティーがこの扉の先で戦っている：観戦できる（パーティーに入っていない時だけ）
        if (this.watchList(d.kind).length) {
            if (!p) { this.openWatchList(d.kind); return; }
            if (p.kind !== d.kind || p.status !== 'open') { this.toast('パーティーに入っている間は観戦できません'); return; }
        }
        if (!p) this.toast(d.kind === 'coop' ? 'クエストを受けると、この扉が開きます（マスターか掲示板へ）' : 'PvP の募集をすると、この扉が開きます（マスターか掲示板へ）');
        else if (p.kind !== d.kind) this.toast('この扉は、あなたのパーティーの扉ではありません');
        else this.toast('今は入れません');
    }
    
    doorFor(p) { return p ? this.map.layers.doors.find(d => d.kind === p.kind) : null; }
    doorOpenFor(d) { const p = this.party; return !!(p && p.kind === d.kind && p.status === 'open'); }
    
    // ---------- パネル ----------
    openView(v) {
        const u = this.ui;
        this.view = v;
        document.body.dataset.tvview = v; // style.css：歩いている時だけスマホのスティックを出す
        if (u.dialog) u.dialog.hidden = v !== 'dialog';
        if (u.board) u.board.hidden = v !== 'board';
        if (u.wait) u.wait.hidden = v !== 'wait';
        if (u.confirm) u.confirm.hidden = v !== 'leave';
        if (v !== 'dialog') this.masterMix = null;
        if (v === 'board') this.renderBoard();
        if (v === 'wait') this.renderWait();
        const panel = v === 'dialog' ? u.dialog : v === 'board' ? u.board : v === 'wait' ? u.wait : v === 'leave' ? u.confirm : null;
        this.nav = panel ? new UINav(panel, 'vertical') : null;
        if (this.game.input) this.game.input.resetAll();
    }
    
    refreshUI() {
        this.refreshTop();
        this.renderParty();
        if (this.view === 'board') this.renderBoard();
        if (this.view === 'wait') {
            if (!this.me || !this.me.entered) this.openView('walk');
            else this.renderWait();
        } else if (this.view === 'walk' && this.me && this.me.entered && this.inScene) {
            this.openView('wait');
        }
    }
    
    refreshTop() {
        const u = this.ui;
        const room = `星の酒場　ルーム${this.room}`;
        if (u.room && u.room.textContent !== room) u.room.textContent = room;
        if (u.online) {
            const ok = this.lobby && this.lobby.joined;
            // presence の一覧は遅れて届くことがあるので、位置が届いている人とあわせて数える
            const all = new Set([...(this.presentKeys || []), this.session]);
            for (const [s, r] of this.remotes) if (!r.leftAt) all.add(s);
            const t = ok ? `● ${all.size}人` : '○ つないでいます…';
            if (u.online.textContent !== t) u.online.textContent = t;
            u.online.classList.toggle('off', !ok);
        }
    }
    
    renderParty() {
        const u = this.ui, p = this.party;
        if (!u.party) return;
        u.party.hidden = !p;
        if (!p) return;
        u.partyTitle.textContent = TavernScene.questName(p);
        const st = p.status === 'prep' ? '準備中' : p.status === 'battle' ? '戦闘中' : p.closed ? '募集締切' : p.count >= p.cap ? '満員' : '募集中';
        u.partySub.textContent = `${p.count}/${p.cap}人　${st}`;
        u.partyList.innerHTML = '';
        for (const m of p.members) {
            const li = document.createElement('li');
            li.className = (m.leader ? 'leader' : 'member') + (m.me ? ' me' : '');
            li.style.setProperty('--hue', TavernScene.partyHue(p.id));
            const tags = (m.entered ? '<i class="tag in">入場</i>' : '') + (m.ready ? '<i class="tag ok">✔</i>' : '');
            li.innerHTML = `<span class="star"></span><b></b>${tags}`;
            li.querySelector('b').textContent = m.name || '（名前なし）';
            if (p.leader_is_me && !m.me && p.status === 'open') {
                const k = document.createElement('button');
                k.type = 'button';
                k.className = 'ui-btn tvp-kick';
                k.textContent = '外す';
                k.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.kick(m.pid); });
                li.appendChild(k);
            }
            u.partyList.appendChild(li);
        }
        if (u.partyClose) {
            u.partyClose.hidden = !p.leader_is_me || p.status !== 'open';
            u.partyClose.textContent = p.closed ? '募集を再開' : '募集を締め切る';
        }
    }
    
    renderBoard() {
        const u = this.ui;
        if (!u.bList) return;
        const list = (this.state && this.state.board) || [];
        u.bList.innerHTML = '';
        if (!list.length) {
            u.bList.innerHTML = '<p class="tvb-empty">今は募集がありません。マスターに話しかけて、クエストを受けてみよう</p>';
        }
        const myId = this.party && this.party.id;
        for (const q of list) {
            const b = q.kind === 'coop' ? getBossData(q.boss) : null;
            const row = document.createElement('div');
            row.className = 'tvb-row' + (q.id === myId ? ' mine' : '');
            const st = q.status === 'prep' ? '準備中' : q.status === 'battle' ? '戦闘中' : q.closed ? '締切' : q.count >= q.cap ? '満員' : '募集中';
            const open = q.status === 'open' && !q.closed && q.count < q.cap;
            const stars = b ? '★'.repeat(b.difficulty) + '☆'.repeat(Math.max(0, 3 - b.difficulty)) : '';
            row.innerHTML = `<div class="tvb-main"><b class="tvb-name"></b><span class="tvb-info"></span></div>
                <div class="tvb-side"><span class="tvb-count">${q.count}/${q.cap}</span><span class="tvb-st ${open ? 'open' : ''}">${st}</span></div>`;
            row.querySelector('.tvb-name').textContent = q.kind === 'coop' ? `${b ? b.name : q.boss}討伐` : 'PvP 対戦相手募集';
            row.querySelector('.tvb-info').textContent = q.kind === 'coop'
                ? `対象：${b ? b.name : ''}　難易度 ${stars}　リーダー：${q.leader_name || '？'}`
                : `1対1の対戦　リーダー：${q.leader_name || '？'}`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ui-btn tvb-join' + (open && !myId ? '' : ' disabled');
            btn.dataset.nav = '';
            btn.textContent = q.id === myId ? '参加中' : '参加する';
            if (!(open && !myId)) btn.setAttribute('aria-disabled', 'true');
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (q.id === myId) return;
                if (myId) { playSE('ui_error'); this.toast('もうパーティーに入っています'); return; }
                if (!open) { playSE('ui_error'); this.toast('この募集には今は参加できません'); return; }
                this.joinParty(q.id);
            });
            row.querySelector('.tvb-side').appendChild(btn);
            u.bList.appendChild(row);
        }
        // パネルの中身を作り直したので、キーボードで選べる項目も作り直す
        if (this.view === 'board') {
            const keep = this.nav ? this.nav.index : 0;
            this.nav = new UINav(u.board, 'vertical');
            if (keep < this.nav.items.length) this.nav.setIndex(keep);
        }
    }
    
    renderWait() {
        const u = this.ui, p = this.party;
        if (!p || !u.wait) return;
        u.wTitle.textContent = p.kind === 'pvp' ? 'PvP の扉の中で待っています' : '協力プレイの扉の中で待っています';
        const all = p.all_entered && p.count >= 2;
        let t = `扉に入った人：${p.entered}/${p.cap}${all ? '　全員入場済み' : ''}`;
        if (p.count < 2) t += '\n2人以上で出発できます。掲示板で仲間を待ちましょう';
        else if (!all) t += '\nほかのメンバーが入るのを待っています';
        else if (!p.closed && p.count < p.cap) t += p.leader_is_me ? '\n募集を締め切ると、準備画面へ進みます' : '\nリーダーが募集を締め切ると、準備画面へ進みます';
        u.wText.textContent = t;
        if (u.wClose) {
            const show = p.leader_is_me && !p.closed && p.count < p.cap && p.kind === 'coop';
            u.wClose.hidden = !show;
            u.wClose.toggleAttribute('data-nav', show);
        }
    }
    
    toast(text, sec = 2.6) {
        // 準備画面・装備・クエスト選択の間は、酒場の表示が隠れているので、画面の方の知らせに出す
        if (!this.inScene && this.game.screens.current) { this.game.screens.toast(text); return; }
        const t = this.ui.toast;
        if (!t) return;
        t.textContent = text;
        t.style.setProperty('--sec', sec + 's');
        t.classList.remove('show');
        void t.offsetWidth;
        t.classList.add('show');
    }
    
    // ---------- 描画 ----------
    draw(ctx) {
        if (!this.map) return;
        const cam = this.camera.position;
        this.map.draw(ctx, cam);
        this.drawDoors(ctx, cam);
        this.drawFx(ctx, cam, true);
        // 人と床の置き物（カウンター・テーブル・樽など）を、足元が奥の物から描く。マスターはカウンターの後ろ
        const people = [{ p: this.player, name: Account.playerName, mark: this.markCode(), me: true, chat: this.myBubble }];
        for (const [s, r] of this.remotes) people.push({ p: r.p, name: r.name, mark: r.mark, chat: r.bubble, session: s });
        const items = this.map.getDepthItems();
        const M = this.map.layers.master;
        items.push({ sortY: M.y - 1, draw: (c, cm) => this.drawMaster(c, cm) });
        for (const x of people) items.push({ sortY: x.p.position.y + x.p.drawSize * 0.36, draw: (c, cm) => x.p.draw(c, cm) });
        items.sort((a, b) => a.sortY - b.sortY);
        for (const it of items) it.draw(ctx, cam);
        for (const x of people) this.drawTag(ctx, cam, x);
        this.drawFx(ctx, cam, false);
        this.drawFocus(ctx, cam);
        if (window.showCollision) this.map.drawCollisionDebug(ctx, cam);
    }
    
    // 酒場を後ろに出したまま、画面（クエスト選択・準備画面・装備）を重ねる時
    drawFrozen(ctx, dim) {
        if (!this.map) return;
        this.draw(ctx);
        ctx.save();
        ctx.fillStyle = `rgba(6, 8, 24, ${dim})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
    }
    
    drawMaster(ctx, cam) {
        const M = this.map.layers.master;
        const A = window.assetManager;
        // 待機：1→2→3→2 をゆっくり。ときどき目を閉じる（8）・ウインク（4）。話している間はカクテルを作る（9〜16）
        let f;
        if (this.masterMix !== null && this.masterMix !== undefined && this.masterMix < 16 * 0.2) {
            f = 9 + Math.min(7, Math.floor(this.masterMix / 0.2));
        } else {
            const t = this.time;
            const blink = (t % 4.3) < 0.14, wink = (t % 23) > 22.6;
            f = wink ? 4 : blink ? 8 : [1, 2, 3, 2][Math.floor(t / 0.55) % 4];
        }
        const img = A && A.get(`tv_master_${f}`);
        if (!img) return;
        const s = TavernScene.MASTER_SCALE;
        const w = img.width * s, h = img.height * s;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, Math.round(M.x - w / 2 - cam.x), Math.round(M.y - h - cam.y), w, h);
        ctx.restore();
    }
    
    // 扉：自分のパーティーの扉だけ開いて光る。上に「入った人数/最大人数」
    drawDoors(ctx, cam) {
        const t = this.time, p = this.party;
        for (const d of this.map.layers.doors) {
            const open = this.doorOpenFor(d) || (p && p.kind === d.kind && p.status === 'prep');
            const x = d.x - cam.x, y0 = d.doorTop - cam.y, y1 = d.y - cam.y, w = d.w;
            if (open) {
                ctx.save();
                // 扉の中が光って、開いているのが分かる（扉の形の光と、足元へのびる光）
                const g = ctx.createLinearGradient(0, y0, 0, y1 + 40);
                g.addColorStop(0, 'rgba(255, 255, 255, 0.0)');
                g.addColorStop(0.35, d.kind === 'pvp' ? 'rgba(255, 170, 190, 0.55)' : 'rgba(170, 210, 255, 0.6)');
                g.addColorStop(1, 'rgba(255, 240, 210, 0.0)');
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.moveTo(x - w / 2, y1);
                ctx.lineTo(x - w / 2, y0 + w * 0.35);
                ctx.quadraticCurveTo(x, y0 - w * 0.25, x + w / 2, y0 + w * 0.35);
                ctx.lineTo(x + w / 2, y1);
                ctx.closePath();
                ctx.globalAlpha = 0.65 + 0.25 * Math.sin(t * 3);
                ctx.fill();
                // 光の粒が扉に吸いこまれる
                for (let i = 0; i < 8; i++) {
                    const k = (t * 0.45 + i / 8) % 1;
                    const px = x + Math.sin(i * 2.1 + t) * w * 0.4 * (1 - k);
                    const py = y1 + 70 - k * 110;
                    ctx.globalAlpha = (1 - k) * 0.9;
                    ctx.fillStyle = d.kind === 'pvp' ? '#ffd0dc' : '#d6ecff';
                    ctx.fillRect(Math.round(px) - 2, Math.round(py) - 2, 4, 4);
                }
                ctx.restore();
                // 入った人数（自分のパーティーの物だけ）。扉の前に立つとアーチの上は画面の外なので、画面の上の端より下に出す
                const all = p.all_entered && p.count >= 2;
                const py = Math.max(TavernScene.PLATE_MIN_Y, d.doorTop + 34 - cam.y);
                this.drawPlate(ctx, x, py, `${p.entered}/${p.cap}`, all ? '全員入場済み' : '', d.color);
            } else if (d.kind !== 'locked' && !p) {
                // ほかのパーティーが戦っている扉：「観戦できます」（パーティーに入っていない時だけ）
                const n = this.watchList(d.kind).length;
                if (n) this.drawWatchTag(ctx, x, Math.max(TavernScene.PLATE_MIN_Y, d.doorTop + 30 - cam.y), n, d.color);
            }
        }
    }
    
    drawWatchTag(ctx, x, y, n, color) {
        ctx.save();
        ctx.font = 'bold 15px "DotGothic16", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const text = n > 1 ? `👁 観戦できます（${n}）` : '👁 観戦できます';
        const w = ctx.measureText(text).width + 18, h = 24;
        const a = 0.75 + 0.25 * Math.sin(this.time * 3);
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(10, 8, 30, 0.88)';
        ctx.strokeStyle = color || '#ffd76a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, 6); else ctx.rect(x - w / 2, y - h / 2, w, h);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff6d8';
        ctx.fillText(text, x, y + 1);
        ctx.restore();
    }
    
    drawPlate(ctx, x, y, main, sub, color) {
        ctx.save();
        ctx.font = 'bold 30px "DotGothic16", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = Math.max(96, ctx.measureText(main).width + 34), h = 44;
        ctx.fillStyle = 'rgba(10, 8, 30, 0.88)';
        ctx.strokeStyle = color || '#ffd76a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, 8); else ctx.rect(x - w / 2, y - h / 2, w, h);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff6d8';
        ctx.fillText(main, x, y + 1);
        if (sub) {
            ctx.font = 'bold 18px "DotGothic16", sans-serif';
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#120a20';
            ctx.strokeText(sub, x, y + 36);
            ctx.fillStyle = '#9dffbe';
            ctx.fillText(sub, x, y + 36);
        }
        ctx.restore();
    }
    
    // 名前と頭の上の印
    drawTag(ctx, cam, x) {
        const p = x.p;
        const sx = Math.round(p.position.x - cam.x), sy = Math.round(p.position.y - cam.y - p.drawSize / 2 - 4);
        ctx.save();
        ctx.font = 'bold 17px "DotGothic16", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(10, 6, 20, 0.9)';
        ctx.strokeText(x.name || '', sx, sy);
        ctx.fillStyle = x.me ? '#ffe9a0' : '#ffffff';
        ctx.fillText(x.name || '', sx, sy);
        ctx.restore();
        const hasMark = !!this.markView(x.mark);
        this.drawMark(ctx, sx, sy - 44, x.mark);   // 名前の文字に重ならない高さ（六芒星の半径 22）
        // チャットの吹き出し（頭の上。印がある人は、印の上）
        const b = x.chat;
        if (b && performance.now() < b.until) this.drawBubble(ctx, sx, sy - (hasMark ? 74 : 26), b.text, (b.until - performance.now()) / 400);
    }
    
    drawBubble(ctx, x, y, text, fade) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, fade));
        ctx.font = '15px "DotGothic16", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 長い文は2行まで（1行 TavernScene.BUBBLE_LINE 文字）
        const chars = Array.from(text), L = TavernScene.BUBBLE_LINE;
        const lines = chars.length > L ? [chars.slice(0, L).join(''), chars.slice(L, L * 2).join('') + (chars.length > L * 2 ? '…' : '')] : [text];
        const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 20, h = lines.length * 19 + 10;
        const top = y - h - 8;
        ctx.fillStyle = 'rgba(255, 251, 238, 0.96)';
        ctx.strokeStyle = '#6a4a20';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - w / 2, top, w, h, 8); else ctx.rect(x - w / 2, top, w, h);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 7, top + h - 1); ctx.lineTo(x, top + h + 8); ctx.lineTo(x + 7, top + h - 1);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - 7, top + h); ctx.lineTo(x, top + h + 8); ctx.lineTo(x + 7, top + h);
        ctx.stroke();
        ctx.fillStyle = '#2a1a0a';
        lines.forEach((l, i) => ctx.fillText(l, x, top + 5 + 9.5 + i * 19));
        ctx.restore();
    }
    
    // 頭の上の印
    //   同じパーティー：リーダー＝金色の星 / メンバー＝青白い星。後ろにパーティーごとの色の六芒星（共通の模様）
    //                   扉に入った＝星のまわりの小さな輪 / 準備完了＝緑のチェック
    //   ほかのパーティー：募集しているリーダーの金色の星だけ（細かい様子は出さない）
    // 印の見え方：'full'（同じパーティー：全部）/ 'leader'（ほかのパーティーの、募集しているリーダーの星だけ）/ null（出さない）
    markView(mk) {
        if (!mk) return null;
        if (this.party && mk.p === this.party.id) return 'full';
        return mk.r === 'L' && mk.o ? 'leader' : null;
    }
    
    drawMark(ctx, x, y, mk) {
        const view = this.markView(mk);
        if (!view) return;
        const mine = view === 'full';
        const t = this.time;
        const bob = Math.sin(t * 3 + x * 0.01) * 3;
        y += bob;
        ctx.save();
        if (mine) {
            const hue = TavernScene.partyHue(mk.p);
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(t * 0.6);
            ctx.strokeStyle = `hsla(${hue}, 90%, 65%, 0.95)`;
            ctx.fillStyle = `hsla(${hue}, 90%, 55%, 0.3)`;
            ctx.lineWidth = 2.5;
            for (let k = 0; k < 2; k++) {
                ctx.beginPath();
                for (let i = 0; i < 3; i++) {
                    const a = -Math.PI / 2 + i * Math.PI * 2 / 3 + k * Math.PI / 3;   // 2つの三角を 60度ずらす（六芒星）
                    ctx.lineTo(Math.cos(a) * 22, Math.sin(a) * 22);
                }
                ctx.closePath();
                ctx.fill(); ctx.stroke();
            }
            ctx.restore();
        }
        const leader = mk.r === 'L';
        const col = leader ? '#ffd23f' : '#bfe8ff';
        ctx.shadowColor = leader ? 'rgba(255, 200, 60, 0.95)' : 'rgba(140, 210, 255, 0.95)';
        ctx.shadowBlur = 14;
        ctx.fillStyle = col;
        ctx.strokeStyle = leader ? '#7a4a00' : '#2a5a8a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const r = i % 2 ? 6.5 : 15;
            const a = -Math.PI / 2 + i * Math.PI / 5;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        if (mine && mk.e) {
            // 扉に入った：星のまわりを回る小さな輪
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.lineDashOffset = -t * 20;
            ctx.beginPath(); ctx.ellipse(x, y + 2, 26, 11, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }
        if (mine && mk.y) {
            // 準備完了：緑のチェック
            ctx.fillStyle = '#1e7a34';
            ctx.beginPath(); ctx.arc(x + 17, y + 10, 9, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#b8ffcb';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(x + 12, y + 10); ctx.lineTo(x + 16, y + 14); ctx.lineTo(x + 22, y + 6); ctx.stroke();
        }
        ctx.restore();
    }
    
    // 調べられる物の上の「！」と、操作の案内
    drawFocus(ctx, cam) {
        const f = this.focus;
        if (!f || this.view !== 'walk') return;
        let x, y;
        if (f.kind === 'master' || f.kind === 'board') { x = f.ref.x; y = f.ref.markY; }
        else { x = f.ref.x; y = f.ref.doorTop + 6; }
        const bob = Math.sin(this.time * 5) * 4;
        const sy = Math.max(TavernScene.PLATE_MIN_Y + 40, y - cam.y) + bob;   // 扉の前では画面の上の端より下に
        ctx.save();
        ctx.font = 'bold 34px "DotGothic16", sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#1a0e26';
        ctx.strokeText('！', x - cam.x, sy);
        ctx.fillStyle = '#ffe36a';
        ctx.fillText('！', x - cam.x, sy);
        ctx.restore();
    }
    
    // 魔法陣から出てくる時の光（ground：足元の輪 / それ以外：立ちのぼる光の粒）
    drawFx(ctx, cam, ground) {
        const A = window.assetManager;
        for (const f of this.fx) {
            const k = f.t / f.life;
            const x = f.x - cam.x, y = f.y - cam.y + 32;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            if (ground) {
                ctx.globalAlpha = 1 - k;
                ctx.strokeStyle = '#ffe9a0';
                ctx.lineWidth = 4;
                ctx.beginPath(); ctx.ellipse(x, y, 30 + 70 * k, (30 + 70 * k) * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
                ctx.strokeStyle = '#b9a2ff';
                ctx.beginPath(); ctx.ellipse(x, y, 16 + 50 * k, (16 + 50 * k) * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
            } else {
                const sp = A && A.get('tv_spark_gold');
                for (let i = 0; i < 7; i++) {
                    const a = i / 7 * Math.PI * 2 + f.x;
                    const px = x + Math.cos(a) * 34 * (0.6 + k), py = y - 10 - k * (90 + i * 8);
                    ctx.globalAlpha = (1 - k) * 0.9;
                    if (sp) ctx.drawImage(sp, px - 12, py - 14, 24, 28);
                    else { ctx.fillStyle = '#fff1b0'; ctx.fillRect(px - 2, py - 2, 4, 4); }
                }
                // 光の柱
                const g = ctx.createLinearGradient(0, y - 160, 0, y);
                g.addColorStop(0, 'rgba(255, 240, 200, 0)');
                g.addColorStop(1, `rgba(200, 180, 255, ${0.5 * (1 - k)})`);
                ctx.globalAlpha = 1;
                ctx.fillStyle = g;
                ctx.fillRect(x - 34, y - 160, 68, 160);
            }
            ctx.restore();
        }
    }
    
    // ---------- 小さな道具 ----------
    static questName(p) {
        if (!p) return '';
        if (p.kind === 'pvp') return 'PvP 対戦相手募集';
        const b = getBossData(p.boss);
        return `${b ? b.name : p.boss}討伐`;
    }
    
    static partyHue(id) {
        let h = 0;
        for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
        return h;
    }
    
    static loadoutForServer(lo) {
        return { magic: (lo.magic || []).slice(0, 5), sword: lo.sword || 'knife' };
    }
    
    static errorText(code) {
        const M = {
            IN_PARTY: 'もうパーティーに入っています（抜けると、新しく受注・参加できます）',
            FULL: 'このパーティーは満員です',
            CLOSED: 'この募集は締め切られました',
            GONE: 'この募集はもうありません',
            NOT_LEADER: 'リーダーだけができます',
            BUSY: '今はできません',
            NOT_READY: '全員が準備完了になるまで待ってください',
            NEED_TWO: '2人以上そろうと出発できます（PvP は2人）',
            // 前の版の SQL のサーバーだけが返す
            PVP_SOON: 'サーバーが PvP の対戦に対応していません（online/supabase_setup.sql をもう一度 Run してください）',
            BAD_FIELD: 'そのフィールドは選べません',
            NOT_PREP: '準備画面ではありません',
            NO_PARTY: 'パーティーに入っていません',
            BAD_BOSS: 'このボスはまだ選べません',
            NOT_SETUP: 'サーバーの準備がまだです（online/supabase_setup.sql をもう一度 Run してください）'
        };
        return M[code] || (window.Account ? Account.message(code) : 'エラーが起きました');
    }
}

TavernScene.WALK_SPEED = 165;      // 酒場を歩く速さ（px/秒）。走る時は Player.sprintMultiplier 倍
TavernScene.MASTER_SCALE = 0.36;   // マスターの絵の大きさ（顔の幅を主人公にそろえた。高さ 約 96px）
TavernScene.ROOM_CAP = 16;         // 1つのルームの人数（パーティーの人数とは別）
TavernScene.SEND_MS = 250;         // 動いている間、位置を送る間隔
TavernScene.IDLE_MS = 2500;        // 止まっている間も、この間隔で送る（あとから来た人にも見えるように）
TavernScene.INTERP_MS = 300;       // ほかの人は、この時間だけ前の位置をなめらかに出す
TavernScene.PLATE_MIN_Y = 54;      // 扉の上の人数の札：画面の上からこの px より下に出す
TavernScene.CHAT_MAX = 60;         // チャットの1回の文字数
TavernScene.CHAT_GAP_MS = 1200;    // 続けて送れる間隔
TavernScene.CHAT_KEEP = 30;        // 覚えておく数（開いた時に見える）
TavernScene.CHAT_SHOW_MS = 12000;  // 閉じている時、新しい物を出しておく時間
TavernScene.BUBBLE_MS = 6000;      // 頭の上の吹き出しを出す時間
TavernScene.BUBBLE_LINE = 15;      // 吹き出しの1行の文字数
TavernScene.DOOR_SPOTS = [[0, 0], [-58, 26], [58, 26], [0, 58]];  // 扉の前で待つ所（パーティーに入った順のずれ）

window.TavernScene = TavernScene;
