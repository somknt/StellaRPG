// キャラクター選択システム

class CharacterSelectScreen {
    constructor() {
        this.selectedGender = null; // 'male' or 'female'
        this.isComplete = false;
        this.malePreviewPos = new Vector2(400, 360);
        this.femalePreviewPos = new Vector2(880, 360);
        this.hoverGender = null;
    }
    
    update(input) {
        // マウス位置でホバー判定
        const mousePos = input.mousePos;
        
        // 男性キャラのホバー判定
        if (this.isInPreviewArea(mousePos, this.malePreviewPos)) {
            this.hoverGender = 'male';
        }
        // 女性キャラのホバー判定
        else if (this.isInPreviewArea(mousePos, this.femalePreviewPos)) {
            this.hoverGender = 'female';
        }
        else {
            this.hoverGender = null;
        }
        
        // クリックで選択（isMouseClickedを使用）
        if (input.isMouseClicked) {
            if (this.hoverGender) {
                console.log('キャラクター選択:', this.hoverGender);
                this.selectedGender = this.hoverGender;
                this.isComplete = true;
            }
        }
        
        // キーボードでも選択可能
        if (input.isKeyPressed('Digit1') || input.isKeyPressed('ArrowLeft')) {
            console.log('キャラクター選択: male（キーボード）');
            this.selectedGender = 'male';
            this.isComplete = true;
        }
        if (input.isKeyPressed('Digit2') || input.isKeyPressed('ArrowRight')) {
            console.log('キャラクター選択: female（キーボード）');
            this.selectedGender = 'female';
            this.isComplete = true;
        }
    }
    
    isInPreviewArea(pos, center) {
        const size = 150;
        return pos.x >= center.x - size/2 && pos.x <= center.x + size/2 &&
               pos.y >= center.y - size/2 && pos.y <= center.y + size/2;
    }
    
    draw(ctx) {
        // 背景
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        
        // タイトル
        ctx.save();
        ctx.fillStyle = '#ffb347';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('星の子 - キャラクター選択', 640, 150);
        ctx.restore();
        
        // 説明
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('プレイするキャラクターを選んでください', 640, 200);
        ctx.restore();
        
        // 男性キャラプレビュー
        this.drawCharacterPreview(ctx, 'male', this.malePreviewPos);
        
        // 女性キャラプレビュー
        this.drawCharacterPreview(ctx, 'female', this.femalePreviewPos);
        
        // 操作説明
        ctx.save();
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('クリックで選択 / キーボード: 1（男性） 2（女性）', 640, 650);
        ctx.restore();
    }
    
    drawCharacterPreview(ctx, gender, pos) {
        const isHover = this.hoverGender === gender;
        const boxSize = 150;
        
        ctx.save();
        
        // ボックス背景
        ctx.fillStyle = isHover ? 'rgba(255, 179, 71, 0.3)' : 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(pos.x - boxSize/2, pos.y - boxSize/2, boxSize, boxSize);
        
        // ボックス枠
        ctx.strokeStyle = isHover ? '#ffb347' : '#666666';
        ctx.lineWidth = isHover ? 4 : 2;
        ctx.strokeRect(pos.x - boxSize/2, pos.y - boxSize/2, boxSize, boxSize);
        
        // 性別に応じた個別ファイルを取得
        const imgKey = `player_${gender}_down_2`;
        const img = window.assetManager ? window.assetManager.get(imgKey) : null;
        
        if (img) {
            // 個別ファイルなのでそのまま表示
            ctx.drawImage(
                img,
                pos.x - 40, pos.y - 40, 80, 80
            );
        } else {
            // 仮のシルエット
            ctx.fillStyle = gender === 'male' ? '#6699ff' : '#ff99cc';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 40, 0, Math.PI * 2);
            ctx.fill();
            
            // 性別マーク
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(gender === 'male' ? '♂' : '♀', pos.x, pos.y);
        }
        
        // ラベル
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(gender === 'male' ? '男性' : '女性', pos.x, pos.y + boxSize/2 + 30);
        
        // 特徴説明
        ctx.font = '14px Arial';
        ctx.fillStyle = '#cccccc';
        const description = gender === 'male' 
            ? 'マッシュヘア' 
            : 'ロングヘア';
        ctx.fillText(description, pos.x, pos.y + boxSize/2 + 55);
        
        ctx.restore();
    }
    
    getSelectedGender() {
        return this.selectedGender;
    }
}
