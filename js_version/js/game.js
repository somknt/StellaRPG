// ゲームメインクラス

class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.running = false;
        this.paused = false;
        this.gameState = 'character_select'; // 'character_select', 'playing', 'game_over'
        
        // ゲームモード：'battle'（フリーバトル。今はこれだけ） / 'story'（今後追加）
        this.gameMode = 'battle';
        
        // バトル設定
        this.battleDifficulty = 'normal'; // 'easy', 'normal', 'hard'
        
        // ジャスト回避（成功すると約1秒間、敵がスローになる）
        this.justDodgeDuration = 1.0;
        this.justDodgeSlowRate = 0.2;
        this.justDodgeTimer = 0;
        
        // システム
        this.input = new InputManager();
        this.ui = new UIManager();
        this.characterSelect = new CharacterSelectScreen();
        
        // ゲームオブジェクト
        this.player = null;
        this.selectedGender = null;
        this.map = null;
        this.camera = null;
        this.magicSystem = new MagicSystem();
        this.enemySpawner = new EnemySpawner();
        
        // FPS計測
        this.fps = 60;
        this.frameCount = 0;
        this.fpsTimer = 0;
        
        // タイム
        this.lastTime = performance.now();
        this.deltaTime = 0;
    }
    
    async init() {
        console.log('ゲーム初期化中...');
        
        // データ読み込み
        await this.loadGameData();
        
        // 画像読み込み
        await this.loadAssets();
        
        console.log('初期化完了！');
        this.running = true;
        // 起動時はキャラクター選択画面から開始
    }
    
    startGame(gender) {
        console.log('ゲーム開始:', gender, '難易度:', this.battleDifficulty);
        this.selectedGender = gender;
        
        // ティウム村マップを初期化
        const villageMapData = typeof initializeTiumVillageMap === 'function' 
            ? initializeTiumVillageMap() 
            : null;
        
        // マップ生成（ティウム村 or デフォルト）
        if (villageMapData) {
            this.map = new Map(
                villageMapData.width, 
                villageMapData.height, 
                villageMapData.tileSize,
                villageMapData
            );
            console.log('ティウム村マップを読み込みました');
            
            // プレイヤーをスポーン地点に配置
            const spawnX = villageMapData.spawnPoint.x * villageMapData.tileSize;
            const spawnY = villageMapData.spawnPoint.y * villageMapData.tileSize;
            this.player = new Player(spawnX, spawnY, gender);
        } else {
            // デフォルトマップ
            this.map = new Map(100, 100, 32);
            this.player = new Player(640, 360, gender);
            console.log('デフォルトマップを読み込みました');
        }
        
        this.player.unlockStarPower(3); // テスト用：段階3解放
        this.justDodgeTimer = 0;
        
        // 移動のしかた：バトルモードと戦闘フィールドは常に走る、村・町・拠点（safeZone）は常に歩く
        this.player.setMoveMode(this.getMoveModeForMap(villageMapData));
        
        // 難易度に応じて敵のスポーナーを設定
        this.enemySpawner.setDifficulty(this.battleDifficulty);
        
        // 開始直後から草原の敵が見えるよう、種類ごとに1体ずつ出しておく
        this.enemySpawner.clear();
        for (const enemyData of window.gameData.enemies) {
            this.enemySpawner.spawnEnemy(this.player.position, [enemyData]);
        }
        
        // カメラ
        this.camera = new Camera(0, 0, this.canvas.width, this.canvas.height);
        this.camera.follow(this.player);
        this.camera.setBounds(this.map.width * this.map.tileSize, this.map.height * this.map.tileSize);
        this.camera.snapToTarget();
        
        this.gameState = 'playing';
    }
    
    // 今は「バトルモード」（フリーバトル）だけなので常に走る。
    // ストーリーモードを作ったら、mapData.safeZone が true の村・町・拠点では歩きにする
    getMoveModeForMap(mapData) {
        if (this.gameMode === 'battle') return 'run';
        return mapData && mapData.safeZone ? 'walk' : 'run';
    }
    
    async loadGameData() {
        try {
            // プレイヤーステータステーブル
            const statsResponse = await fetch('data/player_stats_table.json');
            const statsData = await statsResponse.json();
            window.gameData = window.gameData || {};
            window.gameData.playerStatsTable = statsData.levels;
            
            this.ui.updateLoadingProgress(0.33, 'プレイヤーデータ読み込み中...');
            
            // 魔法陣データ
            const magicResponse = await fetch('data/magic_circles.json');
            const magicData = await magicResponse.json();
            window.gameData.magicCircles = magicData.magicCircles;
            // JSON に最初の5魔法が入っていなければ足す（古いデータでも動くように）
            for (const m of (window.STARTER_MAGIC || [])) {
                if (!window.gameData.magicCircles.some(x => x.id === m.id)) window.gameData.magicCircles.push({ ...m });
            }
            
            this.ui.updateLoadingProgress(0.66, '魔法陣データ読み込み中...');
            
            // 敵データ
            const enemyResponse = await fetch('data/enemies.json');
            const enemyData = await enemyResponse.json();
            // 出現させる敵：spawnEnabled 指定があればそれに従い、なければ草原フィールドの敵
            const GRASSLAND_ENEMIES = ['角ウサギ', '星光スライム'];
            let spawnable = enemyData.enemies.filter(e =>
                e.spawnEnabled === true || (e.spawnEnabled === undefined && GRASSLAND_ENEMIES.includes(e.name))
            );
            if (spawnable.length === 0) spawnable = enemyData.enemies.slice(0, 1);
            window.gameData.enemies = spawnable;
            console.log('出現する敵:', spawnable.map(e => e.name).join(', '));
            
            this.ui.updateLoadingProgress(1.0, '読み込み完了！');
            
            console.log('データ読み込み完了');
        } catch (error) {
            // index.html を直接開いた（file://）場合などは JSON を読めないので、ここの予備データで動かす
            console.warn('データ読み込みエラー（予備データで続行）:', error);
            window.gameData = {
                playerStatsTable: [{level: 1, hp: 100, attack: 15, defense: 5, maxSP: 50, requiredExp: 10}],
                magicCircles: (window.STARTER_MAGIC || []).map(m => ({ ...m })),
                // 草原に出る敵（data/enemies.json と同じ値）
                enemies: [{
                    enemyId: 'enemy_001',
                    name: '角ウサギ',
                    hp: 25,
                    attack: 7,
                    defense: 1,
                    exp: 5,
                    spawnWeight: 40
                }, {
                    enemyId: 'enemy_007',
                    name: '星光スライム',
                    hp: 35,
                    attack: 9,
                    defense: 2,
                    exp: 9,
                    spawnWeight: 30
                }]
            };
            console.log('出現する敵:', window.gameData.enemies.map(e => e.name).join(', '));
        }
    }
    
    // 画像読み込み
    async loadAssets() {
        if (!window.assetManager) return;
        
        return new Promise((resolve) => {
            window.assetManager.loadAll(
                (loaded, total) => {
                    const progress = loaded / total;
                    this.ui.updateLoadingProgress(progress, `画像読み込み中... ${loaded}/${total}`);
                },
                () => {
                    console.log('画像読み込み完了');
                    resolve();
                }
            );
        });
    }
    
    update(deltaTime) {
        // 画面の状態を body に書いておく（CSS でタッチ操作やステータスの表示を切り替える）
        if (this._shownState !== this.gameState && typeof document !== 'undefined' && document.body) {
            this._shownState = this.gameState;
            document.body.dataset.state = this.gameState;
        }
        
        if (this.paused) return;
        
        
        // キャラクター選択中
        if (this.gameState === 'character_select') {
            this.characterSelect.update(this.input);
            if (this.characterSelect.isComplete) {
                console.log('ゲーム開始処理実行');
                this.startGame(this.characterSelect.getSelectedGender());
            }
            return;
        }
        
        // ゲームプレイ中
        if (this.gameState !== 'playing') return;
        
        // プレイヤー更新
        this.player.update(deltaTime, this.input);
        
        // 魔法：ボタンで詠唱開始 → 頭上のゲージが満タンになったら発動
        if (this.input.isMagicPressed()) {
            this.player.startChant();
        }
        const cast = this.player.consumeReadyCast(this.enemySpawner.enemies);
        if (cast) {
            this.magicSystem.castMagic(cast.magic, cast.position, cast.direction, cast.circlePos,
                this.enemySpawner.enemies, cast.circleShape, cast.circleRadius);
        }
        
        // プレイヤーの近接攻撃（ナイフ）：近くの敵の方向へ向き直って斬る
        if (this.input.isAttackPressed()) {
            const attackData = this.player.startAttack(this.enemySpawner.enemies);
            if (attackData) {
                const hits = this.enemySpawner.checkMeleeAttack(attackData);
                for (const hit of hits) {
                    if (!hit.enemy.isAlive()) {
                        const drops = hit.enemy.getDrops();
                        this.player.gainExp(drops.exp);
                    }
                }
            }
        }
        
        // 魔法システム更新
        this.magicSystem.update(deltaTime);
        
        // 魔法と敵の衝突
        const magicHits = this.magicSystem.checkCollisions(this.enemySpawner.enemies);
        for (const hit of magicHits) {
            // 星力段階4なら威力1.2倍
            const damage = this.player.starPowerStage >= 4 
                ? Math.floor(hit.damage * 1.2) 
                : hit.damage;
            
            hit.enemy.takeDamage(damage);
            if (hit.knockback > 0) {
                hit.enemy.applyKnockback(hit.direction, hit.knockback); // 水・土は敵を押し出す
            }
            if (!hit.enemy.isAlive()) {
                const drops = hit.enemy.getDrops();
                this.player.gainExp(drops.exp);
            }
        }
        
        // ジャスト回避の時間：敵の動きが約1秒スローになる
        if (this.justDodgeTimer > 0) {
            this.justDodgeTimer -= deltaTime;
        }
        const enemyDeltaTime = this.justDodgeTimer > 0 ? deltaTime * this.justDodgeSlowRate : deltaTime;
        
        // 敵更新
        this.enemySpawner.update(enemyDeltaTime, this.player, window.gameData.enemies);
        
        // 敵の攻撃
        this.enemySpawner.checkEnemyAttacks(this.player);
        
        // 回避中に攻撃を避けていたらジャスト回避発動
        if (this.player.consumeJustDodge() && this.justDodgeTimer <= 0) {
            this.justDodgeTimer = this.justDodgeDuration;
        }
        
        // カメラ更新
        this.camera.update(deltaTime);
        
        // UI更新
        this.ui.updatePlayerStats(this.player);
        this.ui.updateDebugInfo(this.fps, this.player, this.enemySpawner.enemies.length);
        
        // ゲームオーバー
        if (this.player.isDead()) {
            this.gameOver();
        }
    }
    
    draw() {
        // 画面クリア
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        
        // キャラクター選択画面
        if (this.gameState === 'character_select') {
            this.characterSelect.draw(this.ctx);
            return;
        }
        
        // ゲームプレイ画面
        if (this.gameState !== 'playing') return;
        
        // マップ描画
        this.map.draw(this.ctx, this.camera.position);
        
        // 敵描画
        this.enemySpawner.draw(this.ctx, this.camera.position);
        
        // プレイヤー描画
        this.player.draw(this.ctx, this.camera.position);
        
        // 魔法エフェクト描画
        this.magicSystem.draw(this.ctx, this.camera.position);
        
        // ジャスト回避は画面演出なし（敵がスローになるだけ）
    }
    
    gameLoop(currentTime) {
        if (!this.running) return;
        
        // デルタタイム計算
        this.deltaTime = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;
        
        // FPS計測
        this.frameCount++;
        this.fpsTimer += this.deltaTime;
        if (this.fpsTimer >= 1.0) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.fpsTimer = 0;
        }
        
        // 更新
        this.update(Math.min(this.deltaTime, 0.1)); // 最大0.1秒に制限
        
        // 描画
        this.draw();
        
        // 「押された瞬間」の入力をクリア（必ずフレームの最後に行う）
        this.input.endFrame();
        
        // 次のフレーム
        requestAnimationFrame((time) => this.gameLoop(time));
    }
    
    start() {
        console.log('ゲーム開始！');
        this.running = true;
        this.lastTime = performance.now();
        this.gameLoop(this.lastTime);
    }
    
    stop() {
        this.running = false;
    }
    
    pause() {
        this.paused = !this.paused;
    }
    
    gameOver() {
        console.log('ゲームオーバー');
        this.paused = true;
        this.ui.showMessage('ゲームオーバー');
        
        // 3秒後にリスタート
        setTimeout(() => {
            this.restart();
        }, 3000);
    }
    
    restart() {
        console.log('リスタート');
        this.player = new Player(640, 360);
        this.player.unlockStarPower(3);
        this.enemySpawner.clear();
        this.magicSystem.clear();
        this.paused = false;
    }
}
