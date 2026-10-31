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

## オンラインへの接続（PC とスマホで同じアカウントを使う）

このゲームの「オンライン」は、アカウントとセーブデータを無料のデータベース [Supabase](https://supabase.com) に保存するしくみです。
接続すると、PC で作ったアカウントにスマホからもログインでき、プレイヤー名・主人公・魔法パレット・バトルコイン・マイベストが共通になります。
設定しない間は、アカウントはその端末のブラウザだけに保存されます（オフラインでも遊べます）。

> マルチプレイ（ほかの人といっしょに遊ぶ機能）はまだありません。バトルモードの「マルチプレイ」は今後実装予定です。

### 1. ゲームをネットに公開する

スマホから遊ぶには、ゲームをインターネット上に置く必要があります。上の「Vercelへのデプロイ」の手順で公開し、表示された URL の後ろに `/js_version/` を付けて開きます（例 `https://〜.vercel.app/js_version/`。Vercel の設定で Root Directory を `js_version` にした時は付けなくてよい）。
PC だけで試す時は、「ローカルでの実行」の `http://localhost:8000/js_version/` でも同じようにつながります。

### 2. Supabase を準備する（1回だけ）

1. https://supabase.com で無料アカウントを作り、「New project」でプロジェクトを作る
   - Region は `Northeast Asia (Tokyo)`、「Enable Data API」はチェックを入れたまま
2. 左のメニューの「SQL Editor」を開き、[`online/supabase_setup.sql`](online/supabase_setup.sql) を全部はりつけて「Run」を押す（「Success」と出れば完了）
3. 「Project Settings」→「API Keys」（または上の「Connect」）で、次の2つを写す
   - **Project URL**（`https://〜.supabase.co`）
   - **Publishable key**（`sb_publishable_〜`。古いプロジェクトでは anon public key の `eyJ〜` でもよい）

### 3. ゲームに URL と鍵を書く

[`js_version/js/online_config.js`](js_version/js/online_config.js) の2つを書きかえます。

```js
window.ONLINE_CONFIG = {
    url: 'https://abcdefghijklmnop.supabase.co',   // Project URL
    key: 'sb_publishable_xxxxxxxxxxxxxxxx'         // Publishable key
};
```

- **secret key と service_role key は絶対に書かないでください。** このファイルはだれでも見られるので、書いてよいのは公開用の鍵だけです。
- 書いたらコミットして公開し直します（GitHub と連携していれば `git push` で自動で公開されます）。

### 4. つながったか確かめる

1. 公開した URL を開き、タイトル画面から「はじめて遊ぶ」でアカウントを作る
2. メインメニューの右上に「オンライン」と出ればつながっています（「この端末」と出る時は、`online_config.js` が空のままか、公開し直す前の古いページです）
3. スマホで同じ URL を開き、「ログイン」から同じユーザー名とパスワードでログインする

### うまくつながらない時

| 画面に出る文 | 直し方 |
|---|---|
| サーバーにつながりません | 通信を確かめる。Supabase の無料プロジェクトは1週間ほど使わないと止まるので、Supabase の画面で「Restore」を押す |
| サーバーの準備がまだできていません | 手順2の `supabase_setup.sql` を SQL Editor で実行する |
| サーバーの鍵がちがいます | `online_config.js` の `key` が Publishable key（または anon key）か確かめる |
| メニューの右上が「オフライン」 | 通信が切れています。変えた所はその端末に残り、つながった時に送られます |

- オンラインにする前に作ったアカウントは、その端末だけのアカウントです。オンラインにした後で作り直してください（それまでのバトルコインとマイベストは、その端末で最初に作るアカウントに引きつがれます）。
- 公開したページは最大1時間キャッシュされる（`vercel.json`）ので、書きかえがすぐ反映されない時は、少し待つか再読み込みしてください。
- パスワードの直し方など、くわしくは [`online/README.md`](online/README.md) を見てください。

## アプリのアイコン

アイコンの元の絵は `art_source/icon/icon_source.png` です。絵を差しかえたら、次を実行すると全部のアイコンを作り直します。

```powershell
cd art_source/icon
powershell -ExecutionPolicy Bypass -File tools/make_icons.ps1
```

作られる物：`js_version/favicon.ico`（ブラウザのタブ）、`js_version/assets/icon/`（ホーム画面に追加した時のアイコン。`js_version/manifest.webmanifest` から使う）

アイコンを作り直したら、`js_version/index.html` と `js_version/manifest.webmanifest` のアイコンの名前の後ろの `?v=20261031` を、その日の日付に変えてください。ブラウザは前のアイコンを覚えているので、名前を変えると新しいアイコンを読み直します。
ホーム画面に追加したアイコンは、端末によっては自動で変わりません（特に iPhone・iPad）。その時はホーム画面のアイコンを消して、もう一度「ホーム画面に追加」してください。

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
│   ├── favicon.ico      # ブラウザのタブのアイコン
│   ├── manifest.webmanifest # ホーム画面に追加した時の名前・アイコン
│   ├── css/             # スタイルシート
│   ├── js/              # ゲームロジック（online_config.js：オンラインの設定）
│   ├── assets/          # 画像・音声ファイル
│   └── data/            # ゲームデータ
├── online/              # オンラインのアカウントの準備（README.md・supabase_setup.sql）
├── art_source/          # 画像の元の絵と、切り出し・アイコン作りのツール
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
