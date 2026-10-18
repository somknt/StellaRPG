@echo off
chcp 65001 >nul
echo ====================================================================
echo 星の子 (Hoshi no Ko) - JavaScript版
echo ====================================================================
echo.
echo ブラウザでゲームを開きます...
echo.

start "" index.html

echo.
echo ✅ ブラウザでゲームが開きました
echo.
echo 操作方法:
echo   WASD: 移動
echo   Shift: ダッシュ
echo   Space: 攻撃
echo   Q: 魔法（光弾陣）
echo.
echo デバッグコマンド（ブラウザのコンソールで実行）:
echo   addExp(100) - 経験値追加
echo   healPlayer() - HP/SP全回復
echo   learnAllMagic() - 全魔法習得
echo.
echo ====================================================================
pause
