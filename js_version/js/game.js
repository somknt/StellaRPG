// ゲームメインクラス

class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.running = false;
        this.paused = false;
        // 画面：'title' / 'account' / 'profile' / 'main_menu' / 'account_info' / 'story' / 'battle_select' /
        //       'monster_select' / 'equip' / 'ranking' / 'settings'（screens.js）
        //       'playing'（バトル中）
        this.gameState = 'title';
        
        // 装備画面で決めた装備（魔法パレットなど。account.js の Account.loadout と同じ形）と、HUD に出すプレイヤー名
        // バトルを始める時に screens.js が入れる。setupArena で主人公に反映する（もう一度挑戦する時も同じ）
        this.loadout = null;
        this.playerName = '';
        
        // ゲームモード：'battle'（フリーバトル。今はこれだけ） / 'story'（今後追加）
        this.gameMode = 'battle';
        
        // バトル設定
        this.battleDifficulty = 'normal'; // 'easy', 'normal', 'hard'
        // バトルの舞台：'arena'（闘技場のウェーブバトル。標準） / 'field'（前の草原。URL に ?stage=field）
        const params = new URLSearchParams(window.location.search);
        this.battleStage = params.get('stage') === 'field' ? 'field' : 'arena';
        this.battleMode = null; // 闘技場のフリーバトル・ウェーブ進行（startArena で作る）
        this.bossBattle = null; // ボス戦の進行（startBossBattle で作る）
        this.activeBattle = null; // 今動いている方（battleMode か bossBattle）
        this.currentBossId = null;
        
        // 画面の揺れ
        this.shakeTime = 0;
        this.shakeDuration = 0;
        this.shakePower = 0;
        
        // ジャスト回避（成功すると0.5秒間、敵がスローになる。その間、敵は薄い水色になる）
        this.justDodgeDuration = 0.5;
        this.justDodgeSlowRate = 0.2;
        this.justDodgeGuardExtra = 0.2; // スローが終わってからも少しだけ無敵にする秒数
        this.justDodgeTimer = 0;
        
        // システム
        this.input = new InputManager();
        this.ui = new UIManager();
        this.characterSelect = new CharacterSelectScreen(); // 前のキャラ選択（今は主人公選択画面 screens.js を使う）
        this.screens = new ScreenManager(this);
        this.bindBattleButtons();
        
        // ゲームオブジェクト
        this.player = null;
        this.selectedGender = null;
        this.map = null;
        this.camera = null;
        this.magicSystem = new MagicSystem();
        this.damageNumbers = new DamageNumbers(); // 攻撃のダメージの数字（damage_numbers.js）
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
        
        // 前にログインしたアカウントへ自動でログイン（読み込みと同時に進める。タイトルで決定した時に待つ）
        if (window.Account) Account.init();
        
        // データ読み込み
        await this.loadGameData();
        
        // 画像読み込み
        await this.loadAssets();
        
        // 保存してある設定（音量・表示）を反映
        if (window.settings) window.settings.apply();
        
        console.log('初期化完了！');
        this.running = true;
        // 起動時はタイトル画面から開始
        this.screens.setScreen('title');
    }
    
    // 一時停止の画面のボタン（フリーバトルとボス戦で共通）
    bindBattleButtons() {
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
        };
        on('pause-btn', () => this.togglePause());
        on('pause-resume', () => this.togglePause(false));
        on('pause-retry', () => this.restartBattle());
        on('pause-select', () => this.leaveBattle(this.activeBattle === this.bossBattle ? 'monster_select' : 'equip'));
        on('pause-menu', () => this.leaveBattle('main_menu'));
    }
    
    // 画面を揺らす（設定で OFF にできる）
    addShake(power, time = 0.25) {
        if (window.settings && !window.settings.get('screenShake')) return;
        if (power >= this.shakePower * (this.shakeTime / Math.max(0.01, this.shakeDuration))) {
            this.shakePower = power;
            this.shakeTime = time;
            this.shakeDuration = time;
        }
    }
    
    startGame(gender) {
        document.body.dataset.hero = gender; // スマホのボタンのシルエットを主人公に合わせる
        if (this.battleStage === 'arena' && typeof ArenaMap === 'function') {
            this.startArena(gender);
            return;
        }
        console.log('ゲーム開始:', gender, '難易度:', this.battleDifficulty);
        this.selectedGender = gender;
        this.lockTarget = null;
        this.unlockFx = null;
        this.attackBuffer = 0;
        this.enemySpawner.autoSpawn = true;
        this.enemySpawner.map = null;
        document.body.dataset.mode = 'field';
        playBGM('bgm_field');
        
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
        
        // 魔術の残り火が燃える地面かどうかを調べるため、マップを渡しておく
        this.magicSystem.clear();
        this.damageNumbers.clear();
        this.magicSystem.setMap(this.map);
        
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
    
    // ---------- バトルモード：闘技場 ----------
    // プレイヤー・魔術・敵の処理はフィールドと同じ物を使う。違うのはマップ（壁の当たり判定あり）と、
    // 敵がウェーブで出てくること（BattleMode）
    startArena(gender) {
        console.log('バトルモード（闘技場・フリーバトル）開始:', gender);
        document.body.dataset.hero = gender;
        this.stopBattles();
        this.setupArena(gender);
        if (!this.battleMode) this.battleMode = new BattleMode(this);
        this.activeBattle = this.battleMode;
        this.battleMode.start(this.map);
        document.body.dataset.mode = 'arena';
        this.gameState = 'playing';
        playBGM('bgm_battle');
    }
    
    // ---------- バトルモード：ボス戦 ----------
    // モンスター選択・主人公選択で選んだボスと主人公で、ボスのフィールドで戦う
    startBossBattle(bossId, gender) {
        const def = getBossData(bossId);
        if (!def || def.status !== 'playable') {
            console.warn('このボスはまだ戦えません:', bossId);
            return;
        }
        console.log('ボス戦開始:', def.name, '主人公:', gender);
        document.body.dataset.hero = gender;
        this.stopBattles();
        this.currentBossId = bossId;
        // ボスのフィールド：'arena'（星の闘技場。巨大森イノシシ・黒蝕狼） / 'ruins'（古代星紋遺跡。魔道ゴーレム）
        this.setupArena(gender, def.field);
        // バトルモード：主人公のレベルはボスごとに固定（イノシシ Lv5・狼 Lv10・ゴーレム Lv15）。そのステータスで戦う
        if (def.playerLevel) {
            this.player.setLevel(def.playerLevel);
            this.player.levelLocked = true;
        }
        if (!this.bossBattle) this.bossBattle = new BossBattle(this);
        this.activeBattle = this.bossBattle;
        this.bossBattle.start(this.map, def);
        document.body.dataset.mode = 'arena';
        this.gameState = 'playing';
    }
    
    // 前のバトルの表示・状態を片付ける
    stopBattles() {
        this.justDodgeTimer = 0;
        Enemy.slowMotion = false;
        if (this.battleMode) this.battleMode.stop();
        if (this.bossBattle) this.bossBattle.stop();
        this.activeBattle = null;
        this.paused = false;
        if (window.soundManager) soundManager.setDuck(false);
        document.body.classList.remove('paused');
        this.shakeTime = 0;
    }
    
    // 闘技場・主人公・カメラの準備（フリーバトルとボス戦で共通）
    // 主人公は毎回作り直すので、HP・スタミナ・MP・クールダウン・状態はすべて最初に戻る
    // field：'arena'（星の闘技場） / 'ruins'（古代星紋遺跡）
    setupArena(gender, field = 'arena') {
        this.selectedGender = gender;
        this.paused = false;
        this.lockTarget = null; // ターゲット（前のバトルの敵は忘れる）
        this.unlockFx = null;
        this.attackBuffer = 0;
        document.body.classList.remove('paused');
        
        this.map = field === 'ruins' && typeof RuinsMap === 'function'
            ? new RuinsMap(createRuinsMapData())
            : new ArenaMap(createArenaMapData());
        document.body.dataset.field = field;
        const spawn = this.map.getPlayerSpawn();
        this.player = new Player(spawn.x, spawn.y, gender);
        this.player.map = this.map;          // 壁をすり抜けない
        this.player.direction = 'up';        // 闘技場の中央（北の門）を向いて始まる
        this.player.unlockStarPower(3);
        this.player.setMoveMode(this.getMoveModeForMap(this.map.mapData));
        this.applyLoadout(this.player);
        this.justDodgeTimer = 0;
        
        this.magicSystem.clear();
        
        this.damageNumbers.clear();
        this.magicSystem.setMap(this.map);
        
        this.enemySpawner.setDifficulty(this.battleDifficulty);
        this.enemySpawner.clear();
        this.enemySpawner.autoSpawn = false; // 敵はウェーブで出す
        this.enemySpawner.map = this.map;
        
        this.camera = new Camera(0, 0, this.canvas.width, this.canvas.height);
        this.camera.follow(this.player);
        this.camera.setBounds(this.map.width * this.map.tileSize, this.map.height * this.map.tileSize);
        this.camera.snapToTarget();
        this.input.resetAll();
    }
    
    // 装備画面で決めた魔法パレットを主人公にセットする（装備がない時は、主人公の最初の5つのまま）
    // バトルモードの剣はナイフだけ・防具と盾はなしなので、ステータスは変えない
    applyLoadout(p) {
        const l = this.loadout;
        if (!p || !l || !Array.isArray(l.magic)) return;
        for (let i = 0; i < Player.MAGIC_SLOT_COUNT; i++) {
            const id = l.magic[i];
            p.setMagicSlot(i, id && p.getMagicData(id) ? id : null);
        }
        // 最初に選んでいる魔法：いちばん上（スロット1）から見て、最初にセットしてある魔法
        const first = p.magicSlots.findIndex(Boolean);
        p.selectedMagicIndex = first >= 0 ? first : 0;
    }
    
    isArena() {
        return this.gameState === 'playing' && typeof ArenaMap === 'function' && this.map instanceof ArenaMap;
    }
    
    // 一時停止（force：true=止める / false=再開 / 省略=切り替え）
    togglePause(force) {
        const b = this.activeBattle;
        if (!this.isArena() || !b || b.isOver || b.isFrozen) return;
        const was = this.paused;
        this.paused = force === undefined ? !this.paused : !!force;
        document.body.classList.toggle('paused', this.paused);
        if (was !== this.paused) playSE('ui_pause');
        if (window.soundManager) soundManager.setDuck(this.paused); // 止めている間は BGM を小さく
        if (this.paused) {
            // 「選択へ」のボタン：ボス戦はモンスター選択、フリーバトル（?mode=free）は装備画面へ戻る
            const sel = document.getElementById('pause-select');
            if (sel) sel.textContent = b === this.bossBattle ? 'モンスター選択へ' : '装備画面へ';
            b.showPause();
            this.pauseNav = new UINav(document.querySelector('#battle-pause .battle-panel'), 'vertical');
        } else {
            b.hidePause();
            this.pauseNav = null;
        }
        this.input.resetAll(); // 止めた時に押していたキーが押しっぱなしにならないように
    }
    
    // もう一度挑戦（同じ主人公・同じボスで最初から。HP・ボスのHP・フェーズ・クールダウンなどはすべて初期化）
    restartBattle() {
        const gender = this.selectedGender || 'male';
        const boss = this.activeBattle === this.bossBattle ? this.currentBossId : null;
        this.screens.transition(() => {
            if (boss) this.startBossBattle(boss, gender);
            else this.startArena(gender);
        });
    }
    
    // バトルをやめて、メニューの画面へ戻る（'monster_select' / 'main_menu' / 'equip'）
    leaveBattle(target = 'main_menu') {
        this.screens.transition(() => {
            this.stopBattles();
            this.enemySpawner.clear();
            this.magicSystem.clear();
            this.damageNumbers.clear();
            document.body.dataset.mode = '';
            document.body.dataset.waves = '';
            this.screens.setScreen(target);
        });
    }
    
    // 前のキャラクター選択に戻る処理（今は装備画面へ。主人公はプレイヤー登録で決める）
    backToCharacterSelect() {
        this.leaveBattle('equip');
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
            window.gameData.allEnemies = enemyData.enemies; // 闘技場のウェーブで使う（狼・猪など）
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
        
        // タイトル・メニュー・選択画面
        if (this.screens.isMenuState(this.gameState)) {
            this.screens.update(deltaTime, this.input);
            return;
        }
        
        // 画面の揺れ
        if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - deltaTime);
        
        // 闘技場：Esc / P で一時停止。勝敗が出たら結果画面の操作
        const battle = this.activeBattle;
        if (this.isArena() && battle && !this.screens.busy) {
            const justClosedPalette = performance.now() - (this.input.paletteClosedAt || 0) < 200;
            if ((this.input.isKeyPressed('Escape') && !justClosedPalette) || this.input.isKeyPressed('KeyP')) {
                if (!this.input.paletteOpen) this.togglePause();
            } else if (this.paused && this.pauseNav) {
                this.pauseNav.handle(this.input);
            }
            if (battle.isOver && document.body.classList.contains('battle-result-open')) {
                if (battle.handleResultKeys) battle.handleResultKeys(this.input);
                else if (this.input.isKeyPressed('Enter') || this.input.isKeyPressed('KeyR')) this.restartBattle();
                return;
            }
        }
        
        if (this.paused) return;
        
        
        // キャラクター選択中（前の画面。今は使っていない）
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
        
        const arena = this.isArena();
        
        // ボス戦の開始演出・カウントダウン中：だれも動かない（Enter・クリック・タップで演出を飛ばせる）
        if (arena && battle && battle.isFrozen) {
            if ((this.input.isKeyPressed('Enter') || this.input.isMouseClicked) && battle.skipIntro) battle.skipIntro();
            this.enemySpawner.update(deltaTime, this.player, window.gameData.enemies);
            battle.update(deltaTime);
            this.camera.update(deltaTime);
            this.ui.updatePlayerStats(this.player);
            this.ui.updateDebugInfo(this.fps, this.player, this.enemySpawner.enemies.length);
            return;
        }
        
        // 闘技場で勝敗が決まった後：操作は止めて、残りの演出（倒れた敵の星など）だけ動かす
        if (arena && battle && battle.isOver) {
            this.justDodgeTimer = 0;
            Enemy.slowMotion = false;
            this.magicSystem.update(deltaTime);
            this.damageNumbers.update(deltaTime);
            this.enemySpawner.update(deltaTime, this.player, window.gameData.enemies);
            battle.update(deltaTime);
            this.camera.update(deltaTime);
            return;
        }
        
        // 近接攻撃の向き：ターゲット（PC のクリック・スマホのタップ）はいつも、それ以外は攻撃している間だけ、敵の方を向く
        this.updateLockTarget(deltaTime);
        // 連打：攻撃の間隔より速く押した分は少しの間（Game.ATTACK_BUFFER 秒）覚えておき、間隔が空いたらすぐ斬る
        if (this.attackBuffer > 0) this.attackBuffer = Math.max(0, this.attackBuffer - deltaTime);
        const attackPressed = this.input.isAttackPressed();
        if (attackPressed) this.attackBuffer = Game.ATTACK_BUFFER;
        // 続けて攻撃に当たって近接攻撃がキャンセルされた：それより前に押していた分は捨てる
        if (this.player.attackCancelled) {
            this.player.attackCancelled = false;
            if (!attackPressed) this.attackBuffer = 0;
        }
        const attackInput = attackPressed || this.attackBuffer > 0 || this.input.isAttackHeld() || this.input.isAttackSliding();
        const meleeMode = attackInput || this.player.attackAnimTimer > 0 || this.player.attackTimer > 0;
        this.player.faceTarget = this.getLockTarget() || (meleeMode ? this.getMeleeTarget(this.getAimDirection()) : null);
        
        // プレイヤー更新（動く前の位置を覚えておく：敵の体から押し出す向きに使う）
        const prevPlayerPos = this.player.position.clone();
        this.player.update(deltaTime, this.input);
        
        // 魔法：ボタンで詠唱開始 → 頭上のゲージが満タンになったら発動
        if (this.input.isMagicPressed()) {
            this.player.startChant();
        }
        // ねらう向き（スマホ：ボタンを押したままスライド / PC：マウスカーソル）。なければ近くの敵を自動でねらう
        const aim = this.getAimDirection();
        
        // 魔法のねらい（詠唱中は毎フレーム決め直して、撃つ向き・落とす場所を地面に出す）
        //   砲弾系（弾・竜巻）：向き / その場系（雷）：落とす場所
        //   普通に押しただけ → 自動で敵をねらう / スマホで長押ししてスライド・PC のカーソル → その向き・場所
        const chantMagic = this.player.isChanting ? this.player.chantMagic : this.player.readyCast;
        // PC：魔法キー（Q）を長押しした時だけ、マウスカーソルでねらう（1回押しは自動で敵をねらう）
        //     一度長押ししたら、その魔法を撃つまでカーソルでねらう（途中で離してもよい）
        if (!chantMagic) this.castManual = false;
        else if (!this.castManual && this.input.mouseAim && this.input.heldFor('KeyQ') >= Game.TARGET_HOLD_MS) this.castManual = true;
        this.castAim = chantMagic ? this.computeCastAim(chantMagic) : null;
        if (!chantMagic) this.castAnchor = null;
        // 詠唱中は、ねらっている方を向く（手の前の魔法陣も、その向きに出る）
        if (this.castAim && this.player.isChanting) {
            this.player.aimVector = this.castAim.dir.clone();
            this.player.setDirectionFromVector(this.castAim.dir);
        }
        
        const cast = this.player.consumeReadyCast(this.enemySpawner.enemies, this.castAim ? this.castAim.dir : aim, !!this.castAim);
        if (cast && cast.magic.category === '治癒') {
            this.castHeal(cast);
            this.input.clearTouchAim('magic');
            this.castAim = null;
            this.castAnchor = null;
        } else if (cast) {
            this.magicSystem.castMagic(cast.magic, cast.position, cast.direction, cast.circlePos,
                this.enemySpawner.enemies, cast.circleShape, cast.circleRadius, this.castAim && this.castAim.target);
            // 発動の音（雷は落ちた瞬間に magic.js で鳴らす）
            if (cast.magic.shape !== 'strike') playSE(`magic_${getElementInfo(cast.magic.element).key}`);
            this.input.clearTouchAim('magic');
            this.castAim = null;
            this.castAnchor = null;
        } else if (!this.player.isChanting) {
            this.input.clearTouchAim('magic'); // 詠唱していない（MP 不足などで始まらなかった）なら、覚えた向きは使わない
        }
        
        // プレイヤーの近接攻撃（ナイフ）：敵の方へ向き直って斬る（ターゲット → ねらった向きの敵 → 近くの敵。いなければねらう向き）
        // 連打でも、押したまま（マウスの左ボタン・Space・スマホの攻撃ボタン）でも、攻撃の間隔ごとに続けて斬る
        if (attackInput) {
            const attackData = this.player.startAttack(this.enemySpawner.enemies, aim, this.getMeleeTarget(aim));
            if (attackData) {
                this.attackBuffer = 0;
                const hits = this.enemySpawner.checkMeleeAttack(attackData);
                if (hits.some(h => h.damage > 0)) playSE('attack_hit');
                for (const hit of hits) {
                    this.damageNumbers.add(hit.damage, hit.enemy); // ナイフは属性なし（白）
                    if (!hit.enemy.isAlive()) {
                        const drops = hit.enemy.getDrops();
                        this.player.gainExp(drops.exp);
                        if (!hit.enemy.isBoss) playSE('enemy_defeat');
                    }
                }
            }
        }
        
        // 魔法システム更新
        this.magicSystem.update(deltaTime);
        this.damageNumbers.update(deltaTime);
        
        // 魔法と敵の衝突
        const magicHits = this.magicSystem.checkCollisions(this.enemySpawner.enemies);
        for (const hit of magicHits) {
            // 魔法のダメージ倍率（Player.MAGIC_DAMAGE_MUL）。星力段階4ならさらに1.2倍
            // 属性の相性：ボスの有利属性は 1.5倍、不利属性は 0.5倍（boss_data.js の elements）
            const element = hit.projectile && hit.projectile.magic && hit.projectile.magic.element;
            const affinity = this.getElementAffinity(hit.enemy, element);
            const damage = Math.round(hit.damage * Player.MAGIC_DAMAGE_MUL * (this.player.starPowerStage >= 4 ? 1.2 : 1) * Game.ELEMENT_MUL[affinity]);
            
            // 残り火・竜巻の継続ダメージは「続けて当たった回数」に数えない
            // 水・土の魔法は、続けて当たってノックバックする時に大きく飛ばす（Enemy.STAGGER）
            const res = hit.enemy.takeDamage(damage, hit.direction, !hit.noStagger, 'magic', hit.knockback || 0);
            // 当たった時の光の色：有利属性は赤・不利属性は青（ふつうは白のまま。文字は出さない）
            if (affinity !== 'normal' && res && res.damage > 0) {
                hit.enemy.hitFlashColor = Game.AFFINITY_FLASH[affinity];
                hit.enemy.hitFlashTimer = Math.max(hit.enemy.hitFlashTimer, Game.AFFINITY_FLASH_TIME);
            }
            // 当たった音：弾・竜巻は属性ごと（残り火の小さなダメージと、雷は鳴らさない。雷は落ちた時に鳴る）
            // 有利・不利の属性で当たった時は、もう1つ音を重ねる
            if (res && res.damage > 0) {
                const p = hit.projectile;
                const isStrike = typeof LightningStrike === 'function' && p instanceof LightningStrike;
                // ダメージの数字：有利属性は赤・不利属性は青・それ以外は魔法の属性の色。残り火・竜巻の続けて当たる分は小さく
                const tick = hit.burn || (typeof Tornado === 'function' && p instanceof Tornado);
                this.damageNumbers.add(res.damage, hit.enemy, { affinity, element, tick });
                if (!hit.burn && !isStrike && element) playSE(`magic_${getElementInfo(element).key}_hit`);
                if (affinity === 'weak') playSE('magic_weak');
                else if (affinity === 'resist') playSE('magic_resist');
            }
            if (!hit.enemy.isAlive()) {
                const drops = hit.enemy.getDrops();
                this.player.gainExp(drops.exp);
                if (!hit.enemy.isBoss && res && res.damage > 0) playSE('enemy_defeat');
            }
        }
        
        // ジャスト回避の時間：敵の動きが0.5秒スローになる
        if (this.justDodgeTimer > 0) {
            this.justDodgeTimer -= deltaTime;
        }
        Enemy.slowMotion = this.justDodgeTimer > 0;
        const enemyDeltaTime = this.justDodgeTimer > 0 ? deltaTime * this.justDodgeSlowRate : deltaTime;
        
        // 敵更新
        this.enemySpawner.update(enemyDeltaTime, this.player, window.gameData.enemies);
        
        // 敵の体はすり抜けられない（主人公を来た側へ押し出す）
        this.enemySpawner.resolveBodyCollisions(this.player, prevPlayerPos);
        
        // 敵の攻撃
        this.enemySpawner.checkEnemyAttacks(this.player);
        
        // 回避中に攻撃を避けていたらジャスト回避発動
        // スロー中にもう一度ジャスト回避が決まったら、スローと無敵をそこから延ばす（連続でできる）
        // 無敵はスローより少し長くして、スローが終わった瞬間に残っている攻撃に当たらないようにする
        if (this.player.consumeJustDodge()) {
            playSE('just_dodge');
            this.justDodgeTimer = this.justDodgeDuration;
            this.player.onJustDodge(this.justDodgeDuration + this.justDodgeGuardExtra);
            Enemy.slowMotion = true;
        }
        
        // カメラ更新
        this.camera.update(deltaTime);
        
        // UI更新
        this.ui.updatePlayerStats(this.player);
        this.ui.updateDebugInfo(this.fps, this.player, this.enemySpawner.enemies.length);
        
        // 闘技場：ウェーブの進行（敵を出す・撃破数・次のウェーブ・勝利）
        if (arena && battle) battle.update(deltaTime);
        
        // ゲームオーバー（闘技場は敗北の画面を出す）
        if (this.player.isDead()) {
            if (arena && battle) battle.onDefeat();
            else this.gameOver();
        }
    }
    
    draw() {
        // 画面クリア
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        
        // タイトル・メニュー・選択画面
        if (this.screens.isMenuState(this.gameState)) {
            this.screens.draw(this.ctx);
            return;
        }
        
        // キャラクター選択画面（前の画面）
        if (this.gameState === 'character_select') {
            this.characterSelect.draw(this.ctx);
            return;
        }
        
        // ゲームプレイ画面
        if (this.gameState !== 'playing') return;
        
        // 画面の揺れ：世界だけずらす（ボタンや HP の表示は揺らさない）
        this.ctx.save();
        if (this.shakeTime > 0) {
            const k = this.shakePower * (this.shakeTime / this.shakeDuration);
            this.ctx.translate(Math.round((Math.random() - 0.5) * k * 2), Math.round((Math.random() - 0.5) * k * 2));
        }
        this.drawWorld();
        this.ctx.restore();
        
        // 画面全体に重ねる演出（ボス戦の色味・フェーズ移行の光）
        if (this.isArena() && this.activeBattle && this.activeBattle.drawScreen) this.activeBattle.drawScreen(this.ctx);
    }
    
    drawWorld() {
        // マップ描画
        this.map.draw(this.ctx, this.camera.position);
        
        // 地面に残る魔術（ファイヤーボールの残り火）：キャラや敵の下に描く
        this.magicSystem.drawGround(this.ctx, this.camera.position);
        
        // 闘技場：樽・柵・屋台などとキャラを、足元が奥の物から順に描く（物の後ろに回り込めるように）
        if (this.isArena()) {
            const cam = this.camera.position;
            // ボスの攻撃の予告範囲・衝撃波など（地面）
            if (this.activeBattle && this.activeBattle.drawGround) this.activeBattle.drawGround(this.ctx, cam);
            // 詠唱中の魔法のねらい（通り道・届く所・落とす場所）。地面に描く
            this.drawCastAim(this.ctx, cam);
            // ターゲット（ロックオン）の足元の照準
            this.drawLockTarget(this.ctx, cam, false);
            const items = this.map.getDepthDrawables(this.player);
            for (const e of this.enemySpawner.enemies) {
                items.push({ sortY: e.position.y + e.size * 0.55, draw: (ctx, c) => e.draw(ctx, c) });
            }
            items.push({ sortY: this.player.position.y + this.player.drawSize * 0.4, draw: (ctx, c) => this.player.draw(ctx, c) });
            items.sort((a, b) => a.sortY - b.sortY);
            for (const it of items) it.draw(this.ctx, cam);
            
            if (this.activeBattle) this.activeBattle.drawWorld(this.ctx, cam); // 敵の出現・ボスの攻撃の演出
            this.enemySpawner.drawEffects(this.ctx, cam);       // 倒れた敵の星・敵の光弾
            this.magicSystem.draw(this.ctx, cam);               // 魔術
            this.drawAim(this.ctx, cam);                        // 攻撃ボタンのスライドの向き
            this.drawLockTarget(this.ctx, cam, true);           // ターゲット（ロックオン）の体を囲むかぎ
            this.map.drawAbove(this.ctx, cam);                  // 入口のアーチ（キャラより手前）
            this.damageNumbers.draw(this.ctx, cam);             // ダメージの数字（いちばん手前）
            if (window.showCollision) this.map.drawCollisionDebug(this.ctx, cam);
            return;
        }
        
        // 敵描画
        this.enemySpawner.draw(this.ctx, this.camera.position);
        
        // プレイヤー描画
        this.player.draw(this.ctx, this.camera.position);
        
        // 魔法エフェクト描画
        this.magicSystem.draw(this.ctx, this.camera.position);
        this.damageNumbers.draw(this.ctx, this.camera.position);
        
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
        this.damageNumbers.clear();
        this.paused = false;
    }
    
    // ---------- 属性の相性 ----------
    // 'weak'（有利属性：よく効く） / 'resist'（不利属性：効きにくい） / 'normal'
    getElementAffinity(enemy, element) {
        const el = enemy && enemy.ai && enemy.ai.def && enemy.ai.def.elements;
        if (!el || !element) return 'normal';
        if (el.weak && el.weak.includes(element)) return 'weak';
        if (el.resist && el.resist.includes(element)) return 'resist';
        return 'normal';
    }
    
    // ---------- ターゲット（ロックオン） ----------
    // ターゲットにした敵の方を主人公はいつも向き、近接攻撃・魔法もその敵をねらう
    //   PC：敵を左クリック → ターゲット（クリックはそのまま攻撃にもなる。ターゲットの敵をクリックしても外れない）
    //       ホイールのクリック（敵の上）・F キー → 切りかえ（ターゲットがいれば解除。いなければカーソルの下か近くの敵）
    //   スマホ：画面で敵をタップ → ターゲット。同じ敵をもう一度タップ → 解除
    // ターゲットは、その敵が倒れるか、解除するか、別の敵を選ぶまで続く
    updateLockTarget(dt) {
        const t = this.lockTarget;
        if (t && (!t.isAlive() || t.dying || !this.enemySpawner.enemies.includes(t))) this.setLockTarget(null, false);
        if (this.lockFlash > 0) this.lockFlash = Math.max(0, this.lockFlash - dt);
        if (this.unlockFx) {
            this.unlockFx.t += dt;
            if (this.unlockFx.t >= Game.UNLOCK_FX_TIME) this.unlockFx = null;
        }
        const inp = this.input;
        if (inp.paletteOpen) return;
        const under = () => this.enemyAt(this.camera.screenToWorld(inp.mousePos));
        if (inp.screenTapped || inp.isMiddleClicked) {
            const e = under();
            if (e) this.setLockTarget(e === this.lockTarget ? null : e);
        } else if (inp.isKeyPressed('KeyF')) {
            if (this.lockTarget) this.setLockTarget(null);
            else {
                const e = (inp.mouseAim && under()) || this.nearestEnemy(Game.AUTO_AIM_RANGE);
                if (e) this.setLockTarget(e);
            }
        } else if (inp.isLeftMouseClicked && inp.mouseAim) {
            const e = under();
            if (e && e !== this.lockTarget) this.setLockTarget(e);
        }
    }
    
    // ターゲットを決める（null で解除）。sound = false：敵が倒れて外れた時など（音と消える演出なし）
    setLockTarget(e, sound = true) {
        const prev = this.lockTarget;
        if (e === prev) return;
        this.lockTarget = e;
        if (e) {
            this.lockFlash = Game.LOCK_SNAP_TIME;
            this.unlockFx = null;
            if (sound) playSE('target_lock');
        } else if (prev && sound) {
            this.unlockFx = { enemy: prev, t: 0 };
            playSE('target_unlock');
        }
    }
    
    // 主人公にいちばん近い敵（range 以内。いなければ null）
    nearestEnemy(range) {
        const p = this.player;
        let best = null, bd = Infinity;
        for (const e of this.enemySpawner.enemies) {
            if (!e.isAlive() || e.dying) continue;
            const d = e.position.distance(p.position);
            if (d <= range && d < bd) { bd = d; best = e; }
        }
        return best;
    }
    
    // 今のターゲット（倒れた敵は null）
    getLockTarget() {
        const t = this.lockTarget;
        return t && t.isAlive() && !t.dying ? t : null;
    }
    
    // その場所（ワールド座標）にいる敵（体の絵の上。重なっていたら中心に近い方）
    enemyAt(world) {
        let best = null, bd = Infinity;
        for (const e of this.enemySpawner.enemies) {
            if (!e.isAlive() || e.dying) continue;
            const rx = Math.max(28, e.size * 0.62), ry = Math.max(32, e.size * 0.72);
            const dx = (world.x - e.position.x) / rx, dy = (world.y - (e.position.y - e.size * 0.1)) / ry;
            const d = dx * dx + dy * dy;
            if (d <= 1 && d < bd) { bd = d; best = e; }
        }
        return best;
    }
    
    // 近接攻撃で向く敵：ターゲット → ねらった向き（カーソル・スライド）の近くの敵 → いちばん近い敵（Game.MELEE_FACE_RANGE 以内）
    getMeleeTarget(aim) {
        const t = this.getLockTarget();
        if (t) return t;
        const p = this.player, range = Game.MELEE_FACE_RANGE;
        const enemies = this.enemySpawner.enemies.filter(e => e.isAlive() && !e.dying);
        if (aim) {
            const a = p.pickAimTarget(enemies, aim, range, 0.5);
            if (a) return a;
        }
        return this.nearestEnemy(range);
    }
    
    // ターゲットの印（ロックオン）
    //   above = false（地面）：足元で回る照準の輪
    //   above = true（キャラより手前）：体を囲む4つのかぎ（決めた瞬間は外から閉じてくる）と「LOCK」の札
    //   解除した時は、かぎが外へ広がって消える
    drawLockTarget(ctx, cam, above) {
        const time = performance.now() / 1000;
        const e = this.getLockTarget();
        ctx.save();
        if (e) {
            const k = (this.lockFlash || 0) / Game.LOCK_SNAP_TIME; // 1 → 0（決めた瞬間の動き）
            if (above) this.drawLockBrackets(ctx, e.position.sub(cam), e, 1 + 0.75 * k, 1 - 0.6 * k, k * 0.8, time, true);
            else this.drawLockReticle(ctx, e.position.sub(cam), e, 1 + 0.6 * k, 1 - 0.5 * k, time);
        }
        const u = this.unlockFx;
        if (above && u && u.enemy && (u.enemy.isAlive() || u.enemy.dying)) {
            const q = u.t / Game.UNLOCK_FX_TIME; // 0 → 1
            this.drawLockBrackets(ctx, u.enemy.position.sub(cam), u.enemy, 1 + 0.6 * q, 1 - q, 0, time, false);
        }
        ctx.restore();
    }
    
    // 体を囲むかぎ（s：敵の画面の位置 / scale：大きさ / alpha：濃さ / spin：回転 / label：「LOCK」の札）
    drawLockBrackets(ctx, s, e, scale, alpha, spin, time, label) {
        if (alpha <= 0) return;
        const lift = (e.ai ? e.ai.lift : 0) + (e.getHopOffset ? e.getHopOffset() : 0);
        const cx = s.x, cy = s.y - e.size * 0.05 - lift;
        const breathe = 1 + 0.03 * Math.sin(time * 5);
        const hw = Math.max(30, e.size * 0.68) * scale * breathe, hh = Math.max(32, e.size * 0.6) * scale * breathe;
        const L = Math.min(hw, hh) * 0.42;
        const C = Game.LOCK_COLOR;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        if (spin) ctx.rotate(spin);
        ctx.lineCap = 'square';
        ctx.lineJoin = 'miter';
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        const path = () => {
            ctx.beginPath();
            for (const [sx, sy] of corners) {
                const x = sx * hw, y = sy * hh;
                ctx.moveTo(x, y - sy * L); ctx.lineTo(x, y); ctx.lineTo(x - sx * L, y);
            }
        };
        // 下に濃いふち（明るい地面でも見えるように）→ 色の線 → 細い白い芯
        ctx.strokeStyle = Game.LOCK_DARK; ctx.lineWidth = 8; path(); ctx.stroke();
        ctx.shadowColor = C; ctx.shadowBlur = 10;
        ctx.strokeStyle = C; ctx.lineWidth = 4.5; path(); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = Game.LOCK_LIGHT; ctx.lineWidth = 1.5; path(); ctx.stroke();
        // 上下左右のまん中に小さな目盛り（照準らしく）
        ctx.fillStyle = C;
        for (const [x, y, w, h] of [[-3, -hh - 2, 6, 9], [-3, hh - 7, 6, 9], [-hw - 2, -3, 9, 6], [hw - 7, -3, 9, 6]]) {
            ctx.fillRect(x, y, w, h);
        }
        ctx.restore();
        if (!label) return;
        // 右上の「LOCK」の札
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 13px "DotGothic16", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const tx = Math.round(cx + hw - L * 0.9), ty = Math.round(cy - hh - 14);
        const w = ctx.measureText('LOCK').width + 10;
        ctx.fillStyle = Game.LOCK_DARK; ctx.fillRect(tx - 1, ty - 9, w + 2, 18);
        ctx.fillStyle = C; ctx.fillRect(tx, ty - 8, w, 16);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('LOCK', tx + 5, ty + 1);
        ctx.restore();
    }
    
    // 足元で回る照準の輪（4つに切れた輪と、内向きの三角）
    drawLockReticle(ctx, s, e, scale, alpha, time) {
        const rx = Math.max(34, e.size * 0.6) * scale, ry = rx * 0.42;
        const fy = s.y + e.size * 0.45;
        const C = Game.LOCK_COLOR;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(s.x, fy);
        ctx.scale(1, ry / rx);
        const rot = time * 1.4;
        const seg = () => {
            ctx.beginPath();
            for (let i = 0; i < 4; i++) {
                const a0 = rot + i * Math.PI / 2 + 0.22, a1 = a0 + Math.PI / 2 - 0.44;
                ctx.moveTo(Math.cos(a0) * rx, Math.sin(a0) * rx);
                ctx.arc(0, 0, rx, a0, a1);
            }
        };
        ctx.strokeStyle = Game.LOCK_DARK; ctx.lineWidth = 7; seg(); ctx.stroke();
        ctx.strokeStyle = C; ctx.lineWidth = 3.5; seg(); ctx.stroke();
        // 内向きの三角（輪と逆向きに回る）
        ctx.fillStyle = C;
        ctx.strokeStyle = Game.LOCK_DARK;
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
            const a = -time * 0.9 + i * Math.PI / 2 + Math.PI / 4;
            const c = Math.cos(a), sn = Math.sin(a), r0 = rx * 1.2, r1 = rx * 0.98;
            ctx.beginPath();
            ctx.moveTo(c * r1, sn * r1);
            ctx.lineTo(c * r0 - sn * 9, sn * r0 + c * 9);
            ctx.lineTo(c * r0 + sn * 9, sn * r0 - c * 9);
            ctx.closePath();
            ctx.stroke();
            ctx.fill();
        }
        ctx.restore();
    }
    
    // ---------- ねらう向き ----------
    // スマホ：攻撃・魔法ボタンを押したまま指をスライドした向き / PC：マウスカーソルの方向
    // どちらもない時は null（今までどおり近くの敵を自動でねらう）
    getAimDirection() {
        if (!this.player || !this.camera) return null;
        const v = this.input.getAimVector(this.player.position.sub(this.camera.position));
        return v && v.length() > 0.01 ? v.normalize() : null;
    }
    
    // ---------- 魔法のねらい ----------
    // 砲弾系（ファイヤーボール・ウォーターボール・ストーンキャノン・テンペスト）は「向き」、
    // その場系（ライトニング）は「落とす場所」を決める。詠唱中は毎フレーム呼ぶ
    // 1回押し → 自動：ターゲット（ロックオン）の敵、いなければいちばん近い敵をねらう（主人公はその敵の方を向いたまま詠唱する）
    // 長押し → 自分で決める
    //   スマホ：押したままスライド（砲弾系）→ その向き / 長押し（その場系）→ ターゲットカーソル（スライドで動かす）
    //   PC：Q を長押し → マウスカーソルの方向・場所（敵の近くなら敵に吸いつく）
    // 戻り値：{ kind: 'shot'|'target', dir, target, manual, reach, end, radius, range }
    // ヒール（治癒魔法）：最大 HP の magic.heal（30%）だけ回復。緑の「+数字」と、足元の魔法陣・立ちのぼる光
    castHeal(cast) {
        const p = this.player, magic = cast.magic;
        const healed = p.heal(Math.max(1, Math.round(p.maxHP * (magic.heal || 0.3))), true);
        this.magicSystem.addHeal(p);
        this.damageNumbers.add(healed, { position: p.position, size: p.drawSize }, { heal: true });
        if (!playSE('magic_heal') && window.soundManager && soundManager.playHealChime) soundManager.playHealChime();
    }
    
    computeCastAim(magic) {
        // 自分にかける魔法（ヒール）は、ねらう向きも場所もない
        if (magic.shape === 'self') return null;
        const p = this.player;
        const enemies = this.enemySpawner.enemies.filter(e => e.isAlive() && !e.dying);
        const M = window.MAGIC_SIZE_MUL || 1;
        const t = this.input.touchAim;
        const now = performance.now();
        const touchSlide = t.source === 'magic' && (t.active || now < t.until) && Math.hypot(t.x, t.y) > 0.01;
        const touchHold = t.source === 'magic' && t.held && now - t.since >= Game.TARGET_HOLD_MS;
        const mouse = this.input.mouseAim && this.castManual && !(t.source === 'magic' && (t.held || touchSlide));
        // 自動でねらう敵：ターゲット（ロックオン）を先に。いなければ range 以内のいちばん近い敵
        const locked = this.getLockTarget();
        const nearest = (range) => locked || this.nearestEnemy(range);
        const facing = p.aimVector && p.aimVector.length() > 0.01 ? p.aimVector.normalize() : p.directionToVector(p.direction);
        
        if (magic.shape === 'strike') {
            // ---- その場系：落とす場所 ----
            const range = magic.range || 380;
            let target, manual = false, lock = null;
            if (mouse) {
                target = this.camera.screenToWorld(this.input.mousePos);
                manual = true;
            } else if (touchHold || touchSlide) {
                // 長押しでターゲットカーソルを出す（最初は自動でねらった所）。スライドで動かす
                if (!this.castAnchor) {
                    const e = nearest(range);
                    this.castAnchor = e ? e.position.clone() : p.position.add(facing.mult(range * 0.6));
                }
                const gain = Game.TARGET_SLIDE_GAIN / Math.max(0.3, (window.TouchControls && TouchControls.scale) || 1);
                target = this.castAnchor.add(new Vector2(t.x, t.y).mult(gain));
                manual = true;
            } else {
                const e = nearest(range);
                lock = e;
                target = e ? e.position.clone() : p.position.add(facing.mult(range * 0.6));
            }
            // 届く距離まで
            let v = target.sub(p.position);
            if (v.length() > range) { v = v.normalize().mult(range); target = p.position.add(v); }
            // カーソルが敵の近くなら、その敵に吸いつける
            if (manual) {
                for (const e of enemies) {
                    if (e.position.distance(target) <= e.size * 0.6 + 30 && e.position.distance(p.position) <= range + e.size * 0.5) { lock = e; target = e.position.clone(); break; }
                }
            }
            const dir = target.sub(p.position);
            return { kind: 'target', target, lock, manual, range, radius: (magic.radius || 45) * M,
                dir: dir.length() > 0.01 ? dir.normalize() : facing };
        }
        
        // ---- 砲弾系：向き ----
        let dir = null, manual = false, lock = null;
        if (touchSlide) { dir = new Vector2(t.x, t.y).normalize(); manual = true; }
        else if (mouse) {
            const v = this.input.mousePos.sub(p.position.sub(this.camera.position));
            if (v.length() > 8) { dir = v.normalize(); manual = true; }
        }
        const reachMax = magic.shape === 'tornado' ? (magic.travel || 110) : (magic.range || 400);
        if (manual) {
            // ねらった向きの近く（約30度以内）に敵がいれば、その敵に吸いつける
            lock = p.pickAimTarget(enemies, dir, reachMax + 140, Player.AIM_ASSIST_DOT);
        } else {
            // 何も指定していない：いちばん近い敵の方向へ（いなければ向いている方向）
            lock = nearest(Game.AUTO_AIM_RANGE);
        }
        if (lock) dir = lock.position.sub(p.position).normalize();
        if (!dir) dir = facing;
        // どこまで届くか（壁・柱に当たる所で止める）
        const from = p.position;
        let reach = reachMax;
        if (this.map && this.map.isShotBlocked) {
            for (let d = 16; d <= reachMax; d += 8) {
                if (this.map.isShotBlocked(from.add(dir.mult(d)))) { reach = Math.max(0, d - 8); break; }
            }
        }
        const radius = magic.shape === 'tornado' ? (magic.radius || 30) * M : (magic.size || 16) * M;
        return { kind: 'shot', dir, lock, manual, reach, end: from.add(dir.mult(reach)), radius, tornado: magic.shape === 'tornado' };
    }
    
    // 詠唱中：撃つ向き・届く所（砲弾系）、落とす場所（その場系）を地面に出す
    drawCastAim(ctx, cam) {
        const a = this.castAim, p = this.player;
        if (!a || !p || !p.isChanting || !p.chantMagic) return;
        const info = window.getElementInfo ? window.getElementInfo(p.chantMagic.element) : { color: '#ffffff', light: '#ffffff' };
        const time = performance.now() / 1000;
        const prog = p.getChantProgress();
        ctx.save();
        if (a.kind === 'shot') {
            const s = p.position.sub(cam), e = a.end.sub(cam);
            const ang = Math.atan2(a.dir.y, a.dir.x);
            const len = a.reach;
            const w = a.radius * 1.1;
            ctx.translate(s.x, s.y + 8);
            ctx.rotate(ang);
            // 通り道（うすい帯）。詠唱がたまるほど濃くなる
            const g = ctx.createLinearGradient(0, 0, len, 0);
            g.addColorStop(0, info.color + '00');
            g.addColorStop(0.15, info.color + '77');
            g.addColorStop(1, info.color + '33');
            ctx.globalAlpha = 0.65 + 0.35 * prog;
            ctx.fillStyle = g;
            ctx.fillRect(24, -w, Math.max(0, len - 24), w * 2);
            // 帯のふち（点線）。地面と同じような色でも見えるよう、下に濃い線を敷く
            ctx.globalAlpha = 0.35;
            ctx.strokeStyle = '#1a1020';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(24, -w); ctx.lineTo(len, -w);
            ctx.moveTo(24, w); ctx.lineTo(len, w);
            ctx.stroke();
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = info.light;
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 8]);
            ctx.lineDashOffset = -time * 40;
            ctx.beginPath();
            ctx.moveTo(24, -w); ctx.lineTo(len, -w);
            ctx.moveTo(24, w); ctx.lineTo(len, w);
            ctx.stroke();
            ctx.setLineDash([]);
            // 進む向きに流れる矢じり
            ctx.fillStyle = info.light;
            ctx.strokeStyle = 'rgba(26,16,32,0.55)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 4; i++) {
                const x = 40 + ((time * 160 + i * (len / 4)) % Math.max(1, len - 50));
                ctx.globalAlpha = 0.85 * Math.min(1, (len - x) / 60);
                ctx.beginPath();
                ctx.moveTo(x, -w * 0.55); ctx.lineTo(x + w * 0.7, 0); ctx.lineTo(x, w * 0.55); ctx.lineTo(x + w * 0.25, 0);
                ctx.closePath();
                ctx.stroke();
                ctx.fill();
            }
            ctx.restore();
            // 届く所（竜巻は止まる所の大きさ、弾は弾の大きさの輪）
            ctx.save();
            const r = a.tornado ? a.radius : a.radius * 1.4;
            ctx.globalAlpha = 0.4;
            ctx.strokeStyle = '#1a1020';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.ellipse(e.x, e.y + 8, r, r * 0.5, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = info.light;
            ctx.shadowColor = info.color;
            ctx.shadowBlur = 10;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(e.x, e.y + 8, r, r * 0.5, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = info.color;
            ctx.fill();
        } else {
            const s = p.position.sub(cam), tp = a.target.sub(cam);
            // 届く範囲（主人公のまわりのうすい輪）
            ctx.beginPath();
            ctx.ellipse(s.x, s.y + 8, a.range, a.range * 0.62, 0, 0, Math.PI * 2);
            ctx.globalAlpha = 0.08;
            ctx.fillStyle = info.color;
            ctx.fill();
            ctx.globalAlpha = 0.7;
            ctx.strokeStyle = info.light;
            ctx.shadowColor = info.color;
            ctx.shadowBlur = 6;
            ctx.lineWidth = 3;
            ctx.setLineDash([10, 10]);
            ctx.lineDashOffset = -time * 20;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.setLineDash([]);
            // 落とす場所：回る魔法陣とターゲットの十字
            if (window.drawMagicCircle) window.drawMagicCircle(ctx, tp.x, tp.y, a.radius, p.chantMagic.element, time * 2, 0.55 + 0.35 * prog, 0.55);
            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = a.lock ? '#fff27a' : info.light;
            ctx.shadowColor = info.color;
            ctx.shadowBlur = 12;
            ctx.lineWidth = 3;
            const k = a.radius * (1.15 + 0.08 * Math.sin(time * 8));
            ctx.beginPath();
            ctx.ellipse(tp.x, tp.y, k, k * 0.55, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            const c = a.radius * 0.45;
            ctx.moveTo(tp.x - k - 10, tp.y); ctx.lineTo(tp.x - c, tp.y);
            ctx.moveTo(tp.x + c, tp.y); ctx.lineTo(tp.x + k + 10, tp.y);
            ctx.moveTo(tp.x, tp.y - k * 0.55 - 8); ctx.lineTo(tp.x, tp.y - c * 0.55);
            ctx.moveTo(tp.x, tp.y + c * 0.55); ctx.lineTo(tp.x, tp.y + k * 0.55 + 8);
            ctx.stroke();
        }
        ctx.restore();
    }
    
    // 狙っている向きの矢印（スマホで攻撃ボタンをスライドしている間）
    drawAim(ctx, cam) {
        const p = this.player;
        if (!p || p.isDead()) return;
        const sliding = this.input.touchAim && this.input.touchAim.active && this.input.touchAim.source === 'attack';
        if (!sliding) return;
        const dir = this.getAimDirection();
        if (!dir) return;
        const s = p.position.sub(cam);
        const ang = Math.atan2(dir.y, dir.x);
        const info = p.isChanting && p.chantMagic && window.getElementInfo ? window.getElementInfo(p.chantMagic.element) : null;
        ctx.save();
        ctx.translate(s.x, s.y + 6);
        ctx.rotate(ang);
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = info ? info.light : '#ffffff';
        ctx.strokeStyle = info ? info.color : 'rgba(255, 220, 120, 0.9)';
        ctx.lineWidth = 2;
        // 足元から少し離れた所に、細長い矢印
        ctx.beginPath();
        ctx.moveTo(34, -4); ctx.lineTo(70, -4); ctx.lineTo(70, -10); ctx.lineTo(86, 0);
        ctx.lineTo(70, 10); ctx.lineTo(70, 4); ctx.lineTo(34, 4); ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}

// 近接攻撃で、この距離（px）以内の敵の方を向いて斬る（PC でクリックしたターゲットは距離に関係なく）
Game.MELEE_FACE_RANGE = 600;
// ターゲット（ロックオン）の印の色（攻撃の予告の赤と見分けられるよう、少し桃色がかった赤）と、動きの時間（秒）
Game.LOCK_COLOR = '#ff3b7f';
Game.LOCK_DARK = '#2a0614';
Game.LOCK_LIGHT = '#ffe2ec';
Game.LOCK_SNAP_TIME = 0.3;   // 決めた瞬間に、かぎが外から閉じてくる時間
Game.UNLOCK_FX_TIME = 0.25;  // 解除した時に、かぎが広がって消える時間
// 連打で、攻撃の間隔（ナイフは 0.35秒）の途中に押した分を覚えておく時間（秒）
Game.ATTACK_BUFFER = 0.4;
// 属性の相性のダメージ倍率
Game.ELEMENT_MUL = { weak: 1.5, resist: 0.5, normal: 1 };
// 魔法が当たった時の敵の光の色（有利属性は赤・不利属性は青。ふつうは白）と、光る時間（秒）
Game.AFFINITY_FLASH = { weak: '#ff3030', resist: '#3a7dff' };
Game.AFFINITY_FLASH_TIME = 0.15;
// 魔法のねらい
Game.TARGET_HOLD_MS = 250;     // スマホ：魔法ボタンをこれ以上押し続けると、その場系のターゲットカーソルが出る
Game.TARGET_SLIDE_GAIN = 1.6;  // スマホ：指を 1px 動かした時、ターゲットカーソルが動く量（画面の拡大率で割る）
Game.AUTO_AIM_RANGE = 650;     // 何も指定しない時に、自動でねらう敵の距離
