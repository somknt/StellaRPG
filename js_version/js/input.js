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
        this.leftMouseHeld = false; // マウスの左ボタンを押したまま（長押しで連続攻撃。タッチの画面タップは入れない）
        this.paletteOpen = false;   // 魔法パレットを開いている間 true（攻撃・回避をしない）
        
        // スマホのバーチャルスティック（-1〜1）
        this.stick = new Vector2(0, 0);
        this.stickDeadZone = 0.18;
        
        // ねらう向き
        // touchAim：スマホで攻撃・魔法ボタンを押したまま指をスライドした向き（touch_controls.js が入れる）
        //   active：今スライドしている / source：'attack' か 'magic' / until：指を離した後も向きを覚えておく時刻（魔法の詠唱中）
        // mouseAim：PC でマウスを使っている時は、カーソルの方向をねらう
        //   held / since：魔法ボタンを押している間 true と、押し始めた時刻（長押しでその場系のターゲットカーソルを出す）
        this.touchAim = InputManager.emptyAim();
        this.mouseAim = false;
        
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
            // マウスを動かしたらカーソルでねらう。タッチで操作したらやめる（スマホはスライドでねらう）
            if (e.pointerType === 'mouse') this.mouseAim = true;
            else if (e.pointerType === 'touch') this.mouseAim = false;
        });
        // マウスがウィンドウの外へ出たら、カーソルではねらわない（戻ってきたらまたねらう）
        document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) this.mouseAim = false; });
        
        window.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch') this.mouseAim = false;
            if (isOnTouchControls(e)) return;
            updateMousePos(e);
            if (e.pointerType === 'mouse') this.mouseAim = true;
            this.mouseButtons[e.button] = true;
            if (e.button === 0) {
                this.isMouseClicked = true;
                // 攻撃に使うのはマウスの左クリックだけ（スマホで画面をタップしても攻撃しない）
                if (e.pointerType === 'mouse') { this.isLeftMouseClicked = true; this.leftMouseHeld = true; }
            }
            if (e.button === 2) {
                this.isRightClicked = true;
            }
        });
        
        window.addEventListener('pointerup', (e) => {
            this.mouseButtons[e.button] = false;
            if (e.button === 0) this.leftMouseHeld = false;
        });
        window.addEventListener('pointercancel', (e) => {
            this.mouseButtons[e.button] = false;
            if (e.button === 0) this.leftMouseHeld = false;
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
        this.leftMouseHeld = false;
        this.stick = new Vector2(0, 0);
        this.touchAim = InputManager.emptyAim();
    }
    
    static emptyAim() {
        return { active: false, x: 0, y: 0, source: null, until: 0, held: false, since: 0 };
    }
    
    // ---- ねらう向き ----
    // スマホのボタンを押した（まだスライドしていない）。長押しの時間を数えはじめる
    setTouchHold(source) {
        this.touchAim = { ...InputManager.emptyAim(), source, held: true, since: performance.now() };
    }
    // スマホのボタンのスライド（touch_controls.js から）。dx, dy は押した所からの指の動き（画面上）
    setTouchAim(source, dx, dy) {
        const a = this.touchAim;
        const since = a.source === source && a.held ? a.since : performance.now();
        this.touchAim = { active: true, x: dx, y: dy, source, until: 0, held: true, since };
    }
    // 指を離した：攻撃はすぐ忘れる。魔法は詠唱が終わって撃つまで向き・場所を覚えておく（keepMs ミリ秒まで）
    releaseTouchAim(source, keepMs = 0) {
        const a = this.touchAim;
        if (a.source !== source) return;
        if (a.active && keepMs > 0) this.touchAim = { ...a, active: false, held: false, until: performance.now() + keepMs };
        else this.touchAim = InputManager.emptyAim();
    }
    // 魔法を撃った後：覚えていたスライドの向きを忘れる（押したままなら、次の詠唱のために残す）
    clearTouchAim(source) {
        const a = this.touchAim;
        if (a.source === source && !a.active && !a.held) this.touchAim = InputManager.emptyAim();
    }
    
    // ねらう向き（Vector2。画面上の向き＝ワールドの向き）。playerScreen：画面上の主人公の位置（キャンバス座標）
    // スライド中・スライドを覚えている間はその向き、PC でマウスを使っていればカーソルの方向、なければ null
    getAimVector(playerScreen) {
        const a = this.touchAim;
        if ((a.active || (a.source && performance.now() < a.until)) && Math.hypot(a.x, a.y) > 0.01) return new Vector2(a.x, a.y);
        if (this.mouseAim && playerScreen) {
            const v = this.mousePos.sub(playerScreen);
            if (v.length() > 8) return v; // 主人公の真上にカーソルがある時は向きを決めない
        }
        return null;
    }
    
    // スマホ：攻撃ボタンを押したままスライドしている（その向きへ斬り続ける）
    isAttackSliding() {
        if (this.paletteOpen) return false;
        return this.touchAim.active && this.touchAim.source === 'attack' && this.isKeyDown('Space');
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
    
    // 攻撃を押したまま（マウスの左ボタン・Space。スマホの攻撃ボタンも Space として入る）。押している間は連続で攻撃する
    isAttackHeld() {
        if (this.paletteOpen) return false;
        return this.leftMouseHeld === true || this.isKeyDown('Space');
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
