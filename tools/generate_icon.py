#!/usr/bin/env python3
"""
プロジェクトアイコン生成スクリプト
星の子のロゴ風アイコンを生成
"""

from PIL import Image, ImageDraw
import os

def create_icon():
    """アイコンを生成"""
    size = 128
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 背景の円（深い青）
    draw.ellipse([10, 10, size-10, size-10], fill=(30, 50, 100, 255))
    
    # 星型を描画
    center_x, center_y = size // 2, size // 2
    radius_outer = 40
    radius_inner = 18
    
    # 5つの星の頂点を計算
    import math
    points = []
    for i in range(10):
        angle = (i * 36 - 90) * math.pi / 180  # -90度から開始（上向き）
        if i % 2 == 0:
            # 外側の頂点
            x = center_x + radius_outer * math.cos(angle)
            y = center_y + radius_outer * math.sin(angle)
        else:
            # 内側の頂点
            x = center_x + radius_inner * math.cos(angle)
            y = center_y + radius_inner * math.sin(angle)
        points.append((x, y))
    
    # 星を描画（黄色）
    draw.polygon(points, fill=(255, 215, 0, 255))
    
    # 星の中心に宝石風の輝き（明るいオレンジ）
    draw.ellipse([center_x-8, center_y-8, center_x+8, center_y+8], fill=(255, 152, 0, 255))
    
    return img

def main():
    """メイン処理"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    
    # アイコンを生成
    icon = create_icon()
    
    # 保存
    output_path = os.path.join(project_dir, "icon.svg.png")
    icon.save(output_path)
    print(f"アイコンを生成しました: {output_path}")
    
    # SVG版の説明テキストも生成
    svg_note_path = os.path.join(project_dir, "icon_note.txt")
    with open(svg_note_path, "w", encoding="utf-8") as f:
        f.write("icon.svg.png - プロジェクトアイコン\n")
        f.write("\n")
        f.write("星の子のシンボル：\n")
        f.write("- 深い青の円：夜空と宇宙\n")
        f.write("- 黄色い星：星の民と希望\n")
        f.write("- オレンジの中心：主人公の星の宝石\n")
    print(f"説明を生成しました: {svg_note_path}")

if __name__ == "__main__":
    main()
