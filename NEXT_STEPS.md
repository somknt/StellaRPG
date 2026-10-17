# 次に実行すべき手順

## 🎯 今すぐできること

### ステップ1: Pythonが正しくインストールされているか確認

コマンドプロンプト（PowerShellではなく、通常のcmd）を開いて：

```cmd
python --version
```

もし「Python 3.x.x」と表示されない場合：
- https://www.python.org/downloads/ からPythonをインストール
- インストール時に「Add Python to PATH」にチェックを入れる

### ステップ2: Pillowライブラリをインストール

```cmd
pip install Pillow
```

### ステップ3: 仮タイル画像を生成

プロジェクトフォルダに移動：

```cmd
cd "c:\Users\shiomi kanato\Desktop\新作ゲーム"
python tools\generate_placeholder_tiles.py
```

成功すると `assets\tiles\placeholder\` に画像ファイルが生成されます。

### ステップ4: アイコンを生成

```cmd
python tools\generate_icon.py
```

成功すると `icon.svg.png` が生成されます。

### ステップ5: Godotをダウンロード

1. https://godotengine.org/download/ を開く
2. 「Godot Engine 4.3」の「Standard」版をダウンロード
3. ZIPファイルを展開
4. `Godot_v4.3-stable_win64.exe` を実行

### ステップ6: プロジェクトを開く

1. Godotが起動したら「Import」をクリック
2. 「Browse」をクリック
3. `c:\Users\shiomi kanato\Desktop\新作ゲーム\project.godot` を選択
4. 「Import & Edit」をクリック

### ステップ7: マップを作成

`SETUP_GUIDE.md` を開いて、ステップ4から順番に実行してください。

---

## 📋 完了チェックリスト

- [ ] Pythonをインストール
- [ ] Pillowをインストール
- [ ] 仮タイル画像を生成
- [ ] アイコンを生成
- [ ] Godotをダウンロード
- [ ] プロジェクトを開く
- [ ] タイルセットを作成
- [ ] ワールドマップシーンを作成
- [ ] プレイヤーシーンを作成
- [ ] ティウムの村を描く
- [ ] F5キーでテスト実行

---

## 🆘 トラブルシューティング

### Pythonが見つからない
- WindowsでPythonを再インストール
- インストール時に「Add Python to PATH」にチェック

### Pillowがインストールできない
```cmd
pip install --upgrade pip
pip install Pillow
```

### Godotが起動しない
- システム要件を確認（Windows 7以上、OpenGL 3.3対応）
- グラフィックドライバを最新に更新

### プロジェクトが開けない
- `project.godot` ファイルが存在するか確認
- Godot 4.3以上を使用しているか確認

---

## 📞 さらに詳しい情報

- 詳細手順: `SETUP_GUIDE.md`
- クイックスタート: `QUICK_START.md`
- 実装状況: `IMPLEMENTATION_SUMMARY.md`
- ワールドマップ設計: `docs/WORLD_MAP_DESIGN.md`

---

**がんばってください！🌟**
