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
        console.log('=== InputManager 初期化開始 ===');
        
        // キーボードイベント
        window.addEventListener('keydown', (e) => {
            console.log('🔑 キー押下イベント:', e.code);
            this.keys[e.code] = true;
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
        
        // マウスイベント
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) {
            console.error('❌ Canvas要素が見つかりません！');
            return;
        }
        
        console.log('✅ Canvas要素を取得:', canvas);
        
        // キャンバスにマウスムーブ
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            this.mousePos.x = (e.clientX - rect.left) * (canvas.width / rect.width);
            this.mousePos.y = (e.clientY - rect.top) * (canvas.height / rect.height);
            
            // タイトル画面用
            this.mouseX = this.mousePos.x;
            this.mouseY = this.mousePos.y;
        });
        
        // キャンバスにマウスダウン
        canvas.addEventListener('mousedown', (e) => {
            console.log('🖱️ マウスダウンイベント:', e.button);
            this.mouseButtons[e.button] = true;
        });
        
        // キャンバスにマウスアップ
        canvas.addEventListener('mouseup', (e) => {
            this.mouseButtons[e.button] = false;
        });
        
        // キャンバスにクリック（追加の保険）
        canvas.addEventListener('click', (e) => {
            console.log('🖱️ クリックイベント発火！');
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);
            console.log(`クリック座標: (${x.toFixed(0)}, ${y.toFixed(0)})`);
        });
        
        console.log('=== InputManager 初期化完了 ===');
    }
    
    update() {
        // console.log('InputManager.update() 呼び出し'); // 毎フレーム出るので通常はコメントアウト
        this.keysPrev = { ...this.keys };
        this.mouseButtonsPrev = { ...this.mouseButtons };
        
        // マウスクリック判定（左クリック）
        const wasClicked = this.mouseButtons[0] === true && this.mouseButtonsPrev[0] !== true;
        if (wasClicked) {
            console.log('🖱️ isMouseClicked = true');
        }
        this.isMouseClicked = wasClicked;
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
