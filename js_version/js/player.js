// プレイヤークラス

class Player {
    constructor(x, y, gender = 'male') {
        this.position = new Vector2(x, y);
        this.velocity = new Vector2(0, 0);
        this.size = 64;     // 当たり判定の大きさ
        this.drawSize = 90; // 画面に表示する大きさ（見た目だけ大きくする）
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
        this.sprintMultiplier = 1.7;   // 走る時の速度倍率
        this.isDashing = false;        // 走っているか（ダッシュ画像を使う）
        // 移動のしかた（マップで決まる。game.js が setMoveMode で設定）
        //   'run'  : 戦闘フィールド・敵がいるマップ → 常に走る（スタミナは減らない）
        //   'walk' : 村・町・拠点など敵がいない場所 → 常に歩く
        // どちらでも詠唱中は歩き
        this.moveMode = 'run';
        
        // スタミナ
        this.maxStamina = 100;
        this.currentStamina = 100;
        this.dodgeStaminaCost = 25;    // 回避1回の消費 → パッと減る（走るのは消費なし）
        this.staminaRegenRate = 40;    // 回復量（毎秒）
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
        this.dodgeBuffer = 0;          // 回避ボタンの先行入力の残り時間
        this.justGuardTime = 0;        // ジャスト回避のスロー中の無敵（game.js が入れる）。この間はダメージも吹き飛ばしも受けない
        this.afterImages = [];         // 残像
        
        // 装備（初期装備はナイフ）
        this.weapon = {
            name: 'ナイフ',
            power: 5,          // 攻撃力に加算
            range: 100,        // 攻撃が届く距離（斬撃エフェクトの三日月の外側まで）
            arc: Math.PI * 0.8, // 斬撃の扇の角度（約144度。三日月の両端まで）
            cooldown: 0.35,    // 連続攻撃の間隔
            assistRange: 140,  // この距離内の敵には自動で向き直る
            knockback: 20      // 1回ごとの小さな押し出し（ダメージがたまると敵は大きくひるむ）
        };
        
        // 星力システム
        this.starPowerStage = 0; // 0:未解放, 1:感知, 2:操作, 3:展開, 4:熟練
        this.spRegenRate = 0.7; // 0.7SP（MP）/秒
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
        this.slashFx = null;                // 斬撃エフェクト（{ t, angle }。t は経過時間）
        
        // 魔法（最初から 炎・水・風・土・雷 の5つが使える）
        this.learnedMagic = ['magic_201', 'magic_202', 'magic_203', 'magic_204', 'magic_205'];
        // 魔法パレットにセットする5つ（覚えた魔法の中から選ぶ。最初は 炎・水・風・土・雷）
        // パレットの上から時計回りの順。setMagicSlot で入れ替えられる
        this.magicSlots = [...Player.DEFAULT_MAGIC_SLOTS];
        this.selectedMagicIndex = 0;  // 今選んでいるスロット（1〜5キー / Rキー / 魔法パレットで変更）
        this.magicCooldowns = {};
        
        // 詠唱：魔法ボタンを押すと頭上のゲージが溜まり、満タンで発動
        // 詠唱中は歩くことしかできない（ダッシュ・回避・攻撃は不可）
        this.isChanting = false;
        this.chantMagic = null;
        this.chantTime = 0;
        this.chantDuration = 1;
        this.chantRotation = 0;    // 足元の魔法陣の回転
        this.readyCast = null;     // 詠唱完了 → game.js が拾って発動
        this.castFrame = 0;
        this.castFrameTimer = 0;
        this.castFrameSpeed = 0.12; // 詠唱モーション1コマの表示時間
        
        // 詠唱中の魔法陣の出る場所：前に掲げた右手の手のひらの前
        // x, y：キャラの中心からのずれ（drawSize に対する割合）
        // sx, sy：魔法陣のつぶし方（正面向きは丸く、横向きは縦長のだ円＝横から見た円）
        // behind：true ならキャラの後ろに描く（背中向きの時は体の向こう側に出るため）
        // 詠唱画像の手のひらの位置から測った値（キャラごと）
        // 横向きは手のひらの少し先に、魔法陣の面が見えるだ円で出す
        const CAST_HAND = {
            // 男の子：128px の画像で 右:x98 y64 / 左:x31 y62 / 正面:x45 y63 / 背中:x93 y45
            male: {
                right: { x:  0.40, y:  0.00, sx: 0.32, sy: 1.0,  behind: false },
                left:  { x: -0.40, y: -0.01, sx: 0.32, sy: 1.0,  behind: false },
                down:  { x: -0.15, y:  0.12, sx: 1.0,  sy: 0.75, behind: false, size: 0.21 }, // 顔を隠さないよう小さめ・手の少し下
                up:    { x:  0.22, y: -0.17, sx: 1.0,  sy: 0.85, behind: true,  size: 0.3 }
            },
            // 女の子：128px の画像で 右:x90 y59 / 左:x33 y61 / 正面:x52 y66 / 背中:x94 y37
            female: {
                right: { x:  0.33, y: -0.04, sx: 0.32, sy: 1.0,  behind: false },
                left:  { x: -0.37, y: -0.02, sx: 0.32, sy: 1.0,  behind: false },
                down:  { x: -0.09, y:  0.14, sx: 1.0,  sy: 0.75, behind: false, size: 0.21 },
                up:    { x:  0.23, y: -0.20, sx: 1.0,  sy: 0.85, behind: true,  size: 0.3 }
            }
        };
        this.castHand = CAST_HAND[gender] || CAST_HAND.male;
        this.castCircleSize = 0.36; // 魔法陣の半径（drawSize に対する割合）
        
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
        this.maxInvincibleTime = 1.0;  // 攻撃を受けた後の無敵時間（1秒）
        
        // ノックバック（敵の咆哮などで飛ばされる）。飛ばされている間は動けない
        this.knockDir = new Vector2(0, 0);
        this.knockSpeed = 0;
        this.knockTimer = 0;
        this.knockDuration = 0;
        
        // 色（星の民の特徴）
        this.hairColor = '#3d2817'; // 黒に近い茶色
        this.eyeColor = '#ffb347';  // オレンジに近い黄色（星の民の特徴）
        this.clothesColor = '#8b6f47'; // 茶色
    }
    
    update(deltaTime, input) {
        // 魔法の切り替え（詠唱中はできない）
        this.updateMagicSelect(input);
        
        // 回避の開始（移動より先に判定。詠唱中・飛ばされている間はできない）
        // 回避中・待ち時間中に押した時は少しだけ覚えておき、できるようになったらすぐ出す（連続の回避がつながるように）
        if (input.isDodgePressed()) this.dodgeBuffer = Player.DODGE_BUFFER;
        else if (this.dodgeBuffer > 0) this.dodgeBuffer -= deltaTime;
        if (this.dodgeBuffer > 0 && !this.isChanting && this.knockTimer <= 0) {
            if (this.tryDodge(input)) this.dodgeBuffer = 0;
        }
        
        // 移動処理（飛ばされている間はノックバックだけ。回避中は回避の移動を優先）
        if (this.knockTimer > 0) {
            this.updateKnockback(deltaTime);
        } else if (this.isDodging) {
            this.updateDodge(deltaTime);
        } else {
            this.updateMovement(deltaTime, input);
        }
        
        // 攻撃タイマー（攻撃の開始は game.js から startAttack を呼ぶ）
        this.updateAttack(deltaTime);
        
        // 詠唱ゲージ
        this.updateChant(deltaTime);
        
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
        if (this.justGuardTime > 0) {
            this.justGuardTime -= deltaTime;
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
        
        // 走るかどうかはマップで決まる（戦闘フィールドは常に走る・拠点は常に歩く）。詠唱中は歩き
        this.isDashing = this.isMoving && this.moveMode === 'run' && !this.isChanting;
        
        if (this.isMoving) {
            // 方向を更新（攻撃モーション中は向きを固定）
            if (this.attackAnimTimer <= 0) {
                this.setDirectionFromVector(moveVector);
                this.aimVector = this.directionToVector(this.direction);
            }
            
            // 速度計算
            let speed = this.baseSpeed;
            if (this.isDashing) {
                speed *= this.sprintMultiplier; // スタミナは減らない
            }
            
            this.velocity = moveVector.mult(speed);
            this.moveBy(this.velocity.mult(deltaTime));
        } else {
            this.velocity = new Vector2(0, 0);
        }
    }
    
    setMoveMode(mode) {
        this.moveMode = mode === 'walk' ? 'walk' : 'run';
    }
    
    // 足元の当たり判定の箱（position からのずれと半分の大きさ）。体の上半分は壁に重なって見えてよい
    getFootBox() {
        return { ox: 0, oy: this.drawSize * 0.36, hw: 14, hh: 8 };
    }
    
    // 動かす：当たり判定のあるマップ（闘技場）では壁や障害物をすり抜けない
    moveBy(delta) {
        if (this.map && this.map.collisionEnabled) {
            this.position = this.map.moveEntity(this.position, delta, this.getFootBox()).position;
        } else {
            this.position = this.position.add(delta);
        }
    }
    
    // ---------- ノックバック ----------
    // dir の方向へ dist(px) 飛ばされる。force = true（咆哮など）は回避中・無敵中でも必ず飛ばされる
    knockback(dir, dist, duration = 0.3, force = false) {
        if (!dir || dir.length() < 0.01) dir = new Vector2(0, 1);
        if (this.justGuardTime > 0) return false; // ジャスト回避のスロー中は咆哮でも飛ばされない
        if (!force && (this.isDodging || this.invincibleTime > 0)) return false;
        if (this.isDodging) {
            // 回避は打ち消される（無敵も消える）
            this.isDodging = false;
            this.dodgeTimer = 0;
            this.dodgeCooldownTimer = this.dodgeCooldown;
        }
        this.knockDir = dir.normalize();
        this.knockDuration = duration;
        this.knockTimer = duration;
        this.knockSpeed = dist * 2 / duration; // だんだん遅くなって、ちょうど dist 進む
        this.velocity = new Vector2(0, 0);
        return true;
    }
    
    updateKnockback(deltaTime) {
        const k = Math.max(0, this.knockTimer / this.knockDuration); // 1→0
        this.moveBy(this.knockDir.mult(this.knockSpeed * k * deltaTime));
        this.isMoving = false;
        this.isDashing = false;
        this.velocity = new Vector2(0, 0);
        this.knockTimer -= deltaTime;
        if (this.knockTimer <= 0) { this.knockTimer = 0; this.knockSpeed = 0; }
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
        this.moveBy(this.velocity.mult(deltaTime));
        
        // 残像を残す
        this.afterImages.push({ pos: this.position.clone(), life: 0.2, maxLife: 0.2 });
        
        this.dodgeTimer -= deltaTime;
        if (this.dodgeTimer <= 0) {
            this.isDodging = false;
            // ジャスト回避が決まった後（スロー中の無敵の間）は、待たずに次の回避ができる
            this.dodgeCooldownTimer = this.justGuardTime > 0 ? 0 : this.dodgeCooldown;
            this.velocity = new Vector2(0, 0);
        }
    }
    
    // 回避の途中で敵の体にぶつかった：その場で止まる（回避の時間と無敵はそのまま）
    stopDodgeMove() {
        this.dodgeDirection = new Vector2(0, 0);
    }
    
    // ジャスト回避が起きたら true を返して状態をリセット（game.js が使う）
    consumeJustDodge() {
        if (this.dodgedAttack) {
            this.dodgedAttack = false;
            return true;
        }
        return false;
    }
    
    // ジャスト回避が決まった：time 秒のあいだ無敵にして、すぐ次の回避ができるようにする
    // （回避の待ち時間をなくし、使ったスタミナを返す。タイミングが合えば何回でも続けられる）
    onJustDodge(time) {
        this.justGuardTime = Math.max(this.justGuardTime, time);
        this.dodgeCooldownTimer = 0;
        this.currentStamina = Math.min(this.maxStamina, this.currentStamina + this.dodgeStaminaCost);
        // 完全無敵：飛ばされている途中ならそこで止める
        this.knockTimer = 0;
        this.knockSpeed = 0;
    }
    
    // ジャスト回避の無敵中か（この間は ダメージ・吹き飛ばし・咆哮の風圧 を全部受けない。攻撃・魔法はできる）
    isGuarded() {
        return this.justGuardTime > 0;
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
        if (this.slashFx) {
            this.slashFx.t += deltaTime;
            if (this.slashFx.t >= Player.SLASH_FX.duration) this.slashFx = null;
        }
    }
    
    // 攻撃を開始する。近くに敵がいればその方向へ向き直って斬る
    // 戻り値: 攻撃データ（クールダウン中・回避中は null）
    // aimDir：ねらう向き（スマホのスライド・PC のカーソル。Vector2）。null なら近くの敵を自動でねらう
    startAttack(enemies = [], aimDir = null) {
        if (this.attackTimer > 0 || this.isDodging || this.isChanting) return null;
        
        if (aimDir) {
            // ねらった向きの近く（約30度以内）に敵がいれば、その敵に少しだけ吸いつける
            const t = this.pickAimTarget(enemies, aimDir, this.weapon.assistRange + 40, Player.AIM_ASSIST_DOT);
            this.aimVector = t ? t.position.sub(this.position).normalize() : aimDir.normalize();
            this.setDirectionFromVector(this.aimVector);
        } else {
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
        }
        
        this.isAttacking = true;
        this.attackTimer = this.attackCooldown;
        this.attackAnimTimer = this.attackAnimDuration;
        
        // 少しだけ踏み込む
        this.moveBy(this.aimVector.mult(8));
        
        // 斬撃エフェクト（向きは斬った瞬間の向きで固定。位置は主人公についていく）
        // 続けて斬った時（前の斬撃から0.6秒以内）は、払う向きを逆にする
        const combo = this.lastSlashTime !== undefined && performance.now() - this.lastSlashTime < 600;
        this.slashFlip = combo ? !this.slashFlip : false;
        this.lastSlashTime = performance.now();
        this.slashFx = { t: 0, angle: Math.atan2(this.aimVector.y, this.aimVector.x), flip: this.slashFlip };
        
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
    
    // ねらった向き dir の近く（dot 以上）で、range 以内にいる敵（向きが近いほど・近いほど優先）
    pickAimTarget(enemies, dir, range, dot) {
        const n = dir.normalize();
        let best = null, bestScore = Infinity;
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const to = e.position.sub(this.position);
            const d = to.length();
            if (d === 0 || d > range) continue;
            const c = (to.x * n.x + to.y * n.y) / d;
            if (c < dot) continue;
            const score = d * (2 - c);
            if (score < bestScore) { bestScore = score; best = e; }
        }
        return best;
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
    
    // ---------- 魔法（詠唱） ----------
    getMagicData(magicId) {
        const list = (window.gameData && window.gameData.magicCircles) || [];
        return list.find(m => m.id === magicId) || null;
    }
    
    // パレットにセットした5つの魔法のデータ（空のスロットは null）
    getMagicSlots() {
        return this.magicSlots.map(id => (id ? this.getMagicData(id) : null));
    }
    
    // スロット i（0〜4）に覚えた魔法をセットする。覚えていない魔法はセットできない
    setMagicSlot(i, magicId) {
        if (i < 0 || i >= Player.MAGIC_SLOT_COUNT) return false;
        if (magicId && !this.learnedMagic.includes(magicId)) return false;
        this.magicSlots[i] = magicId || null;
        return true;
    }
    
    getSelectedMagic() {
        return this.getMagicData(this.magicSlots[this.selectedMagicIndex]);
    }
    
    updateMagicSelect(input) {
        if (this.isChanting) return;
        // 1〜5キーで直接選ぶ
        for (let i = 0; i < this.magicSlots.length; i++) {
            if (input.isKeyPressed(`Digit${i + 1}`) && this.magicSlots[i]) this.selectedMagicIndex = i;
        }
        // R キーで順番に切り替え（PC 用）
        if (input.isKeyPressed('KeyR')) {
            // 空のスロットはとばす
            const n = this.magicSlots.length;
            for (let k = 1; k <= n; k++) {
                const i = (this.selectedMagicIndex + k) % n;
                if (this.magicSlots[i]) { this.selectedMagicIndex = i; break; }
            }
        }
        // 魔法パレットで選ばれた魔法
        const picked = input.consumeMagicSelection ? input.consumeMagicSelection() : null;
        if (picked !== null && picked >= 0 && picked < this.magicSlots.length && this.magicSlots[picked]) {
            this.selectedMagicIndex = picked;
        }
    }
    
    // 使える状態か（使えない理由も返す）
    canStartChant(magic) {
        if (!magic) return 'なし';
        if (!this.learnedMagic.includes(magic.id)) return '未習得';
        if (this.starPowerStage < (magic.requiredStage || 0)) return '星力不足';
        if (this.isChanting || this.isDodging || this.isAttacking) return '行動中';
        if (this.magicCooldowns[magic.id] > 0) return 'クールダウン';
        if (this.currentSP < magic.spCost) return 'SP不足';
        return null;
    }
    
    // 魔法ボタンを押した時：詠唱を始める（SP はこの時点で消費）
    startChant(magicId = null) {
        const magic = magicId ? this.getMagicData(magicId) : this.getSelectedMagic();
        if (this.canStartChant(magic)) return false;
        
        this.consumeSP(magic.spCost);
        this.isChanting = true;
        this.chantMagic = magic;
        this.chantTime = 0;
        this.chantDuration = magic.chantTime || 1.0;
        this.chantRotation = 0;
        this.castFrame = 0;
        this.castFrameTimer = 0;
        this.isDashing = false;
        return true;
    }
    
    updateChant(deltaTime) {
        if (!this.isChanting) return;
        this.chantTime += deltaTime;
        this.chantRotation += deltaTime * 2.5;
        
        // 詠唱モーションのコマ送り（ループ）
        this.castFrameTimer += deltaTime;
        if (this.castFrameTimer >= this.castFrameSpeed) {
            this.castFrameTimer = 0;
            this.castFrame = (this.castFrame + 1) % this.actionFrameCount;
        }
        
        if (this.chantTime >= this.chantDuration) {
            // ゲージ満タン → 発動
            const magic = this.chantMagic;
            this.isChanting = false;
            this.chantMagic = null;
            this.magicCooldowns[magic.id] = magic.cooldown || 0;
            this.readyCast = magic;
        }
    }
    
    // 今の向きでの、手のひらの前の魔法陣の位置（ワールド座標）と形
    getCastHand() {
        const c = this.castHand[this.direction] || this.castHand.down;
        return {
            pos: this.position.add(new Vector2(c.x * this.drawSize, c.y * this.drawSize)),
            sx: c.sx, sy: c.sy, behind: c.behind,
            radius: this.drawSize * (c.size || this.castCircleSize)
        };
    }
    
    getChantProgress() {
        return this.isChanting ? Math.min(1, this.chantTime / this.chantDuration) : 0;
    }
    
    // 詠唱が終わった魔法を受け取る（game.js が発動させる）
    // 近くの前方に敵がいればその方向へ向き直って撃つ
    // aimDir：ねらう向き（スマホのスライド・PC のカーソル）。null なら前方の近い敵を自動でねらう
    // exact：true なら aimDir をそのまま使う（game.js の computeCastAim で、自動のねらい・吸いつきは済んでいる）
    consumeReadyCast(enemies = [], aimDir = null, exact = false) {
        if (!this.readyCast) return null;
        const magic = this.readyCast;
        this.readyCast = null;
        
        let aim;
        if (aimDir && exact) {
            aim = aimDir.normalize();
        } else if (aimDir) {
            // ねらった向きの近く（約30度以内）に敵がいれば、その敵の方へ（少しだけ吸いつける）
            const t = this.pickAimTarget(enemies, aimDir, 520, Player.AIM_ASSIST_DOT);
            aim = t ? t.position.sub(this.position).normalize() : aimDir.normalize();
        } else {
            const facing = this.directionToVector(this.direction);
            let bestDist = Infinity;
            aim = facing;
            for (const e of enemies) {
                if (!e.isAlive()) continue;
                const to = e.position.sub(this.position);
                const d = to.length();
                if (d === 0 || d > 420) continue;
                if ((to.x * facing.x + to.y * facing.y) / d < 0.35) continue; // 前方 約70度以内
                if (d < bestDist) { bestDist = d; aim = to.normalize(); }
            }
        }
        this.aimVector = aim;
        this.setDirectionFromVector(aim);
        
        const hand = this.getCastHand();
        return {
            magic,
            position: hand.pos,                 // 手のひらの前の魔法陣から撃つ
            direction: aim,
            circlePos: hand.pos,
            circleShape: { sx: hand.sx, sy: hand.sy },
            circleRadius: hand.radius
        };
    }
    
    // 互換用：旧コード（Qキーで即発動）から呼ばれた場合は詠唱を始める
    castMagic(magicId) {
        this.startChant(magicId);
        return false;
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
        if (this.invincibleTime > 0 || this.justGuardTime > 0) return 0;
        
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
        if (this.levelLocked) return; // バトルモードのボス戦：レベルは固定（経験値でも上がらない）
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
    
    // 決まったレベルの強さにする（バトルモードの推奨レベルがあるボス戦で使う）。HP・SP は満タン
    setLevel(level) {
        const statsTable = window.gameData && window.gameData.playerStatsTable;
        // 表にないレベル（JSON を読めなかった時など）は、表と同じ式で計算する
        const levelData = (statsTable && statsTable.find(s => s.level === level)) || Player.statsForLevel(level);
        this.level = level;
        this.exp = 0;
        this.maxHP = levelData.hp;
        this.currentHP = this.maxHP;
        this.attack = levelData.attack;
        this.defense = levelData.defense;
        this.maxSP = levelData.maxSP;
        this.currentSP = this.maxSP;
        this.expToNext = levelData.requiredExp;
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
        
        // 詠唱中：背中向きの時は、手のひらの前の魔法陣が体の向こう側なので先に描く
        const castHand = this.isChanting ? this.getCastHand() : null;
        if (castHand && castHand.behind) this.drawCastCircle(ctx, camera, castHand);
        
        // 回避の残像（青白く薄く）
        if (this.afterImages.length > 0) {
            ctx.save();
            for (const img of this.afterImages) {
                const p = img.pos.sub(camera);
                ctx.globalAlpha = (img.life / img.maxLife) * 0.35;
                if (playerImg) {
                    ctx.drawImage(playerImg, p.x - this.drawSize/2, p.y - this.drawSize/2, this.drawSize, this.drawSize);
                } else {
                    ctx.fillStyle = '#9fd8ff';
                    ctx.fillRect(p.x - this.drawSize/2, p.y - this.drawSize/2, this.drawSize, this.drawSize);
                }
            }
            ctx.restore();
        }
        
        // ジャスト回避の無敵中：足元に水色の光の輪（無敵なのが分かるように）
        if (this.justGuardTime > 0) {
            ctx.save();
            const k = Math.min(1, this.justGuardTime / 0.2);
            ctx.globalAlpha = 0.55 * k;
            ctx.strokeStyle = '#bfefff';
            ctx.shadowColor = '#7fdcff';
            ctx.shadowBlur = 12;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(screenPos.x, screenPos.y + this.drawSize * 0.36, this.drawSize * 0.42, this.drawSize * 0.15, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        
        // ダッシュ中の足元の砂ぼこり（ダッシュ画像には砂ぼこりが描いてあるので、画像がない時だけ）
        if (this.isDashing && !this.hasActionSprite('dash')) {
            ctx.save();
            ctx.fillStyle = 'rgba(220, 210, 180, 0.5)';
            const back = this.velocity.normalize().mult(-this.drawSize * 0.4);
            for (let i = 0; i < 3; i++) {
                const r = 4 + Math.random() * 4;
                ctx.beginPath();
                ctx.arc(screenPos.x + back.x + (Math.random() - 0.5) * 16,
                        screenPos.y + this.drawSize * 0.4 + back.y * 0.3 + (Math.random() - 0.5) * 6,
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
        let drawW = this.drawSize, drawH = this.drawSize;
        if (this.isDodging && !this.hasActionSprite('dodge')) {
            drawW = this.drawSize * 0.85;
            drawH = this.drawSize * 0.85;
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
            ctx.fillRect(screenPos.x - this.drawSize/2, screenPos.y - this.drawSize/2, this.drawSize, this.drawSize);
            
            // 頭
            ctx.fillStyle = this.hairColor;
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y - this.drawSize/3, this.drawSize/3, 0, Math.PI * 2);
            ctx.fill();
            
            // 目（星の民の特徴）
            ctx.fillStyle = this.eyeColor;
            ctx.beginPath();
            ctx.arc(screenPos.x - 5, screenPos.y - this.drawSize/3, 3, 0, Math.PI * 2);
            ctx.arc(screenPos.x + 5, screenPos.y - this.drawSize/3, 3, 0, Math.PI * 2);
            ctx.fill();
            
            // 性別マーク（仮）
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(this.gender === 'male' ? '♂' : '♀', screenPos.x, screenPos.y + this.drawSize/2 + 15);
        }
        
        ctx.restore();
        
        // ナイフの斬撃：斬撃エフェクトの画像があればそれを出す
        // （画像がない時は、攻撃画像もなければ線で描いた斬撃）
        if (!this.drawSlashEffect(ctx, screenPos) && this.isAttacking && !this.hasActionSprite('attack')) {
            this.drawKnifeSlash(ctx, screenPos);
        }
        
        // 詠唱中：手のひらの前に魔法陣（横・正面向きはキャラの手前に描く）
        if (castHand && !castHand.behind) this.drawCastCircle(ctx, camera, castHand);
        
        // 詠唱ゲージ（頭の上の小さな横ゲージ）
        if (this.isChanting) {
            this.drawChantGauge(ctx, screenPos);
        }
    }
    
    // 手のひらの前の魔法陣：手からスッと広がって現れ、くるくる回り、ゲージが溜まるほど明るくなる
    drawCastCircle(ctx, camera, hand) {
        if (!window.drawMagicCircle || !this.chantMagic) return;
        const s = hand.pos.sub(camera);
        const p = this.getChantProgress();
        const appear = Math.min(1, this.chantTime / 0.25);           // 0.25秒で広がる
        const ease = 1 - Math.pow(1 - appear, 3);
        const radius = hand.radius * (0.15 + 0.85 * ease);
        window.drawMagicCircle(ctx, s.x, s.y, radius, this.chantMagic.element,
            this.chantRotation, 0.6 + 0.4 * p, hand.sy, hand.sx);
    }
    
    drawChantGauge(ctx, screenPos) {
        const info = window.getElementInfo ? window.getElementInfo(this.chantMagic.element) : { color: '#ffb347', light: '#fff' };
        const w = 60, h = 8;
        const x = Math.round(screenPos.x - w / 2);
        const y = Math.round(screenPos.y - this.drawSize / 2 - 6);
        const p = this.getChantProgress();
        
        ctx.save();
        // 枠と背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
        // 溜まっていく部分（属性の色）
        ctx.fillStyle = info.color;
        ctx.fillRect(x, y, w * p, h);
        ctx.fillStyle = info.light;
        ctx.fillRect(x, y, w * p, 2); // 上側を明るくして立体感
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
        ctx.restore();
    }
    
    // 斬撃エフェクトの画像（4コマ）を斬った向きに回して描く。描けたら true
    // 画像は三日月のふくらんだ側（左）が斬る向きなので、左が攻撃方向を向くように回す
    //
    // 自然に見せるための工夫
    //   ・振り抜く動き：三日月を斬る向きのまわりで回しながら出す（右→左に払う感じ）
    //   ・連続で斬ると、払う向きが交互に入れかわる（上下を反転）
    //   ・時間の進み方：最初に速く、最後はゆっくり（イーズアウト）
    //   ・コマのつなぎ：となりのコマと重ねて少しずつ入れかえる（パッと切りかわらない）
    //   ・出だしは小さめから広がり、最後は前へ流れながら薄くなって消える
    //   ・うっすら光を重ねて、地面の上で「光の筋」に見えるようにする
    drawSlashEffect(ctx, screenPos) {
        if (!this.slashFx || !window.assetManager) return false;
        const fx = Player.SLASH_FX;
        const raw = Math.min(1, this.slashFx.t / fx.duration);   // 0→1（そのままの時間）
        const p = 1 - Math.pow(1 - raw, 2.2);                    // 0→1（最初に速く、最後ゆっくり）
        
        // 今のコマと次のコマ、その間の割合
        const pos = p * (fx.frames - 1);
        const i0 = Math.min(fx.frames - 1, Math.floor(pos));
        const i1 = Math.min(fx.frames - 1, i0 + 1);
        // 重ねるのは切りかわる直前だけ（ずっと重ねると、形のちがう三日月が二重に見える）
        const frac = pos - i0;
        const mix = Math.max(0, Math.min(1, (frac - 0.65) / 0.35));
        const img0 = window.assetManager.get(`effect_slash_${i0 + 1}`);
        const img1 = window.assetManager.get(`effect_slash_${i1 + 1}`);
        if (!img0) return false;
        
        // 振り抜き：-sweep → +sweep まで回す。連続攻撃では向きが逆
        const flip = this.slashFx.flip ? -1 : 1;
        const swing = (p - 0.5) * 2 * fx.sweep * flip;
        // 大きさ：0.8 → 1.0 にすぐ広がる
        const scale = 0.8 + 0.2 * Math.min(1, p / 0.45);
        // 最後は前へ少し流れる
        const drift = fx.drift * Math.max(0, (p - 0.6) / 0.4);
        // 濃さ：出だしはすぐ濃く、後半はゆっくり消える
        const alpha = Math.min(1, raw / 0.12) * (raw < 0.5 ? 1 : 1 - Math.pow((raw - 0.5) / 0.5, 1.5));
        if (alpha <= 0.01) return true;
        
        const s = fx.size * scale;
        const x = -s / 2 - (fx.offset + drift);
        const y = -s / 2;
        
        ctx.save();
        ctx.translate(screenPos.x, screenPos.y);
        ctx.rotate(this.slashFx.angle + Math.PI + swing);
        if (flip < 0) ctx.scale(1, -1);
        
        const draw = (a) => {
            if (img1 && i1 !== i0 && mix > 0) {
                ctx.globalAlpha = a * (1 - mix);
                ctx.drawImage(img0, x, y, s, s);
                ctx.globalAlpha = a * mix;
                ctx.drawImage(img1, x, y, s, s);
            } else {
                ctx.globalAlpha = a;
                ctx.drawImage(img0, x, y, s, s);
            }
        };
        draw(alpha * 0.92);
        // うっすら光（加算）。後半ほど弱く
        ctx.globalCompositeOperation = 'lighter';
        draw(alpha * 0.25 * (1 - p * 0.6));
        ctx.restore();
        return true;
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
        if (this.isChanting) {
            // 歩きながらの詠唱 / 立ち止まっての詠唱（キャラの体だけ。魔法陣は別に描く）
            const kind = this.isMoving ? 'castwalk' : 'cast';
            return `${base}_${kind}_${this.direction}_${this.castFrame + 1}`;
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

// 魔法パレットのスロット数と、最初にセットされている5つの魔法（炎・水・風・土・雷）
Player.MAGIC_SLOT_COUNT = 5;

// 主人公の魔法のダメージの倍率（全部の魔法：弾・残り火・竜巻・雷など。game.js で掛ける）
// （3.2 = 前の 1.6 の2倍）。属性の相性（有利 1.5倍 / 不利 0.5倍）はこの後に掛ける
Player.MAGIC_DAMAGE_MUL = 3.2;
// レベルのステータス（data/player_stats_table.json と同じ式）
Player.statsForLevel = (lv) => ({
    level: lv, hp: 100 + 21 * (lv - 1), attack: 15 + 3 * (lv - 1), defense: 5 + (lv - 1),
    maxSP: 50 + 6 * (lv - 1), requiredExp: 5 * lv
});
// 回避ボタンの先行入力（秒）：回避中・待ち時間中に押しても、この時間内ならできるようになった瞬間に回避する
Player.DODGE_BUFFER = 0.15;
// ねらった向きの何度以内の敵に吸いつけるか（cos。0.87 ≒ 30度）
Player.AIM_ASSIST_DOT = 0.87;

// 斬撃エフェクトの見た目
// size：画像を描く大きさ / offset：画像の中心を斬る向きへずらす量
// （三日月の外側は画像の中心から約 0.43×size。offset 40・size 140 で、外側が約 100px 先＝攻撃が届く距離 weapon.range）
// sweep：振り抜く時に回す角度（片側） / drift：消える時に前へ流れる量 / duration：出てから消えるまでの秒数
Player.SLASH_FX = { frames: 4, duration: 0.3, size: 140, offset: 40, sweep: 0.42, drift: 10 };
Player.DEFAULT_MAGIC_SLOTS = ['magic_201', 'magic_202', 'magic_203', 'magic_204', 'magic_205'];
