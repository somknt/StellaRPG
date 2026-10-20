// タイトル画面システム

class TitleScreen {
    constructor() {
        this.state = 'main'; // 'main', 'story', 'battle', 'settings', 'credits'
        this.selectedIndex = 0;
        this.isTransitioning = false;
        
        // メニュー定義
        this.menus = {
            main: [
                { text: 'ストーリー', action: 'story' },
                { text: 'バトル', action: 'battle' },
                { text: 'せってい', action: 'settings' },
                { text: 'クレジット', action: 'credits' }
            ],
            story: [
                { text: 'はじめから', action: 'new_game' },
                { text: 'つづきから', action: 'continue' },
                { text: 'もどる', action: 'back' }
            ],
            battle: [
                { text: 'かんたん', action: 'battle_easy' },
                { text: 'ふつう', action: 'battle_normal' },
                { text: 'むずかしい', action: 'battle_hard' },
                { text: 'もどる', action: 'back' }
            ]
        };
        
        // アニメーション
        this.slideOffset = 0;
        this.slideSpeed = 10;
        this.targetSlideOffset = 0;
        
        // タイトルロゴのアニメーション
        this.logoAlpha = 0;
        this.logoScale = 0.8;
        
        // 星のパーティクル
        this.particles = [];
        this.initParticles();
    }
    
    initParticles() {
        for (let i = 0; i < 50; i++) {
            this.particles.push({
                x: Math.random() * 1280,
                y: Math.random() * 720,
                size: Math.random() * 3 + 1,
                speed: Math.random() * 20 + 10,
                alpha: Math.random() * 0.5 + 0.3
            });
        }
    }
    
    update(deltaTime, input) {
        // ロゴのフェードイン
        if (this.logoAlpha < 1) {
            this.logoAlpha = Math.min(1, this.logoAlpha + deltaTime);
            this.logoScale = 0.8 + (1 - this.logoAlpha) * 0.2;
        }
        
        // パーティクルアニメーション
        this.particles.forEach(p => {
            p.y -= p.speed * deltaTime;
            if (p.y < -10) {
                p.y = 730;
                p.x = Math.random() * 1280;
            }
        });
        
        // スライドアニメーション
        if (Math.abs(this.slideOffset - this.targetSlideOffset) > 0.1) {
            const diff = this.targetSlideOffset - this.slideOffset;
            this.slideOffset += diff * this.slideSpeed * deltaTime;
        } else {
            this.slideOffset = this.targetSlideOffset;
            this.isTransitioning = false;
        }
        
        // 入力処理
        if (!this.isTransitioning) {
            this.handleInput(input);
        }
    }
    
    handleInput(input) {
        const currentMenu = this.getCurrentMenu();
        
        // 上下キーでメニュー選択
        if (input.isKeyPressed('ArrowDown') || input.isKeyPressed('KeyS')) {
            this.selectedIndex = (this.selectedIndex + 1) % currentMenu.length;
        }
        if (input.isKeyPressed('ArrowUp') || input.isKeyPressed('KeyW')) {
            this.selectedIndex = (this.selectedIndex - 1 + currentMenu.length) % currentMenu.length;
        }
        
        // Enterキーまたはスペースキーで決定
        if (input.isKeyPressed('Enter') || input.isKeyPressed('Space')) {
            this.selectMenuItem();
        }
        
        // Escapeキーで戻る
        if (input.isKeyPressed('Escape') && this.state !== 'main') {
            this.goBack();
        }
    }
    
    selectMenuItem() {
        const currentMenu = this.getCurrentMenu();
        const selectedItem = currentMenu[this.selectedIndex];
        
        console.log('選択:', selectedItem.action);
        
        switch (selectedItem.action) {
            case 'story':
                this.changeState('story');
                break;
            case 'battle':
                this.changeState('battle');
                break;
            case 'settings':
                this.changeState('settings');
                break;
            case 'credits':
                this.changeState('credits');
                break;
            case 'back':
                this.goBack();
                break;
            case 'new_game':
                this.startNewGame();
                break;
            case 'continue':
                this.continueGame();
                break;
            case 'battle_easy':
                this.startBattle('easy');
                break;
            case 'battle_normal':
                this.startBattle('normal');
                break;
            case 'battle_hard':
                this.startBattle('hard');
                break;
        }
    }
    
    changeState(newState) {
        this.isTransitioning = true;
        this.state = newState;
        this.selectedIndex = 0;
        
        // スライドアニメーション
        if (newState === 'main') {
            this.targetSlideOffset = 0;
        } else {
            this.targetSlideOffset = -200;
        }
    }
    
    goBack() {
        this.changeState('main');
    }
    
    startNewGame() {
        console.log('新しいゲームを開始');
        // ゲーム開始処理（後で実装）
        if (window.game) {
            window.game.gameState = 'character_select';
        }
    }
    
    continueGame() {
        console.log('セーブデータから再開');
        // セーブデータ読み込み処理（後で実装）
    }
    
    startBattle(difficulty) {
        console.log('バトル開始:', difficulty);
        // バトルモード開始（後で実装）
    }
    
    getCurrentMenu() {
        return this.menus[this.state] || this.menus.main;
    }
    
    draw(ctx) {
        const canvas = ctx.canvas;
        
        // 背景（仮）
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#1a1a3e');
        gradient.addColorStop(1, '#4a4a7a');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 星のパーティクル
        this.drawParticles(ctx);
        
        // タイトルロゴ
        this.drawTitle(ctx);
        
        // メニュー
        this.drawMenu(ctx);
        
        // 操作説明
        this.drawControls(ctx);
    }
    
    drawParticles(ctx) {
        ctx.save();
        this.particles.forEach(p => {
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }
    
    drawTitle(ctx) {
        ctx.save();
        ctx.globalAlpha = this.logoAlpha;
        
        // タイトル「星の子」
        ctx.font = 'bold 80px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // グラデーション
        const gradient = ctx.createLinearGradient(0, 150, 0, 250);
        gradient.addColorStop(0, '#ffd700');
        gradient.addColorStop(1, '#e0f0ff');
        ctx.fillStyle = gradient;
        
        // タイトル影
        ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
        ctx.shadowBlur = 20;
        
        const centerX = ctx.canvas.width / 2;
        const scale = this.logoScale;
        ctx.save();
        ctx.translate(centerX, 150);
        ctx.scale(scale, scale);
        ctx.fillText('星の子', 0, 0);
        ctx.restore();
        
        // サブタイトル
        ctx.font = '24px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.shadowBlur = 10;
        ctx.fillText('Hoshi no Ko', centerX, 220);
        
        ctx.restore();
    }
    
    drawMenu(ctx) {
        const currentMenu = this.getCurrentMenu();
        const centerX = ctx.canvas.width / 2 + this.slideOffset;
        const startY = 350;
        const buttonHeight = 60;
        const buttonWidth = 300;
        const spacing = 20;
        
        ctx.save();
        
        currentMenu.forEach((item, index) => {
            const y = startY + (buttonHeight + spacing) * index;
            const isSelected = index === this.selectedIndex;
            const isBackButton = item.action === 'back';
            
            // ボタン背景
            ctx.fillStyle = isBackButton 
                ? 'rgba(60, 60, 80, 0.7)' 
                : 'rgba(0, 0, 0, 0.6)';
            
            if (isSelected) {
                ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = 20;
            }
            
            // ボタンの丸角矩形
            this.drawRoundRect(ctx, centerX - buttonWidth/2, y, buttonWidth, buttonHeight, 10);
            ctx.fill();
            
            // ボタンの枠線
            ctx.strokeStyle = isSelected ? '#ffd700' : 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.shadowBlur = 0;
            
            // ボタンテキスト
            ctx.font = isSelected ? 'bold 28px sans-serif' : '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isSelected ? '#ffd700' : '#ffffff';
            ctx.fillText(item.text, centerX, y + buttonHeight/2);
            
            // 選択カーソル
            if (isSelected) {
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.moveTo(centerX - buttonWidth/2 - 20, y + buttonHeight/2);
                ctx.lineTo(centerX - buttonWidth/2 - 10, y + buttonHeight/2 - 8);
                ctx.lineTo(centerX - buttonWidth/2 - 10, y + buttonHeight/2 + 8);
                ctx.fill();
            }
        });
        
        ctx.restore();
    }
    
    drawRoundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }
    
    drawControls(ctx) {
        ctx.save();
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        
        const centerX = ctx.canvas.width / 2;
        const y = ctx.canvas.height - 30;
        
        if (this.state === 'main') {
            ctx.fillText('↑↓: 選択  Enter/Space: 決定', centerX, y);
        } else {
            ctx.fillText('↑↓: 選択  Enter/Space: 決定  Esc: 戻る', centerX, y);
        }
        
        ctx.restore();
    }
}

// グローバルインスタンス
window.titleScreen = null;
