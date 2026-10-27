// 魔道ゴーレム専用ステージ「古代星紋遺跡」
//
// 素材：js_version/assets/tiles/ruins/*.png（art_source/ruins/ruins_parts_sheet.png から1つずつ切り出した物）
// 配置：art_source/ruins/ruins_overview.png（全体の完成イメージ）を参考に、パーツを並べて作る
//
// 星空に浮かぶ楕円形の遺跡。まわりは星空で、遺跡の外には出られない（外周に当たり判定）
//
// レイヤー：
//   ground           … 石畳・中央の道・南の階段（地面。通れる）
//   groundDecoration … ひび割れ・苔・星の模様の床（通れる）
//   magicCircle      … 中央の巨大な星形魔法陣（通れる。ボスのフェーズで光り方が変わる）
//   structures       … 北の門・北の壁・奥の光の滝（キャラより奥。まとめて1枚に描いておく）
//   objects          … 石柱・星晶石・台座・外周の壁など（キャラと奥行き順に描く）
//   abovePlayer      … キャラより手前に描く物（今はなし。足す時はここ）
//   collision        … 当たり判定（遺跡の床の楕円の外 ＋ px の四角）
//   spawnPoints      … プレイヤー・ボスの出現位置
//   effects          … 光の滝・星晶石・石柱の光・漂う星の粒（毎フレーム描く）
//   （危険床・攻撃の予告・弾はボスAI（golem_ai.js）が描く）
//
// 置き物の位置を変える時は createRuinsMapData() の中の数字を変える
// 座標はすべてワールドの px（1タイル = 48px、40×32タイル = 1920×1536px）

const RUINS_TILE = 48;

// 素材のもとの大きさ（_work の切り出しで出した値。画像がまだ読めない時の配置計算にも使う）
const RUINS_PART_SIZE = {
    ruins_floor: [187, 204], ruins_floor_crack: [181, 203], ruins_floor_moss: [183, 201], ruins_floor_rune: [179, 195],
    ruins_magic_circle: [296, 210], ruins_floor_diamond: [155, 191],
    ruins_wall_tower: [152, 210], ruins_wall: [178, 207], ruins_wall_b: [146, 202],
    ruins_arch: [102, 207], ruins_arch_vines: [145, 205], ruins_arch_broken: [149, 218],
    ruins_pillar: [87, 216], ruins_pillar_rune: [85, 215], ruins_pillar_rune_b: [85, 224], ruins_pillar_rune_c: [87, 224],
    ruins_gate: [271, 240], ruins_stairs: [166, 166], ruins_stairs_broken: [138, 165], ruins_platform: [148, 161],
    ruins_block: [120, 122], ruins_pillar_broken: [98, 142], ruins_pillar_broken_vines: [108, 165], ruins_pillar_short: [68, 165],
    ruins_crystal: [84, 152], ruins_crystal_small: [84, 114], ruins_brazier: [85, 152], ruins_brazier_b: [79, 140],
    ruins_pedestal: [78, 144], ruins_pedestal_rune: [86, 159], ruins_banner: [116, 174], ruins_banner_b: [100, 178],
    ruins_rubble: [132, 97], ruins_rubble_b: [134, 98], ruins_block_small: [72, 103],
    ruins_wall_vines: [163, 146], ruins_wall_low_vines: [134, 138], ruins_wall_low_vines_b: [168, 157],
    ruins_waterfall: [132, 336], ruins_waterfall_small: [108, 170], ruins_sparkles: [106, 172], ruins_water_pool: [196, 113],
    ruins_rubble_c: [147, 78], ruins_wall_stub_vines: [111, 124], ruins_wall_stub: [119, 102], ruins_wall_stub_b: [118, 104],
    ruins_wall_arch_vines: [179, 166], ruins_wall_stairs: [129, 148], ruins_stairs_side: [136, 148], ruins_stairs_wide: [136, 142],
    ruins_wall_corner: [119, 158]
};

// ---------- マップデータ ----------
function createRuinsMapData() {
    const W = 40, H = 32, WPX = W * RUINS_TILE, HPX = H * RUINS_TILE; // 1920 × 1536
    
    // 遺跡の床（楕円）。外周の石のふち（RIM）の外は星空
    const PLAZA = { x: WPX / 2, y: 850, rx: 790, ry: 500 };
    const RIM = 44;
    // 楕円のまわりの位置（deg：0=東 90=南 180=西 -90=北、off：楕円からの距離。+ は外側）
    const at = (deg, off = 0) => {
        const a = deg * Math.PI / 180;
        return { x: PLAZA.x + (PLAZA.rx + off) * Math.cos(a), y: PLAZA.y + (PLAZA.ry + off) * Math.sin(a) };
    };
    
    // 置き物：x = 横の中心、y = 下端（足元）、s = 拡大率
    // col: [幅, 高さ] 足元の当たり判定。shot: 弾も止める
    // glow: 'flame'（青白い炎）/ 'crystal'（星晶石）/ 'device'（星力の装置）
    // rune: 1 / 2 … フェーズ2で光る石柱（1）、フェーズ3で光る石柱（2）
    const part = (img, x, y, s, opt = {}) => {
        const [nw, nh] = RUINS_PART_SIZE[img];
        const w = nw * s, h = nh * s;
        const d = { img, x, y, s, w, h, flip: !!opt.flip, glow: opt.glow || '', rune: opt.rune || 0, shot: !!opt.shot,
            sortY: opt.sortY ?? y, back: !!opt.back, alpha: opt.alpha ?? 1 };
        if (opt.col) d.collision = [x - opt.col[0] / 2, y - opt.col[1], opt.col[0], opt.col[1]];
        return d;
    };
    const around = (deg, off, img, s, opt = {}) => { const p = at(deg, off); return part(img, p.x, p.y, s, opt); };
    // 東側の置き物を、西側に左右反転して置く
    const mirror = (d, opt = {}) => part(d.img, WPX - d.x, d.y, d.s, {
        flip: !d.flip, glow: d.glow, rune: d.rune, shot: d.shot, sortY: d.sortY, back: d.back,
        col: d.collision ? [d.collision[2], d.collision[3]] : null, ...opt
    });
    
    // ===== Ground =====
    const STAIRS = { x: PLAZA.x - 92, y: PLAZA.y + PLAZA.ry - 30, w: 184, h: 170 };   // 南の階段（遺跡の入口）
    const PATH = { x: PLAZA.x - 58, w: 116 };                                           // 北の門〜魔法陣〜南の階段の道
    
    // ===== MagicCircle =====
    const CIRCLE = { x: PLAZA.x, y: PLAZA.y, s: 1.55 };   // 画像 296×210 → 約 459×326
    
    // ===== GroundDecoration =====
    const groundDecoration = [];
    const rnd = arenaRandom(20261027);
    const stamps = ['ruins_floor_crack', 'ruins_floor_moss', 'ruins_floor_crack', 'ruins_floor_moss'];
    for (let i = 0, tries = 0; i < 16 && tries < 600; tries++) {
        const a = rnd() * Math.PI * 2, k = 0.25 + rnd() * 0.68;
        const x = PLAZA.x + Math.cos(a) * PLAZA.rx * k, y = PLAZA.y + Math.sin(a) * PLAZA.ry * k;
        if (Math.hypot((x - CIRCLE.x) / 1.4, y - CIRCLE.y) < 230) continue;           // 魔法陣の上には置かない
        if (Math.abs(x - PLAZA.x) < PATH.w) continue;                                  // 道の上にも置かない
        if (groundDecoration.some(d => Math.hypot(d.x - x, d.y - y) < 190)) continue;
        groundDecoration.push({ type: 'stamp', img: stamps[i % stamps.length], x, y, s: 0.8 + rnd() * 0.3 });
        i++;
    }
    // 星の模様の床（南の紋章と、魔法陣の左右）
    for (const [x, y, s] of [[PLAZA.x - 300, 1190, 0.62], [PLAZA.x + 300, 1190, 0.62], [PLAZA.x - 470, PLAZA.y, 0.5], [PLAZA.x + 470, PLAZA.y, 0.5]]) {
        groundDecoration.push({ type: 'emblem', img: 'ruins_floor_diamond', x, y, s });
    }
    
    // ===== Structures（キャラより奥。まとめて1枚に描く） =====
    const structures = [];
    // 奥の星空に流れ落ちる光の滝（北の壁のうしろ）
    for (const x of [PLAZA.x - 400, PLAZA.x + 400]) structures.push(part('ruins_waterfall', x, at(-90).y - 60, 0.75, { back: true, alpha: 0.9 }));
    for (const x of [PLAZA.x - 700, PLAZA.x + 700]) structures.push(part('ruins_waterfall_small', x, at(-90).y + 60, 0.8, { back: true, alpha: 0.85 }));
    // 北の古代の門（閉じている）と、その左右の壁
    const GATE_S = 1.45;
    const gate = part('ruins_gate', PLAZA.x, at(-90).y + 22, GATE_S);
    structures.push(gate);
    const northWall = [
        // [deg, img, s, off, flip]
        [-126, 'ruins_wall_tower', 0.78, 6], [-117, 'ruins_arch_vines', 0.78, 10], [-108, 'ruins_wall', 0.74, 14]
    ];
    for (const [deg, img, s, off] of northWall) {
        const d = around(deg, off, img, s);
        structures.push(d, mirror(d, { col: null }));
    }
    // 壁にかかった古代の旗
    for (const x of [PLAZA.x - 250, PLAZA.x + 250]) structures.push(part('ruins_banner', x, at(-90).y + 4, 0.46));
    
    // ===== Objects（キャラと奥行き順） =====
    const objects = [];
    const add = (...list) => objects.push(...list);
    // 北：門の両わきの青く光る石柱と、星晶石
    const gatePillar = part('ruins_pillar_rune_b', PLAZA.x + 232, at(-90).y + 58, 0.8, { col: [50, 22], shot: true, rune: 1 });
    add(gatePillar, mirror(gatePillar));
    const gateCrystal = part('ruins_crystal', PLAZA.x + 340, at(-90).y + 84, 0.66, { col: [40, 16], glow: 'crystal' });
    add(gateCrystal, part('ruins_crystal_small', PLAZA.x - 340, at(-90).y + 84, 0.66, { col: [40, 14], glow: 'crystal' }));
    
    // 東：古代の石柱・崩れた石壁・階段・青白い炎の台座・星力の装置
    const east = [
        around(-62, 6, 'ruins_wall_tower', 0.74, { col: [96, 28], shot: true }),
        around(-50, 16, 'ruins_stairs_wide', 0.82),                                     // 外へ続く階段（外周の外なので通れない）
        around(-38, -30, 'ruins_pillar_rune_c', 0.76, { col: [46, 20], shot: true, rune: 2 }),
        around(-22, 22, 'ruins_wall_low_vines_b', 0.74),
        around(-8, -32, 'ruins_pillar_rune', 0.76, { col: [46, 20], shot: true, rune: 1 }),
        around(8, 20, 'ruins_wall_stairs', 0.78),                                       // 崩れた石壁と階段
        around(22, -32, 'ruins_pillar_rune_c', 0.76, { col: [46, 20], shot: true, rune: 2 }),
        around(36, 16, 'ruins_wall_corner', 0.72),
        around(48, 12, 'ruins_wall_stub', 0.74)
    ];
    add(...east);
    add(around(-24, -110, 'ruins_brazier', 0.62, { col: [40, 16], glow: 'flame' }));
    add(around(16, -112, 'ruins_brazier_b', 0.64, { col: [40, 16], glow: 'flame' }));
    add(around(-2, -150, 'ruins_pedestal_rune', 0.72, { col: [44, 18], shot: true, glow: 'device' }));   // 星力の装置
    add(around(34, -100, 'ruins_rubble', 0.5, { col: [56, 14] }));
    
    // 西：古代の石柱・ツタの絡まった遺跡・崩れた柱・星晶石・旗
    const west = [
        around(-118, 6, 'ruins_wall_tower', 0.74, { col: [96, 28], shot: true, flip: true }),
        around(-130, 16, 'ruins_stairs_wide', 0.82, { flip: true }),
        around(-142, -30, 'ruins_pillar_rune_c', 0.76, { col: [46, 20], shot: true, rune: 2, flip: true }),
        around(-158, 22, 'ruins_wall_vines', 0.74),
        around(-172, -32, 'ruins_pillar_rune', 0.76, { col: [46, 20], shot: true, rune: 1, flip: true }),
        around(172, 22, 'ruins_arch_vines', 0.74),
        around(158, -32, 'ruins_pillar_rune_c', 0.76, { col: [46, 20], shot: true, rune: 2, flip: true }),
        around(144, 16, 'ruins_wall_arch_vines', 0.7),
        around(132, 12, 'ruins_wall_stub_vines', 0.74)
    ];
    add(...west);
    add(around(-160, -110, 'ruins_pillar_broken_vines', 0.68, { col: [56, 20], shot: true }));
    add(around(178, -118, 'ruins_crystal', 0.62, { col: [38, 16], glow: 'crystal' }));
    add(around(150, -104, 'ruins_crystal_small', 0.62, { col: [40, 14], glow: 'crystal' }));
    add(around(-176, 26, 'ruins_banner_b', 0.48, { sortY: at(-176, 40).y }));
    add(around(166, -150, 'ruins_pillar_broken', 0.6, { col: [50, 18], shot: true }));
    
    // 南：遺跡の入口（階段）の両わきの石柱・旗・外周の低い壁・星晶石
    for (const [deg, img] of [[60, 'ruins_wall_stub_b'], [69, 'ruins_wall_stub'], [77, 'ruins_wall_stub_vines']]) {
        const d = around(deg, 14, img, 0.74);
        add(d, mirror(d, { col: null }));
    }
    const entPillar = part('ruins_pillar_rune_b', STAIRS.x + STAIRS.w + 18, at(90).y + 30, 0.7, { col: [44, 18], shot: true, rune: 2 });
    add(entPillar, mirror(entPillar));
    const entBanner = part('ruins_banner_b', STAIRS.x + STAIRS.w + 82, at(90).y + 40, 0.5);
    add(entBanner, mirror(entBanner));
    add(part('ruins_crystal_small', PLAZA.x + 330, at(90).y - 10, 0.6, { col: [40, 14], glow: 'crystal' }));
    
    // ===== Collision（通れない所） =====
    // 床の楕円の外は通れない（RuinsMap.isBoxBlocked で判定）。ここは px の四角
    const rects = [
        [gate.x - gate.w / 2 + 20, 0, gate.w - 40, gate.y - 12]           // 北の門
    ];
    for (const o of objects) if (o.collision) rects.push(o.collision);
    const shotRects = [rects[0], ...objects.filter(o => o.shot && o.collision).map(o => o.collision)];
    
    // ===== SpawnPoints =====
    const spawnPoints = {
        player: { x: PLAZA.x, y: 1200 },           // 南側
        boss: { x: PLAZA.x, y: 560 },               // 中央北側（門の前）
        enemies: { north: [{ x: PLAZA.x, y: 560 }] }
    };
    
    // ===== Effects（毎フレーム描く物） =====
    const effects = {
        // 南のがけから流れ落ちる光の滝
        waterfalls: [
            { ...at(28, RIM), w: 64, h: 330 },
            { ...at(152, RIM), w: 64, h: 330 },
            { ...at(64, RIM), w: 48, h: 260 },
            { ...at(116, RIM), w: 48, h: 260 }
        ]
    };
    
    return {
        id: 'ancient_star_ruins',
        name: '古代星紋遺跡',
        safeZone: false,
        width: W, height: H, tileSize: RUINS_TILE,
        layers: {
            ground: { plaza: PLAZA, rim: RIM, stairs: STAIRS, path: PATH },
            groundDecoration, magicCircle: CIRCLE, structures, objects, abovePlayer: [],
            collision: { rects, shotRects },
            spawnPoints, effects
        }
    };
}

// ---------- 古代星紋遺跡のマップ（闘技場と同じ使い方ができる） ----------
class RuinsMap extends ArenaMap {
    constructor(data) {
        super(data);
        this.stagePhase = 1;      // ボスのフェーズ（1〜3）。魔法陣・石柱・星晶石の光り方が変わる
        this.glow = 0;            // 光の強さ（フェーズに合わせてなめらかに変わる）
        this.circlePulse = 0;     // 魔法陣が強く光る（ボスの攻撃の予兆）
        this.pillarFlash = 0;     // 石柱が強く光る（ボスの魔法攻撃と連動）
        this.circleSpin = 0;      // 魔法陣の外側の輪の回転
        this.motes = [];          // 漂う星の粒
        const g = this.layers.ground;
        this.plaza = g.plaza;
        this.stairs = g.stairs;
    }
    
    // ---------- 当たり判定 ----------
    // 床の楕円（と南の階段）の中なら通れる。箱の4つの角で調べる
    inWalkArea(x, y) {
        const P = this.plaza, S = this.stairs;
        const dx = (x - P.x) / (P.rx - 16), dy = (y - P.y) / (P.ry - 16);
        if (dx * dx + dy * dy <= 1) return true;
        return x > S.x + 14 && x < S.x + S.w - 14 && y > S.y && y < S.y + S.h - 24;
    }
    
    isBoxBlocked(cx, cy, hw, hh) {
        const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
        if (!this.inWalkArea(x0, y0) || !this.inWalkArea(x1, y0) || !this.inWalkArea(x0, y1) || !this.inWalkArea(x1, y1)) return true;
        for (const r of this.solidRects) {
            if (x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h) return true;
        }
        return false;
    }
    
    // ボス戦の始まり方（boss_battle.js が使う）：ボスは門から出てこず、その場で起動する
    getBossStage() {
        const sp = this.layers.spawnPoints;
        return { boss: new Vector2(sp.boss.x, sp.boss.y), player: new Vector2(sp.player.x, sp.player.y), intro: 'activate' };
    }
    
    // ---------- ボスと連動するギミック ----------
    setStagePhase(n) { this.stagePhase = Math.max(this.stagePhase, n); }
    pulseCircle(power = 1) { this.circlePulse = Math.max(this.circlePulse, power); }
    flashPillars(power = 1) { this.pillarFlash = Math.max(this.pillarFlash, power); }
    
    // 石柱の光り具合（0〜1）
    runeLevel(o) {
        if (!o.rune) return 0;
        const ph = this.stagePhase;
        let v = 0;
        if (ph >= 3) v = 0.85 + Math.sin(this.time * 7 + o.x) * 0.15;
        else if (ph === 2) v = o.rune === 1 ? 0.65 + Math.sin(this.time * 3 + o.x) * 0.1 : 0.12;
        return Math.min(1, v + this.pillarFlash * 0.6);
    }
    
    // 光っている石柱（ボスの魔法攻撃が使う）
    getRunePillars() {
        return this.layers.objects.filter(o => o.rune && this.runeLevel(o) > 0.4)
            .map(o => ({ position: new Vector2(o.x, o.y - o.h * 0.62), obj: o }));
    }
    
    update(deltaTime) {
        super.update(deltaTime);
        const target = [0.18, 0.5, 0.85][Math.min(2, this.stagePhase - 1)];
        this.glow += (target - this.glow) * Math.min(1, deltaTime * 1.5);
        this.circlePulse = Math.max(0, this.circlePulse - deltaTime * 1.6);
        this.pillarFlash = Math.max(0, this.pillarFlash - deltaTime * 1.4);
        this.circleSpin += deltaTime * [0.12, 0.4, 1.5][Math.min(2, this.stagePhase - 1)];
        // 魔法陣と星晶石から星の粒が立ちのぼる（フェーズが進むほど多い）
        const rate = [3, 8, 18][Math.min(2, this.stagePhase - 1)];
        if (Math.random() < rate * deltaTime) {
            const C = this.layers.magicCircle, a = Math.random() * Math.PI * 2, k = Math.sqrt(Math.random());
            this.motes.push({ x: C.x + Math.cos(a) * 220 * k, y: C.y + Math.sin(a) * 150 * k, age: 0, life: 1.6 + Math.random() * 1.4, vx: (Math.random() - 0.5) * 10, vy: -30 - Math.random() * 30 });
        }
        if (Math.random() < rate * 0.4 * deltaTime) {
            const list = this.layers.objects.filter(o => o.glow === 'crystal' || o.rune);
            const o = list[Math.floor(Math.random() * list.length)];
            if (o && (o.glow || this.runeLevel(o) > 0.3)) this.motes.push({ x: o.x + (Math.random() - 0.5) * o.w * 0.6, y: o.y - o.h * (0.3 + Math.random() * 0.4), age: 0, life: 1.2 + Math.random(), vx: 0, vy: -24 });
        }
        for (const m of this.motes) { m.age += deltaTime; m.x += m.vx * deltaTime; m.y += m.vy * deltaTime; }
        this.motes = this.motes.filter(m => m.age < m.life);
    }
    
    // ---------- 動かない物をまとめて1枚に描く ----------
    buildBackground() {
        const W = this.width * this.tileSize, H = this.height * this.tileSize;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        const L = this.layers, P = this.plaza, RIM = L.ground.rim;
        
        this.drawSky(g, W, H);
        for (const s of L.structures) if (s.back) this.drawPartAlpha(g, s);
        this.drawCliff(g, P, RIM);
        
        // 外周の石のふち
        const floor = this.pattern(g, 'ruins_floor', 0.5, 6, true);
        const ell = (rx, ry) => { g.beginPath(); g.ellipse(P.x, P.y, rx, ry, 0, 0, Math.PI * 2); };
        ell(P.rx + RIM, P.ry + RIM);
        g.fillStyle = floor || '#8d8295';
        g.fill();
        ell(P.rx + RIM, P.ry + RIM);
        g.fillStyle = 'rgba(40, 30, 60, 0.28)';
        g.fill();
        g.lineWidth = 4; g.strokeStyle = 'rgba(20, 14, 34, 0.85)';
        ell(P.rx + RIM, P.ry + RIM); g.stroke();
        g.lineWidth = 2; g.strokeStyle = 'rgba(230, 220, 245, 0.45)';
        ell(P.rx + RIM - 4, P.ry + RIM - 4); g.stroke();
        
        // 床（楕円の中を石畳で埋める）
        g.save();
        ell(P.rx, P.ry); g.clip();
        g.fillStyle = floor || '#9a8fa3';
        g.fillRect(P.x - P.rx, P.y - P.ry, P.rx * 2, P.ry * 2);
        // ひび割れ・苔の床（まわりをぼかしてなじませる）
        for (const d of L.groundDecoration) if (d.type === 'stamp') this.drawStamp(g, d);
        // 北の門〜魔法陣〜南の階段の道（少し明るい石）
        const pa = L.ground.path;
        g.fillStyle = 'rgba(255, 245, 255, 0.07)';
        g.fillRect(pa.x, P.y - P.ry, pa.w, P.ry * 2);
        g.fillStyle = 'rgba(40, 28, 56, 0.4)';
        g.fillRect(pa.x - 3, P.y - P.ry, 3, P.ry * 2); g.fillRect(pa.x + pa.w, P.y - P.ry, 3, P.ry * 2);
        g.fillStyle = 'rgba(255, 245, 255, 0.18)';
        g.fillRect(pa.x, P.y - P.ry, 2, P.ry * 2); g.fillRect(pa.x + pa.w - 2, P.y - P.ry, 2, P.ry * 2);
        // ふちに近いほど少し暗く（立体感）
        g.translate(P.x, P.y); g.scale(1, P.ry / P.rx);
        const vg = g.createRadialGradient(0, 0, P.rx * 0.55, 0, 0, P.rx);
        vg.addColorStop(0, 'rgba(20, 12, 40, 0)');
        vg.addColorStop(1, 'rgba(20, 12, 40, 0.32)');
        g.fillStyle = vg;
        g.fillRect(-P.rx, -P.rx, P.rx * 2, P.rx * 2);
        g.restore();
        
        // 星の模様の床
        for (const d of L.groundDecoration) if (d.type === 'emblem') this.drawEmblem(g, d);
        
        // 南の階段（遺跡の入口）
        const S = L.ground.stairs;
        const st = this.scaled('ruins_stairs', S.w / RUINS_PART_SIZE.ruins_stairs[0], false);
        if (st) g.drawImage(st, Math.round(S.x), Math.round(S.y + S.h - st.height + 10));
        
        // 中央の魔法陣（光っていない時の姿。光は draw で重ねる）
        this.drawCircle(g, 0.9);
        
        // Structures（北の門・壁・旗）
        for (const s of L.structures) if (!s.back) this.drawPart(g, s);
        this.background = c;
    }
    
    drawPartAlpha(g, d) {
        g.save();
        g.globalAlpha = d.alpha;
        this.drawPart(g, d);
        g.restore();
    }
    
    // 星空（深い紺色・星雲・星・遠くに浮かぶ岩）
    drawSky(g, W, H) {
        const sky = g.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#0a0b26');
        sky.addColorStop(0.5, '#141640');
        sky.addColorStop(1, '#090a22');
        g.fillStyle = sky;
        g.fillRect(0, 0, W, H);
        const rnd = arenaRandom(7781);
        for (const [x, y, r, col] of [[260, 220, 420, 'rgba(110, 70, 200, 0.22)'], [1700, 300, 460, 'rgba(60, 110, 220, 0.2)'],
            [180, 1350, 380, 'rgba(70, 120, 230, 0.2)'], [1760, 1300, 420, 'rgba(120, 70, 210, 0.2)'], [960, 80, 520, 'rgba(80, 90, 210, 0.16)']]) {
            const ng = g.createRadialGradient(x, y, 0, x, y, r);
            ng.addColorStop(0, col);
            ng.addColorStop(1, 'rgba(20, 20, 60, 0)');
            g.fillStyle = ng;
            g.fillRect(x - r, y - r, r * 2, r * 2);
        }
        // 星（ドットの点）
        for (let i = 0; i < 700; i++) {
            const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H), k = rnd();
            g.fillStyle = k < 0.7 ? `rgba(255, 255, 255, ${0.3 + rnd() * 0.5})` : k < 0.88 ? 'rgba(170, 210, 255, 0.85)' : 'rgba(255, 226, 150, 0.8)';
            const s = k > 0.96 ? 2 : 1;
            g.fillRect(x, y, s, s);
        }
        // 十字に光る星
        for (let i = 0; i < 40; i++) {
            const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H), r = 2 + Math.floor(rnd() * 3);
            g.fillStyle = 'rgba(200, 230, 255, 0.85)';
            g.fillRect(x - r, y, r * 2 + 1, 1); g.fillRect(x, y - r, 1, r * 2 + 1);
            g.fillStyle = '#ffffff'; g.fillRect(x, y, 1, 1);
        }
        // 遠くに浮かぶ遺跡のかけら（暗く小さく）
        for (const [img, x, y, s] of [['ruins_block', 120, 260, 0.42], ['ruins_rubble_b', 1820, 200, 0.4], ['ruins_block_small', 90, 1440, 0.5],
            ['ruins_rubble', 1840, 1460, 0.45], ['ruins_pillar_broken', 1830, 760, 0.38], ['ruins_rubble_c', 70, 760, 0.42]]) {
            const im = this.scaled(img, s, false);
            if (!im) continue;
            g.save();
            g.globalAlpha = 0.55;
            g.drawImage(im, Math.round(x - im.width / 2), Math.round(y - im.height));
            g.restore();
            // 下から光が当たる（浮いている感じ）
            const lg = g.createRadialGradient(x, y + 6, 0, x, y + 6, 40);
            lg.addColorStop(0, 'rgba(120, 190, 255, 0.25)');
            lg.addColorStop(1, 'rgba(120, 190, 255, 0)');
            g.fillStyle = lg;
            g.fillRect(x - 40, y - 34, 80, 80);
        }
        // キラキラの素材を所々に
        for (const [x, y] of [[420, 120], [1500, 110], [300, 1240], [1640, 1180], [1180, 60]]) {
            const im = this.scaled('ruins_sparkles', 0.7, false);
            if (!im) continue;
            g.save(); g.globalAlpha = 0.6; g.globalCompositeOperation = 'lighter';
            g.drawImage(im, Math.round(x - im.width / 2), Math.round(y - im.height / 2));
            g.restore();
        }
    }
    
    // 南側のがけ（遺跡が宙に浮いている岩の部分）
    drawCliff(g, P, RIM) {
        const rx = P.rx + RIM, ry = P.ry + RIM, rnd = arenaRandom(4242);
        const N = 72;
        const top = [], bot = [];
        for (let i = 0; i <= N; i++) {
            const a = i / N * Math.PI;
            const x = P.x + Math.cos(a) * rx, y = P.y + Math.sin(a) * ry;
            top.push([x, y]);
            // 下のふちはぎざぎざ（真ん中ほど深い）
            const depth = 60 + Math.sin(a) * 140 + (i % 2 ? rnd() * 50 : rnd() * 15);
            bot.push([x + (rnd() - 0.5) * 10, y + depth]);
        }
        const path = () => {
            g.beginPath();
            g.moveTo(top[0][0], top[0][1]);
            for (const [x, y] of top) g.lineTo(x, y);
            for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]);
            g.closePath();
        };
        g.save();
        path();
        const cg = g.createLinearGradient(0, P.y, 0, P.y + ry + 200);
        cg.addColorStop(0, '#4c4364');
        cg.addColorStop(0.75, '#2a2442');
        cg.addColorStop(1, '#16132c');
        g.fillStyle = cg;
        g.fill();
        g.clip();
        // 石のきめ
        const wall = this.pattern(g, 'ruins_wall', 0.45, 10, true);
        if (wall) {
            g.globalAlpha = 0.28;
            g.fillStyle = wall;
            g.fillRect(P.x - rx, P.y, rx * 2, ry + 260);
            g.globalAlpha = 1;
        }
        // 下へ行くほど暗く
        const dg = g.createLinearGradient(0, P.y + ry * 0.4, 0, P.y + ry + 200);
        dg.addColorStop(0, 'rgba(10, 8, 30, 0)');
        dg.addColorStop(1, 'rgba(10, 8, 30, 0.75)');
        g.fillStyle = dg;
        g.fillRect(P.x - rx, P.y, rx * 2, ry + 260);
        // 縦のひび
        g.strokeStyle = 'rgba(14, 10, 28, 0.6)';
        g.lineWidth = 2;
        for (let i = 2; i < N - 1; i += 3) {
            const [x, y] = top[i];
            g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + (rnd() - 0.5) * 12, y + 40 + rnd() * 60); g.stroke();
        }
        g.restore();
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(12, 8, 26, 0.9)';
        path(); g.stroke();
    }
    
    // 星の模様の床（まわりをなじませて置く）
    drawEmblem(g, d) {
        const src = this.img(d.img);
        if (!src) return;
        const w = Math.round(src.width * d.s), h = Math.round(src.height * d.s * 0.8);
        g.save();
        g.globalAlpha = 0.9;
        g.beginPath(); g.ellipse(d.x, d.y, w * 0.48, h * 0.48, 0, 0, Math.PI * 2); g.clip();
        g.drawImage(src, Math.round(d.x - w / 2), Math.round(d.y - h / 2), w, h);
        g.restore();
        g.strokeStyle = 'rgba(40, 28, 60, 0.5)'; g.lineWidth = 2;
        g.beginPath(); g.ellipse(d.x, d.y, w * 0.48, h * 0.48, 0, 0, Math.PI * 2); g.stroke();
    }
    
    // 中央の魔法陣の画像（alpha：濃さ。add：光として重ねる）
    drawCircle(g, alpha, add = false) {
        const C = this.layers.magicCircle;
        const src = this.img('ruins_magic_circle');
        const [nw, nh] = RUINS_PART_SIZE.ruins_magic_circle;
        const w = nw * C.s, h = nh * C.s;
        g.save();
        g.globalAlpha = alpha;
        if (add) g.globalCompositeOperation = 'lighter';
        g.beginPath(); g.ellipse(C.x, C.y, w * 0.49, h * 0.49, 0, 0, Math.PI * 2); g.clip();
        if (src) {
            g.imageSmoothingEnabled = false;
            g.drawImage(src, Math.round(C.x - w / 2), Math.round(C.y - h / 2), Math.round(w), Math.round(h));
        } else {
            g.fillStyle = 'rgba(120, 200, 255, 0.4)';
            g.fillRect(C.x - w / 2, C.y - h / 2, w, h);
        }
        g.restore();
        if (!add) {
            g.strokeStyle = 'rgba(40, 28, 60, 0.55)'; g.lineWidth = 3;
            g.beginPath(); g.ellipse(C.x, C.y, w * 0.49, h * 0.49, 0, 0, Math.PI * 2); g.stroke();
        }
    }
    
    draw(ctx, camera) {
        if (!this.background) this.buildBackground();
        const cx = Math.round(camera.x), cy = Math.round(camera.y);
        const vw = ctx.canvas.width, vh = ctx.canvas.height;
        // マップの外（星空の続き）
        ctx.fillStyle = '#0a0b26';
        ctx.fillRect(0, 0, vw, vh);
        const sx = Math.max(0, cx), sy = Math.max(0, cy);
        const sw = Math.min(this.background.width - sx, vw - (sx - cx));
        const sh = Math.min(this.background.height - sy, vh - (sy - cy));
        if (sw > 0 && sh > 0) ctx.drawImage(this.background, sx, sy, sw, sh, sx - cx, sy - cy, sw, sh);
        ctx.save();
        ctx.translate(-cx, -cy);
        this.drawWaterfalls(ctx);
        this.drawCircleGlow(ctx);
        ctx.restore();
    }
    
    // 光の滝：がけから下へ流れ落ちる光（流れる筋を動かす）
    drawWaterfalls(ctx) {
        const t = this.time;
        for (const f of this.layers.effects.waterfalls) {
            const x0 = f.x - f.w / 2, y0 = f.y - 6;
            ctx.save();
            const grad = ctx.createLinearGradient(0, y0, 0, y0 + f.h);
            grad.addColorStop(0, 'rgba(150, 220, 255, 0.75)');
            grad.addColorStop(0.6, 'rgba(90, 170, 255, 0.4)');
            grad.addColorStop(1, 'rgba(60, 120, 255, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(x0 + f.w * 0.15, y0, f.w * 0.7, f.h);
            ctx.globalCompositeOperation = 'lighter';
            ctx.beginPath(); ctx.rect(x0, y0, f.w, f.h); ctx.clip();
            for (let i = 0; i < 7; i++) {
                const lx = x0 + f.w * (0.18 + (i * 0.37) % 0.64);
                const len = 26 + (i * 13) % 30;
                const ly = y0 + ((t * (140 + i * 17) + i * 53) % (f.h + len)) - len;
                ctx.fillStyle = `rgba(220, 245, 255, ${0.35 * (1 - (ly - y0) / f.h)})`;
                ctx.fillRect(Math.round(lx), Math.round(ly), 2, len);
            }
            // 落ち口のしぶき
            const sg = ctx.createRadialGradient(f.x, y0 + 4, 0, f.x, y0 + 4, f.w * 0.8);
            sg.addColorStop(0, 'rgba(200, 240, 255, 0.55)');
            sg.addColorStop(1, 'rgba(120, 200, 255, 0)');
            ctx.fillStyle = sg;
            ctx.fillRect(f.x - f.w, y0 - f.w * 0.5, f.w * 2, f.w * 1.3);
            ctx.restore();
        }
    }
    
    // 魔法陣の光（フェーズ1：淡く / 2：明るく / 3：回転と点滅が速く）
    drawCircleGlow(ctx) {
        const C = this.layers.magicCircle;
        const ph = this.stagePhase;
        const speed = [1.2, 2.2, 6][Math.min(2, ph - 1)];
        const pulse = 0.82 + Math.sin(this.time * speed) * 0.18;
        const a = Math.min(1, this.glow * pulse + this.circlePulse * 0.8);
        this.drawCircle(ctx, a * 0.75, true);
        // 外側の光の輪（回る）
        const [nw, nh] = RUINS_PART_SIZE.ruins_magic_circle;
        const rx = nw * C.s * 0.47, ry = nh * C.s * 0.47;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(C.x, C.y);
        ctx.globalAlpha = Math.min(1, 0.25 + a * 0.75);
        ctx.strokeStyle = 'rgba(140, 230, 255, 0.9)';
        ctx.lineWidth = 2;
        const n = 24;
        for (let i = 0; i < n; i++) {
            const ang = this.circleSpin + i / n * Math.PI * 2;
            const len = i % 3 === 0 ? 0.08 : 0.04;
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * rx * (1 - len), Math.sin(ang) * ry * (1 - len));
            ctx.lineTo(Math.cos(ang) * rx, Math.sin(ang) * ry);
            ctx.stroke();
        }
        // 光の玉が輪の上を回る（フェーズ2から）
        if (ph >= 2) {
            for (let i = 0; i < (ph >= 3 ? 5 : 3); i++) {
                const ang = -this.circleSpin * 1.6 + i / (ph >= 3 ? 5 : 3) * Math.PI * 2;
                const px = Math.cos(ang) * rx * 0.86, py = Math.sin(ang) * ry * 0.86;
                const og = ctx.createRadialGradient(px, py, 0, px, py, 16);
                og.addColorStop(0, 'rgba(230, 250, 255, 0.95)');
                og.addColorStop(1, 'rgba(90, 200, 255, 0)');
                ctx.fillStyle = og;
                ctx.fillRect(px - 16, py - 16, 32, 32);
            }
        }
        // 中心の光
        const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 0.5);
        cg.addColorStop(0, `rgba(170, 235, 255, ${0.35 * a})`);
        cg.addColorStop(1, 'rgba(90, 180, 255, 0)');
        ctx.fillStyle = cg;
        ctx.scale(1, ry / rx);
        ctx.fillRect(-rx * 0.5, -rx * 0.5, rx, rx);
        ctx.restore();
    }
    
    // 置き物を1つ描く（石柱・星晶石・炎の光もここで重ねる）
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
        const base = ctx.globalAlpha;
        ctx.globalCompositeOperation = 'lighter';
        // 石柱：古代文字が青く光る（フェーズ2・3）
        const lv = this.runeLevel(o);
        if (lv > 0.02) {
            ctx.globalAlpha = base * lv * 0.45;
            this.drawPart(ctx, o, cx, cy);
            this.glowAt(ctx, o.x - cx, o.y - o.h * 0.55 - cy, o.w * 1.1, `rgba(110, 210, 255, ${0.5 * lv})`, base);
        }
        if (o.glow === 'crystal') {
            const k = 0.25 + this.glow * 0.55 + Math.sin(this.time * (1.5 + this.stagePhase) + o.x) * 0.1 + this.pillarFlash * 0.3;
            this.glowAt(ctx, o.x - cx, o.y - o.h * 0.5 - cy, o.w * 1.3, `rgba(120, 200, 255, ${0.45 * k})`, base);
        } else if (o.glow === 'flame') {
            const f = 1 + Math.sin(this.time * 9 + o.x) * 0.1 + Math.sin(this.time * 5.3 + o.y) * 0.07;
            this.glowAt(ctx, o.x - cx, o.y - o.h * 0.78 - cy, o.w * 1.25 * f, 'rgba(120, 210, 255, 0.4)', base);
        } else if (o.glow === 'device') {
            // 星力の装置：台座の上に浮かぶ光の玉（フェーズが進むほど強く）
            const k = 0.35 + this.glow * 0.65 + this.pillarFlash * 0.4;
            const bob = Math.sin(this.time * 2) * 3;
            const px = o.x - cx, py = o.y - o.h - 14 - cy + bob;
            this.glowAt(ctx, px, py, 34 + 14 * k, `rgba(140, 225, 255, ${0.6 * k})`, base);
            ctx.globalAlpha = base;
            ctx.fillStyle = '#e8fbff';
            drawStarShape(ctx, px, py, 5 + 2 * k, 2.2);
        }
        ctx.restore();
    }
    
    glowAt(ctx, x, y, r, color, alpha = 1) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(80, 160, 255, 0)');
        ctx.globalAlpha = alpha;
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    
    // キャラより手前：漂う星の粒
    drawAbove(ctx, camera) {
        super.drawAbove(ctx, camera);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const m of this.motes) {
            const t = m.age / m.life;
            ctx.globalAlpha = Math.sin(t * Math.PI) * 0.8;
            ctx.fillStyle = t < 0.5 ? '#dff6ff' : '#8fd8ff';
            const x = Math.round(m.x - camera.x), y = Math.round(m.y - camera.y);
            ctx.fillRect(x, y, 2, 2);
            if (m.life > 2) { ctx.fillRect(x - 2, y, 1, 2); ctx.fillRect(x + 3, y, 1, 2); }
        }
        ctx.restore();
    }
    
    // デバッグ用：当たり判定（window.showCollision = true）。床の楕円の外も赤く見せる
    drawCollisionDebug(ctx, camera) {
        super.drawCollisionDebug(ctx, camera);
        const P = this.plaza;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 40, 0, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(P.x - camera.x, P.y - camera.y, P.rx - 16, P.ry - 16, 0, 0, Math.PI * 2); ctx.stroke();
        const S = this.stairs;
        ctx.strokeRect(S.x + 14 - camera.x, S.y - camera.y, S.w - 28, S.h - 24);
        ctx.restore();
    }
}

window.RUINS_PART_SIZE = RUINS_PART_SIZE;
window.createRuinsMapData = createRuinsMapData;
window.RuinsMap = RuinsMap;
