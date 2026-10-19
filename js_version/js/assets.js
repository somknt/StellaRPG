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
            
            // 敵 - 個別ファイル
            'horn_rabbit_1': 'assets/enemies/horn_rabbit_1.png',
            'horn_rabbit_2': 'assets/enemies/horn_rabbit_2.png',
            'wolf_1': 'assets/enemies/wolf_1.png',
            'wolf_2': 'assets/enemies/wolf_2.png',
            'slime_1': 'assets/enemies/slime_1.png',
            'slime_2': 'assets/enemies/slime_2.png',
            'slime_3': 'assets/enemies/slime_3.png',
            
            // エフェクト - 個別ファイル
            'magic_light_1': 'assets/effects/magic_light_1.png',
            'magic_light_2': 'assets/effects/magic_light_2.png',
            'magic_light_3': 'assets/effects/magic_light_3.png',
            'magic_light_4': 'assets/effects/magic_light_4.png',
            
            // タイル
            'grass': 'assets/tiles/grass.png',
            'road': 'assets/tiles/road.png',
            'water': 'assets/tiles/water.png',
            
            // UI
            'hp_bar': 'assets/ui/hp_bar.png',
            'sp_bar': 'assets/ui/sp_bar.png'
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

// グローバルインスタンス
window.assetManager = new AssetManager();
