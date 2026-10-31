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
        
        // 読み込みが終わったら、さわるのを待たずにタイトルへ（「画面をタップしてください」は出さない）
        // タイトルの曲は、タイトル画面が出た時から流す。ブラウザが音を許していれば、すぐ流れる（sound.js の tryAutoplay）
        // 許していない時（はじめて開いたサイトなど）は、最初にキー・クリック・タップした瞬間に流れ出す（sound.js の bindUnlock）
        if (sm) await sm.tryAutoplay();
        await wait(300);
        
        // ローディング画面を隠す（読み込み中に押したキー・クリックで、タイトルを飛ばさないように入力を消す）
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
//   soundWait：音の準備を待つ最長の秒数(ms)
const BOOT = { soundWait: 5000 };

function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
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
