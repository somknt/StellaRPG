// プレイヤークラス

class Player {
    constructor(x, y) {
        this.position = new Vector2(x, y);
        this.velocity = new Vector2(0, 0);
        this.size = 32;
        
        // ステータス
        this.level = 1;
        this.exp = 0;
        this.expToNext = 10;
        
        this.maxHP = 100;
        this.currentHP = 100;
        this.maxSP = 50;
        this.currentSP = 50;
        this.attack = 15;
        this.defense = 5;
        this.critRate = 5.0;
        
        // 移動
        this.baseSpeed = 150;
        this.sprintMultiplier = 1.5;
        
        // 星力システム
        this.starPowerStage = 0; // 0:未解放, 1:感知, 2:操作, 3:展開, 4:熟練
        this.spRegenRate = 1; // 1SP/秒
        this.spRegenDelay = 5; // 5秒後に回復開始
        this.timeSinceLastSpUse = 0;
        
        // 戦闘
        this.attackCooldown = 0.5;
        this.attackTimer = 0;
        this.attackRange = 50;
        this.isAttacking = false;
        
        // 魔法
        this.learnedMagic = ['magic_001']; // 光弾陣は最初から習得（テスト用）
        this.magicCooldowns = {};
        
        // アニメーション
        this.direction = 'down';
        this.isMoving = false;
        this.animationFrame = 0;
        this.animationTimer = 0;
        this.animationSpeed = 0.2;
        
        // 無敵時間
        this.invincibleTime = 0;
        this.maxInvincibleTime = 1.0;
        
        // 色（星の民の特徴）
        this.hairColor = '#3d2817'; // 黒に近い茶色
        this.eyeColor = '#ffb347';  // オレンジに近い黄色（星の民の特徴）
        this.clothesColor = '#8b6f47'; // 茶色
    }
    
    update(deltaTime, input) {
        // 移動処理
        this.updateMovement(deltaTime, input);
        
        // 攻撃処理
        this.updateAttack(deltaTime, input);
        
        // 魔法クールダウン更新
        this.updateMagicCooldowns(deltaTime);
        
        // SP自然回復
        this.updateSPRegen(deltaTime);
        
        // 無敵時間
        if (this.invincibleTime > 0) {
            this.invincibleTime -= deltaTime;
        }
        
        // アニメーション
        if (this.isMoving) {
            this.animationTimer += deltaTime;
            if (this.animationTimer >= this.animationSpeed) {
                this.animationTimer = 0;
                this.animationFrame = (this.animationFrame + 1) % 3;
            }
        } else {
            this.animationFrame = 1; // 停止フレーム
        }
    }
    
    updateMovement(deltaTime, input) {
        const moveVector = input.getMovementVector();
        this.isMoving = moveVector.length() > 0;
        
        if (this.isMoving) {
            // 方向を更新
            if (moveVector.x < 0) this.direction = 'left';
            else if (moveVector.x > 0) this.direction = 'right';
            else if (moveVector.y < 0) this.direction = 'up';
            else if (moveVector.y > 0) this.direction = 'down';
            
            // 速度計算
            let speed = this.baseSpeed;
            if (input.isSprintPressed()) {
                speed *= this.sprintMultiplier;
            }
            
            this.velocity = moveVector.mult(speed);
            this.position = this.position.add(this.velocity.mult(deltaTime));
        } else {
            this.velocity = new Vector2(0, 0);
        }
    }
    
    updateAttack(deltaTime, input) {
        if (this.attackTimer > 0) {
            this.attackTimer -= deltaTime;
            if (this.attackTimer <= 0.2) {
                this.isAttacking = false;
            }
        }
        
        if (input.isAttackPressed() && this.attackTimer <= 0) {
            this.performAttack();
        }
    }
    
    performAttack() {
        this.isAttacking = true;
        this.attackTimer = this.attackCooldown;
        
        // 攻撃判定は game.js で処理
        return {
            position: this.getAttackPosition(),
            damage: this.attack,
            range: this.attackRange
        };
    }
    
    getAttackPosition() {
        const offset = 40;
        const pos = this.position.clone();
        
        switch (this.direction) {
            case 'up': pos.y -= offset; break;
            case 'down': pos.y += offset; break;
            case 'left': pos.x -= offset; break;
            case 'right': pos.x += offset; break;
        }
        
        return pos;
    }
    
    castMagic(magicId) {
        // 魔法陣データを取得（game.jsから渡される）
        const magic = window.gameData.magicCircles.find(m => m.id === magicId);
        
        if (!magic) return false;
        
        // 習得チェック
        if (!this.learnedMagic.includes(magicId)) return false;
        
        // 星力段階チェック
        if (this.starPowerStage < magic.requiredStage) return false;
        
        // SPチェック
        if (this.currentSP < magic.spCost) return false;
        
        // クールダウンチェック
        if (this.magicCooldowns[magicId] > 0) return false;
        
        // SP消費
        this.consumeSP(magic.spCost);
        
        // クールダウン設定
        this.magicCooldowns[magicId] = magic.cooldown;
        
        // 魔法発射
        return {
            magic: magic,
            position: this.position.clone(),
            direction: this.direction
        };
    }
    
    updateMagicCooldowns(deltaTime) {
        for (const magicId in this.magicCooldowns) {
            if (this.magicCooldowns[magicId] > 0) {
                this.magicCooldowns[magicId] -= deltaTime;
            }
        }
    }
    
    consumeSP(amount) {
        this.currentSP = Math.max(0, this.currentSP - amount);
        this.timeSinceLastSpUse = 0;
    }
    
    updateSPRegen(deltaTime) {
        this.timeSinceLastSpUse += deltaTime;
        
        if (this.timeSinceLastSpUse >= this.spRegenDelay) {
            this.currentSP = Math.min(this.maxSP, this.currentSP + this.spRegenRate * deltaTime);
        }
    }
    
    takeDamage(damage) {
        if (this.invincibleTime > 0) return 0;
        
        const actualDamage = Math.max(1, damage - this.defense);
        this.currentHP = Math.max(0, this.currentHP - actualDamage);
        this.invincibleTime = this.maxInvincibleTime;
        
        return actualDamage;
    }
    
    heal(amount) {
        this.currentHP = Math.min(this.maxHP, this.currentHP + amount);
    }
    
    restoreSP(amount) {
        this.currentSP = Math.min(this.maxSP, this.currentSP + amount);
    }
    
    gainExp(amount) {
        this.exp += amount;
        
        while (this.exp >= this.expToNext) {
            this.levelUp();
        }
    }
    
    levelUp() {
        this.level++;
        this.exp -= this.expToNext;
        
        // ステータステーブルから読み込み
        const statsTable = window.gameData.playerStatsTable;
        const levelData = statsTable.find(s => s.level === this.level);
        
        if (levelData) {
            this.maxHP = levelData.hp;
            this.currentHP = this.maxHP;
            this.attack = levelData.attack;
            this.defense = levelData.defense;
            this.maxSP = levelData.maxSP;
            this.currentSP = this.maxSP;
            this.expToNext = levelData.requiredExp;
        }
        
        console.log(`レベルアップ！Lv.${this.level}`);
    }
    
    unlockStarPower(stage) {
        if (stage > this.starPowerStage) {
            this.starPowerStage = stage;
            console.log(`星力解放：段階${stage}`);
        }
    }
    
    learnMagic(magicId) {
        if (!this.learnedMagic.includes(magicId)) {
            this.learnedMagic.push(magicId);
            console.log(`魔法習得：${magicId}`);
        }
    }
    
    draw(ctx, camera) {
        const screenPos = this.position.sub(camera);
        
        // 無敵時間中は点滅
        if (this.invincibleTime > 0 && Math.floor(this.invincibleTime * 10) % 2 === 0) {
            return;
        }
        
        // 簡易描画（後で画像に差し替え）
        ctx.save();
        
        // 体
        ctx.fillStyle = this.clothesColor;
        ctx.fillRect(screenPos.x - this.size/2, screenPos.y - this.size/2, this.size, this.size);
        
        // 頭
        ctx.fillStyle = this.hairColor;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y - this.size/3, this.size/3, 0, Math.PI * 2);
        ctx.fill();
        
        // 目（星の民の特徴）
        ctx.fillStyle = this.eyeColor;
        ctx.beginPath();
        ctx.arc(screenPos.x - 5, screenPos.y - this.size/3, 3, 0, Math.PI * 2);
        ctx.arc(screenPos.x + 5, screenPos.y - this.size/3, 3, 0, Math.PI * 2);
        ctx.fill();
        
        // 攻撃エフェクト
        if (this.isAttacking) {
            ctx.strokeStyle = '#ffb347';
            ctx.lineWidth = 3;
            const attackPos = this.getAttackPosition().sub(camera);
            ctx.beginPath();
            ctx.arc(attackPos.x, attackPos.y, this.attackRange, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        ctx.restore();
    }
    
    getHPPercent() {
        return (this.currentHP / this.maxHP) * 100;
    }
    
    getSPPercent() {
        return (this.currentSP / this.maxSP) * 100;
    }
    
    isDead() {
        return this.currentHP <= 0;
    }
}
