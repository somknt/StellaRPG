// 敵システム

class Enemy {
    constructor(enemyData, position) {
        this.data = enemyData;
        this.position = position.clone();
        this.velocity = new Vector2(0, 0);
        this.size = 32;
        
        // ステータス
        this.maxHP = enemyData.hp;
        this.currentHP = enemyData.hp;
        this.attack = enemyData.attack;
        this.defense = enemyData.defense;
        this.speed = enemyData.speed;
        this.detectionRange = enemyData.detectionRange || 200;
        this.attackRange = enemyData.attackRange || 40;
        
        // AI状態
        this.state = 'idle'; // idle, chase, attack, retreat
        this.target = null;
        this.idleTimer = 0;
        this.idleMaxTime = 2.0;
        this.wanderDirection = new Vector2(0, 0);
        
        // 攻撃
        this.attackCooldown = enemyData.attackCooldown || 1.5;
        this.attackTimer = 0;
        
        // アニメーション
        this.animationFrame = 0;
        this.animationTimer = 0;
        this.animationSpeed = 0.2;
        this.direction = 'down'; // down, up, left, right
        this.isJumping = false;
        
        // ドロップ
        this.dropExp = enemyData.dropExp;
        this.dropItems = enemyData.dropItems || [];
    }
    
    update(deltaTime, player) {
        if (!this.isAlive()) return;
        
        this.target = player;
        
        // AI更新
        this.updateAI(deltaTime);
        
        // 向きを更新
        this.updateDirection();
        
        // 移動
        this.position = this.position.add(this.velocity.mult(deltaTime));
        
        // 攻撃タイマー
        if (this.attackTimer > 0) {
            this.attackTimer -= deltaTime;
        }
        
        // アニメーション
        if (this.velocity.length() > 0) {
            this.animationTimer += deltaTime;
            if (this.animationTimer >= this.animationSpeed) {
                this.animationTimer = 0;
                this.animationFrame = (this.animationFrame + 1) % 3; // 3コマアニメーション
            }
        } else {
            this.animationFrame = 0; // 停止時は最初のフレーム
        }
        
        // ジャンプ判定（攻撃時）
        this.isJumping = (this.state === 'attack' && this.attackTimer > this.attackCooldown * 0.7);
    }
    
    updateDirection() {
        if (this.velocity.length() < 0.1) return;
        
        const angle = Math.atan2(this.velocity.y, this.velocity.x);
        const degree = angle * 180 / Math.PI;
        
        // 角度から向きを決定
        if (degree >= -45 && degree < 45) {
            this.direction = 'right';
        } else if (degree >= 45 && degree < 135) {
            this.direction = 'down';
        } else if (degree >= -135 && degree < -45) {
            this.direction = 'up';
        } else {
            this.direction = 'left';
        }
    }
    
    updateAI(deltaTime) {
        const distanceToPlayer = this.position.distance(this.target.position);
        
        // 状態遷移
        if (distanceToPlayer <= this.detectionRange) {
            if (distanceToPlayer <= this.attackRange) {
                this.state = 'attack';
            } else {
                this.state = 'chase';
            }
        } else {
            this.state = 'idle';
        }
        
        // 状態別行動
        switch (this.state) {
            case 'idle':
                this.behaviorIdle(deltaTime);
                break;
            case 'chase':
                this.behaviorChase(deltaTime);
                break;
            case 'attack':
                this.behaviorAttack(deltaTime);
                break;
        }
    }
    
    behaviorIdle(deltaTime) {
        this.idleTimer += deltaTime;
        
        if (this.idleTimer >= this.idleMaxTime) {
            this.idleTimer = 0;
            // ランダムな方向に移動
            const angle = Math.random() * Math.PI * 2;
            this.wanderDirection = new Vector2(Math.cos(angle), Math.sin(angle));
        }
        
        this.velocity = this.wanderDirection.mult(this.speed * 0.3);
    }
    
    behaviorChase(deltaTime) {
        const direction = this.target.position.sub(this.position).normalize();
        this.velocity = direction.mult(this.speed);
    }
    
    behaviorAttack(deltaTime) {
        // プレイヤーに向かって少し移動
        const direction = this.target.position.sub(this.position).normalize();
        this.velocity = direction.mult(this.speed * 0.5);
        
        // 攻撃実行
        if (this.attackTimer <= 0) {
            this.performAttack();
        }
    }
    
    performAttack() {
        this.attackTimer = this.attackCooldown;
        return {
            damage: this.attack,
            position: this.position.clone()
        };
    }
    
    takeDamage(damage) {
        const actualDamage = Math.max(1, damage - this.defense);
        this.currentHP = Math.max(0, this.currentHP - actualDamage);
        
        // ダメージエフェクト
        return {
            damage: actualDamage,
            position: this.position.clone()
        };
    }
    
    isAlive() {
        return this.currentHP > 0;
    }
    
    getDrops() {
        return {
            exp: this.dropExp,
            items: this.dropItems
        };
    }
    
    draw(ctx, camera) {
        if (!this.isAlive()) return;
        
        const screenPos = this.position.sub(camera);
        
        ctx.save();
        
        // 敵の画像を取得
        const enemyImage = this.getEnemyImage();
        
        if (enemyImage) {
            // 画像がある場合は画像を描画
            const imageSize = this.size * 1.5; // 画像は少し大きめに
            ctx.drawImage(
                enemyImage,
                Math.floor(screenPos.x - imageSize/2),
                Math.floor(screenPos.y - imageSize/2),
                imageSize,
                imageSize
            );
        } else {
            // 画像がない場合は仮の描画（フォールバック）
            ctx.fillStyle = this.getEnemyColor();
            
            if (this.data.name === '角ウサギ') {
                // ウサギ
                ctx.fillRect(screenPos.x - this.size/2, screenPos.y - this.size/2, this.size, this.size * 0.7);
                // 耳
                ctx.fillRect(screenPos.x - this.size/3, screenPos.y - this.size, this.size/6, this.size/2);
                ctx.fillRect(screenPos.x + this.size/6, screenPos.y - this.size, this.size/6, this.size/2);
            } else if (this.data.name === '草原狼') {
                // 狼
                ctx.fillRect(screenPos.x - this.size/2, screenPos.y - this.size/2, this.size, this.size * 0.6);
            } else {
                // デフォルト
                ctx.fillRect(screenPos.x - this.size/2, screenPos.y - this.size/2, this.size, this.size);
            }
        }
        
        // HPバー
        const barWidth = this.size;
        const barHeight = 4;
        const hpPercent = this.currentHP / this.maxHP;
        
        ctx.fillStyle = '#333';
        ctx.fillRect(screenPos.x - barWidth/2, screenPos.y - this.size/2 - 10, barWidth, barHeight);
        
        ctx.fillStyle = hpPercent > 0.5 ? '#00ff00' : hpPercent > 0.25 ? '#ffff00' : '#ff0000';
        ctx.fillRect(screenPos.x - barWidth/2, screenPos.y - this.size/2 - 10, barWidth * hpPercent, barHeight);
        
        ctx.restore();
    }
    
    getEnemyImage() {
        if (!window.assetManager) return null;
        
        // 敵の種類に応じた画像キーを取得
        if (this.data.name === '角ウサギ') {
            // ジャンプ中はジャンプ画像
            if (this.isJumping) {
                return window.assetManager.get(`horn_rabbit_${this.direction}_jump`);
            }
            // 移動アニメーション（1〜3フレーム）
            const frame = this.animationFrame + 1;
            return window.assetManager.get(`horn_rabbit_${this.direction}_${frame}`);
        } else if (this.data.name === '星光スライム') {
            return window.assetManager.get('starlight_slime');
        } else if (this.data.name === '草原狼') {
            return window.assetManager.get('wolf_1');
        }
        
        return null;
    }
    
    getEnemyColor() {
        switch (this.data.name) {
            case '角ウサギ': return '#d2691e';
            case '草原狼': return '#8b8b8b';
            case '森林クマ': return '#654321';
            case '毒蛇': return '#9acd32';
            default: return '#666666';
        }
    }
}

class EnemySpawner {
    constructor() {
        this.enemies = [];
        this.spawnTimer = 0;
        this.spawnInterval = 5.0;
        this.maxEnemies = 10;
        this.spawnRadius = 400;
    }
    
    update(deltaTime, player, enemyDataList) {
        this.spawnTimer += deltaTime;
        
        if (this.spawnTimer >= this.spawnInterval && this.enemies.length < this.maxEnemies) {
            this.spawnEnemy(player.position, enemyDataList);
            this.spawnTimer = 0;
        }
        
        // 敵更新
        for (const enemy of this.enemies) {
            enemy.update(deltaTime, player);
        }
        
        // 死んだ敵を削除
        this.enemies = this.enemies.filter(e => e.isAlive());
    }
    
    spawnEnemy(playerPos, enemyDataList) {
        // ランダムな位置に出現
        const angle = Math.random() * Math.PI * 2;
        const distance = this.spawnRadius + Math.random() * 100;
        const spawnPos = new Vector2(
            playerPos.x + Math.cos(angle) * distance,
            playerPos.y + Math.sin(angle) * distance
        );
        
        // ランダムな敵を選択
        const enemyData = enemyDataList[Math.floor(Math.random() * enemyDataList.length)];
        const enemy = new Enemy(enemyData, spawnPos);
        this.enemies.push(enemy);
    }
    
    draw(ctx, camera) {
        for (const enemy of this.enemies) {
            enemy.draw(ctx, camera);
        }
    }
    
    checkPlayerAttack(attackData) {
        const hits = [];
        
        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            
            const distance = enemy.position.distance(attackData.position);
            if (distance <= attackData.range) {
                const result = enemy.takeDamage(attackData.damage);
                hits.push({
                    enemy: enemy,
                    ...result
                });
            }
        }
        
        return hits;
    }
    
    checkEnemyAttacks(player) {
        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            
            if (enemy.state === 'attack' && enemy.attackTimer <= 0) {
                const attackData = enemy.performAttack();
                player.takeDamage(attackData.damage);
            }
        }
    }
    
    getDeadEnemies() {
        return this.enemies.filter(e => !e.isAlive());
    }
    
    clear() {
        this.enemies = [];
    }
}
