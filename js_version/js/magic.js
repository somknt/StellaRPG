// 魔法陣システム

class MagicProjectile {
    constructor(magic, position, direction) {
        this.magic = magic;
        this.position = position.clone();
        this.direction = direction;
        this.velocity = this.getVelocityFromDirection(direction);
        this.speed = 300;
        this.size = 16;
        this.lifetime = 3.0;
        this.age = 0;
        this.active = true;
        
        // エフェクト
        this.trailPositions = [];
        this.maxTrailLength = 10;
    }
    
    getVelocityFromDirection(dir) {
        switch (dir) {
            case 'up': return new Vector2(0, -this.speed);
            case 'down': return new Vector2(0, this.speed);
            case 'left': return new Vector2(-this.speed, 0);
            case 'right': return new Vector2(this.speed, 0);
            default: return new Vector2(0, -this.speed);
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
        if (!this.active) return false;
        
        const distance = this.position.distance(target.position);
        return distance < this.size + target.size / 2;
    }
    
    hit() {
        this.active = false;
    }
    
    draw(ctx, camera) {
        if (!this.active) return;
        
        const screenPos = this.position.sub(camera);
        
        ctx.save();
        
        // 軌跡
        ctx.globalAlpha = 0.3;
        for (let i = 0; i < this.trailPositions.length; i++) {
            const trailPos = this.trailPositions[i].sub(camera);
            const alpha = (i / this.trailPositions.length) * 0.3;
            ctx.globalAlpha = alpha;
            
            ctx.fillStyle = this.getElementColor();
            ctx.beginPath();
            ctx.arc(trailPos.x, trailPos.y, this.size * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // 本体
        ctx.globalAlpha = 1.0;
        
        // 外側の輝き
        const gradient = ctx.createRadialGradient(
            screenPos.x, screenPos.y, 0,
            screenPos.x, screenPos.y, this.size * 1.5
        );
        gradient.addColorStop(0, this.getElementColor());
        gradient.addColorStop(0.5, this.getElementColor() + '80');
        gradient.addColorStop(1, this.getElementColor() + '00');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, this.size * 1.5, 0, Math.PI * 2);
        ctx.fill();
        
        // コア
        ctx.fillStyle = this.getElementColor();
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        
        // 魔法陣模様（簡易版）
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI * 2 / 6) * i + this.age * 2;
            const x = screenPos.x + Math.cos(angle) * this.size * 0.6;
            const y = screenPos.y + Math.sin(angle) * this.size * 0.6;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        
        ctx.restore();
    }
    
    getElementColor() {
        switch (this.magic.element) {
            case '光': return '#ffff99';
            case '風': return '#99ff99';
            case '炎': return '#ff6666';
            case '氷': return '#66ccff';
            case '雷': return '#ffff00';
            default: return '#ffffff';
        }
    }
}

class MagicCircleEffect {
    constructor(position, radius, duration, color) {
        this.position = position.clone();
        this.radius = radius;
        this.duration = duration;
        this.age = 0;
        this.active = true;
        this.color = color || '#ffb347';
        this.rotationSpeed = 2.0;
        this.rotation = 0;
    }
    
    update(deltaTime) {
        this.age += deltaTime;
        this.rotation += this.rotationSpeed * deltaTime;
        
        if (this.age >= this.duration) {
            this.active = false;
        }
    }
    
    draw(ctx, camera) {
        if (!this.active) return;
        
        const screenPos = this.position.sub(camera);
        const progress = this.age / this.duration;
        const alpha = 1.0 - progress;
        const currentRadius = this.radius * (0.5 + progress * 0.5);
        
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(screenPos.x, screenPos.y);
        ctx.rotate(this.rotation);
        
        // 外側の円
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, currentRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // 内側の円
        ctx.beginPath();
        ctx.arc(0, 0, currentRadius * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        
        // 六芒星
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI * 2 / 6) * i;
            const x = Math.cos(angle) * currentRadius * 0.8;
            const y = Math.sin(angle) * currentRadius * 0.8;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        
        ctx.restore();
    }
}

class MagicSystem {
    constructor() {
        this.projectiles = [];
        this.effects = [];
    }
    
    update(deltaTime) {
        // 弾更新
        for (const proj of this.projectiles) {
            proj.update(deltaTime);
        }
        
        // エフェクト更新
        for (const effect of this.effects) {
            effect.update(deltaTime);
        }
        
        // 非アクティブを削除
        this.projectiles = this.projectiles.filter(p => p.active);
        this.effects = this.effects.filter(e => e.active);
    }
    
    castMagic(magic, position, direction) {
        // 発動エフェクト
        this.effects.push(new MagicCircleEffect(position, 50, 0.5, this.getElementColor(magic.element)));
        
        // 攻撃魔法なら弾を生成
        if (magic.category === '攻撃') {
            const projectile = new MagicProjectile(magic, position, direction);
            this.projectiles.push(projectile);
        }
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
                        damage: proj.magic.power
                    });
                    proj.hit();
                    break;
                }
            }
        }
        
        return hits;
    }
    
    draw(ctx, camera) {
        // エフェクト描画
        for (const effect of this.effects) {
            effect.draw(ctx, camera);
        }
        
        // 弾描画
        for (const proj of this.projectiles) {
            proj.draw(ctx, camera);
        }
    }
    
    getElementColor(element) {
        switch (element) {
            case '光': return '#ffff99';
            case '風': return '#99ff99';
            case '炎': return '#ff6666';
            case '氷': return '#66ccff';
            case '雷': return '#ffff00';
            default: return '#ffffff';
        }
    }
    
    clear() {
        this.projectiles = [];
        this.effects = [];
    }
}
