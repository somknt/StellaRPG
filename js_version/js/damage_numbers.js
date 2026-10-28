// 攻撃のダメージの数字（主人公の攻撃が敵に当たった時）
// ドット絵の数字（5×7 ドットの太い数字＋黒いふち）を、敵の頭の上にぽんと出して、少し上がってから消す
// 色：有利属性で当たった時は赤 / 不利属性は青 / それ以外の魔法は魔法の属性の色 / ナイフ（属性なし）は白
//     有利属性は数字を大きく、残り火・竜巻の続けて当たるダメージは小さく出す

class DamageNumbers {
    constructor() {
        this.list = [];
    }
    
    clear() {
        this.list = [];
    }
    
    // value：ダメージ / enemy：当たった敵（頭の上に出す）
    // opts.affinity：'weak'（有利属性）/ 'resist'（不利属性）/ 'normal'
    // opts.element：魔法の属性（'炎' など。ナイフは null） / opts.tick：残り火・竜巻のような続けて当たるダメージ
    add(value, enemy, opts = {}) {
        const n = Math.round(value);
        if (!(n > 0) || !enemy) return;
        const D = DamageNumbers;
        const palette = D.paletteFor(opts.affinity, opts.element);
        const px = opts.affinity === 'weak' ? D.PX.weak : opts.tick ? D.PX.tick : D.PX.normal;
        this.list.push({
            img: D.render(String(n), palette),
            x: enemy.position.x + (Math.random() - 0.5) * D.JITTER.x,
            y: enemy.position.y - (enemy.size || 40) * D.HEAD + (Math.random() - 0.5) * D.JITTER.y,
            px,
            age: 0
        });
        if (this.list.length > D.MAX) this.list.splice(0, this.list.length - D.MAX);
    }
    
    update(dt) {
        if (!this.list.length) return;
        for (const d of this.list) d.age += dt;
        this.list = this.list.filter(d => d.age < DamageNumbers.LIFE);
    }
    
    draw(ctx, cam) {
        if (!this.list.length) return;
        const D = DamageNumbers;
        const k = D.screenScale();
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        for (const d of this.list) {
            const t = d.age / D.LIFE;
            // 出た瞬間は大きく → すぐ元の大きさ。少しずつ上がって、最後にうすくなる
            const pop = d.age < D.POP ? 1 + (D.POP_SCALE - 1) * (1 - d.age / D.POP) : 1;
            const rise = D.RISE * (1 - (1 - t) * (1 - t));
            const w = d.img.width * d.px * k * pop, h = d.img.height * d.px * k * pop;
            ctx.globalAlpha = t < D.FADE ? 1 : Math.max(0, 1 - (t - D.FADE) / (1 - D.FADE));
            ctx.drawImage(d.img, Math.round(d.x - cam.x - w / 2), Math.round(d.y - cam.y - rise - h), Math.round(w), Math.round(h));
        }
        ctx.restore();
    }
    
    // スマホは画面ごと縮むので、数字を大きくして読めるようにする（左上のステータスの拡大と同じ考え方）
    static screenScale() {
        const T = window.TouchControls;
        if (!T || !T.isTouch || !(T.scale > 0)) return 1;
        return Math.min(1.6, Math.max(1, 0.6 / T.scale));
    }
    
    // 数字の色：上の段は明るい色・下の段は濃い色（ドット絵の陰影）
    static paletteFor(affinity, element) {
        const D = DamageNumbers;
        if (affinity === 'weak') return D.COLORS.weak;
        if (affinity === 'resist') return D.COLORS.resist;
        if (element && typeof getElementInfo === 'function') {
            const info = getElementInfo(element);
            return { key: info.key, top: info.light, bottom: info.color };
        }
        return D.COLORS.normal;
    }
    
    // 数字の絵（1ドット＝1px。描く時に拡大する）。数字と色ごとに1回だけ作って使い回す
    // ※ゲームに Map クラス（マップ）があるので、標準の Map ではなく普通のオブジェクトにしまう
    static render(text, palette) {
        const D = DamageNumbers;
        const key = palette.key + ':' + text;
        if (D._cache[key]) return D._cache[key];
        const gw = 5, gh = 7, gap = 1, o = 1; // 1文字の大きさ・文字の間・ふちの太さ
        const cols = text.length * gw + (text.length - 1) * gap;
        const W = cols + o * 2, H = gh + o * 2 + 1; // 下に1ドットの影
        const on = new Uint8Array(W * H);
        for (let i = 0; i < text.length; i++) {
            const g = D.FONT[text[i]];
            if (!g) continue;
            for (let y = 0; y < gh; y++) {
                for (let x = 0; x < gw; x++) {
                    if (g[y][x] === '#') on[(y + o) * W + o + i * (gw + gap) + x] = 1;
                }
            }
        }
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const g = c.getContext('2d');
        // ふち（まわり8方向）と、下の影
        g.fillStyle = D.OUTLINE;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (!on[y * W + x]) continue;
                g.fillRect(x - 1, y - 1, 3, 3);
                g.fillRect(x, y + 2, 1, 1);
            }
        }
        // 数字（上の4段は明るい色・下の3段は濃い色）
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (!on[y * W + x]) continue;
                g.fillStyle = y - o < 4 ? palette.top : palette.bottom;
                g.fillRect(x, y, 1, 1);
            }
        }
        D._cache[key] = c;
        return c;
    }
}

DamageNumbers._cache = {};
// 1ドットの大きさ（px）：ふつう / 有利属性 / 残り火・竜巻の続けて当たるダメージ
DamageNumbers.PX = { normal: 3, weak: 4, tick: 2.5 };
DamageNumbers.LIFE = 0.9;       // 出てから消えるまで（秒）
DamageNumbers.FADE = 0.65;      // この割合を過ぎたら、うすくなっていく
DamageNumbers.POP = 0.1;        // 出た瞬間に大きく見せる時間（秒）
DamageNumbers.POP_SCALE = 1.6;
DamageNumbers.RISE = 30;        // 上がる高さ（px）
DamageNumbers.HEAD = 0.45;      // 敵の中心から、体の大きさのこの割合だけ上に出す
DamageNumbers.JITTER = { x: 26, y: 10 }; // 続けて出た数字が重ならないように、少しずらす
DamageNumbers.MAX = 60;
DamageNumbers.OUTLINE = '#1a0e12';
DamageNumbers.COLORS = {
    normal: { key: 'normal', top: '#ffffff', bottom: '#cdd3e6' },  // ナイフ（属性なし）
    weak:   { key: 'weak',   top: '#ffb0a0', bottom: '#ff3030' },  // 有利属性
    resist: { key: 'resist', top: '#b8d6ff', bottom: '#3a7dff' }   // 不利属性
};
// 5×7 の数字（# が色のあるドット）
DamageNumbers.FONT = {
    '0': ['.###.', '##.##', '##.##', '##.##', '##.##', '##.##', '.###.'],
    '1': ['..##.', '.###.', '..##.', '..##.', '..##.', '..##.', '.####'],
    '2': ['.###.', '##.##', '...##', '..##.', '.##..', '##...', '#####'],
    '3': ['####.', '...##', '...##', '.###.', '...##', '...##', '####.'],
    '4': ['...##', '..###', '.#.##', '#..##', '#####', '...##', '...##'],
    '5': ['#####', '##...', '####.', '...##', '...##', '##.##', '.###.'],
    '6': ['.###.', '##...', '##...', '####.', '##.##', '##.##', '.###.'],
    '7': ['#####', '...##', '..##.', '..##.', '.##..', '.##..', '.##..'],
    '8': ['.###.', '##.##', '##.##', '.###.', '##.##', '##.##', '.###.'],
    '9': ['.###.', '##.##', '##.##', '.####', '...##', '...##', '.###.']
};

window.DamageNumbers = DamageNumbers;
