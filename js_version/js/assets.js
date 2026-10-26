// 画像アセット管理

class AssetManager {
    constructor() {
        this.images = {};
        this.loadedCount = 0;
        this.totalCount = 0;
        this.onProgress = null;
        this.onComplete = null;
    }
    
    // 画像リストを定義
    getAssetList() {
        const list = this.getBaseAssetList();
        
        // キャラクターのアクション画像（ダッシュ・回避・攻撃 × 4方向 × 4コマ）
        const genders = ['male', 'female'];
        const actions = ['dash', 'dodge', 'attack'];
        const directions = ['down', 'up', 'left', 'right'];
        for (const g of genders) {
            for (const a of actions) {
                for (const d of directions) {
                    for (let f = 1; f <= 4; f++) {
                        list[`player_${g}_${a}_${d}_${f}`] = `assets/characters/${g}/${a}_${d}_${f}.png`;
                    }
                }
            }
        }
        
        // 敵 - 星光スライム（4方向 × 3コマ + ジャンプ）
        for (const d of directions) {
            for (let f = 1; f <= 3; f++) {
                list[`starlight_slime_${d}_${f}`] = `assets/enemies/starlight_slime/${d}_${f}.png`;
            }
            list[`starlight_slime_${d}_jump`] = `assets/enemies/starlight_slime/${d}_jump.png`;
        }
        
        // 敵が倒れたときのエフェクト（全部の敵で共通・6コマ）：星が縦にのびて光の柱になって消える
        for (let f = 1; f <= 6; f++) {
            list[`effect_enemy_death_${f}`] = `assets/effects/enemy_death_${f}.png`;
        }
        
        // 敵のノックバック（ひるみ）：4方向 × 2コマ（1=当たった瞬間 / 2=飛ばされている途中）
        for (const d of directions) {
            for (let f = 1; f <= 2; f++) {
                list[`horn_rabbit_hurt_${d}_${f}`] = `assets/enemies/hurt_${d}_${f}.png`;
                list[`starlight_slime_hurt_${d}_${f}`] = `assets/enemies/starlight_slime/hurt_${d}_${f}.png`;
            }
        }
        
        // 詠唱モーション（体だけ。魔法陣は別画像）：cast = 立ち止まって詠唱 / castwalk = 歩きながら詠唱
        // 画像がそろったキャラだけ CAST_SPRITES_READY に足す（ない間は歩き画像で代用）
        for (const g of AssetManager.CAST_SPRITES_READY) {
            for (const a of ['cast', 'castwalk']) {
                for (const d of directions) {
                    for (let f = 1; f <= 4; f++) {
                        list[`player_${g}_${a}_${d}_${f}`] = `assets/characters/${g}/${a}_${d}_${f}.png`;
                    }
                }
            }
        }
        
        // 魔法陣（属性ごとに1枚。真上から見た丸い魔法陣。ゲーム側で地面に寝かせて回転させる）
        // ない間は線で描いた魔法陣を属性の色で表示する
        for (const el of AssetManager.MAGIC_CIRCLES_READY) {
            list[`magic_circle_${el}`] = `assets/effects/magic_circle_${el}.png`;
        }
        
        // 闘技場の素材（assets/tiles/arena/<名前>.png）。置いた物だけ ARENA_ART_READY に足す
        // ない間はコードで描いた仮の見た目で表示する
        for (const name of AssetManager.ARENA_ART_READY) {
            list[name] = `assets/tiles/arena/${name}.png`;
        }
        
        // 狼・猪の画像（assets/enemies/<名前>/<向き>_<1〜3>.png）。置いた物だけ BEAST_SPRITES_READY に足す
        for (const key of AssetManager.BEAST_SPRITES_READY) {
            for (const d of directions) {
                for (let f = 1; f <= 3; f++) list[`${key}_${d}_${f}`] = `assets/enemies/${key}/${d}_${f}.png`;
            }
        }
        
        // ボスのモーション画像（assets/enemies/<名前>/<モーション>_<向き>_<1〜3>.png）。置いたモーションだけ足す
        for (const [key, motions] of Object.entries(AssetManager.BOSS_MOTION_SPRITES_READY)) {
            for (const m of motions) {
                for (const d of directions) {
                    for (let f = 1; f <= 3; f++) list[`${key}_${m}_${d}_${f}`] = `assets/enemies/${key}/${m}_${d}_${f}.png`;
                }
            }
        }
        return list;
    }
    
    getBaseAssetList() {
        return {
            // キャラクター - 男性（各向き3コマ）
            'player_male_down_1': 'assets/characters/male/down_1.png',
            'player_male_down_2': 'assets/characters/male/down_2.png',
            'player_male_down_3': 'assets/characters/male/down_3.png',
            'player_male_up_1': 'assets/characters/male/up_1.png',
            'player_male_up_2': 'assets/characters/male/up_2.png',
            'player_male_up_3': 'assets/characters/male/up_3.png',
            'player_male_left_1': 'assets/characters/male/left_1.png',
            'player_male_left_2': 'assets/characters/male/left_2.png',
            'player_male_left_3': 'assets/characters/male/left_3.png',
            'player_male_right_1': 'assets/characters/male/right_1.png',
            'player_male_right_2': 'assets/characters/male/right_2.png',
            'player_male_right_3': 'assets/characters/male/right_3.png',
            
            // キャラクター - 女性（各向き3コマ）
            'player_female_down_1': 'assets/characters/female/down_1.png',
            'player_female_down_2': 'assets/characters/female/down_2.png',
            'player_female_down_3': 'assets/characters/female/down_3.png',
            'player_female_up_1': 'assets/characters/female/up_1.png',
            'player_female_up_2': 'assets/characters/female/up_2.png',
            'player_female_up_3': 'assets/characters/female/up_3.png',
            'player_female_left_1': 'assets/characters/female/left_1.png',
            'player_female_left_2': 'assets/characters/female/left_2.png',
            'player_female_left_3': 'assets/characters/female/left_3.png',
            'player_female_right_1': 'assets/characters/female/right_1.png',
            'player_female_right_2': 'assets/characters/female/right_2.png',
            'player_female_right_3': 'assets/characters/female/right_3.png',
            
            // 敵 - 角ウサギ（向き別、各3コマ+ジャンプ）
            'horn_rabbit_down_1': 'assets/enemies/down_1.png',
            'horn_rabbit_down_2': 'assets/enemies/down_2.png',
            'horn_rabbit_down_3': 'assets/enemies/down_3.png',
            'horn_rabbit_down_jump': 'assets/enemies/down_jump.png',
            'horn_rabbit_up_1': 'assets/enemies/up_1.png',
            'horn_rabbit_up_2': 'assets/enemies/up_2.png',
            'horn_rabbit_up_3': 'assets/enemies/up_3.png',
            'horn_rabbit_up_jump': 'assets/enemies/up_jump.png',
            'horn_rabbit_left_1': 'assets/enemies/left_1.png',
            'horn_rabbit_left_2': 'assets/enemies/left_2.png',
            'horn_rabbit_left_3': 'assets/enemies/left_3.png',
            'horn_rabbit_left_jump': 'assets/enemies/left_jump.png',
            'horn_rabbit_right_1': 'assets/enemies/right_1.png',
            'horn_rabbit_right_2': 'assets/enemies/right_2.png',
            'horn_rabbit_right_3': 'assets/enemies/right_3.png',
            'horn_rabbit_right_jump': 'assets/enemies/right_jump.png',
            
            // 敵 - その他
            'horn_rabbit_1': 'assets/enemies/horn_rabbit_1.png',
            'horn_rabbit_2': 'assets/enemies/horn_rabbit_2.png',
            'wolf_1': 'assets/enemies/wolf_1.png',
            'wolf_2': 'assets/enemies/wolf_2.png',

            
            // エフェクト - 個別ファイル
            'magic_light_1': 'assets/effects/magic_light_1.png',
            'magic_light_2': 'assets/effects/magic_light_2.png',
            'magic_light_3': 'assets/effects/magic_light_3.png',
            'magic_light_4': 'assets/effects/magic_light_4.png',
            
            // タイル
            'grass': 'assets/tiles/grass.png',
            'road': 'assets/tiles/road.png',
            'water': 'assets/tiles/water.png'
            // UI（ステータスバー）は index.html / style.css から直接読み込む
        };
    }
    
    // すべての画像を読み込む
    loadAll(onProgress, onComplete) {
        this.onProgress = onProgress;
        this.onComplete = onComplete;
        
        const assets = this.getAssetList();
        this.totalCount = Object.keys(assets).length;
        
        for (const [key, path] of Object.entries(assets)) {
            this.loadImage(key, path);
        }
    }
    
    // 個別の画像を読み込む
    loadImage(key, path) {
        const img = new Image();
        
        img.onload = () => {
            this.images[key] = img;
            this.loadedCount++;
            
            if (this.onProgress) {
                this.onProgress(this.loadedCount, this.totalCount);
            }
            
            if (this.loadedCount === this.totalCount && this.onComplete) {
                this.onComplete();
            }
        };
        
        img.onerror = () => {
            console.warn(`画像の読み込み失敗: ${path} (代替として色で描画します)`);
            this.loadedCount++;
            
            if (this.loadedCount === this.totalCount && this.onComplete) {
                this.onComplete();
            }
        };
        
        img.src = path;
    }
    
    // 画像を取得
    get(key) {
        return this.images[key] || null;
    }
    
    // 画像が読み込まれているか
    has(key) {
        return this.images[key] !== undefined;
    }
}

// まだ画像がない物は読み込まない（存在しないファイルを毎回取りに行くとスマホで遅くなるため）
// 画像を置いたらここに足す
AssetManager.CAST_SPRITES_READY = ['male', 'female'];
AssetManager.MAGIC_CIRCLES_READY = [];  // 例: ['fire', 'water', 'wind', 'earth', 'thunder']
// 闘技場の素材（素材一覧から切り出した物。arena_map.js が使う物だけ読み込む）
AssetManager.ARENA_ART_READY = [
    'arena_sand', 'arena_sand_rocks', 'arena_sand_rocks_b', 'arena_sand_rocks_c', 'arena_sand_grass',
    'arena_stone_floor', 'arena_star_symbol',
    'arena_wall', 'arena_wall_b', 'arena_gate_frame', 'arena_gate_bars', 'arena_pillar', 'arena_pillar_b', 'arena_banner',
    'arena_brazier', 'arena_brazier_b', 'arena_stairs_wide', 'arena_stands_corner', 'arena_stands_side',
    'arena_statue', 'arena_banner_pole', 'arena_fence', 'arena_fence_vines', 'arena_stall', 'arena_barrel', 'arena_barrel_b',
    'arena_crate', 'arena_weapon_rack', 'arena_spear_rack', 'arena_flower_bush', 'arena_rubble'
];
AssetManager.BEAST_SPRITES_READY = [];  // 例: ['grass_wolf', 'corrupted_wolf', 'forest_boar', 'giant_forest_boar', 'black_corrupted_wolf']
// ボスのモーション画像。例: { giant_forest_boar: ['charge', 'stomp', 'roar'], black_corrupted_wolf: ['leap', 'howl'] }
AssetManager.BOSS_MOTION_SPRITES_READY = {};

// グローバルインスタンス
window.assetManager = new AssetManager();
