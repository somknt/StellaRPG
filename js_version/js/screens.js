// 画面の切り替え（タイトル → メインメニュー → バトルモード → モンスター選択 → 主人公選択 → ボス戦）
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
                if (nav && e.pointerType === 'mouse' && !nav.isSkip(el)) nav.setIndex(nav.items.indexOf(el));
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
            return;
        }
        if (this.mode !== 'horizontal' && (up || down)) this.move(up ? -1 : 1);
        if (this.mode !== 'vertical' && (left || right)) this.move(left ? -1 : 1);
        if ((k('Enter') || k('Space')) && cur && !this.isSkip(cur)) {
            pressEffect(cur);
            cur.click();
        }
    }
}

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
        this.selectedHero = 'male';
        this.bg = new TitleBackground();
        // URL に ?mode=free を付けると、モンスター選択をとばして前のフリーバトル（スライム・ウサギ）で遊べる
        this.freeBattle = new URLSearchParams(window.location.search).get('mode') === 'free';
        this.buildMonsterCards();
        this.buildHeroCards();
        this.buildSettings();
        this.bindButtons();
    }
    
    $(id) { return document.getElementById(id); }
    
    // 画面の名前 → HTML と、キーボードの動かし方
    static SCREENS = {
        title:          { id: 'scr-title',    nav: null },
        main_menu:      { id: 'scr-menu',     nav: 'vertical', back: 'title' },
        story:          { id: 'scr-story',    nav: 'vertical', back: 'main_menu' },
        battle_select:  { id: 'scr-battle',   nav: 'vertical', back: 'main_menu' },
        monster_select: { id: 'scr-monster',  nav: 'grid',     back: 'battle_select' },
        hero_select:    { id: 'scr-hero',     nav: 'grid',     back: 'monster_select' },
        settings:       { id: 'scr-settings', nav: 'vertical', back: 'main_menu' }
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
        this.current = name;
        this.game.gameState = name;
        const el = this.$(def.id);
        if (name === 'title') this.bg.logoTime = 0; // ロゴの登場をもう一度
        if (name === 'hero_select') this.enterHero();
        if (name === 'monster_select') this.enterMonster();
        if (name === 'settings') this.refreshSettings();
        // 最初の項目を選んだ状態にする（戻ってきた時は前に選んでいた所）
        this.nav = def.nav ? new UINav(el, def.nav) : null;
    }
    
    // バトルが始まったら画面を閉じる
    hideAll() {
        this.root.classList.remove('open');
        for (const el of this.root.querySelectorAll('.screen')) el.classList.remove('active');
        this.current = null;
        this.nav = null;
    }
    
    back() {
        const def = ScreenManager.SCREENS[this.current];
        if (!def || !def.back) return;
        let to = def.back;
        if (this.current === 'hero_select' && this.freeBattle) to = 'battle_select';
        this.go(to);
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
        if (this.current === 'hero_select') this.drawHeroArt(dt);
        if (this.busy || !this.current) return;
        if (this.current === 'title') {
            if (input.isKeyPressed('Enter') || input.isKeyPressed('Space')) this.startFromTitle();
            return;
        }
        if (input.isKeyPressed('Escape') || input.isKeyPressed('Backspace')) { this.back(); return; }
        if (this.nav) this.nav.handle(input);
    }
    
    draw(ctx) {
        const dim = this.current === 'title' ? 0 : this.current === 'main_menu' ? 0.45 : 0.62;
        this.bg.draw(ctx, this.time, dim);
    }
    
    startFromTitle() {
        if (this.current !== 'title') return;
        this.go('main_menu');
    }
    
    // ---------- ボタン ----------
    bindButtons() {
        const on = (id, fn) => {
            const el = this.$(id);
            if (el) el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (!this.busy) { pressEffect(el); fn(el); } });
        };
        // タイトル：画面のどこをクリック・タップしても進む
        this.$('scr-title').addEventListener('click', () => this.startFromTitle());
        
        on('menu-story', () => this.go('story'));
        on('menu-battle', () => this.go('battle_select'));
        on('menu-settings', () => this.go('settings'));
        on('story-back', () => this.go('main_menu'));
        on('battle-solo', () => this.go(this.freeBattle ? 'hero_select' : 'monster_select'));
        on('battle-multi', () => this.toast('マルチプレイは今後実装予定です'));
        on('battle-back', () => this.go('main_menu'));
        on('monster-back', () => this.go('battle_select'));
        on('hero-ok', () => this.startBattle());
        on('hero-back', () => this.back());
        on('settings-back', () => this.go('main_menu'));
    }
    
    // ---------- モンスター選択 ----------
    buildMonsterCards() {
        const wrap = this.$('monster-cards');
        if (!wrap) return;
        wrap.innerHTML = '';
        this.monsterArts = [];
        for (const b of BOSS_DATA) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'boss-card ui-btn' + (b.status === 'playable' ? ' playable' : ' coming') + (b.unknown ? ' unknown' : '');
            card.dataset.nav = '';
            card.dataset.id = b.id;
            const stars = b.unknown ? '？？？' : '★'.repeat(b.difficulty) + '☆'.repeat(Math.max(0, 3 - b.difficulty));
            const feats = b.unknown ? '<li class="muted">新しいボスが現れるかも…</li>' : b.features.map(f => `<li>${f}</li>`).join('');
            card.innerHTML = `
                <div class="bc-art"><canvas width="240" height="150"></canvas></div>
                <div class="bc-name">${b.name}${b.reading ? `<small>${b.reading}</small>` : ''}</div>
                <div class="bc-row"><span>難易度</span><b class="bc-stars">${stars}</b></div>
                <div class="bc-row"><span>フィールド</span><b>${b.fieldName}</b></div>
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
        if (b.status !== 'playable') {
            card.classList.remove('shake');
            void card.offsetWidth;
            card.classList.add('shake');
            this.toast(b.unknown ? 'このボスは今後実装予定です' : `${b.name}は今後実装予定です`);
            return;
        }
        this.selectedBoss = b.id;
        this.go('hero_select');
    }
    
    enterMonster() {
        // 前に選んだボスのカードを選んだ状態に
        const cards = [...this.root.querySelectorAll('#monster-cards .boss-card')];
        cards.forEach(c => c.classList.toggle('focused', c.dataset.id === (this.selectedBoss || BOSS_DATA[0].id)));
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
                const s = Math.min(1.7, 92 / e.size); // 小さいボスも同じくらいの大きさに見せる
                g.save();
                g.translate(W / 2, H / 2 + 10);
                g.scale(s, s + (focused ? 0 : Math.sin(a.t * 2.2) * 0.015));
                // 足元の影
                g.fillStyle = 'rgba(0, 0, 0, 0.35)';
                g.beginPath(); g.ellipse(0, e.size * 0.55, e.size * 0.5, e.size * 0.15, 0, 0, Math.PI * 2); g.fill();
                const img = e.getEnemyImage();
                if (img) g.drawImage(img, -e.size * 0.75, -e.size * 0.75, e.size * 1.5, e.size * 1.5);
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
                if (this.nav) this.nav.setIndex(this.nav.items.indexOf(this.$('hero-ok')));
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
    
    enterHero() {
        const b = getBossData(this.selectedBoss);
        const vs = this.$('hero-vs');
        if (vs) vs.textContent = this.freeBattle || !b ? 'フリーバトル（星の闘技場）' : `VS ${b.name}　─　${b.fieldName}`;
        this.selectHero(this.selectedHero || 'male');
        for (const a of this.heroArts) a.card.classList.toggle('focused', a.gender === this.selectedHero);
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
    
    startBattle() {
        const gender = this.selectedHero || 'male';
        const bossId = this.selectedBoss;
        this.transition(() => {
            this.hideAll();
            if (this.freeBattle || !bossId) this.game.startGame(gender);
            else this.game.startBossBattle(bossId, gender);
        });
    }
    
    // ---------- 設定 ----------
    buildSettings() {
        const s = window.settings;
        const rows = this.root.querySelectorAll('.set-row[data-key]');
        for (const row of rows) {
            const key = row.dataset.key;
            const type = row.dataset.type;
            const change = (dir) => {
                if (type === 'volume') s.set(key, Math.round(Math.min(1, Math.max(0, s.get(key) + dir * 0.1)) * 10) / 10);
                else s.set(key, !s.get(key));
                this.refreshSettings();
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
                        }
                    }
                } else change(1); // Enter・クリックで ON/OFF
            });
        }
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

window.UINav = UINav;
window.ScreenManager = ScreenManager;
window.TitleBackground = TitleBackground;
