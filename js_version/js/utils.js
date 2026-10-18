// ユーティリティ関数

class Vector2 {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
    
    add(v) {
        return new Vector2(this.x + v.x, this.y + v.y);
    }
    
    sub(v) {
        return new Vector2(this.x - v.x, this.y - v.y);
    }
    
    mult(scalar) {
        return new Vector2(this.x * scalar, this.y * scalar);
    }
    
    length() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    
    normalize() {
        const len = this.length();
        if (len === 0) return new Vector2(0, 0);
        return new Vector2(this.x / len, this.y / len);
    }
    
    distance(v) {
        return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2);
    }
    
    clone() {
        return new Vector2(this.x, this.y);
    }
}

// 数学ユーティリティ
const MathUtils = {
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    
    lerp: (a, b, t) => a + (b - a) * t,
    
    randomRange: (min, max) => Math.random() * (max - min) + min,
    
    randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
    
    degToRad: (deg) => deg * Math.PI / 180,
    
    radToDeg: (rad) => rad * 180 / Math.PI
};

// 衝突検出
const Collision = {
    // AABB (矩形) 衝突
    rectRect: (rect1, rect2) => {
        return rect1.x < rect2.x + rect2.width &&
               rect1.x + rect1.width > rect2.x &&
               rect1.y < rect2.y + rect2.height &&
               rect1.y + rect1.height > rect2.y;
    },
    
    // 円と円の衝突
    circleCircle: (c1, c2) => {
        const dx = c1.x - c2.x;
        const dy = c1.y - c2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < c1.radius + c2.radius;
    },
    
    // 点と矩形の衝突
    pointRect: (point, rect) => {
        return point.x >= rect.x && point.x <= rect.x + rect.width &&
               point.y >= rect.y && point.y <= rect.y + rect.height;
    }
};

// タイマークラス
class Timer {
    constructor(duration) {
        this.duration = duration;
        this.elapsed = 0;
        this.isRunning = false;
    }
    
    start() {
        this.isRunning = true;
        this.elapsed = 0;
    }
    
    update(deltaTime) {
        if (!this.isRunning) return false;
        
        this.elapsed += deltaTime;
        if (this.elapsed >= this.duration) {
            this.isRunning = false;
            return true;
        }
        return false;
    }
    
    getProgress() {
        return Math.min(this.elapsed / this.duration, 1);
    }
    
    reset() {
        this.elapsed = 0;
        this.isRunning = false;
    }
}

// アニメーションクラス
class Animation {
    constructor(frames, frameRate = 10) {
        this.frames = frames;
        this.frameRate = frameRate;
        this.currentFrame = 0;
        this.elapsed = 0;
        this.isPlaying = true;
        this.loop = true;
    }
    
    update(deltaTime) {
        if (!this.isPlaying) return;
        
        this.elapsed += deltaTime;
        const frameDuration = 1 / this.frameRate;
        
        if (this.elapsed >= frameDuration) {
            this.elapsed -= frameDuration;
            this.currentFrame++;
            
            if (this.currentFrame >= this.frames.length) {
                if (this.loop) {
                    this.currentFrame = 0;
                } else {
                    this.currentFrame = this.frames.length - 1;
                    this.isPlaying = false;
                }
            }
        }
    }
    
    getCurrentFrame() {
        return this.frames[this.currentFrame];
    }
    
    reset() {
        this.currentFrame = 0;
        this.elapsed = 0;
        this.isPlaying = true;
    }
}

// ローカルストレージ管理
const SaveSystem = {
    save: (key, data) => {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('Save failed:', e);
            return false;
        }
    },
    
    load: (key) => {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('Load failed:', e);
            return null;
        }
    },
    
    delete: (key) => {
        localStorage.removeItem(key);
    }
};
