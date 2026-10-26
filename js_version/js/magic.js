// 魔法陣システム
//
// 流れ：魔法ボタン → 主人公が詠唱（足元に属性色の魔法陣、頭上にゲージ）→ ゲージ満タンで発動
// 詠唱中は歩くことしかできない（ダッシュ・回避・攻撃は不可）。詠唱の処理は player.js

// 属性ごとの色と画像の名前（魔法陣の形は全属性共通で、色だけ変える）
const MAGIC_ELEMENTS = {
    '炎': { key: 'fire',    color: '#ff4a3a', light: '#ffb199', label: '炎' },
    '水': { key: 'water',   color: '#3a8dff', light: '#a8d4ff', label: '水' },
    '風': { key: 'wind',    color: '#3fe0b8', light: '#b8fff0', label: '風' }, // 緑と水色の間
    '土': { key: 'earth',   color: '#a8743f', light: '#e6c79a', label: '土' },
    '雷': { key: 'thunder', color: '#a35cff', light: '#dcc2ff', label: '雷' },
    '光': { key: 'light',   color: '#fff07a', light: '#fffbe0', label: '光' },
    '氷': { key: 'ice',     color: '#66ccff', light: '#d8f3ff', label: '氷' },
    '無': { key: 'none',    color: '#ffb347', light: '#ffe2b8', label: '無' }
};

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
    // 風：小さな竜巻。少し前に進んでその場にとどまり、まわりの敵を吸い寄せて何度もダメージ
    { id: 'magic_203', name: 'テンペスト', category: '攻撃', element: '風', power: 6, spCost: 9, cooldown: 1.0, chantTime: 0.8, requiredStage: 0, starter: true,
      shape: 'tornado', travel: 110, travelTime: 0.45, radius: 30, duration: 3.0, interval: 0.4, pull: 90, pullRadius: 120,
      description: '小さな竜巻を生み出す。少し前に進んでその場にとどまり、まわりの敵を吸い寄せながら何度もダメージを与える。' },
    // 土：岩の弾。遅いが重くて威力が高い
    { id: 'magic_204', name: 'ストーンキャノン', category: '攻撃', element: '土', power: 38, spCost: 12, cooldown: 1.0, chantTime: 1.3, requiredStage: 0, starter: true,
      shape: 'projectile', speed: 270, size: 17, range: 380, knockback: 40, rock: true,
      description: '岩の弾を撃ち出す。詠唱は長いが威力が高く、敵を押し返す。' },
    // 雷：前方の敵に直接雷を落とす
    { id: 'magic_205', name: 'ライトニング', category: '攻撃', element: '雷', power: 28, spCost: 12, cooldown: 1.0, chantTime: 1.1, requiredStage: 0, starter: true,
      shape: 'strike', range: 380, radius: 45,
      description: '前方の敵に直接雷を落とす。' }
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
        ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
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
        this.size = magic.size || 16;
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
    
    draw(ctx, camera) {
        if (!this.active) return;
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
        this.radius = b.radius || 36;
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
            this.flames.push({ x: Math.cos(a) * d, y: Math.sin(a) * d * 0.5, phase: Math.random() * Math.PI * 2, size: 6 + Math.random() * 6 });
        }
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
    constructor(magic, position, direction) {
        this.magic = magic;
        this.position = position.clone();
        this.direction = direction.normalize();
        this.start = position.clone();
        this.travel = magic.travel || 110;          // 進む距離
        this.travelTime = magic.travelTime || 0.45; // 進むのにかかる時間（そのあとはその場にとどまる）
        this.radius = magic.radius || 30;
        this.duration = magic.duration || 3.0;
        this.interval = magic.interval || 0.4;
        this.pull = magic.pull || 0;
        this.pullRadius = magic.pullRadius || this.radius * 4;
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
        const height = 64 * grow;
        ctx.save();
        // 足元の影と巻き上がる風
        ctx.globalAlpha = 0.3 * a;
        ctx.fillStyle = '#1f4a3c';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, this.radius, this.radius * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        // 下から上へ広がっていく回転するだ円を重ねて竜巻に
        const rings = 7;
        for (let i = 0; i < rings; i++) {
            const t = i / (rings - 1);                       // 0=下 1=上
            const y = s.y - height * t;
            const rw = this.radius * (0.35 + t * 0.85);
            const wobble = Math.sin(this.age * 9 + i * 0.9) * 4 * t;
            ctx.globalAlpha = (0.85 - t * 0.35) * a;
            ctx.strokeStyle = i % 2 ? info.color : info.light;
            ctx.lineWidth = 3 - t;
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
            ctx.fillRect(s.x + Math.cos(ang) * rw - 1.5, s.y - height * t + Math.sin(ang) * rw * 0.32 - 1.5, 3, 3);
        }
        ctx.restore();
    }
}

// 雷：前方の敵の位置に直接雷を落とす
class LightningStrike {
    constructor(magic, targetPos) {
        this.magic = magic;
        this.position = targetPos.clone();
        this.radius = magic.radius || 45;
        this.delay = 0.12;      // 落ちるまでの一瞬の溜め
        this.duration = 0.35;   // 光っている時間
        this.age = 0;
        this.detonated = false;
        this.pendingHit = false;
        this.active = true;
        // 稲妻のジグザグ（毎回ちがう形）
        this.bolt = [];
        for (let i = 0; i <= 7; i++) this.bolt.push((Math.random() - 0.5) * 22);
    }
    
    update(deltaTime) {
        this.age += deltaTime;
        if (!this.detonated && this.age >= this.delay) {
            this.detonated = true;
            this.pendingHit = true; // checkCollisions で一度だけダメージ判定
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
        } else {
            const t = (this.age - this.delay) / this.duration; // 0→1
            ctx.globalAlpha = 1 - t;
            // 稲妻
            ctx.strokeStyle = info.light;
            ctx.shadowColor = info.color;
            ctx.shadowBlur = 18;
            ctx.lineWidth = 5;
            ctx.beginPath();
            const top = s.y - 260;
            for (let i = 0; i < this.bolt.length; i++) {
                const y = top + (s.y - top) * (i / (this.bolt.length - 1));
                const x = s.x + this.bolt[i] * (i === this.bolt.length - 1 ? 0 : 1);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.lineWidth = 2;
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

class MagicSystem {
    constructor() {
        this.projectiles = [];
        this.strikes = [];
        this.effects = [];
        this.firePatches = [];  // ファイヤーボールの残り火
        this.tornados = [];     // テンペストの竜巻
        this.map = null;        // 燃える地面かどうかを調べるのに使う
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
        
        // 非アクティブを削除
        this.projectiles = this.projectiles.filter(p => p.active);
        this.strikes = this.strikes.filter(s => s.active);
        this.firePatches = this.firePatches.filter(f => f.active);
        this.tornados = this.tornados.filter(t => t.active);
        this.effects = this.effects.filter(e => e.active);
    }
    
    // 弾が消えた時（敵に当たった・最大距離まで飛んだ）：ファイヤーボールなら、燃える地面に炎を残す
    onProjectileEnd(proj) {
        if (proj.endHandled) return;
        proj.endHandled = true;
        if (proj.magic.burn && isFlammableAt(this.map, proj.position)) {
            this.firePatches.push(new FirePatch(proj.magic, proj.position));
        }
    }
    
    // magic: 魔法データ / position: 発動位置 / direction: 向き（Vector2 or 'up' など）
    // circlePos: 足元の魔法陣の位置 / enemies: 雷の狙い用
    castMagic(magic, position, direction, circlePos = null, enemies = [], circleShape = undefined, circleRadius = 46) {
        // 発動エフェクト（手のひらの前の魔法陣が広がって消える）
        this.effects.push(new MagicCircleEffect(circlePos || position, circleRadius, 0.4, magic.element, circleShape));
        
        if (magic.category !== '攻撃') return;
        
        const dirVec = typeof direction === 'string' ? new MagicProjectile(magic, position, direction).direction : direction.normalize();
        if (magic.shape === 'strike') {
            this.strikes.push(new LightningStrike(magic, this.findStrikeTarget(magic, position, dirVec, enemies)));
        } else if (magic.shape === 'tornado') {
            this.tornados.push(new Tornado(magic, position, dirVec));
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
    
    // 地面に描くもの（残り火）：敵やキャラより先に描く
    drawGround(ctx, camera) {
        for (const f of this.firePatches) f.draw(ctx, camera);
    }
    
    draw(ctx, camera) {
        for (const effect of this.effects) effect.draw(ctx, camera);
        for (const t of this.tornados) t.draw(ctx, camera);
        for (const s of this.strikes) s.draw(ctx, camera);
        for (const proj of this.projectiles) proj.draw(ctx, camera);
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
    }
}

window.MAGIC_ELEMENTS = MAGIC_ELEMENTS;
window.STARTER_MAGIC = STARTER_MAGIC;
window.getElementInfo = getElementInfo;
window.drawMagicCircle = drawMagicCircle;
