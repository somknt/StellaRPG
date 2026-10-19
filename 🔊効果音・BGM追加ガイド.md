# 🔊 効果音・BGM追加ガイド

## ✅ サウンドシステム実装完了！

効果音とBGMを再生できるシステムを実装しました。

---

## 📂 必要なファイル

### **効果音（SFX）**
```
js_version/assets/sounds/
├── attack.mp3          - 攻撃音
├── magic.mp3           - 魔法発動音
├── damage.mp3          - ダメージ音
├── heal.mp3            - 回復音
├── levelup.mp3         - レベルアップ音
├── item_get.mp3        - アイテム取得音
├── menu_select.mp3     - メニュー選択音
├── menu_cancel.mp3     - メニューキャンセル音
└── footstep.mp3        - 足音
```

### **BGM（背景音楽）**
```
js_version/assets/sounds/
├── bgm_field.mp3       - フィールドBGM
├── bgm_battle.mp3      - 戦闘BGM
├── bgm_village.mp3     - 村BGM
└── bgm_boss.mp3        - ボス戦BGM
```

---

## 🎵 効果音の入手方法

### **方法1: フリー素材サイト（おすすめ）**

#### 🇯🇵 **日本語サイト**

1. **魔王魂**
   - URL: https://maou.audio/
   - 種類: BGM・効果音
   - ライセンス: 商用利用可能
   - おすすめ: ゲーム向け素材が豊富

2. **効果音ラボ**
   - URL: https://soundeffect-lab.info/
   - 種類: 効果音特化
   - ライセンス: 商用利用可能
   - おすすめ: 戦闘・魔法系が充実

3. **DOVA-SYNDROME**
   - URL: https://dova-s.jp/
   - 種類: BGM特化
   - ライセンス: 商用利用可能
   - おすすめ: ファンタジー系BGMが豊富

4. **甘茶の音楽工房**
   - URL: https://amachamusic.chagasi.com/
   - 種類: BGM
   - ライセンス: 商用利用可能

#### 🌍 **英語サイト**

5. **Freesound**
   - URL: https://freesound.org/
   - 種類: 効果音
   - ライセンス: CC（要確認）

6. **OpenGameArt**
   - URL: https://opengameart.org/
   - 種類: BGM・効果音
   - ライセンス: 様々（要確認）

---

### **方法2: AI生成（実験的）**

- **Suno AI** (https://suno.ai/) - BGM生成
- **ElevenLabs** - 効果音生成（一部機能）

---

### **方法3: 自作**

- **Audacity** (無料) - 録音・編集
- **LMMS** (無料) - 音楽制作
- **Bfxr** (無料・Web) - レトロゲーム効果音生成

---

## 📥 ダウンロード・配置手順

### **STEP 1: 効果音をダウンロード**

1. フリー素材サイトを開く（例: 効果音ラボ）
2. 必要な音を検索（例: 「剣 攻撃」）
3. ダウンロード（MP3形式推奨）

### **STEP 2: ファイル名を変更**

ダウンロードしたファイルを以下の名前にリネーム：

```
sword_slash_01.mp3  →  attack.mp3
magic_cast_02.mp3   →  magic.mp3
hit_damage.mp3      →  damage.mp3
```

### **STEP 3: フォルダに配置**

```
js_version/assets/sounds/ にコピー
```

### **STEP 4: ブラウザで確認**

```
index.html を開いて動作確認
Spaceキーで攻撃 → 効果音が鳴る
```

---

## 🎮 実装済みの効果音タイミング

### **自動再生される効果音**

| アクション | 効果音ファイル | トリガー |
|-----------|--------------|---------|
| 攻撃 | `attack.mp3` | Spaceキー押下時 |
| ダメージ受ける | `damage.mp3` | 敵の攻撃を受けた時 |
| 回復 | `heal.mp3` | HP回復時 |
| レベルアップ | `levelup.mp3` | レベルアップ時 |

---

## 🔧 効果音を追加する方法

### **新しい効果音を追加**

1. **sound.jsを編集**

```javascript
window.soundManager.registerSounds({
    // 既存の効果音...
    'enemy_dead': 'assets/sounds/enemy_dead.mp3',  // 追加
});
```

2. **再生したい場所で呼び出し**

```javascript
// 例: 敵が倒れた時
if (window.soundManager) {
    window.soundManager.playSFX('enemy_dead');
}
```

---

## 🎵 BGMを再生する方法

### **game.jsに追加**

```javascript
// ゲーム開始時にBGMを再生
startGame(gender) {
    // ... 既存のコード
    
    // フィールドBGMを再生
    if (window.soundManager) {
        window.soundManager.playBGM('bgm_field');
    }
}
```

### **BGMを切り替え**

```javascript
// 戦闘開始時
window.soundManager.playBGM('bgm_battle');

// フィールドに戻った時
window.soundManager.playBGM('bgm_field');
```

---

## ⚙️ 音量調整

### **コンソールで調整（F12）**

```javascript
// BGM音量を50%に
soundManager.setBGMVolume(0.5);

// 効果音音量を70%に
soundManager.setSFXVolume(0.7);

// ミュート切り替え
soundManager.toggleMute();
```

---

## 📊 優先順位

### **Phase 1: 最優先（4ファイル）**
1. `attack.mp3` - 攻撃音
2. `damage.mp3` - ダメージ音
3. `levelup.mp3` - レベルアップ音
4. `bgm_field.mp3` - フィールドBGM

→ **これだけでゲームの雰囲気が大きく変わる！**

### **Phase 2: 重要（3ファイル）**
5. `magic.mp3` - 魔法音
6. `heal.mp3` - 回復音
7. `bgm_battle.mp3` - 戦闘BGM

### **Phase 3: オプション**
8. `menu_select.mp3` - メニュー音
9. `item_get.mp3` - アイテム音
10. その他

---

## 💡 推奨スペック

### **ファイル形式**
- ✅ **MP3** - 最も互換性が高い（おすすめ）
- ✅ OGG - 軽量
- ✅ WAV - 高音質だが重い

### **ファイルサイズ**
- **効果音**: 50KB～200KB程度
- **BGM**: 1MB～3MB程度（ループ考慮）

### **長さ**
- **効果音**: 0.5秒～2秒
- **BGM**: 1分～3分（ループ）

---

## 🐛 トラブルシューティング

### **問題1: 効果音が鳴らない**

**原因**: ファイルが存在しない

**解決**:
1. ブラウザのコンソール（F12）を開く
2. エラーメッセージを確認
3. ファイルパスを確認

```javascript
// ファイルが存在するか確認
console.log(soundManager.sounds);
```

---

### **問題2: BGMが再生されない**

**原因**: ブラウザの自動再生ポリシー

**解決**: ユーザーアクション後に再生
```javascript
// キャラクター選択後に再生されるようになっている
```

---

### **問題3: 音が小さい/大きい**

**原因**: 音量設定

**解決**:
```javascript
// 音量調整
soundManager.setBGMVolume(0.5);  // 0.0～1.0
soundManager.setSFXVolume(0.7);
```

---

## ✨ まとめ

### **実装済み**
- ✅ サウンドシステム（sound.js）
- ✅ 効果音再生機能
- ✅ BGM再生機能
- ✅ 音量調整機能
- ✅ ミュート機能

### **必要な作業**
1. フリー素材サイトから効果音をダウンロード
2. ファイル名を変更
3. `assets/sounds/` に配置
4. ブラウザで確認

### **おすすめサイト**
- **魔王魂** - BGM・効果音
- **効果音ラボ** - 効果音特化
- **DOVA-SYNDROME** - BGM特化

---

**まずは `attack.mp3` と `damage.mp3` の2つから始めるのがおすすめです！** 🎵✨

---

作成日: 2026年10月18日
