// マップシステム

class Map {
    constructor(width, height, tileSize = 32, mapData = null) {
        this.width = width;
        this.height = height;
        this.tileSize = tileSize;
        this.tiles = [];
        this.objects = []; // 建物や木などのオブジェクト
        this.mapData = mapData;
        
        // マップ生成
        if (mapData) {
            this.loadMapData(mapData);
        } else {
            this.generateSimpleMap();
        }
    }
    
    // マップデータから読み込み
    loadMapData(mapData) {
        console.log(`マップ「${mapData.name}」を読み込み中...`);
        
        // 地面レイヤーを読み込み
        if (mapData.layers.ground) {
            for (let y = 0; y < this.height; y++) {
                this.tiles[y] = [];
                for (let x = 0; x < this.width; x++) {
                    const tileType = mapData.layers.ground[y][x];
                    const config = window.TileConfig ? window.TileConfig[tileType] : null;
                    
                    this.tiles[y][x] = {
                        type: tileType,
                        walkable: config ? config.walkable : true,
                        color: config ? config.color : this.getGrassColor(x, y)
                    };
                }
            }
        } else {
            this.generateSimpleMap();
        }
        
        // オブジェクトレイヤーを読み込み
        if (mapData.layers.objects) {
            this.objects = [...mapData.layers.objects];
        }
        
        // 柵を追加
        if (mapData.layers.fences) {
            this.objects = [...this.objects, ...mapData.layers.fences];
        }
        
        // オブジェクトをタイルに反映（衝突判定用）
        this.applyObjectsToTiles();
        
        console.log(`マップ読み込み完了: ${this.objects.length}個のオブジェクト`);
    }
    
    // オブジェクトをタイルに反映
    applyObjectsToTiles() {
        this.objects.forEach(obj => {
            const config = window.TileConfig ? window.TileConfig[obj.type] : null;
            const walkable = config ? config.walkable : false;
            
            for (let dy = 0; dy < obj.height; dy++) {
                for (let dx = 0; dx < obj.width; dx++) {
                    const x = obj.x + dx;
                    const y = obj.y + dy;
                    
                    if (y >= 0 && y < this.height && x >= 0 && x < this.width) {
                        this.tiles[y][x].walkable = walkable;
                        this.tiles[y][x].object = obj;
                    }
                }
            }
        });
    }
    
    generateSimpleMap() {
        // 草原タイルで埋める
        for (let y = 0; y < this.height; y++) {
            this.tiles[y] = [];
            for (let x = 0; x < this.width; x++) {
                this.tiles[y][x] = {
                    type: 'grass',
                    walkable: true,
                    color: this.getGrassColor(x, y)
                };
            }
        }
    }
    
    getGrassColor(x, y) {
        // ランダムな緑のバリエーション
        const base = 0x60;
        const variation = Math.floor((Math.sin(x * 0.1) + Math.sin(y * 0.1)) * 20);
        const green = Math.min(255, base + 0x80 + variation);
        return `rgb(${base}, ${green}, ${base})`;
    }
    
    getTileAt(x, y) {
        const tileX = Math.floor(x / this.tileSize);
        const tileY = Math.floor(y / this.tileSize);
        
        if (tileY >= 0 && tileY < this.height && tileX >= 0 && tileX < this.width) {
            return this.tiles[tileY][tileX];
        }
        return null;
    }
    
    isWalkable(x, y) {
        const tile = this.getTileAt(x, y);
        return tile ? tile.walkable : false;
    }
    
    draw(ctx, camera) {
        // カメラ座標を整数に丸めて安定化
        const cameraX = Math.round(camera.x);
        const cameraY = Math.round(camera.y);
        
        const startTileX = Math.floor(cameraX / this.tileSize);
        const startTileY = Math.floor(cameraY / this.tileSize);
        const endTileX = Math.ceil((cameraX + ctx.canvas.width) / this.tileSize);
        const endTileY = Math.ceil((cameraY + ctx.canvas.height) / this.tileSize);
        
        // 画像のスムージングを完全に無効化
        ctx.imageSmoothingEnabled = false;
        ctx.webkitImageSmoothingEnabled = false;
        ctx.mozImageSmoothingEnabled = false;
        ctx.msImageSmoothingEnabled = false;
        
        // 地面レイヤーを描画
        for (let y = Math.max(0, startTileY); y < Math.min(this.height, endTileY); y++) {
            for (let x = Math.max(0, startTileX); x < Math.min(this.width, endTileX); x++) {
                const tile = this.tiles[y][x];
                
                // ピクセルパーフェクトな座標計算
                const worldX = x * this.tileSize;
                const worldY = y * this.tileSize;
                const screenX = worldX - cameraX;
                const screenY = worldY - cameraY;
                
                // タイル画像を取得
                const tileImage = this.getTileImage(tile.type);
                
                if (tileImage) {
                    // 画像を少し大きめに描画して隙間を完全に埋める
                    const overlap = 1;
                    ctx.drawImage(
                        tileImage,
                        0, 0, tileImage.width, tileImage.height,  // ソース全体
                        Math.floor(screenX), 
                        Math.floor(screenY), 
                        this.tileSize + overlap, 
                        this.tileSize + overlap
                    );
                } else {
                    // 画像がない場合は色で描画（フォールバック）
                    ctx.fillStyle = tile.color;
                    ctx.fillRect(Math.floor(screenX), Math.floor(screenY), this.tileSize + 1, this.tileSize + 1);
                }
            }
        }
        
        // オブジェクトレイヤーを描画
        this.drawObjects(ctx, camera, startTileX, startTileY, endTileX, endTileY);
    }
    
    // タイル画像を取得
    getTileImage(tileType) {
        if (!window.assetManager) return null;
        
        // タイプに応じた画像キーを取得
        const imageMap = {
            'grass': 'grass',
            'dirt': 'road',
            'stone': 'road',
            'water': 'water',
            'farmland': 'grass', // 畑も草原画像を使用（仮）
        };
        
        const imageKey = imageMap[tileType] || 'grass';
        return window.assetManager.get(imageKey);
    }
    
    // オブジェクトを描画
    drawObjects(ctx, camera, startTileX, startTileY, endTileX, endTileY) {
        this.objects.forEach(obj => {
            // カメラの範囲内のみ描画
            if (obj.x + obj.width < startTileX || obj.x > endTileX ||
                obj.y + obj.height < startTileY || obj.y > endTileY) {
                return;
            }
            
            const screenX = obj.x * this.tileSize - camera.x;
            const screenY = obj.y * this.tileSize - camera.y;
            const width = obj.width * this.tileSize;
            const height = obj.height * this.tileSize;
            
            const config = window.TileConfig ? window.TileConfig[obj.type] : null;
            
            // 仮の描画（画像がない場合）
            if (config) {
                ctx.fillStyle = config.color;
                ctx.fillRect(screenX, screenY, width, height);
                
                // オブジェクトの枠線
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
                ctx.lineWidth = 2;
                ctx.strokeRect(screenX, screenY, width, height);
                
                // オブジェクト名を表示（デバッグ用）
                if (window.showDebug) {
                    ctx.fillStyle = 'white';
                    ctx.font = '10px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText(config.name, screenX + width / 2, screenY + height / 2);
                }
            }
        });
    }
    
    // インタラクション可能なオブジェクトを取得
    getInteractableObject(x, y) {
        const tileX = Math.floor(x / this.tileSize);
        const tileY = Math.floor(y / this.tileSize);
        
        if (tileY >= 0 && tileY < this.height && tileX >= 0 && tileX < this.width) {
            const tile = this.tiles[tileY][tileX];
            if (tile.object && tile.object.interaction) {
                return tile.object;
            }
        }
        return null;
    }
}

class Camera {
    constructor(x, y, width, height) {
        this.position = new Vector2(x, y);
        this.width = width;
        this.height = height;
        this.target = null;
        this.followSpeed = 5.0;
    }
    
    follow(target) {
        this.target = target;
    }
    
    update(deltaTime) {
        if (this.target) {
            const targetPos = new Vector2(
                this.target.position.x - this.width / 2,
                this.target.position.y - this.height / 2
            );
            
            // スムーズに追従
            const diff = targetPos.sub(this.position);
            this.position = this.position.add(diff.mult(this.followSpeed * deltaTime));
            
            // タイルの隙間を防ぐため、カメラ座標を整数に丸める
            this.position.x = Math.round(this.position.x);
            this.position.y = Math.round(this.position.y);
        }
    }
    
    worldToScreen(worldPos) {
        return worldPos.sub(this.position);
    }
    
    screenToWorld(screenPos) {
        return screenPos.add(this.position);
    }
    
    get x() {
        return this.position.x;
    }
    
    get y() {
        return this.position.y;
    }
}
