# 『星の子』セットアップガイド

## 前提条件

### 必要なソフトウェア
1. **Godot 4.3以上**
   - 公式サイト: https://godotengine.org/download/
   - Windows版をダウンロードしてインストール

2. **Python 3.8以上**（タイル画像生成用）
   - 公式サイト: https://www.python.org/downloads/
   - PIL (Pillow)ライブラリが必要

---

## ステップ1: Pythonライブラリのインストール

コマンドプロンプト（PowerShell）で以下を実行：

```powershell
pip install Pillow
```

---

## ステップ2: 仮タイル画像の生成

プロジェクトルートで以下を実行：

```powershell
python tools/generate_placeholder_tiles.py
```

これにより `assets/tiles/placeholder/` に仮タイル画像が生成されます。

---

## ステップ3: Godotプロジェクトを開く

1. Godotエディタを起動
2. 「Import」をクリック
3. プロジェクトフォルダの `project.godot` を選択
4. 「Import & Edit」をクリック

---

## ステップ4: タイルセットの作成

### 4-1. 新しいTileSetリソースを作成

1. FileSystemパネルで `assets/tiles/` を右クリック
2. 「New Resource...」を選択
3. 「TileSet」を検索して選択
4. `world_tileset.tres` として保存

### 4-2. タイルを追加

1. 作成した `world_tileset.tres` をダブルクリック
2. 下部の「TileSet」パネルが開く
3. 「+」ボタンをクリックして「Atlas」を追加
4. `assets/tiles/placeholder/` から各PNG画像を選択
5. タイルサイズを `32×32` に設定

### 4-3. コリジョン設定

各タイルに通行可能/不可能を設定：

**通行可能**（コリジョンなし）：
- grass_01.png
- grass_02.png
- path.png
- dirt.png
- sand.png
- snow.png

**通行不可**（コリジョンあり）：
- water.png
- mountain.png
- forest.png（一部通行可能にする場合もある）
- house_wood.png
- castle.png
- ruins.png

コリジョンの設定方法：
1. タイルを選択
2. 「Physics」タブを開く
3. 「Add Polygon」をクリック
4. タイル全体を囲む四角形を描画

---

## ステップ5: ワールドマップシーンの作成

### 5-1. 新しいシーンを作成

1. 「Scene」メニュー → 「New Scene」
2. 「Other Node」を選択
3. 「Node2D」を選択
4. ルートノード名を `WorldMap` に変更

### 5-2. TileMapLayerを追加

ワールドマップには複数のレイヤーが必要です：

1. `WorldMap` ノードを右クリック → 「Add Child Node」
2. 「TileMapLayer」を検索して追加
3. 以下のレイヤーを作成：
   - `GroundLayer` - 地面（草、砂、雪など）
   - `PathLayer` - 道、橋
   - `WaterLayer` - 水、川
   - `ObjectLayer` - 木、岩、建物
   - `DecorationLayer` - 装飾

### 5-3. TileSetを設定

各 `TileMapLayer` に対して：
1. インスペクターで「TileSet」プロパティを展開
2. 「Load」をクリック
3. 先ほど作成した `world_tileset.tres` を選択

---

## ステップ6: プレイヤーの作成

### 6-1. プレイヤーシーンを作成

1. 新しいシーン作成
2. 「Other Node」→「CharacterBody2D」を選択
3. ノード名を `Player` に変更

### 6-2. 子ノードを追加

`Player` ノードに以下を追加：

#### CollisionShape2D
1. `Player` を右クリック → 「Add Child Node」
2. 「CollisionShape2D」を追加
3. インスペクターで「Shape」→「New CircleShape2D」
4. 半径を `12` に設定

#### ColorRect（仮スプライト）
1. `Player` に「ColorRect」を追加
2. Size: `24×32`
3. Position: `-12, -32`（中心を足元に）
4. Color: オレンジ色（主人公の色）

### 6-3. スクリプトをアタッチ

1. `Player` ノードを選択
2. 「Attach Script」ボタンをクリック
3. `res://scripts/player/player.gd` を選択
4. 「Load」をクリック

### 6-4. グループに追加

1. `Player` ノードを選択
2. 「Node」タブ → 「Groups」
3. グループ名に `player` を入力して追加

### 6-5. シーンを保存

`scenes/player/player.tscn` として保存

---

## ステップ7: カメラの追加

### 7-1. WorldMapシーンにカメラを追加

1. `WorldMap` シーンを開く
2. `WorldMap` ノードに `Camera2D` を追加
3. ノード名を `GameCamera` に変更

### 7-2. スクリプトをアタッチ

1. `GameCamera` を選択
2. 「Attach Script」をクリック
3. `res://scripts/world/camera_controller.gd` を選択

### 7-3. カメラ設定

インスペクターで：
- `Enabled`: ON
- `Zoom`: `(1.5, 1.5)`
- `Position Smoothing`: `Enabled`にチェック
- `Position Smoothing Speed`: `5.0`

---

## ステップ8: プレイヤーをワールドマップに配置

1. `WorldMap` シーンを開く
2. 「Instance Child Scene」ボタンをクリック（または Ctrl+Shift+A）
3. `scenes/player/player.tscn` を選択
4. プレイヤーをティウムの位置（マップ中央）に配置

---

## ステップ9: カメラをプレイヤーに接続

1. `GameCamera` ノードを選択
2. インスペクターで「Script Variables」を展開
3. `Target` に `Player` ノードをドラッグ&ドロップ

---

## ステップ10: 地域判定エリアの作成

### 10-1. ティウム地域の作成

1. `WorldMap` に新しいノード `Node2D` を追加
2. ノード名を `Regions` に変更
3. `Regions` に `Area2D` を追加
4. ノード名を `TiumRegion` に変更

### 10-2. コリジョン形状を追加

1. `TiumRegion` に `CollisionShape2D` を追加
2. インスペクターで「Shape」→「New RectangleShape2D」
3. サイズを調整してティウムの村を囲む

### 10-3. スクリプトをアタッチ

1. `TiumRegion` を選択
2. 「Attach Script」をクリック
3. `res://scripts/world/region_detector.gd` を選択

### 10-4. 地域名を設定

インスペクターで：
- `Region Name`: `ティウム`
- `Region Subtitle`: `始まりの村`

---

## ステップ11: 地域名表示UIの作成

### 11-1. UIシーンを作成

1. 新しいシーン作成
2. 「User Interface」→「Control」を選択
3. ノード名を `RegionNameDisplay` に変更

### 11-2. UI要素を追加

`RegionNameDisplay` に以下を追加：

#### MarginContainer
1. `RegionNameDisplay` に `MarginContainer` を追加
2. レイアウト: 上部中央に配置
3. Margin: Top=50, Left=400, Right=400

#### VBoxContainer
1. `MarginContainer` に `VBoxContainer` を追加

#### Label（地域名）
1. `VBoxContainer` に `Label` を追加
2. ノード名: `RegionName`
3. Text: `地域名`
4. Horizontal Alignment: `Center`
5. フォントサイズ: 32

#### Label（サブタイトル）
1. `VBoxContainer` に `Label` を追加
2. ノード名: `Subtitle`
3. Text: `サブタイトル`
4. Horizontal Alignment: `Center`
5. フォントサイズ: 20

### 11-3. AnimationPlayerを追加

1. `RegionNameDisplay` に `AnimationPlayer` を追加

### 11-4. スクリプトをアタッチ

1. `RegionNameDisplay` を選択
2. `res://scripts/ui/region_name_display.gd` をアタッチ

### 11-5. シーンを保存

`scenes/ui/region_name_display.tscn` として保存

---

## ステップ12: UIをワールドマップに追加

1. `WorldMap` シーンを開く
2. `WorldMap` に `CanvasLayer` を追加
3. ノード名を `UILayer` に変更
4. `UILayer` に `RegionNameDisplay` シーンをインスタンス

---

## ステップ13: シグナルの接続

### 13-1. WorldMapスクリプトを作成

1. `WorldMap` ノードを選択
2. 新しいスクリプトを作成: `res://scripts/world/world_map.gd`

```gdscript
extends Node2D

@onready var region_name_display = $UILayer/RegionNameDisplay

func _ready():
	# すべての地域判定エリアを検索
	for region in $Regions.get_children():
		if region is Area2D:
			region.player_entered_region.connect(_on_player_entered_region)
			region.player_exited_region.connect(_on_player_exited_region)

func _on_player_entered_region(region_name: String, subtitle: String):
	region_name_display.show_region_name(region_name, subtitle)

func _on_player_exited_region():
	# 特に何もしない（次の地域に入るまで）
	pass
```

---

## ステップ14: テスト実行

1. `WorldMap` シーンをメインシーンに設定
   - 「Scene」メニュー → 「Set as Main Scene」
2. F5キーを押してゲームを実行
3. WASD または 矢印キーで移動
4. Shiftでダッシュ

### 確認事項
- ✅ プレイヤーが移動できる
- ✅ カメラがプレイヤーを追従する
- ✅ 建物や水に当たり判定がある
- ✅ ティウムに入ると地域名が表示される

---

## ステップ15: マップを描く

### 15-1. ティウムの村を作成

`GroundLayer` で：
1. タイルパレットから `grass_01.png` を選択
2. ペイントツールで草原を描く
3. 村のエリア（20×15タイル程度）を塗りつぶす

`PathLayer` で：
1. `path.png` を選択
2. 村の小道を描く

`ObjectLayer` で：
1. `house_wood.png` を選択
2. 民家を8軒程度配置
3. 村の中心に井戸などを配置

### 15-2. 周辺の地形を作成

`GroundLayer` で：
- 北側に森林（`forest.png`）
- 南側に草原
- 川を描く（`water.png`）

---

## トラブルシューティング

### プレイヤーが動かない
- `player.gd` スクリプトが正しくアタッチされているか確認
- Input Mapが正しく設定されているか確認（Project Settings → Input Map）

### カメラが追従しない
- `GameCamera` の `Target` にプレイヤーが設定されているか確認
- カメラスクリプトが正しくアタッチされているか確認

### 地域名が表示されない
- `TiumRegion` の `CollisionShape2D` が設定されているか確認
- プレイヤーが `player` グループに所属しているか確認
- シグナル接続が正しいか確認

---

## 次のステップ

1. 他の地域（ルナエビーナ、ウェントランなど）を作成
2. 実際のピクセルアートタイルに置き換え
3. NPC配置
4. 戦闘システム実装

---

*このガイドに従ってワールドマップを実装してください*
