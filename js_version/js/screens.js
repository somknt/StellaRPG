// 画面の切り替え（タイトル → メインメニュー → バトルモード → モンスター選択（→ マイベスト）→ 主人公選択 → ボス戦）
//
// - 各画面は index.html の #screens の中の .screen（HTML）。背景はキャンバスに描く
// - 画面を切り替える時は、黒くフェードアウト → 切り替え → フェードイン
//   切り替えの途中は入力を受け付けない（連続で押しても二重に進まない）
// - キーボード：上下左右で選ぶ / Enter で決定 / Esc で戻る。マウス・タップはボタンを直接押す

// ---------- キーボードで項目を選ぶ仕組み（メニュー・結果画面で共通） ----------
// data-nav のついた要素を順番に選ぶ。data-adjust のついた項目（音量など）は左右で値を変える
class UINav {
    constructor(container, mode = 'vertical') {
        this.container = container;
        this.mode = mode; // 'vertical'（上下で移動） / 'horizontal'（左右で移動） / 'grid'（どちらでも）
        this.items = container ? [...container.querySelectorAll('[data-nav]')] : [];
        this.index = Math.max(0, this.items.findIndex(el => el.classList.contains('focused')));
        if (this.index < 0 || !this.items.length) this.index = 0;
        // 押せない項目は飛ばす
        if (this.items[this.index] && this.isSkip(this.items[this.index])) this.move(1);
        // マウスを重ねた項目を選ぶ（同じ要素に何度も登録しないよう、今の UINav を要素に覚えさせる）
        for (const el of this.items) {
            el._nav = this;
            if (el._navBound) continue;
            el._navBound = true;
            el.addEventListener('pointerenter', (e) => {
                const nav = el._nav;
                if (!nav || e.pointerType !== 'mouse' || nav.isSkip(el)) return;
                const i = nav.items.indexOf(el);
                // 画面が切りかわった直後は、マウスの下に新しいボタンが来ただけなので鳴らさない
                if (i !== nav.index && performance.now() > UINav.quietUntil) playSE('ui_move');
                nav.setIndex(i);
            });
            // 入力欄をクリック・タップした時も、そこを選んでいることにする
            el.addEventListener('focus', () => {
                const nav = el._nav;
                if (nav) nav.setIndex(nav.items.indexOf(el));
            });
        }
        this.refresh();
    }
    
    isSkip(el) { return el.disabled || el.dataset.navSkip !== undefined; }
    get current() { return this.items[this.index] || null; }
    
    setIndex(i) {
        this.index = i;
        this.refresh();
    }
    
    move(step) {
        const n = this.items.length;
        if (!n) return;
        for (let k = 1; k <= n; k++) {
            const i = (this.index + step * k + n * 10) % n;
            if (!this.isSkip(this.items[i])) { this.setIndex(i); return; }
        }
    }
    
    refresh() {
        this.items.forEach((el, i) => el.classList.toggle('focused', i === this.index));
    }
    
    handle(input) {
        const k = (c) => input.isKeyPressed(c);
        const up = k('ArrowUp') || k('KeyW'), down = k('ArrowDown') || k('KeyS');
        const left = k('ArrowLeft') || k('KeyA'), right = k('ArrowRight') || k('KeyD');
        const cur = this.current;
        // 音量・ON/OFF の項目は左右で値を変える
        if (cur && cur.dataset.adjust !== undefined && (left || right)) {
            cur.dispatchEvent(new CustomEvent('adjust', { detail: right ? 1 : -1 }));
            // 確かめの音（data-sample）がある項目は、その音が新しい音量で鳴る。ない項目はカーソルの音
            if (cur.dataset.sample === undefined) playSE('ui_move');
            return;
        }
        const before = this.index;
        if (this.mode !== 'horizontal' && (up || down)) this.move(up ? -1 : 1);
        if (this.mode !== 'vertical' && (left || right)) this.move(left ? -1 : 1);
        if (this.index !== before) playSE('ui_move');
        if ((k('Enter') || k('Space')) && cur && !this.isSkip(cur)) {
            // 入力欄は、押すと文字を入力できるようにする（もう一度 Enter で決定、Esc で入力をやめる）
            if (InputManager.isTyping(cur)) { cur.focus(); return; }
            pressEffect(cur);
            cur.click();
        }
    }
}

// この時間まではマウスを重ねてもカーソル移動の音を鳴らさない（画面の切りかえ直後）
UINav.quietUntil = 0;

// 決定した時の軽い発光
function pressEffect(el) {
    el.classList.remove('pressed');
    void el.offsetWidth;
    el.classList.add('pressed');
}

// ---------- タイトル・メニューの背景 ----------
// 背景の絵（assets/ui/title_bg_sky_castle.png）の上に、動く素材（assets/ui/title/）を重ねる
//   雲が流れる・月が光る・星がまたたく・流れ星・ロゴがふわっと光る
//   風にマントがなびく主人公（assets/ui/title/hero_01〜40.png）
//   右から左へ舞う花びらと葉っぱ（マントのなびく向きと同じ風）、ふわふわ上る光の粒
// 背景の絵が読めない間は、コードで描いた仮の背景を出す
//
// 位置はすべて「背景の絵の上の座標（1672×941）」で決めて、画面の大きさに合わせて縮める
class TitleBackground {
    constructor() {
        const load = (src) => {
            const img = new Image();
            img.src = src;
            return img;
        };
        const T = TitleBackground.DIR;
        this.image = null;
        const bg = new Image();
        bg.onload = () => { this.image = bg; };
        bg.src = TitleBackground.IMAGE_PATH;
        this.img = {};
        for (const n of ['logo', 'cloud_far', 'cloud_middle', ...Object.keys(window.TITLE_ATLAS || {})]) {
            this.img[n] = load(`${T}/${n}.png`);
        }
        this.hero = [];
        for (let i = 1; i <= TitleBackground.HERO_FRAMES; i++) {
            this.hero.push(load(`${T}/hero_${String(i).padStart(2, '0')}.png`));
        }
        this.placeholder = null;
        
        // 決まった乱数（毎回同じ星の並びにする）
        let seed = 11;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        this.rnd = rnd;
        
        // またたく星：空の上のほう（ロゴの真ん中はさける）
        this.stars = [];
        for (let i = 0; i < 26; i++) {
            let x, y;
            do { x = rnd() * 1672; y = 10 + rnd() * 330; } while (x > 540 && x < 1270 && y > 50 && y < 510);
            const kind = rnd() < 0.35 ? 'stars_glow' : 'stars_small';
            this.stars.push({ x, y, kind, piece: Math.floor(rnd() * 100), phase: rnd() * Math.PI * 2, speed: 0.8 + rnd() * 1.8, scale: 0.5 + rnd() * 0.6 });
        }
        // ロゴのまわりのきらめき
        this.logoSparkles = [];
        for (let i = 0; i < 7; i++) {
            this.logoSparkles.push({ x: 580 + rnd() * 640, y: 90 + rnd() * 380, piece: Math.floor(rnd() * 100), phase: rnd() * 6, speed: 1 + rnd() * 1.5, scale: 0.35 + rnd() * 0.4 });
        }
        // 舞う花びら・葉っぱ（画面全体）
        this.flyers = [];
        for (let i = 0; i < 26; i++) this.flyers.push(this.newFlyer(true));
        // 足元から上る光の粒
        this.motes = [];
        for (let i = 0; i < 18; i++) this.motes.push(this.newMote(true));
        this.shooting = [];
        this.nextShoot = 2;
        this.logoTime = 0;
    }
    
    get hasImage() { return !!this.image; }
    
    // 素材の一部分（TITLE_ATLAS の四角）
    piece(kind, n) {
        const list = (window.TITLE_ATLAS || {})[kind];
        if (!list || !list.length) return null;
        return list[n % list.length];
    }
    
    newFlyer(anywhere) {
        const r = this.rnd;
        // 奥（小さく・ゆっくり・うすい）〜 手前（大きく・速い）
        const depth = r() < 0.55 ? 0 : r() < 0.75 ? 1 : 2;
        const leaf = r() < 0.3;
        // 手前の花びらはぼやけた素材なので、真ん中の花びらを大きくして使う
        const kind = (leaf ? 'leaves_' : 'petals_') + (leaf ? ['far', 'mid', 'near'] : ['far', 'mid', 'mid'])[depth];
        return {
            kind, piece: Math.floor(r() * 100), depth,
            x: anywhere ? r() * 1900 - 100 : 1700 + r() * 300,
            y: anywhere ? r() * 941 : -60 + r() * 700,
            vx: -(50 + depth * 55 + r() * 40),
            vy: 14 + depth * 10 + r() * 18,
            sway: r() * Math.PI * 2, swaySpeed: 1 + r() * 1.5,
            rot: r() * Math.PI * 2, spin: (r() - 0.5) * 3,
            scale: [0.55, 0.75, leaf ? 0.9 : 1.15][depth] * (0.75 + r() * 0.4),
            alpha: [0.65, 0.85, 0.6][depth]
        };
    }
    
    newMote(anywhere) {
        const r = this.rnd;
        return {
            piece: Math.floor(r() * 100),
            x: 40 + r() * 760,
            y: anywhere ? 520 + r() * 420 : 900 + r() * 60,
            vy: -(10 + r() * 18),
            phase: r() * 6,
            life: 0, maxLife: 5 + r() * 5,
            scale: 0.25 + r() * 0.35
        };
    }
    
    update(dt) {
        this.logoTime += dt;
        for (const f of this.flyers) {
            f.sway += dt * f.swaySpeed;
            f.x += (f.vx + Math.sin(f.sway * 0.7) * 12) * dt;
            f.y += (f.vy + Math.sin(f.sway) * 22) * dt;
            f.rot += f.spin * dt;
        }
        this.flyers = this.flyers.map(f => (f.x < -150 || f.y > 1050) ? this.newFlyer(false) : f);
        for (const m of this.motes) {
            m.life += dt;
            m.y += m.vy * dt;
            m.x += Math.sin(m.life * 1.3 + m.phase) * 8 * dt;
        }
        this.motes = this.motes.map(m => m.life > m.maxLife ? this.newMote(false) : m);
        
        this.nextShoot -= dt;
        if (this.nextShoot <= 0) {
            this.nextShoot = 3 + Math.random() * 5;
            this.shooting.push({ x: 900 + Math.random() * 700, y: 10 + Math.random() * 120, age: 0, life: 1.1, piece: Math.floor(Math.random() * 100) });
        }
        for (const s of this.shooting) s.age += dt;
        this.shooting = this.shooting.filter(s => s.age < s.life);
    }
    
    // 素材の一部分を、中心 (x, y) に描く
    drawPiece(ctx, kind, n, x, y, scale, rot = 0) {
        const img = this.img[kind];
        const p = this.piece(kind, n);
        if (!img || !img.complete || !img.naturalWidth || !p) return;
        const [sx, sy, sw, sh] = p;
        ctx.save();
        ctx.translate(x, y);
        if (rot) ctx.rotate(rot);
        ctx.drawImage(img, sx, sy, sw, sh, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale);
        ctx.restore();
    }
    
    ready(img) { return img && img.complete && img.naturalWidth > 0; }
    
    draw(ctx, time, dim = 0) {
        const W = ctx.canvas.width, H = ctx.canvas.height;
        if (!this.image) {
            if (!this.placeholder) this.placeholder = TitleBackground.renderPlaceholder(W, H);
            ctx.drawImage(this.placeholder, 0, 0);
            this.drawDim(ctx, W, H, dim);
            return;
        }
        const img = this.image;
        const AW = img.width, AH = img.height;
        // 後ろ：画面いっぱい（少し暗く）／前：絵全体が入る大きさ（重要な部分が切れないように）
        const cover = Math.max(W / AW, H / AH);
        const s = Math.min(W / AW, H / AH);
        const ox = (W - AW * s) / 2, oy = (H - AH * s) / 2;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        if (cover !== s) {
            ctx.globalAlpha = 0.5;
            ctx.drawImage(img, (W - AW * cover) / 2, (H - AH * cover) / 2, AW * cover, AH * cover);
            ctx.globalAlpha = 1;
        }
        // ここから先は「背景の絵の座標」で描く
        ctx.translate(ox, oy);
        ctx.scale(s, s);
        ctx.beginPath(); ctx.rect(0, 0, AW, AH); ctx.clip();
        ctx.drawImage(img, 0, 0, AW, AH);
        
        this.drawSky(ctx, time, AW);
        // ロゴはタイトル画面だけ（メニューでは文字の邪魔になるので出さない）
        if (dim === 0) this.drawLogo(ctx, time);
        this.drawHero(ctx, time);
        this.drawMotes(ctx);
        this.drawFlyers(ctx);
        ctx.restore();
        this.drawDim(ctx, W, H, dim);
    }
    
    drawDim(ctx, W, H, dim) {
        // メニュー画面では、背景を暗くして文字を見やすくする
        if (dim <= 0) return;
        ctx.save();
        ctx.fillStyle = `rgba(6, 8, 24, ${dim})`;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }
    
    // 雲・月の光・星・流れ星
    drawSky(ctx, time, AW) {
        // 流れる雲（右から左へ。端まで行ったら反対側から出てくる）
        const clouds = [
            { n: 'cloud_middle', y: 330, scale: 1.4,  speed: 9,  alpha: 0.3 },
            { n: 'cloud_far',    y: 420, scale: 1.25, speed: 15, alpha: 0.35 }
        ];
        for (const c of clouds) {
            const im = this.img[c.n];
            if (!this.ready(im)) continue;
            const w = im.width * c.scale, h = im.height * c.scale;
            const span = AW + w;
            ctx.globalAlpha = c.alpha;
            for (let k = 0; k < 2; k++) {
                const x = AW - (((time * c.speed) + k * span / 2) % span);
                ctx.drawImage(im, x, c.y - h / 2, w, h);
            }
        }
        ctx.globalAlpha = 1;
        
        // 二つの月がゆっくり光る
        ctx.globalCompositeOperation = 'lighter';
        const moons = [[420, 195, 120, 0], [518, 118, 80, 1.7]];
        for (const [x, y, r, ph] of moons) {
            const a = 0.1 + (Math.sin(time * 0.9 + ph) * 0.5 + 0.5) * 0.12;
            const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, r);
            g.addColorStop(0, `rgba(255, 230, 170, ${a})`);
            g.addColorStop(1, 'rgba(255, 230, 170, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        // またたく星
        for (const st of this.stars) {
            const a = Math.sin(time * st.speed + st.phase) * 0.5 + 0.5;
            if (a < 0.08) continue;
            ctx.globalAlpha = a;
            this.drawPiece(ctx, st.kind, st.piece, st.x, st.y, st.scale * (0.8 + a * 0.3));
        }
        // 流れ星（右上から左下へ。光の尾＋先の輝き）
        for (const sh of this.shooting) {
            const t = sh.age / sh.life;
            const x = sh.x - t * 300, y = sh.y + t * 190;
            const tx = x + 150, ty = y - 95;
            const g = ctx.createLinearGradient(x, y, tx, ty);
            g.addColorStop(0, 'rgba(255, 245, 220, 0.95)');
            g.addColorStop(0.3, 'rgba(255, 190, 150, 0.5)');
            g.addColorStop(1, 'rgba(200, 160, 255, 0)');
            ctx.globalAlpha = Math.sin(t * Math.PI);
            ctx.strokeStyle = g;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
            this.drawPiece(ctx, 'stars_glow', 3, x, y, 0.55);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }
    
    // ロゴ：最初にふわっと出てきて、そのあとはゆっくり上下しながら光る
    drawLogo(ctx, time) {
        const im = this.img.logo;
        if (!this.ready(im)) return;
        const t = this.logoTime;
        const appear = Math.min(1, t / 1.4);
        const ease = 1 - Math.pow(1 - appear, 3);
        const w = 760, h = im.height * (w / im.width);
        const cx = 900, cy = 290 + Math.sin(time * 1.1) * 5 + (1 - ease) * 20;
        ctx.globalAlpha = ease;
        ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
        // 光の脈（同じロゴを明るく重ねる）
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = ease * (0.12 + (Math.sin(time * 1.6) * 0.5 + 0.5) * 0.18);
        ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
        // まわりのきらめき
        for (const sp of this.logoSparkles) {
            const a = Math.max(0, Math.sin(time * sp.speed + sp.phase));
            if (a < 0.05) continue;
            ctx.globalAlpha = ease * a;
            this.drawPiece(ctx, 'sparkles', sp.piece, sp.x, sp.y + Math.sin(time * 1.1) * 5, sp.scale * (0.6 + a * 0.5));
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }
    
    // 崖の上に座る主人公
    //   体と頭は全コマ同じ位置（軸がぶれない）。マントだけが風でなびく
    //   ゆっくり息をするように、お尻を軸にほんの少しだけ縦にのびちぢみする
    drawHero(ctx, time) {
        const n = this.hero.length;
        const frame = this.hero[Math.floor(time * TitleBackground.HERO_FPS) % n];
        if (!this.ready(frame)) return;
        const H = TitleBackground.HERO;
        const breath = Math.sin(time * 1.6) * 0.006;
        ctx.save();
        ctx.translate(H.x + H.size / 2, H.y + H.size);
        ctx.scale(1, 1 + breath);
        ctx.drawImage(frame, -H.size / 2, -H.size, H.size, H.size);
        ctx.restore();
    }
    
    drawMotes(ctx) {
        ctx.globalCompositeOperation = 'lighter';
        for (const m of this.motes) {
            const a = Math.sin(Math.min(1, m.life / m.maxLife) * Math.PI);
            ctx.globalAlpha = a * 0.8;
            this.drawPiece(ctx, 'particles', m.piece, m.x, m.y, m.scale);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }
    
    drawFlyers(ctx) {
        for (const f of this.flyers) {
            ctx.globalAlpha = f.alpha;
            this.drawPiece(ctx, f.kind, f.piece, f.x, f.y, f.scale, f.rot);
        }
        ctx.globalAlpha = 1;
    }
    
    // 仮の背景（タイトルイラストが届くまで）。一度だけ描いて使い回す
    static renderPlaceholder(W, H) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        // 空：夜 → 夕暮れ
        const sky = g.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#070b26');
        sky.addColorStop(0.35, '#1f1d52');
        sky.addColorStop(0.58, '#5a3a72');
        sky.addColorStop(0.72, '#c9706a');
        sky.addColorStop(0.8, '#f2a86a');
        g.fillStyle = sky;
        g.fillRect(0, 0, W, H);
        // 星
        let seed = 7;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 260; i++) {
            const y = rnd() * H * 0.62;
            g.globalAlpha = (0.3 + rnd() * 0.7) * (1 - y / (H * 0.7));
            g.fillStyle = '#fff8e0';
            const s = rnd() < 0.9 ? 1 : 2;
            g.fillRect(Math.floor(rnd() * W), Math.floor(y), s, s);
        }
        g.globalAlpha = 1;
        // 二つの月（大きな三日月と小さな満月が斜めに並ぶ）
        const moon = (x, y, r, crescent) => {
            const m = document.createElement('canvas');
            m.width = m.height = r * 6;
            const k = m.getContext('2d');
            const glow = k.createRadialGradient(r * 3, r * 3, r * 0.8, r * 3, r * 3, r * 3);
            glow.addColorStop(0, 'rgba(255, 240, 200, 0.35)');
            glow.addColorStop(1, 'rgba(255, 240, 200, 0)');
            k.fillStyle = glow;
            k.fillRect(0, 0, m.width, m.height);
            // 月の本体は別の絵に描いて、三日月の形に切り抜いてから光の上に重ねる
            const body = document.createElement('canvas');
            body.width = body.height = r * 6;
            const b = body.getContext('2d');
            b.fillStyle = '#fff1c8';
            b.beginPath(); b.arc(r * 3, r * 3, r, 0, Math.PI * 2); b.fill();
            if (crescent) {
                b.globalCompositeOperation = 'destination-out';
                b.beginPath(); b.arc(r * 3 + r * 0.45, r * 3 - r * 0.3, r * 0.9, 0, Math.PI * 2); b.fill();
            }
            k.drawImage(body, 0, 0);
            g.drawImage(m, x - r * 3, y - r * 3);
        };
        moon(960, 150, 78, true);
        moon(1130, 300, 26, false);
        // 遠くの山
        g.fillStyle = '#3b2c5c';
        g.beginPath(); g.moveTo(0, H * 0.66);
        for (let x = 0; x <= W; x += 40) g.lineTo(x, H * 0.66 - Math.sin(x * 0.006) * 30 - Math.sin(x * 0.017) * 12);
        g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
        // 王都（右奥の城と街の灯り）
        g.fillStyle = '#2a2047';
        const cityX = 820, cityY = H * 0.66;
        const towers = [[0, 40, 26], [30, 70, 18], [52, 110, 22], [80, 150, 30], [116, 95, 20], [140, 60, 26], [170, 40, 34], [210, 28, 40]];
        for (const [dx, h, w] of towers) {
            g.fillRect(cityX + dx, cityY - h, w, h + 4);
            g.beginPath(); g.moveTo(cityX + dx - 3, cityY - h); g.lineTo(cityX + dx + w / 2, cityY - h - w * 0.9); g.lineTo(cityX + dx + w + 3, cityY - h); g.fill();
        }
        g.fillStyle = '#ffd27a';
        for (let i = 0; i < 26; i++) g.fillRect(cityX + 4 + rnd() * 230, cityY - 8 - rnd() * 90, 2, 3);
        // 草原（手前の丘）
        const hill = g.createLinearGradient(0, H * 0.7, 0, H);
        hill.addColorStop(0, '#2c4a3a');
        hill.addColorStop(1, '#14241d');
        g.fillStyle = hill;
        g.beginPath(); g.moveTo(0, H * 0.74);
        for (let x = 0; x <= W; x += 30) g.lineTo(x, H * 0.74 + Math.sin(x * 0.004 + 1) * 18);
        g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
        // 崖（左手前）と草
        g.fillStyle = '#1b2f24';
        g.beginPath();
        g.moveTo(0, H * 0.76); g.lineTo(380, H * 0.74); g.lineTo(470, H * 0.76); g.lineTo(500, H * 0.82); g.lineTo(480, H); g.lineTo(0, H); g.closePath(); g.fill();
        g.fillStyle = '#0f1c15';
        g.beginPath(); g.moveTo(470, H * 0.76); g.lineTo(500, H * 0.82); g.lineTo(480, H); g.lineTo(440, H); g.lineTo(460, H * 0.85); g.closePath(); g.fill();
        g.fillStyle = '#3d6b4a';
        for (let i = 0; i < 70; i++) {
            const x = rnd() * 470, y = H * 0.745 + rnd() * 10;
            g.fillRect(Math.floor(x), Math.floor(y - 6 - rnd() * 6), 2, 8);
        }
        // 景色を眺める主人公（後ろ姿のシルエット）
        const hx = 400, hy = H * 0.742;
        g.fillStyle = '#0c1410';
        g.beginPath(); g.ellipse(hx, hy - 46, 11, 12, 0, 0, Math.PI * 2); g.fill();          // 頭
        g.beginPath(); g.moveTo(hx - 14, hy - 36); g.lineTo(hx + 14, hy - 36); g.lineTo(hx + 20, hy - 6); g.lineTo(hx - 20, hy - 6); g.closePath(); g.fill(); // マント
        g.fillRect(hx - 9, hy - 8, 6, 10); g.fillRect(hx + 3, hy - 8, 6, 10);                  // 脚
        // ロゴ（仮）
        g.textAlign = 'center';
        g.font = 'bold 120px "DotGothic16", "Hiragino Mincho ProN", "Yu Mincho", serif';
        g.shadowColor = 'rgba(255, 200, 90, 0.8)';
        g.shadowBlur = 28;
        const logo = g.createLinearGradient(0, 120, 0, 250);
        logo.addColorStop(0, '#fff5c8');
        logo.addColorStop(0.5, '#ffd36a');
        logo.addColorStop(1, '#d68a2a');
        g.fillStyle = logo;
        g.fillText('星の子', 420, 230);
        g.shadowBlur = 0;
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(90, 40, 10, 0.8)';
        g.strokeText('星の子', 420, 230);
        g.font = 'bold 26px "DotGothic16", sans-serif';
        g.fillStyle = '#ffe9b0';
        g.fillText('～ Hoshi no Ko ～', 420, 278);
        return c;
    }
}
TitleBackground.IMAGE_PATH = 'assets/ui/title_bg_sky_castle.png';
TitleBackground.DIR = 'assets/ui/title';
// 主人公のコマ（assets/ui/title/hero_01〜40.png。hero_wind_01.png をもとに、マントだけを動かして作ったもの）
TitleBackground.HERO_FRAMES = 40;
TitleBackground.HERO_FPS = 12;
// 主人公の位置（背景の絵の座標。title_full_twilight.png の配置に合わせる）
TitleBackground.HERO = { x: 307, y: 500, size: 197 };

// ---------- 画面の管理 ----------
class ScreenManager {
    constructor(game) {
        this.game = game;
        this.root = document.getElementById('screens');
        this.fadeEl = document.getElementById('screen-fade');
        this.toastEl = document.getElementById('screen-toast');
        this.current = null;
        this.busy = false;
        this.time = 0;
        this.nav = null;
        this.selectedBoss = null;
        this.selectedHero = 'male';   // プレイヤー登録の画面で選んでいる主人公
        this.accountTab = 'create';   // アカウントの画面：'create'（はじめて遊ぶ）/ 'login'
        this.profileFrom = null;      // プレイヤー登録をどこから開いたか（'account_info' なら戻れる。はじめての時は戻れない）
        this.equip = null;            // 装備画面で変えている装備（Account.loadout のコピー）
        this.equipSlot = -1;          // 装備画面：次に魔法を入れる枠（-1 なら空いている最初の枠）
        this.bg = new TitleBackground();
        // URL に ?mode=free を付けると、モンスター選択をとばして前のフリーバトル（スライム・ウサギ）で遊べる
        this.freeBattle = new URLSearchParams(window.location.search).get('mode') === 'free';
        this.buildMonsterCards();
        this.buildHeroCards();
        this.buildSettings();
        this.bindButtons();
        this.bindAccountForms();
        this.setupTyping();
        // 通信が切れた・つながった時に、出している画面の「オンライン / オフライン」を書き直す
        if (window.Account) Account.onChange(() => {
            if (this.current === 'main_menu') this.refreshMenuUser();
            if (this.current === 'account_info') { const m = this.$('ai-mode'); if (m) m.textContent = Account.storageLabel(); }
        });
    }
    
    $(id) { return document.getElementById(id); }
    
    // 画面の名前 → HTML と、キーボードの動かし方
    // 流れ：タイトル →（ログインしていなければ）アカウント →（名前が決まっていなければ）プレイヤー登録 → メインメニュー
    //       バトルモード → ソロプレイ → モンスター選択 → 装備 → バトル
    static SCREENS = {
        title:          { id: 'scr-title',    nav: null,       bgm: 'bgm_title' },
        account:        { id: 'scr-account',  nav: 'vertical', back: 'title',          bgm: 'bgm_title' },
        profile:        { id: 'scr-profile',  nav: 'grid',                             bgm: 'bgm_title' },
        main_menu:      { id: 'scr-menu',     nav: 'vertical', back: 'title',          bgm: 'bgm_title' },
        account_info:   { id: 'scr-accinfo',  nav: 'vertical', back: 'main_menu',      bgm: 'bgm_title' },
        story:          { id: 'scr-story',    nav: 'vertical', back: 'main_menu',      bgm: 'bgm_title' },
        battle_select:  { id: 'scr-battle',   nav: 'vertical', back: 'main_menu',      bgm: 'bgm_title' },
        monster_select: { id: 'scr-monster',  nav: 'grid',     back: 'battle_select',  bgm: 'bgm_select' },
        ranking:        { id: 'scr-ranking',  nav: 'grid',     back: 'monster_select', bgm: 'bgm_select' },
        equip:          { id: 'scr-equip',    nav: 'grid',     back: 'monster_select', bgm: 'bgm_select' },
        settings:       { id: 'scr-settings', nav: 'vertical', back: 'main_menu',      bgm: 'bgm_title' }
    };
    
    isMenuState(state) { return state in ScreenManager.SCREENS; }
    
    // ---------- 切り替え ----------
    // フェードアウト → fn() → フェードイン。途中の入力は受け付けない
    transition(fn) {
        if (this.busy) return false;
        this.busy = true;
        this.fadeEl.classList.add('on');
        setTimeout(() => {
            try { fn(); } catch (e) { console.error('画面切り替えエラー:', e); }
            this.game.input.resetAll();
            requestAnimationFrame(() => {
                this.fadeEl.classList.remove('on');
                setTimeout(() => { this.busy = false; }, ScreenManager.FADE_MS);
            });
        }, ScreenManager.FADE_MS);
        return true;
    }
    
    go(name) {
        return this.transition(() => this.setScreen(name));
    }
    
    setScreen(name) {
        const def = ScreenManager.SCREENS[name];
        for (const el of this.root.querySelectorAll('.screen')) el.classList.toggle('active', el.id === def.id);
        if (this.toastEl) this.toastEl.classList.remove('show');
        this.root.classList.add('open');
        const prev = this.current;
        this.current = name;
        this.game.gameState = name;
        const el = this.$(def.id);
        if (document.activeElement && InputManager.isTyping(document.activeElement)) document.activeElement.blur();
        if (name === 'title') this.bg.logoTime = 0; // ロゴの登場をもう一度
        if (name === 'account') this.enterAccount();
        if (name === 'profile') this.enterProfile();
        if (name === 'main_menu') this.refreshMenuUser();
        if (name === 'account_info') this.enterAccountInfo();
        if (name === 'equip') this.enterEquip();
        if (name === 'monster_select') this.enterMonster(prev);
        if (name === 'ranking') this.enterRanking();
        if (name === 'settings') this.refreshSettings();
        // 最初の項目を選んだ状態にする（戻ってきた時は前に選んでいた所）
        UINav.quietUntil = performance.now() + ScreenManager.FADE_MS + 400;
        this.nav = def.nav ? new UINav(el, def.nav) : null;
        // 画面の BGM（同じ曲なら途切れずに続く）
        if (def.bgm) playBGM(def.bgm);
    }
    
    // バトルが始まったら画面を閉じる
    hideAll() {
        this.root.classList.remove('open');
        for (const el of this.root.querySelectorAll('.screen')) el.classList.remove('active');
        this.current = null;
        this.nav = null;
    }
    
    // 今の画面の「戻る」の行き先（なければ null）
    backTarget() {
        if (this.current === 'profile') return this.profileFrom === 'account_info' ? 'account_info' : null;
        if (this.current === 'equip' && this.freeBattle) return 'battle_select';
        const def = ScreenManager.SCREENS[this.current];
        return def && def.back ? def.back : null;
    }
    
    back() {
        const to = this.backTarget();
        if (to) this.go(to);
    }
    
    toast(text) {
        const t = this.toastEl;
        if (!t) return;
        t.textContent = text;
        t.classList.remove('show');
        void t.offsetWidth;
        t.classList.add('show');
    }
    
    // ---------- 毎フレーム ----------
    update(dt, input) {
        this.time += dt;
        this.bg.update(dt);
        if (this.current === 'monster_select') this.drawMonsterArt(dt);
        if (this.current === 'profile') this.drawHeroArt(dt);
        if (this.current === 'equip') this.drawEquipArt(dt);
        if (this.busy || !this.current) return;
        if (this.current === 'title') {
            if (input.isKeyPressed('Enter') || input.isKeyPressed('Space')) this.startFromTitle();
            return;
        }
        if (input.isKeyPressed('Escape') || input.isKeyPressed('Backspace')) {
            if (this.backTarget()) playSE('ui_cancel');
            this.back();
            return;
        }
        if (this.nav) this.nav.handle(input);
        // マイベスト：キーボード（←→）やマウスを重ねてモンスターの札を選んだら、そのモンスターの記録に切りかえる
        // 選んでいる札が変わった時だけ切りかえる（スマホでタップした札を、前に選んでいた札に戻さないように）
        if (this.current === 'ranking' && this.nav && this.nav.index !== this.rankingNavIndex) {
            this.rankingNavIndex = this.nav.index;
            const cur = this.nav.current;
            if (cur && cur.dataset.boss && cur.dataset.boss !== this.rankingBoss) this.showRanking(cur.dataset.boss);
        }
    }
    
    draw(ctx) {
        const dim = this.current === 'title' ? 0 : this.current === 'main_menu' ? 0.45 : 0.62;
        this.bg.draw(ctx, this.time, dim);
    }
    
    // タイトルで決定：ログインしていればメインメニュー（名前がまだならプレイヤー登録）、していなければアカウントの画面
    // 起動した時の自動ログインが終わっていなければ、終わるまで待つ
    async startFromTitle() {
        if (this.current !== 'title' || this.busy || this._starting) return;
        playSE('ui_start');
        const A = window.Account;
        if (A && !A.ready) {
            this._starting = true;
            this.toast('アカウントを確かめています…');
            await A.whenReady();
            this._starting = false;
            if (this.current !== 'title') return;
        }
        this.go(this.afterLoginScreen());
    }
    
    // ログインの後に行く画面
    afterLoginScreen() {
        const A = window.Account;
        if (!A) return 'main_menu';
        if (!A.loggedIn) return 'account';
        if (!A.hasProfile()) { this.profileFrom = null; return 'profile'; }
        return 'main_menu';
    }
    
    // ---------- ボタン ----------
    bindButtons() {
        const on = (id, fn) => {
            const el = this.$(id);
            if (el) el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (!this.busy) { pressEffect(el); fn(el); } });
        };
        // タイトル：画面のどこをクリック・タップしても進む
        this.$('scr-title').addEventListener('click', () => this.startFromTitle());
        
        // ボタンの音（メニュー・一時停止・結果画面のボタン全部）：戻るボタンは「戻る」、押せないボタンは「選べない」、ほかは「決定」
        // （モンスターのカードは chooseMonster、一時停止のボタンは game.togglePause で鳴らす）
        document.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('.ui-btn');
            if (!b || b.closest('#touch-controls') || b.classList.contains('boss-card')) return;
            // 自分で音を決めるボタン（アカウントの送信：成功・失敗の音 / 装備画面の枠・魔法・装備：つけ外し・装備できない音）
            if (b.type === 'submit' || b.closest('#scr-equip .equip-wrap')) return;
            if (b.id === 'pause-btn' || b.id === 'pause-resume' || b.id === 'fullscreen-btn') return;
            if (this.busy && b.closest('#screens')) return; // 画面の切り替え中（押しても進まない）
            const disabled = b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('disabled');
            const back = b.classList.contains('back') || /-back$/.test(b.id);
            playSE(disabled ? 'ui_error' : back ? 'ui_cancel' : 'ui_select');
        }, true);
        
        on('menu-story', () => this.go('story'));
        on('menu-battle', () => this.go('battle_select'));
        on('menu-account', () => this.go('account_info'));
        on('menu-settings', () => this.go('settings'));
        on('story-back', () => this.go('main_menu'));
        on('battle-solo', () => this.go(this.freeBattle ? 'equip' : 'monster_select'));
        on('battle-multi', () => this.toast('マルチプレイは今後実装予定です'));
        on('battle-back', () => this.go('main_menu'));
        on('monster-back', () => this.go('battle_select'));
        on('monster-ranking', () => this.go('ranking'));
        on('ranking-back', () => this.go('monster_select'));
        on('settings-back', () => this.go('main_menu'));
        // アカウント
        on('acc-tab-create', () => this.setAccountTab('create', true));
        on('acc-tab-login', () => this.setAccountTab('login', true));
        on('acc-eye', (el) => this.togglePasswordView(el));
        on('acc-back', () => this.go('title'));
        on('profile-ok', () => this.submitProfile());
        on('profile-back', () => this.back());
        on('ai-profile', () => { this.profileFrom = 'account_info'; this.go('profile'); });
        on('ai-logout', (el) => this.confirmLogout(el));
        on('ai-back', () => this.go('main_menu'));
        // 装備
        on('equip-ok', () => this.startBattle());
        on('equip-back', () => this.back());
        on('equip-clear', () => this.clearEquipMagic());
    }
    
    // ---------- 文字の入力 ----------
    // - Enter：アカウントの画面は送信（form の submit）、プレイヤー名は入力を終える。Esc：入力をやめる
    // - 日本語の変換中（isComposing）の Enter は、変換を決めるだけ
    // - スマホ：入力欄を押すとキーボードで画面の下半分がかくれるので、入力欄が上に来るように画面をずらす
    //   キーボードが出て画面が小さくなっても、ゲーム画面の大きさは変えない（touch_controls.js の fitGame）
    setupTyping() {
        document.addEventListener('keydown', (e) => {
            const el = e.target;
            if (!InputManager.isTyping(el) || !el.closest('#screens')) return;
            if (e.key === 'Escape') { el.blur(); e.preventDefault(); return; }
            if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && el.id === 'profile-name-input') {
                e.preventDefault();
                el.blur();
                if (this.nav) this.nav.setIndex(this.nav.items.indexOf(this.$('profile-ok')));
            }
        });
        document.addEventListener('focusin', (e) => {
            const el = e.target;
            if (!InputManager.isTyping(el) || !el.closest('#screens')) return;
            document.body.classList.add('typing');
            if (document.body.classList.contains('touch')) this.shiftForKeyboard(el);
        });
        document.addEventListener('focusout', (e) => {
            if (!InputManager.isTyping(e.target)) return;
            // ほかの入力欄に移った時は、そのまま（focusin がもう一度ずらす）
            setTimeout(() => {
                const a = document.activeElement;
                if (a && InputManager.isTyping(a) && a.closest('#screens')) return;
                document.body.classList.remove('typing');
                this.shiftForKeyboard(null);
            }, 0);
        });
    }
    
    // スマホのキーボードで入力欄がかくれないよう、画面の中身を上へずらす（el が null なら戻す）
    shiftForKeyboard(el) {
        for (const s of this.root.querySelectorAll('.screen')) s.style.transform = '';
        if (!el) {
            // キーボードが閉じたら、画面の大きさを合わせ直す
            if (window.TouchControls && TouchControls.fitGame) setTimeout(() => TouchControls.fitGame(), 250);
            return;
        }
        const screen = el.closest('.screen');
        if (!screen) return;
        const scale = (window.TouchControls && TouchControls.scale) || 1;
        const top = (el.getBoundingClientRect().top - screen.getBoundingClientRect().top) / scale;
        const shift = Math.max(0, top - ScreenManager.TYPING_TOP);
        if (shift > 0) screen.style.transform = `translateY(${-shift}px)`;
    }
    
    // ---------- アカウント（作成・ログイン） ----------
    bindAccountForms() {
        const form = this.$('acc-form');
        if (form) form.addEventListener('submit', (e) => { e.preventDefault(); this.submitAccount(); });
        // 入力したら、前のエラーの文を消す
        for (const id of ['acc-user', 'acc-pass', 'acc-pass2']) {
            const el = this.$(id);
            if (el) el.addEventListener('input', () => this.showAccountError(''));
        }
        const name = this.$('profile-name-input');
        if (name) name.addEventListener('input', () => { this.updateNameCount(); this.showError('profile-error', ''); });
    }
    
    enterAccount() {
        const A = window.Account;
        const last = A ? A.lastUsername : '';
        // この端末で前にログインしたことがあればログイン、なければアカウント作成から
        this.setAccountTab(last ? 'login' : 'create', false);
        const user = this.$('acc-user');
        if (user) user.value = last || '';
        for (const id of ['acc-pass', 'acc-pass2']) { const el = this.$(id); if (el) el.value = ''; }
        this.setAccountBusy(false);
        const note = this.$('acc-note');
        if (note) {
            note.textContent = A && A.mode === 'cloud'
                ? 'アカウントはオンラインに保存されます。PC とスマホで同じアカウントを使えます'
                : 'いまはオンラインの準備中のため、アカウントはこの端末だけに保存されます';
            note.classList.toggle('local', !(A && A.mode === 'cloud'));
        }
    }
    
    setAccountTab(tab, byUser) {
        this.accountTab = tab;
        const create = tab === 'create';
        const title = this.$('acc-title');
        if (title) title.textContent = create ? 'アカウント作成' : 'ログイン';
        for (const t of this.root.querySelectorAll('.acc-tab')) t.classList.toggle('on', t.dataset.tab === tab);
        const row = this.$('acc-pass2-row');
        if (row) row.hidden = !create;
        const p2 = this.$('acc-pass2');
        if (p2) { p2.value = ''; p2.toggleAttribute('data-nav', create); }
        const pass = this.$('acc-pass');
        if (pass) pass.setAttribute('autocomplete', create ? 'new-password' : 'current-password');
        const submit = this.$('acc-submit');
        if (submit) submit.textContent = create ? 'アカウントを作る' : 'ログイン';
        const user = this.$('acc-user');
        if (user) user.placeholder = create ? '半角英数字と _（3〜16文字）' : 'ユーザー名';
        if (pass) pass.placeholder = create ? `${(window.Account && Account.PASSWORD_MIN) || 6}文字以上` : 'パスワード';
        this.showAccountError('');
        // 確認の欄が出たり消えたりするので、キーボードで選べる項目を作り直す
        if (this.current === 'account') {
            const keep = this.nav && this.nav.current;
            this.nav = new UINav(this.$('scr-account'), 'vertical');
            const i = keep ? this.nav.items.indexOf(keep) : -1;
            if (i >= 0) this.nav.setIndex(i);
        }
        if (byUser && user && !user.value) setTimeout(() => user.focus(), 0);
    }
    
    togglePasswordView(btn) {
        const show = btn.textContent === '表示';
        for (const id of ['acc-pass', 'acc-pass2']) { const el = this.$(id); if (el) el.type = show ? 'text' : 'password'; }
        btn.textContent = show ? '隠す' : '表示';
        btn.setAttribute('aria-label', show ? 'パスワードを隠す' : 'パスワードを表示');
    }
    
    showError(id, text) {
        const el = this.$(id);
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('show', !!text);
        if (text) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
    }
    showAccountError(text) { this.showError('acc-error', text); }
    
    setAccountBusy(busy) {
        this.accountBusy = busy;
        const panel = this.$('scr-account');
        if (panel) panel.classList.toggle('busy', busy);
        const submit = this.$('acc-submit');
        if (submit) {
            submit.disabled = busy;
            if (busy) submit.textContent = '通信しています…';
            else submit.textContent = this.accountTab === 'create' ? 'アカウントを作る' : 'ログイン';
        }
    }
    
    async submitAccount() {
        const A = window.Account;
        if (!A || this.accountBusy || this.busy) return;
        const user = this.$('acc-user').value.trim();
        const pass = this.$('acc-pass').value;
        const create = this.accountTab === 'create';
        // 先にこの画面で調べる（サーバーに送る前に、まちがいを知らせる）
        const bad = create
            ? (A.validateUsername(user) || A.validatePassword(pass, this.$('acc-pass2').value))
            : (!user ? 'EMPTY_USERNAME' : !pass ? 'EMPTY_PASSWORD' : null);
        if (bad) {
            playSE('ui_error');
            this.showAccountError(A.message(bad));
            const focus = /USERNAME/.test(bad) ? 'acc-user' : bad === 'PASSWORD_MISMATCH' ? 'acc-pass2' : 'acc-pass';
            const el = this.$(focus);
            if (el && !document.body.classList.contains('touch')) el.focus();
            return;
        }
        if (document.activeElement && InputManager.isTyping(document.activeElement)) document.activeElement.blur();
        this.setAccountBusy(true);
        this.showAccountError('');
        try {
            if (create) await A.register(user, pass);
            else await A.login(user, pass);
        } catch (e) {
            this.setAccountBusy(false);
            playSE('ui_error');
            this.showAccountError(e && e.code ? e.message : A.message('SERVER'));
            if (!(e && e.code)) console.error(e);
            return;
        }
        this.setAccountBusy(false);
        playSE('ui_select');
        this.toast(create ? 'アカウントを作りました' : `ログインしました（${A.user.username}）`);
        this.go(this.afterLoginScreen());
    }
    
    // ---------- プレイヤー登録（名前と主人公） ----------
    enterProfile() {
        const A = window.Account;
        const p = A && A.profile;
        const input = this.$('profile-name-input');
        if (input) input.value = p ? p.name : '';
        this.selectHero(p ? p.gender : (this.selectedHero || 'male'));
        for (const a of this.heroArts) a.card.classList.toggle('focused', false);
        this.updateNameCount();
        this.showError('profile-error', '');
        const back = this.$('profile-back');
        if (back) back.hidden = this.profileFrom !== 'account_info';
        const ok = this.$('profile-ok');
        if (ok) ok.textContent = this.profileFrom === 'account_info' ? '変更する' : '決定';
    }
    
    updateNameCount() {
        const input = this.$('profile-name-input');
        const cnt = this.$('profile-count');
        if (!input || !cnt) return;
        const max = (window.Account && Account.NAME_MAX) || 10;
        const n = [...input.value.trim()].length;
        cnt.textContent = `${n}/${max}`;
        cnt.classList.toggle('over', n > max);
    }
    
    submitProfile() {
        const A = window.Account;
        if (!A || !A.loggedIn) { this.go('account'); return; }
        const input = this.$('profile-name-input');
        const bad = A.validateName(input.value);
        if (bad) {
            playSE('ui_error');
            this.showError('profile-error', A.message(bad));
            if (!document.body.classList.contains('touch')) input.focus();
            return;
        }
        const first = !A.hasProfile();
        A.setProfile(input.value, this.selectedHero);
        this.toast(first ? `ようこそ、${A.playerName}さん！` : 'プレイヤー名と主人公を変えました');
        this.go(this.profileFrom === 'account_info' ? 'account_info' : 'main_menu');
    }
    
    // ---------- メインメニューの右上・アカウントの画面 ----------
    refreshMenuUser() {
        const el = this.$('menu-user');
        const A = window.Account;
        if (!el) return;
        if (!A || !A.loggedIn) { el.hidden = true; return; }
        el.hidden = false;
        el.innerHTML = '';
        const star = document.createElement('i');
        star.textContent = '★';
        const name = document.createElement('b');
        name.textContent = A.playerName || A.user.username;
        const mode = document.createElement('small');
        const offline = A.user.mode === 'cloud' && A.online === false;
        mode.textContent = A.user.mode === 'cloud' ? (offline ? 'オフライン' : 'オンライン') : 'この端末';
        mode.classList.toggle('offline', offline);
        el.title = offline ? 'サーバーにつながっていません。変えた所はこの端末に残して、つながった時に送ります' : '';
        el.append(star, name, mode);
    }
    
    enterAccountInfo() {
        const A = window.Account;
        const set = (id, t) => { const el = this.$(id); if (el) el.textContent = t; };
        set('ai-name', A && A.playerName || '─');
        set('ai-hero', A && A.hasProfile() ? (A.gender === 'female' ? '女の子' : '男の子') : '─');
        set('ai-user', A && A.user ? A.user.username : '─');
        set('ai-mode', A ? A.storageLabel() : '─');
        const lo = this.$('ai-logout');
        if (lo) { lo.textContent = 'ログアウト'; lo.classList.remove('confirm'); }
        clearTimeout(this._logoutTimer);
    }
    
    // ログアウトは2回押す（まちがえて押さないように）
    async confirmLogout(btn) {
        if (!btn.classList.contains('confirm')) {
            btn.classList.add('confirm');
            btn.textContent = 'もう一度押すとログアウト';
            clearTimeout(this._logoutTimer);
            this._logoutTimer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = 'ログアウト'; }, 3000);
            return;
        }
        clearTimeout(this._logoutTimer);
        btn.textContent = 'ログアウトしています…';
        if (window.Account) await Account.logout();
        this.toast('ログアウトしました');
        this.go('account');
    }
    
    // ---------- モンスター選択 ----------
    buildMonsterCards() {
        const wrap = this.$('monster-cards');
        if (!wrap) return;
        wrap.innerHTML = '';
        this.monsterArts = [];
        // 属性の小さな札（炎・水など。属性の色）。ない時は「なし」
        const elemChips = (list) => (list && list.length)
            ? list.map(el => {
                const info = window.getElementInfo ? window.getElementInfo(el) : { color: '#ccc' };
                return `<i class="el-chip" style="--c:${info.color}">${el}</i>`;
            }).join('')
            : '<i class="el-chip none">なし</i>';
        for (const b of BOSS_DATA) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'boss-card ui-btn' + (b.status === 'playable' ? ' playable' : ' coming') + (b.unknown ? ' unknown' : '');
            card.dataset.nav = '';
            card.dataset.id = b.id;
            const stars = b.unknown ? '？？？' : '★'.repeat(b.difficulty) + '☆'.repeat(Math.max(0, 3 - b.difficulty));
            const feats = b.unknown ? '<li class="muted">新しいボスが現れるかも…</li>' : b.features.map(f => `<li>${f}</li>`).join('');
            const playable = b.status === 'playable';
            const coins = playable && window.BattleRecords ? BattleRecords.baseCoins(b) : 0;
            // 行の名前はボスごとに変えられる（boss_data.js の cardLabels。怨嗟の鎧は「ステージ」「推奨レベル」）
            const lab = b.cardLabels || {};
            // 魔法が効かないボス（怨嗟の鎧）は、有利・不利属性の代わりに「魔法 ほぼ無効」の1行
            const elemRows = b.magicImmune
                ? '<div class="bc-row bc-elem"><span>魔法</span><b><i class="el-chip none">ほぼ無効</i></b></div>'
                : b.elements ? `<div class="bc-row bc-elem"><span>有利属性</span><b>${elemChips(b.elements.weak)}</b></div>
                <div class="bc-row bc-elem"><span>不利属性</span><b>${elemChips(b.elements.resist)}</b></div>` : '';
            // 倒したことのあるボスは、絵の上に「CLEAR」（enterMonster で出し入れする）
            card.innerHTML = `
                <div class="bc-art"><canvas width="240" height="150"></canvas>${playable ? '<span class="bc-clear" hidden>CLEAR</span>' : ''}</div>
                <div class="bc-name">${b.name}${b.reading ? `<small>${b.reading}</small>` : ''}</div>
                ${b.category ? `<div class="bc-cat">${b.category}</div>` : ''}
                <div class="bc-row"><span>難易度</span><b class="bc-stars">${stars}</b></div>
                <div class="bc-row"><span>${lab.field || 'フィールド'}</span><b>${b.fieldName}</b></div>
                ${b.playerLevel ? `<div class="bc-row"><span>${lab.level || '主人公'}</span><b>Lv.${b.playerLevel}</b></div>` : ''}
                ${playable ? `<div class="bc-row"><span>報酬</span><b><i class="coin-icon"></i>${coins}枚 ＋ランクボーナス</b></div>
                <div class="bc-row bc-best"><span>ベスト</span><b>─</b></div>` : ''}
                ${elemRows}
                <ul class="bc-feat">${feats}</ul>
                <div class="bc-status">${b.status === 'playable' ? 'プレイ可能' : '今後実装予定'}</div>`;
            card.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.busy) return;
                pressEffect(card);
                this.chooseMonster(b, card);
            });
            wrap.appendChild(card);
            // カードの絵：戦えるボスはゲームと同じ見た目（仮）を動かして見せる
            const canvas = card.querySelector('canvas');
            let enemy = null;
            if (b.status === 'playable' && b.enemy) {
                enemy = new Enemy({ ...b.enemy }, new Vector2(0, 0));
                enemy.direction = b.id === 'black_corrupted_wolf' ? 'left' : 'right';
            }
            this.monsterArts.push({ def: b, card, canvas, enemy, t: Math.random() * 3 });
        }
    }
    
    chooseMonster(b, card) {
        playSE(b.status === 'playable' ? 'ui_select' : 'ui_error');
        if (b.status !== 'playable') {
            card.classList.remove('shake');
            void card.offsetWidth;
            card.classList.add('shake');
            this.toast(b.unknown ? 'このボスは今後実装予定です' : `${b.name}は今後実装予定です`);
            return;
        }
        this.selectedBoss = b.id;
        this.go('equip');
    }
    
    // from：前の画面。マイベストから戻った時は、左上のマイベストのボタンを選んだ状態に（それ以外は前に選んだボスのカード）
    enterMonster(from = null) {
        const cards = [...this.root.querySelectorAll('#monster-cards .boss-card')];
        const rankBtn = this.$('monster-ranking');
        const onRank = from === 'ranking' && !!rankBtn;
        if (rankBtn) rankBtn.classList.toggle('focused', onRank);
        cards.forEach(c => c.classList.toggle('focused', !onRank && c.dataset.id === (this.selectedBoss || BOSS_DATA[0].id)));
        // 記録（バトルの後に変わる）：持っているコイン・CLEAR の印・ベストタイム
        const R = window.BattleRecords;
        if (!R) return;
        this.showCoins();
        for (const c of cards) {
            const id = c.dataset.id;
            const clear = c.querySelector('.bc-clear');
            if (clear) clear.hidden = !R.isCleared(id);
            c.classList.toggle('cleared', R.isCleared(id));
            const best = c.querySelector('.bc-best b');
            if (best) {
                const r = R.getBest(id);
                best.innerHTML = r ? `${R.formatTime(r.time)} <em class="rank-letter" data-rank="${r.rank}">${r.rank}</em>` : '─';
            }
        }
    }
    
    // 右上のバトルコインの数（モンスター選択・マイベスト）
    showCoins() {
        const n = window.BattleRecords ? BattleRecords.getCoins() : 0;
        for (const id of ['coin-count', 'ranking-coin-count']) {
            const el = this.$(id);
            if (el) el.textContent = String(n);
        }
    }
    
    // ---------- マイベストランキング ----------
    // ボスごとに、クリアタイムの速い順（battle_records.js の MAX_RECORDS 件まで）
    enterRanking() {
        const R = window.BattleRecords;
        this.rankingNavIndex = -1; // UINav を作った後の最初の update で、選んでいる札を覚える
        const bosses = BOSS_DATA.filter(b => b.status === 'playable');
        if (!this.rankingBoss || !bosses.some(b => b.id === this.rankingBoss)) {
            this.rankingBoss = bosses.some(b => b.id === this.selectedBoss) ? this.selectedBoss : (bosses[0] && bosses[0].id);
        }
        const tabs = this.$('ranking-tabs');
        if (tabs) {
            tabs.innerHTML = '';
            for (const b of bosses) {
                const t = document.createElement('button');
                t.type = 'button';
                t.className = 'ranking-tab ui-btn';
                t.dataset.nav = '';
                t.dataset.boss = b.id;
                t.innerHTML = `${b.name}${R && R.isCleared(b.id) ? '<small>CLEAR</small>' : ''}`;
                t.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (this.busy) return;
                    pressEffect(t);
                    // 押した札を「選んでいる札」にもする（スマホのタップ。キーボードの←→もここから続く）
                    const nav = this.nav;
                    const i = nav ? nav.items.indexOf(t) : -1;
                    if (i >= 0) { nav.setIndex(i); this.rankingNavIndex = i; }
                    this.showRanking(b.id);
                });
                // 画面を開いた時は、選んでいるモンスターの札から（UINav は focused の付いた項目から始める）
                t.classList.toggle('focused', b.id === this.rankingBoss);
                tabs.appendChild(t);
            }
        }
        // ランクの決まり方とコイン
        const note = this.$('ranking-note');
        if (note && R) {
            const dur = (s) => s === Infinity ? '' : s < 60 ? `${s}秒` : `${Math.floor(s / 60)}分${s % 60 ? `${s % 60}秒` : ''}`;
            const ranks = R.RANKS.map((r, i) => r.max === Infinity ? `${r.rank} ${dur(R.RANKS[i - 1].max)}より長い` : `${r.rank} ${dur(r.max)}以内`).join(' ／ ');
            const coins = bosses.map(b => `${b.name} ${R.baseCoins(b)}枚`).join(' ／ ');
            const bonus = R.RANKS.map(r => `${r.rank} +${r.bonus}`).join(' ／ ');
            note.innerHTML = `ランク：${ranks}<br>バトルコイン：${coins}　＋ランクのボーナス（${bonus}）`;
        }
        this.showCoins();
        this.showRanking(this.rankingBoss);
    }
    
    showRanking(id) {
        const R = window.BattleRecords;
        const b = getBossData(id);
        if (!R || !b) return;
        this.rankingBoss = id;
        for (const t of this.root.querySelectorAll('#ranking-tabs .ranking-tab')) t.classList.toggle('on', t.dataset.boss === id);
        const list = R.getRecords(id);
        const sum = this.$('ranking-summary');
        if (sum) {
            const best = list[0];
            sum.innerHTML = `<b>${b.name}</b>　クリア ${R.clearCount(id)}回` +
                (best ? `　ベスト ${R.formatTime(best.time)} <em class="rank-letter" data-rank="${best.rank}">${best.rank}</em>` : '');
        }
        const body = this.$('ranking-body');
        if (!body) return;
        if (!list.length) {
            body.innerHTML = '<tr class="empty"><td colspan="5">まだ記録がありません。倒すとここにクリアタイムがのります</td></tr>';
            return;
        }
        body.innerHTML = list.map((r, i) => `<tr class="${i === 0 ? 'top' : ''}">
            <td>${i + 1}位</td><td>${R.formatTime(r.time)}</td>
            <td><em class="rank-letter" data-rank="${r.rank}">${r.rank}</em></td>
            <td>${r.hero === 'female' ? '女の子' : '男の子'}</td><td>${R.formatDate(r.date)}</td></tr>`).join('');
    }
    
    drawMonsterArt(dt) {
        for (const a of this.monsterArts) {
            a.t += dt;
            const g = a.canvas.getContext('2d');
            const W = a.canvas.width, H = a.canvas.height;
            g.clearRect(0, 0, W, H);
            const focused = a.card.classList.contains('focused');
            if (a.enemy) {
                const e = a.enemy;
                // 選んでいるカードは歩く・それ以外は待機
                e.velocity = focused ? new Vector2(1, 0) : new Vector2(0, 0);
                e.animationTimer = a.t;
                e.animationFrame = focused ? Math.floor(a.t / 0.2) % 3 : 0;
                // 小さいボスも同じくらいの大きさに見せる（背の高いボスは look.cardFit で小さめに。怨嗟の鎧）
                const s = Math.min(1.7, ((a.def.look && a.def.look.cardFit) || 92) / e.size);
                g.save();
                g.translate(W / 2, H / 2 + 10);
                g.scale(s, s + (focused ? 0 : Math.sin(a.t * 2.2) * 0.015));
                // 足元の影
                g.fillStyle = 'rgba(0, 0, 0, 0.35)';
                g.beginPath(); g.ellipse(0, e.size * 0.55, e.size * 0.5, e.size * 0.15, 0, 0, Math.PI * 2); g.fill();
                const img = e.getEnemyImage();
                const m = e._drawMul || 1.5; // ボスの絵は大きめの四角（look.sprite.draw）
                if (img) g.drawImage(img, -e.size * m / 2, -e.size * m / 2, e.size * m, e.size * m);
                else e.drawBeastFallback(g, new Vector2(0, 0), 0);
                g.restore();
                if (a.def.id === 'black_corrupted_wolf') {
                    // 侵蝕のもや
                    for (let i = 0; i < 6; i++) {
                        const t = (a.t * 0.6 + i / 6) % 1;
                        g.globalAlpha = (1 - t) * 0.5;
                        g.fillStyle = i % 2 ? '#c77dff' : '#5a1f80';
                        g.beginPath(); g.arc(W / 2 + Math.sin(i * 2.3) * 40, H / 2 + 20 - t * 80, 4 * (1 - t * 0.5), 0, Math.PI * 2); g.fill();
                    }
                    g.globalAlpha = 1;
                }
            } else if (a.def.id === 'magic_golem') {
                ScreenManager.drawGolemArt(g, W, H, a.t);
            } else {
                // ？？？
                g.save();
                g.fillStyle = 'rgba(255, 255, 255, 0.08)';
                g.beginPath(); g.ellipse(W / 2, H / 2 + 10, 50, 46, 0, 0, Math.PI * 2); g.fill();
                g.font = 'bold 64px "DotGothic16", sans-serif';
                g.textAlign = 'center'; g.textBaseline = 'middle';
                g.fillStyle = `rgba(255, 230, 160, ${0.5 + Math.sin(a.t * 2) * 0.2})`;
                g.fillText('？', W / 2, H / 2 + 8);
                g.restore();
            }
        }
    }
    
    // 魔道ゴーレムの仮の絵（シルエット）
    static drawGolemArt(g, W, H, t) {
        g.save();
        g.translate(W / 2, H / 2 + 8);
        const glow = 0.5 + Math.sin(t * 2) * 0.3;
        // 足元の魔法陣
        g.strokeStyle = `rgba(110, 210, 255, ${0.35 + glow * 0.3})`;
        g.lineWidth = 2;
        g.beginPath(); g.ellipse(0, 52, 70, 18, 0, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.ellipse(0, 52, 52, 13, 0, 0, Math.PI * 2); g.stroke();
        // 体
        g.fillStyle = '#4b5160';
        g.fillRect(-30, -30, 60, 62);       // 胴
        g.fillRect(-20, -58, 40, 30);       // 頭
        g.fillRect(-56, -26, 24, 54);       // 腕
        g.fillRect(32, -26, 24, 54);
        g.fillRect(-26, 30, 20, 22);        // 脚
        g.fillRect(6, 30, 20, 22);
        g.fillStyle = '#6a7080';
        g.fillRect(-30, -30, 60, 8); g.fillRect(-56, -26, 24, 6); g.fillRect(32, -26, 24, 6);
        // 核と目の光
        g.fillStyle = `rgba(120, 220, 255, ${glow})`;
        g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
        g.fillRect(-12, -46, 8, 4); g.fillRect(4, -46, 8, 4);
        g.restore();
    }
    
    // ---------- 主人公選択 ----------
    buildHeroCards() {
        this.heroArts = [];
        for (const g of ['male', 'female']) {
            const card = this.$(`hero-${g}`);
            if (!card) continue;
            card.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.busy) return;
                pressEffect(card);
                this.selectHero(g);
                // キーボードで選んだ時は、続けて決定ボタンへ
                if (this.nav) this.nav.setIndex(this.nav.items.indexOf(this.$('profile-ok')));
            });
            this.heroArts.push({ gender: g, card, canvas: card.querySelector('canvas'), hop: 0 });
        }
    }
    
    selectHero(g) {
        this.selectedHero = g;
        for (const a of this.heroArts) {
            const on = a.gender === g;
            a.card.classList.toggle('selected', on);
            if (on) a.hop = 0.35;
        }
    }
    
    // 待機モーション（仮：立ち姿の画像が息をするように少し上下する。選ぶと小さく跳ねる）
    drawHeroArt(dt) {
        for (const a of this.heroArts) {
            const g = a.canvas.getContext('2d');
            const W = a.canvas.width, H = a.canvas.height;
            g.clearRect(0, 0, W, H);
            if (a.hop > 0) a.hop = Math.max(0, a.hop - dt);
            const hop = a.hop > 0 ? Math.sin((1 - a.hop / 0.35) * Math.PI) * 14 : 0;
            const breathe = Math.sin(this.time * 2.4 + (a.gender === 'female' ? 1 : 0)) * 0.015;
            const img = window.assetManager && window.assetManager.get(`player_${a.gender}_down_2`);
            g.fillStyle = 'rgba(0, 0, 0, 0.35)';
            g.beginPath(); g.ellipse(W / 2, H - 22, 34 - hop * 0.8, 9, 0, 0, Math.PI * 2); g.fill();
            if (img) {
                const size = 150;
                g.save();
                g.imageSmoothingEnabled = false;
                g.translate(W / 2, H - 16 - hop);
                g.scale(1 - breathe * 0.5, 1 + breathe);
                g.drawImage(img, -size / 2, -size, size, size);
                g.restore();
            } else {
                g.fillStyle = a.gender === 'male' ? '#6699ff' : '#ff99cc';
                g.beginPath(); g.arc(W / 2, H / 2 - hop, 40, 0, Math.PI * 2); g.fill();
            }
        }
    }
    
    // 装備画面の「出撃する」：アカウントの主人公・プレイヤー名と、決めた装備でバトルを始める
    startBattle() {
        const A = window.Account;
        const gender = A && A.hasProfile() ? A.gender : (this.selectedHero || 'male');
        const bossId = this.selectedBoss;
        if (this.equip && A && A.loggedIn) A.setLoadout(this.equip);
        this.game.loadout = this.equip && A ? A.normalizeLoadout(this.equip) : null;
        this.game.playerName = A ? A.playerName : '';
        this.transition(() => {
            this.hideAll();
            if (this.freeBattle || !bossId) this.game.startGame(gender);
            else this.game.startBossBattle(bossId, gender);
        });
    }
    
    // ---------- 装備 ----------
    // 魔法パレット：5つの枠（星の頂点。上から時計回り）。魔法を押すと空いている枠（選んだ枠があればそこ）に入る
    //   セットしてある魔法をもう一度押す・枠を押すと外れる。同じ魔法は1つまで
    // 武器・防具：バトルモードでは剣はナイフだけ・盾と防具はなし（押すと「装備できません」）
    static EQUIP_GEAR = [
        { slot: 'sword',  group: 'weapon', label: '剣',   icon: 'sword',  item: 'ナイフ', note: '攻撃 +5' },
        { slot: 'shield', group: 'weapon', label: '盾',   icon: 'shield' },
        { slot: 'head',   group: 'armor',  label: '頭',   icon: 'head' },
        { slot: 'body',   group: 'armor',  label: '鎧',   icon: 'body' },
        { slot: 'legs',   group: 'armor',  label: '足',   icon: 'legs' }
    ];
    // 装備の枠の絵（ドット絵ふうの小さな線画。金色）
    static GEAR_ICONS = {
        sword:  '<path d="M19 3 L21 3 L21 5 L11 15 L9 13 Z"/><path d="M6 12 L12 18 L10 20 L8 18 L5 21 L3 19 L6 16 L4 14 Z"/>',
        shield: '<path d="M12 2 L20 5 L20 11 C20 16 16.5 19.5 12 22 C7.5 19.5 4 16 4 11 L4 5 Z M12 5 L7 7 L7 11 C7 14.5 9.2 17 12 18.6 Z"/>',
        head:   '<path d="M12 3 C7 3 4 6.5 4 11 L4 15 L7 15 L7 12 L17 12 L17 15 L20 15 L20 11 C20 6.5 17 3 12 3 Z M11 4.5 L13 4.5 L13 10 L11 10 Z"/><path d="M6 16 L9 16 L9 20 L6 20 Z M15 16 L18 16 L18 20 L15 20 Z"/>',
        body:   '<path d="M8 3 L10 5 L14 5 L16 3 L21 6 L19 11 L17 10 L17 21 L7 21 L7 10 L5 11 L3 6 Z M10 8 L10 18 L14 18 L14 8 Z"/>',
        legs:   '<path d="M6 3 L11 3 L11 15 L14 17 L14 21 L4 21 L4 17 L6 15 Z"/><path d="M14 3 L19 3 L19 13 L16 13 L16 9 L14 9 Z"/>'
    };
    
    // 装備画面で選べる魔法（覚えている魔法：最初の6つ）
    equipMagicList() {
        const list = (window.gameData && window.gameData.magicCircles) || [];
        const starters = window.STARTER_MAGIC || [];
        return ScreenManager.EQUIP_MAGIC.map(id => list.find(m => m.id === id) || starters.find(m => m.id === id)).filter(Boolean);
    }
    
    magicIcon(m) {
        const info = getElementInfo(m.element);
        const src = window.TouchControls && TouchControls.elementIcons && TouchControls.elementIcons[info.key];
        return src ? `<img class="mi-icon" src="${src}" alt="">` : `<span class="mi-icon text" style="--c:${info.color}">${info.label}</span>`;
    }
    
    buildEquip() {
        if (this._equipBuilt) return;
        this._equipBuilt = true;
        // 魔法パレットの5つの枠（星の頂点）
        const star = this.$('equip-palette');
        this.equipSlots = [];
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ps-slot ui-btn';
            b.dataset.nav = '';
            b.dataset.slot = String(i);
            b.style.left = `calc(50% + ${(Math.cos(a) * ScreenManager.EQUIP_STAR_R).toFixed(1)}px)`;
            b.style.top = `calc(50% + ${(Math.sin(a) * ScreenManager.EQUIP_STAR_R).toFixed(1)}px)`;
            b.innerHTML = `<span class="ps-num">${i + 1}</span><span class="ps-icon"></span><span class="ps-name"></span>`;
            b.addEventListener('click', (e) => { e.preventDefault(); if (!this.busy) { pressEffect(b); this.clickEquipSlot(i); } });
            b.addEventListener('pointerenter', () => this.showEquipDetail(this.equip && this.equip.magic[i]));
            star.appendChild(b);
            this.equipSlots.push(b);
        }
        // 選べる魔法の札
        const list = this.$('equip-magic-list');
        this.equipCards = [];
        for (const m of this.equipMagicList()) {
            const info = getElementInfo(m.element);
            const c = document.createElement('button');
            c.type = 'button';
            c.className = 'mg-card ui-btn';
            c.dataset.nav = '';
            c.dataset.id = m.id;
            c.style.setProperty('--c', info.color);
            c.innerHTML = `${this.magicIcon(m)}<span class="mg-text"><b>${m.name}</b><small>${m.category === '治癒' ? '治癒' : info.label + 'の攻撃'}・MP${m.spCost}</small></span><span class="mg-badge"></span>`;
            c.addEventListener('click', (e) => { e.preventDefault(); if (!this.busy) { pressEffect(c); this.toggleEquipMagic(m.id); } });
            c.addEventListener('pointerenter', () => this.showEquipDetail(m.id));
            list.appendChild(c);
            this.equipCards.push(c);
        }
        // 武器・防具の枠
        for (const g of ScreenManager.EQUIP_GEAR) {
            const box = this.$(g.group === 'weapon' ? 'equip-gear-weapon' : 'equip-gear-armor');
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'gear-slot ui-btn' + (g.item ? ' fixed' : ' empty');
            b.dataset.nav = '';
            b.dataset.slot = g.slot;
            b.innerHTML = `<svg class="gs-icon" viewBox="0 0 24 24" aria-hidden="true">${ScreenManager.GEAR_ICONS[g.icon]}</svg>`
                + `<span class="gs-label">${g.label}</span><span class="gs-item">${g.item || 'なし'}${g.note ? `<small>${g.note}</small>` : ''}</span>`
                + `<span class="gs-lock">${g.item ? '固定' : '─'}</span>`;
            b.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.busy) return;
                playSE('ui_error');
                b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
                this.toast(g.item ? 'バトルモードの剣はナイフだけです' : 'バトルモードでは装備できません');
            });
            box.appendChild(b);
        }
    }
    
    enterEquip() {
        this.buildEquip();
        const A = window.Account;
        this.equip = A ? Account.normalizeLoadout(A.loadout) : (window.Account ? Account.blankLoadout() : { magic: [null, null, null, null, null] });
        this.equipSlot = -1;
        const b = getBossData(this.selectedBoss);
        const vs = this.$('equip-vs');
        if (vs) vs.textContent = this.freeBattle || !b ? 'フリーバトル（星の闘技場）' : `VS ${b.name}　─　${b.fieldName}`;
        // 主人公（プレイヤー登録で決めた見た目と名前）とステータス（ボスごとの推奨レベル）
        const lv = !this.freeBattle && b && b.playerLevel ? b.playerLevel : 1;
        const st = (window.gameData && gameData.playerStatsTable && gameData.playerStatsTable.find(s => s.level === lv)) || Player.statsForLevel(lv);
        const set = (id, t) => { const el = this.$(id); if (el) el.textContent = t; };
        set('equip-hero-name', A && A.playerName ? A.playerName : (this.selectedHero === 'female' ? '女の子' : '男の子'));
        set('equip-hero-lv', `Lv.${lv}${!this.freeBattle && b ? '（このボスの推奨レベル）' : ''}`);
        const stats = this.$('equip-stats');
        if (stats) {
            const knife = 5;
            stats.innerHTML = '';
            for (const [k, v] of [['HP', st.hp], ['MP', st.maxSP], ['攻撃', `${st.attack} <em>+${knife}</em>`], ['防御', st.defense]]) {
                const dt = document.createElement('dt'); dt.textContent = k;
                const dd = document.createElement('dd'); dd.innerHTML = String(v);
                stats.append(dt, dd);
            }
        }
        this.equipHeroGender = A && A.hasProfile() ? A.gender : (this.selectedHero || 'male');
        this.renderEquip();
        this.showEquipDetail(this.equip.magic.find(Boolean) || null);
        // 最初は「出撃する」を選んだ状態（魔法がまだなら、最初の魔法の札）
        const first = this.equip.magic.some(Boolean) ? this.$('equip-ok') : this.equipCards[0];
        for (const el of this.root.querySelectorAll('#scr-equip [data-nav]')) el.classList.toggle('focused', el === first);
    }
    
    renderEquip() {
        const eq = this.equip;
        if (!eq) return;
        const byId = {};
        for (const m of this.equipMagicList()) byId[m.id] = m;
        eq.magic.forEach((id, i) => {
            const s = this.equipSlots[i];
            const m = id && byId[id];
            s.classList.toggle('filled', !!m);
            s.classList.toggle('target', this.equipSlot === i);
            s.style.setProperty('--c', m ? getElementInfo(m.element).color : 'transparent');
            s.querySelector('.ps-icon').innerHTML = m ? this.magicIcon(m) : '<span class="ps-plus">＋</span>';
            s.querySelector('.ps-name').textContent = m ? m.name : '空き';
            s.setAttribute('aria-label', m ? `枠${i + 1}：${m.name}（押すと外す）` : `枠${i + 1}：空き`);
        });
        for (const c of this.equipCards) {
            const i = eq.magic.indexOf(c.dataset.id);
            c.classList.toggle('set', i >= 0);
            c.querySelector('.mg-badge').textContent = i >= 0 ? String(i + 1) : '';
        }
        const n = eq.magic.filter(Boolean).length;
        const cnt = this.$('equip-magic-count');
        if (cnt) cnt.textContent = `${n}/5`;
        const hint = this.$('equip-hint');
        if (hint) {
            hint.textContent = this.equipSlot >= 0 ? `枠${this.equipSlot + 1}に入れる魔法を選んでください`
                : n === 0 ? '魔法を押すと、空いている枠に入ります（魔法なしでも出撃できます）'
                : n >= 5 ? '入れかえる時は、外したい枠を押してください' : '魔法を押すと空いている枠に入ります。枠を押すと外れます';
            hint.classList.toggle('warn', n === 0);
        }
    }
    
    // 魔法を押した：セットしてあれば外す。なければ選んだ枠（なければ最初の空き）に入れる
    toggleEquipMagic(id) {
        const eq = this.equip;
        const at = eq.magic.indexOf(id);
        if (at >= 0) {
            eq.magic[at] = null;
            playSE('ui_cancel');
        } else {
            const slot = this.equipSlot >= 0 ? this.equipSlot : eq.magic.indexOf(null);
            if (slot < 0) {
                playSE('ui_error');
                this.toast('パレットがいっぱいです。外したい枠を押してください');
                return;
            }
            eq.magic[slot] = id;
            this.equipSlot = -1;
            this.flashEquipSlot(slot);
            playSE('ui_select');
        }
        this.showEquipDetail(id);
        this.saveEquip();
    }
    
    // 枠を押した：魔法が入っていれば外す（その枠に次の魔法が入る）。空きなら、次に入れる枠にする
    clickEquipSlot(i) {
        const eq = this.equip;
        if (eq.magic[i]) {
            eq.magic[i] = null;
            this.equipSlot = i;
            playSE('ui_cancel');
        } else {
            this.equipSlot = this.equipSlot === i ? -1 : i;
            playSE('ui_move');
        }
        this.saveEquip();
    }
    
    clearEquipMagic() {
        if (!this.equip || !this.equip.magic.some(Boolean)) { playSE('ui_error'); this.toast('魔法はセットされていません'); return; }
        playSE('ui_cancel');
        this.equip.magic = [null, null, null, null, null];
        this.equipSlot = -1;
        this.saveEquip();
        this.toast('魔法をすべて外しました');
    }
    
    flashEquipSlot(i) {
        const s = this.equipSlots[i];
        if (!s) return;
        s.classList.remove('just'); void s.offsetWidth; s.classList.add('just');
    }
    
    saveEquip() {
        this.renderEquip();
        if (window.Account && Account.loggedIn) Account.setLoadout(this.equip);
    }
    
    showEquipDetail(id) {
        const box = this.$('equip-magic-detail');
        if (!box) return;
        const m = id && this.equipMagicList().find(x => x.id === id);
        if (!m) {
            box.innerHTML = '<p class="md-empty">魔法にカーソルを合わせると、ここに説明が出ます</p>';
            return;
        }
        const info = getElementInfo(m.element);
        const chant = ((m.chantTime || 1) * (Player.CHANT_TIME_MUL || 1)).toFixed(1);
        box.style.setProperty('--c', info.color);
        box.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'md-head';
        head.innerHTML = `<b>${m.name}</b><span class="md-tag">${m.category === '治癒' ? '治癒' : info.label}</span><span class="md-cost">MP ${m.spCost}　詠唱 ${chant}秒</span>`;
        const p = document.createElement('p');
        p.textContent = m.description || '';
        box.append(head, p);
    }
    
    // 装備画面の主人公（立ち姿が息をするように動く）
    drawEquipArt(dt) {
        const c = this.$('equip-hero-art');
        if (!c) return;
        const g = c.getContext('2d');
        const W = c.width, H = c.height;
        g.clearRect(0, 0, W, H);
        const gender = this.equipHeroGender || 'male';
        const img = window.assetManager && window.assetManager.get(`player_${gender}_down_2`);
        const breathe = Math.sin(this.time * 2.4) * 0.015;
        g.fillStyle = 'rgba(0, 0, 0, 0.35)';
        g.beginPath(); g.ellipse(W / 2, H - 20, 34, 9, 0, 0, Math.PI * 2); g.fill();
        if (img) {
            g.save();
            g.imageSmoothingEnabled = false;
            g.translate(W / 2, H - 14);
            g.scale(1 - breathe * 0.5, 1 + breathe);
            g.drawImage(img, -75, -150, 150, 150);
            g.restore();
        }
    }
    
    // ---------- 設定 ----------
    buildSettings() {
        const s = window.settings;
        const rows = this.root.querySelectorAll('.set-row[data-key]');
        // 音量を変えた時：その種類の音を鳴らして、大きさを確かめられるようにする（data-sample。長い声は短く切る）
        const sample = (row) => {
            const k = row.dataset.sample;
            if (k) playSE(k, { dur: ScreenManager.SAMPLE_DUR, gap: 0.12 });
        };
        for (const row of rows) {
            const key = row.dataset.key;
            const type = row.dataset.type;
            const change = (dir) => {
                if (type === 'volume') s.set(key, Math.round(Math.min(1, Math.max(0, s.get(key) + dir * 0.1)) * 10) / 10);
                else s.set(key, !s.get(key));
                this.refreshSettings();
                if (type === 'volume') sample(row);
            };
            row.addEventListener('adjust', (e) => change(e.detail));
            row.addEventListener('click', (e) => {
                e.preventDefault();
                const btn = e.target.closest('[data-step]');
                if (type === 'volume') {
                    if (btn) change(Number(btn.dataset.step));
                    else {
                        const bar = e.target.closest('.set-bar');
                        if (bar) {
                            // バーの押した所の値にする
                            const r = bar.getBoundingClientRect();
                            const v = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 10) / 10;
                            s.set(key, v);
                            this.refreshSettings();
                            sample(row);
                        }
                    }
                } else change(1); // Enter・クリックで ON/OFF
            });
        }
        // 音量を最初の設定に戻す（表示の設定はそのまま）
        const reset = this.$('settings-reset-volume');
        if (reset) reset.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.busy) return;
            pressEffect(reset);
            s.resetVolumes();
            this.refreshSettings();
            this.toast('音量を最初の設定に戻しました');
        });
        // 操作説明のタブ
        for (const tab of this.root.querySelectorAll('.set-tab')) {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                this.showControlsTab(tab.dataset.tab);
            });
        }
        this.showControlsTab(document.body.classList.contains('touch') ? 'touch' : 'keyboard');
    }
    
    showControlsTab(name) {
        for (const t of this.root.querySelectorAll('.set-tab')) t.classList.toggle('on', t.dataset.tab === name);
        for (const p of this.root.querySelectorAll('.set-help')) p.classList.toggle('on', p.dataset.tab === name);
    }
    
    refreshSettings() {
        const s = window.settings;
        // 操作説明は、遊んでいる端末に合わせたタブを最初に出す（スマホかどうかは途中で分かることがある）
        if (!this._tabChosen) {
            this._tabChosen = true;
            this.showControlsTab(document.body.classList.contains('touch') ? 'touch' : 'keyboard');
        }
        for (const row of this.root.querySelectorAll('.set-row[data-key]')) {
            const v = s.get(row.dataset.key);
            if (row.dataset.type === 'volume') {
                row.querySelector('.set-fill').style.width = (v * 100) + '%';
                row.querySelector('.set-value').textContent = Math.round(v * 100) + '%';
            } else {
                const el = row.querySelector('.set-toggle');
                el.textContent = v ? 'ON' : 'OFF';
                el.classList.toggle('on', !!v);
            }
        }
    }
}
ScreenManager.FADE_MS = 350;
ScreenManager.EQUIP_STAR_R = 71.5; // 装備画面の魔法パレット：星の中心から枠までの距離（px。輪の絵 270px の丸の位置 = 幅の 26.5%）
// 装備画面で選べる魔法（最初から覚えている魔法。Player の learnedMagic と同じ）
ScreenManager.EQUIP_MAGIC = ['magic_201', 'magic_202', 'magic_203', 'magic_204', 'magic_205', 'magic_206'];
ScreenManager.TYPING_TOP = 40;     // スマホで文字を入力する時、入力欄が来る高さ（1280×720 の画面の上から px）
ScreenManager.SAMPLE_DUR = 0.8; // 設定で音量を変えた時に鳴らす、確かめの音の長さ（秒）

window.UINav = UINav;
window.ScreenManager = ScreenManager;
window.TitleBackground = TitleBackground;
