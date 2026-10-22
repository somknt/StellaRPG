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

// 最初から使える5つの魔法（data/magic_circles.json と同じ内容。JSON を読めない時の予備にも使う）
// chantTime：詠唱にかかる秒数
const STARTER_MAGIC = [
    { id: 'magic_201', name: '火球陣', category: '攻撃', element: '炎', power: 30, spCost: 10, cooldown: 0.8, chantTime: 1.0, requiredStage: 0, starter: true, shape: 'projectile', speed: 320, size: 14 },
    { id: 'magic_202', name: '水流陣', category: '攻撃', element: '水', power: 20, spCost: 8, cooldown: 0.6, chantTime: 0.8, requiredStage: 0, starter: true, shape: 'projectile', speed: 380, size: 12, knockback: 70 },
    { id: 'magic_203', name: '疾風陣', category: '攻撃', element: '風', power: 16, spCost: 7, cooldown: 0.5, chantTime: 0.6, requiredStage: 0, starter: true, shape: 'projectile', speed: 540, size: 12, pierce: true },
    { id: 'magic_204', name: '岩槍陣', category: '攻撃', element: '土', power: 38, spCost: 12, cooldown: 1.0, chantTime: 1.3, requiredStage: 0, starter: true, shape: 'projectile', speed: 240, size: 20, knockback: 30 },
    { id: 'magic_205', name: '紫電陣', category: '攻撃', element: '雷', power: 28, spCost: 12, cooldown: 1.0, chantTime: 1.1, requiredStage: 0, starter: true, shape: 'strike', range: 380, radius: 45 }
];

function getElementInfo(element) {
    return MAGIC_ELEMENTS[element] || MAGIC_ELEMENTS['無'];
}

// 魔法陣を描く（画像 assets/effects/magic_circle_<属性>.png があれば画像、なければ六芒星を線で描く）
// squash: 縦のつぶし具合（地面に置くと 0.5 くらい）
function drawMagicCircle(ctx, x, y, radius, element, rotation = 0, alpha = 1, squash = 0.5) {
    const info = getElementInfo(element);
    const img = window.assetManager ? window.assetManager.get(`magic_circle_${info.key}`) : null;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(1, squash);
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
        this.lifetime = 2.0;
        this.age = 0;
        this.active = true;
        this.pierce = !!magic.pierce;       // 風：貫通
        this.knockback = magic.knockback || 0; // 水・土：押し出し
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
        
        // 寿命
        this.age += deltaTime;
        if (this.age >= this.lifetime) {
            this.active = false;
        }
    }
    
    checkCollision(target) {
        if (!this.active || this.hitEnemies.has(target)) return false;
        
        const distance = this.position.distance(target.position);
        return distance < this.size + target.size / 2;
    }
    
    hit(target) {
        this.hitEnemies.add(target);
        if (!this.pierce) this.active = false;
    }
    
    draw(ctx, camera) {
        if (!this.active) return;
        
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
    
    getElementColor() {
        return getElementInfo(this.magic.element).color;
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
    constructor(position, radius, duration, element) {
        this.position = position.clone();
        this.radius = radius;
        this.duration = duration;
        this.age = 0;
        this.active = true;
        this.element = element;
        this.rotation = 0;
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
        drawMagicCircle(ctx, s.x, s.y, this.radius * (1 + progress * 0.6), this.element, this.rotation, 1 - progress, 0.5);
    }
}

class MagicSystem {
    constructor() {
        this.projectiles = [];
        this.strikes = [];
        this.effects = [];
    }
    
    update(deltaTime) {
        for (const proj of this.projectiles) proj.update(deltaTime);
        for (const s of this.strikes) s.update(deltaTime);
        for (const effect of this.effects) effect.update(deltaTime);
        
        // 非アクティブを削除
        this.projectiles = this.projectiles.filter(p => p.active);
        this.strikes = this.strikes.filter(s => s.active);
        this.effects = this.effects.filter(e => e.active);
    }
    
    // magic: 魔法データ / position: 発動位置 / direction: 向き（Vector2 or 'up' など）
    // circlePos: 足元の魔法陣の位置 / enemies: 雷の狙い用
    castMagic(magic, position, direction, circlePos = null, enemies = []) {
        // 発動エフェクト（足元の魔法陣が広がって消える）
        this.effects.push(new MagicCircleEffect(circlePos || position, 46, 0.4, magic.element));
        
        if (magic.category !== '攻撃') return;
        
        if (magic.shape === 'strike') {
            const dir = typeof direction === 'string' ? new MagicProjectile(magic, position, direction).direction : direction.normalize();
            this.strikes.push(new LightningStrike(magic, this.findStrikeTarget(magic, position, dir, enemies)));
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
                    if (!proj.pierce) break;
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
    
    draw(ctx, camera) {
        for (const effect of this.effects) effect.draw(ctx, camera);
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
    }
}

window.MAGIC_ELEMENTS = MAGIC_ELEMENTS;
window.STARTER_MAGIC = STARTER_MAGIC;
window.getElementInfo = getElementInfo;
window.drawMagicCircle = drawMagicCircle;
