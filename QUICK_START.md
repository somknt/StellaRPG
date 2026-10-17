# クイックスタートガイド

『星の子』のワールドマップを最速で動かすための手順

---

## 前提条件

✅ Godot 4.3以上がインストールされていること  
✅ Python 3.8以上がインストールされていること

---

## 5分で動かす手順

### 1. Pythonライブラリをインストール

```powershell
pip install Pillow
```

### 2. 仮タイル画像を生成

```powershell
cd "c:\Users\shiomi kanato\Desktop\新作ゲーム"
python tools/generate_placeholder_tiles.py
```

### 3. アイコンを生成

```powershell
python tools/generate_icon.py
```

### 4. Godotでプロジェクトを開く

1. Godotエディタを起動
2. 「Import」をクリック
3. `c:\Users\shiomi kanato\Desktop\新作ゲーム\project.godot` を選択
4. 「Import & Edit」をクリック

### 5. テスト実行

F5キーを押す

---

## 動かない場合

詳しい手順は `SETUP_GUIDE.md` を参照してください。

---

## 操作方法

- **移動**: WASD または 矢印キー
- **ダッシュ**: Shift
- **終了**: ESC → Quit

---

## 次のステップ

1. `SETUP_GUIDE.md` を読んでタイルセットを作成
2. マップを描画
3. ゲームを楽しむ！
