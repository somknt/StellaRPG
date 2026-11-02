// 星の酒場（マルチプレイのロビー）のマップ
//
// 部品（assets/tiles/tavern/tp_*.png）を並べて作る。部品は art_source/tavern/tools/parts.ps1 で
// 「星降る酒場のタイルセット」から、主人公（絵の高さ 約 82px）に合う大きさに縮めて切り出した物
// 置き方は全体図（art_source/tavern/tavern_overview.png）を参考にした：
//   北の壁：真ん中に看板とカウンター（マスター）、左に暖炉とソファ、右にクエスト掲示板と3つの扉
//   床：まん中に赤い星のじゅうたん、南に星の魔法陣（出てくる所）、まわりに丸いテーブル、南のはしに手すりと階段
// 座標はワールドの px（1600 × 1060）
const TV_W = 1600;
const TV_H = 1060;
const TV_FLOOR_Y = 168;   // 壁の下のはし（ここから下が床）

function createTavernMapData() {
    // ===== 床の上に置く物（x = 中心、y = 下のはし。キャラと足元の奥から順に描く）=====
    //   foot：通れない所（足元の四角。[左, 上, 幅, 高さ] を、x・y からのずれで）
    const objects = [];
    const put = (img, x, y, foot = null, opt = {}) => objects.push({ img, x, y, foot, ...opt });
    // カウンター（マスターはこの後ろ。tavern.js が描く）
    put('tp_counter', 800, 282, [-150, -112, 300, 112]);
    // 左：暖炉・ソファ・ひじかけいす・低いテーブル
    put('tp_fireplace', 78, 196, [-37, -40, 74, 40]);
    put('tp_sofa', 210, 262, [-46, -42, 92, 42]);
    put('tp_armchair', 300, 268, [-26, -30, 52, 30]);
    put('tp_lowtable', 214, 318, [-32, -22, 64, 22]);
    put('tp_lamp_post', 380, 250, [-12, -14, 24, 14]);
    put('tp_plant_c', 128, 226, [-18, -14, 36, 14]);
    put('tp_barrel_pile', 52, 412, [-34, -22, 68, 22]);
    put('tp_barrel', 46, 470, [-17, -16, 34, 16]);
    put('tp_plant_a', 50, 560, [-20, -14, 40, 14]);
    put('tp_crates', 54, 760, [-20, -18, 40, 18]);
    put('tp_plant_d', 46, 860, [-20, -14, 40, 14]);
    // カウンターの左右
    put('tp_barrels', 600, 222, [-32, -18, 64, 18]);
    put('tp_plant_b', 980, 220, [-18, -12, 36, 12]);
    put('tp_lamp', 540, 300, [-10, -12, 20, 12]);
    put('tp_lamp', 1060, 300, [-10, -12, 20, 12]);
    // 右：クエスト掲示板・扉の前の明かり
    put('tp_board', 1090, 236, [-48, -26, 96, 26]);
    put('tp_crystal_b', 1180, 212, [-14, -12, 28, 12]);
    put('tp_crystal_pink', 1288, 206, [-12, -10, 24, 10]);
    put('tp_crystal_b', 1396, 212, [-14, -12, 28, 12]);
    put('tp_crystal_blue', 1504, 212, [-14, -12, 28, 12]);
    put('tp_plant_a', 1560, 240, [-20, -14, 40, 14]);
    put('tp_barrel', 1556, 420, [-17, -16, 34, 16]);
    put('tp_barrel_b', 1520, 444, [-16, -14, 32, 14]);
    put('tp_plant_c', 1556, 640, [-18, -14, 36, 14]);
    put('tp_crate', 1550, 860, [-18, -14, 36, 14]);
    // 丸いテーブルといす（じゅうたんの上）
    const tables = [[360, 520], [1240, 520], [330, 790], [1270, 790]];
    for (const [x, y] of tables) {
        put('tp_stool', x - 30, y - 22, [-12, -8, 24, 8]);
        put('tp_stool_b', x + 30, y - 22, [-12, -8, 24, 8]);
        put('tp_table', x, y + 26, [-40, -34, 80, 34]);
        put('tp_stool_b', x - 52, y + 40, [-12, -8, 24, 8]);
        put('tp_stool', x + 52, y + 40, [-12, -8, 24, 8]);
    }
    put('tp_books', 360, 520, null, { onTable: true });
    put('tp_orrery', 1240, 516, null, { onTable: true });
    put('tp_bookstack', 1270, 784, null, { onTable: true });
    // 魔法陣のまわりの星晶石の柱
    for (const [x, y] of [[660, 620], [940, 620], [640, 820], [960, 820]]) put('tp_crystal_blue', x, y, [-14, -12, 28, 12]);
    // 南の手すり（まん中は階段）
    const railY = 990;
    for (let x = 40; x < 700; x += 100) put('tp_rail_c', x + 50, railY, null, { rail: true });
    for (let x = 900; x < 1560; x += 100) put('tp_rail_c', x + 50, railY, null, { rail: true });
    put('tp_torch', 708, railY - 2, null);
    put('tp_torch', 892, railY - 2, null);
    put('tp_plant_box', 150, railY - 40, null, { rail: true });
    put('tp_plant_box', 1450, railY - 40, null, { rail: true });
    
    // ===== 床（タイル）とじゅうたん・魔法陣（平らな物）=====
    const floor = {
        tiles: ['tp_floor_a', 'tp_floor_b', 'tp_floor_c', 'tp_floor_d'],
        lit: ['tp_floor_lit', 'tp_floor_glow'],
        carpets: [
            // 暖炉の前のじゅうたん / カウンターから魔法陣への道 / 扉の前の道
            { x: 128, y: 196, w: 280, h: 168, tile: 'tp_carpet_c', edge: 'tp_carpet_b' },
            { x: 772, y: 282, w: 56, h: 336, tile: 'tp_carpet_c', edge: 'tp_carpet_c' },
            { x: 1140, y: 196, w: 392, h: 56, tile: 'tp_carpet_c', edge: 'tp_carpet_c' }
        ],
        rugs: tables.map(([x, y]) => ({ img: 'tp_rug', x, y: y + 4, s: 1.65 })),
        circle: { img: 'tp_circle', x: 800, y: 720 },
        stars: [[800, 380], [800, 470], [800, 560]]
    };
    // ===== 北の壁（左から順に並べる。高さ 約 120px）=====
    const wall = [
        'tp_wall_a', 'tp_wall_win', 'tp_wall_c', 'tp_wall_win', 'tp_wall_b', 'tp_wall_banner', 'tp_wall_c',
        'tp_wall_a', 'tp_wall_b', 'tp_wall_a', 'tp_wall_c', 'tp_wall_banner', 'tp_wall_b', 'tp_wall_a', 'tp_wall_c', 'tp_wall_b',
        'tp_wall_a', 'tp_wall_c', 'tp_wall_b', 'tp_wall_a'
    ];
    const wallDecor = [
        { img: 'tp_shelf_a', x: 690, y: TV_FLOOR_Y + 2 },
        { img: 'tp_shelf_b', x: 912, y: TV_FLOOR_Y + 2 },
        { img: 'tp_sign', x: 800, y: 86, s: 0.8 },
        { img: 'tp_curtain', x: 800, y: 70, s: 1.0 },
        { img: 'tp_flag_c', x: 470, y: 118 },
        { img: 'tp_flag_b', x: 1000, y: 118 },
        { img: 'tp_flag_a', x: 1574, y: 118 },
        { img: 'tp_lantern', x: 560, y: 108 },
        { img: 'tp_lantern', x: 1040, y: 108 },
        { img: 'tp_plant_hang', x: 300, y: 92 }
    ];
    // ===== 扉（x：扉の真ん中 / top：扉の下の名前の札の下の端（画面の上の端のボタンと重ならないように）/ doorTop：アーチの上 / y：扉の下）=====
    const doorKinds = [['coop', 'tp_door_coop', '協力プレイ', '#7fb4ff'], ['pvp', 'tp_door_pvp', 'PvP', '#ff8a9a'], ['locked', 'tp_door_lock', '？？？？', '#9a8fb8']];
    const doors = doorKinds.map(([kind, img, label, color], i) => {
        const x = 1234 + i * 108;
        return { id: kind, kind, img, label, color, x, top: TV_FLOOR_Y + 28, doorTop: 50, y: TV_FLOOR_Y + 2, w: 78,
            interact: new Vector2(x, 236), r: 70 };
    });
    // ===== 通れない所 =====
    const rects = [];
    for (const o of objects) if (o.foot) rects.push([o.x + o.foot[0], o.y + o.foot[1], o.foot[2], o.foot[3]]);
    // 歩ける所（壁の下・手すりの上まで）
    const walk = [[22, 192], [1578, 192], [1578, 952], [22, 952]];
    return {
        id: 'star_tavern',
        name: '星の酒場',
        safeZone: true,
        width: TV_W / 20, height: TV_H / 20, tileSize: 20,
        layers: {
            ground: { walk },
            groundDecoration: [], structures: [], objects: [], abovePlayer: [],
            collision: { rects, shotRects: [] },
            spawnPoints: { player: { x: 800, y: 700 }, enemies: {} },
            spawn: { x: 800, y: 700, rx: 70, ry: 44 },                       // 星の魔法陣（ここから出てくる）
            master: { x: 800, y: 214, interact: new Vector2(800, 330), r: 95, markY: 92 },   // マスター（絵の下のはし＝カウンターの上）と、話せる所
            board: { x: 1090, y: 236, interact: new Vector2(1090, 300), r: 80, markY: 116 },   // クエスト掲示板
            doors,
            fireplace: { x: 78, y: 160 },
            circle: { x: 800, y: 720 },
            floor, wall, wallDecor, tavernObjects: objects
        }
    };
}

class TavernMap extends ArenaMap {
    constructor(data) {
        super(data);
        this.walk = this.layers.ground.walk;
        this.time = 0;
        this.bg = null;
    }
    
    getPlayerSpawn() {
        const s = this.layers.spawn;
        return new Vector2(s.x, s.y);
    }
    
    // 魔法陣の中の、空いている所（ほかの人と重なりにくいように、少しばらす）
    randomSpawn() {
        const s = this.layers.spawn;
        const a = Math.random() * Math.PI * 2, k = 0.35 + 0.65 * Math.sqrt(Math.random());
        return new Vector2(s.x + Math.cos(a) * s.rx * k, s.y + Math.sin(a) * s.ry * k);
    }
    
    // 多角形の中か
    inWalkArea(x, y) {
        const P = this.walk;
        let inside = false;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
            const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }
    
    isBoxBlocked(cx, cy, hw, hh) {
        const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
        if (!this.inWalkArea(x0, y0) || !this.inWalkArea(x1, y0) || !this.inWalkArea(x0, y1) || !this.inWalkArea(x1, y1)) return true;
        for (const r of this.solidRects) {
            if (x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h) return true;
        }
        return false;
    }
    
    isShotBlocked() { return false; }
    update(dt) { this.time += dt; }
    buildBackground() {}
    
    // 床・壁・平らな物を、一度だけ1枚の絵に描いておく（毎フレームは見えている所を切り出すだけ）
    makeBackground() {
        const L = this.layers, F = L.floor;
        if (!this.img(F.tiles[0])) return null;
        const c = document.createElement('canvas');
        c.width = TV_W; c.height = TV_H;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.fillStyle = '#140b16';
        g.fillRect(0, 0, TV_W, TV_H);
        // 床：同じ並びにならないように、決まった乱数でタイルを選ぶ（ときどき光っているタイル）
        let seed = 7;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let y = TV_FLOOR_Y - 56; y < 1004; y += 56) {
            for (let x = 0; x < TV_W; x += 56) {
                const r = rnd();
                const name = r < 0.07 ? F.lit[Math.floor(rnd() * F.lit.length)] : F.tiles[Math.floor(rnd() * F.tiles.length)];
                const im = this.img(name);
                if (im) g.drawImage(im, x, y);
            }
        }
        // 床の南のはし（手すりの外は暗い段差）
        const grad = g.createLinearGradient(0, 990, 0, TV_H);
        grad.addColorStop(0, 'rgba(10, 4, 14, 0.2)');
        grad.addColorStop(1, 'rgba(10, 4, 14, 1)');
        g.fillStyle = grad;
        g.fillRect(0, 990, TV_W, TV_H - 990);
        const stairs = this.img('tp_stairs');
        if (stairs) { g.drawImage(stairs, 800 - stairs.width / 2, 990); g.drawImage(stairs, 800 - stairs.width / 2, 1022); }
        // じゅうたん
        for (const cp of F.carpets) {
            const im = this.img(cp.tile), ed = this.img(cp.edge);
            for (let y = cp.y; y < cp.y + cp.h; y += 56) {
                for (let x = cp.x; x < cp.x + cp.w; x += 56) {
                    const edge = x === cp.x || y === cp.y || x + 56 >= cp.x + cp.w || y + 56 >= cp.y + cp.h;
                    const t = edge && ed ? ed : im;
                    if (t) g.drawImage(t, x, y);
                }
            }
            g.strokeStyle = 'rgba(214, 164, 70, 0.85)';
            g.lineWidth = 3;
            g.strokeRect(cp.x + 1.5, cp.y + 1.5, cp.w - 3, cp.h - 3);
        }
        // テーブルの下の星のじゅうたん・魔法陣・床の星
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        for (const r of F.rugs) {
            const im = this.img(r.img);
            if (!im) continue;
            const w = im.width * r.s, h = im.height * r.s * 0.72;
            g.drawImage(im, r.x - w / 2, r.y - h / 2, w, h);
        }
        const ci = this.img(F.circle.img);
        if (ci) g.drawImage(ci, F.circle.x - ci.width / 2, F.circle.y - ci.height / 2);
        g.imageSmoothingEnabled = false;
        const st = this.img('tp_star');
        if (st) for (const [x, y] of F.stars) g.drawImage(st, x - st.width / 2, y - st.height / 2);
        // 北の壁：上のはり（暗い木）→ 壁の板 → 壁にかけた物 → 扉
        const beam = g.createLinearGradient(0, 0, 0, 60);
        beam.addColorStop(0, '#1c0f0c');
        beam.addColorStop(1, '#3a2014');
        g.fillStyle = beam;
        g.fillRect(0, 0, TV_W, 60);
        let x = 0, i = 0;
        while (x < TV_W) {
            const im = this.img(L.wall[i % L.wall.length]);
            i++;
            if (!im) { x += 80; continue; }
            g.drawImage(im, x, TV_FLOOR_Y - im.height);
            x += im.width - 2;
        }
        g.fillStyle = '#5a3418';
        g.fillRect(0, TV_FLOOR_Y - 4, TV_W, 6);
        for (const d of L.wallDecor) {
            const im = this.img(d.img);
            if (!im) continue;
            const s = d.s || 1;
            if (s !== 1) { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; }
            g.drawImage(im, Math.round(d.x - im.width * s / 2), Math.round(d.y - im.height * s), Math.round(im.width * s), Math.round(im.height * s));
            g.imageSmoothingEnabled = false;
        }
        for (const d of L.doors) {
            const im = this.img(d.img);
            if (im) g.drawImage(im, Math.round(d.x - im.width / 2), d.y - im.height);
            // 扉の下の名前の札
            g.font = 'bold 15px "DotGothic16", sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            const tw = Math.max(64, g.measureText(d.label).width + 18);
            g.fillStyle = 'rgba(18, 10, 30, 0.92)';
            g.strokeStyle = '#d8a74a';
            g.lineWidth = 2;
            g.beginPath();
            if (g.roundRect) g.roundRect(d.x - tw / 2, d.top - 22, tw, 22, 5); else g.rect(d.x - tw / 2, d.top - 22, tw, 22);
            g.fill(); g.stroke();
            g.fillStyle = '#ffe9b0';
            g.fillText(d.label, d.x, d.top - 10);
        }
        return c;
    }
    
    draw(ctx, camera) {
        const cx = Math.round(camera.x), cy = Math.round(camera.y);
        const vw = ctx.canvas.width, vh = ctx.canvas.height;
        if (!this.bg) this.bg = this.makeBackground();
        ctx.fillStyle = '#140b16';
        ctx.fillRect(0, 0, vw, vh);
        if (this.bg) {
            const sx = Math.max(0, cx), sy = Math.max(0, cy);
            const sw = Math.min(TV_W - sx, vw), sh = Math.min(TV_H - sy, vh);
            if (sw > 0 && sh > 0) ctx.drawImage(this.bg, sx, sy, sw, sh, sx - cx, sy - cy, sw, sh);
        }
        this.drawGlow(ctx, cx, cy, true);
    }
    
    // 床に置いた物（キャラと一緒に、足元の奥から描く）：[{ sortY, draw(ctx, cam) }]
    getDepthItems() {
        return this.layers.tavernObjects.map(o => ({
            sortY: o.onTable ? o.y + 30 : o.y - (o.rail ? 40 : 0),
            draw: (ctx, cam) => {
                const im = this.img(o.img);
                if (!im) return;
                const y = o.onTable ? o.y - 8 : o.y;
                ctx.drawImage(im, Math.round(o.x - im.width / 2 - cam.x), Math.round(y - im.height - cam.y));
            }
        }));
    }
    
    // 暖炉・魔法陣・明かりの光がゆらめく（床の上にうすく光を足す）
    drawGlow(ctx, cx, cy) {
        const L = this.layers, t = this.time;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fp = L.fireplace;
        const f = 0.5 + 0.25 * Math.sin(t * 7.3) + 0.15 * Math.sin(t * 13.1);
        let g = ctx.createRadialGradient(fp.x - cx, fp.y - cy, 0, fp.x - cx, fp.y - cy, 170);
        g.addColorStop(0, `rgba(255, 150, 60, ${0.22 * f})`);
        g.addColorStop(1, 'rgba(255, 120, 40, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(fp.x - cx - 170, fp.y - cy - 170, 340, 340);
        const c = L.circle;
        const p = 0.5 + 0.5 * Math.sin(t * 1.6);
        ctx.save();
        ctx.translate(c.x - cx, c.y - cy);
        g = ctx.createRadialGradient(0, 0, 0, 0, 0, 180);
        g.addColorStop(0, `rgba(170, 140, 255, ${0.12 + 0.08 * p})`);
        g.addColorStop(1, 'rgba(120, 80, 255, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, 180, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // 明かりのまわり
        for (const o of L.tavernObjects) {
            if (!/lamp|torch|crystal|lantern/.test(o.img)) continue;
            const blue = /crystal/.test(o.img);
            const k = 0.75 + 0.25 * Math.sin(t * 3 + o.x * 0.01);
            const gx = o.x - cx, gy = o.y - 60 - cy;
            g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 80);
            g.addColorStop(0, blue ? `rgba(120, 170, 255, ${0.16 * k})` : `rgba(255, 190, 90, ${0.16 * k})`);
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(gx - 80, gy - 80, 160, 160);
        }
        ctx.restore();
    }
    
    getDepthDrawables() { return []; }
    drawAbove() {}
    
    drawCollisionDebug(ctx, camera) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 40, 0, 0.35)';
        for (const r of this.solidRects) ctx.fillRect(r.x - camera.x, r.y - camera.y, r.w, r.h);
        ctx.strokeStyle = 'rgba(0, 255, 120, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        this.walk.forEach(([x, y], i) => (i ? ctx.lineTo(x - camera.x, y - camera.y) : ctx.moveTo(x - camera.x, y - camera.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }
}

window.createTavernMapData = createTavernMapData;
window.TavernMap = TavernMap;
window.TV_W = TV_W;
window.TV_H = TV_H;
