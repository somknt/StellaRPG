// プレイヤークラス

class Player {
    constructor(x, y, gender = 'male') {
        this.position = new Vector2(x, y);
        this.velocity = new Vector2(0, 0);
        this.size = 64; // 32から64に拡大（2倍）
        this.gender = gender; // 'male' or 'female'
        
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
        this.sprintMultiplier = 1.7;   // ダッシュ時の速度倍率
        this.isDashing = false;
        
        // スタミナ
        this.maxStamina = 100;
        this.currentStamina = 100;
        this.dashStaminaCost = 15;     // ダッシュ中の消費（毎秒）→ ゆっくり減る
        this.dodgeStaminaCost = 25;    // 回避1回の消費 → パッと減る
        this.staminaRegenRate = 30;    // 回復量（毎秒）
        this.staminaRegenDelay = 0.8;  // 使ってから回復が始まるまでの秒数
        this.timeSinceStaminaUse = 0;
        this.isExhausted = false;      // 0になったら一定量回復するまでダッシュ不可
        this.exhaustRecoverAt = 25;
        
        // 回避
        this.isDodging = false;
        this.dodgeDuration = 0.22;     // 一気に進む時間（4コマ分）
        this.dodgeDistance = 128;      // 進む距離（32pxタイル × 4マス）
        this.dodgeTimer = 0;
        this.dodgeDirection = new Vector2(0, 1);
        this.dodgeCooldown = 0.35;
        this.dodgeCooldownTimer = 0;
        this.dodgedAttack = false;     // 回避中に攻撃を避けたか（ジャスト回避判定）
        this.afterImages = [];         // 残像
        
        // 装備（初期装備はナイフ）
        this.weapon = {
            name: 'ナイフ',
            power: 5,          // 攻撃力に加算
            range: 70,         // 攻撃が届く距離
            arc: Math.PI * 0.6, // 斬撃の扇の角度（約108度）
            cooldown: 0.35,    // 連続攻撃の間隔
            assistRange: 110,  // この距離内の敵には自動で向き直る
            knockback: 40
        };
        
        // 星力システム
        this.starPowerStage = 0; // 0:未解放, 1:感知, 2:操作, 3:展開, 4:熟練
        this.spRegenRate = 1; // 1SP/秒
        this.spRegenDelay = 5; // 5秒後に回復開始
        this.timeSinceLastSpUse = 0;
        
        // 戦闘
        this.attackCooldown = this.weapon.cooldown;
        this.attackTimer = 0;
        this.attackRange = this.weapon.range;
        this.isAttacking = false;
        this.attackAnimDuration = 0.24; // 斬撃モーションの長さ（4コマ × 0.06秒）
        this.attackAnimTimer = 0;
        this.aimVector = new Vector2(0, 1); // 攻撃する向き
        
        // 魔法
        this.learnedMagic = ['magic_001']; // 光弾陣は最初から習得（テスト用）
        this.magicCooldowns = {};
        
        // アニメーション
        this.direction = 'down';
        this.isMoving = false;
        this.animationFrame = 0;
        this.animationTimer = 0;
        this.animationSpeed = 0.2;
        this.actionFrameCount = 4;  // ダッシュ・回避・攻撃画像のコマ数
        this.dashFrame = 0;
        this.dashFrameTimer = 0;
        this.dashFrameSpeed = 0.09; // ダッシュ1コマの表示時間
        
        // 無敵時間
        this.invincibleTime = 0;
        this.maxInvincibleTime = 1.0;
        
        // 色（星の民の特徴）
        this.hairColor = '#3d2817'; // 黒に近い茶色
        this.eyeColor = '#ffb347';  // オレンジに近い黄色（星の民の特徴）
        this.clothesColor = '#8b6f47'; // 茶色
    }
    
    update(deltaTime, input) {
        // 回避の開始（移動より先に判定）
        if (input.isDodgePressed()) {
            this.tryDodge(input);
        }
        
        // 移動処理（回避中は回避の移動を優先）
        if (this.isDodging) {
            this.updateDodge(deltaTime);
        } else {
            this.updateMovement(deltaTime, input);
        }
        
        // 攻撃タイマー（攻撃の開始は game.js から startAttack を呼ぶ）
        this.updateAttack(deltaTime);
        
        // スタミナ
        this.updateStamina(deltaTime);
        
        // 魔法クールダウン更新
        this.updateMagicCooldowns(deltaTime);
        
        // SP自然回復
        this.updateSPRegen(deltaTime);
        
        // 無敵時間
        if (this.invincibleTime > 0) {
            this.invincibleTime -= deltaTime;
        }
        if (this.dodgeCooldownTimer > 0) {
            this.dodgeCooldownTimer -= deltaTime;
        }
        
        // 残像を薄くしていく
        for (const img of this.afterImages) img.life -= deltaTime;
        this.afterImages = this.afterImages.filter(img => img.life > 0);
        
        // ダッシュのコマ送り（4コマ）
        if (this.isDashing) {
            this.dashFrameTimer += deltaTime;
            if (this.dashFrameTimer >= this.dashFrameSpeed) {
                this.dashFrameTimer = 0;
                this.dashFrame = (this.dashFrame + 1) % this.actionFrameCount;
            }
        } else {
            this.dashFrame = 0;
            this.dashFrameTimer = 0;
        }
        
        // アニメーション（ダッシュ中は足を速く動かす）
        if (this.isMoving) {
            const speed = this.isDashing ? this.animationSpeed * 0.55 : this.animationSpeed;
            this.animationTimer += deltaTime;
            if (this.animationTimer >= speed) {
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
        
        // ダッシュ：長押し中・移動中・スタミナがある時だけ
        this.isDashing = this.isMoving && input.isSprintPressed() &&
                         !this.isExhausted && this.currentStamina > 0;
        
        if (this.isMoving) {
            // 方向を更新（攻撃モーション中は向きを固定）
            if (this.attackAnimTimer <= 0) {
                this.setDirectionFromVector(moveVector);
                this.aimVector = this.directionToVector(this.direction);
            }
            
            // 速度計算
            let speed = this.baseSpeed;
            if (this.isDashing) {
                speed *= this.sprintMultiplier;
                this.useStamina(this.dashStaminaCost * deltaTime);
            }
            
            this.velocity = moveVector.mult(speed);
            this.position = this.position.add(this.velocity.mult(deltaTime));
        } else {
            this.velocity = new Vector2(0, 0);
        }
    }
    
    // ---------- 回避 ----------
    tryDodge(input) {
        if (this.isDodging || this.dodgeCooldownTimer > 0) return false;
        if (this.currentStamina < this.dodgeStaminaCost) return false;
        
        // 入力方向へ回避。入力がなければ向いている方向へ
        const move = input.getMovementVector();
        this.dodgeDirection = move.length() > 0 ? move : this.directionToVector(this.direction);
        this.setDirectionFromVector(this.dodgeDirection);
        
        this.isDodging = true;
        this.dodgeTimer = this.dodgeDuration;
        this.dodgedAttack = false;
        this.isMoving = true;
        this.useStamina(this.dodgeStaminaCost);
        return true;
    }
    
    updateDodge(deltaTime) {
        const speed = this.dodgeDistance / this.dodgeDuration;
        this.velocity = this.dodgeDirection.mult(speed);
        this.position = this.position.add(this.velocity.mult(deltaTime));
        
        // 残像を残す
        this.afterImages.push({ pos: this.position.clone(), life: 0.2, maxLife: 0.2 });
        
        this.dodgeTimer -= deltaTime;
        if (this.dodgeTimer <= 0) {
            this.isDodging = false;
            this.dodgeCooldownTimer = this.dodgeCooldown;
            this.velocity = new Vector2(0, 0);
        }
    }
    
    // ジャスト回避が起きたら true を返して状態をリセット（game.js が使う）
    consumeJustDodge() {
        if (this.dodgedAttack) {
            this.dodgedAttack = false;
            return true;
        }
        return false;
    }
    
    // ---------- スタミナ ----------
    useStamina(amount) {
        this.currentStamina = Math.max(0, this.currentStamina - amount);
        this.timeSinceStaminaUse = 0;
        if (this.currentStamina <= 0) {
            this.isExhausted = true;
        }
    }
    
    updateStamina(deltaTime) {
        this.timeSinceStaminaUse += deltaTime;
        if (this.timeSinceStaminaUse >= this.staminaRegenDelay) {
            this.currentStamina = Math.min(this.maxStamina, this.currentStamina + this.staminaRegenRate * deltaTime);
        }
        if (this.isExhausted && this.currentStamina >= this.exhaustRecoverAt) {
            this.isExhausted = false;
        }
    }
    
    getStaminaPercent() {
        return (this.currentStamina / this.maxStamina) * 100;
    }
    
    // ---------- 近接攻撃（ナイフ） ----------
    updateAttack(deltaTime) {
        if (this.attackTimer > 0) this.attackTimer -= deltaTime;
        if (this.attackAnimTimer > 0) {
            this.attackAnimTimer -= deltaTime;
            if (this.attackAnimTimer <= 0) this.isAttacking = false;
        }
    }
    
    // 攻撃を開始する。近くに敵がいればその方向へ向き直って斬る
    // 戻り値: 攻撃データ（クールダウン中・回避中は null）
    startAttack(enemies = []) {
        if (this.attackTimer > 0 || this.isDodging) return null;
        
        // 近くの敵を探す（向いている方向にいる敵を優先）
        const facing = this.directionToVector(this.direction);
        let target = null;
        let bestScore = Infinity;
        for (const enemy of enemies) {
            if (!enemy.isAlive()) continue;
            const toEnemy = enemy.position.sub(this.position);
            const dist = toEnemy.length();
            if (dist > this.weapon.assistRange || dist === 0) continue;
            const dot = (toEnemy.x * facing.x + toEnemy.y * facing.y) / dist; // 1=正面, -1=背後
            const score = dist * (2 - dot); // 正面で近いほど小さい
            if (score < bestScore) {
                bestScore = score;
                target = enemy;
            }
        }
        
        if (target) {
            this.aimVector = target.position.sub(this.position).normalize();
            this.setDirectionFromVector(this.aimVector);
        } else {
            this.aimVector = facing;
        }
        
        this.isAttacking = true;
        this.attackTimer = this.attackCooldown;
        this.attackAnimTimer = this.attackAnimDuration;
        
        // 少しだけ踏み込む
        this.position = this.position.add(this.aimVector.mult(8));
        
        if (window.soundManager) window.soundManager.playSFX('attack');
        
        return {
            origin: this.position.clone(),
            aim: this.aimVector.clone(),
            range: this.weapon.range,
            arc: this.weapon.arc,
            damage: this.attack + this.weapon.power,
            knockback: this.weapon.knockback
        };
    }
    
    // 互換用：旧コードから呼ばれた場合
    performAttack() {
        return this.startAttack([]);
    }
    
    getAttackPosition() {
        return this.position.add(this.aimVector.mult(40));
    }
    
    // ---------- 向きのヘルパー ----------
    setDirectionFromVector(v) {
        if (Math.abs(v.x) > Math.abs(v.y)) {
            this.direction = v.x < 0 ? 'left' : 'right';
        } else if (v.y !== 0) {
            this.direction = v.y < 0 ? 'up' : 'down';
        }
    }
    
    directionToVector(direction) {
        switch (direction) {
            case 'up': return new Vector2(0, -1);
            case 'down': return new Vector2(0, 1);
            case 'left': return new Vector2(-1, 0);
            case 'right': return new Vector2(1, 0);
            default: return new Vector2(0, 1);
        }
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
        // 回避中は無敵。攻撃を避けたらジャスト回避成立
        if (this.isDodging) {
            this.dodgedAttack = true;
            return 0;
        }
        if (this.invincibleTime > 0) return 0;
        
        const actualDamage = Math.max(1, damage - this.defense);
        this.currentHP = Math.max(0, this.currentHP - actualDamage);
        this.invincibleTime = this.maxInvincibleTime;
        
        // ダメージ効果音
        if (window.soundManager) {
            window.soundManager.playSFX('damage');
        }
        
        return actualDamage;
    }
    
    heal(amount) {
        this.currentHP = Math.min(this.maxHP, this.currentHP + amount);
        
        // 回復効果音
        if (window.soundManager) {
            window.soundManager.playSFX('heal');
        }
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
        
        // レベルアップ効果音
        if (window.soundManager) {
            window.soundManager.playSFX('levelup');
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
        
        // 性別に応じた個別ファイルを取得
        const imgKey = this.getPlayerImageKey();
        const playerImg = window.assetManager ? window.assetManager.get(imgKey) : null;
        
        // 回避の残像（青白く薄く）
        if (this.afterImages.length > 0) {
            ctx.save();
            for (const img of this.afterImages) {
                const p = img.pos.sub(camera);
                ctx.globalAlpha = (img.life / img.maxLife) * 0.35;
                if (playerImg) {
                    ctx.drawImage(playerImg, p.x - this.size/2, p.y - this.size/2, this.size, this.size);
                } else {
                    ctx.fillStyle = '#9fd8ff';
                    ctx.fillRect(p.x - this.size/2, p.y - this.size/2, this.size, this.size);
                }
            }
            ctx.restore();
        }
        
        // ダッシュ中の足元の砂ぼこり（ダッシュ画像には砂ぼこりが描いてあるので、画像がない時だけ）
        if (this.isDashing && !this.hasActionSprite('dash')) {
            ctx.save();
            ctx.fillStyle = 'rgba(220, 210, 180, 0.5)';
            const back = this.velocity.normalize().mult(-this.size * 0.4);
            for (let i = 0; i < 3; i++) {
                const r = 4 + Math.random() * 4;
                ctx.beginPath();
                ctx.arc(screenPos.x + back.x + (Math.random() - 0.5) * 16,
                        screenPos.y + this.size * 0.4 + back.y * 0.3 + (Math.random() - 0.5) * 6,
                        r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
        
        // 被ダメージ後の無敵時間中は点滅
        if (this.invincibleTime > 0 && Math.floor(this.invincibleTime * 10) % 2 === 0) {
            return;
        }
        
        ctx.save();
        
        // 回避中は少し伸び縮みさせて「シュッ」と動いた感じを出す
        let drawW = this.size, drawH = this.size;
        if (this.isDodging && !this.hasActionSprite('dodge')) {
            drawW = this.size * 0.85;
            drawH = this.size * 0.85;
            ctx.globalAlpha = 0.8;
        }
        
        if (playerImg) {
            // 個別ファイルなのでそのまま描画
            ctx.drawImage(
                playerImg,
                screenPos.x - drawW/2, screenPos.y - drawH/2,
                drawW, drawH
            );
        } else {
            // 画像がない場合は色で描画（従来の方法）
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
            
            // 性別マーク（仮）
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(this.gender === 'male' ? '♂' : '♀', screenPos.x, screenPos.y + this.size/2 + 15);
        }
        
        ctx.restore();
        
        // ナイフの斬撃モーション（攻撃画像に斬撃が描いてあるので、画像がない時だけ）
        if (this.isAttacking && !this.hasActionSprite('attack')) {
            this.drawKnifeSlash(ctx, screenPos);
        }
    }
    
    // ナイフの斬撃：攻撃方向に扇形の軌跡を描き、刃が振り抜かれていく
    drawKnifeSlash(ctx, screenPos) {
        const progress = 1 - Math.max(0, this.attackAnimTimer) / this.attackAnimDuration; // 0→1
        const baseAngle = Math.atan2(this.aimVector.y, this.aimVector.x);
        const half = this.weapon.arc / 2;
        const start = baseAngle - half;
        const current = start + this.weapon.arc * progress;
        const range = this.weapon.range;
        
        ctx.save();
        ctx.translate(screenPos.x, screenPos.y);
        
        // 軌跡（白っぽい三日月）
        ctx.globalAlpha = 0.6 * (1 - progress * 0.5);
        ctx.fillStyle = '#e8f4ff';
        ctx.beginPath();
        ctx.arc(0, 0, range, start, current);
        ctx.arc(0, 0, range * 0.55, current, start, true);
        ctx.closePath();
        ctx.fill();
        
        // 刃先のライン
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(current) * range * 0.35, Math.sin(current) * range * 0.35);
        ctx.lineTo(Math.cos(current) * range, Math.sin(current) * range);
        ctx.stroke();
        
        // ナイフの柄
        ctx.strokeStyle = '#6b4a2b';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(current) * range * 0.2, Math.sin(current) * range * 0.2);
        ctx.lineTo(Math.cos(current) * range * 0.35, Math.sin(current) * range * 0.35);
        ctx.stroke();
        
        ctx.restore();
    }
    
    // 向きとアニメーションフレームから画像キーを取得
    // 攻撃 > 回避 > ダッシュ > 歩き の優先順。アクション画像がなければ歩き画像を使う
    getPlayerImageKey() {
        const actionKey = this.getActionImageKey();
        if (actionKey && window.assetManager && window.assetManager.get(actionKey)) {
            return actionKey;
        }
        return this.getWalkImageKey();
    }
    
    getWalkImageKey() {
        const frame = this.animationFrame + 1; // 1, 2, 3
        return `player_${this.gender}_${this.direction}_${frame}`;
    }
    
    // 今の動きに合ったアクション画像のキー（該当なしなら null）
    getActionImageKey() {
        const frames = this.actionFrameCount;
        const base = `player_${this.gender}`;
        
        if (this.isAttacking) {
            // 攻撃モーションの進み具合からコマを決める（振りかぶり→斬る→振り抜き）
            const progress = 1 - Math.max(0, this.attackAnimTimer) / this.attackAnimDuration;
            const f = Math.min(frames, Math.floor(progress * frames) + 1);
            return `${base}_attack_${this.direction}_${f}`;
        }
        if (this.isDodging) {
            const progress = 1 - Math.max(0, this.dodgeTimer) / this.dodgeDuration;
            const f = Math.min(frames, Math.floor(progress * frames) + 1);
            return `${base}_dodge_${this.direction}_${f}`;
        }
        if (this.isDashing) {
            return `${base}_dash_${this.direction}_${this.dashFrame + 1}`;
        }
        return null;
    }
    
    // アクション画像が使えるか（使えるなら手描きの演出は画像に任せる）
    hasActionSprite(action) {
        if (!window.assetManager) return false;
        return !!window.assetManager.get(`player_${this.gender}_${action}_${this.direction}_1`);
    }
    
    getDirectionRow() {
        switch (this.direction) {
            case 'down': return 0;
            case 'up': return 1;
            case 'left': return 2;
            case 'right': return 3;
            default: return 0;
        }
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
