// マップシステム

class Map {
    constructor(width, height, tileSize = 32) {
        this.width = width;
        this.height = height;
        this.tileSize = tileSize;
        this.tiles = [];
        
        // 簡易マップ生成
        this.generateSimpleMap();
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
        const startTileX = Math.floor(camera.x / this.tileSize);
        const startTileY = Math.floor(camera.y / this.tileSize);
        const endTileX = Math.ceil((camera.x + ctx.canvas.width) / this.tileSize);
        const endTileY = Math.ceil((camera.y + ctx.canvas.height) / this.tileSize);
        
        for (let y = Math.max(0, startTileY); y < Math.min(this.height, endTileY); y++) {
            for (let x = Math.max(0, startTileX); x < Math.min(this.width, endTileX); x++) {
                const tile = this.tiles[y][x];
                const screenX = x * this.tileSize - camera.x;
                const screenY = y * this.tileSize - camera.y;
                
                ctx.fillStyle = tile.color;
                ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                
                // グリッド線（デバッグ用）
                if (window.showGrid) {
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                    ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
                }
            }
        }
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
