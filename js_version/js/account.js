// アカウント（ログイン）とセーブデータ
//
// - 起動したら、前にログインしたアカウントへ自動でログインする（Account.init）
// - オンライン（js/online_config.js に Supabase の url と key を書いた時）：
//     アカウントとセーブデータはサーバーに保存する。PC・スマホのどちらからでも同じアカウントでログインできる
//     サーバーには online/supabase_setup.sql の関数（hk_register・hk_login・hk_load・hk_save・hk_logout）だけを使う
// - オフライン（設定がない時）：この端末（ブラウザの localStorage）だけに保存する
// - パスワードはそのまま保存しない（サーバーは bcrypt、この端末は PBKDF2 でハッシュにする）
//
// セーブデータ（Account.data）
//   profile：{ name（プレイヤー名）, gender（'male' | 'female'）}。プレイヤー登録の画面で決めるまでは null
//   loadout：装備画面の設定 { magic: [魔法の id か null を5つ], sword, shield, head, body, legs }
//   battle ：バトルモードの記録（battle_records.js）{ coins, clears, records }
//   applied：もう当てた「できごと」の id（同じできごとを2回当てないように）
//
// 変更は「できごと」（{ t: 'profile' | 'loadout' | 'clear', ... }）にして、手元のデータに当ててからサーバーにも送る
// 送る時はサーバーの最新のデータを読み直してから当てるので、PC とスマホで交互に遊んでも記録が消えない
// 送れなかったできごと（電波がない時など）は、この端末に残しておき、次につながった時に送る

class AccountError extends Error {
    constructor(code, detail = '') {
        super(Account.message(code));
        this.code = code;
        this.detail = detail;
    }
}

const Account = {
    SESSION_KEY: 'hoshinoko.session.v1',      // 今ログインしているアカウント
    USERS_KEY: 'hoshinoko.accounts.v1',       // オフラインのアカウント（ユーザー名 → パスワードのハッシュ）
    SAVE_PREFIX: 'hoshinoko.save.v1.',        // セーブデータ（オンラインの時はサーバーのデータのコピー）
    PENDING_PREFIX: 'hoshinoko.pending.v1.',  // まだサーバーに送れていないできごと
    LAST_USER_KEY: 'hoshinoko.lastuser',      // 最後にログインしたユーザー名（ログインの画面に入れておく）
    OLD_BATTLE_KEY: 'hoshinoko.battle.v1',    // アカウントを作る前のバトルの記録（最初のアカウントに引きつぐ）
    CARRIED_KEY: 'hoshinoko.battle.v1.carried',
    USERNAME_RE: /^[A-Za-z0-9_]{3,16}$/,
    PASSWORD_MIN: 6,
    PASSWORD_MAX: 64,
    NAME_MAX: 10,
    MAGIC_SLOTS: 5,
    TIMEOUT_MS: 12000,
    RETRY_MS: 20000,
    SAVE_TRIES: 4,     // ほかの端末と同時に保存した時（CONFLICT）に、読み直して保存し直す回数
    PBKDF2_ITER: 120000,
    APPLIED_MAX: 60,

    user: null,        // { username, key（小文字のユーザー名）, mode: 'cloud' | 'local' }
    data: null,        // セーブデータ
    token: null,       // オンラインのログインの鍵（サーバーには、これのハッシュだけがある）
    pending: [],       // まだサーバーに送れていないできごと
    online: null,      // オンラインの時：最後の通信がうまくいったか（true / false）。オフラインの時は null
    ready: false,      // 起動時の自動ログインが終わったか
    _readyPromise: null,
    _flushTimer: null,
    _flushing: false,
    _flushAgain: false,
    _listeners: [],

    // ---------- 状態 ----------
    get cloudConfigured() {
        const c = window.ONLINE_CONFIG || {};
        return !!(c.url && c.key && /^https?:\/\//i.test(c.url));
    },
    get mode() { return this.cloudConfigured ? 'cloud' : 'local'; },
    get loggedIn() { return !!(this.user && this.data); },
    get profile() { return this.data ? this.data.profile : null; },
    hasProfile() {
        const p = this.profile;
        return !!(p && p.name && (p.gender === 'male' || p.gender === 'female'));
    },
    get playerName() { return (this.profile && this.profile.name) || ''; },
    get gender() { return (this.profile && this.profile.gender) || 'male'; },
    get loadout() { return this.data ? this.data.loadout : this.blankLoadout(); },
    get lastUsername() {
        try { return localStorage.getItem(this.LAST_USER_KEY) || ''; } catch (e) { return ''; }
    },
    // 画面に出す保存先の説明
    storageLabel() {
        if (!this.user) return this.mode === 'cloud' ? 'オンライン' : 'この端末だけ';
        if (this.user.mode === 'cloud') return this.online === false ? 'オンライン（今はつながっていません）' : 'オンライン（PC・スマホで共通）';
        return 'この端末だけ';
    },
    onChange(fn) { this._listeners.push(fn); },
    _emit() { for (const fn of this._listeners) { try { fn(); } catch (e) { console.error(e); } } },

    // ---------- 入力のチェック（エラーの code を返す。よければ null） ----------
    validateUsername(u) {
        u = String(u || '').trim();
        if (!u) return 'EMPTY_USERNAME';
        if (!this.USERNAME_RE.test(u)) return 'BAD_USERNAME';
        return null;
    },
    validatePassword(p, again) {
        p = String(p || '');
        if (!p) return 'EMPTY_PASSWORD';
        if (p.length < this.PASSWORD_MIN) return 'SHORT_PASSWORD';
        if (p.length > this.PASSWORD_MAX) return 'LONG_PASSWORD';
        if (again !== undefined && p !== again) return 'PASSWORD_MISMATCH';
        return null;
    },
    // プレイヤー名：前後の空白を取り、続いた空白は1つに、見えない文字・< > は消す。最大 NAME_MAX 文字
    cleanName(n) {
        const s = String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
        return [...s].slice(0, this.NAME_MAX).join('');
    },
    validateName(n) {
        const raw = String(n || '').replace(/\s+/g, ' ').trim();
        if (!raw) return 'NAME_EMPTY';
        if ([...raw].length > this.NAME_MAX) return 'NAME_LONG';
        if (!this.cleanName(raw)) return 'NAME_EMPTY';
        return null;
    },
    message(code) {
        const M = {
            EMPTY_USERNAME: 'ユーザー名を入力してください',
            BAD_USERNAME: 'ユーザー名は半角の英字・数字・ _ で、3〜16文字にしてください',
            EMPTY_PASSWORD: 'パスワードを入力してください',
            SHORT_PASSWORD: `パスワードは${this.PASSWORD_MIN}文字以上にしてください`,
            LONG_PASSWORD: `パスワードは${this.PASSWORD_MAX}文字までにしてください`,
            BAD_PASSWORD: `パスワードは${this.PASSWORD_MIN}〜${this.PASSWORD_MAX}文字にしてください`,
            PASSWORD_MISMATCH: '確認のパスワードが同じではありません',
            USERNAME_TAKEN: 'このユーザー名はもう使われています。ほかの名前にしてください',
            BAD_LOGIN: 'ユーザー名かパスワードがちがいます',
            LOCKED: 'パスワードを何度もまちがえたので、5分ほど待ってからログインしてください',
            NAME_EMPTY: 'プレイヤー名を入力してください',
            NAME_LONG: `プレイヤー名は${this.NAME_MAX}文字までにしてください`,
            NETWORK: 'サーバーにつながりません。通信を確かめて、もう一度やってみてください',
            NOT_SETUP: 'サーバーの準備がまだできていません（online/README.md の手順）',
            BAD_KEY: 'サーバーの鍵がちがいます（js/online_config.js）',
            SESSION: 'ログインの期限が切れました。もう一度ログインしてください',
            DATA_TOO_LARGE: 'セーブデータが大きすぎます',
            CONFLICT: 'ほかの端末と同時に保存しました。少し待つと、もう一度保存します',
            NO_CRYPTO: 'このブラウザではパスワードを確かめられません',
            SERVER: 'サーバーでエラーが起きました。少し待ってから、もう一度やってみてください'
        };
        return M[code] || M.SERVER;
    },

    // ---------- セーブデータの形 ----------
    blankLoadout() {
        return { magic: [null, null, null, null, null], sword: 'knife', shield: null, head: null, body: null, legs: null };
    },
    blankData() {
        return { v: 1, profile: null, loadout: this.blankLoadout(), battle: { coins: 0, clears: {}, records: {} }, applied: [] };
    },
    normalizeLoadout(l) {
        const o = this.blankLoadout();
        if (!l || typeof l !== 'object') return o;
        if (Array.isArray(l.magic)) {
            const seen = new Set();
            for (let i = 0; i < this.MAGIC_SLOTS; i++) {
                const id = l.magic[i];
                if (typeof id === 'string' && /^magic_\d+$/.test(id) && !seen.has(id)) { o.magic[i] = id; seen.add(id); }
            }
        }
        if (typeof l.sword === 'string') o.sword = l.sword;
        for (const k of ['shield', 'head', 'body', 'legs']) o[k] = typeof l[k] === 'string' ? l[k] : null;
        return o;
    },
    normalize(d) {
        const o = this.blankData();
        if (!d || typeof d !== 'object') return o;
        if (d.profile && typeof d.profile === 'object' && typeof d.profile.name === 'string' && this.cleanName(d.profile.name)) {
            o.profile = { name: this.cleanName(d.profile.name), gender: d.profile.gender === 'female' ? 'female' : 'male' };
        }
        o.loadout = this.normalizeLoadout(d.loadout);
        const b = d.battle;
        if (b && typeof b === 'object') {
            o.battle.coins = Number.isFinite(b.coins) ? b.coins : 0;
            if (b.clears && typeof b.clears === 'object') o.battle.clears = { ...b.clears };
            if (b.records && typeof b.records === 'object') {
                for (const [id, list] of Object.entries(b.records)) if (Array.isArray(list)) o.battle.records[id] = list.filter(r => r && Number.isFinite(r.time));
            }
        }
        if (Array.isArray(d.applied)) o.applied = d.applied.filter(x => typeof x === 'string').slice(-this.APPLIED_MAX);
        return o;
    },

    // できごとをデータに当てる（もう当てた id なら何もしない）。当てたら true
    applyEvent(d, ev) {
        if (!d || !ev || !ev.id || d.applied.includes(ev.id)) return false;
        if (ev.t === 'profile') {
            d.profile = { name: this.cleanName(ev.name), gender: ev.gender === 'female' ? 'female' : 'male' };
        } else if (ev.t === 'loadout') {
            d.loadout = this.normalizeLoadout(ev.loadout);
        } else if (ev.t === 'clear') {
            const b = d.battle;
            b.coins = (Number.isFinite(b.coins) ? b.coins : 0) + (ev.gained || 0);
            b.clears[ev.boss] = (b.clears[ev.boss] || 0) + 1;
            const same = (r) => r.date === ev.entry.date && r.time === ev.entry.time;
            const list = (b.records[ev.boss] || []).filter(r => !same(r)).concat([{ ...ev.entry }]);
            // 速い順（同じタイムなら先に出した記録が上）
            list.sort((a, c) => a.time - c.time || (a.date < c.date ? -1 : 1));
            b.records[ev.boss] = list.slice(0, (window.BattleRecords && BattleRecords.MAX_RECORDS) || 10);
        } else {
            return false;
        }
        d.applied.push(ev.id);
        if (d.applied.length > this.APPLIED_MAX) d.applied.splice(0, d.applied.length - this.APPLIED_MAX);
        return true;
    },

    // ---------- 起動 ----------
    // 前にログインしたアカウントへ自動でログインする（何度呼んでも1回だけ）
    init() {
        if (!this._readyPromise) {
            this._readyPromise = this._resume()
                .catch((e) => console.warn('自動ログインできませんでした:', e))
                .then(() => { this.ready = true; this._emit(); });
            window.addEventListener('online', () => this.flushSoon(300));
            document.addEventListener('visibilitychange', () => { if (!document.hidden) this.flushSoon(300); });
        }
        return this._readyPromise;
    },
    whenReady() { return this.init(); },

    async _resume() {
        const s = this._readJSON(this.SESSION_KEY);
        if (!s || !s.key) return;
        if (s.mode === 'local' && this.mode === 'local') {
            const u = this._users()[s.key];
            if (!u) { this._clearSession(); return; }
            this.user = { username: u.username, key: s.key, mode: 'local' };
            this.data = this.normalize(this._readJSON(this._saveKey()));
            return;
        }
        if (s.mode === 'cloud' && this.mode === 'cloud' && s.token) {
            this.user = { username: s.username || s.key, key: s.key, mode: 'cloud' };
            this.token = s.token;
            // 手元のコピーで先に始める（サーバーに届かない時も遊べるように）
            this.data = this.normalize(this._readJSON(this._saveKey()));
            this.pending = this._readJSON(this._pendingKey()) || [];
            try {
                const r = await this.rpc('hk_load', { p_token: s.token });
                this.online = true;
                this._acceptServer(r);
                if (this.pending.length) await this.flush().catch(() => {});
            } catch (e) {
                if (e.code === 'SESSION') this._dropLogin();
                else this.online = false;
            }
            return;
        }
        // 保存先が変わった（オンラインの設定を足した・消した）：もう一度ログインしてもらう
        this._clearSession();
    },

    // ---------- アカウント作成・ログイン・ログアウト ----------
    async register(username, password) {
        username = String(username || '').trim();
        const bad = this.validateUsername(username) || this.validatePassword(password);
        if (bad) throw new AccountError(bad);
        const key = username.toLowerCase();
        const carry = this._carryOver();
        const initial = this.normalize({ ...this.blankData(), ...(carry || {}) });
        if (this.mode === 'cloud') {
            const r = await this.rpc('hk_register', { p_username: username, p_password: password, p_data: initial });
            this.online = true;
            this._startSession({ username: r.username || username, key, mode: 'cloud' }, r.token);
            this.pending = [];
            this._acceptServer(r);
        } else {
            const users = this._users();
            if (users[key]) throw new AccountError('USERNAME_TAKEN');
            const salt = this._randomHex(16);
            const hash = await this._hash(password, salt, this.PBKDF2_ITER);
            users[key] = { username, salt, hash, iter: this.PBKDF2_ITER, created: new Date().toISOString() };
            this._writeJSON(this.USERS_KEY, users);
            this._startSession({ username, key, mode: 'local' });
            this.data = initial;
            this._saveCache();
        }
        if (carry) this._markCarried();
        this._rememberUser(username);
        this._emit();
    },

    async login(username, password) {
        username = String(username || '').trim();
        if (!username) throw new AccountError('EMPTY_USERNAME');
        if (!password) throw new AccountError('EMPTY_PASSWORD');
        const key = username.toLowerCase();
        if (this.mode === 'cloud') {
            const r = await this.rpc('hk_login', { p_username: username, p_password: password });
            this.online = true;
            this._startSession({ username: r.username || username, key, mode: 'cloud' }, r.token);
            // 前にこの端末で送れなかったできごとがあれば、続きを送る
            this.pending = this._readJSON(this._pendingKey()) || [];
            this._acceptServer(r);
            if (this.pending.length) await this.flush().catch(() => {});
        } else {
            const u = this._users()[key];
            if (!u) throw new AccountError('BAD_LOGIN');
            const hash = await this._hash(password, u.salt, u.iter || this.PBKDF2_ITER, u.hash);
            if (hash !== u.hash) throw new AccountError('BAD_LOGIN');
            this._startSession({ username: u.username, key, mode: 'local' });
            this.data = this.normalize(this._readJSON(this._saveKey()));
        }
        this._rememberUser(this.user.username);
        this._emit();
    },

    async logout() {
        if (this.user && this.user.mode === 'cloud' && this.token) {
            try { await this.flush(); } catch (e) { /* 送れなかった分はこの端末に残る（次にログインした時に送る） */ }
            try { await this.rpc('hk_logout', { p_token: this.token }); } catch (e) { /* つながらなくてもログアウトはする */ }
        }
        this._dropLogin();
        this._emit();
    },

    // ---------- 変更（できごと） ----------
    setProfile(name, gender) {
        this.update({ t: 'profile', name: this.cleanName(name), gender: gender === 'female' ? 'female' : 'male' });
    },
    setLoadout(loadout) {
        this.update({ t: 'loadout', loadout: this.normalizeLoadout(loadout) });
    },
    update(ev) {
        if (!this.data) return false;
        ev = { ...ev, id: ev.id || this._randomHex(10) };
        this.applyEvent(this.data, ev);
        this._saveCache();
        if (this.user && this.user.mode === 'cloud') {
            this.pending.push(ev);
            this._savePending();
            this.flushSoon();
        }
        this._emit();
        return true;
    },

    flushSoon(ms = 800) {
        if (!this.user || this.user.mode !== 'cloud' || !this.pending.length) return;
        clearTimeout(this._flushTimer);
        this._flushTimer = setTimeout(() => { this.flush().catch(() => {}); }, ms);
    },

    // まだ送れていないできごとを、サーバーの最新のデータに当てて保存する
    async flush() {
        if (!this.user || this.user.mode !== 'cloud' || !this.token || !this.pending.length) return;
        if (this._flushing) { this._flushAgain = true; return; }
        this._flushing = true;
        try {
            const sending = this.pending.slice();
            // 読んでから書くまでの間に、ほかの端末が書いていたら（CONFLICT）、読み直してもう一度当てる
            let latest = null;
            for (let tryNo = 1; ; tryNo++) {
                const r = await this.rpc('hk_load', { p_token: this.token });
                latest = this.normalize(r.data);
                for (const ev of sending) this.applyEvent(latest, ev);
                try {
                    await this.rpc('hk_save', { p_token: this.token, p_data: latest, p_version: Number.isFinite(r.version) ? r.version : null });
                    break;
                } catch (e) {
                    if (e.code !== 'CONFLICT' || tryNo >= this.SAVE_TRIES) throw e;
                }
            }
            this.pending = this.pending.filter(ev => !sending.includes(ev));
            this._savePending();
            // サーバーのデータに、送っている間に増えたできごとを当てた物を、手元のデータにする
            const merged = this.normalize(JSON.parse(JSON.stringify(latest)));
            for (const ev of this.pending) this.applyEvent(merged, ev);
            this.data = merged;
            this._saveCache();
            this.online = true;
            this._emit();
        } catch (e) {
            if (e.code !== 'SESSION') this.online = false;
            clearTimeout(this._flushTimer);
            this._flushTimer = setTimeout(() => { this.flush().catch(() => {}); }, this.RETRY_MS);
            this._emit();
            throw e;
        } finally {
            this._flushing = false;
            if (this._flushAgain) { this._flushAgain = false; this.flushSoon(200); }
        }
    },

    // ---------- サーバー（Supabase の関数を呼ぶ） ----------
    async rpc(fn, args) {
        const c = window.ONLINE_CONFIG || {};
        const url = String(c.url).replace(/\/+$/, '') + '/rest/v1/rpc/' + fn;
        const headers = { 'Content-Type': 'application/json', apikey: c.key };
        // 古い形の鍵（anon key は JWT）の時だけ Authorization も付ける（新しい publishable key は apikey だけ）
        if (/^eyJ/.test(c.key)) headers.Authorization = 'Bearer ' + c.key;
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), this.TIMEOUT_MS) : null;
        let res;
        try {
            res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(args || {}), signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' });
        } catch (e) {
            throw new AccountError('NETWORK', String(e && e.message || e));
        } finally {
            if (timer) clearTimeout(timer);
        }
        let body = null;
        try { body = await res.json(); } catch (e) { body = null; }
        if (!res.ok) {
            const msg = (body && (body.message || body.msg || body.error)) || '';
            if (res.status === 404 || /could not find the function|schema cache/i.test(msg)) throw new AccountError('NOT_SETUP', msg);
            if (res.status === 401 || res.status === 403) throw new AccountError('BAD_KEY', msg);
            throw new AccountError('SERVER', msg);
        }
        if (!body || body.ok !== true) throw new AccountError((body && body.error) || 'SERVER');
        return body;
    },

    _acceptServer(r) {
        if (r.username && this.user) this.user.username = r.username;
        const d = this.normalize(r.data);
        for (const ev of this.pending) this.applyEvent(d, ev);
        this.data = d;
        this._saveCache();
        this._writeSession();
    },

    // ---------- この端末に保存する物 ----------
    _saveKey() { return this.SAVE_PREFIX + this.user.mode + '.' + this.user.key; },
    _pendingKey() { return this.PENDING_PREFIX + this.user.key; },
    _saveCache() { if (this.user && this.data) this._writeJSON(this._saveKey(), this.data); },
    _savePending() { if (this.user) this._writeJSON(this._pendingKey(), this.pending); },
    _users() { return this._readJSON(this.USERS_KEY) || {}; },
    _startSession(user, token = null) {
        this.user = user;
        this.token = token;
        this._writeSession();
    },
    _writeSession() {
        if (!this.user) return;
        this._writeJSON(this.SESSION_KEY, { mode: this.user.mode, key: this.user.key, username: this.user.username, token: this.token || undefined });
    },
    _clearSession() {
        try { localStorage.removeItem(this.SESSION_KEY); } catch (e) { /* 保存できない端末 */ }
    },
    _dropLogin() {
        clearTimeout(this._flushTimer);
        this._clearSession();
        this.user = null;
        this.data = null;
        this.token = null;
        this.pending = [];
        this.online = null;
    },
    _rememberUser(name) {
        try { localStorage.setItem(this.LAST_USER_KEY, name); } catch (e) { /* 保存できない端末 */ }
    },
    // アカウントを作る前のバトルの記録（コイン・マイベスト）を、この端末で最初に作ったアカウントに引きつぐ
    _carryOver() {
        try { if (localStorage.getItem(this.CARRIED_KEY)) return null; } catch (e) { return null; }
        const old = this._readJSON(this.OLD_BATTLE_KEY);
        if (!old || typeof old !== 'object') return null;
        const has = (old.coins > 0) || (old.records && Object.keys(old.records).length > 0);
        if (!has) return null;
        return { battle: { coins: Number.isFinite(old.coins) ? old.coins : 0, clears: old.clears || {}, records: old.records || {} } };
    },
    _markCarried() {
        try { localStorage.setItem(this.CARRIED_KEY, new Date().toISOString()); } catch (e) { /* 保存できない端末 */ }
    },
    _readJSON(key) {
        try {
            const raw = window.localStorage && localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    },
    _writeJSON(key, v) {
        try { if (window.localStorage) localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 保存できなくても遊べる */ }
    },

    // ---------- パスワードのハッシュ（オフラインのアカウント） ----------
    // PBKDF2-SHA256（使えないブラウザでは SHA-256 をくり返す）。stored：前に保存したハッシュ（同じ方式で計算するため）
    async _hash(password, saltHex, iter, stored = '') {
        const useSha = stored.startsWith('sha:');
        if (!useSha && window.crypto && crypto.subtle && typeof TextEncoder === 'function') {
            const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
            const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: this._hexToBytes(saltHex), iterations: iter }, key, 256);
            return 'pbkdf2:' + this._bytesToHex(new Uint8Array(bits));
        }
        if (stored.startsWith('pbkdf2:')) throw new AccountError('NO_CRYPTO');
        let h = saltHex + ':' + password;
        for (let i = 0; i < 3000; i++) h = Account._sha256Hex(h);
        return 'sha:' + h;
    },
    _randomHex(bytes) {
        const a = new Uint8Array(bytes);
        if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
        else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
        return this._bytesToHex(a);
    },
    _bytesToHex(a) { return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); },
    _hexToBytes(h) {
        const a = new Uint8Array(h.length / 2);
        for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
        return a;
    },
    // SHA-256（文字列は UTF-8 にして計算。16進の文字列を返す）
    _sha256Hex(str) {
        const bytes = [];
        for (const ch of unescape(encodeURIComponent(str))) bytes.push(ch.charCodeAt(0));
        const K = Account._SHA_K || (Account._SHA_K = (() => {
            const k = [], isPrime = (n) => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
            for (let n = 2; k.length < 64; n++) if (isPrime(n)) k.push((Math.cbrt(n) % 1) * 0x100000000 >>> 0);
            return k;
        })());
        let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        const len = bytes.length * 8;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) bytes.push(0);
        for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (len >>> (i * 8)) & 0xff);
        const rot = (x, n) => (x >>> n) | (x << (32 - n));
        const w = new Array(64);
        for (let o = 0; o < bytes.length; o += 64) {
            for (let i = 0; i < 16; i++) w[i] = (bytes[o + i * 4] << 24) | (bytes[o + i * 4 + 1] << 16) | (bytes[o + i * 4 + 2] << 8) | bytes[o + i * 4 + 3];
            for (let i = 16; i < 64; i++) {
                const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
            }
            let [a, b, c, d, e, f, g, hh] = h;
            for (let i = 0; i < 64; i++) {
                const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
                const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            h = [h[0] + a, h[1] + b, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map(x => x | 0);
        }
        return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
    }
};

window.Account = Account;
window.AccountError = AccountError;
