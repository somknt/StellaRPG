// メインエントリーポイント

let game = null;

window.addEventListener('load', async () => {
    console.log('='.repeat(60));
    console.log('星の子 (Hoshi no Ko) - JavaScript版');
    console.log('='.repeat(60));
    
    const canvas = document.getElementById('gameCanvas');
    
    if (!canvas) {
        console.error('Canvas要素が見つかりません');
        return;
    }
    
    // ゲーム初期化
    game = new Game(canvas);
    window.game = game;
    
    // スマホ対応（画面フィット・タッチ操作）
    if (window.TouchControls) {
        window.TouchControls.init(game.input);
    }
    
    try {
        await game.init();
        
        // 音の準備（BGM のファイル探し・効果音の読み込み）を待つ。長くても BOOT.soundWait 秒で先へ進む
        const sm = window.soundManager;
        if (sm && sm.ready) {
            game.ui.updateLoadingProgress(1, 'サウンド読み込み中...');
            await Promise.race([sm.ready, wait(BOOT.soundWait)]);
        }
        game.ui.updateLoadingProgress(1, '読み込み完了');
        
        // タイトルの曲は、タイトル画面が出た時から流す
        // ブラウザは画面をさわる前の音を止めるので、音を出せない時だけ「画面をタップしてください」を出して待つ
        // （さわった瞬間に音が有効になってタイトルの曲が流れ出す：sound.js の bindUnlock。スマホはここで全画面・横向きになる：touch_controls.js）
        // ホーム画面から開いたアプリなど、さわる前から音を出せる時は、そのままタイトルへ
        const needTap = !!(sm && sm.hasAudibleBGM('bgm_title')) && !(await sm.tryAutoplay());
        if (needTap) await waitForTap();
        else await wait(500);
        
        // ローディング画面を隠す（さわった時のキー・クリックで、タイトルを飛ばさないように入力を消す）
        game.input.resetAll();
        game.input.endFrame();
        game.ui.hideLoadingScreen();
        game.start();
        
    } catch (error) {
        console.error('ゲーム初期化エラー:', error);
        document.getElementById('loading-text').textContent = 'エラーが発生しました: ' + error.message;
    }
});

// 起動の設定
//   soundWait：音の準備を待つ最長の秒数(ms) / ignoreKeys：押しても「さわった」にしないキー（ブラウザが音を許さないキー）
const BOOT = { soundWait: 5000, ignoreKeys: /^(Escape|Shift|Control|Alt|Meta|Tab|CapsLock|F\d+)$/ };

function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// 読み込みの後：「画面をタップしてください」を出して、クリック・タップ・キーを待つ
// 指を離した時（touchend）ではなく click で進める（先に読み込み画面を消すと、同じタップがタイトルに届いて飛ばしてしまうため）
function waitForTap() {
    const screen = document.getElementById('loading-screen');
    const msg = document.getElementById('loading-tap');
    if (msg) msg.hidden = false;
    if (screen) screen.classList.add('wait-tap'); // cursor: pointer（iPhone はこれがないと click が来ない）
    return new Promise((resolve) => {
        const done = (e) => {
            if (e.type === 'keydown' && BOOT.ignoreKeys.test(e.key)) return;
            window.removeEventListener('click', done);
            window.removeEventListener('keydown', done);
            if (msg) msg.hidden = true;
            if (screen) screen.classList.remove('wait-tap');
            resolve();
        };
        window.addEventListener('click', done);
        window.addEventListener('keydown', done);
    });
}

// ウィンドウリサイズ対応は touch_controls.js の fitGame で行う

// ページ離脱時の警告（オプション）
window.addEventListener('beforeunload', (e) => {
    if (game && game.running) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// グローバル関数（デバッグ用）
window.toggleGrid = () => {
    window.showGrid = !window.showGrid;
    console.log('グリッド表示:', window.showGrid);
};

window.addExp = (amount) => {
    if (game && game.player) {
        game.player.gainExp(amount);
        console.log('経験値追加:', amount);
    }
};

window.healPlayer = () => {
    if (game && game.player) {
        game.player.heal(999);
        game.player.restoreSP(999);
        console.log('HP/SP全回復');
    }
};

window.unlockStarPower = (stage) => {
    if (game && game.player) {
        game.player.unlockStarPower(stage);
        console.log('星力解放:', stage);
    }
};

window.learnAllMagic = () => {
    if (game && game.player && window.gameData) {
        window.gameData.magicCircles.forEach(magic => {
            game.player.learnMagic(magic.id);
        });
        console.log('全魔法習得完了');
    }
};

// デバッグ情報表示
console.log('');
console.log('【デバッグコマンド】');
console.log('toggleGrid() - グリッド表示切替');
console.log('addExp(100) - 経験値追加');
console.log('healPlayer() - HP/SP全回復');
console.log('unlockStarPower(4) - 星力段階解放');
console.log('learnAllMagic() - 全魔法習得');
console.log('');
