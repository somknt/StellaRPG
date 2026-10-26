// 設定の管理（音量・画面表示）。ブラウザの localStorage に保存する

class SettingsManager {
    constructor() {
        this.values = { ...SettingsManager.DEFAULTS };
        this.load();
    }
    
    load() {
        try {
            const raw = window.localStorage && localStorage.getItem(SettingsManager.KEY);
            if (raw) Object.assign(this.values, JSON.parse(raw));
        } catch (e) {
            // 保存できない環境（プライベートモードなど）では初期値のまま
        }
    }
    
    save() {
        try {
            if (window.localStorage) localStorage.setItem(SettingsManager.KEY, JSON.stringify(this.values));
        } catch (e) { /* 保存できなくても遊べる */ }
    }
    
    get(key) { return this.values[key]; }
    
    set(key, value) {
        this.values[key] = value;
        this.save();
        this.apply();
    }
    
    // 設定をゲームに反映する
    apply() {
        const v = this.values;
        if (window.soundManager) {
            window.soundManager.setBGMVolume(v.bgmVolume);
            window.soundManager.setSFXVolume(v.sfxVolume);
        }
        if (document.body) {
            document.body.classList.toggle('hide-fps', !v.showFps);
            document.body.classList.toggle('hide-help', !v.showHelp);
        }
    }
}

SettingsManager.KEY = 'hoshinoko.settings.v1';
SettingsManager.DEFAULTS = {
    bgmVolume: 0.6,   // BGM 音量（0〜1）
    sfxVolume: 0.8,   // 効果音 音量（0〜1）
    screenShake: true, // 攻撃が当たった時などの画面の揺れ
    showFps: true,    // FPS・座標の表示（パソコンのみ）
    showHelp: true    // 操作方法の表示（パソコンのみ）
};

window.settings = new SettingsManager();
