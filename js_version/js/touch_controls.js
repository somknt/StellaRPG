// スマホ対応：画面フィット・タッチ操作（スティックとボタン）・縦向き案内・全画面
//
// 設計
// - ゲームは常に 1280x720 で描き、#game-container ごと端末の画面に収まるよう拡大縮小する
//   （キャンバス座標の計算は getBoundingClientRect で行っているので、拡大縮小してもタップ位置はズレない）
// - タッチ操作はゲーム画面の外（画面の端）に固定する。横長スマホの左右の黒帯も操作に使える
// - 左半分のどこを触ってもそこにスティックが出る（フローティング）。右下にアクションボタン
// - ボタンはキーボードと同じキーとして InputManager に入れるので、ゲーム側の処理は共通

const TouchControls = {
    LOGICAL_W: 1280,
    LOGICAL_H: 720,
    
    init(input) {
        this.input = input;
        this.container = document.getElementById('game-container');
        this.isTouch = this.detectTouch();
        
        if (this.isTouch) this.enableTouchMode();
        // マウスで始めても、途中でタッチされたらタッチ操作を出す（タッチ対応ノートPCなど）
        window.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch' && !this.isTouch) {
                this.isTouch = true;
                this.enableTouchMode();
            }
        });
        
        this.setupStick();
        this.setupButtons();
        this.setupFullscreen();
        
        // iOS Safari はピンチ操作を独自イベントで送ってくるので止める
        document.addEventListener('gesturestart', (e) => e.preventDefault());
        
        // 画面サイズ・向きの変化に追従
        const refit = () => this.fitGame();
        window.addEventListener('resize', refit);
        window.addEventListener('orientationchange', () => setTimeout(refit, 200));
        if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
        this.fitGame();
    },
    
    detectTouch() {
        // ?touch=1 を付けるとパソコンでもタッチ操作を表示（確認用）
        if (/[?&]touch=1/.test(location.search)) return true;
        return (window.matchMedia && matchMedia('(pointer: coarse)').matches) ||
               ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    },
    
    enableTouchMode() {
        document.body.classList.add('touch');
        this.fitGame();
    },
    
    // ---------- 画面フィット ----------
    fitGame() {
        const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        
        // 画面に収まる最大の倍率（パソコンでは等倍より大きくしない）
        let scale = Math.min(vw / this.LOGICAL_W, vh / this.LOGICAL_H);
        if (!this.isTouch) scale = Math.min(scale, 1);
        this.container.style.setProperty('--scale', scale);
        
        // スマホでは画面が縮むぶん、左上のステータスを拡大して読める大きさを保つ
        // （画面上で約 0.6 倍相当になるように。大きすぎるとゲーム画面を隠してしまう）
        const hudScale = this.isTouch ? Math.min(1.6, Math.max(1, 0.6 / scale)) : 1;
        this.container.style.setProperty('--hud-scale', hudScale);
        
        document.body.classList.toggle('portrait', vh > vw);
        this.scale = scale;
    },
    
    // ---------- スティック ----------
    setupStick() {
        const zone = document.getElementById('stick-zone');
        const base = document.getElementById('stick-base');
        const knob = document.getElementById('stick-knob');
        let activeId = null;
        let center = { x: 0, y: 0 };
        let radius = 60;
        
        const moveKnob = (dx, dy) => {
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
        };
        
        const reset = () => {
            activeId = null;
            base.classList.remove('active');
            base.style.left = '';
            base.style.top = '';
            base.style.bottom = '';
            moveKnob(0, 0);
            this.input.setStick(0, 0);
        };
        
        zone.addEventListener('pointerdown', (e) => {
            if (activeId !== null) return;
            activeId = e.pointerId;
            zone.setPointerCapture(e.pointerId);
            
            // 触った場所にスティックを出す
            const size = base.offsetWidth;
            radius = size * 0.42;
            center = { x: e.clientX, y: e.clientY };
            base.style.left = `${e.clientX - size / 2}px`;
            base.style.top = `${e.clientY - size / 2}px`;
            base.style.bottom = 'auto';
            base.classList.add('active');
            moveKnob(0, 0);
            e.preventDefault();
        });
        
        zone.addEventListener('pointermove', (e) => {
            if (e.pointerId !== activeId) return;
            let dx = e.clientX - center.x;
            let dy = e.clientY - center.y;
            const len = Math.hypot(dx, dy);
            if (len > radius) {
                dx = dx / len * radius;
                dy = dy / len * radius;
            }
            moveKnob(dx, dy);
            this.input.setStick(dx / radius, dy / radius);
            e.preventDefault();
        });
        
        const end = (e) => { if (e.pointerId === activeId) reset(); };
        zone.addEventListener('pointerup', end);
        zone.addEventListener('pointercancel', end);
        zone.addEventListener('lostpointercapture', end);
        
        this.resetStick = reset;
    },
    
    // ---------- ボタン ----------
    setupButtons() {
        document.querySelectorAll('#touch-controls .touch-btn').forEach((btn) => {
            const code = btn.dataset.key;
            let pointerId = null;
            
            btn.addEventListener('pointerdown', (e) => {
                pointerId = e.pointerId;
                btn.setPointerCapture(e.pointerId);
                btn.classList.add('pressed');
                this.input.setVirtualKey(code, true);
                if (navigator.vibrate) navigator.vibrate(10); // 対応端末では軽く振動
                e.preventDefault();
            });
            
            const up = (e) => {
                if (e.pointerId !== pointerId) return;
                pointerId = null;
                btn.classList.remove('pressed');
                this.input.setVirtualKey(code, false);
            };
            btn.addEventListener('pointerup', up);
            btn.addEventListener('pointercancel', up);
            btn.addEventListener('lostpointercapture', up);
        });
    },
    
    // ---------- 全画面 ----------
    setupFullscreen() {
        const el = document.documentElement;
        const request = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!request) return; // iPhone の Safari は非対応（ホーム画面に追加すると全画面で起動できる）
        
        document.body.classList.add('can-fullscreen');
        const btn = document.getElementById('fullscreen-btn');
        btn.addEventListener('click', async () => {
            try {
                await request.call(el);
                // 対応端末（主に Android）では横向きに固定
                if (screen.orientation && screen.orientation.lock) {
                    await screen.orientation.lock('landscape').catch(() => {});
                }
            } catch (err) {
                console.warn('全画面にできませんでした:', err);
            }
        });
        
        const onChange = () => {
            const fs = document.fullscreenElement || document.webkitFullscreenElement;
            document.body.classList.toggle('is-fullscreen', !!fs);
            this.fitGame();
        };
        document.addEventListener('fullscreenchange', onChange);
        document.addEventListener('webkitfullscreenchange', onChange);
    }
};

window.TouchControls = TouchControls;
