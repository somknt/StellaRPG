// バトルモードの闘技場マップ
//
// 素材：js_version/assets/tiles/arena/*.png（art_source/arena/arena_parts_sheet.png から1つずつ切り出した物）
// 配置：art_source/arena/arena_overview.png（全体の完成イメージ）を参考に、パーツを並べて作る
//
// レイヤー：
//   ground           … 石畳・砂地・中央の道（地面）
//   groundDecoration … 星の紋章・砂の小石や草・がれき（通れる）
//   structures       … 観客席・北の壁・門・壁の旗・横の壁と柱（キャラより奥。まとめて1枚に描いておく）
//   objects          … 石像・かがり火・柵・屋台・樽・木箱・武器立て・南の壁（キャラと奥行き順に描く）
//   abovePlayer      … （今はなし。必要になったらここに足す）
//   collision        … 当たり判定（px の四角。画像の透明部分ではなく、実際の障害物の足元に合わせる）
//   spawnPoints      … プレイヤー・敵の出現位置
//   （Effects：魔法陣・攻撃・ダメージは MagicSystem / EnemySpawner が描く）
//
// 座標はすべてワールドの px（1タイル = 48px、32×24タイル = 1536×1152px）

const ARENA_TILE = 48;

// 素材のもとの大きさ（画像がまだ読めない時の配置計算にも使う）
const ARENA_PART_SIZE = {
    arena_sand: [182, 192], arena_sand_rocks: [182, 193], arena_stone_floor: [183, 193], arena_stone_floor_b: [183, 193],
    arena_star_symbol: [185, 193], arena_sand_rocks_b: [183, 192], arena_sand_rocks_c: [184, 193], arena_sand_grass: [182, 192],
    arena_wall: [196, 175], arena_wall_b: [171, 175], arena_gate: [227, 179], arena_gate_frame: [227, 179], arena_gate_bars: [227, 179],
    arena_pillar: [80, 184], arena_pillar_b: [79, 180], arena_banner_small: [108, 151], arena_banner: [132, 176],
    arena_brazier: [101, 181], arena_brazier_b: [102, 158], arena_brazier_empty: [102, 116],
    arena_stairs: [170, 179], arena_stairs_wide: [238, 183], arena_stands_curve: [227, 186], arena_stands_curve_b: [251, 189],
    arena_stands_corner: [207, 216], arena_stands_side: [122, 189], arena_stands_curve_big: [185, 216],
    arena_statue: [102, 188], arena_banner_pole: [73, 187], arena_fence: [160, 100], arena_fence_vines: [140, 99],
    arena_stall: [139, 159], arena_barrel: [74, 93], arena_barrel_b: [76, 83], arena_crate: [69, 91],
    arena_weapon_rack: [99, 130], arena_spear_rack: [82, 159], arena_flower_bush: [174, 127], arena_rubble: [157, 84]
};
// 門の画像の中の、鉄格子のアーチの形（門の画像の px）
const ARENA_GATE_ARCH = { cx: 114, cy: 116, r: 57, x0: 57, x1: 171, bottom: 161 };

// 決まった並びの乱数（毎回同じ見た目にする）
function arenaRandom(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------- マップデータ ----------
function createArenaMapData() {
    const W = 32, H = 24, WPX = W * ARENA_TILE, HPX = H * ARENA_TILE; // 1536 × 1152
    
    // 置き物の定義を作る：x = 横の中心、y = 下端（足元）、s = 拡大率
    // col: [幅, 高さ] 足元の当たり判定（px）。shot: 魔術の弾も止める。glow: 火の光
    const part = (img, x, y, s, opt = {}) => {
        const [nw, nh] = ARENA_PART_SIZE[img];
        const w = nw * s, h = nh * s;
        const d = { img, x, y, s, w, h, flip: !!opt.flip, glow: !!opt.glow, shot: !!opt.shot, sortY: opt.sortY ?? y };
        if (opt.col) d.collision = [x - opt.col[0] / 2, y - opt.col[1], opt.col[0], opt.col[1]];
        return d;
    };
    
    // ===== Ground =====
    const FLOOR = { x: 120, y: 270, w: WPX - 240, h: HPX - 270 };       // 石畳（壁の内側全部）
    const SAND = { x: 236, y: 396, w: WPX - 472, h: 572, r: 190 };      // 砂地（角の丸い楕円っぽい形）
    const STAR = { x: WPX / 2, y: SAND.y + SAND.h / 2, r: 168 };        // 中央の星の紋章
    const PATH_W = 96;                                                    // 北の門〜紋章〜南の入口の石の道
    const paths = [
        { x: WPX / 2 - PATH_W / 2, y: FLOOR.y, w: PATH_W, h: STAR.y - STAR.r - FLOOR.y + 10 },
        { x: WPX / 2 - PATH_W / 2, y: STAR.y + STAR.r - 10, w: PATH_W, h: HPX - (STAR.y + STAR.r - 10) }
    ];
    
    // ===== GroundDecoration =====
    const groundDecoration = [{ type: 'star_symbol', ...STAR }];
    const rnd = arenaRandom(20261025);
    const stampImgs = ['arena_sand_rocks', 'arena_sand_rocks_b', 'arena_sand_rocks_c', 'arena_sand_grass'];
    for (let i = 0, tries = 0; i < 12 && tries < 400; tries++) {
        const x = SAND.x + 90 + rnd() * (SAND.w - 180), y = SAND.y + 80 + rnd() * (SAND.h - 160);
        if (Math.hypot(x - STAR.x, y - STAR.y) < STAR.r + 90) continue;     // 紋章の上には置かない
        if (Math.abs(x - WPX / 2) < PATH_W) continue;                       // 道の上にも置かない
        if (groundDecoration.some(d => d.type === 'stamp' && Math.hypot(d.x - x, d.y - y) < 170)) continue;
        groundDecoration.push({ type: 'stamp', img: stampImgs[i % stampImgs.length], x, y, s: 0.85 });
        i++;
    }
    // 壁ぎわのがれき
    for (const [x, y] of [[175, 1012], [1361, 1012], [180, 330], [1356, 330]]) {
        groundDecoration.push({ type: 'sprite', ...part('arena_rubble', x, y, 0.38) });
    }
    
    // ===== Structures（キャラより奥。まとめて1枚に描く） =====
    const structures = [];
    // 北の観客席（2段）
    for (let x = 95, i = 0; x < WPX + 100; x += 186, i++) structures.push(part('arena_stairs_wide', x, 80, 0.8));
    for (let x = 0, i = 0; x < WPX + 100; x += 186, i++) structures.push(part('arena_stairs_wide', x, 196, 0.8));
    // 横の観客席（西・東）
    for (let y = 400; y < HPX + 170; y += 160) {
        structures.push(part('arena_stands_side', 52, y, 0.9));
        structures.push(part('arena_stands_side', WPX - 52, y, 0.9, { flip: true }));
    }
    // 北の観客席の角
    structures.push(part('arena_stands_corner', 92, 300, 0.92));
    structures.push(part('arena_stands_corner', WPX - 92, 300, 0.92, { flip: true }));
    // 北の壁（門の左右に石の壁を並べる）
    const GATE_S = 1.4, gateW = ARENA_PART_SIZE.arena_gate[0] * GATE_S;
    const WALL_S = 0.78, WALL_Y = 300;
    const wallPieces = ['arena_wall', 'arena_wall_b'];
    let wx = WPX / 2 - gateW / 2, k = 0;
    while (wx > -40) {
        const img = wallPieces[k++ % 2], w = ARENA_PART_SIZE[img][0] * WALL_S;
        structures.push(part(img, wx - w / 2 + 2, WALL_Y, WALL_S));
        wx -= w - 4;
    }
    wx = WPX / 2 + gateW / 2; k = 0;
    while (wx < WPX + 40) {
        const img = wallPieces[k++ % 2], w = ARENA_PART_SIZE[img][0] * WALL_S;
        structures.push(part(img, wx + w / 2 - 2, WALL_Y, WALL_S, { flip: true }));
        wx += w - 4;
    }
    // 北の大きな鉄格子の門（格子は開け閉めで動くので別に描く）
    const gate = { ...part('arena_gate_frame', WPX / 2, WALL_Y + 2, GATE_S), type: 'gate' };
    structures.push(gate);
    // 壁の赤い旗
    for (const x of [216, 430, WPX - 430, WPX - 216]) structures.push(part('arena_banner', x, 268, 0.5));
    // 壁の上の花
    for (const x of [300, WPX - 300]) structures.push(part('arena_flower_bush', x, 196, 0.42));
    // 横の壁のふち（上から見た低い壁）と柱
    const LEDGE = 34;
    structures.push({ type: 'ledge', x: FLOOR.x - 6, y: FLOOR.y - 20, w: LEDGE, h: HPX - FLOOR.y });
    structures.push({ type: 'ledge', x: FLOOR.x + FLOOR.w - LEDGE + 6, y: FLOOR.y - 20, w: LEDGE, h: HPX - FLOOR.y });
    for (const y of [470, 700, 930]) {
        structures.push(part('arena_pillar_b', FLOOR.x + 11, y, 0.5));
        structures.push(part('arena_pillar_b', FLOOR.x + FLOOR.w - 11, y, 0.5, { flip: true }));
    }
    
    // ===== Objects（キャラと奥行き順） =====
    const objects = [
        // 北：門の両わきのかがり火と騎士の石像、柵
        part('arena_brazier', WPX / 2 - gateW / 2 - 38, 338, 0.68, { col: [48, 20], glow: true }),
        part('arena_brazier', WPX / 2 + gateW / 2 + 38, 338, 0.68, { col: [48, 20], glow: true }),
        part('arena_statue', 476, 352, 0.8, { col: [66, 26], shot: true }),
        part('arena_statue', WPX - 476, 352, 0.8, { col: [66, 26], shot: true, flip: true }),
        part('arena_fence', 287, 342, 0.6, { col: [92, 14] }),
        part('arena_fence', 372, 342, 0.6, { col: [92, 14] }),
        part('arena_fence', WPX - 372, 342, 0.6, { col: [92, 14] }),
        part('arena_fence', WPX - 287, 342, 0.6, { col: [92, 14] }),
        // 西：武器立て・かがり火・樽・槍立て・柵
        part('arena_weapon_rack', 196, 472, 0.7, { col: [62, 20], shot: true }),
        part('arena_brazier_b', 268, 488, 0.68, { col: [46, 18], glow: true }),
        part('arena_barrel', 194, 566, 0.7, { col: [44, 16] }),
        part('arena_spear_rack', 196, 880, 0.62, { col: [44, 16], shot: true }),
        part('arena_fence_vines', 262, 968, 0.6, { col: [80, 14] }),
        part('arena_banner_pole', 182, 760, 0.75, { col: [18, 12] }),
        // 東：赤い屋根の屋台・樽・木箱・かがり火・柵
        part('arena_stall', 1290, 566, 0.95, { col: [118, 40], shot: true }),
        part('arena_barrel_b', 1198, 584, 0.7, { col: [44, 16] }),
        part('arena_barrel', 1378, 596, 0.7, { col: [44, 16] }),
        part('arena_crate', 1366, 470, 0.75, { col: [48, 22], shot: true }),
        part('arena_brazier', 1218, 448, 0.62, { col: [44, 18], glow: true }),
        part('arena_fence_vines', WPX - 262, 968, 0.6, { col: [80, 14], flip: true }),
        part('arena_banner_pole', WPX - 182, 760, 0.75, { col: [18, 12], flip: true }),
        // 南：入口の両わきのかがり火・柵・柱
        part('arena_brazier', WPX / 2 - 170, 1030, 0.68, { col: [48, 20], glow: true }),
        part('arena_brazier', WPX / 2 + 170, 1030, 0.68, { col: [48, 20], glow: true }),
        part('arena_fence', 306, 1034, 0.6, { col: [92, 14] }),
        part('arena_fence', 392, 1034, 0.6, { col: [92, 14] }),
        part('arena_fence', 478, 1034, 0.6, { col: [92, 14] }),
        part('arena_fence', WPX - 478, 1034, 0.6, { col: [92, 14] }),
        part('arena_fence', WPX - 392, 1034, 0.6, { col: [92, 14] }),
        part('arena_fence', WPX - 306, 1034, 0.6, { col: [92, 14] })
    ];
    // 南の壁（入口の左右）。キャラより手前に来ることがあるので奥行き順に描く
    const ENT = { x0: WPX / 2 - 96, x1: WPX / 2 + 96 };
    wx = ENT.x0; k = 0;
    while (wx > -40) {
        const img = wallPieces[k++ % 2], w = ARENA_PART_SIZE[img][0] * WALL_S;
        objects.push(part(img, wx - w / 2 + 2, HPX + 26, WALL_S));
        wx -= w - 4;
    }
    wx = ENT.x1; k = 0;
    while (wx < WPX + 40) {
        const img = wallPieces[k++ % 2], w = ARENA_PART_SIZE[img][0] * WALL_S;
        objects.push(part(img, wx + w / 2 - 2, HPX + 26, WALL_S, { flip: true }));
        wx += w - 4;
    }
    objects.push(part('arena_pillar', ENT.x0 - 6, HPX + 6, 0.72));
    objects.push(part('arena_pillar', ENT.x1 + 6, HPX + 6, 0.72, { flip: true }));
    for (const x of [270, WPX - 270]) objects.push(part('arena_banner', x, HPX - 8, 0.5, { sortY: HPX + 40 }));
    for (const x of [130, WPX - 130]) objects.push(part('arena_flower_bush', x, HPX - 56, 0.42, { sortY: HPX + 41 }));
    
    // ===== Collision（通れない所。px の四角） =====
    const SOUTH_Y = 1040;
    const rects = [
        [0, 0, WPX, 300],                                       // 北の壁・門・観客席
        [0, 0, FLOOR.x + 30, HPX],                               // 西の壁
        [FLOOR.x + FLOOR.w - 30, 0, WPX, HPX],                   // 東の壁
        [0, SOUTH_Y, ENT.x0 + 8, HPX],                           // 南の壁（入口の左）
        [ENT.x1 - 8, SOUTH_Y, WPX, HPX],                         // 南の壁（入口の右）
        [0, HPX - 40, WPX, 40]                                   // 入口の奥（トンネル）
    ];
    for (const o of objects) if (o.collision) rects.push(o.collision);
    
    // ===== SpawnPoints =====
    const spawnPoints = {
        player: { x: WPX / 2, y: 950 },
        enemies: {
            north: [{ x: WPX / 2, y: 362, gate: true }, { x: WPX / 2 - 70, y: 384, gate: true }, { x: WPX / 2 + 70, y: 384, gate: true }],
            northWest: [{ x: 330, y: 452 }],
            northEast: [{ x: 1110, y: 472 }],
            west: [{ x: 320, y: 690 }, { x: 330, y: 800 }],
            east: [{ x: 1216, y: 690 }, { x: 1206, y: 800 }]
        }
    };
    
    return {
        id: 'battle_arena',
        name: '星の闘技場',
        safeZone: false,
        width: W, height: H, tileSize: ARENA_TILE,
        layers: {
            ground: { floor: FLOOR, sand: SAND, paths, entrance: ENT },
            groundDecoration, structures, objects, abovePlayer: [],
            collision: { rects, shotRects: [rects[0], rects[1], rects[2], rects[3], rects[4], ...objects.filter(o => o.shot).map(o => o.collision)] },
            spawnPoints
        }
    };
}

// ---------- 闘技場マップ（Map と同じ使い方ができる） ----------
class ArenaMap extends Map {
    constructor(data) {
        super(data.width, data.height, data.tileSize, null);
        this.mapData = data;
        this.layers = data.layers;
        this.collisionEnabled = true; // キャラは壁や障害物をすり抜けない
        this.gateOpen = 0;            // 北の門の格子の上がり具合（0=閉 1=全開）
        this.gateTarget = 0;
        this.time = 0;
        // タイルは全部「通れる」。通れない所は px の四角（solidRects）で決める
        const g = this.layers.ground;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const cx = (x + 0.5) * this.tileSize, cy = (y + 0.5) * this.tileSize;
                const inSand = !!g.sand && cx > g.sand.x && cx < g.sand.x + g.sand.w && cy > g.sand.y && cy < g.sand.y + g.sand.h;
                this.tiles[y][x] = { type: inSand ? 'sand' : 'stone', walkable: true, color: '#000' };
            }
        }
        const toRect = (r) => ({ x: r[0], y: r[1], w: r[2], h: r[3] });
        this.solidRects = this.layers.collision.rects.map(toRect);
        this.shotRects = this.layers.collision.shotRects.map(toRect);
        this.gate = this.layers.structures.find(s => s.type === 'gate');
        this.background = null;
        this.spriteCache = {};
    }
    
    getPlayerSpawn() {
        const p = this.layers.spawnPoints.player;
        return new Vector2(p.x, p.y);
    }
    
    getEnemySpawnPoints() {
        const out = {};
        for (const [k, list] of Object.entries(this.layers.spawnPoints.enemies)) {
            out[k] = list.map(p => ({ position: new Vector2(p.x, p.y), gate: !!p.gate }));
        }
        return out;
    }
    
    setGateOpen(open) { this.gateTarget = open ? 1 : 0; }
    
    update(deltaTime) {
        this.time += deltaTime;
        const speed = 1.6;
        if (this.gateOpen < this.gateTarget) this.gateOpen = Math.min(this.gateTarget, this.gateOpen + speed * deltaTime);
        if (this.gateOpen > this.gateTarget) this.gateOpen = Math.max(this.gateTarget, this.gateOpen - speed * deltaTime);
    }
    
    // ---------- 画像 ----------
    img(name) {
        return window.assetManager ? window.assetManager.get(name) : null;
    }
    
    // 拡大率ごとに一度だけ縮小・拡大した画像を作って使い回す
    // 縮小はなめらかに（細かい模様がつぶれないように）、拡大は最近傍補間（ドットがぼやけないように）
    scaled(name, s, flip) {
        const key = `${name}|${s}|${flip ? 1 : 0}`;
        if (key in this.spriteCache) return this.spriteCache[key];
        const src = this.img(name);
        if (!src) return null;
        const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = s < 1;
        if (s < 1) g.imageSmoothingQuality = 'high';
        if (flip) { g.translate(w, 0); g.scale(-1, 1); }
        g.drawImage(src, 0, 0, w, h);
        this.spriteCache[key] = c;
        return c;
    }
    
    // 置き物を1つ描く（x = 中心、y = 下端）
    drawPart(ctx, d, ox = 0, oy = 0) {
        const left = Math.round(d.x - d.w / 2 - ox), top = Math.round(d.y - d.h - oy);
        const c = this.scaled(d.img, d.s, d.flip);
        if (c) ctx.drawImage(c, left, top);
        else { ctx.fillStyle = 'rgba(120, 100, 80, 0.6)'; ctx.fillRect(left, top, d.w, d.h); } // 画像がない時
    }
    
    // 模様（石畳・砂）を敷くためのパターン
    pattern(g, name, s, inset = 0, mirror = false) {
        const src = this.img(name);
        if (!src) return null;
        const sw = src.width - inset * 2, sh = src.height - inset * 2;
        const w = Math.round(sw * s), h = Math.round(sh * s);
        const c = document.createElement('canvas');
        c.width = mirror ? w * 2 : w; c.height = mirror ? h * 2 : h;
        const t = c.getContext('2d');
        t.imageSmoothingEnabled = s < 1;
        if (s < 1) t.imageSmoothingQuality = 'high';
        // 鏡に映したように4枚並べると、つなぎ目が目立たない
        const quads = mirror ? [[0, 0, 1, 1], [1, 0, -1, 1], [0, 1, 1, -1], [1, 1, -1, -1]] : [[0, 0, 1, 1]];
        for (const [qx, qy, fx, fy] of quads) {
            t.save();
            t.translate(qx * w + (fx < 0 ? w : 0), qy * h + (fy < 0 ? h : 0));
            t.scale(fx, fy);
            t.drawImage(src, inset, inset, sw, sh, 0, 0, w, h);
            t.restore();
        }
        return g.createPattern(c, 'repeat');
    }
    
    // ---------- 動かない物をまとめて1枚に描く ----------
    buildBackground() {
        const W = this.width * this.tileSize, H = this.height * this.tileSize;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        const L = this.layers, gr = L.ground;
        
        g.fillStyle = '#3d352c';
        g.fillRect(0, 0, W, H);
        
        // 石畳（壁の内側全部）
        const stone = this.pattern(g, 'arena_stone_floor', 0.6, 2);
        g.fillStyle = stone || '#a08f7c';
        g.fillRect(gr.floor.x, gr.floor.y, gr.floor.w, gr.floor.h);
        
        // 砂地（角の丸い四角）。ふちは少し暗くして、石畳との境目をなじませる
        const sandPath = () => {
            const s = gr.sand;
            g.beginPath();
            if (g.roundRect) g.roundRect(s.x, s.y, s.w, s.h, s.r);
            else g.rect(s.x, s.y, s.w, s.h);
        };
        const sand = this.pattern(g, 'arena_sand', 1, 30, true);
        sandPath();
        g.fillStyle = sand || '#d4ac6c';
        g.fill();
        g.save();
        sandPath(); g.clip();
        g.lineWidth = 26; g.strokeStyle = 'rgba(120, 82, 40, 0.16)'; sandPath(); g.stroke();
        g.restore();
        g.lineWidth = 4; g.strokeStyle = 'rgba(92, 70, 48, 0.55)'; sandPath(); g.stroke();
        g.lineWidth = 2; g.strokeStyle = 'rgba(232, 206, 160, 0.5)'; sandPath(); g.stroke();
        
        // 砂の上の小石・草（まわりをぼかしてなじませる）
        for (const d of L.groundDecoration) if (d.type === 'stamp') this.drawStamp(g, d);
        
        // 北の門〜紋章〜南の入口の石の道
        for (const p of gr.paths) {
            g.fillStyle = stone || '#a08f7c';
            g.fillRect(p.x, p.y, p.w, p.h);
            g.fillStyle = 'rgba(70, 52, 36, 0.45)';
            g.fillRect(p.x - 3, p.y, 3, p.h); g.fillRect(p.x + p.w, p.y, 3, p.h);
        }
        
        // 中央の星の紋章
        for (const d of L.groundDecoration) {
            if (d.type === 'star_symbol') this.drawStarSymbol(g, d);
            if (d.type === 'sprite') this.drawPart(g, d);
        }
        
        // 南の入口の奥（暗いトンネル）
        const e = gr.entrance;
        const tg = g.createLinearGradient(0, H - 70, 0, H);
        tg.addColorStop(0, 'rgba(10, 6, 4, 0)');
        tg.addColorStop(1, 'rgba(10, 6, 4, 0.92)');
        g.fillStyle = tg;
        g.fillRect(e.x0, H - 70, e.x1 - e.x0, 70);
        
        // Structures（観客席・壁・門の枠・旗など）
        for (const s of L.structures) {
            if (s.type === 'ledge') this.drawLedge(g, s, stone);
            else this.drawPart(g, s);
        }
        this.background = c;
    }
    
    drawStamp(g, d) {
        const src = this.img(d.img);
        if (!src) return;
        const inset = 18;
        const w = Math.round((src.width - inset * 2) * d.s), h = Math.round((src.height - inset * 2) * d.s);
        const t = document.createElement('canvas');
        t.width = w; t.height = h;
        const c = t.getContext('2d');
        c.imageSmoothingEnabled = true;
        c.drawImage(src, inset, inset, src.width - inset * 2, src.height - inset * 2, 0, 0, w, h);
        c.globalCompositeOperation = 'destination-in';
        const rg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.min(w, h) * 0.5);
        rg.addColorStop(0, 'rgba(0,0,0,1)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = rg;
        c.fillRect(0, 0, w, h);
        g.drawImage(t, Math.round(d.x - w / 2), Math.round(d.y - h / 2));
    }
    
    drawStarSymbol(g, d) {
        const src = this.img('arena_star_symbol');
        if (!src) return;
        // 素材の中の紋章の円：中心 (92, 96)、半径 約89px
        const k = d.r / 89;
        g.save();
        g.beginPath();
        g.arc(d.x, d.y, d.r + 2, 0, Math.PI * 2);
        g.clip();
        g.imageSmoothingEnabled = false; // 拡大なので最近傍補間
        g.drawImage(src, d.x - 92 * k, d.y - 96 * k, src.width * k, src.height * k);
        g.restore();
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(92, 70, 48, 0.5)';
        g.beginPath(); g.arc(d.x, d.y, d.r + 1, 0, Math.PI * 2); g.stroke();
    }
    
    // 横の壁のふち（上から見た低い石の壁）
    drawLedge(g, s, stone) {
        g.fillStyle = stone || '#a08f7c';
        g.fillRect(s.x, s.y, s.w, s.h);
        g.fillStyle = 'rgba(255, 240, 210, 0.18)';
        g.fillRect(s.x, s.y, s.w, s.h);
        g.fillStyle = 'rgba(60, 44, 30, 0.6)';
        g.fillRect(s.x, s.y, 3, s.h); g.fillRect(s.x + s.w - 3, s.y, 3, s.h);
        g.fillStyle = 'rgba(255, 245, 225, 0.35)';
        g.fillRect(s.x + 3, s.y, 2, s.h);
    }
    
    draw(ctx, camera) {
        if (!this.background) this.buildBackground();
        const cx = Math.round(camera.x), cy = Math.round(camera.y);
        const vw = ctx.canvas.width, vh = ctx.canvas.height;
        const sx = Math.max(0, cx), sy = Math.max(0, cy);
        const sw = Math.min(this.background.width - sx, vw - (sx - cx));
        const sh = Math.min(this.background.height - sy, vh - (sy - cy));
        if (sw > 0 && sh > 0) ctx.drawImage(this.background, sx, sy, sw, sh, sx - cx, sy - cy, sw, sh);
        this.drawGateBars(ctx, cx, cy);
    }
    
    // 門の鉄格子：開く時は上へ引き上げる（アーチの形で切り抜く）
    drawGateBars(ctx, cx, cy) {
        const d = this.gate;
        if (!d) return;
        const bars = this.scaled('arena_gate_bars', d.s, false);
        if (!bars) return;
        const left = Math.round(d.x - d.w / 2 - cx), top = Math.round(d.y - d.h - cy), k = d.s, A = ARENA_GATE_ARCH;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(left + A.x0 * k, top + A.bottom * k);
        ctx.lineTo(left + A.x0 * k, top + A.cy * k);
        ctx.arc(left + A.cx * k, top + A.cy * k, A.r * k, Math.PI, 0);
        ctx.lineTo(left + A.x1 * k, top + A.bottom * k);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(bars, left, top - Math.round((A.bottom - (A.cy - A.r)) * k * 0.92 * this.gateOpen));
        ctx.restore();
    }
    
    // キャラと奥行き順に並べて描く物（sortY が小さい物ほど奥）
    getDepthDrawables(player) {
        return this.layers.objects.map(o => ({ sortY: o.sortY, draw: (ctx, camera) => this.drawObject(ctx, camera, o, player) }));
    }
    
    drawObject(ctx, camera, o, player) {
        const cx = Math.round(camera.x), cy = Math.round(camera.y);
        ctx.save();
        // プレイヤーが物の後ろに隠れたら、物を半透明にして見えるようにする
        if (player) {
            const p = player.position, feet = p.y + player.drawSize * 0.4;
            const left = o.x - o.w / 2, top = o.y - o.h;
            const behind = feet < o.sortY && p.x > left - 10 && p.x < left + o.w + 10 && p.y + player.drawSize * 0.3 > top && p.y - player.drawSize * 0.5 < o.y;
            if (behind) ctx.globalAlpha = 0.55;
        }
        this.drawPart(ctx, o, cx, cy);
        // かがり火：火のまわりの光をゆらめかせる
        if (o.glow) {
            const fx = o.x - cx, fy = o.y - o.h * 0.8 - cy;
            const f = 1 + Math.sin(this.time * 9 + o.x) * 0.08 + Math.sin(this.time * 5.3 + o.y) * 0.06;
            const r = o.w * 1.3 * f;
            const gl = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
            gl.addColorStop(0, 'rgba(255, 190, 90, 0.32)');
            gl.addColorStop(1, 'rgba(255, 150, 50, 0)');
            ctx.globalAlpha = 1;
            ctx.fillStyle = gl;
            ctx.beginPath(); ctx.arc(fx, fy, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }
    
    drawAbove(ctx, camera) {
        for (const a of this.layers.abovePlayer) this.drawPart(ctx, a, Math.round(camera.x), Math.round(camera.y));
    }
    
    // デバッグ用：当たり判定を赤で表示（window.showCollision = true）
    drawCollisionDebug(ctx, camera) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 40, 0, 0.35)';
        for (const r of this.solidRects) ctx.fillRect(r.x - camera.x, r.y - camera.y, r.w, r.h);
        ctx.restore();
    }
}

window.createArenaMapData = createArenaMapData;
window.ArenaMap = ArenaMap;
