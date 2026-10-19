// サウンドシステム

class SoundManager {
    constructor() {
        this.sounds = {};
        this.bgm = null;
        this.bgmVolume = 0.3;
        this.sfxVolume = 0.5;
        this.muted = false;
    }
    
    // サウンドファイルを登録
    registerSound(key, path) {
        const audio = new Audio(path);
        audio.preload = 'auto';
        this.sounds[key] = audio;
    }
    
    // 複数のサウンドを一括登録
    registerSounds(soundList) {
        for (const [key, path] of Object.entries(soundList)) {
            this.registerSound(key, path);
        }
    }
    
    // 効果音を再生
    playSFX(key) {
        if (this.muted) return;
        
        const sound = this.sounds[key];
        if (sound) {
            // 複数回再生できるようにクローン
            const sfx = sound.cloneNode();
            sfx.volume = this.sfxVolume;
            sfx.play().catch(err => console.warn('SFX再生エラー:', key, err));
        } else {
            console.warn('効果音が見つかりません:', key);
        }
    }
    
    // BGMを再生
    playBGM(key, loop = true) {
        if (this.muted) return;
        
        // 既存のBGMを停止
        this.stopBGM();
        
        const bgm = this.sounds[key];
        if (bgm) {
            this.bgm = bgm.cloneNode();
            this.bgm.volume = this.bgmVolume;
            this.bgm.loop = loop;
            this.bgm.play().catch(err => console.warn('BGM再生エラー:', key, err));
        } else {
            console.warn('BGMが見つかりません:', key);
        }
    }
    
    // BGMを停止
    stopBGM() {
        if (this.bgm) {
            this.bgm.pause();
            this.bgm.currentTime = 0;
            this.bgm = null;
        }
    }
    
    // BGMを一時停止/再開
    toggleBGM() {
        if (this.bgm) {
            if (this.bgm.paused) {
                this.bgm.play();
            } else {
                this.bgm.pause();
            }
        }
    }
    
    // ミュート切り替え
    toggleMute() {
        this.muted = !this.muted;
        
        if (this.muted) {
            if (this.bgm) this.bgm.pause();
        } else {
            if (this.bgm) this.bgm.play();
        }
        
        return this.muted;
    }
    
    // BGM音量設定
    setBGMVolume(volume) {
        this.bgmVolume = Math.max(0, Math.min(1, volume));
        if (this.bgm) {
            this.bgm.volume = this.bgmVolume;
        }
    }
    
    // 効果音音量設定
    setSFXVolume(volume) {
        this.sfxVolume = Math.max(0, Math.min(1, volume));
    }
}

// グローバルインスタンス
window.soundManager = new SoundManager();

// ゲーム用サウンドリスト
window.soundManager.registerSounds({
    // 効果音
    'attack': 'assets/sounds/attack.mp3',
    'magic': 'assets/sounds/magic.mp3',
    'damage': 'assets/sounds/damage.mp3',
    'heal': 'assets/sounds/heal.mp3',
    'levelup': 'assets/sounds/levelup.mp3',
    'item_get': 'assets/sounds/item_get.mp3',
    'menu_select': 'assets/sounds/menu_select.mp3',
    'menu_cancel': 'assets/sounds/menu_cancel.mp3',
    'footstep': 'assets/sounds/footstep.mp3',
    
    // BGM
    'bgm_field': 'assets/sounds/bgm_field.mp3',
    'bgm_battle': 'assets/sounds/bgm_battle.mp3',
    'bgm_village': 'assets/sounds/bgm_village.mp3',
    'bgm_boss': 'assets/sounds/bgm_boss.mp3'
});
