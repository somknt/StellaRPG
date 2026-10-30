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
    AIM_SLIDE_PX: 16,   // 攻撃・魔法ボタンを押したまま、これ以上指を動かしたら「その向きをねらう」
    TAP_MS: 350,        // スティックの場所で、これより短く押して離したら「タップ」（敵をターゲットにする）
    TAP_MOVE_PX: 14,    // タップの間に指がこれ以上動いたら、スティックの操作とみなす
    
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
        this.loadMagicSkin();
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
        // スマホで文字を入力している間（キーボードが出て画面が小さくなる）は、ゲーム画面の大きさを変えない
        // （小さく縮んで入力欄が読めなくならないように。入力が終わったら screens.js がもう一度呼ぶ）
        if (this.isTouch && document.body.classList.contains('typing') && this.scale) return;
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
        
        // 動かさずに短くタップした時は、画面のタップとして扱う（スティックの場所にいる敵もターゲットにできる）
        let tapStart = null;
        zone.addEventListener('pointerdown', (e) => {
            if (activeId !== null) return;
            activeId = e.pointerId;
            zone.setPointerCapture(e.pointerId);
            tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
            
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
            if (tapStart && len > this.TAP_MOVE_PX) tapStart.moved = true;
            if (len > radius) {
                dx = dx / len * radius;
                dy = dy / len * radius;
            }
            moveKnob(dx, dy);
            this.input.setStick(dx / radius, dy / radius);
            e.preventDefault();
        });
        
        const end = (e) => { if (e.pointerId === activeId) { tapStart = null; reset(); } };
        zone.addEventListener('pointerup', (e) => {
            if (e.pointerId !== activeId) return;
            const tap = tapStart;
            if (tap && !tap.moved && performance.now() - tap.t <= this.TAP_MS) this.input.registerTap(tap.x, tap.y);
            end(e);
        });
        zone.addEventListener('pointercancel', end);
        zone.addEventListener('lostpointercapture', end);
        
        this.resetStick = reset;
    },
    
    // ---------- ボタン ----------
    setupButtons() {
        document.querySelectorAll('#touch-controls .touch-btn[data-key]').forEach((btn) => {
            const code = btn.dataset.key;
            let pointerId = null;
            
            // 攻撃・魔法ボタン：押したまま指をスライドすると、その向きをねらう（input.touchAim）
            //   攻撃：スライドしている間、その向きへ斬り続ける
            //   魔法（砲弾系）：詠唱が終わった時にスライドした向きへ撃つ
            //   魔法（その場系）：長押しでターゲットカーソルが出て、スライドで落とす場所を動かす（game.js の computeCastAim）
            //   普通に押して離しただけなら、自動で敵をねらう
            const aimSource = code === 'Space' ? 'attack' : code === 'KeyQ' ? 'magic' : null;
            let start = null;
            
            btn.addEventListener('pointerdown', (e) => {
                pointerId = e.pointerId;
                btn.setPointerCapture(e.pointerId);
                btn.classList.add('pressed');
                start = { x: e.clientX, y: e.clientY };
                if (aimSource === 'magic') this.input.setTouchHold('magic'); // 長押しの時間を数える
                this.input.setVirtualKey(code, true);
                if (navigator.vibrate) navigator.vibrate(10); // 対応端末では軽く振動
                e.preventDefault();
            });
            
            btn.addEventListener('pointermove', (e) => {
                if (e.pointerId !== pointerId || !aimSource || !start) return;
                const dx = e.clientX - start.x, dy = e.clientY - start.y;
                // 少し動かしただけ（押した時の指のずれ）ではねらわない
                if (Math.hypot(dx, dy) >= this.AIM_SLIDE_PX) {
                    if (!this.input.touchAim.active) btn.classList.add('aiming');
                    this.input.setTouchAim(aimSource, dx, dy);
                }
                e.preventDefault();
            });
            
            const up = (e) => {
                if (e.pointerId !== pointerId) return;
                pointerId = null;
                start = null;
                btn.classList.remove('pressed', 'aiming');
                if (aimSource) this.input.releaseTouchAim(aimSource, aimSource === 'magic' ? 2500 : 0);
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
            // パレットにセットした5つ（空のスロットは null のまま。並び順＝スロット番号）
            const list = p.getMagicSlots ? p.getMagicSlots() : p.learnedMagic.map(id => p.getMagicData(id));
            return { list, current: p.selectedMagicIndex };
        };
        
        // anchorX, anchorY：パレットの中心にしたい画面上の位置（スマホ＝ボタン、PC＝マウスの位置）
        const open = (anchorX, anchorY) => {
            const p = window.game && window.game.player;
            if (!p || p.isChanting) return false; // 詠唱中は選べない
            if (document.body.dataset.state !== 'playing') return false;
            const { list, current } = getMagicList();
            if (!list.some(Boolean)) return false;
            
            palette.classList.add('open');
            this.input.paletteOpen = true;
            // --r / --item は clamp() の式のまま返ってくるので、実際の大きさは要素に当てて測る
            const measure = (v, fallback) => {
                const probe = document.createElement('div');
                probe.style.cssText = `position:absolute;visibility:hidden;width:var(${v})`;
                palette.appendChild(probe);
                const w = probe.offsetWidth;
                probe.remove();
                return w || fallback;
            };
            const r = measure('--r', 80);
            const itemSize = measure('--item', 56);
            
            // パレットが画面からはみ出さないよう、中心を少し内側にずらす
            // （背景の画像がある時は、その画像の半分の大きさぶん）
            const bgEl = document.getElementById('magic-palette-bg');
            const bgHalf = bgEl && bgEl.offsetWidth ? bgEl.offsetWidth / 2 : 0;
            const margin = Math.max(r + itemSize * 0.7, bgHalf);
            center = {
                x: Math.min(Math.max(anchorX, margin), window.innerWidth - margin),
                y: Math.min(Math.max(anchorY, margin), window.innerHeight - margin)
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
                const x = Math.cos(angleOf(i)) * r, y = Math.sin(angleOf(i)) * r;
                const el = document.createElement('div');
                el.style.left = `${x}px`;
                el.style.top = `${y}px`;
                if (!m) {
                    // 空のスロット（魔法をセットしていない）。選べない
                    el.className = 'palette-item empty';
                    itemsBox.appendChild(el);
                    return { el, x, y, index: i, empty: true };
                }
                const info = window.getElementInfo ? window.getElementInfo(m.element) : { color: '#fff', label: m.element };
                el.className = 'palette-item' + (i === current ? ' current' : '');
                el.style.setProperty('--c', info.color);
                // 属性アイコンの画像があれば文字の代わりに出す
                const icon = this.elementIcons && this.elementIcons[info.key];
                el.innerHTML = (icon ? `<img class="ic" src="${icon}" alt="">` : `<span class="el">${info.label}</span>`) +
                    `<span class="nm">${m.name}</span>`;
                itemsBox.appendChild(el);
                return { el, x, y, index: i };
            });
            hoverIndex = -2; // 必ず更新させる
            setHover(-1);
            if (navigator.vibrate) navigator.vibrate(15);
            return true;
        };
        
        const isOpen = () => palette.classList.contains('open');
        
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
            // いちばん近い向きが空のスロットなら「なし」
            const hit = items.find(it => it.index === best);
            return hit && !hit.empty ? best : -1;
        };
        
        const close = (commit) => {
            clearTimeout(timer);
            timer = null;
            if (isOpen() && commit && hoverIndex >= 0) {
                this.input.selectMagic(hoverIndex);
            }
            palette.classList.remove('open');
            this.input.paletteOpen = false;
            this.input.paletteClosedAt = performance.now(); // Esc でパレットを閉じた時に一時停止しないように
            btn.classList.remove('pressed');
            hoverIndex = -1;
            pointerId = null;
            pcOpen = false;
        };
        
        // ===== スマホ：魔法選択ボタンを長押し → スワイプ → 離して決定 =====
        btn.addEventListener('pointerdown', (e) => {
            if (pointerId !== null) return;
            pointerId = e.pointerId;
            btn.setPointerCapture(e.pointerId);
            btn.classList.add('pressed');
            timer = setTimeout(() => {           // 長押しで開く（ボタンの位置を中心に）
                const b = btn.getBoundingClientRect();
                open(b.left + b.width / 2, b.top + b.height / 2);
            }, this.LONG_PRESS_MS);
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
        
        // ===== PC：E キーでマウスの位置にパレット → マウスを動かして合わせる → 決定 =====
        // 決定：E を離す、または左クリック ／ キャンセル：真ん中で E を離す・右クリック・Esc・もう一度 E
        // （E をちょんと押しただけなら開いたままになるので、ゆっくり選んでクリックしてもよい）
        let pcOpen = false;
        let mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        let pcOpenedAt = 0;
        
        window.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse') return;
            mouse = { x: e.clientX, y: e.clientY };
            if (pcOpen) setHover(pick(e.clientX, e.clientY));
        });
        
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Escape' && pcOpen) { close(false); return; }
            if (e.code !== 'KeyE' || e.repeat) return;
            if (pcOpen) { close(false); return; }   // 開いている時にもう一度 E → 閉じる
            if (pointerId !== null) return;          // スマホ側で操作中
            if (open(mouse.x, mouse.y)) {
                pcOpen = true;
                pcOpenedAt = performance.now();
            }
        });
        
        window.addEventListener('keyup', (e) => {
            if (e.code !== 'KeyE' || !pcOpen) return;
            // 長押しして属性を指していたら、E を離した時点で決定
            if (hoverIndex >= 0 && performance.now() - pcOpenedAt > 120) close(true);
        });
        
        // クリックで決定／キャンセル。そのクリックで攻撃・回避しないように消費する
        // （input.js の pointerdown より後に登録しているので、ここで打ち消せる）
        window.addEventListener('pointerdown', (e) => {
            if (!pcOpen || e.pointerType !== 'mouse') return;
            if (e.button === 0) {
                setHover(pick(e.clientX, e.clientY));
                close(true);
            } else {
                close(false);
            }
            this.input.consumeClick();
        });
        
        // ゲーム画面から外れたら閉じる
        window.addEventListener('blur', () => { if (isOpen()) close(false); });
        
        // テスト・デバッグ用
        this.magicPalette = { open, close, pick, isOpen, get hoverIndex() { return hoverIndex; } };
    },
    
    // ---------- 魔法の選択ボタン・パレットの画像 ----------
    // assets/ui/magic_palette/ に画像を置くと、その見た目に切り替わる（置いていない物は今の見た目のまま）
    //   switch_button.png       魔法の選択ボタン（丸い枠ごと）
    //   palette_bg.png          パレットの背景（星の形の代わり）
    //   palette_center.png      パレットの真ん中（指を置く所）
    //   palette_item.png        属性ボタンの枠（ふだん）
    //   palette_item_hover.png  属性ボタンの枠（指が向いている時）
    //   element_fire.png など   属性のアイコン（fire / water / wind / earth / thunder）。ボタンとパレットの両方に出る
    SKIN_DIR: 'assets/ui/magic_palette',
    SKIN_PARTS: {
        'switch': 'switch_button',
        'palette-bg': 'palette_bg',
        'palette-center': 'palette_center',
        'palette-item': 'palette_item',
        'palette-item-hover': 'palette_item_hover'
    },
    
    loadMagicSkin() {
        this.elementIcons = {};   // 読めた属性アイコン（key → 画像のパス）
        const root = document.documentElement;
        for (const [name, file] of Object.entries(this.SKIN_PARTS)) {
            const src = `${this.SKIN_DIR}/${file}.png`;
            const img = new Image();
            img.onload = () => {
                // CSS 変数の中の url() は style.css の場所から探されるので、絶対パスにして渡す
                root.style.setProperty(`--skin-${name}`, `url("${new URL(src, location.href).href}")`);
                document.body.classList.add(`skin-${name}`);
            };
            img.src = src;
        }
        const keys = window.MAGIC_ELEMENTS ? Object.values(window.MAGIC_ELEMENTS).map(e => e.key) : [];
        for (const key of keys) {
            const src = `${this.SKIN_DIR}/element_${key}.png`;
            const img = new Image();
            img.onload = () => {
                this.elementIcons[key] = src;
                if (this.switchKey === key) this.updateSwitchIcon(key);
            };
            img.src = src;
        }
    },
    
    // 魔法の選択ボタンの中身（属性アイコンがあれば画像、なければ「炎」などの文字）。ui.js から呼ぶ
    updateSwitchIcon(key) {
        this.switchKey = key;
        const btn = document.getElementById('btn-magic-switch');
        const icon = document.getElementById('magic-switch-icon');
        if (!btn || !icon) return;
        const src = this.elementIcons && this.elementIcons[key];
        if (src) {
            if (icon.getAttribute('src') !== src) icon.src = src;
            icon.hidden = false;
        } else {
            icon.hidden = true;
        }
        btn.classList.toggle('has-icon', !!src);
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
