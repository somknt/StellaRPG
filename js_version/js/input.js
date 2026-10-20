// 入力管理システム
// キー/クリックの「押された瞬間」はイベント発生時に記録し、
// フレームの最後に endFrame() でクリアする方式。
// （フレーム先頭で前フレーム状態をコピーすると判定が常に false になるため）

class InputManager {
    constructor() {
        this.keys = {};             // 押しっぱなし状態
        this.pressedKeys = {};      // このフレームで押されたキー
        this.releasedKeys = {};     // このフレームで離されたキー
        this.mousePos = new Vector2(0, 0);
        this.mouseButtons = {};     // 押しっぱなし状態
        
        // マウス座標とクリック状態（タイトル画面・キャラ選択用）
        this.mouseX = 0;
        this.mouseY = 0;
        this.isMouseClicked = false;
        this.isRightClicked = false;
        
        this.init();
    }
    
    init() {
        // キーボードイベント
        window.addEventListener('keydown', (e) => {
            // 押しっぱなしのリピートは「押された瞬間」にしない
            if (!this.keys[e.code]) {
                this.pressedKeys[e.code] = true;
            }
            this.keys[e.code] = true;
            
            // ゲームで使うキーはブラウザのスクロール等を防ぐ
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.code)) {
                e.preventDefault();
            }
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
            this.releasedKeys[e.code] = true;
        });
        
        // ウィンドウからフォーカスが外れたらキー状態をリセット
        window.addEventListener('blur', () => {
            this.keys = {};
            this.mouseButtons = {};
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
        
        // UIオーバーレイがキャンバスの上に重なっていても拾えるよう window で受ける
        window.addEventListener('mousemove', updateMousePos);
        
        window.addEventListener('mousedown', (e) => {
            updateMousePos(e);
            this.mouseButtons[e.button] = true;
            if (e.button === 0) {
                this.isMouseClicked = true;
            }
            if (e.button === 2) {
                this.isRightClicked = true;
            }
        });
        
        // 右クリックメニューを出さない（右クリックは回避に使う）
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        window.addEventListener('mouseup', (e) => {
            this.mouseButtons[e.button] = false;
        });
    }
    
    // フレームの最後に呼ぶ：「押された瞬間」系の状態をクリア
    endFrame() {
        this.pressedKeys = {};
        this.releasedKeys = {};
        this.isMouseClicked = false;
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
    
    // 移動入力ベクトルを取得
    getMovementVector() {
        const vector = new Vector2(0, 0);
        
        if (this.isKeyDown('KeyW') || this.isKeyDown('ArrowUp')) vector.y -= 1;
        if (this.isKeyDown('KeyS') || this.isKeyDown('ArrowDown')) vector.y += 1;
        if (this.isKeyDown('KeyA') || this.isKeyDown('ArrowLeft')) vector.x -= 1;
        if (this.isKeyDown('KeyD') || this.isKeyDown('ArrowRight')) vector.x += 1;
        
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
    
    // 回避キー（C キー or 右クリック）
    isDodgePressed() {
        return this.isKeyPressed('KeyC') || this.isRightClicked === true;
    }
    
    // 攻撃キー
    isAttackPressed() {
        return this.isKeyPressed('Space');
    }
    
    // 魔法キー
    isMagicPressed() {
        return this.isKeyPressed('KeyQ');
    }
    
    // 相互作用キー
    isInteractPressed() {
        return this.isKeyPressed('KeyE');
    }
}
