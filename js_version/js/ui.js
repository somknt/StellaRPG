// UI管理システム

class UIManager {
    constructor() {
        this.elements = {
            hpBar: document.getElementById('hp-bar'),
            hpText: document.getElementById('hp-text'),
            spBar: document.getElementById('sp-bar'),
            spText: document.getElementById('sp-text'),
            staminaBar: document.getElementById('stamina-bar'),
            staminaText: document.getElementById('stamina-text'),
            level: document.getElementById('player-level'),
            xp: document.getElementById('player-xp'),
            xpNext: document.getElementById('player-xp-next'),
            fps: document.getElementById('fps'),
            playerX: document.getElementById('player-x'),
            playerY: document.getElementById('player-y'),
            enemyCount: document.getElementById('enemy-count'),
            controlsHelp: document.getElementById('controls-help'),
            loadingScreen: document.getElementById('loading-screen'),
            loadingBarFill: document.getElementById('loading-bar-fill'),
            loadingText: document.getElementById('loading-text')
        };
        
        this.helpVisible = true;
        
        // F1キーでヘルプ表示切替
        window.addEventListener('keydown', (e) => {
            if (e.code === 'F1') {
                e.preventDefault();
                this.toggleHelp();
            }
        });
    }
    
    updatePlayerStats(player) {
        // HPバー
        const hpPercent = player.getHPPercent();
        this.elements.hpBar.style.width = hpPercent + '%';
        this.elements.hpText.textContent = `${Math.ceil(player.currentHP)}/${player.maxHP}`;
        
        // SPバー
        const spPercent = player.getSPPercent();
        this.elements.spBar.style.width = spPercent + '%';
        this.elements.spText.textContent = `${Math.ceil(player.currentSP)}/${player.maxSP}`;
        
        // スタミナバー
        if (this.elements.staminaBar) {
            this.elements.staminaBar.style.width = player.getStaminaPercent() + '%';
            this.elements.staminaBar.classList.toggle('exhausted', player.isExhausted);
            this.elements.staminaText.textContent = `${Math.floor(player.currentStamina)}/${player.maxStamina}`;
        }
        
        // 今選んでいる魔法（名前・SP・属性の色）。変わった時だけ書き換える
        const magic = player.getSelectedMagic ? player.getSelectedMagic() : null;
        if (magic) {
            const reason = player.canStartChant(magic);
            const unavailable = reason === 'SP不足' || reason === 'クールダウン';
            const key = `${magic.id}|${unavailable}|${player.isChanting}`;
            if (this._magicKey !== key) {
                this._magicKey = key;
                const info = window.getElementInfo ? window.getElementInfo(magic.element) : { color: '#ffb347', label: '' };
                document.documentElement.style.setProperty('--magic-color', info.color);
                const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
                set('magic-name', magic.name);
                set('magic-cost', `SP${magic.spCost}`);
                set('btn-magic-switch', info.label);
                const box = document.getElementById('magic-info');
                if (box) box.classList.toggle('unavailable', unavailable);
                // スマホ：詠唱中は攻撃・回避・ダッシュ・魔法切替を押せない見た目に
                for (const id of ['btn-attack', 'btn-dodge', 'btn-dash', 'btn-magic-switch']) {
                    const b = document.getElementById(id);
                    if (b) b.classList.toggle('disabled', player.isChanting);
                }
                const mb = document.getElementById('btn-magic');
                if (mb) mb.classList.toggle('disabled', unavailable || player.isChanting);
            }
        }
        
        // レベル & 経験値
        this.elements.level.textContent = player.level;
        this.elements.xp.textContent = Math.floor(player.exp);
        this.elements.xpNext.textContent = player.expToNext;
    }
    
    updateDebugInfo(fps, player, enemyCount) {
        this.elements.fps.textContent = Math.round(fps);
        this.elements.playerX.textContent = Math.round(player.position.x);
        this.elements.playerY.textContent = Math.round(player.position.y);
        this.elements.enemyCount.textContent = enemyCount;
    }
    
    showDamageNumber(damage, position, ctx, camera) {
        // ダメージ数値表示（簡易版）
        const screenPos = position.sub(camera);
        ctx.save();
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = '#ff0000';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText('-' + damage, screenPos.x, screenPos.y - 30);
        ctx.fillText('-' + damage, screenPos.x, screenPos.y - 30);
        ctx.restore();
    }
    
    toggleHelp() {
        this.helpVisible = !this.helpVisible;
        this.elements.controlsHelp.classList.toggle('hidden', !this.helpVisible);
    }
    
    updateLoadingProgress(progress, text) {
        this.elements.loadingBarFill.style.width = (progress * 100) + '%';
        if (text) {
            this.elements.loadingText.textContent = text;
        }
    }
    
    hideLoadingScreen() {
        this.elements.loadingScreen.classList.add('hidden');
    }
    
    showMessage(message, duration = 3000) {
        // TODO: メッセージ表示システム
        console.log(message);
    }
}
