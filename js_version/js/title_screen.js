// タイトル画面システム

class TitleScreen {
    constructor() {
        this.state = 'main'; // 'main', 'story', 'battle', 'settings', 'credits'
        this.selectedIndex = 0; // 最初は「フリーバトル」が選択される
        this.isTransitioning = false;
        this.hoverIndex = -1; // マウスホバー中のインデックス
        
        // メニュー定義
        this.menus = {
            main: [
                { text: 'フリーバトル', action: 'battle' },
                { text: 'メインストーリー（実装予定）', action: 'story_coming_soon', disabled: true },
                { text: 'せってい', action: 'settings' },
                { text: 'クレジット', action: 'credits' }
            ],
            battle: [
                { text: 'かんたん', action: 'battle_easy' },
                { text: 'ふつう', action: 'battle_normal' },
                { text: 'むずかしい', action: 'battle_hard' },
                { text: 'もどる', action: 'back' }
            ]
        };
        
        // ボタンの位置とサイズ（クリック判定用）
        this.buttonBounds = [];
        
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
    
    // マウス座標の下にあるボタンの番号を返す（なければ -1）
    getButtonIndexAt(x, y) {
        for (let i = 0; i < this.buttonBounds.length; i++) {
            const b = this.buttonBounds[i];
            if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
                return i;
            }
        }
        return -1;
    }
    
    handleInput(input) {
        const currentMenu = this.getCurrentMenu();
        
        // マウスホバー：有効なボタンの上なら選択中にする
        this.hoverIndex = this.getButtonIndexAt(input.mouseX, input.mouseY);
        if (this.hoverIndex !== -1 && !currentMenu[this.hoverIndex].disabled) {
            this.selectedIndex = this.hoverIndex;
        }
        
        // マウスクリックで決定
        if (input.isMouseClicked && this.hoverIndex !== -1) {
            if (!currentMenu[this.hoverIndex].disabled) {
                this.selectedIndex = this.hoverIndex;
                this.selectMenuItem();
            }
            return;
        }
        
        // Enter / Space で決定
        if (input.isKeyPressed('Enter') || input.isKeyPressed('Space')) {
            if (!currentMenu[this.selectedIndex].disabled) {
                this.selectMenuItem();
            }
            return;
        }
        
        // 上下キーで選択（無効な項目はスキップ）
        if (input.isKeyPressed('ArrowDown') || input.isKeyPressed('KeyS')) {
            do {
                this.selectedIndex = (this.selectedIndex + 1) % currentMenu.length;
            } while (currentMenu[this.selectedIndex].disabled);
        }
        if (input.isKeyPressed('ArrowUp') || input.isKeyPressed('KeyW')) {
            do {
                this.selectedIndex = (this.selectedIndex - 1 + currentMenu.length) % currentMenu.length;
            } while (currentMenu[this.selectedIndex].disabled);
        }
        
        // Escapeキーで戻る
        if (input.isKeyPressed('Escape') && this.state !== 'main') {
            this.goBack();
        }
    }
    
    selectMenuItem() {
        const currentMenu = this.getCurrentMenu();
        const selectedItem = currentMenu[this.selectedIndex];
        
        console.log('メニュー選択:', selectedItem.action);
        
        switch (selectedItem.action) {
            case 'battle':
                // フリーバトル → キャラクター選択へ（難易度は「ふつう」固定）
                if (window.game) {
                    window.game.battleDifficulty = 'normal';
                    window.game.gameState = 'character_select';
                } else {
                    console.error('window.game が見つかりません');
                }
                break;
            case 'story_coming_soon':
                console.log('メインストーリーは実装予定です');
                // 何もしない（実装予定）
                break;
            case 'settings':
                console.log('設定画面は実装予定です');
                break;
            case 'credits':
                console.log('クレジット画面は実装予定です');
                break;
            case 'back':
                this.goBack();
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
        // キャラクター選択画面に遷移
        if (window.game) {
            window.game.battleDifficulty = difficulty; // 難易度を保存
            window.game.gameState = 'character_select';
        }
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
        
        // ボタン境界情報をリセット
        this.buttonBounds = [];
        
        ctx.save();
        
        currentMenu.forEach((item, index) => {
            const y = startY + (buttonHeight + spacing) * index;
            const isSelected = index === this.selectedIndex;
            const isBackButton = item.action === 'back';
            const isDisabled = item.disabled || false;
            
            // ボタン境界を記録
            const bounds = {
                x: centerX - buttonWidth/2,
                y: y,
                width: buttonWidth,
                height: buttonHeight
            };
            this.buttonBounds.push(bounds);
            
            // ボタン背景
            if (isDisabled) {
                ctx.fillStyle = 'rgba(40, 40, 50, 0.5)';
            } else if (isBackButton) {
                ctx.fillStyle = 'rgba(60, 60, 80, 0.7)';
            } else {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            }
            
            if (isSelected && !isDisabled) {
                ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = 20;
            }
            
            // ボタンの丸角矩形
            this.drawRoundRect(ctx, centerX - buttonWidth/2, y, buttonWidth, buttonHeight, 10);
            ctx.fill();
            
            // ボタンの枠線
            if (isDisabled) {
                ctx.strokeStyle = 'rgba(100, 100, 120, 0.3)';
            } else {
                ctx.strokeStyle = isSelected ? '#ffd700' : 'rgba(255, 255, 255, 0.3)';
            }
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.shadowBlur = 0;
            
            // ボタンテキスト
            ctx.font = isSelected && !isDisabled ? 'bold 28px sans-serif' : '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            if (isDisabled) {
                ctx.fillStyle = 'rgba(150, 150, 160, 0.5)';
            } else {
                ctx.fillStyle = isSelected ? '#ffd700' : '#ffffff';
            }
            
            ctx.fillText(item.text, centerX, y + buttonHeight/2);
            
            // 選択カーソル（無効化されていない場合のみ）
            if (isSelected && !isDisabled) {
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
