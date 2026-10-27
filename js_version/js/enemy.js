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
        this.hitFlashColor = '#ffffff'; // 被弾の光の色（ふつうは白。魔法の有利属性は赤・不利属性は青。game.js が入れる）
        
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
        
        // 突進する敵（角ウサギ・森イノシシ）。数値は敵データで上書きできる（ボスの大猪など）
        this.isCharger = enemyData.name === '角ウサギ' || enemyData.name === '森イノシシ';
        if (enemyData.chargeSpeed) this.chargeSpeed = enemyData.chargeSpeed;
        if (enemyData.chargeMaxDuration) this.chargeMaxDuration = enemyData.chargeMaxDuration;
        if (enemyData.chargePreparationTime) this.chargePreparationTime = enemyData.chargePreparationTime;
        if (enemyData.size) this.size = enemyData.size;
        this.isBoss = !!enemyData.isBoss;
        this.magicDefense = typeof enemyData.magicDefense === 'number' ? enemyData.magicDefense : null; // 魔法防御（ない敵は防御力のまま）
        this.displayName = enemyData.displayName || enemyData.name;
        this.crashTimer = 0;   // ボスが壁に激突して目を回している時間（見た目用）
        // かみつき（狼など）：溜め → 当たり判定
        this.attackWindupTime = enemyData.attackWindupTime || 0.3;
        this.attackWindup = 0;
        this.pendingMelee = false;
        this.biteTimer = 0;
        this.biteDir = new Vector2(1, 0);
        this.map = null;       // 当たり判定のあるマップ（闘技場）なら壁をすり抜けない
        
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
        
        // ノックバック（ひるみ）
        // 受けたダメージが「ひるみ値」までたまると、大きく飛ばされて少しの間動けなくなる
        this.poiseThreshold = Math.max(1, this.maxHP * (enemyData.poiseRatio || 0.3)); // 最大HPの3割（ボスは別の値）
        this.knockbackScale = enemyData.knockbackScale ?? 1; // 飛ばされる距離の倍率（重いボスは小さく）
        this.ai = null;                // ボスAI（boss_ai.js）。ある時はこちらが動きを決める
        this.poiseDamage = 0;          // たまっているダメージ
        this.poiseTimer = 0;           // しばらく攻撃されないと、たまった分が消える
        this.poiseResetTime = 2.5;
        this.staggerTimer = 0;         // 動けない残り時間
        this.knockDir = new Vector2(0, 0);
        this.knockDist = 0;            // 飛ばされる距離
        this.knockTime = 0;
        this.knockDuration = 0;        // 飛ばされている時間（0 = 飛ばされていない）
        this.knockHop = 0;             // 飛ばされる時に少し浮く高さ
        this.hurtPose = false;         // ひるみ画像を出すか（小さな押し出しでは出さない）
        this.hurtTime = 0;
        
        // ドロップ
        this.dropExp = enemyData.dropExp ?? enemyData.exp ?? 1;
        this.dropItems = enemyData.dropItems || [];
        
        // 全部の敵の大きさ・攻撃範囲・速さの倍率（Enemy.SCALE）。どの出し方（草原・闘技場・ボス戦）でもここを通る
        this.applyScale(Enemy.SCALE);
    }
    
    // 体の当たりのだ円（Enemy.BODY）。主人公の体の半径の分だけ広げてある
    bodyShape() {
        const B = Enemy.BODY, s = this.size;
        return { cx: this.position.x, cy: this.position.y + s * B.oy, rx: s * B.rx + B.player, ry: s * B.ry + B.player * 0.75 };
    }
    
    applyScale(S) {
        if (!S) return;
        this.size = Math.round(this.size * (this.isBoss ? S.bossSize : S.size));
        if (S.damage) this.attack = Math.round(this.attack * S.damage);
        this.attackRange *= S.range;
        this.speed *= S.speed;
        this.chargeSpeed *= S.speed;
        this.attackCooldown *= S.cooldown;
        if (this.isSlime) {
            this.hopSpeed *= S.speed;
            this.shootRange *= S.range;
            this.shootCooldown *= S.cooldown;
        }
    }
    
    update(deltaTime, player) {
        if (this.hitFlashTimer > 0) this.hitFlashTimer -= deltaTime;
        
        // 倒れた敵：最後のノックバックで飛ばされきるまで動かす（そのあと星のエフェクトになる）
        if (!this.isAlive()) {
            if (this.dying && !this.deathReady) this.updateKnockback(deltaTime);
            return;
        }
        
        this.target = player;
        
        if (this.attackTimer > 0) this.attackTimer -= deltaTime;
        if (this.poiseDamage > 0) {
            this.poiseTimer += deltaTime;
            if (this.poiseTimer >= this.poiseResetTime) this.poiseDamage = 0;
        }
        
        // ノックバック中：AI は止めて、後ろへすべるように飛ばされる
        if (this.staggerTimer > 0 || this.knockTime < this.knockDuration) {
            this.updateKnockback(deltaTime);
            return;
        }
        
        if (this.crashTimer > 0) this.crashTimer -= deltaTime;
        if (this.biteTimer > 0) this.biteTimer -= deltaTime;
        
        // ボス：ボスAIが動きと攻撃を決める
        if (this.ai) {
            this.ai.update(deltaTime);
        // 角ウサギ・森イノシシのジャンプ突進処理
        } else if (this.isCharger) {
            this.updateHornRabbitBehavior(deltaTime);
        } else if (this.isSlime) {
            this.updateSlimeBehavior(deltaTime);
        } else {
            // その他の敵は通常のAI
            this.updateAI(deltaTime);
        }
        
        // 向きを更新（ボスAIが向きを決めている時はそのまま）
        if (!(this.ai && this.ai.lockFacing)) this.updateDirection();
        
        // 移動（闘技場では壁や障害物をすり抜けない）
        const blocked = this.moveBy(this.velocity.mult(deltaTime));
        if (this.ai) {
            this.ai.blocked = blocked; // 突進で壁にぶつかったかは AI が判断する
        } else if (blocked && this.isCharging) {
            // 突進中に壁へぶつかった：突進をやめる。ボスはしばらく目を回して動けない（攻撃のチャンス）
            this.isCharging = false;
            this.chargeDuration = 0;
            this.attackTimer = this.attackCooldown;
            this.velocity = new Vector2(0, 0);
            if (this.isBoss) {
                this.staggerTimer = 1.2;
                this.knockDuration = 0;
                this.crashTimer = 1.2;
                this.state = 'stagger';
            }
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
                const R = Enemy.SCALE.range;
                if (dist < 150 * R) {
                    dir = toPlayer.normalize().mult(-1);              // 近すぎる → 離れる
                } else if (dist > 280 * R) {
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
    
    // 足元の当たり判定の箱
    getFootBox() {
        return { ox: 0, oy: this.size * 0.45, hw: this.size * 0.35, hh: this.size * 0.18 };
    }
    
    // 動かす。当たり判定のあるマップでは壁で止まる。戻り値：壁にぶつかったか
    moveBy(delta) {
        if (this.map && this.map.collisionEnabled) {
            const r = this.map.moveEntity(this.position, delta, this.getFootBox());
            this.position = r.position;
            return r.blocked;
        }
        this.position = this.position.add(delta);
        return false;
    }
    
    faceTowards(v) {
        const ax = Math.abs(v.x), ay = Math.abs(v.y);
        // ボス：ななめ45度の近くで 横向き⇔上下向き の絵が毎フレーム入れかわってぶれないよう、
        // 今の向きの軸から変わるのは、もう一方の軸がはっきり大きい時だけ（Enemy.BOSS_TURN_MARGIN 倍）
        if (this.ai && ax + ay > 0.01) {
            const m = Enemy.BOSS_TURN_MARGIN;
            const side = this.direction === 'left' || this.direction === 'right';
            if (side ? ay > ax * m : ax <= ay * m) this.direction = v.y < 0 ? 'up' : 'down';
            else this.direction = v.x < 0 ? 'left' : 'right';
            return;
        }
        if (ax > ay) this.direction = v.x < 0 ? 'left' : 'right';
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
        // ボスは向きの切りかえに余裕を持たせる（faceTowards）
        if (this.ai) { this.faceTowards(this.velocity); return; }
        
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
        
        // 状態遷移（かみつきの溜め中は、そのまま攻撃を続ける）
        if (this.attackWindup > 0) {
            this.state = 'attack';
        } else if (distanceToPlayer <= this.detectionRange) {
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
        const direction = this.target.position.sub(this.position).normalize();
        
        // かみつきの溜め：少し止まってから飛びかかる（見てから回避できるように）
        if (this.attackWindup > 0) {
            this.velocity = new Vector2(0, 0);
            this.faceTowards(direction);
            this.attackWindup -= deltaTime;
            if (this.attackWindup <= 0) {
                this.pendingMelee = true;          // EnemySpawner.checkEnemyAttacks が当たり判定をする
                this.biteTimer = 0.18;             // かみつきの見た目
                this.biteDir = direction;
                this.moveBy(direction.mult(14));   // 少し踏み込む
            }
            return;
        }
        
        // プレイヤーに向かって少し移動
        this.velocity = direction.mult(this.speed * 0.5);
        
        // 攻撃開始（以前はここで攻撃のタイマーを戻してしまい、当たり判定の前に攻撃が消えていた）
        if (this.attackTimer <= 0) {
            this.attackWindup = this.attackWindupTime;
            this.attackTimer = this.attackCooldown;
        }
    }
    
    performAttack() {
        this.attackTimer = this.attackCooldown;
        
        // 突進する敵は、突進中にダメージを与える
        if (this.isCharger && this.isCharging) {
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
    
    // 攻撃を受けて押し出される
    // heavy = true：ひるみ画像を出して大きく飛ばす（ひるみ値がたまった時・水/土の魔術）
    // heavy = false：小さく押し出すだけ（ナイフの1回1回）
    applyKnockback(direction, distance, heavy = true) {
        let dir = direction && direction.length() > 0.01 ? direction.normalize() : this.awayFromTarget();
        if (this.ai) {
            // ボス：小さな押し出しでは止まらない。突進中・無敵中は大きなノックバックも受けない
            if (!heavy || this.ai.superArmor || this.ai.invulnerable || !this.isAlive()) return;
        }
        distance *= this.knockbackScale;
        if (heavy) {
            // 同じフレームで大きなノックバックが重なったら、遠い方を使う
            const fresh = this.hurtPose && this.knockTime === 0 && this.knockDuration > 0;
            if (fresh) distance = Math.max(distance, this.knockDist);
            this.startKnockback(dir, distance, 0.3, 0.6, true);
        } else if (!(this.hurtPose && this.staggerTimer > 0)) {
            // 大きく飛ばされている最中は、小さな押し出しで上書きしない
            this.startKnockback(dir, distance, 0.12, 0.12, false);
        }
    }
    
    // プレイヤーと反対の向き（向きがわからない攻撃用）
    awayFromTarget() {
        if (this.target) {
            const v = this.position.sub(this.target.position);
            if (v.length() > 0.01) return v.normalize();
        }
        return new Vector2(0, 1);
    }
    
    startKnockback(dir, distance, duration, stun, hurt) {
        this.knockDir = dir;
        this.knockDist = distance;
        this.knockTime = 0;
        this.knockDuration = duration;
        this.knockHop = hurt ? 10 : 0;
        this.staggerTimer = Math.max(this.staggerTimer, stun);
        if (hurt) {
            this.hurtPose = true;
            this.hurtTime = 0;
            this.faceTowards(dir.mult(-1)); // 攻撃してきた方を向いたまま飛ばされる
        }
        this.velocity = new Vector2(0, 0);
        if (this.ai && hurt && this.isAlive()) this.ai.interrupt(); // ボスの攻撃を中断
        this.state = 'stagger'; // ひるんでいる間は攻撃してこない
        this.attackWindup = 0;
        this.pendingMelee = false;
        // 突進・跳ね・光弾の溜めは中断
        if (this.isCharging) {
            this.isCharging = false;
            this.chargeDuration = 0;
            this.attackTimer = this.attackCooldown;
        }
        this.chargeTimer = 0;
        if (this.isSlime) {
            this.isHopping = false;
            this.shootWindup = 0;
            this.restTimer = Math.max(this.restTimer, 0.3);
        }
        this.isJumping = false;
    }
    
    updateKnockback(deltaTime) {
        this.velocity = new Vector2(0, 0);
        this.isJumping = false;
        this.hurtTime += deltaTime;
        if (this.knockTime < this.knockDuration) {
            // 最初は速く、だんだんゆっくり止まる
            const ease = (t) => 1 - (1 - t) * (1 - t);
            const t0 = this.knockTime / this.knockDuration;
            this.knockTime = Math.min(this.knockDuration, this.knockTime + deltaTime);
            const t1 = this.knockTime / this.knockDuration;
            this.moveBy(this.knockDir.mult(this.knockDist * (ease(t1) - ease(t0))));
        }
        this.staggerTimer -= deltaTime;
        if (this.staggerTimer <= 0 && this.knockTime >= this.knockDuration) {
            if (this.dying) {
                // 飛ばされきった：ひるみ画像のまま、星のエフェクトに切り替える
                this.deathReady = true;
                return;
            }
            this.staggerTimer = 0;
            this.knockDuration = 0;
            this.knockTime = 0;
            this.hurtPose = false;
        }
    }
    
    // 飛ばされている時に少し浮く高さ（描画用）
    getHopOffset() {
        if (!this.hurtPose || this.knockDuration <= 0 || this.knockTime >= this.knockDuration) return 0;
        return Math.sin(Math.PI * (this.knockTime / this.knockDuration)) * this.knockHop;
    }
    
    // direction: 攻撃の向き（ひるんだ時に飛ばされる方向）
    // canStagger: false にすると、ひるみ値をためない（残り火・竜巻の継続ダメージ）
    // kind：'magic' の時は魔法防御（magicDefense。敵データにある時だけ。魔道ゴーレムなど）で減らす
    takeDamage(damage, direction = null, canStagger = true, kind = '') {
        // ボスの影の高速移動・回避・咆哮の間はダメージを受けない
        if (this.ai && this.ai.invulnerable && this.isAlive()) {
            return { damage: 0, position: this.position.clone(), staggered: true };
        }
        if (this.ai && this.ai.superArmor) canStagger = false;
        const def = kind === 'magic' && this.magicDefense !== null ? this.magicDefense : this.defense;
        // damageTakenMul：ボスのフェーズの防御力アップ（boss_ai.js の BossAI.PHASE_BUFF）
        const actualDamage = Math.max(1, Math.round((damage - def) * (this.damageTakenMul || 1)));
        this.currentHP = Math.max(0, this.currentHP - actualDamage);
        this.hitFlashTimer = 0.1;
        this.hitFlashColor = '#ffffff';
        if (this.isSlime) this.provoked = true; // 攻撃されたら怒る
        
        // ひるみ値がたまったら大きくノックバック
        let staggered = false;
        if (!this.isAlive() && !this.dying) {
            // 倒れた：最後に大きくノックバックしてから、星になって消える
            this.dying = true;
            this.deathReady = false;
            const dir = direction && direction.length() > 0.01 ? direction.normalize() : this.awayFromTarget();
            if (this.ai) this.ai.onDeath();
            this.startKnockback(dir, 70 * Math.max(0.6, this.knockbackScale), 0.3, this.isBoss ? 0.6 : 0.38, true);
            staggered = true;
        } else if (canStagger && this.isAlive()) {
            this.poiseDamage += actualDamage;
            this.poiseTimer = 0;
            if (this.poiseDamage >= this.poiseThreshold) {
                this.poiseDamage = 0;
                this.applyKnockback(direction, 80, true);
                staggered = true;
            }
        }
        
        // ダメージエフェクト
        return {
            damage: actualDamage,
            position: this.position.clone(),
            staggered
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
        if (!this.isAlive() && !this.dying) return;
        
        const screenPos = this.position.sub(camera);
        
        ctx.save();
        
        // 敵の画像を取得
        const enemyImage = this.getEnemyImage();
        
        const hop = this.getHopOffset() + (this.ai ? this.ai.lift : 0);
        
        // ボスの突進の予告：これから突っ込む方向に赤い帯を出す（見てから避けられるように）
        if (this.isBoss && this.chargeTimer > 0) {
            const t = 1 - this.chargeTimer / this.chargePreparationTime; // 0→1
            const len = this.chargeSpeed * this.chargeMaxDuration;
            const ang = Math.atan2(this.chargeDirection.y, this.chargeDirection.x);
            ctx.save();
            ctx.translate(screenPos.x, screenPos.y + this.size * 0.35);
            ctx.rotate(ang);
            ctx.globalAlpha = 0.18 + 0.25 * t;
            ctx.fillStyle = '#ff3a2a';
            ctx.fillRect(0, -this.size * 0.4, len * t, this.size * 0.8);
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#ff6a50';
            ctx.lineWidth = 2;
            ctx.strokeRect(0, -this.size * 0.4, len, this.size * 0.8);
            ctx.restore();
        }
        
        // 足元の影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.beginPath();
        ctx.ellipse(screenPos.x, screenPos.y + this.size * 0.55, this.size * 0.42, this.size * 0.14, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // ボスの仮アニメーション：足元を中心に伸び縮み・小刻みに震える（モーション画像が届くまで）
        if (this.ai) {
            const fy = screenPos.y + this.size * 0.55;
            const jx = this.ai.jitter ? (Math.random() - 0.5) * this.ai.jitter * 2 : 0;
            // 絵にポーズがある時は、伸び縮みを半分にする（絵の動きと重なりすぎないように）
            const k = enemyImage ? 0.5 : 1;
            ctx.translate(screenPos.x + jx, fy);
            ctx.scale(1 + (this.ai.scaleX - 1) * k, 1 + (this.ai.scaleY - 1) * k);
            ctx.translate(-screenPos.x, -fy);
        }
        
        if (enemyImage) {
            // 画像がある場合は画像を描画（飛ばされている時は少し浮かせる）
            const imageSize = this.size * (this._drawMul || 1.5); // 画像は少し大きめに（ボスの絵は look.sprite.draw）
            const ix = Math.floor(screenPos.x - imageSize/2);
            const iy = Math.floor(screenPos.y - imageSize/2 - hop);
            ctx.drawImage(enemyImage, ix, iy, imageSize, imageSize);
            // 被弾した瞬間は、体の形のまま光らせる（ふつうは白・有利属性は赤・不利属性は青）。ジャスト回避のスロー中は薄い水色
            if (this.hitFlashTimer > 0 || Enemy.slowMotion) {
                const slowOnly = Enemy.slowMotion && !(this.hitFlashTimer > 0 && this.hitFlashColor !== '#ffffff');
                ctx.globalAlpha = slowOnly ? 0.6 : 0.75;
                ctx.drawImage(Enemy.getWhiteSilhouette(enemyImage, slowOnly ? Enemy.SLOW_TINT : this.hitFlashColor), ix, iy, imageSize, imageSize);
                ctx.globalAlpha = 1;
            }
        } else if (Enemy.BEAST_LOOKS[this.data.name]) {
            // 狼・猪：画像が届くまでの仮の見た目（コードで描く）
            this.drawBeastFallback(ctx, screenPos, hop);
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
        
        // 画像がない敵：被弾した瞬間は白い丸で光らせる
        if (this.hitFlashTimer > 0 && !enemyImage) {
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = this.hitFlashColor !== '#ffffff' ? this.hitFlashColor : Enemy.slowMotion ? Enemy.SLOW_TINT : '#ffffff';
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, this.size * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        
        // かみつきの溜め：体が赤く光る（予告） / かみついた瞬間：前に白い牙の跡
        if (this.attackWindup > 0) {
            ctx.globalAlpha = 0.25 + 0.3 * (1 - this.attackWindup / this.attackWindupTime);
            ctx.fillStyle = '#ff3030';
            ctx.beginPath();
            ctx.ellipse(screenPos.x, screenPos.y, this.size * 0.6, this.size * 0.45, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        if (this.biteTimer > 0) {
            const bx = screenPos.x + this.biteDir.x * this.size * 0.7, by = screenPos.y + this.biteDir.y * this.size * 0.7;
            const ang = Math.atan2(this.biteDir.y, this.biteDir.x);
            ctx.globalAlpha = this.biteTimer / 0.18;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            for (const k of [-1, 1]) {
                ctx.beginPath();
                ctx.arc(bx, by, this.size * 0.35, ang + k * 0.5 - 0.6, ang + k * 0.5 + 0.6);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
        
        // ボスが壁に激突して目を回している：頭の上で星がくるくる回る
        if (this.crashTimer > 0) {
            ctx.fillStyle = '#ffe680';
            for (let i = 0; i < 3; i++) {
                const a = this.crashTimer * 6 + i * (Math.PI * 2 / 3);
                const sx = screenPos.x + Math.cos(a) * this.size * 0.45;
                const sy = screenPos.y - this.size * 0.75 + Math.sin(a) * this.size * 0.12;
                drawStarShape(ctx, sx, sy, 6, 2.5);
            }
        }
        
        // 倒れて飛ばされている間は HP バーを出さない。ボスの HP は画面上の大きなバーで出す
        if (!this.isAlive() || this.isBoss) {
            ctx.restore();
            return;
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
        
        // ノックバック中：ひるみ画像（当たった瞬間と止まりぎわは1コマ目、飛ばされている途中は2コマ目）
        if (this.hurtPose) {
            const key = this.data.name === '角ウサギ' ? 'horn_rabbit' : this.isSlime ? 'starlight_slime' : null;
            if (key) {
                const flying = this.hurtTime >= 0.08 && this.knockTime < this.knockDuration;
                const img = window.assetManager.get(`${key}_hurt_${this.direction}_${flying ? 2 : 1}`);
                if (img) return img;
            }
        }
        
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
        }
        
        // 狼・猪：画像（assets/enemies/<名前>/<向き>_<1〜3>.png）が置かれたらそちらを使う
        const look = Enemy.BEAST_LOOKS[this.data.name];
        this._drawMul = (look && look.sprite && look.sprite.draw) || 1.5; // 画面に描く大きさ（size の何倍か）
        if (look) {
            // ボス：今のモーション（突進・咆哮など）の画像
            if (this.ai && look.sprite) {
                const b = this.getBossSprite(look);
                if (b) return b;
            } else if (this.ai) {
                const m = window.assetManager.get(`${look.key}_${this.ai.motion}_${this.direction}_${this.animationFrame + 1}`);
                if (m) return m;
            }
            const img = window.assetManager.get(`${look.key}_${this.direction}_${this.animationFrame + 1}`);
            if (img) return img;
        }
        if (this.data.name === '草原狼') {
            return window.assetManager.get('wolf_1');
        }
        
        return null;
    }
    
    // ボスの絵：AI のモーション（look.sprite.alias で代わりの絵に置きかえ）と、コマ（ai.pose か時間でくり返し）から選ぶ
    // 下・上向きの絵がないモーションは、攻撃なら横向き（左右は向いている方）、待機などは下・上向きの歩きの絵
    getBossSprite(look) {
        const A = window.assetManager, sp = look.sprite, ai = this.ai;
        const motion = ai.motion || 'idle';
        const [name, fixed] = (sp.alias && sp.alias[motion]) || [motion, null];
        const speed = (sp.speed && (sp.speed[motion] || sp.speed[name])) || 0.15;
        const frame = fixed != null ? fixed : ai.pose != null ? ai.pose : Math.floor(ai.motionTime / speed) % 3;
        const file = (n, d, f) => A.get(n === 'walk' ? `${look.key}_${d}_${f + 1}` : `${look.key}_${n}_${d}_${f + 1}`);
        const dir = this.direction;
        const vertical = dir === 'up' || dir === 'down';
        const still = Enemy.BOSS_STILL_MOTIONS.includes(motion);
        let img = file(name, dir, frame);
        if (!img && vertical) {
            if (still) img = file('walk', dir, 0);
            else {
                // 左右どちらを向くか（真上・真下に近い時は前の向きのまま）
                if (Math.abs(ai.facing.x) > 0.05) this._side = ai.facing.x < 0 ? 'left' : 'right';
                img = file(name, this._side || 'right', frame);
            }
        }
        return img || file('walk', dir, 0);
    }
    
    // 狼・猪の仮の見た目（画像が届くまで）。見下ろしで、向きに合わせて頭の位置を変える
    drawBeastFallback(ctx, s, hop) {
        const look = Enemy.BEAST_LOOKS[this.data.name];
        // 魔道ゴーレム：石と金属の人型（golem_ai.js の Enemy.drawGolem）
        if (look.golem && typeof Enemy.drawGolem === 'function') { Enemy.drawGolem(this, ctx, s, hop); return; }
        const r = this.size * 0.5;
        const dir = this.direction;
        const side = dir === 'left' ? -1 : 1;
        const bob = (this.animationFrame === 1 ? -1.5 : 0) * (this.velocity.length() > 1 ? 1 : 0);
        const cx = s.x, cy = s.y - hop + bob;
        // 被弾した瞬間は白く（有利属性は赤・不利属性は青）、ジャスト回避のスロー中は薄い水色にする
        const tint = this.hitFlashTimer > 0 ? Enemy.HIT_TINTS[this.hitFlashColor] : null;
        const slow = Enemy.slowMotion && !(tint && this.hitFlashColor !== '#ffffff');
        const flash = this.hitFlashTimer > 0 || slow;
        const body = !flash ? look.body : slow ? Enemy.SLOW_TINT : (tint ? tint.body : '#ffffff');
        const dark = !flash ? look.dark : slow ? '#9fd8ee' : (tint ? tint.dark : '#e8e8e8');
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = look.outline;
        // 脚（歩くと前後に動く）
        const step = Math.sin(this.animationTimer / this.animationSpeed * Math.PI + this.animationFrame * 2) * r * 0.18;
        ctx.fillStyle = dark;
        for (const [lx, ly] of [[-0.45, 0.45], [0.45, 0.45], [-0.3, 0.55], [0.3, 0.55]]) {
            ctx.fillRect(cx + lx * r - r * 0.09, cy + ly * r + (lx > 0 ? step : -step) * 0.3, r * 0.18, r * 0.35);
        }
        // 胴体
        ctx.fillStyle = body;
        ctx.beginPath();
        if (dir === 'left' || dir === 'right') ctx.ellipse(cx, cy + r * 0.15, r * 0.95, r * 0.55, 0, 0, Math.PI * 2);
        else ctx.ellipse(cx, cy + r * 0.15, r * 0.65, r * 0.75, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        // 背中の毛（濃い色）
        ctx.fillStyle = dark;
        ctx.beginPath();
        if (dir === 'left' || dir === 'right') ctx.ellipse(cx - side * r * 0.1, cy - r * 0.12, r * 0.7, r * 0.22, 0, 0, Math.PI * 2);
        else ctx.ellipse(cx, cy, r * 0.25, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        // たてがみ（巨大森イノシシ）：背中のとげとげの毛
        if (look.mane) {
            ctx.fillStyle = dark;
            for (let i = -2; i <= 2; i++) {
                const bx = (dir === 'left' || dir === 'right') ? cx - side * r * 0.1 + i * r * 0.22 : cx + i * r * 0.08;
                const by = (dir === 'left' || dir === 'right') ? cy - r * 0.3 : cy - r * 0.3 + Math.abs(i) * r * 0.12;
                ctx.beginPath();
                ctx.moveTo(bx - r * 0.09, by + r * 0.1);
                ctx.lineTo(bx, by - r * 0.22);
                ctx.lineTo(bx + r * 0.09, by + r * 0.1);
                ctx.closePath(); ctx.fill();
            }
        }
        // 侵蝕の亀裂（黒蝕狼）：体に暗紫色の光るひび
        if (look.cracks && !flash) {
            ctx.save();
            ctx.strokeStyle = '#c45cff';
            ctx.shadowColor = '#b040ff';
            ctx.shadowBlur = 6;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.75 + Math.sin(performance.now() / 260) * 0.25;
            const lines = [[-0.5, 0.0, -0.15, 0.25, 0.1, 0.05], [0.1, -0.15, 0.35, 0.1, 0.55, -0.05], [-0.2, 0.35, 0.05, 0.5, 0.3, 0.4]];
            for (const l of lines) {
                const fx = (dir === 'left' || dir === 'right') ? side : 1;
                ctx.beginPath();
                ctx.moveTo(cx + l[0] * r * fx, cy + l[1] * r);
                ctx.lineTo(cx + l[2] * r * fx, cy + l[3] * r);
                ctx.lineTo(cx + l[4] * r * fx, cy + l[5] * r);
                ctx.stroke();
            }
            ctx.restore();
        }
        // しっぽ
        if (look.tail) {
            ctx.fillStyle = body;
            ctx.beginPath();
            if (dir === 'left' || dir === 'right') ctx.ellipse(cx - side * r * 1.05, cy - r * 0.05, r * 0.32, r * 0.14, -side * 0.5, 0, Math.PI * 2);
            else if (dir === 'up') ctx.ellipse(cx, cy + r * 0.85, r * 0.14, r * 0.3, 0, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
        }
        // 頭
        let hx = cx, hy = cy;
        if (dir === 'left' || dir === 'right') { hx = cx + side * r * 0.85; hy = cy - r * 0.2; }
        else if (dir === 'down') { hy = cy + r * 0.55; }
        else { hy = cy - r * 0.55; }
        if (dir !== 'up') {
            ctx.fillStyle = body;
            ctx.beginPath();
            ctx.ellipse(hx, hy, r * look.head, r * look.head * 0.85, 0, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
            // 鼻先
            ctx.fillStyle = look.snout;
            ctx.beginPath();
            const nx = dir === 'down' ? hx : hx + side * r * look.head * 0.8;
            const ny = dir === 'down' ? hy + r * look.head * 0.55 : hy + r * 0.08;
            ctx.ellipse(nx, ny, r * look.head * 0.45, r * look.head * 0.32, 0, 0, Math.PI * 2);
            ctx.fill();
            // 目
            ctx.fillStyle = look.eye;
            if (look.glowEyes) { ctx.shadowColor = look.eye; ctx.shadowBlur = 6; }
            const ey = hy - r * look.head * 0.2;
            if (dir === 'down') {
                ctx.fillRect(hx - r * 0.22, ey, 3, 3); ctx.fillRect(hx + r * 0.22 - 3, ey, 3, 3);
            } else {
                ctx.fillRect(hx + side * r * 0.12 - 1.5, ey, 3, 3);
            }
            ctx.shadowBlur = 0;
            // 牙（猪）。巨大森イノシシは太く反り返った牙
            if (look.tusks) {
                ctx.fillStyle = flash ? '#fff' : '#f4ecd2';
                const tw = look.bigTusks ? 5 : 3, tl = look.bigTusks ? 0.32 : 0.18;
                if (dir === 'down') {
                    ctx.fillRect(nx - r * 0.25, ny - 2, tw, -r * tl); ctx.fillRect(nx + r * 0.25 - tw, ny - 2, tw, -r * tl);
                } else {
                    ctx.fillRect(nx + side * r * 0.12, ny - r * tl, tw, r * (tl - 0.02));
                }
            }
        }
        // 耳
        ctx.fillStyle = dark;
        const ex = dir === 'left' || dir === 'right' ? hx - side * r * 0.1 : hx;
        const eyOff = dir === 'up' ? hy + r * 0.05 : hy - r * look.head * 0.75;
        for (const k of (dir === 'left' || dir === 'right') ? [0] : [-1, 1]) {
            ctx.beginPath();
            const bx = ex + k * r * 0.25;
            ctx.moveTo(bx - r * 0.12, eyOff + r * 0.08);
            ctx.lineTo(bx, eyOff - r * look.ear);
            ctx.lineTo(bx + r * 0.12, eyOff + r * 0.08);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
        }
        // 侵蝕：体から黒紫のもやが立つ
        if (look.miasma && !flash) {
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = '#5b1f7a';
            for (let i = 0; i < 4; i++) {
                const t = (performance.now() / 600 + i * 0.25) % 1;
                ctx.beginPath();
                ctx.arc(cx + Math.sin(i * 2.1) * r * 0.6, cy - t * r * 1.1, r * 0.18 * (1 - t), 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }
    
    // 画像を1色で塗りつぶしたもの（被弾の白い点滅・ジャスト回避の水色）。画像と色ごとに1回だけ作って使い回す
    static getWhiteSilhouette(img, color = '#ffffff') {
        // ※ゲームに Map クラス（マップ）があるので、標準の Map ではなく WeakMap を使う
        if (!Enemy._whiteCache) Enemy._whiteCache = new WeakMap();
        let byColor = Enemy._whiteCache.get(img);
        if (!byColor) { byColor = {}; Enemy._whiteCache.set(img, byColor); }
        let c = byColor[color];
        if (!c) {
            c = document.createElement('canvas');
            c.width = img.naturalWidth || img.width;
            c.height = img.naturalHeight || img.height;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            g.globalCompositeOperation = 'source-in';
            g.fillStyle = color;
            g.fillRect(0, 0, c.width, c.height);
            byColor[color] = c;
        }
        return c;
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

// ---------- 全部の敵の大きさ・攻撃範囲・速さ（ここを変えると全員に効く） ----------
// size     ：ふつうの敵の体の大きさ（見た目と当たり判定の両方）
// bossSize ：ボス（巨大森イノシシ・黒蝕狼・闘技場の大猪）の体の大きさ
// range    ：攻撃が届く距離・攻撃の範囲（かみつき・牙・爪・踏みつけ・飛びかかり・波動など）
// speed    ：動く速さ（歩く・走る・突進・跳ねる・弾）
// cooldown ：次の攻撃までの間隔（小さいほど攻撃が多い）。攻撃前の「溜め」は変えない（見てから避けられるように）
// shot     ：弾の当たる大きさ
// （ボスの cooldown は「攻撃と攻撃の間の待ち時間」attackInterval にかかる）
// damage   ：攻撃力（かみつき・突進・弾・体当たり・ボスの全部の攻撃）
Enemy.SCALE = { size: 1.6, bossSize: 2.0, range: 2.0, speed: 1.5, cooldown: 0.5, shot: 1.4, damage: 1.6 };
// ボスの絵：止まっているモーション（下・上向きの時は正面・背中の絵を出す）
Enemy.BOSS_STILL_MOTIONS = ['idle', 'detect', 'stun', 'hit', 'death'];
// ボスの向きの切りかえの余裕（1.3 = 約52度を超えるまで今の向きのまま）
Enemy.BOSS_TURN_MARGIN = 1.3;
// 侵蝕弾の画像（assets/effects/boss/corrupt_shot.png）で、光る玉の中心がある横の位置（左から何割か）
Enemy.SHOT_ORB_X = 0.4;

// 体当たりのダメージ（全員の敵・ボス）
// reach：敵の体の大きさのどこまでを「体」とするか / player：主人公の体の半径(px) / damage：敵の攻撃力に掛ける倍率
Enemy.CONTACT = { reach: 0.42, player: 16, damage: 0.6 };

// 体の当たり（すり抜けられない範囲）。地面に寝かせただ円
// rx・ry：敵の体の大きさに掛ける横・縦の半径 / oy：中心を下へずらす割合 / player：主人公の体の半径(px)
Enemy.BODY = { rx: 0.42, ry: 0.28, oy: 0.12, player: 16 };

// ジャスト回避で敵がスローになっている間（game.js が毎フレーム入れる）。敵を薄い水色にして知らせる
Enemy.slowMotion = false;
Enemy.SLOW_TINT = '#bfefff';
// 被弾の光の色（魔法の属性の相性。game.js の Game.AFFINITY_FLASH と同じ色）と、コードで描く体の影の色
Enemy.HIT_TINTS = {
    '#ffffff': { body: '#ffffff', dark: '#e8e8e8' },   // ふつう：白
    '#ff3030': { body: '#ff3030', dark: '#c41a1a' },   // 有利属性（よく効く）：赤
    '#3a7dff': { body: '#3a7dff', dark: '#2253c4' }    // 不利属性（効きにくい）：青
};

// 狼・猪の仮の見た目の色と形。key は画像を置いた時の名前（assets/enemies/<key>/<向き>_<1〜3>.png）
Enemy.BEAST_LOOKS = {
    '草原狼':   { key: 'grass_wolf',     body: '#9a9a9a', dark: '#6b6b70', outline: '#3a3a40', snout: '#c9c3b8', eye: '#ffcf4a', head: 0.42, ear: 0.38, tail: true },
    '侵蝕狼':   { key: 'corrupted_wolf', body: '#4a3a5c', dark: '#2a1f38', outline: '#160f20', snout: '#6a5878', eye: '#ff4ad2', head: 0.42, ear: 0.4, tail: true, glowEyes: true, miasma: true },
    '森イノシシ': { key: 'forest_boar',    body: '#7a5234', dark: '#4e331f', outline: '#2a1a0e', snout: '#b0876a', eye: '#ff6a3a', head: 0.48, ear: 0.22, tusks: true }
};

// 小さな星形（ボスの目回りなど）
function drawStarShape(ctx, x, y, outer, inner) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const r = i % 2 ? inner : outer;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
}

class EnemySpawner {
    constructor() {
        this.enemies = [];
        this.spawnTimer = 0;
        this.spawnInterval = 5.0;
        this.maxEnemies = 10;
        this.spawnRadius = 400;
        this.projectiles = [];      // 敵の光弾
        this.deathEffects = [];     // 倒れた敵の「星になって消える」エフェクト
        this.autoSpawn = true;      // 一定時間ごとに自動で出す（闘技場ではウェーブで出すので false）
        this.map = null;            // 当たり判定のあるマップ（敵に渡す）
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
        
        if (this.autoSpawn && this.spawnTimer >= this.spawnInterval && this.enemies.length < this.maxEnemies) {
            this.spawnEnemy(player.position, enemyDataList);
            this.spawnTimer = 0;
        }
        
        // 敵どうしが重なりすぎないよう、少し押し離す（狼の群れが1か所に固まらないように）
        this.separateEnemies(deltaTime);
        
        // 敵更新
        for (const enemy of this.enemies) {
            enemy.update(deltaTime, player);
            
            // スライムの光弾を生成
            if (enemy.pendingShot) {
                this.projectiles.push({
                    position: enemy.position.add(new Vector2(0, -enemy.size * 0.5)),
                    velocity: enemy.pendingShot.mult(190 * Enemy.SCALE.speed), // 見てから避けられる速さ
                    damage: enemy.attack,
                    radius: 9 * Enemy.SCALE.shot,
                    life: 2.5,
                    age: 0
                });
                enemy.pendingShot = null;
            }
            // ボスの弾（黒蝕狼の侵蝕弾など）
            if (enemy.ai && enemy.ai.pendingProjectiles.length) {
                this.projectiles.push(...enemy.ai.pendingProjectiles);
                enemy.ai.pendingProjectiles = [];
            }
        }
        
        // 光弾を動かす（ジャスト回避中はこの deltaTime 自体がスローになっている）
        for (const p of this.projectiles) {
            p.position = p.position.add(p.velocity.mult(deltaTime));
            p.life -= deltaTime;
            p.age += deltaTime;
            // 闘技場：壁に当たったら消える
            if (this.map && this.map.isShotBlocked && this.map.isShotBlocked(p.position)) p.life = 0;
        }
        this.projectiles = this.projectiles.filter(p => p.life > 0);
        
        // 死んだ敵は、その場に「星になって消える」エフェクトを残してから削除
        // （最後のノックバック中の敵は、飛ばされきるまで残しておく）
        const stillFlying = (e) => e.dying && !e.deathReady;
        for (const e of this.enemies) {
            if (!e.isAlive() && !stillFlying(e)) this.deathEffects.push(new EnemyDeathEffect(e));
        }
        this.enemies = this.enemies.filter(e => e.isAlive() || stillFlying(e));
        
        for (const d of this.deathEffects) d.update(deltaTime);
        this.deathEffects = this.deathEffects.filter(d => !d.done);
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
        enemy.map = this.map;
        this.enemies.push(enemy);
        
        console.log(`敵出現: ${adjustedEnemyData.name} (HP: ${adjustedEnemyData.hp}, 攻撃: ${adjustedEnemyData.attack})`);
    }
    
    // 決まった場所に決まった敵を出す（闘技場のウェーブ用）。壁の中なら近くの空いている場所にずらす
    spawnEnemyAt(enemyData, position) {
        const enemy = new Enemy(enemyData, position);
        enemy.map = this.map;
        if (this.map && this.map.findFreeSpot) enemy.position = this.map.findFreeSpot(position, enemy.getFootBox());
        this.enemies.push(enemy);
        return enemy;
    }
    
    separateEnemies(deltaTime) {
        const list = this.enemies;
        for (let i = 0; i < list.length; i++) {
            const a = list[i];
            if (!a.isAlive()) continue;
            for (let j = i + 1; j < list.length; j++) {
                const b = list[j];
                if (!b.isAlive()) continue;
                const d = b.position.sub(a.position);
                const dist = d.length();
                const min = (a.size + b.size) * 0.42;
                if (dist >= min) continue;
                const push = (dist > 0.01 ? d.normalize() : new Vector2(1, 0)).mult(Math.min(min - dist, 120 * deltaTime) / 2);
                if (!a.isCharging) a.moveBy(push.mult(-1));
                if (!b.isCharging) b.moveBy(push);
            }
        }
    }
    
    // 敵の体は「すり抜けられない物」：主人公と重なったら、主人公が来た側へ押し出す
    // prevPos（このフレームで動く前の主人公の位置）の側へ出すので、回避で体の真ん前から飛びこんでも後ろへ抜けない
    // 主人公が壁で押し出せない時は、残りの分だけ敵を押し返す
    resolveBodyCollisions(player, prevPos) {
        for (const e of this.enemies) {
            if (!e.isAlive() || e.dying) continue;
            if (e.ai && e.ai.airborne) continue; // 宙に浮いている間（狼の飛びかかり）は、上を飛び越える
            for (let k = 0; k < 2; k++) { // 主人公 → 敵 の順に押し出す
                const b = e.bodyShape();
                const qx = (player.position.x - b.cx) / b.rx, qy = (player.position.y - b.cy) / b.ry;
                const q = Math.hypot(qx, qy);
                if (q >= 1) break;
                // 押し出す向き（だ円をまるにした空間で）。体の中心を越えていたら、来た側（前の位置）へ戻す
                let nx = qx, ny = qy;
                if (prevPos) {
                    const px = (prevPos.x - b.cx) / b.rx, py = (prevPos.y - b.cy) / b.ry;
                    if (Math.hypot(px, py) > 0.01 && (px * qx + py * qy <= 0 || q < 0.6)) { nx = px; ny = py; }
                }
                let nl = Math.hypot(nx, ny);
                if (nl < 0.01) { nx = 0; ny = 1; nl = 1; }
                nx /= nl; ny /= nl;
                const target = new Vector2(b.cx + nx * b.rx, b.cy + ny * b.ry);
                const delta = target.sub(player.position);
                if (k === 0) {
                    // 回避で体にぶつかった：そこで止まる（体のふちをすべって後ろへ回りこまない）。回避の無敵は残る
                    if (player.isDodging && player.stopDodgeMove) player.stopDodgeMove();
                    player.moveBy(delta);
                } else {
                    // 主人公が壁に挟まれて動けない：敵の方を押し返す
                    e.moveBy(delta.mult(-1));
                }
            }
        }
    }
    
    draw(ctx, camera) {
        this.drawEnemies(ctx, camera);
        this.drawEffects(ctx, camera);
    }
    
    drawEnemies(ctx, camera) {
        for (const enemy of this.enemies) {
            enemy.draw(ctx, camera);
        }
    }
    
    // 倒れた時のエフェクトと敵の光弾（キャラより手前に描く）
    drawEffects(ctx, camera) {
        for (const d of this.deathEffects) {
            d.draw(ctx, camera);
        }
        
        // 光弾：黄色く光る星の玉
        for (const p of this.projectiles) {
            const s = p.position.sub(camera);
            const pulse = 1 + Math.sin(p.age * 20) * 0.15;
            const r = p.radius * pulse;
            ctx.save();
            // 侵蝕弾の画像：進む向きに回して描く（光る玉が当たり判定の位置に来るように）
            const shot = p.kind === 'corrupt' && window.assetManager && window.assetManager.get('bossfx_corrupt_shot');
            if (shot) {
                const w = p.radius * 9;
                const h = w * shot.height / shot.width;
                ctx.translate(s.x, s.y);
                ctx.rotate(Math.atan2(p.velocity.y, p.velocity.x));
                // 外側のうすい光
                const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
                glow.addColorStop(0, 'rgba(230, 170, 255, 0.55)');
                glow.addColorStop(1, 'rgba(90, 10, 140, 0)');
                ctx.fillStyle = glow;
                ctx.beginPath(); ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2); ctx.fill();
                ctx.drawImage(shot, -w * Enemy.SHOT_ORB_X, -h / 2, w, h);
                ctx.restore();
                continue;
            }
            const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.2);
            if (p.kind === 'star') {
                // 星力弾（魔道ゴーレム）：青白い光の玉
                g.addColorStop(0, '#ffffff');
                g.addColorStop(0.3, '#9fe9ff');
                g.addColorStop(0.65, 'rgba(60, 150, 255, 0.55)');
                g.addColorStop(1, 'rgba(40, 90, 220, 0)');
            } else if (p.kind === 'corrupt') {
                // 侵蝕弾：暗紫色の玉
                g.addColorStop(0, '#f3d6ff');
                g.addColorStop(0.3, '#b44dff');
                g.addColorStop(0.65, 'rgba(90, 10, 140, 0.6)');
                g.addColorStop(1, 'rgba(40, 0, 70, 0)');
            } else {
                g.addColorStop(0, '#ffffff');
                g.addColorStop(0.35, '#fff1a8');
                g.addColorStop(0.7, 'rgba(255, 210, 90, 0.5)');
                g.addColorStop(1, 'rgba(255, 200, 80, 0)');
            }
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
            
            const result = enemy.takeDamage(attack.damage, attack.aim);
            // ひるまなかった時は、小さく押し出すだけ
            if (!result.staggered) enemy.applyKnockback(attack.aim, attack.knockback, false);
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
            // from：弾が飛んできた方（当たったら少しノックバック）
            const from = p.velocity ? p.position.sub(p.velocity) : p.position;
            if (player.isDodging) {
                // 回避中はすり抜ける（ジャスト回避の判定だけ起こす）
                player.takeDamage(p.damage, from);
            } else {
                player.takeDamage(p.damage, from);
                p.life = 0;
            }
        }
        
        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            
            // 体当たり：敵（ボスも）の体にふれてもダメージ。回避中はすり抜ける（ジャスト回避にはしない）
            // ダメージの後の無敵時間があるので、ふれ続けても毎フレームは減らない
            // （体はすり抜けられないので、だ円の少し外までを「ふれている」とする）
            const b = enemy.bodyShape();
            const touch = Math.hypot((player.position.x - b.cx) / (b.rx + 6), (player.position.y - b.cy) / (b.ry + 6)) <= 1;
            // 宙に浮いている間（狼の飛びかかり）は、下にいても当たらない
            const airborne = enemy.ai && enemy.ai.airborne;
            if (!player.isDodging && touch && !airborne) {
                player.takeDamage(Math.max(1, Math.round(enemy.attack * Enemy.CONTACT.damage)), enemy.position);
            }
            
            // ボス：AI が出した当たり判定（牙・突進・踏みつけ・噛みつき・侵蝕波動など）
            if (enemy.ai) {
                enemy.ai.checkHits(player);
                continue;
            }
            
            // 突進攻撃（角ウサギ・森イノシシ）
            if (enemy.isCharger && enemy.isCharging) {
                const distance = enemy.position.distance(player.position);
                if (distance <= enemy.size * 0.75 + 24) {
                    const attackData = enemy.performAttack();
                    player.takeDamage(attackData.damage, enemy.position);
                }
            }
            // 通常の攻撃（かみつき）：溜めが終わった瞬間に、届く距離にいれば当たる
            else if (enemy.pendingMelee) {
                enemy.pendingMelee = false;
                const distance = enemy.position.distance(player.position);
                if (distance <= enemy.attackRange + player.size * 0.35) {
                    player.takeDamage(enemy.attack, enemy.position);
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
        this.deathEffects = [];
    }
}

// 敵が倒れたときのエフェクト（全部の敵で共通）
// 1) 敵の体が白く光りながら小さく縮んで、光の玉になる（ゲーム側で描く）
// 2) そこから画像の6コマ：星 → 縦にのびる → 光の柱 → キラキラが残って消える
class EnemyDeathEffect {
    constructor(enemy) {
        this.position = enemy.position.clone();
        this.sprite = enemy.getEnemyImage();   // 倒れた瞬間の見た目
        this.spriteSize = enemy.size * (this.sprite && enemy._drawMul || 1.5); // Enemy.draw と同じ大きさ
        // 画像がない狼・猪・ボス：コードで描いた仮の見た目を1枚の絵にして使う
        if (!this.sprite && Enemy.BEAST_LOOKS[enemy.data.name] && typeof document !== 'undefined') {
            const c = document.createElement('canvas');
            c.width = c.height = Math.ceil(this.spriteSize);
            const g = c.getContext('2d');
            if (g) {
                const flash = enemy.hitFlashTimer, slow = Enemy.slowMotion;
                enemy.hitFlashTimer = 0;
                Enemy.slowMotion = false; // 倒れた時の絵は元の色で
                enemy.drawBeastFallback(g, new Vector2(c.width / 2, c.height / 2), 0);
                enemy.hitFlashTimer = flash;
                Enemy.slowMotion = slow;
                this.sprite = c;
            }
        }
        this.fallbackColor = enemy.getEnemyColor();
        this.size = enemy.size;
        this.age = 0;
        this.done = false;
    }
    
    update(deltaTime) {
        this.age += deltaTime;
        if (this.age >= EnemyDeathEffect.TOTAL) this.done = true;
    }
    
    draw(ctx, camera) {
        const s = this.position.sub(camera);
        const t = this.age;
        const C = EnemyDeathEffect;
        ctx.save();
        
        // 1) 体が白く光って縮む（星の中心に向かって吸い込まれるように）
        if (t < C.SHRINK_END) {
            const p = t / C.SHRINK_END;                 // 0→1
            const whiten = Math.min(1, p / 0.45);         // 前半で真っ白に
            const scale = 1 - 0.75 * p * p;               // だんだん速く縮む
            const alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
            const size = this.spriteSize * scale;
            const x = s.x - size / 2, y = s.y - size / 2;
            ctx.globalAlpha = alpha;
            if (this.sprite) {
                ctx.drawImage(this.sprite, x, y, size, size);
                ctx.globalAlpha = alpha * whiten;
                ctx.drawImage(Enemy.getWhiteSilhouette(this.sprite), x, y, size, size);
            } else {
                ctx.fillStyle = whiten > 0.5 ? '#ffffff' : this.fallbackColor;
                ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
            }
        }
        
        // 縮みきる直前から、まわりに金色の光（画像の星とつなげる）
        if (t > C.SHRINK_END * 0.4 && t < C.FRAMES_START + 0.15) {
            const p = Math.min(1, (t - C.SHRINK_END * 0.4) / 0.12);
            const q = t > C.FRAMES_START ? 1 - (t - C.FRAMES_START) / 0.15 : 1;
            const r = this.size * 0.7;
            const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
            g.addColorStop(0, 'rgba(255, 252, 235, 0.95)');
            g.addColorStop(0.4, 'rgba(255, 220, 120, 0.55)');
            g.addColorStop(1, 'rgba(255, 200, 80, 0)');
            ctx.globalAlpha = p * q;
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // 2) 画像の6コマ（1コマ目の星の中心を、敵がいた場所に合わせる）
        if (t >= C.FRAMES_START && window.assetManager) {
            let ft = t - C.FRAMES_START, i = 0;
            while (i < C.FRAME_TIMES.length - 1 && ft >= C.FRAME_TIMES[i]) { ft -= C.FRAME_TIMES[i]; i++; }
            const img = window.assetManager.get(`effect_enemy_death_${i + 1}`);
            if (img) {
                const k = C.DRAW_SCALE * Math.sqrt(this.size / 32);  // 大きい敵ほど少し大きく（大きくなりすぎないよう平方根）
                const w = C.FRAME_W * k, h = C.FRAME_H * k;
                let alpha = 1;
                if (i === 0) alpha = Math.min(1, ft / 0.05);                          // ふわっと出る
                if (i === C.FRAME_TIMES.length - 1) {                                   // 最後は少し見せてから、うすれて消える
                    const p = ft / C.FRAME_TIMES[i];
                    alpha = p < 0.35 ? 1 : 1 - (p - 0.35) / 0.65;
                }
                ctx.globalAlpha = Math.max(0, alpha);
                ctx.drawImage(img, s.x - C.ANCHOR_X * k, s.y - C.ANCHOR_Y * k, w, h);
            }
        }
        ctx.restore();
    }
}
// 画像（assets/effects/enemy_death_1〜6.png）の大きさと、1コマ目の星の中心の位置
EnemyDeathEffect.FRAME_W = 115;
EnemyDeathEffect.FRAME_H = 480;
EnemyDeathEffect.ANCHOR_X = 57.5;
EnemyDeathEffect.ANCHOR_Y = 302.5;
EnemyDeathEffect.DRAW_SCALE = 0.4;    // 画面に出す大きさ（光の柱の高さ 約170px）
EnemyDeathEffect.SHRINK_END = 0.22;   // 体が縮んで消えるまで
EnemyDeathEffect.FRAMES_START = 0.16; // 画像の1コマ目が出始める時間（縮むのと少し重ねる）
EnemyDeathEffect.FRAME_TIMES = [0.1, 0.08, 0.08, 0.09, 0.11, 0.22]; // 各コマの長さ
EnemyDeathEffect.TOTAL = EnemyDeathEffect.FRAMES_START + EnemyDeathEffect.FRAME_TIMES.reduce((a, b) => a + b, 0);
