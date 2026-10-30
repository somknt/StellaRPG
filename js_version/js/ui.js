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
            xpBox: document.getElementById('xp-box'),
            statusPanel: document.getElementById('status-panel'),
            nameBox: document.getElementById('hud-name'),
            nameText: document.getElementById('hud-name-text'),
            magicInfo: document.getElementById('magic-info'),
            magicOrb: document.getElementById('magic-orb'),
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
        
        // 魔法の玉の画像を先に読んでおく（魔法を切りかえた時にちらつかないように）
        this._orbImages = UIManager.ORB_KEYS.map(k => { const img = new Image(); img.src = `assets/ui/hud/orb_${k}.png`; return img; });
        
        // F1キーでヘルプ表示切替
        window.addEventListener('keydown', (e) => {
            if (e.code === 'F1') {
                e.preventDefault();
                this.toggleHelp();
            }
        });
    }
    
    updatePlayerStats(player) {
        // ステータスバー（星章のデザイン）：--ratio(0〜1) を変えると、その量のところで色の画像が切り取られる
        // 値が変わった時だけ書き換える（毎フレーム書き換えるとスマホで重くなるため）
        const setBar = (bar, text, cur, max, round) => {
            if (!bar) return;
            const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
            const r = ratio.toFixed(3);
            if (bar.dataset.ratio !== r) {
                bar.dataset.ratio = r;
                bar.style.setProperty('--ratio', r);
            }
            const t = `${round(cur)}/${max}`;
            if (text && text.textContent !== t) text.textContent = t;
        };
        setBar(this.elements.hpBar, this.elements.hpText, player.currentHP, player.maxHP, Math.ceil);
        setBar(this.elements.staminaBar, this.elements.staminaText, player.currentStamina, player.maxStamina, Math.floor);
        setBar(this.elements.spBar, this.elements.spText, player.currentSP, player.maxSP, Math.ceil); // 画面上の表記は MP
        if (this.elements.staminaBar) {
            this.elements.staminaBar.classList.toggle('exhausted', !!player.isExhausted);
        }
        
        this.updateHPState(player);
        this.updateName();
        this.updateMagic(player);
        
        // レベル & 経験値（ボス戦はレベルが決まっているので、経験値は出さない）
        const set = (el, v) => { const t = String(v); if (el && el.textContent !== t) el.textContent = t; };
        set(this.elements.level, player.level);
        set(this.elements.xp, Math.floor(player.exp));
        set(this.elements.xpNext, player.expToNext);
        if (this.elements.xpBox) this.elements.xpBox.hidden = !!player.levelLocked;
    }
    
    // HP が少ない時：HP のバーが赤くなって脈打ち、左の星が赤くうすく光る（UIManager.HP_LOW 以下。HP_CRITICAL 以下は速く）
    // HP が減った瞬間：ステータスの枠が赤く光る（ダメージの点滅）
    updateHPState(player) {
        const panel = this.elements.statusPanel;
        if (!panel) return;
        const ratio = player.maxHP > 0 ? player.currentHP / player.maxHP : 0;
        const state = player.currentHP <= 0 || ratio <= UIManager.HP_CRITICAL ? 'critical' : ratio <= UIManager.HP_LOW ? 'low' : '';
        if (this._hpState !== state) {
            this._hpState = state;
            panel.classList.toggle('hp-low', !!state);
            panel.classList.toggle('hp-critical', state === 'critical');
            if (this.elements.hpBar) this.elements.hpBar.classList.toggle('low', !!state);
            if (this.elements.hpText) this.elements.hpText.classList.toggle('low', !!state);
        }
        // 同じ主人公で HP が減った時だけ（バトルを始め直した時は点滅しない）
        if (this._hpOwner === player && player.currentHP < this._lastHP - 0.01) {
            panel.classList.remove('hp-hit');
            void panel.offsetWidth;
            panel.classList.add('hp-hit');
        }
        this._hpOwner = player;
        this._lastHP = player.currentHP;
    }
    
    // HP バーの上のプレイヤー名（game.playerName。アカウントのプレイヤー登録で決めた名前）
    updateName() {
        const name = (window.game && window.game.playerName) || '';
        if (this._name === name) return;
        this._name = name;
        if (this.elements.nameText) this.elements.nameText.textContent = name;
        if (this.elements.nameBox) {
            this.elements.nameBox.hidden = !name;
            // 長い名前は少し小さく
            this.elements.nameBox.classList.toggle('long', [...name].length > 7);
        }
    }
    
    // 今選んでいる魔法：属性の色の玉・名前・MP。使えない時（MP不足・待ち時間・HP満タン）はうすく
    // 魔法を1つもセットしていない時は「魔法なし」。変わった時だけ書き換える
    updateMagic(player) {
        const magic = player.getSelectedMagic ? player.getSelectedMagic() : null;
        const reason = magic ? player.canStartChant(magic) : 'なし';
        const unavailable = !!magic && (reason === 'SP不足' || reason === 'クールダウン' || reason === 'HP満タン');
        const key = `${magic ? magic.id : '-'}|${unavailable ? reason : ''}|${player.isChanting}`;
        if (this._magicKey === key) return;
        this._magicKey = key;
        const info = magic && window.getElementInfo ? window.getElementInfo(magic.element) : { key: 'none', color: '#8a8aa0', label: '─' };
        document.documentElement.style.setProperty('--magic-color', info.color);
        const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        set('magic-name', magic ? magic.name : '魔法なし');
        set('magic-cost', !magic ? '' : reason === 'HP満タン' ? 'HP満タン' : `MP${magic.spCost}`);
        set('magic-switch-label', magic ? info.label : '─');
        const orb = this.elements.magicOrb;
        if (orb) {
            const k = UIManager.ORB_KEYS.includes(info.key) ? info.key : 'none';
            const src = `assets/ui/hud/orb_${magic ? k : 'none'}.png`;
            if (orb.getAttribute('src') !== src) orb.setAttribute('src', src);
        }
        if (window.TouchControls && TouchControls.updateSwitchIcon) TouchControls.updateSwitchIcon(magic ? info.key : null);
        const box = this.elements.magicInfo;
        if (box) {
            box.classList.toggle('unavailable', unavailable);
            box.classList.toggle('no-mp', reason === 'SP不足');
            box.classList.toggle('empty', !magic);
            box.classList.toggle('chanting', !!player.isChanting);
        }
        // スマホ：詠唱中は攻撃・回避・ダッシュ・魔法切替を押せない見た目に
        for (const id of ['btn-attack', 'btn-dodge', 'btn-magic-switch']) {
            const b = document.getElementById(id);
            if (b) b.classList.toggle('disabled', player.isChanting);
        }
        const mb = document.getElementById('btn-magic');
        if (mb) mb.classList.toggle('disabled', !magic || unavailable || player.isChanting);
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

// HP の割合がこれ以下で「HP が少ない」（バーが赤く・星が赤く光る）。HP_CRITICAL 以下は点滅が速くなる
UIManager.HP_LOW = 0.3;
UIManager.HP_CRITICAL = 0.15;
// 魔法の玉の画像がある属性（assets/ui/hud/orb_<key>.png。art_source/hud/tools/cut.ps1 が作る）
UIManager.ORB_KEYS = ['fire', 'water', 'wind', 'earth', 'thunder', 'heal', 'light', 'ice', 'none'];
