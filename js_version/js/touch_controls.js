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
        this.setupMagicPalette();
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
        document.querySelectorAll('#touch-controls .touch-btn[data-key]').forEach((btn) => {
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
    
    // ---------- 魔法パレット ----------
    // 魔法選択ボタンを長押し → ボタンのまわりに星形のパレット（5属性）が出る
    // → 指を離さずにスワイプして選びたい属性の方へ → 指を離すとその魔法に決定
    // 中心付近で離す・短いタップで離すとキャンセル（何も変わらない）
    LONG_PRESS_MS: 250,
    
    setupMagicPalette() {
        const btn = document.getElementById('btn-magic-switch');
        const palette = document.getElementById('magic-palette');
        const itemsBox = document.getElementById('magic-palette-items');
        const starShape = document.getElementById('magic-palette-star-shape');
        if (!btn || !palette) return;
        
        let pointerId = null;
        let timer = null;
        let center = { x: 0, y: 0 };
        let items = [];      // { el, x, y, index }
        let hoverIndex = -1;
        
        // 星の5つの頂点の向き（いちばん上から時計回り）
        const angleOf = (i) => -Math.PI / 2 + i * (Math.PI * 2 / 5);
        
        const getMagicList = () => {
            const p = window.game && window.game.player;
            if (!p) return { list: [], current: -1 };
            return { list: p.learnedMagic.map(id => p.getMagicData(id)).filter(Boolean), current: p.selectedMagicIndex };
        };
        
        const open = () => {
            const p = window.game && window.game.player;
            if (!p || p.isChanting) return; // 詠唱中は選べない
            const { list, current } = getMagicList();
            if (list.length === 0) return;
            
            palette.classList.add('open');
            const r = parseFloat(getComputedStyle(palette).getPropertyValue('--r')) || 80;
            const itemSize = parseFloat(getComputedStyle(palette).getPropertyValue('--item')) || 56;
            
            // パレットが画面からはみ出さないよう、中心を少し内側にずらす
            const margin = r + itemSize * 0.7;
            const b = btn.getBoundingClientRect();
            center = {
                x: Math.min(Math.max(b.left + b.width / 2, margin), window.innerWidth - margin),
                y: Math.min(Math.max(b.top + b.height / 2, margin), window.innerHeight - margin)
            };
            palette.style.transform = `translate(${center.x}px, ${center.y}px)`;
            
            // 星の形（外側の頂点＝属性の位置、内側の頂点はその間）
            const pts = [];
            for (let i = 0; i < 10; i++) {
                const a = -Math.PI / 2 + i * Math.PI / 5;
                const rr = (i % 2 === 0 ? 1 : 0.42) * 100 * 0.8; // viewBox 単位（±100）
                pts.push(`${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`);
            }
            starShape.setAttribute('points', pts.join(' '));
            
            // 属性ボタンを星の頂点に並べる
            itemsBox.innerHTML = '';
            items = list.slice(0, 5).map((m, i) => {
                const info = window.getElementInfo ? window.getElementInfo(m.element) : { color: '#fff', label: m.element };
                const el = document.createElement('div');
                el.className = 'palette-item' + (i === current ? ' current' : '');
                el.style.setProperty('--c', info.color);
                el.innerHTML = `<span class="el">${info.label}</span><span class="nm">${m.name}</span>`;
                const x = Math.cos(angleOf(i)) * r, y = Math.sin(angleOf(i)) * r;
                el.style.left = `${x}px`;
                el.style.top = `${y}px`;
                itemsBox.appendChild(el);
                return { el, x, y, index: i };
            });
            setHover(-1);
            if (navigator.vibrate) navigator.vibrate(15);
        };
        
        const setHover = (i) => {
            if (i === hoverIndex) return;
            hoverIndex = i;
            items.forEach(it => it.el.classList.toggle('hover', it.index === i));
            if (i >= 0 && navigator.vibrate) navigator.vibrate(5);
        };
        
        // 指の位置から、どの属性を指しているか（中心付近は「なし」）
        const pick = (clientX, clientY) => {
            const dx = clientX - center.x, dy = clientY - center.y;
            if (Math.hypot(dx, dy) < 22) return -1;
            let best = -1, bestDot = -Infinity;
            const len = Math.hypot(dx, dy);
            for (const it of items) {
                const d = (dx * it.x + dy * it.y) / (len * Math.hypot(it.x, it.y)); // 向きの近さ
                if (d > bestDot) { bestDot = d; best = it.index; }
            }
            return best;
        };
        
        const close = (commit) => {
            clearTimeout(timer);
            timer = null;
            if (palette.classList.contains('open') && commit && hoverIndex >= 0) {
                this.input.selectMagic(hoverIndex);
            }
            palette.classList.remove('open');
            btn.classList.remove('pressed');
            hoverIndex = -1;
            pointerId = null;
        };
        
        btn.addEventListener('pointerdown', (e) => {
            if (pointerId !== null) return;
            pointerId = e.pointerId;
            btn.setPointerCapture(e.pointerId);
            btn.classList.add('pressed');
            timer = setTimeout(open, this.LONG_PRESS_MS); // 長押しで開く
            e.preventDefault();
        });
        
        btn.addEventListener('pointermove', (e) => {
            if (e.pointerId !== pointerId || !palette.classList.contains('open')) return;
            setHover(pick(e.clientX, e.clientY));
            e.preventDefault();
        });
        
        btn.addEventListener('pointerup', (e) => { if (e.pointerId === pointerId) close(true); });
        btn.addEventListener('pointercancel', (e) => { if (e.pointerId === pointerId) close(false); });
        btn.addEventListener('lostpointercapture', (e) => { if (e.pointerId === pointerId) close(false); });
        
        // テスト・デバッグ用
        this.magicPalette = { open, close, pick, get hoverIndex() { return hoverIndex; } };
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
