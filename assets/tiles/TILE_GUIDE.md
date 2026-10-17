# タイルアセットガイド

## 必要なタイルセット

### 1. 基本地形タイル（32×32ピクセル）

#### 草原タイル
- `grass_01.png` - 明るい緑の草地
- `grass_02.png` - やや暗い緑の草地
- `grass_flower.png` - 花が咲いている草地
- `dirt_path.png` - 土の小道
- `stone_path.png` - 石畳の道

#### 森林タイル
- `forest_floor.png` - 森の地面
- `tree_01.png` - 普通の木
- `tree_02.png` - 大きな木
- `bush.png` - 茂み
- `fallen_log.png` - 倒木

#### 水タイル
- `water_01.png` - 水面（アニメーション用フレーム1）
- `water_02.png` - 水面（アニメーション用フレーム2）
- `water_03.png` - 水面（アニメーション用フレーム3）
- `shallow_water.png` - 浅瀬
- `bridge_wood.png` - 木の橋

#### 山岳タイル
- `mountain_base.png` - 山の麓
- `mountain_cliff.png` - 崖
- `rock_01.png` - 岩（小）
- `rock_02.png` - 岩（大）

#### 砂漠タイル
- `sand_01.png` - 明るい砂
- `sand_02.png` - 暗い砂
- `sand_dune.png` - 砂丘
- `cactus.png` - サボテン

#### 雪原タイル
- `snow_01.png` - 雪原
- `ice.png` - 氷
- `snow_rock.png` - 雪に覆われた岩

#### 侵食地帯タイル
- `corrupted_ground.png` - 黒紫色の地面
- `corrupted_crystal.png` - 紫色に光る結晶
- `dead_tree.png` - 枯れた黒い木

### 2. 建物タイル

#### ティウム（村）
- `house_wood_01.png` - 木造の家（屋根部分）
- `house_wood_02.png` - 木造の家（壁部分）
- `house_wood_door.png` - 木造の家の扉
- `well.png` - 井戸
- `farm_field.png` - 畑

#### レギーア（王都）
- `castle_wall.png` - 城壁
- `castle_tower.png` - 塔
- `castle_roof_blue.png` - 青い城の屋根
- `castle_gate.png` - 城門
- `stone_building.png` - 石造りの建物

#### ウラマリー（港町）
- `house_port_01.png` - 港町の家（赤い屋根）
- `dock_wood.png` - 木造の桟橋
- `boat.png` - 船
- `lighthouse.png` - 灯台

### 3. 古代遺跡タイル

- `ruins_pillar.png` - 石柱
- `ruins_floor.png` - 遺跡の床
- `ruins_wall.png` - 遺跡の壁
- `ancient_device.png` - 古代装置（青白く光る）
- `ancient_text.png` - 古代文字が刻まれた石

### 4. その他オブジェクト

- `windmill.png` - 風車
- `signpost.png` - 道標
- `fence_wood.png` - 木の柵
- `campfire.png` - キャンプファイヤー
- `chest.png` - 宝箱

---

## タイルセット作成方法

### ステップ1: 仮タイルの作成
実際のピクセルアートを用意する前に、色分けした仮タイルで動作確認を行います。

#### 仮タイルの色分け
- 草原：緑（#4CAF50）
- 森林：濃い緑（#2E7D32）
- 水：青（#2196F3）
- 山：グレー（#757575）
- 砂漠：黄色（#FFC107）
- 雪：白（#FFFFFF）
- 侵食地帯：黒紫（#4A148C）
- 建物：茶色（#795548）

### ステップ2: Godotでタイルセットを作成
1. `assets/tiles/` にPNG画像を配置
2. Godotエディタでタイルセットリソースを作成
3. 各タイルにコリジョン形状を設定
4. タイルマップレイヤーに配置

### ステップ3: ピクセルアート化
仮タイルで動作確認後、本格的なピクセルアートに置き換え

---

## 推奨ピクセルアートツール

- **Aseprite** (有料・推奨)
- **Piskel** (無料・ブラウザ版)
- **GIMP** (無料)
- **Krita** (無料)

---

## アニメーションタイル

### 水のアニメーション
- 3フレーム
- 0.3秒ごとに切り替え

### 発光するオブジェクト
- 2フレーム
- 0.5秒ごとに切り替え

---

*まずは仮タイルでマップ構成を作成し、後からピクセルアートに置き換える方針*
