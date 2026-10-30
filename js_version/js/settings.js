// 設定の管理（音量・画面表示）。ブラウザの localStorage に保存する

class SettingsManager {
    constructor() {
        this.values = { ...SettingsManager.DEFAULTS };
        this.load();
    }
    
    load() {
        try {
            const ls = window.localStorage;
            const raw = ls && ls.getItem(SettingsManager.KEY);
            if (raw) Object.assign(this.values, JSON.parse(raw));
            else {
                // 前の形（BGM と効果音の2つだけ）の設定があれば、表示の設定と、変えてあった音量を引きつぐ
                const old = ls && ls.getItem(SettingsManager.OLD_KEY);
                if (old) this.migrate(JSON.parse(old));
            }
        } catch (e) {
            // 保存できない環境（プライベートモードなど）では初期値のまま
        }
    }
    
    // 前の設定（v1：bgmVolume 0.6・sfxVolume 0.8 が初期値）から引きつぐ
    // 初期値のままだった音量は、新しい初期値を使う。変えてあった効果音の音量は、4種類の効果音に同じ割合でかける
    migrate(old) {
        const v = this.values;
        for (const k of ['screenShake', 'showFps', 'showHelp']) if (typeof old[k] === 'boolean') v[k] = old[k];
        if (typeof old.bgmVolume === 'number' && Math.abs(old.bgmVolume - 0.6) > 0.001) v.bgmVolume = old.bgmVolume;
        if (typeof old.sfxVolume === 'number' && Math.abs(old.sfxVolume - 0.8) > 0.001) {
            const k = old.sfxVolume / 0.8;
            for (const key of ['uiVolume', 'battleVolume', 'enemyVolume', 'voiceVolume']) {
                v[key] = Math.round(Math.min(1, Math.max(0, v[key] * k)) * 10) / 10;
            }
        }
        this.save();
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
    
    // 音量を全部、最初の値に戻す（表示の設定はそのまま）
    resetVolumes() {
        for (const key of Object.keys(SettingsManager.VOLUMES)) this.values[key] = SettingsManager.DEFAULTS[key];
        this.save();
        this.apply();
    }
    
    // 設定をゲームに反映する
    apply() {
        const v = this.values;
        const sm = window.soundManager;
        if (sm && sm.setVolume) {
            for (const [key, name] of Object.entries(SettingsManager.VOLUMES)) sm.setVolume(name, v[key]);
        }
        if (document.body) {
            document.body.classList.toggle('hide-fps', !v.showFps);
            document.body.classList.toggle('hide-help', !v.showHelp);
        }
    }
}

SettingsManager.KEY = 'hoshinoko.settings.v2';
SettingsManager.OLD_KEY = 'hoshinoko.settings.v1';
// 音量の設定の名前 → soundManager の音量の名前（sound.js の SoundManager.DEFAULT_VOLUMES）
SettingsManager.VOLUMES = {
    masterVolume: 'master',  // 全体の音量
    bgmVolume: 'bgm',        // BGM
    uiVolume: 'ui',          // メニュー・合図の音（カーソル移動・決定・BATTLE START など）
    battleVolume: 'battle',  // 主人公の音（斬撃・回避・魔法・ダメージ）
    enemyVolume: 'enemy',    // 敵の攻撃の音（牙・噛みつき・拳・衝撃波など）
    voiceVolume: 'voice'     // 敵の声（咆哮・遠吠え・鳴き声）
};
SettingsManager.DEFAULTS = {
    // 音量（0〜1）。初期値は sound.js の SoundManager.DEFAULT_VOLUMES と同じ
    masterVolume: 1,
    bgmVolume: 0.8,
    uiVolume: 0.6,
    battleVolume: 0.5,
    enemyVolume: 0.7,
    voiceVolume: 1,
    screenShake: true, // 攻撃が当たった時などの画面の揺れ
    showFps: true,    // FPS・座標の表示（パソコンのみ）
    showHelp: true    // 操作方法の表示（パソコンのみ）
};

window.settings = new SettingsManager();
