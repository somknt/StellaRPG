// タイルセットとマップデータ管理

// タイルタイプの定義
const TileType = {
    GRASS: 'grass',           // 草原
    DIRT: 'dirt',             // 土の道
    STONE: 'stone',           // 石畳
    WATER: 'water',           // 水
    FARMLAND: 'farmland',     // 畑
    HOUSE: 'house',           // 民家
    SHOP: 'shop',             // 雑貨屋
    WELL: 'well',             // 井戸
    TREE: 'tree',             // 木
    FENCE: 'fence',           // 柵
    FLOWER: 'flower',         // 花
    SIGN: 'sign'              // 看板
};

// タイルの設定
const TileConfig = {
    [TileType.GRASS]: {
        walkable: true,
        color: '#60b060',
        name: '草原'
    },
    [TileType.DIRT]: {
        walkable: true,
        color: '#8b7355',
        name: '土の道'
    },
    [TileType.STONE]: {
        walkable: true,
        color: '#808080',
        name: '石畳'
    },
    [TileType.WATER]: {
        walkable: false,
        color: '#4080ff',
        name: '水'
    },
    [TileType.FARMLAND]: {
        walkable: true,
        color: '#6b4423',
        name: '畑'
    },
    [TileType.HOUSE]: {
        walkable: false,
        color: '#8b4513',
        name: '民家'
    },
    [TileType.SHOP]: {
        walkable: false,
        color: '#daa520',
        name: '雑貨屋'
    },
    [TileType.WELL]: {
        walkable: false,
        color: '#696969',
        name: '井戸'
    },
    [TileType.TREE]: {
        walkable: false,
        color: '#228b22',
        name: '木'
    },
    [TileType.FENCE]: {
        walkable: false,
        color: '#8b4513',
        name: '柵'
    },
    [TileType.FLOWER]: {
        walkable: true,
        color: '#ff69b4',
        name: '花'
    },
    [TileType.SIGN]: {
        walkable: false,
        color: '#deb887',
        name: '看板'
    }
};

// ティウム村のマップデータ
const TiumVillageMap = {
    name: 'ティウム村',
    // 村・町・拠点など敵がいない場所は safeZone: true（ストーリーモードでは常に歩く）
    // 戦闘フィールドは safeZone: false（常に走る）
    safeZone: true,
    width: 40,
    height: 30,
    tileSize: 32,
    spawnPoint: { x: 20, y: 25 }, // プレイヤーの初期位置
    
    // レイヤー構造でマップを定義
    layers: {
        // 地面レイヤー（一番下）
        ground: null, // generateGroundLayer()で生成
        
        // オブジェクトレイヤー（建物、木など）
        objects: [
            // 中央広場の井戸
            { type: TileType.WELL, x: 20, y: 15, width: 1, height: 1 },
            
            // 広場周辺の民家（6軒）
            { type: TileType.HOUSE, x: 10, y: 8, width: 3, height: 3 },   // 北西の家
            { type: TileType.HOUSE, x: 27, y: 8, width: 3, height: 3 },   // 北東の家
            { type: TileType.HOUSE, x: 8, y: 18, width: 3, height: 3 },   // 西の家
            { type: TileType.HOUSE, x: 30, y: 18, width: 3, height: 3 },  // 東の家
            { type: TileType.HOUSE, x: 10, y: 23, width: 3, height: 3 },  // 南西の家
            
            // 雑貨屋（東側）
            { type: TileType.SHOP, x: 32, y: 14, width: 4, height: 3, interaction: 'shop' },
            
            // 村長の家（南側、少し大きめ）
            { type: TileType.HOUSE, x: 18, y: 26, width: 5, height: 4, interaction: 'chief_house' },
            
            // 畑（北側）
            { type: TileType.FARMLAND, x: 5, y: 3, width: 8, height: 4 },
            { type: TileType.FARMLAND, x: 28, y: 3, width: 8, height: 4 },
            
            // 木々（装飾）
            { type: TileType.TREE, x: 6, y: 12, width: 1, height: 1 },
            { type: TileType.TREE, x: 34, y: 12, width: 1, height: 1 },
            { type: TileType.TREE, x: 15, y: 5, width: 1, height: 1 },
            { type: TileType.TREE, x: 25, y: 5, width: 1, height: 1 },
            { type: TileType.TREE, x: 4, y: 20, width: 1, height: 1 },
            { type: TileType.TREE, x: 36, y: 20, width: 1, height: 1 },
            
            // 看板（村の入口・南）
            { type: TileType.SIGN, x: 20, y: 28, width: 1, height: 1, interaction: 'welcome_sign' },
            
            // 花（装飾）
            { type: TileType.FLOWER, x: 18, y: 16, width: 1, height: 1 },
            { type: TileType.FLOWER, x: 22, y: 16, width: 1, height: 1 },
            { type: TileType.FLOWER, x: 19, y: 17, width: 1, height: 1 },
            { type: TileType.FLOWER, x: 21, y: 17, width: 1, height: 1 }
        ],
        
        // 柵（外周）
        fences: null // generateFences()で生成
    }
};

// 地面レイヤーを生成
function generateGroundLayer(width, height) {
    const ground = [];
    for (let y = 0; y < height; y++) {
        ground[y] = [];
        for (let x = 0; x < width; x++) {
            // 全部草原タイルで統一
            let tileType = TileType.GRASS;
            
            ground[y][x] = tileType;
        }
    }
    return ground;
}

// 柵を生成
function generateFences(width, height) {
    const fences = [];
    
    // 外周に柵（上下左右）
    for (let x = 2; x < width - 2; x++) {
        // 上の柵
        fences.push({ type: TileType.FENCE, x: x, y: 1, width: 1, height: 1 });
        // 下の柵（村の入口を除く）
        if (x < 18 || x > 22) {
            fences.push({ type: TileType.FENCE, x: x, y: height - 2, width: 1, height: 1 });
        }
    }
    
    for (let y = 2; y < height - 2; y++) {
        // 左の柵
        fences.push({ type: TileType.FENCE, x: 2, y: y, width: 1, height: 1 });
        // 右の柵
        fences.push({ type: TileType.FENCE, x: width - 3, y: y, width: 1, height: 1 });
    }
    
    return fences;
}

// マップデータを初期化
function initializeTiumVillageMap() {
    TiumVillageMap.layers.ground = generateGroundLayer(
        TiumVillageMap.width,
        TiumVillageMap.height
    );
    TiumVillageMap.layers.fences = generateFences(
        TiumVillageMap.width,
        TiumVillageMap.height
    );
    return TiumVillageMap;
}

// タイル画像が読み込まれているかチェック
const TileImages = {
    loaded: false,
    images: {},
    
    // 画像を読み込む（将来的に実装）
    load() {
        // TODO: 画像ファイルが配置されたら実装
        console.log('タイル画像読み込み準備完了');
        this.loaded = false; // 画像がない間はfalse
    }
};
