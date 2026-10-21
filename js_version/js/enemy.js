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
        this.speed = enemyData.speed || 80;
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
        this.hitFlashTimer = 0;
        
        // アニメーション
        this.animationFrame = 0;
        this.animationTimer = 0;
        this.animationSpeed = 0.2;
        this.direction = 'down'; // down, up, left, right
        this.isJumping = false;
        
        // ジャンプ突進（角ウサギ専用）
        this.isCharging = false;
        this.chargeDirection = new Vector2(0, 0);
        this.chargeDuration = 0;
        this.chargeMaxDuration = 0.5; // 0.5秒間突進
        this.chargeSpeed = 300; // 突進速度
        this.chargePreparationTime = 0.3; // 突進準備時間
        this.chargeTimer = 0;
        
        // 星光スライム専用：ぴょんぴょん跳ねて移動、攻撃されたら距離をとって光弾を撃つ
        this.isSlime = enemyData.name === '星光スライム';
        if (this.isSlime) {
            this.size = 36;
            this.isHopping = false;
            this.hopTime = 0;
            this.hopDuration = 0.35;     // 1回の跳ねの長さ
            this.hopSpeed = 110;         // 跳ねている間の速さ
            this.hopDirection = new Vector2(0, 0);
            this.restTimer = Math.random() * 1.0; // 着地して休む時間
            this.restDuration = 0.9;
            this.provoked = false;       // 攻撃されたら true（それまでは襲ってこない）
            this.shootRange = 340;       // 光弾を撃つ距離
            this.shootCooldown = 2.2;
            this.shootTimer = 1.0;
            this.shootWindupTime = 0.45; // 撃つ前に光を溜める時間（避けるための予告）
            this.shootWindup = 0;
            this.pendingShot = null;     // EnemySpawner が拾って光弾を生成する
        }
        
        // ドロップ
        this.dropExp = enemyData.dropExp ?? enemyData.exp ?? 1;
        this.dropItems = enemyData.dropItems || [];
    }
    
    update(deltaTime, player) {
        if (!this.isAlive()) return;
        
        this.target = player;
        
        // 角ウサギのジャンプ突進処理
        if (this.data.name === '角ウサギ') {
            this.updateHornRabbitBehavior(deltaTime);
        } else if (this.isSlime) {
            this.updateSlimeBehavior(deltaTime);
        } else {
            // その他の敵は通常のAI
            this.updateAI(deltaTime);
        }
        
        // 向きを更新
        this.updateDirection();
        
        // 移動
        this.position = this.position.add(this.velocity.mult(deltaTime));
        
        // 攻撃タイマー
        if (this.attackTimer > 0) {
            this.attackTimer -= deltaTime;
        }
        if (this.hitFlashTimer > 0) {
            this.hitFlashTimer -= deltaTime;
        }
        
        // アニメーション（スライムは止まっていてもぷるぷる動かす）
        if (this.velocity.length() > 0 || this.isSlime) {
            this.animationTimer += deltaTime;
            if (this.animationTimer >= this.animationSpeed) {
                this.animationTimer = 0;
                this.animationFrame = (this.animationFrame + 1) % 3; // 3コマアニメーション
            }
        } else {
            this.animationFrame = 0; // 停止時は最初のフレーム
        }
        
        // ジャンプ判定
        this.isJumping = this.isSlime ? this.isHopping : this.isCharging;
    }
    
    // 星光スライム専用の行動AI
    updateSlimeBehavior(deltaTime) {
        const toPlayer = this.target.position.sub(this.position);
        const dist = toPlayer.length();
        
        // 跳ねている最中
        if (this.isHopping) {
            this.hopTime += deltaTime;
            this.velocity = this.hopDirection.mult(this.hopSpeed);
            if (this.hopTime >= this.hopDuration) {
                this.isHopping = false;
                this.velocity = new Vector2(0, 0);
                this.restTimer = this.restDuration * (0.7 + Math.random() * 0.6);
            }
            return;
        }
        
        // 着地中は止まる
        this.velocity = new Vector2(0, 0);
        this.restTimer -= deltaTime;
        this.state = this.provoked ? 'provoked' : 'idle';
        
        // 攻撃されて怒っている時だけ光弾を撃つ
        if (this.provoked) {
            this.shootTimer -= deltaTime;
            
            // 光を溜めている最中：プレイヤーの方を向いて、溜め終わったら発射
            if (this.shootWindup > 0) {
                this.faceTowards(toPlayer);
                this.shootWindup -= deltaTime;
                if (this.shootWindup <= 0) {
                    this.pendingShot = toPlayer.normalize();
                    this.shootTimer = this.shootCooldown;
                    this.restTimer = Math.max(this.restTimer, 0.3);
                }
                return;
            }
            if (this.shootTimer <= 0 && dist <= this.shootRange) {
                this.shootWindup = this.shootWindupTime;
                return;
            }
        }
        
        // 次の跳ね
        if (this.restTimer <= 0) {
            let dir;
            if (this.provoked) {
                if (dist < 150) {
                    dir = toPlayer.normalize().mult(-1);              // 近すぎる → 離れる
                } else if (dist > 280) {
                    dir = toPlayer.normalize();                       // 遠すぎる → 近づく
                } else {
                    const side = Math.random() < 0.5 ? 1 : -1;        // ちょうどいい → 横に回り込む
                    dir = new Vector2(-toPlayer.y * side, toPlayer.x * side).normalize();
                }
            } else {
                // のんびり散歩（たまにその場で跳ねるだけ）
                const angle = Math.random() * Math.PI * 2;
                dir = Math.random() < 0.25 ? new Vector2(0, 0) : new Vector2(Math.cos(angle), Math.sin(angle));
            }
            this.hopDirection = dir;
            this.isHopping = true;
            this.hopTime = 0;
        }
    }
    
    faceTowards(v) {
        if (Math.abs(v.x) > Math.abs(v.y)) this.direction = v.x < 0 ? 'left' : 'right';
        else this.direction = v.y < 0 ? 'up' : 'down';
    }
    
    // 角ウサギ専用の行動AI
    updateHornRabbitBehavior(deltaTime) {
        const distanceToPlayer = this.position.distance(this.target.position);
        
        // 突進中の処理
        if (this.isCharging) {
            this.chargeDuration += deltaTime;
            
            if (this.chargeDuration >= this.chargeMaxDuration) {
                // 突進終了
                this.isCharging = false;
                this.chargeDuration = 0;
                this.velocity = new Vector2(0, 0);
                this.attackTimer = this.attackCooldown;
            } else {
                // 一直線に突進
                this.velocity = this.chargeDirection.mult(this.chargeSpeed);
            }
            return;
        }
        
        // 突進準備中の処理
        if (this.chargeTimer > 0) {
            this.chargeTimer -= deltaTime;
            this.velocity = new Vector2(0, 0); // 準備中は静止
            
            if (this.chargeTimer <= 0) {
                // 突進開始！
                this.isCharging = true;
                this.chargeDuration = 0;
            }
            return;
        }
        
        // 通常の行動判定
        if (distanceToPlayer <= this.detectionRange) {
            if (distanceToPlayer <= this.attackRange * 3 && this.attackTimer <= 0) {
                // 攻撃範囲内 → ジャンプ突進準備
                this.state = 'attack';
                this.chargeTimer = this.chargePreparationTime;
                // プレイヤーへの方向を記録
                this.chargeDirection = this.target.position.sub(this.position).normalize();
            } else if (distanceToPlayer > this.attackRange * 3) {
                // 中距離 → 追跡
                this.state = 'chase';
                const direction = this.target.position.sub(this.position).normalize();
                this.velocity = direction.mult(this.speed * 0.8); // 少しゆっくり近づく
            } else {
                // 攻撃クールダウン中 → 少し後退
                this.state = 'retreat';
                const direction = this.target.position.sub(this.position).normalize();
                this.velocity = direction.mult(-this.speed * 0.5);
            }
        } else {
            // 遠距離 → 待機
            this.state = 'idle';
            this.behaviorIdle(deltaTime);
        }
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
        
        // 角ウサギの場合、突進中にダメージを与える
        if (this.data.name === '角ウサギ' && this.isCharging) {
            return {
                damage: this.attack,
                position: this.position.clone(),
                isChargeAttack: true
            };
        }
        
        return {
            damage: this.attack,
            position: this.position.clone()
        };
    }
    
    // 攻撃を受けて後ろに押し出される
    applyKnockback(direction, distance) {
        this.position = this.position.add(direction.normalize().mult(distance));
        // 突進中なら止める
        if (this.isCharging) {
            this.isCharging = false;
            this.chargeDuration = 0;
            this.attackTimer = this.attackCooldown;
        }
        this.chargeTimer = 0;
    }
    
    takeDamage(damage) {
        const actualDamage = Math.max(1, damage - this.defense);
        this.currentHP = Math.max(0, this.currentHP - actualDamage);
        this.hitFlashTimer = 0.12;
        if (this.isSlime) this.provoked = true; // 攻撃されたら怒る
        
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
        
        // スライムが光弾を溜めている間：体の上に光が集まる（発射の予告）
        if (this.isSlime && this.shootWindup > 0) {
            const t = 1 - this.shootWindup / this.shootWindupTime; // 0→1
            const r = 4 + t * 8;
            ctx.save();
            ctx.globalAlpha = 0.5 + 0.5 * t;
            const g = ctx.createRadialGradient(screenPos.x, screenPos.y - this.size * 0.9, 0, screenPos.x, screenPos.y - this.size * 0.9, r * 2);
            g.addColorStop(0, '#fffbe0');
            g.addColorStop(0.5, 'rgba(255, 230, 120, 0.8)');
            g.addColorStop(1, 'rgba(255, 220, 100, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y - this.size * 0.9, r * 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        
        // 被弾した瞬間は白く光らせる
        if (this.hitFlashTimer > 0) {
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, this.size * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
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
        } else if (this.isSlime) {
            if (this.isJumping) {
                return window.assetManager.get(`starlight_slime_${this.direction}_jump`);
            }
            return window.assetManager.get(`starlight_slime_${this.direction}_${this.animationFrame + 1}`);
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
        this.projectiles = [];      // 敵の光弾
        this.difficulty = 'normal'; // 'easy', 'normal', 'hard'
        this.difficultyMultipliers = {
            easy: { hp: 0.7, attack: 0.7, spawn: 1.5 },
            normal: { hp: 1.0, attack: 1.0, spawn: 1.0 },
            hard: { hp: 1.5, attack: 1.3, spawn: 0.7 }
        };
    }
    
    setDifficulty(difficulty) {
        this.difficulty = difficulty;
        console.log('難易度設定:', difficulty);
        
        // 難易度に応じてスポーン間隔を調整
        const multiplier = this.difficultyMultipliers[difficulty];
        this.spawnInterval = 5.0 * multiplier.spawn;
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
            
            // スライムの光弾を生成
            if (enemy.pendingShot) {
                this.projectiles.push({
                    position: enemy.position.add(new Vector2(0, -enemy.size * 0.5)),
                    velocity: enemy.pendingShot.mult(190), // ゆっくりめ：見てから避けられる速さ
                    damage: enemy.attack,
                    radius: 9,
                    life: 2.5,
                    age: 0
                });
                enemy.pendingShot = null;
            }
        }
        
        // 光弾を動かす（ジャスト回避中はこの deltaTime 自体がスローになっている）
        for (const p of this.projectiles) {
            p.position = p.position.add(p.velocity.mult(deltaTime));
            p.life -= deltaTime;
            p.age += deltaTime;
        }
        this.projectiles = this.projectiles.filter(p => p.life > 0);
        
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
        
        // 出現できる敵がいなければ何もしない（空配列で落ちないように）
        if (!enemyDataList || enemyDataList.length === 0) return;
        
        // 出現率（spawnWeight）に応じて敵を選択
        const totalWeight = enemyDataList.reduce((s, e) => s + (e.spawnWeight || 1), 0);
        let roll = Math.random() * totalWeight;
        let baseEnemyData = enemyDataList[enemyDataList.length - 1];
        for (const e of enemyDataList) {
            roll -= (e.spawnWeight || 1);
            if (roll < 0) { baseEnemyData = e; break; }
        }
        
        // 難易度に応じてステータスを調整
        const multiplier = this.difficultyMultipliers[this.difficulty];
        const adjustedEnemyData = {
            ...baseEnemyData,
            hp: Math.floor(baseEnemyData.hp * multiplier.hp),
            attack: Math.floor(baseEnemyData.attack * multiplier.attack)
        };
        
        const enemy = new Enemy(adjustedEnemyData, spawnPos);
        this.enemies.push(enemy);
        
        console.log(`敵出現: ${adjustedEnemyData.name} (HP: ${adjustedEnemyData.hp}, 攻撃: ${adjustedEnemyData.attack})`);
    }
    
    draw(ctx, camera) {
        for (const enemy of this.enemies) {
            enemy.draw(ctx, camera);
        }
        
        // 光弾：黄色く光る星の玉
        for (const p of this.projectiles) {
            const s = p.position.sub(camera);
            const pulse = 1 + Math.sin(p.age * 20) * 0.15;
            const r = p.radius * pulse;
            ctx.save();
            const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.2);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.35, '#fff1a8');
            g.addColorStop(0.7, 'rgba(255, 210, 90, 0.5)');
            g.addColorStop(1, 'rgba(255, 200, 80, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(s.x, s.y, r * 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
    
    // ナイフなどの近接攻撃：攻撃方向の扇形に入った敵にヒット
    checkMeleeAttack(attack) {
        const hits = [];
        const cosHalf = Math.cos(attack.arc / 2);
        
        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            
            const toEnemy = enemy.position.sub(attack.origin);
            // 敵の体の大きさ分だけ届く距離をおまけする
            const dist = toEnemy.length();
            if (dist > attack.range + enemy.size / 2) continue;
            
            // 密着していれば角度に関係なく当たる
            if (dist > enemy.size / 2) {
                const dot = (toEnemy.x * attack.aim.x + toEnemy.y * attack.aim.y) / dist;
                if (dot < cosHalf) continue;
            }
            
            const result = enemy.takeDamage(attack.damage);
            enemy.applyKnockback(attack.aim, attack.knockback);
            hits.push({ enemy, ...result });
        }
        
        return hits;
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
        // 光弾の当たり判定
        for (const p of this.projectiles) {
            if (p.position.distance(player.position) > p.radius + player.size * 0.3) continue;
            if (player.isDodging) {
                // 回避中はすり抜ける（ジャスト回避の判定だけ起こす）
                player.takeDamage(p.damage);
            } else {
                player.takeDamage(p.damage);
                p.life = 0;
            }
        }
        
        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            
            // 角ウサギの突進攻撃
            if (enemy.data.name === '角ウサギ' && enemy.isCharging) {
                const distance = enemy.position.distance(player.position);
                if (distance <= enemy.size * 1.5) {
                    const attackData = enemy.performAttack();
                    player.takeDamage(attackData.damage);
                }
            }
            // 通常の攻撃
            else if (enemy.state === 'attack' && enemy.attackTimer <= 0) {
                const attackData = enemy.performAttack();
                const distance = enemy.position.distance(player.position);
                if (distance <= enemy.attackRange) {
                    player.takeDamage(attackData.damage);
                }
            }
        }
    }
    
    getDeadEnemies() {
        return this.enemies.filter(e => !e.isAlive());
    }
    
    clear() {
        this.enemies = [];
        this.projectiles = [];
    }
}
