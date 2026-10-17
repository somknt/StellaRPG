# シーンディレクトリ構造

このディレクトリにはGodotのシーン（.tscn）ファイルが配置されます。

## 必要なシーン

### world/
- `world_map.tscn` - メインワールドマップシーン
- `tium_village.tscn` - ティウムの村の詳細マップ（後で追加）
- `regions/` - 各地域の詳細シーン（後で追加）

### player/
- `player.tscn` - プレイヤーキャラクター

### ui/
- `region_name_display.tscn` - 地域名表示UI
- `hud.tscn` - ヘッドアップディスプレイ（HP、スタミナ、MPなど）
- `main_menu.tscn` - メインメニュー（後で追加）

### enemies/
- （後で追加）

### npcs/
- （後で追加）

---

## 作成方法

Godotエディタで：
1. Scene → New Scene
2. 適切なルートノードを選択
3. スクリプトをアタッチ
4. 子ノードを追加
5. Scene → Save Scene As...
6. 適切なディレクトリに保存

---

## シーンの命名規則

- スネークケースを使用（例：`world_map.tscn`）
- 説明的な名前をつける
- ディレクトリで分類する

---

*Godotエディタで作成するシーンをここに保存してください*
