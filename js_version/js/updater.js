// 新しい版が出たら読み直す（スマホのホーム画面のアプリ・開いたままのタブで、古い JS・CSS のまま遊ばないように）
//   今の版：index.html の <meta name="app-version">（tools/bump_version.ps1 が書く）
//   新しい版：version.json（キャッシュを使わずに読む）。画面にもどった時と、Updater.EVERY_MS ごとに見る
//   番号がちがう時：タイトル・メニューなどの画面なら、すぐ読み直す。戦い・酒場・入力の途中なら、メニューの画面にもどった時に読み直す
const Updater = {
    mine: (document.querySelector('meta[name="app-version"]') || {}).content || '',
    newer: null,
    told: false,
    reloading: false,
    async check() {
        if (!this.mine || this.newer) return;
        try {
            const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
            if (!r.ok) return;
            const j = await r.json();
            if (j && typeof j.v === 'string' && j.v && j.v !== this.mine) this.newer = j.v;
        } catch (e) { /* つながらない時は何もしない */ }
        this.tryReload();
    },
    // 読み直してよい画面か（遊んでいる途中・文字を入れている途中・画面の切りかえ中は待つ）
    safe() {
        const g = window.game;
        if (!g) return true;
        const sc = g.screens;
        if (sc && sc.busy) return false;
        // ソロのモンスター選択・装備（マルチの時は酒場とつながっているので待つ）
        if ((g.gameState === 'monster_select' || g.gameState === 'equip') && sc && !sc.mp && !sc.equipReturn && !(g.tavern && g.tavern.active)) return true;
        return Updater.SAFE_STATES.includes(g.gameState);
    },
    tryReload() {
        if (!this.newer) return;
        // 読み直しても同じ番号のままだった（新しい index.html がまだ届かない）時は、くり返し読み直さない
        let tried = null;
        try { tried = sessionStorage.getItem('hk_reload_for'); } catch (e) { /* 使えない端末 */ }
        if (tried === this.newer) return;
        if (this.safe()) {
            try { sessionStorage.setItem('hk_reload_for', this.newer); } catch (e) { /* 使えない端末 */ }
            this.reloading = true;   // main.js の「ページを離れますか？」を出さない
            location.reload();
            return;
        }
        if (!this.told && window.game && game.screens && game.screens.toast && game.screens.current) {
            this.told = true;
            game.screens.toast('新しい版があります。メニューの画面にもどると更新されます');
        }
    },
    start() {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.check(); });
        window.addEventListener('pageshow', (e) => { if (e.persisted) this.check(); });   // 戻る・進むで前のページが出た時
        setInterval(() => this.check(), Updater.EVERY_MS);
        setInterval(() => this.tryReload(), 2000);
        setTimeout(() => this.check(), 3000);
    }
};
Updater.EVERY_MS = 3 * 60 * 1000;
// すぐ読み直してよい画面（遊んでいない・何も入力していない）
Updater.SAFE_STATES = ['loading', 'title', 'main_menu', 'battle_select', 'story', 'settings', 'account_info', 'ranking'];
Updater.start();
window.Updater = Updater;
