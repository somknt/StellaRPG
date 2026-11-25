# 版の番号を新しくする（スマホなどで古い JS・CSS が残らないように）
#   js_version/index.html の <meta name="app-version"> と、css・js の ?v= を新しい番号にして、js_version/version.json も同じ番号にする
#   開いているゲームは js/updater.js が version.json を見て、番号が変わっていたら読み直す
# 実行（コミットの前に）：powershell -NoProfile -ExecutionPolicy Bypass -File tools/bump_version.ps1
$root = Split-Path -Parent $PSScriptRoot
$v = Get-Date -Format 'yyyyMMddHHmm'
$html = Join-Path $root 'js_version\index.html'
$s = [IO.File]::ReadAllText($html, [Text.Encoding]::UTF8)
$s = [regex]::Replace($s, '<meta name="app-version" content="[^"]*">', "<meta name=`"app-version`" content=`"$v`">")
$s = [regex]::Replace($s, '(<link rel="stylesheet" href="css/[^"?]+\.css)(\?v=[^"]*)?"', "`$1?v=$v`"")
$s = [regex]::Replace($s, '(<script src="js/[^"?]+\.js)(\?v=[^"]*)?"', "`$1?v=$v`"")
[IO.File]::WriteAllText($html, $s, (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText((Join-Path $root 'js_version\version.json'), "{ `"v`": `"$v`" }`n", (New-Object Text.UTF8Encoding $false))
Write-Output "版の番号：$v"
