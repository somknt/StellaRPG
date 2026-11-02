// 星の酒場（マルチプレイのロビー）のマップ
//
// 背景は全体図（art_source/tavern/tavern_overview.png）をそのまま 2倍にして使う（assets/tiles/tavern/tv_overview.jpg）
//   全体図の 1px ＝ ワールドの 2px（3072 × 2048）。座標は全体図の px で書いて、TV_SCALE 倍する
//   全体図にかいてあった前のマスターは消してあり、ゲームが新しいマスター（tv_master_1〜16）を描く
// 配置：南＝星の魔法陣（出てくる所）/ 北の真ん中＝カウンターとマスター / 北東＝3つの扉と、その左にクエスト掲示板
// 置き物（テーブル・石柱・樽）の当たり判定は、絵の見えている所ぜんぶ（後ろに回りこんで、体が重なって見えないように）
const TV_SCALE = 2;
const TV_TILE = 64;

function createTavernMapData() {
    const K = TV_SCALE;
    const at = (x, y) => ({ x: x * K, y: y * K });
    // ===== 歩ける所（全体図の px の多角形。時計回り）=====
    const WALK = [
        [52, 345], [440, 345], [440, 402], [845, 402], [845, 348], [1490, 348],   // 北：ソファ・暖炉の前 / カウンターの前 / 扉の前
        [1490, 425], [1366, 425], [1366, 566], [1470, 566],                      // 東：手すりの奥の席は入れない
        [1470, 776], [996, 790], [966, 886], [586, 886], [550, 790], [55, 790]  // 南：手すり・階段の上
    ].map(([x, y]) => [x * K, y * K]);
    // ===== 通れない置き物（全体図の px：x, y, 幅, 高さ）=====
    const rects = [
        [70, 372, 125, 75],    // 西のテーブル（暖炉のそば）
        [245, 482, 130, 78],   // 西のテーブル
        [1160, 478, 130, 80],  // 東のテーブル
        [1330, 645, 135, 80],  // 南東のテーブル
        [572, 525, 48, 108], [917, 525, 48, 108], [512, 705, 48, 108], [977, 705, 48, 108],   // 魔法陣のまわりの星晶石の柱
        [95, 560, 92, 110]     // 西の樽
    ].map(([x, y, w, h]) => [x * K, y * K, w * K, h * K]);
    // ===== 扉（全体図の px。x：扉の真ん中 / top：アーチの上 / y：扉の下）=====
    const doors = [
        { id: 'coop', kind: 'coop', label: '協力プレイ', x: 1136 * K, top: 150 * K, doorTop: 222 * K, y: 332 * K, w: 70 * K, color: '#7fb4ff' },
        { id: 'pvp', kind: 'pvp', label: 'PvP', x: 1276 * K, top: 150 * K, doorTop: 222 * K, y: 332 * K, w: 72 * K, color: '#ff8a9a' },
        { id: 'locked', kind: 'locked', label: '？？？？', x: 1415 * K, top: 150 * K, doorTop: 222 * K, y: 332 * K, w: 70 * K, color: '#9a8fb8' }
    ];
    return {
        id: 'star_tavern',
        name: '星の酒場',
        safeZone: true,
        width: 48, height: 32, tileSize: TV_TILE,   // 3072 × 2048
        layers: {
            ground: { walk: WALK },
            groundDecoration: [], structures: [], objects: [], abovePlayer: [],
            collision: { rects, shotRects: [] },
            spawnPoints: { player: at(768, 690), enemies: {} },
            spawn: { ...at(768, 690), rx: 150, ry: 80 },                    // 星の魔法陣（ここから出てくる）
            master: { ...at(675, 318), interact: at(672, 418), r: 170 },     // マスター（絵の足元＝カウンターの上）と、話せる所
            board: { ...at(968, 250), interact: at(968, 372), r: 150 },     // クエスト掲示板
            doors: doors.map(d => ({ ...d, interact: new Vector2(d.x, d.y + 46 * K), r: 120 })),
            fireplace: at(56, 282),
            circle: at(768, 690)
        }
    };
}

class TavernMap extends ArenaMap {
    constructor(data) {
        super(data);
        this.walk = this.layers.ground.walk;
        this.time = 0;
    }
    
    getPlayerSpawn() {
        const s = this.layers.spawn;
        return new Vector2(s.x, s.y);
    }
    
    // 魔法陣の中の、空いている所（ほかの人と重なりにくいように、少しばらす）
    randomSpawn() {
        const s = this.layers.spawn;
        const a = Math.random() * Math.PI * 2, k = Math.sqrt(Math.random());
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
    buildBackground() { this.background = true; }
    
    draw(ctx, camera) {
        const cx = Math.round(camera.x), cy = Math.round(camera.y);
        const vw = ctx.canvas.width, vh = ctx.canvas.height;
        ctx.fillStyle = '#120a14';
        ctx.fillRect(0, 0, vw, vh);
        const img = this.img('tv_overview');
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        if (img) {
            // 見えている所だけ切り出して描く（3072 × 2048 を毎回全部描かない）
            const sx = Math.max(0, cx / TV_SCALE), sy = Math.max(0, cy / TV_SCALE);
            const sw = Math.min(img.width - sx, vw / TV_SCALE + 1), sh = Math.min(img.height - sy, vh / TV_SCALE + 1);
            if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, sx * TV_SCALE - cx, sy * TV_SCALE - cy, sw * TV_SCALE, sh * TV_SCALE);
        } else {
            ctx.fillStyle = '#4a3040';
            ctx.beginPath();
            this.walk.forEach(([x, y], i) => (i ? ctx.lineTo(x - cx, y - cy) : ctx.moveTo(x - cx, y - cy)));
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
        this.drawGlow(ctx, cx, cy);
    }
    
    // 暖炉と魔法陣の光がゆらめく（全体図の上にうすく光を足す）
    drawGlow(ctx, cx, cy) {
        const L = this.layers, t = this.time;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fp = L.fireplace;
        const f = 0.5 + 0.25 * Math.sin(t * 7.3) + 0.15 * Math.sin(t * 13.1);
        let g = ctx.createRadialGradient(fp.x - cx, fp.y - cy, 0, fp.x - cx, fp.y - cy, 220);
        g.addColorStop(0, `rgba(255, 150, 60, ${0.16 * f})`);
        g.addColorStop(1, 'rgba(255, 120, 40, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(fp.x - cx - 220, fp.y - cy - 220, 440, 440);
        const c = L.circle;
        const p = 0.5 + 0.5 * Math.sin(t * 1.6);
        ctx.translate(c.x - cx, c.y - cy);
        ctx.scale(1, 0.58);
        g = ctx.createRadialGradient(0, 0, 0, 0, 0, 400);
        g.addColorStop(0, `rgba(170, 140, 255, ${0.10 + 0.08 * p})`);
        g.addColorStop(1, 'rgba(120, 80, 255, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, 400, 0, Math.PI * 2); ctx.fill();
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
window.TV_SCALE = TV_SCALE;
