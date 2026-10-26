// 入力管理システム
// キー/クリックの「押された瞬間」はイベント発生時に記録し、
// フレームの最後に endFrame() でクリアする方式。
// （フレーム先頭で前フレーム状態をコピーすると判定が常に false になるため）
//
// マウスとタッチは Pointer Events でまとめて扱う（スマホのタップも「クリック」として届く）。
// スマホのボタンとスティックは setVirtualKey / setStick で、キーボードと同じ入力として入れる。

class InputManager {
    constructor() {
        this.keys = {};             // 押しっぱなし状態
        this.pressedKeys = {};      // このフレームで押されたキー
        this.releasedKeys = {};     // このフレームで離されたキー
        this.mousePos = new Vector2(0, 0);
        this.mouseButtons = {};     // 押しっぱなし状態
        
        // マウス/タップの座標とクリック状態（キャラ選択などで使う）
        this.mouseX = 0;
        this.mouseY = 0;
        this.isMouseClicked = false;
        this.isLeftMouseClicked = false;
        this.isRightClicked = false;
        this.paletteOpen = false;   // 魔法パレットを開いている間 true（攻撃・回避をしない）
        
        // スマホのバーチャルスティック（-1〜1）
        this.stick = new Vector2(0, 0);
        this.stickDeadZone = 0.18;
        
        this.init();
    }
    
    init() {
        // キーボードイベント
        window.addEventListener('keydown', (e) => {
            this.pressKey(e.code);
            
            // ゲームで使うキーはブラウザのスクロール等を防ぐ
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.code)) {
                e.preventDefault();
            }
        });
        
        window.addEventListener('keyup', (e) => {
            this.releaseKey(e.code);
        });
        
        // ウィンドウからフォーカスが外れた・アプリを切り替えたら入力をリセット
        // （押しっぱなしのまま戻ってこない事故を防ぐ）
        window.addEventListener('blur', () => this.resetAll());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.resetAll();
        });
        
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) {
            console.error('Canvas要素が見つかりません');
            return;
        }
        
        // キャンバス座標に変換（CSSで拡大縮小されていてもズレないように）
        const updateMousePos = (e) => {
            const rect = canvas.getBoundingClientRect();
            this.mousePos.x = (e.clientX - rect.left) * (canvas.width / rect.width);
            this.mousePos.y = (e.clientY - rect.top) * (canvas.height / rect.height);
            this.mouseX = this.mousePos.x;
            this.mouseY = this.mousePos.y;
        };
        
        // タッチ操作ボタン/スティックの上の操作は「画面クリック」として扱わない
        // （一時停止ボタンや結果画面のボタンを押した時も、攻撃にならないようにする）
        const isOnTouchControls = (e) =>
            e.target && e.target.closest && e.target.closest('#touch-controls, #fullscreen-btn, .ui-btn, .battle-panel, #screens.open');
        
        // UIオーバーレイがキャンバスの上に重なっていても拾えるよう window で受ける
        window.addEventListener('pointermove', (e) => {
            if (!isOnTouchControls(e)) updateMousePos(e);
        });
        
        window.addEventListener('pointerdown', (e) => {
            if (isOnTouchControls(e)) return;
            updateMousePos(e);
            this.mouseButtons[e.button] = true;
            if (e.button === 0) {
                this.isMouseClicked = true;
                // 攻撃に使うのはマウスの左クリックだけ（スマホで画面をタップしても攻撃しない）
                if (e.pointerType === 'mouse') this.isLeftMouseClicked = true;
            }
            if (e.button === 2) {
                this.isRightClicked = true;
            }
        });
        
        window.addEventListener('pointerup', (e) => {
            this.mouseButtons[e.button] = false;
        });
        window.addEventListener('pointercancel', (e) => {
            this.mouseButtons[e.button] = false;
        });
        
        // 右クリックメニュー・長押しメニューを出さない（右クリックは回避に使う）
        window.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    
    // ---- キー入力の共通処理（キーボードとスマホのボタンの両方から呼ぶ） ----
    pressKey(code) {
        // 押しっぱなしのリピートは「押された瞬間」にしない
        if (!this.keys[code]) {
            this.pressedKeys[code] = true;
        }
        this.keys[code] = true;
    }
    
    releaseKey(code) {
        if (this.keys[code]) {
            this.releasedKeys[code] = true;
        }
        this.keys[code] = false;
    }
    
    // スマホのボタン用
    setVirtualKey(code, isDown) {
        if (isDown) this.pressKey(code);
        else this.releaseKey(code);
    }
    
    // スマホのスティック用（x, y は -1〜1、長さ 1 まで）
    setStick(x, y) {
        this.stick = new Vector2(x, y);
    }
    
    // スマホの魔法パレットで選んだ魔法の番号（プレイヤーが次のフレームで受け取る）
    selectMagic(index) {
        this.pendingMagicIndex = index;
    }
    
    consumeMagicSelection() {
        const i = this.pendingMagicIndex;
        this.pendingMagicIndex = null;
        return (i === undefined) ? null : i;
    }
    
    resetAll() {
        this.keys = {};
        this.mouseButtons = {};
        this.stick = new Vector2(0, 0);
    }
    
    // フレームの最後に呼ぶ：「押された瞬間」系の状態をクリア
    endFrame() {
        this.pressedKeys = {};
        this.releasedKeys = {};
        this.isMouseClicked = false;
        this.isLeftMouseClicked = false;
        this.isRightClicked = false;
    }
    
    // このフレームのクリックを「使用済み」にする（魔法パレットを決定したクリックで攻撃しないように）
    consumeClick() {
        this.isMouseClicked = false;
        this.isLeftMouseClicked = false;
        this.isRightClicked = false;
    }
    
    // 互換用（旧コードから呼ばれても問題ないよう何もしない）
    update() {}
    
    // キーが押されているか
    isKeyDown(keyCode) {
        return this.keys[keyCode] === true;
    }
    
    // キーが押された瞬間か
    isKeyPressed(keyCode) {
        return this.pressedKeys[keyCode] === true;
    }
    
    // キーが離された瞬間か
    isKeyReleased(keyCode) {
        return this.releasedKeys[keyCode] === true;
    }
    
    // 移動入力ベクトルを取得（キーボードとスティックの両方）
    getMovementVector() {
        const vector = new Vector2(0, 0);
        
        if (this.isKeyDown('KeyW') || this.isKeyDown('ArrowUp')) vector.y -= 1;
        if (this.isKeyDown('KeyS') || this.isKeyDown('ArrowDown')) vector.y += 1;
        if (this.isKeyDown('KeyA') || this.isKeyDown('ArrowLeft')) vector.x -= 1;
        if (this.isKeyDown('KeyD') || this.isKeyDown('ArrowRight')) vector.x += 1;
        
        // キーボード入力がなければスティック（少し倒しただけの誤操作は無視）
        if (vector.length() === 0 && this.stick.length() > this.stickDeadZone) {
            return this.stick.normalize();
        }
        
        // 正規化（斜め移動が速くならないように）
        if (vector.length() > 0) {
            return vector.normalize();
        }
        return vector;
    }
    
    // ダッシュキー
    isSprintPressed() {
        return this.isKeyDown('ShiftLeft') || this.isKeyDown('ShiftRight');
    }
    
    // 回避（右クリック。C キーでも可）
    isDodgePressed() {
        if (this.paletteOpen) return false;
        return this.isKeyPressed('KeyC') || this.isRightClicked === true;
    }
    
    // 攻撃（左クリック。Space でも可）。魔法パレットを開いている間は攻撃しない
    isAttackPressed() {
        if (this.paletteOpen) return false;
        return this.isLeftMouseClicked === true || this.isKeyPressed('Space');
    }
    
    // 魔法パレット（E キー）
    isPaletteKeyPressed() {
        return this.isKeyPressed('KeyE');
    }
    
    // 魔法キー
    isMagicPressed() {
        return this.isKeyPressed('KeyQ');
    }
    
    // 相互作用キー（E は魔法パレットに使うので F に変更。今は未使用）
    isInteractPressed() {
        return this.isKeyPressed('KeyF');
    }
}
