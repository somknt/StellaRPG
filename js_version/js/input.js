// 入力管理システム

class InputManager {
    constructor() {
        this.keys = {};
        this.keysPrev = {};
        this.mousePos = new Vector2(0, 0);
        this.mouseButtons = {};
        this.mouseButtonsPrev = {};
        
        // タイトル画面用のマウス座標とクリック状態
        this.mouseX = 0;
        this.mouseY = 0;
        this.isMouseClicked = false;
        
        this.init();
    }
    
    init() {
        // キーボードイベント
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
        
        // マウスイベント
        window.addEventListener('mousemove', (e) => {
            const canvas = document.getElementById('gameCanvas');
            const rect = canvas.getBoundingClientRect();
            this.mousePos.x = (e.clientX - rect.left) * (canvas.width / rect.width);
            this.mousePos.y = (e.clientY - rect.top) * (canvas.height / rect.height);
            
            // タイトル画面用
            this.mouseX = this.mousePos.x;
            this.mouseY = this.mousePos.y;
        });
        
        window.addEventListener('mousedown', (e) => {
            this.mouseButtons[e.button] = true;
        });
        
        window.addEventListener('mouseup', (e) => {
            this.mouseButtons[e.button] = false;
        });
    }
    
    update() {
        this.keysPrev = { ...this.keys };
        this.mouseButtonsPrev = { ...this.mouseButtons };
        
        // マウスクリック判定（左クリック）
        this.isMouseClicked = this.mouseButtons[0] === true && this.mouseButtonsPrev[0] !== true;
    }
    
    // キーが押されているか
    isKeyDown(keyCode) {
        return this.keys[keyCode] === true;
    }
    
    // キーが押された瞬間か
    isKeyPressed(keyCode) {
        return this.keys[keyCode] === true && this.keysPrev[keyCode] !== true;
    }
    
    // キーが離された瞬間か
    isKeyReleased(keyCode) {
        return this.keys[keyCode] !== true && this.keysPrev[keyCode] === true;
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
