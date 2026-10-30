// 魔法陣システム
//
// 流れ：魔法ボタン → 主人公が詠唱（足元に属性色の魔法陣、頭上にゲージ）→ ゲージ満タンで発動
// 詠唱中は歩くことしかできない（ダッシュ・攻撃は不可。回避を押すと詠唱をキャンセルして回避）。詠唱の処理は player.js

// 属性ごとの色と画像の名前（魔法陣の形は全属性共通で、色だけ変える）
const MAGIC_ELEMENTS = {
    '炎': { key: 'fire',    color: '#ff4a3a', light: '#ffb199', label: '炎' },
    '水': { key: 'water',   color: '#3a8dff', light: '#a8d4ff', label: '水' },
    '風': { key: 'wind',    color: '#3fe0b8', light: '#b8fff0', label: '風' }, // 緑と水色の間
    '土': { key: 'earth',   color: '#a8743f', light: '#e6c79a', label: '土' },
    '雷': { key: 'thunder', color: '#a35cff', light: '#dcc2ff', label: '雷' },
    '癒': { key: 'heal',    color: '#46d97e', light: '#d2ffe0', label: '癒' }, // 治癒魔法（ヒール）
    '光': { key: 'light',   color: '#fff07a', light: '#fffbe0', label: '光' },
    '氷': { key: 'ice',     color: '#66ccff', light: '#d8f3ff', label: '氷' },
    '無': { key: 'none',    color: '#ffb347', light: '#ffe2b8', label: '無' }
};

// 魔術の大きさの倍率（全部の魔術：弾・残り火・竜巻・雷・発動の魔法陣）。見た目と当たり判定の両方が大きくなる
const MAGIC_SIZE_MUL = 1.5;

// 最初から使える5つの魔術（data/magic_circles.json と同じ内容。JSON を読めない時の予備にも使う）
// chantTime：詠唱にかかる秒数 / range：弾が飛ぶ最大距離(px)
const STARTER_MAGIC = [
    // 炎：火の玉。敵に当たるか最大距離まで飛ぶと、そこが燃える地面（草原・木など）なら炎が残って少しずつダメージ
    { id: 'magic_201', name: 'ファイヤーボール', category: '攻撃', element: '炎', power: 26, spCost: 10, cooldown: 0.8, chantTime: 1.0, requiredStage: 0, starter: true,
      shape: 'projectile', speed: 330, size: 14, range: 420,
      burn: { duration: 3.0, interval: 0.5, damage: 3, radius: 36 },
      description: '火の玉を放つ。着弾した地面が燃える素材なら炎が残り、上にいる敵に小さなダメージを与え続ける。' },
    // 水：水の玉。当たると敵を大きく押し流す
    { id: 'magic_202', name: 'ウォーターボール', category: '攻撃', element: '水', power: 20, spCost: 8, cooldown: 0.6, chantTime: 0.8, requiredStage: 0, starter: true,
      shape: 'projectile', speed: 380, size: 13, range: 400, knockback: 70,
      description: '水の玉を放つ。当たった敵を大きく押し流す。' },
    // 風：小さな竜巻。前に進んでその場にとどまり、まわりの敵を吸い寄せて何度もダメージ
    { id: 'magic_203', name: 'テンペスト', category: '攻撃', element: '風', power: 6, spCost: 9, cooldown: 1.0, chantTime: 0.8, requiredStage: 0, starter: true,
      shape: 'tornado', travel: 280, travelTime: 0.9, radius: 30, duration: 6.0, interval: 0.4, pull: 90, pullRadius: 120,
      description: '小さな竜巻を生み出す。前に進んでその場に長くとどまり、まわりの敵を吸い寄せながら何度もダメージを与える。' },
    // 土：岩の弾。遅いが重くて威力が高い
    { id: 'magic_204', name: 'ストーンキャノン', category: '攻撃', element: '土', power: 38, spCost: 12, cooldown: 1.0, chantTime: 1.3, requiredStage: 0, starter: true,
      shape: 'projectile', speed: 270, size: 17, range: 380, knockback: 40, rock: true,
      description: '岩の弾を撃ち出す。詠唱は長いが威力が高く、敵を押し返す。' },
    // 雷：前方の敵に直接雷を落とす
    { id: 'magic_205', name: 'ライトニング', category: '攻撃', element: '雷', power: 28, spCost: 12, cooldown: 1.0, chantTime: 1.1, requiredStage: 0, starter: true,
      shape: 'strike', range: 380, radius: 45,
      description: '前方の敵に直接雷を落とす。' },
    // 治癒：自分の HP を回復する（heal：最大 HP に対する回復の割合）。ねらう向きはない（shape: 'self'）
    // 詠唱が長いので、攻撃に当たって止められないよう、すきを見て使う。HP が満タンの時は使えない
    { id: 'magic_206', name: 'ヒール', category: '治癒', element: '癒', power: 0, heal: 0.3, spCost: 20, cooldown: 6.0, chantTime: 1.2, requiredStage: 0, starter: true,
      shape: 'self',
      description: 'やさしい星の光で傷を癒す。最大HPの30%を回復する。詠唱が長く、攻撃に当たると止まってしまう。' }
];

// 燃える地面か（草原・畑・花・木・柵・看板・家など。土の道・石畳・水・井戸は燃えない）
const FLAMMABLE_TILES = new Set(['grass', 'farmland', 'flower', 'tree', 'fence', 'sign', 'house', 'shop']);
function isFlammableAt(map, pos) {
    if (!map || !map.getTileAt) return true; // マップがない時（テスト等）は燃える扱い
    const tile = map.getTileAt(pos.x, pos.y);
    if (!tile) return false;                 // マップの外
    if (tile.object && FLAMMABLE_TILES.has(tile.object.type)) return true;
    return FLAMMABLE_TILES.has(tile.type);
}

function getElementInfo(element) {
    return MAGIC_ELEMENTS[element] || MAGIC_ELEMENTS['無'];
}

// ===== 魔術のエフェクト画像 =====
// art_source/magic/tools/cut.ps1 で切り出した物（値は art_source/magic/meta.txt を写した物）
// n：コマ数 / w, h：1コマの大きさ / ax, ay：基準点（弾は先頭、竜巻・雷・炎は根元、そのほかは中心）
// coreW, coreH：光の芯の大きさ（ゲームで描く大きさを決めるのに使う）
// 弾（*_fly）と岩の砕け（stone_hit）は右向きに描いてあるので、飛ぶ向きに回して使う
// circle は魔法陣（画像は magic_circle_<属性>.png）
const MAGIC_FX = {
    circle:        { n: 5, w: 273, h: 273, ax: 138, ay: 134, coreW: 248, coreH: 249 },
    fire_fly:      { n: 4, w: 163, h: 109, ax: 144, ay: 48,  coreW: 134, coreH: 85 },
    fire_hit:      { n: 4, w: 171, h: 153, ax: 86,  ay: 78,  coreW: 122, coreH: 115 },
    fire_burn:     { n: 4, w: 111, h: 111, ax: 53,  ay: 102, coreW: 91,  coreH: 80 },
    water_fly:     { n: 3, w: 159, h: 94,  ax: 146, ay: 45,  coreW: 138, coreH: 80 },
    water_hit:     { n: 4, w: 155, h: 124, ax: 78,  ay: 64,  coreW: 96,  coreH: 101 },
    wind_loop:     { n: 3, w: 166, h: 227, ax: 87,  ay: 199, coreW: 133, coreH: 187 },
    wind_edge:     { n: 4, w: 129, h: 147, ax: 56,  ay: 132, coreW: 86,  coreH: 104 },
    thunder_bolt:  { n: 4, w: 175, h: 321, ax: 86,  ay: 296, coreW: 128, coreH: 272 },
    thunder_flash: { n: 4, w: 230, h: 132, ax: 114, ay: 68,  coreW: 172, coreH: 98 },
    stone_fly:     { n: 4, w: 324, h: 154, ax: 322, ay: 76,  coreW: 311, coreH: 142 },
    stone_hit:     { n: 4, w: 373, h: 301, ax: 211, ay: 163, coreW: 304, coreH: 211 },
    stone_dust:    { n: 4, w: 263, h: 194, ax: 126, ay: 86,  coreW: 176, coreH: 141 }
};
// stone_hit の1コマ目（岩の弾が当たった瞬間）の、光の中心から弾の先頭までの長さ（画像の px）
const STONE_HIT_TIP = 107;

// その名前のコマが全部読めているか（1枚でも欠けていたら、丸と線で描く）
function hasMagicFx(name) {
    const fx = MAGIC_FX[name];
    if (!fx || !window.assetManager) return false;
    for (let i = 1; i <= fx.n; i++) if (!window.assetManager.get(`magicfx_${name}_${i}`)) return false;
    return true;
}

// 光の芯が px ピクセルになる倍率（by：'w' なら横幅、'h' なら高さで合わせる）
function magicFxScale(name, px, by = 'w') {
    const fx = MAGIC_FX[name];
    return px / (by === 'h' ? fx.coreH : fx.coreW);
}

// 1コマを、基準点を (x, y) に合わせて描く。frame はコマ数を超えるとくり返す
// rot：回す角度（右向きの画像を飛ぶ向きへ。左向きの時は上下が逆さにならないよう裏返す）
function drawMagicFx(ctx, name, frame, x, y, scale, rot = 0, alpha = 1) {
    const fx = MAGIC_FX[name];
    const i = ((Math.floor(frame) % fx.n) + fx.n) % fx.n;
    const img = window.assetManager && window.assetManager.get(`magicfx_${name}_${i + 1}`);
    if (!img || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, alpha);
    // 縮めて描くので、なめらかに（ドットが抜けてチラつかないように）
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(x, y);
    if (rot) {
        ctx.rotate(rot);
        if (Math.cos(rot) < 0) ctx.scale(1, -1);
    }
    ctx.drawImage(img, -fx.ax * scale, -fx.ay * scale, fx.w * scale, fx.h * scale);
    ctx.restore();
}

// 一度だけ流すコマ送り：t 秒目のコマと濃さ（終わったら null）。最後のコマは fade 秒かけて消える
function magicFxOnce(name, t, frameTime, fade = 0) {
    const n = MAGIC_FX[name].n;
    if (t < 0) return null;
    const f = Math.floor(t / frameTime);
    if (f < n) return { frame: f, alpha: 1 };
    const over = t - n * frameTime;
    if (fade > 0 && over < fade) return { frame: n - 1, alpha: 1 - over / fade };
    return null;
}

// 着弾の爆発・しぶき・岩の砕け・砂ぼこりなど、その場で一度だけ流すエフェクト
class MagicSpriteFx {
    // opts：frameTime（1コマの秒数）/ fade（最後のコマが消えるまでの秒数）/ delay（出るまでの秒数）/ rot（回す角度）
    constructor(name, position, scale, opts = {}) {
        this.name = name;
        this.position = position.clone();
        this.scale = scale;
        this.frameTime = opts.frameTime || 0.07;
        this.fade = opts.fade || 0;
        this.delay = opts.delay || 0;
        this.rot = opts.rot || 0;
        this.age = 0;
        this.active = true;
    }
    
    update(deltaTime) {
        this.age += deltaTime;
        if (this.age >= this.delay + MAGIC_FX[this.name].n * this.frameTime + this.fade) this.active = false;
    }
    
    draw(ctx, camera) {
        const k = magicFxOnce(this.name, this.age - this.delay, this.frameTime, this.fade);
        if (!k) return;
        const s = this.position.sub(camera);
        drawMagicFx(ctx, this.name, k.frame, s.x, s.y, this.scale, this.rot, k.alpha);
    }
}

// 魔法陣を描く（画像 assets/effects/magic_circle_<属性>.png があれば画像、なければ六芒星を線で描く）
// squash: 縦のつぶし具合（地面に置くと 0.5 くらい）
// scaleX: 横のつぶし具合（横向きのキャラが手の前に出す時は 0.3 くらいで縦長のだ円になる）
function drawMagicCircle(ctx, x, y, radius, element, rotation = 0, alpha = 1, squash = 0.5, scaleX = 1) {
    const info = getElementInfo(element);
    const img = window.assetManager ? window.assetManager.get(`magic_circle_${info.key}`) : null;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scaleX, squash);
    ctx.rotate(rotation);
    
    if (img) {
        // 画像の外側の円が radius に来るように（そのまわりの光のにじみは少しはみ出す）
        const c = MAGIC_FX.circle, k = radius * 2 / c.coreW;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, -c.ax * k, -c.ay * k, c.w * k, c.h * k);
    } else {
        // 光のにじみ
        const glow = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius * 1.15);
        glow.addColorStop(0, info.color + '55');
        glow.addColorStop(1, info.color + '00');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.15, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = info.color;
        ctx.shadowColor = info.color;
        ctx.shadowBlur = 10;
        // 外側の円・内側の円
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        // 六芒星（三角形2つ）
        ctx.strokeStyle = info.light;
        for (let t = 0; t < 2; t++) {
            ctx.beginPath();
            for (let i = 0; i < 3; i++) {
                const a = (Math.PI * 2 / 3) * i + t * Math.PI / 3 - Math.PI / 2;
                const px = Math.cos(a) * radius * 0.82;
                const py = Math.sin(a) * radius * 0.82;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
        }
    }
    ctx.restore();
}

class MagicProjectile {
    // direction: 'up' などの文字列、または Vector2（向き）
    constructor(magic, position, direction) {
        this.magic = magic;
        this.position = position.clone();
        this.speed = magic.speed || 300;
        this.size = (magic.size || 16) * MAGIC_SIZE_MUL;
        this.direction = typeof direction === 'string' ? this.dirToVector(direction) : direction.normalize();
        this.velocity = this.direction.mult(this.speed);
        this.lifetime = 3.0;
        this.maxDistance = magic.range || 600; // 飛ぶ最大距離
        this.traveled = 0;
        this.age = 0;
        this.active = true;
        this.ended = false;                 // 消えた瞬間（炎が残るかの判定に使う）
        this.pierce = !!magic.pierce;
        this.knockback = magic.knockback || 0; // 水・土：押し出し
        this.spin = 0;                      // 岩の回転
        this.hitEnemies = new Set();        // 貫通弾が同じ敵に何度も当たらないように
        
        // エフェクト
        this.trailPositions = [];
        this.maxTrailLength = 10;
    }
    
    dirToVector(dir) {
        switch (dir) {
            case 'up': return new Vector2(0, -1);
            case 'down': return new Vector2(0, 1);
            case 'left': return new Vector2(-1, 0);
            case 'right': return new Vector2(1, 0);
            default: return new Vector2(0, -1);
        }
    }
    
    update(deltaTime) {
        if (!this.active) return;
        
        // 軌跡を記録
        this.trailPositions.push(this.position.clone());
        if (this.trailPositions.length > this.maxTrailLength) {
            this.trailPositions.shift();
        }
        
        // 移動
        this.position = this.position.add(this.velocity.mult(deltaTime));
        this.traveled += this.speed * deltaTime;
        this.spin += deltaTime * 8;
        
        // 寿命・最大距離
        this.age += deltaTime;
        if (this.age >= this.lifetime || this.traveled >= this.maxDistance) {
            this.active = false;
            this.ended = true;
        }
    }
    
    checkCollision(target) {
        if (!this.active || this.hitEnemies.has(target)) return false;
        
        const distance = this.position.distance(target.position);
        return distance < this.size + target.size / 2;
    }
    
    hit(target) {
        this.hitEnemies.add(target);
        if (!this.pierce) { this.active = false; this.ended = true; }
    }
    
    // 画像の名前（炎 fire_fly / 水 water_fly / 土 stone_fly）
    get fxName() {
        return this.magic.rock ? 'stone_fly' : `${getElementInfo(this.magic.element).key}_fly`;
    }
    
    // 画像の大きさ：弾の高さを当たり判定の何倍にするか / 弾の先頭を中心からどれだけ前に出すか
    static FX_LOOK = {
        fire_fly:  { height: 2.8, tip: 0.95, frameTime: 0.07 },
        water_fly: { height: 2.6, tip: 0.95, frameTime: 0.08 },
        stone_fly: { height: 2.4, tip: 1.1,  frameTime: 0.08 }
    };
    
    fxScale() {
        const look = MagicProjectile.FX_LOOK[this.fxName];
        return look ? magicFxScale(this.fxName, this.size * look.height, 'h') : 1;
    }
    
    // 弾の先頭の位置（画面の座標）
    fxTip(camera) {
        const look = MagicProjectile.FX_LOOK[this.fxName];
        const tip = this.size * (look ? look.tip : 1);
        return this.position.add(this.direction.mult(tip)).sub(camera);
    }
    
    // 画像があれば、飛ぶ向きに回したコマ送りで描く（なければ false を返し、丸と線で描く）
    drawSprite(ctx, camera) {
        const name = this.fxName, look = MagicProjectile.FX_LOOK[name];
        if (!look || !hasMagicFx(name)) return false;
        const t = this.fxTip(camera);
        drawMagicFx(ctx, name, this.age / look.frameTime, t.x, t.y, this.fxScale(),
            Math.atan2(this.direction.y, this.direction.x));
        return true;
    }
    
    draw(ctx, camera) {
        if (!this.active) return;
        if (this.drawSprite(ctx, camera)) return;
        if (this.magic.rock) return this.drawRock(ctx, camera);
        
        const screenPos = this.position.sub(camera);
        const info = getElementInfo(this.magic.element);
        const color = info.color;
        
        ctx.save();
        
        // 軌跡
        for (let i = 0; i < this.trailPositions.length; i++) {
            const trailPos = this.trailPositions[i].sub(camera);
            ctx.globalAlpha = (i / this.trailPositions.length) * 0.35;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(trailPos.x, trailPos.y, this.size * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.globalAlpha = 1.0;
        
        // 外側の輝き
        const gradient = ctx.createRadialGradient(
            screenPos.x, screenPos.y, 0,
            screenPos.x, screenPos.y, this.size * 1.6
        );
        gradient.addColorStop(0, info.light);
        gradient.addColorStop(0.45, color + 'cc');
        gradient.addColorStop(1, color + '00');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, this.size * 1.6, 0, Math.PI * 2);
        ctx.fill();
        
        // コア
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, this.size * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = info.light;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, this.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
    
    // ストーンキャノン：回りながら飛ぶゴツゴツした岩と、後ろに砂ぼこり
    drawRock(ctx, camera) {
        const s = this.position.sub(camera);
        const r = this.size;
        ctx.save();
        // 砂ぼこり
        for (let i = 0; i < this.trailPositions.length; i += 2) {
            const t = this.trailPositions[i].sub(camera);
            ctx.globalAlpha = (i / this.trailPositions.length) * 0.35;
            ctx.fillStyle = '#c9a77a';
            ctx.beginPath();
            ctx.arc(t.x, t.y, r * 0.6, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.translate(s.x, s.y);
        ctx.rotate(this.spin);
        // 岩（でこぼこの多角形）
        const pts = [1, 0.82, 0.95, 0.75, 1, 0.85, 0.92, 0.78];
        ctx.beginPath();
        pts.forEach((k, i) => {
            const a = (Math.PI * 2 / pts.length) * i;
            const x = Math.cos(a) * r * k, y = Math.sin(a) * r * k;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = '#8a6a45';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#4a3420';
        ctx.stroke();
        // 明るい面とひび
        ctx.fillStyle = '#b48b5c';
        ctx.beginPath();
        ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.45, r * 0.28, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#4a3420';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(r * 0.1, -r * 0.1); ctx.lineTo(r * 0.45, r * 0.25); ctx.lineTo(r * 0.3, r * 0.5);
        ctx.stroke();
        ctx.restore();
    }
    
    getElementColor() {
        return getElementInfo(this.magic.element).color;
    }
}

// ファイヤーボールの着弾地点に残る炎：燃えている間、上にいる敵に小さなダメージを一定間隔で与える
class FirePatch {
    constructor(magic, position) {
        const b = magic.burn || {};
        this.magic = magic;
        this.position = position.clone();
        this.radius = (b.radius || 36) * MAGIC_SIZE_MUL;
        this.duration = b.duration || 3;
        this.interval = b.interval || 0.5;
        this.damage = b.damage || 3;
        this.age = 0;
        this.tickTimer = 0;
        this.pendingTick = false;
        this.active = true;
        // 炎の粒（ゆらゆら上がる）
        this.flames = [];
        for (let i = 0; i < 9; i++) {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * this.radius * 0.8;
            this.flames.push({ x: Math.cos(a) * d, y: Math.sin(a) * d * 0.5, phase: Math.random() * Math.PI * 2, size: (6 + Math.random() * 6) * MAGIC_SIZE_MUL });
        }
        // 画像の炎（fire_burn）：真ん中に大きいの1つ、まわりに小さいの4つ。奥（上）から順に描く
        this.sprites = [{ x: 0, y: 0, k: 1, phase: 0, speed: 0.1 }];
        for (let i = 0; i < 4; i++) {
            const a = (Math.PI * 2 / 4) * i + Math.PI / 4 + (Math.random() - 0.5) * 0.6;
            const d = this.radius * (0.5 + Math.random() * 0.2);
            this.sprites.push({ x: Math.cos(a) * d, y: Math.sin(a) * d * 0.5, k: 0.6 + Math.random() * 0.2,
                phase: Math.floor(Math.random() * 4), speed: 0.09 + Math.random() * 0.04 });
        }
        this.sprites.sort((p, q) => p.y - q.y);
    }
    
    update(deltaTime) {
        this.age += deltaTime;
        this.tickTimer += deltaTime;
        if (this.tickTimer >= this.interval) {
            this.tickTimer -= this.interval;
            this.pendingTick = true; // checkCollisions で一度だけダメージ
        }
        if (this.age >= this.duration) this.active = false;
    }
    
    draw(ctx, camera) {
        const s = this.position.sub(camera);
        const fadeIn = Math.min(1, this.age / 0.15);
        const fadeOut = Math.min(1, (this.duration - this.age) / 0.6);
        const a = Math.max(0, Math.min(fadeIn, fadeOut));
        ctx.save();
        // 焦げ跡
        ctx.globalAlpha = 0.45 * a;
        ctx.fillStyle = '#2a1608';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, this.radius, this.radius * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // 地面の照り返し
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, this.radius * 1.2);
        g.addColorStop(0, 'rgba(255, 170, 60, 0.55)');
        g.addColorStop(1, 'rgba(255, 90, 30, 0)');
        ctx.globalAlpha = a;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, this.radius * 1.2, this.radius * 0.65, 0, 0, Math.PI * 2);
        ctx.fill();
        // 画像の炎：燃え上がる時は下から伸びるように大きくなり、最後はうすくなって消える
        if (hasMagicFx('fire_burn')) {
            const grow = 1 - Math.pow(1 - Math.min(1, this.age / 0.25), 2);
            const base = magicFxScale('fire_burn', this.radius * 1.15, 'w');
            for (const f of this.sprites) {
                drawMagicFx(ctx, 'fire_burn', f.phase + this.age / f.speed, s.x + f.x, s.y + f.y,
                    base * f.k * (0.4 + 0.6 * grow)); // 濃さは上の globalAlpha（= a）のまま
            }
            ctx.restore();
            return;
        }
        // 炎（ゆらゆら）
        for (const f of this.flames) {
            const t = this.age * 7 + f.phase;
            const h = f.size * (1.4 + Math.sin(t) * 0.35);
            const x = s.x + f.x + Math.sin(t * 0.7) * 1.5, y = s.y + f.y;
            ctx.fillStyle = '#ff5a1f';
            ctx.beginPath();
            ctx.moveTo(x - f.size * 0.5, y);
            ctx.quadraticCurveTo(x - f.size * 0.4, y - h * 0.6, x, y - h);
            ctx.quadraticCurveTo(x + f.size * 0.4, y - h * 0.6, x + f.size * 0.5, y);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#ffd25a';
            ctx.beginPath();
            ctx.moveTo(x - f.size * 0.25, y);
            ctx.quadraticCurveTo(x - f.size * 0.2, y - h * 0.35, x, y - h * 0.6);
            ctx.quadraticCurveTo(x + f.size * 0.2, y - h * 0.35, x + f.size * 0.25, y);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }
}

// テンペスト：小さな竜巻。ゆっくり前に進み、巻き込んだ敵に一定間隔でダメージ。少し吸い寄せる
class Tornado {
    constructor(magic, position, direction, travel = null) {
        this.magic = magic;
        this.position = position.clone();
        this.direction = direction.normalize();
        this.start = position.clone();
        this.travel = travel !== null ? travel : (magic.travel || 110); // 進む距離（壁があればその手前まで）
        this.travelTime = magic.travelTime || 0.45; // 進むのにかかる時間（そのあとはその場にとどまる）
        this.radius = (magic.radius || 30) * MAGIC_SIZE_MUL;
        this.duration = magic.duration || 3.0;
        this.interval = magic.interval || 0.4;
        this.pull = magic.pull || 0;
        this.pullRadius = magic.pullRadius ? magic.pullRadius * MAGIC_SIZE_MUL : this.radius * 4;
        this.age = 0;
        this.tickTimer = this.interval; // 出た瞬間にも1回当たる
        this.pendingTick = false;
        this.active = true;
        this.lastDt = 0;
    }
    
    update(deltaTime) {
        this.age += deltaTime;
        this.lastDt = deltaTime;
        // だんだん遅くなりながら少し進み、止まったらその場で回り続ける
        const p = Math.min(1, this.age / this.travelTime);
        const eased = 1 - (1 - p) * (1 - p);
        this.position = this.start.add(this.direction.mult(this.travel * eased));
        this.tickTimer += deltaTime;
        if (this.tickTimer >= this.interval) {
            this.tickTimer -= this.interval;
            this.pendingTick = true;
        }
        if (this.age >= this.duration) this.active = false;
    }
    
    draw(ctx, camera) {
        const s = this.position.sub(camera);
        const info = getElementInfo(this.magic.element);
        const grow = Math.min(1, this.age / 0.2), fade = Math.min(1, (this.duration - this.age) / 0.3);
        const a = Math.max(0, Math.min(grow, fade));
        const height = 64 * MAGIC_SIZE_MUL * grow;
        ctx.save();
        // 足元の影と巻き上がる風
        ctx.globalAlpha = 0.3 * a;
        ctx.fillStyle = '#1f4a3c';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, this.radius, this.radius * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        // 画像の竜巻：出る時は wind_edge の1→2コマ目（小さな渦が立ち上がる）、
        // その場で回る間は wind_loop、消える時は wind_edge の3→4コマ目（ほどけて散る）
        if (hasMagicFx('wind_loop')) {
            const edge = hasMagicFx('wind_edge');
            const sc = magicFxScale('wind_loop', this.radius * 2.3, 'w');
            const x = s.x + Math.sin(this.age * 5) * 2, y = s.y + this.radius * 0.2; // 根元は影の少し手前
            const left = this.duration - this.age;
            ctx.globalAlpha = 1;
            if (edge && this.age < 0.2) {
                drawMagicFx(ctx, 'wind_edge', this.age < 0.1 ? 0 : 1, x, y, sc);
            } else if (edge && left < 0.32) {
                drawMagicFx(ctx, 'wind_edge', left > 0.16 ? 2 : 3, x, y, sc, 0, left > 0.16 ? 1 : left / 0.16);
            } else {
                drawMagicFx(ctx, 'wind_loop', this.age / 0.07, x, y, sc, 0, edge ? 1 : a);
            }
            ctx.restore();
            return;
        }
        // 下から上へ広がっていく回転するだ円を重ねて竜巻に
        const rings = 7;
        for (let i = 0; i < rings; i++) {
            const t = i / (rings - 1);                       // 0=下 1=上
            const y = s.y - height * t;
            const rw = this.radius * (0.35 + t * 0.85);
            const wobble = Math.sin(this.age * 9 + i * 0.9) * 4 * MAGIC_SIZE_MUL * t;
            ctx.globalAlpha = (0.85 - t * 0.35) * a;
            ctx.strokeStyle = i % 2 ? info.color : info.light;
            ctx.lineWidth = (3 - t) * MAGIC_SIZE_MUL;
            ctx.beginPath();
            const start = this.age * 12 + i;                  // 回転して見えるよう欠けた円弧
            ctx.ellipse(s.x + wobble, y, rw, rw * 0.32, 0, start, start + Math.PI * 1.5);
            ctx.stroke();
        }
        // 巻き込まれている葉っぱ・粒
        ctx.fillStyle = info.light;
        for (let i = 0; i < 6; i++) {
            const ang = this.age * 10 + i * (Math.PI * 2 / 6);
            const t = ((this.age * 0.8 + i / 6) % 1);
            const rw = this.radius * (0.35 + t * 0.85);
            ctx.globalAlpha = 0.9 * a;
            const ps = 3 * MAGIC_SIZE_MUL;
            ctx.fillRect(s.x + Math.cos(ang) * rw - ps / 2, s.y - height * t + Math.sin(ang) * rw * 0.32 - ps / 2, ps, ps);
        }
        ctx.restore();
    }
}

// 雷：前方の敵の位置に直接雷を落とす
class LightningStrike {
    constructor(magic, targetPos) {
        this.magic = magic;
        this.position = targetPos.clone();
        this.radius = (magic.radius || 45) * MAGIC_SIZE_MUL;
        this.delay = 0.12;      // 落ちるまでの一瞬の溜め
        this.sprite = hasMagicFx('thunder_bolt');
        this.duration = this.sprite ? 0.45 : 0.35; // 光っている時間（画像の時は、地面の光の輪が消えるまで）
        this.flip = Math.random() < 0.5;          // 画像の稲妻を左右どちらに曲げるか（毎回ちがって見えるように）
        this.age = 0;
        this.detonated = false;
        this.pendingHit = false;
        this.active = true;
        // 稲妻のジグザグ（毎回ちがう形）
        this.bolt = [];
        for (let i = 0; i <= 7; i++) this.bolt.push((Math.random() - 0.5) * 22 * MAGIC_SIZE_MUL);
    }
    
    update(deltaTime) {
        this.age += deltaTime;
        if (!this.detonated && this.age >= this.delay) {
            this.detonated = true;
            this.pendingHit = true; // checkCollisions で一度だけダメージ判定
            if (window.playSE) playSE('magic_thunder');
        }
        if (this.age >= this.delay + this.duration) this.active = false;
    }
    
    draw(ctx, camera) {
        const s = this.position.sub(camera);
        const info = getElementInfo(this.magic.element);
        ctx.save();
        if (!this.detonated) {
            // 落ちる場所の予告
            ctx.globalAlpha = 0.6;
            drawMagicCircle(ctx, s.x, s.y, this.radius * 0.8, this.magic.element, this.age * 6, 0.7, 0.5);
        } else if (this.sprite) {
            // 画像：地面に光の輪が広がり（thunder_flash）、その上に稲妻（thunder_bolt）が落ちる
            const t = this.age - this.delay;
            if (hasMagicFx('thunder_flash')) {
                const k = magicFxOnce('thunder_flash', t, 0.08, 0.12);
                if (k) drawMagicFx(ctx, 'thunder_flash', k.frame, s.x, s.y, magicFxScale('thunder_flash', this.radius * 2.4, 'w'), 0, k.alpha);
            }
            const k = magicFxOnce('thunder_bolt', t, 0.065, 0.1);
            if (k) {
                ctx.translate(s.x, 0);
                if (this.flip) ctx.scale(-1, 1);
                drawMagicFx(ctx, 'thunder_bolt', k.frame, 0, s.y, magicFxScale('thunder_bolt', this.radius * 1.9, 'w'), 0, k.alpha);
            }
        } else {
            const t = (this.age - this.delay) / this.duration; // 0→1
            ctx.globalAlpha = 1 - t;
            // 稲妻
            ctx.strokeStyle = info.light;
            ctx.shadowColor = info.color;
            ctx.shadowBlur = 18;
            ctx.lineWidth = 5 * MAGIC_SIZE_MUL;
            ctx.beginPath();
            const top = s.y - 260 * Math.min(MAGIC_SIZE_MUL, 1.3);
            for (let i = 0; i < this.bolt.length; i++) {
                const y = top + (s.y - top) * (i / (this.bolt.length - 1));
                const x = s.x + this.bolt[i] * (i === this.bolt.length - 1 ? 0 : 1);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.lineWidth = 2 * MAGIC_SIZE_MUL;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
            // 着弾の光
            const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, this.radius * 1.4);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.4, info.color + 'aa');
            g.addColorStop(1, info.color + '00');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(s.x, s.y, this.radius * 1.4, this.radius * 0.8, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

class MagicCircleEffect {
    // shape：{ sx, sy }（魔法陣の傾き。手の前に出す時は向きで変わる）
    constructor(position, radius, duration, element, shape = { sx: 1, sy: 0.5 }) {
        this.position = position.clone();
        this.radius = radius;
        this.duration = duration;
        this.age = 0;
        this.active = true;
        this.element = element;
        this.rotation = 0;
        this.shape = shape;
    }
    
    update(deltaTime) {
        this.age += deltaTime;
        this.rotation += 3.0 * deltaTime;
        if (this.age >= this.duration) {
            this.active = false;
        }
    }
    
    draw(ctx, camera) {
        if (!this.active) return;
        const s = this.position.sub(camera);
        const progress = this.age / this.duration;
        // 発動の瞬間：魔法陣が広がりながら消える
        drawMagicCircle(ctx, s.x, s.y, this.radius * (1 + progress * 0.6), this.element, this.rotation, 1 - progress, this.shape.sy, this.shape.sx);
    }
}

// ヒール（治癒魔法）の光：足元に緑の魔法陣が広がり、体のまわりから光の粒が立ちのぼる（主人公についていく）
class HealEffect {
    constructor(target) {
        this.target = target;
        this.age = 0;
        this.life = HealEffect.LIFE;
        this.active = true;
        // 立ちのぼる光の粒（角度・横の広がり・出る時間・速さ・大きさ）
        this.sparks = [];
        for (let i = 0; i < 16; i++) {
            this.sparks.push({ x: (Math.random() - 0.5) * 2, delay: Math.random() * 0.55, speed: 70 + Math.random() * 60,
                size: 2 + Math.floor(Math.random() * 3), cross: Math.random() < 0.45 });
        }
    }
    
    update(dt) {
        this.age += dt;
        if (this.age >= this.life) this.active = false;
    }
    
    feet() {
        const t = this.target;
        return new Vector2(t.position.x, t.position.y + (t.drawSize || 90) * 0.36);
    }
    
    // 地面：魔法陣が広がって消える（キャラの下に描く）
    drawGround(ctx, cam) {
        const p = this.feet().sub(cam);
        const k = Math.min(1, this.age / 0.25);
        const fade = this.age < this.life - 0.35 ? 1 : Math.max(0, (this.life - this.age) / 0.35);
        const r = 34 + 26 * (1 - (1 - k) * (1 - k));
        ctx.save();
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.2);
        glow.addColorStop(0, 'rgba(120, 255, 170, 0.45)');
        glow.addColorStop(1, 'rgba(70, 217, 126, 0)');
        ctx.globalAlpha = fade;
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.2, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        drawMagicCircle(ctx, p.x, p.y, r, '癒', this.age * 1.8, 0.9 * fade, 0.5);
    }
    
    // 体の前：光の柱と、立ちのぼる光の粒
    draw(ctx, cam) {
        const t = this.target;
        const f = this.feet().sub(cam);
        const h = (t.drawSize || 90) * 1.15;
        const a = this.age, fade = a < this.life - 0.35 ? Math.min(1, a / 0.12) : Math.max(0, (this.life - a) / 0.35);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // 光の柱（足元から上へ、だんだん薄く）
        const col = ctx.createLinearGradient(0, f.y, 0, f.y - h);
        col.addColorStop(0, `rgba(110, 255, 160, ${0.38 * fade})`);
        col.addColorStop(1, 'rgba(110, 255, 160, 0)');
        ctx.fillStyle = col;
        ctx.fillRect(f.x - 26, f.y - h, 52, h);
        // 光の粒（ドット絵らしく四角で。十字の形の物もある）
        for (const s of this.sparks) {
            const age = a - s.delay;
            if (age <= 0) continue;
            const life = 0.75;
            if (age > life) continue;
            const x = Math.round(f.x + s.x * 30 + Math.sin(age * 9 + s.x * 5) * 3);
            const y = Math.round(f.y - 8 - age * s.speed);
            ctx.globalAlpha = (1 - age / life) * fade;
            ctx.fillStyle = age < 0.15 ? '#ffffff' : '#9dffbe';
            const z = s.size;
            ctx.fillRect(x - Math.floor(z / 2), y - Math.floor(z / 2), z, z);
            if (s.cross) {
                ctx.fillRect(x - z - 1, y - 1, z * 2 + 2, 2);
                ctx.fillRect(x - 1, y - z - 1, 2, z * 2 + 2);
            }
        }
        ctx.restore();
    }
}
HealEffect.LIFE = 1.1;

class MagicSystem {
    constructor() {
        this.projectiles = [];
        this.strikes = [];
        this.effects = [];
        this.firePatches = [];  // ファイヤーボールの残り火
        this.tornados = [];     // テンペストの竜巻
        this.heals = [];        // ヒールの光（HealEffect）
        this.map = null;        // 燃える地面かどうかを調べるのに使う
    }
    
    // ヒールの光を出す（target：回復した主人公。ついていく）
    addHeal(target) {
        this.heals.push(new HealEffect(target));
    }
    
    setMap(map) {
        this.map = map;
    }
    
    update(deltaTime) {
        for (const proj of this.projectiles) {
            proj.update(deltaTime);
            // 闘技場：壁・柱・木箱などに当たったら消える（低い柵や樽は飛び越える）
            if (proj.active && this.map && this.map.isShotBlocked && this.map.isShotBlocked(proj.position)) {
                proj.active = false;
                proj.ended = true;
            }
            if (proj.ended) this.onProjectileEnd(proj); // 最大距離まで飛んで消えた・壁に当たった
        }
        for (const s of this.strikes) s.update(deltaTime);
        for (const f of this.firePatches) f.update(deltaTime);
        for (const t of this.tornados) t.update(deltaTime);
        for (const effect of this.effects) effect.update(deltaTime);
        for (const h of this.heals) h.update(deltaTime);
        
        // 非アクティブを削除
        this.projectiles = this.projectiles.filter(p => p.active);
        this.strikes = this.strikes.filter(s => s.active);
        this.firePatches = this.firePatches.filter(f => f.active);
        this.tornados = this.tornados.filter(t => t.active);
        this.effects = this.effects.filter(e => e.active);
        this.heals = this.heals.filter(h => h.active);
    }
    
    // 弾が消えた時（敵に当たった・最大距離まで飛んだ）：ファイヤーボールなら、燃える地面に炎を残す
    onProjectileEnd(proj) {
        if (proj.endHandled) return;
        proj.endHandled = true;
        this.spawnImpact(proj);
        if (proj.magic.burn && isFlammableAt(this.map, proj.position)) {
            this.firePatches.push(new FirePatch(proj.magic, proj.position));
        }
    }
    
    // 弾が消えた所のエフェクト（画像がある時だけ）：炎は爆発、水はしぶき、岩は砕けて砂ぼこり
    spawnImpact(proj) {
        const r = proj.size, name = proj.fxName;
        if (name === 'fire_fly' && hasMagicFx('fire_hit')) {
            this.effects.push(new MagicSpriteFx('fire_hit', proj.position, magicFxScale('fire_hit', r * 4, 'w'), { frameTime: 0.06, fade: 0.1 }));
        } else if (name === 'water_fly' && hasMagicFx('water_hit')) {
            this.effects.push(new MagicSpriteFx('water_hit', proj.position, magicFxScale('water_hit', r * 4.2, 'w'), { frameTime: 0.07, fade: 0.12 }));
        } else if (name === 'stone_fly' && hasMagicFx('stone_hit')) {
            // 1コマ目は飛んでいた岩の弾と同じ形なので、同じ大きさ・向きで、先頭をそろえて出す
            const sc = proj.fxScale(), rot = Math.atan2(proj.direction.y, proj.direction.x);
            const tip = proj.position.add(proj.direction.mult(r * MagicProjectile.FX_LOOK.stone_fly.tip));
            const at = tip.sub(proj.direction.mult(STONE_HIT_TIP * sc));
            // 砂ぼこりは、飛び散る岩のかけらの後ろに（先に入れた物から描く）
            if (hasMagicFx('stone_dust')) {
                this.effects.push(new MagicSpriteFx('stone_dust', at, magicFxScale('stone_dust', r * 4, 'w'), { delay: 0.1, frameTime: 0.12, fade: 0.25 }));
            }
            this.effects.push(new MagicSpriteFx('stone_hit', at, sc, { frameTime: 0.07, fade: 0.1, rot }));
        }
    }
    
    // magic: 魔法データ / position: 発動位置 / direction: 向き（Vector2 or 'up' など）
    // circlePos: 足元の魔法陣の位置 / enemies: 雷の狙い用
    // targetPos：その場系（雷）を落とす場所（game.js の computeCastAim で決めた所）。なければ前方の敵を探す
    castMagic(magic, position, direction, circlePos = null, enemies = [], circleShape = undefined, circleRadius = 46, targetPos = null) {
        // 発動エフェクト（手のひらの前の魔法陣が広がって消える）
        this.effects.push(new MagicCircleEffect(circlePos || position, circleRadius * MAGIC_SIZE_MUL, 0.4, magic.element, circleShape));
        
        if (magic.category !== '攻撃') return;
        
        const dirVec = typeof direction === 'string' ? new MagicProjectile(magic, position, direction).direction : direction.normalize();
        if (magic.shape === 'strike') {
            this.strikes.push(new LightningStrike(magic, targetPos ? targetPos.clone() : this.findStrikeTarget(magic, position, dirVec, enemies)));
        } else if (magic.shape === 'tornado') {
            // 壁・柱の手前で止まる（game.js の computeCastAim の「届く所」の輪と同じ調べ方）
            let travel = magic.travel || 110;
            if (this.map && this.map.isShotBlocked) {
                for (let d = 16; d <= travel; d += 8) {
                    if (this.map.isShotBlocked(position.add(dirVec.mult(d)))) { travel = Math.max(0, d - 8); break; }
                }
            }
            this.tornados.push(new Tornado(magic, position, dirVec, travel));
        } else {
            this.projectiles.push(new MagicProjectile(magic, position, direction));
        }
    }
    
    // 雷を落とす場所：前方の範囲内でいちばん近い敵。いなければ前方の決まった距離
    findStrikeTarget(magic, origin, dir, enemies) {
        const range = magic.range || 380;
        let best = null, bestDist = Infinity;
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const to = e.position.sub(origin);
            const d = to.length();
            if (d === 0 || d > range) continue;
            const dot = (to.x * dir.x + to.y * dir.y) / d;
            if (dot < 0.5) continue; // 前方 約60度以内
            if (d < bestDist) { bestDist = d; best = e; }
        }
        return best ? best.position.clone() : origin.add(dir.mult(range * 0.6));
    }
    
    checkCollisions(enemies) {
        const hits = [];
        
        for (const proj of this.projectiles) {
            if (!proj.active) continue;
            for (const enemy of enemies) {
                if (!enemy.isAlive()) continue;
                if (proj.checkCollision(enemy)) {
                    hits.push({
                        projectile: proj,
                        enemy: enemy,
                        damage: proj.magic.power,
                        knockback: proj.knockback,
                        direction: proj.direction
                    });
                    proj.hit(enemy);
                    if (proj.ended) this.onProjectileEnd(proj); // 当たった場所に炎を残す
                    if (!proj.pierce) break;
                }
            }
        }
        
        // 残り火：燃えている間、一定間隔で上にいる敵に小さなダメージ
        for (const f of this.firePatches) {
            if (!f.pendingTick) continue;
            f.pendingTick = false;
            for (const enemy of enemies) {
                if (!enemy.isAlive()) continue;
                const dx = enemy.position.x - f.position.x, dy = (enemy.position.y - f.position.y) * 2; // 地面のだ円に合わせる
                if (Math.hypot(dx, dy) <= f.radius + enemy.size / 2) {
                    hits.push({ projectile: f, enemy, damage: f.damage, knockback: 0, direction: new Vector2(0, 0), burn: true, noStagger: true });
                }
            }
        }
        
        // 竜巻：まわりの敵を中心へ吸い寄せ、一定間隔で巻き込んだ敵にダメージ
        for (const t of this.tornados) {
            for (const enemy of enemies) {
                if (!enemy.isAlive()) continue;
                const to = t.position.sub(enemy.position);
                const d = to.length();
                if (t.pull > 0 && d > 4 && d < t.pullRadius) {
                    enemy.position = enemy.position.add(to.normalize().mult(Math.min(d, t.pull * t.lastDt)));
                }
            }
            if (!t.pendingTick) continue;
            t.pendingTick = false;
            for (const enemy of enemies) {
                if (!enemy.isAlive()) continue;
                if (enemy.position.distance(t.position) <= t.radius + enemy.size / 2) {
                    hits.push({ projectile: t, enemy, damage: t.magic.power, knockback: 0, direction: t.direction, noStagger: true });
                }
            }
        }
        
        // 雷：落ちた瞬間に範囲内の敵全員
        for (const s of this.strikes) {
            if (!s.pendingHit) continue;
            s.pendingHit = false;
            for (const enemy of enemies) {
                if (!enemy.isAlive()) continue;
                if (enemy.position.distance(s.position) <= s.radius + enemy.size / 2) {
                    hits.push({ projectile: s, enemy, damage: s.magic.power, knockback: 0, direction: new Vector2(0, 0) });
                }
            }
        }
        
        return hits;
    }
    
    // 地面に描くもの（残り火・ヒールの魔法陣）：敵やキャラより先に描く
    drawGround(ctx, camera) {
        for (const f of this.firePatches) f.draw(ctx, camera);
        for (const h of this.heals) h.drawGround(ctx, camera);
    }
    
    draw(ctx, camera) {
        for (const effect of this.effects) effect.draw(ctx, camera);
        for (const t of this.tornados) t.draw(ctx, camera);
        for (const s of this.strikes) s.draw(ctx, camera);
        for (const proj of this.projectiles) proj.draw(ctx, camera);
        for (const h of this.heals) h.draw(ctx, camera);
    }
    
    getElementColor(element) {
        return getElementInfo(element).color;
    }
    
    clear() {
        this.projectiles = [];
        this.strikes = [];
        this.effects = [];
        this.firePatches = [];
        this.tornados = [];
        this.heals = [];
    }
}

window.MAGIC_ELEMENTS = MAGIC_ELEMENTS;
window.MAGIC_SIZE_MUL = MAGIC_SIZE_MUL;
window.STARTER_MAGIC = STARTER_MAGIC;
window.getElementInfo = getElementInfo;
window.drawMagicCircle = drawMagicCircle;
window.MAGIC_FX = MAGIC_FX;
