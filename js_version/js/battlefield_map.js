// 怨嗟の鎧の専用ステージ「歴戦の跡地」（赤黒い空の下の、崩れた城の跡）
//
// 素材：js_version/assets/tiles/battlefield/*.png（art_source/battlefield/tools/cut.ps1 で切り出した物）
//   bf_overview.jpg   … 全体図（浮遊する廃城の魔法闘技場.png。絵にかいてある松明の炎は消してある）。BF_SCALE 倍で床・壁・空にする
//   bf_fire_1〜8      … 火の絵（灯っている火の上に重ねて動かす。1〜3 = ゆらめき、4〜8 = だんだん小さく）
//   bf_brazier・bf_campfire … 床に置いたかがり火・たき火（火のない姿。火は bf_fire を重ねる）
//   bf_smoke_*        … 消えた火から上がる煙 / bf_mist_* … 黒い霧 / bf_magic_circle … 分身が出る印（armor_ai.js）
//   bf_tree_* / bf_spear_* / bf_wheel / bf_planks / bf_rubble_wall … 焼けた木・刺さった槍・攻城兵器の残骸
//
// 配置（全体図の上）
//   北：崩れた城門と階段（ボスが立つ）・旗・柱
//   中央：ひび割れた広い石畳と星の紋章
//   東：松明・たき火・崩れた壁・攻城兵器の残骸
//   西：松明・かがり火・剣や槍・焼けた木・投石機
//   南：主人公の出る所・壊れた階段・石の門
//
// 火（fire_01〜）：state = 'lit'（灯っている）/ 'extinguished'（消えた）/ 'relighting'（炎の魔法で灯り直している途中）
//   ・炎の魔法（ファイヤーボール）が消えた火に当たると、灯り直してまわりが見えるようになる（MagicSystem → onMagicShot）
//   ・第3形態の暗闇：灯っている火のまわりだけ見える（drawDarkness）。ボスが火の明かりに入ると実体化する（armor_ai.js）
//   ・ambient：外の城壁の上の松明（届かない所。暗闇になると消えて、勝つと灯る）
//
// 座標：全体図の px（BF_SCALE 倍してワールドの px にする）。1タイル = 64px、48×32タイル = 3072×2048px

const BF_SCALE = 2;
const BF_TILE = 64;

// 素材の大きさ（art_source/battlefield/tools/sizes.txt を写した物。画像が読めない時の配置計算にも使う）
const BF_PART_SIZE = {
    bf_fire_1: [36, 48], bf_fire_2: [39, 48], bf_fire_3: [35, 43], bf_fire_4: [28, 47], bf_fire_5: [29, 40],
    bf_fire_6: [25, 39], bf_fire_7: [21, 35], bf_fire_8: [16, 21],
    bf_campfire_lit: [83, 107], bf_brazier_lit: [73, 107], bf_campfire: [83, 107], bf_brazier: [73, 107],
    bf_smoke_1: [51, 89], bf_smoke_2: [61, 92], bf_smoke_3: [71, 85], bf_smoke_4: [55, 92],
    bf_mist_1: [51, 82], bf_mist_2: [66, 81], bf_mist_3: [76, 78], bf_mist_4: [96, 78], bf_mist_5: [90, 67],
    bf_magic_circle: [166, 152], bf_catapult: [179, 197], bf_spear_a: [26, 121], bf_spear_b: [13, 106], bf_stakes: [155, 134],
    bf_tree_a: [104, 156], bf_tree_b: [81, 141], bf_tree_c: [51, 112], bf_tree_d: [86, 148],
    bf_rubble_wall: [130, 78], bf_wheel: [60, 64], bf_planks: [97, 64], bf_rubble: [137, 87], bf_pillar_broken: [78, 99]
};
// 置いたかがり火・たき火の、器のふちの高さ（切り出した絵の上から px。cut.ps1 と同じ値）。ここから炎が出る
const BF_BOWL = { bf_campfire: 74, bf_brazier: 52 };

// ---------- マップデータ ----------
function createBattlefieldMapData() {
    const K = BF_SCALE;
    const W = 48, H = 32; // 3072 × 2048
    const at = (x, y) => ({ x: x * K, y: y * K });
    
    // ===== 歩ける所（全体図の px の多角形。時計回り）=====
    // 外の城壁・崩れた柱・がれき・投石機の所は歩けない。南の階段の上（門の手前）までは歩ける
    const WALK = [
        [290, 215], [530, 215], [548, 250], [600, 268], [660, 262], [690, 228], [850, 228], [875, 262], [930, 268], [985, 262],
        [1000, 215], [1235, 215],                                                       // 北：城門の階段の前・左右のがれき
        [1240, 288], [1172, 295], [1165, 445], [1290, 450], [1290, 505], [1172, 510],    // 東：崩れた壁・東の橋の入口
        [1152, 560], [1188, 612], [1262, 648], [1272, 742],
        [1045, 746], [1003, 746], [1000, 728], [958, 728], [955, 790], [910, 795],       // 南：柱・階段の上
        [862, 845], [695, 845], [645, 795], [600, 790], [596, 735], [540, 735], [500, 740], [400, 745], [300, 755],
        [300, 655], [395, 640], [408, 600], [400, 520], [300, 505], [300, 428],          // 西：崩れた壁・西の橋の入口
        [372, 425], [372, 282], [290, 270]                                               // 北西：投石機
    ].map(([x, y]) => [x * K, y * K]);
    
    // ===== 火（fire_01〜）=====
    // x, y：炎の中心（全体図の px） / kind：'torch'（絵にかいてある柱の上の火鉢）/ 'brazier'・'campfire'（床に置いた物）
    const fires = [];
    const fire = (x, y, kind = 'torch', opt = {}) => {
        const id = `fire_${String(fires.length + 1).padStart(2, '0')}`;
        const f = { id, kind, x: x * K, y: y * K, ambient: !!opt.ambient, part: null };
        if (kind !== 'torch') {
            // 床に置いた物：x, y は足元。炎は器のふちから
            const img = kind === 'brazier' ? 'bf_brazier' : 'bf_campfire';
            const [nw, nh] = BF_PART_SIZE[img], s = opt.s || 1;
            f.part = { img, x: x * K, y: y * K, s, w: nw * s, h: nh * s, flip: !!opt.flip };
            f.x = x * K;
            f.y = y * K - (nh - BF_BOWL[img]) * s - 10 * s;
            f.base = y * K;
            f.collision = [x * K - 26 * s, y * K - 22 * s, 52 * s, 22 * s];
        } else {
            f.base = y * K + 90;   // 柱の足元（キャラと奥行きの順番を決める）
        }
        fires.push(f);
        return f;
    };
    // 柱の上の火鉢（全体図にかいてある所）
    fire(663, 171); fire(877, 172);                 // 北：城門の階段の左右
    fire(1241, 378); fire(1270, 541);               // 東：崩れた壁の柱
    fire(981, 764); fire(879, 817);                 // 南：柱・階段の右
    fire(662, 817); fire(563, 764);                 // 南：階段の左・柱
    fire(266, 541);                                 // 西：崩れた壁の柱
    // 床に置いた物
    fire(1095, 608, 'campfire');                    // 東のたき火
    fire(452, 318, 'brazier');                      // 西のかがり火（投石機のそば）
    fire(468, 612, 'campfire', { flip: true });     // 西のたき火（槍のそば）
    // 外の城壁の上の松明（ambient：届かない所の明かり）
    for (const [x, y] of [[97, 180], [1439, 180], [93, 461], [1449, 511], [137, 754], [1400, 757]]) fire(x, y, 'torch', { ambient: true });
    
    // ===== Objects（キャラと奥行き順に描く置き物）=====
    // x = 横の中心、y = 下端（足元）、s = 拡大率（ワールドの px に対して）。col：足元の当たり判定 [幅, 高さ]
    const objects = [];
    const part = (img, x, y, s = 1, opt = {}) => {
        const [nw, nh] = BF_PART_SIZE[img];
        const d = { img, x: x * K, y: y * K, s, w: nw * s, h: nh * s, flip: !!opt.flip, sortY: y * K, alpha: opt.alpha ?? 1 };
        if (opt.col) d.collision = [d.x - opt.col[0] / 2, d.y - opt.col[1], opt.col[0], opt.col[1]];
        objects.push(d);
        return d;
    };
    // 西：焼けた木・地面に刺さった槍
    part('bf_tree_a', 430, 486, 1.0, { col: [34, 16] });
    part('bf_tree_c', 338, 738, 1.0, { col: [26, 14] });
    part('bf_spear_a', 505, 664, 0.9, { col: [12, 8] });
    part('bf_spear_b', 520, 676, 0.9, { col: [10, 8], flip: true });
    part('bf_spear_a', 402, 360, 0.85, { col: [12, 8], flip: true });
    // 東：攻城兵器の残骸（車輪・板）と崩れた壁
    part('bf_wheel', 1128, 360, 1.0, { col: [44, 14] });
    part('bf_planks', 1078, 352, 1.0, { col: [80, 18] });
    part('bf_rubble_wall', 1205, 652, 0.95, { col: [100, 22] });
    part('bf_tree_d', 1225, 470, 0.9, { col: [30, 14] });
    
    // ===== Collision（歩ける多角形の中の、通れない四角。px）=====
    const rects = [];
    for (const o of objects) if (o.collision) rects.push(o.collision);
    for (const f of fires) if (f.collision) rects.push(f.collision);
    
    // ===== SpawnPoints =====
    const spawnPoints = {
        player: at(777, 785),              // 南：階段の上
        boss: at(770, 262),                // 北：城門の階段の前（刀を納めて待つ）
        enemies: { north: [{ ...at(770, 262) }] }
    };
    
    // ===== Effects =====
    const effects = {
        // 四すみの魔法陣（全体図にかいてある紫の陣）。ゆっくり明るくなったり暗くなったりする
        circles: [at(380, 255), at(1150, 250), at(380, 690), at(1180, 700)],
        // 外のがけの下をただよう霧
        mist: [at(120, 330), at(60, 640), at(220, 900), at(1440, 320), at(1480, 660), at(1330, 930), at(520, 960), at(1010, 980)]
    };
    
    return {
        id: 'battle_scar_ruins',
        name: '歴戦の跡地',
        safeZone: false,
        width: W, height: H, tileSize: BF_TILE,
        layers: {
            ground: { walk: WALK, center: at(770, 485) },   // center：星の紋章（ステージの中心）
            groundDecoration: [], structures: [], objects, abovePlayer: [],
            fires,
            collision: { rects, shotRects: [] },
            spawnPoints, effects
        }
    };
}

// ---------- 歴戦の跡地のマップ（闘技場と同じ使い方ができる） ----------
class BattlefieldMap extends ArenaMap {
    constructor(data) {
        super(data);
        const L = this.layers;
        this.walk = L.ground.walk;
        this.center = new Vector2(L.ground.center.x, L.ground.center.y);
        this.fires = L.fires.map((f, i) => ({ ...f, state: 'lit', t: 99, seed: i * 1.73 + 0.4, light: BattlefieldMap.LIGHT.radius }));
        this.darkness = 0;        // 暗闇の濃さ（0〜1。第3形態で 1 になる）
        this.darkTarget = 0;
        this.smoke = [];          // 消えた火から上がる煙
        this.darkCanvas = null;
        // ボスが火を消しに行く時に立つ所（火のそばの、歩ける所）
        const foot = { ox: 0, oy: 50, hw: 40, hh: 20 };
        for (const f of this.fires) f.stand = this.standPoint(f, foot);
    }
    
    // ---------- 当たり判定 ----------
    // 多角形の中か（点の左右に辺が何本あるか）
    inWalkArea(x, y) {
        const P = this.walk;
        let inside = false;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
            const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }
    
    // 箱の4つの角が歩ける多角形の中にあり、置き物にも重ならなければ通れる
    isBoxBlocked(cx, cy, hw, hh) {
        const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
        if (!this.inWalkArea(x0, y0) || !this.inWalkArea(x1, y0) || !this.inWalkArea(x0, y1) || !this.inWalkArea(x1, y1)) return true;
        for (const r of this.solidRects) {
            if (x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h) return true;
        }
        return false;
    }
    
    // 魔法・ボスの弾はステージの外へ飛んでいって消える（壁の上の火にも炎の魔法が届くように、壁では止めない）
    isShotBlocked(pos) {
        const ws = this.width * this.tileSize, hs = this.height * this.tileSize;
        return pos.x < 0 || pos.y < 0 || pos.x >= ws || pos.y >= hs;
    }
    
    // 火のそばの歩ける所（火からステージの中心へ向かって、最初に歩ける所）
    standPoint(f, foot) {
        const from = new Vector2(f.x, f.kind === 'torch' ? f.y + 60 : f.base + 30);
        const to = this.center.sub(from);
        const len = to.length(), dir = to.normalize();
        for (let d = 0; d <= len; d += 12) {
            const p = from.add(dir.mult(d));
            if (!this.isBoxBlocked(p.x + foot.ox, p.y + foot.oy, foot.hw + 6, foot.hh + 6)) return this.findFreeSpot(p.add(dir.mult(30)), foot, 80);
        }
        return this.center.clone();
    }
    
    // ボス戦の始まり方（boss_battle.js が使う）：ボスは北の階段の前で刀を納めて待っている
    getBossStage() {
        const sp = this.layers.spawnPoints;
        return { boss: new Vector2(sp.boss.x, sp.boss.y), player: new Vector2(sp.player.x, sp.player.y), intro: 'sheathed' };
    }
    
    // ---------- 火 ----------
    // 戦いに使う火（外の城壁の上の松明は入れない）
    get battleFires() { return this.fires.filter(f => !f.ambient); }
    litFires() { return this.battleFires.filter(f => f.state === 'lit'); }
    
    // 明かりの強さ（0〜1）。灯り直している途中はだんだん明るくなる
    fireLight(f) {
        if (f.state === 'lit') return 1;
        if (f.state === 'relighting') return Math.min(1, f.t / BattlefieldMap.LIGHT.relight);
        return 0;
    }
    
    // 明かりの中心（炎の少し下の地面）
    lightCenter(f) { return new Vector2(f.x, f.kind === 'torch' ? f.y + 70 : f.y + 30); }
    
    // その場所が火の明かりの中か（ボスの実体化に使う）
    isLit(pos) {
        for (const f of this.battleFires) {
            const k = this.fireLight(f);
            if (k < 0.5) continue;
            const c = this.lightCenter(f);
            if (Math.hypot(pos.x - c.x, (pos.y - c.y) * 1.15) <= f.light * BattlefieldMap.LIGHT.inside) return true;
        }
        return false;
    }
    
    extinguish(f, quiet = false) {
        if (f.state === 'extinguished') return false;
        f.state = 'extinguished';
        f.t = 0;
        for (let i = 0; i < 3; i++) this.smoke.push({ x: f.x + (Math.random() - 0.5) * 16, y: f.y + 4, age: -i * 0.18, life: 1.6 + Math.random() * 0.6, img: 1 + (i % 4), drift: (Math.random() - 0.5) * 14 });
        if (!quiet) playSE('fire_out');
        return true;
    }
    
    relight(f, quiet = false) {
        if (f.state !== 'extinguished') return false;
        f.state = 'relighting';
        f.t = 0;
        if (!quiet) playSE('fire_light');
        return true;
    }
    
    // 全部の火を灯す（勝った時）
    relightAll() {
        for (const f of this.fires) if (f.state === 'extinguished') this.relight(f, true);
    }
    
    setDarkness(v) { this.darkTarget = Math.max(0, Math.min(1, v)); }
    
    // 炎の魔法の弾が消えた火に当たったか（magic.js の MagicSystem.update が毎フレーム呼ぶ）。当たったら火が灯り、弾は消える
    onMagicShot(proj) {
        if (!proj.active || !proj.magic || proj.magic.element !== '炎') return false;
        for (const f of this.battleFires) {
            if (f.state !== 'extinguished') continue;
            const d = Math.hypot(proj.position.x - f.x, proj.position.y - f.y);
            if (d <= BattlefieldMap.LIGHT.hit + (proj.size || 0)) {
                this.relight(f);
                proj.active = false;
                proj.ended = true;
                return true;
            }
        }
        return false;
    }
    
    update(deltaTime) {
        super.update(deltaTime);
        const L = BattlefieldMap.LIGHT;
        for (const f of this.fires) {
            f.t += deltaTime;
            if (f.state === 'relighting' && f.t >= L.relight) { f.state = 'lit'; f.t = 0; }
            // 消えた火：しばらく細い煙が上がる
            if (f.state === 'extinguished' && f.t < 4 && Math.random() < deltaTime * 2.2) {
                this.smoke.push({ x: f.x + (Math.random() - 0.5) * 10, y: f.y + 6, age: 0, life: 1.8 + Math.random() * 0.8, img: 1 + Math.floor(Math.random() * 4), drift: (Math.random() - 0.5) * 10, thin: true });
            }
        }
        for (const s of this.smoke) s.age += deltaTime;
        this.smoke = this.smoke.filter(s => s.age < s.life);
        // 暗闇はゆっくり濃く・ゆっくり晴れる
        const sp = this.darkTarget > this.darkness ? L.darkIn : L.darkOut;
        if (this.darkness < this.darkTarget) this.darkness = Math.min(this.darkTarget, this.darkness + deltaTime / sp);
        else if (this.darkness > this.darkTarget) this.darkness = Math.max(this.darkTarget, this.darkness - deltaTime / sp);
    }
    
    // ---------- 描画 ----------
    // 全体図を BF_SCALE 倍で描く（ドットがぼやけないように最近傍補間。ワールド全体を1回の drawImage で描くので、ドットがずれない）
    buildBackground() { this.background = true; }
    
    draw(ctx, camera) {
        const cx = Math.round(camera.x), cy = Math.round(camera.y);
        const vw = ctx.canvas.width, vh = ctx.canvas.height;
        ctx.fillStyle = '#1b0d16';
        ctx.fillRect(0, 0, vw, vh);
        const img = this.img('bf_overview');
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        if (img) ctx.drawImage(img, -cx, -cy, img.width * BF_SCALE, img.height * BF_SCALE);
        else this.drawPlaceholder(ctx, cx, cy);
        ctx.restore();
        ctx.save();
        ctx.translate(-cx, -cy);
        this.drawCircles(ctx);
        this.drawMist(ctx, cx, cy, vw, vh);
        ctx.restore();
    }
    
    // 全体図が読めない時：歩ける所だけ石の色で描く
    drawPlaceholder(ctx, cx, cy) {
        ctx.fillStyle = '#3a2a36';
        ctx.beginPath();
        this.walk.forEach(([x, y], i) => (i ? ctx.lineTo(x - cx, y - cy) : ctx.moveTo(x - cx, y - cy)));
        ctx.closePath();
        ctx.fill();
    }
    
    // 四すみの紫の魔法陣：ゆっくり明るくなったり暗くなったりする（暗闇の間は消える）
    drawCircles(ctx) {
        const img = this.img('bf_magic_circle');
        const k = 1 - this.darkness;
        if (!img || k <= 0.02) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        this.layers.effects.circles.forEach((c, i) => {
            const a = (0.1 + 0.08 * Math.sin(this.time * 1.4 + i * 1.7)) * k;
            const w = 236, h = 118;
            ctx.globalAlpha = a;
            ctx.drawImage(img, c.x - w / 2, c.y - h / 2, w, h);
        });
        ctx.restore();
    }
    
    // がけの下をただよう黒い霧
    drawMist(ctx, cx, cy, vw, vh) {
        ctx.save();
        this.layers.effects.mist.forEach((m, i) => {
            const img = this.img(`bf_mist_${1 + (i % 5)}`);
            if (!img) return;
            const x = m.x + Math.sin(this.time * 0.25 + i) * 40, y = m.y + Math.sin(this.time * 0.4 + i * 2) * 10;
            const w = img.width * 2.4, h = img.height * 1.6;
            if (x + w < cx || x - w > cx + vw || y + h < cy || y - h > cy + vh) return;
            ctx.globalAlpha = 0.28 + 0.1 * Math.sin(this.time * 0.6 + i);
            ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
        });
        ctx.restore();
    }
    
    // キャラと奥行き順に並べて描く物：置き物と火
    getDepthDrawables(player) {
        const list = this.layers.objects.map(o => ({ sortY: o.sortY, draw: (ctx, camera) => this.drawObject(ctx, camera, o, player) }));
        for (const f of this.fires) list.push({ sortY: f.base, draw: (ctx, camera) => this.drawFire(ctx, camera, f, player) });
        return list;
    }
    
    // 火を1つ描く：床に置いた物は器（火のない姿）、その上に炎の絵を重ねる。明かりもゆらめかせる
    drawFire(ctx, camera, f, player) {
        const cx = Math.round(camera.x), cy = Math.round(camera.y);
        if (f.part) this.drawObject(ctx, camera, f.part, player);
        const k = this.fireLight(f);
        ctx.save();
        if (k > 0) {
            // 明かり（暗闇でない時も、火のまわりを少し暖かい色に）
            const fl = 1 + Math.sin(this.time * 9 + f.seed) * 0.06 + Math.sin(this.time * 5.3 + f.seed * 2) * 0.05;
            const gx = f.x - cx, gy = f.y - cy + 10, r = 120 * fl * k;
            ctx.globalCompositeOperation = 'lighter';
            const gl = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
            gl.addColorStop(0, `rgba(255, 150, 60, ${0.34 * k})`);
            gl.addColorStop(1, 'rgba(255, 90, 30, 0)');
            ctx.fillStyle = gl;
            ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
            ctx.globalCompositeOperation = 'source-over';
            // 炎の絵：灯り直している途中は小さい火（8）から大きく（4）、灯っている間は 1〜3 をくり返す
            let n;
            if (f.state === 'relighting') n = 8 - Math.min(4, Math.floor(k * 5));
            else n = 1 + Math.floor((this.time * 9 + f.seed * 3) % 3);
            const img = this.img(`bf_fire_${n}`);
            const s = (f.kind === 'torch' ? 1.25 : 1.15) * (f.state === 'relighting' ? 0.7 + 0.3 * k : 1);
            if (img) {
                const w = img.width * s, h = img.height * s;
                ctx.drawImage(img, Math.round(f.x - cx - w / 2), Math.round(f.y - cy + 14 * s - h), Math.round(w), Math.round(h));
            } else {
                ctx.fillStyle = '#ffb347';
                ctx.beginPath(); ctx.ellipse(f.x - cx, f.y - cy, 9 * s, 16 * s, 0, 0, Math.PI * 2); ctx.fill();
            }
        }
        // 消えた火の煙
        for (const sm of this.smoke) {
            if (Math.abs(sm.x - f.x) > 30 || Math.abs(sm.y - f.y) > 30) continue;
            this.drawSmoke(ctx, sm, cx, cy);
        }
        ctx.restore();
    }
    
    drawSmoke(ctx, sm, cx, cy) {
        if (sm.age < 0) return;
        const img = this.img(`bf_smoke_${sm.img}`);
        const t = sm.age / sm.life;
        const s = (sm.thin ? 0.35 : 0.55) * (0.6 + t * 0.8);
        ctx.globalAlpha = (sm.thin ? 0.35 : 0.6) * Math.sin(Math.min(1, t * 1.4) * Math.PI);
        const x = sm.x + sm.drift * sm.age - cx, y = sm.y - 50 * sm.age - cy;
        if (img) {
            const w = img.width * s, h = img.height * s;
            ctx.drawImage(img, x - w / 2, y - h, w, h);
        } else {
            ctx.fillStyle = 'rgba(40, 30, 40, 0.6)';
            ctx.beginPath(); ctx.arc(x, y - 20, 12 * s * 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
    
    // ---------- 暗闇（第3形態）----------
    // 画面全体を黒くおおい、明かり（灯っている火・主人公・魔法の弾など）の所だけ穴をあける
    // lights：[{ x, y（ワールド px）, r（半径）, k（強さ 0〜1）}]。灯っている火は自分で足す
    drawDarkness(ctx, camera, lights = []) {
        const a = this.darkness;
        if (a <= 0.01) return;
        const PAD = 40;
        const W = ctx.canvas.width + PAD * 2, H = ctx.canvas.height + PAD * 2;
        if (!this.darkCanvas || this.darkCanvas.width !== W || this.darkCanvas.height !== H) {
            this.darkCanvas = document.createElement('canvas');
            this.darkCanvas.width = W; this.darkCanvas.height = H;
        }
        const c = this.darkCanvas, g = c.getContext('2d');
        const ox = camera.x - PAD, oy = camera.y - PAD;
        const all = lights.slice();
        const warm = [];
        for (const f of this.fires) {
            const k = this.fireLight(f);
            if (k <= 0) continue;
            const fl = 1 + Math.sin(this.time * 8 + f.seed) * 0.035 + Math.sin(this.time * 4.7 + f.seed * 3) * 0.03;
            const lc = this.lightCenter(f);
            all.push({ x: lc.x, y: lc.y - 30, r: f.light * fl * (0.4 + 0.6 * k), k });
            warm.push({ x: lc.x, y: lc.y - 30, r: f.light * fl * k, k });
        }
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, W, H);
        g.fillStyle = `rgba(4, 2, 9, ${BattlefieldMap.LIGHT.dark * a})`;
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'destination-out';
        for (const L of all) {
            const x = L.x - ox, y = L.y - oy, r = L.r;
            if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
            const gr = g.createRadialGradient(x, y, 0, x, y, r);
            gr.addColorStop(0, `rgba(0,0,0,${L.k})`);
            gr.addColorStop(0.55, `rgba(0,0,0,${0.85 * L.k})`);
            gr.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = gr;
            g.fillRect(x - r, y - r, r * 2, r * 2);
        }
        ctx.drawImage(c, -PAD, -PAD);
        // 火の明かりの所は、少し赤っぽく暖かい色
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const L of warm) {
            const x = L.x - camera.x, y = L.y - camera.y, r = L.r * 0.8;
            const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
            gr.addColorStop(0, `rgba(255, 120, 40, ${0.14 * a * L.k})`);
            gr.addColorStop(1, 'rgba(255, 80, 20, 0)');
            ctx.fillStyle = gr;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        ctx.restore();
    }
    
    // デバッグ用：当たり判定（window.showCollision = true）。歩ける多角形・火の灯りの範囲・ボスの立つ所
    drawCollisionDebug(ctx, camera) {
        super.drawCollisionDebug(ctx, camera);
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 40, 0, 0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        this.walk.forEach(([x, y], i) => (i ? ctx.lineTo(x - camera.x, y - camera.y) : ctx.moveTo(x - camera.x, y - camera.y)));
        ctx.closePath();
        ctx.stroke();
        for (const f of this.battleFires) {
            const c = this.lightCenter(f);
            ctx.strokeStyle = 'rgba(255, 200, 60, 0.7)';
            ctx.beginPath(); ctx.ellipse(c.x - camera.x, c.y - camera.y, f.light * BattlefieldMap.LIGHT.inside, f.light * BattlefieldMap.LIGHT.inside / 1.15, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#ffd34a';
            ctx.fillRect(f.stand.x - camera.x - 4, f.stand.y - camera.y - 4, 8, 8);
            ctx.font = '14px sans-serif';
            ctx.fillText(f.id, f.x - camera.x + 10, f.y - camera.y);
        }
        ctx.restore();
    }
}

// 火の明かりの調整
// radius：明かりの半径(px) / inside：この割合より内側に入ったボスは実体化する / hit：炎の魔法が火に当たる距離(px)
// relight：灯り直すのにかかる秒数 / dark：暗闇の黒さ（1 = まっ黒） / darkIn・darkOut：暗くなる・晴れる秒数
BattlefieldMap.LIGHT = { radius: 300, inside: 0.85, hit: 46, relight: 0.6, dark: 0.95, darkIn: 1.4, darkOut: 2.0 };

window.BF_PART_SIZE = BF_PART_SIZE;
window.createBattlefieldMapData = createBattlefieldMapData;
window.BattlefieldMap = BattlefieldMap;
