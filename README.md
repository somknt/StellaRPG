# 星の子 (Hoshi no Ko)

2D RPG - JavaScript/HTML5版

## 🚀 ゲームを起動

```
js_version/ゲーム起動.bat
```

または

```
js_version/index.html
```

をブラウザで開く

---

## 🎮 操作方法

- **WASD**: 移動
- **Shift**: ダッシュ
- **Space**: 攻撃
- **Q**: 魔法（光弾陣）
- **F1**: ヘルプ表示/非表示

---

## 📁 フォルダ構成

```
新作ゲーム/
├── js_version/         ← ゲーム本体（JavaScript版）
│   ├── index.html
│   ├── ゲーム起動.bat
│   ├── js/
│   ├── css/
│   └── data/
│
├── data/               ← ゲームデータ（JSON）
│   ├── player_stats_table.json
│   ├── magic_circles.json
│   └── enemies.json
│
├── docs/               ← 設計資料
│
└── Gemini_*.txt        ← アセット生成用プロンプト
```

---

## ✨ 実装済み機能

- プレイヤー（移動、攻撃、ステータス）
- 星力システム（SP、段階、魔法陣）
- 敵AI（自動スポーン、追跡、攻撃）
- 戦闘システム（ダメージ計算、経験値、レベルアップ）
- UI（HP/SPバー、レベル表示）

---

## 🛠️ デバッグコマンド

ブラウザのコンソール（F12）で実行:

```javascript
addExp(100)        // 経験値追加
healPlayer()       // HP/SP全回復
unlockStarPower(4) // 星力段階4解放
learnAllMagic()    // 全魔法習得
```

---

## 📝 ドキュメント

- `GAME_DESIGN.md` - ゲームデザイン
- `TECHNICAL_SPEC.md` - 技術仕様
- `STORY_FLOW_EARLY_MID.md` - ストーリー
- `docs/` - 詳細設計資料

---

## 🎨 アセット生成

Geminiでアセットを生成:

- `Gemini_全プロンプト集.txt` - すべてのアセット
- `Gemini_建物環境アセット.txt` - 建物・環境

---

作成日: 2026年10月18日
