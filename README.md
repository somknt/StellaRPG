# 星の子 (Hoshi no Ko) - 2D RPG

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/somknt/StellaRPG)

## 概要

「星の子」は、JavaScriptで実装された2D RPGゲームです。プレイヤーは星の力を持つ子供として、敵と戦いながら世界を冒険します。

## 特徴

- ✨ キャラクター選択システム（男性/女性）
- 🎮 スムーズな移動とダッシュ機能
- ⚔️ リアルタイム戦闘システム
- 🔮 魔法システム（光弾陣など）
- 📊 プレイヤーステータス管理
- 🎨 アニメーション対応のキャラクタースプライト

## 技術スタック

- Pure JavaScript (ES6+)
- HTML5 Canvas
- CSS3

## ローカルでの実行

1. リポジトリをクローン:
```bash
git clone https://github.com/somknt/StellaRPG.git
cd StellaRPG
```

2. ローカルサーバーを起動:
```bash
# Pythonを使用する場合
python -m http.server 8000

# Node.jsのhttp-serverを使用する場合
npx http-server -p 8000
```

3. ブラウザで開く:
```
http://localhost:8000/js_version/
```

## Vercelへのデプロイ

### 方法1: GitHubと連携

1. [Vercel](https://vercel.com)にアクセス
2. GitHubアカウントでログイン
3. このリポジトリをインポート
4. デプロイボタンをクリック

### 方法2: Vercel CLIを使用

```bash
npm i -g vercel
cd StellaRPG
vercel
```

## 操作方法

- **WASD**: 移動
- **Shift**: ダッシュ
- **Space**: 攻撃
- **Q**: 魔法（光弾陣）
- **E**: 相互作用
- **F1**: ヘルプ表示/非表示

## プロジェクト構成

```
StellaRPG/
├── js_version/          # メインゲームファイル
│   ├── index.html       # エントリーポイント
│   ├── css/             # スタイルシート
│   ├── js/              # ゲームロジック
│   ├── assets/          # 画像・音声ファイル
│   └── data/            # ゲームデータ
├── data/                # 敵データ等
├── docs/                # ドキュメント
├── vercel.json          # Vercel設定
└── README.md            # このファイル
```

## 開発状況

詳細な開発状況については、`docs/`フォルダ内のドキュメントを参照してください：

- [敵システム実装状況](docs/ENEMIES_IMPLEMENTATION_STATUS.md)
- [プレイヤー実装レポート](docs/PLAYER_IMPLEMENTATION_REPORT.md)
- [戦闘システム](docs/COMBAT_SYSTEM.md)
- [星力システム](docs/STAR_POWER_SYSTEM.md)

## ライセンス

このプロジェクトは個人開発プロジェクトです。

## 貢献

現在は個人プロジェクトとして開発中です。

## 作者

[@somknt](https://github.com/somknt)
