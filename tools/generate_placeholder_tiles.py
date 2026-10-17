#!/usr/bin/env python3
"""
仮タイル画像生成スクリプト
実際のピクセルアートを用意する前に、色分けした仮タイルで動作確認を行う
"""

from PIL import Image, ImageDraw, ImageFont
import os

# タイルサイズ
TILE_SIZE = 32

# 色定義
COLORS = {
    # 地形
    "grass": (76, 175, 80),        # 草原（緑）
    "grass_dark": (46, 125, 50),   # 濃い草原
    "forest": (27, 94, 32),        # 森林（濃い緑）
    "water": (33, 150, 243),       # 水（青）
    "mountain": (117, 117, 117),   # 山（グレー）
    "sand": (255, 193, 7),         # 砂漠（黄色）
    "snow": (250, 250, 250),       # 雪（白）
    "corrupted": (74, 20, 140),    # 侵食地帯（黒紫）
    "dirt": (121, 85, 72),         # 土（茶色）
    "stone": (158, 158, 158),      # 石
    
    # 建物
    "house_wood": (139, 69, 19),   # 木造の家（茶色）
    "house_port": (183, 28, 28),   # 港町の家（赤）
    "castle": (63, 81, 181),       # 城（青）
    "ruins": (189, 189, 189),      # 遺跡（明るいグレー）
    
    # その他
    "path": (160, 136, 104),       # 小道
    "crystal": (186, 104, 200),    # 結晶（紫）
    "spaceship": (100, 181, 246),  # 宇宙船（青白）
}

def create_tile(color, label=""):
    """単色のタイルを生成"""
    img = Image.new('RGB', (TILE_SIZE, TILE_SIZE), color)
    
    # ラベルがある場合は描画
    if label:
        draw = ImageDraw.Draw(img)
        try:
            # フォントサイズ調整
            font_size = 8
            # システムフォント（Windowsの場合）
            try:
                font = ImageFont.truetype("arial.ttf", font_size)
            except:
                font = ImageFont.load_default()
            
            # テキストの位置を中央に
            bbox = draw.textbbox((0, 0), label, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            position = ((TILE_SIZE - text_width) // 2, (TILE_SIZE - text_height) // 2)
            
            # 黒い縁取りで白文字
            for dx in [-1, 0, 1]:
                for dy in [-1, 0, 1]:
                    if dx != 0 or dy != 0:
                        draw.text((position[0] + dx, position[1] + dy), label, fill=(0, 0, 0), font=font)
            draw.text(position, label, fill=(255, 255, 255), font=font)
        except Exception as e:
            print(f"テキスト描画エラー: {e}")
    
    return img

def create_grid_tile(base_color, grid_color=(0, 0, 0), grid_width=1):
    """グリッド線入りのタイルを生成"""
    img = Image.new('RGB', (TILE_SIZE, TILE_SIZE), base_color)
    draw = ImageDraw.Draw(img)
    
    # グリッド線を描画
    # 上下
    draw.rectangle([0, 0, TILE_SIZE-1, grid_width-1], fill=grid_color)
    draw.rectangle([0, TILE_SIZE-grid_width, TILE_SIZE-1, TILE_SIZE-1], fill=grid_color)
    # 左右
    draw.rectangle([0, 0, grid_width-1, TILE_SIZE-1], fill=grid_color)
    draw.rectangle([TILE_SIZE-grid_width, 0, TILE_SIZE-1, TILE_SIZE-1], fill=grid_color)
    
    return img

def save_tile(tile, filename, output_dir):
    """タイルを保存"""
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, filename)
    tile.save(filepath)
    print(f"生成: {filepath}")

def main():
    """メイン処理"""
    # 出力ディレクトリ
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    output_dir = os.path.join(project_dir, "assets", "tiles", "placeholder")
    
    print("仮タイル画像を生成中...")
    
    # 基本地形タイル
    save_tile(create_tile(COLORS["grass"], "G"), "grass_01.png", output_dir)
    save_tile(create_tile(COLORS["grass_dark"], "G"), "grass_02.png", output_dir)
    save_tile(create_tile(COLORS["forest"], "F"), "forest.png", output_dir)
    save_tile(create_tile(COLORS["water"], "W"), "water.png", output_dir)
    save_tile(create_tile(COLORS["mountain"], "M"), "mountain.png", output_dir)
    save_tile(create_tile(COLORS["sand"], "S"), "sand.png", output_dir)
    save_tile(create_tile(COLORS["snow"], "Sn"), "snow.png", output_dir)
    save_tile(create_tile(COLORS["corrupted"], "C"), "corrupted.png", output_dir)
    save_tile(create_tile(COLORS["dirt"], "D"), "dirt.png", output_dir)
    save_tile(create_tile(COLORS["path"], "P"), "path.png", output_dir)
    
    # 建物タイル
    save_tile(create_tile(COLORS["house_wood"], "H"), "house_wood.png", output_dir)
    save_tile(create_tile(COLORS["house_port"], "Hp"), "house_port.png", output_dir)
    save_tile(create_tile(COLORS["castle"], "Ca"), "castle.png", output_dir)
    save_tile(create_tile(COLORS["ruins"], "R"), "ruins.png", output_dir)
    
    # その他
    save_tile(create_tile(COLORS["crystal"], "Cr"), "crystal.png", output_dir)
    save_tile(create_tile(COLORS["spaceship"], "Sp"), "spaceship.png", output_dir)
    
    # グリッド入りテスト用タイル
    save_tile(create_grid_tile(COLORS["grass"]), "test_grid.png", output_dir)
    
    print(f"\n完了！ {output_dir} に仮タイルを生成しました。")
    print("\nGodotエディタで以下の手順を実行してください：")
    print("1. Godotエディタを開く")
    print("2. FileSystem で assets/tiles/placeholder/ を確認")
    print("3. 新しいTileSetリソースを作成")
    print("4. 各タイル画像をTileSetに追加")
    print("5. コリジョン形状を設定")

if __name__ == "__main__":
    main()
