# Card Price Scanner - PowerShell HTTPサーバー
# 用途: Node.js/Python不要でローカルサーバーを起動する
# 実行: PowerShellで → .\start_server.ps1

$port   = 8080
$root   = $PSScriptRoot
$prefix = "http://localhost:$port/"

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "  [エラー] ポート $port が使用中の可能性があります。" -ForegroundColor Red
    Write-Host "  別のポートをお試しください。" -ForegroundColor Red
    Write-Host ""
    Read-Host "  Enterキーで終了"
    exit
}

Write-Host ""
Write-Host "  ✅ Card Price Scanner が起動しました！" -ForegroundColor Green
Write-Host "  🌐 http://localhost:$port" -ForegroundColor Cyan
Write-Host ""
Write-Host "  終了するには Ctrl+C を押してください" -ForegroundColor Gray
Write-Host ""

# ブラウザを自動で開く
Start-Process "http://localhost:$port"

# ── 価格スクレイピング関数 ──
function Get-ShopPrice {
    param([string]$Url, [string]$Pattern)
    try {
        $wc = New-Object System.Net.WebClient
        $wc.Encoding = [System.Text.Encoding]::UTF8
        $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        $wc.Headers.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        $wc.Headers.Add("Accept-Language", "ja,en;q=0.5")
        $html = $wc.DownloadString($Url)
        $wc.Dispose()
        if ($html -match $Pattern) {
            return $Matches[1]
        }
        return $null
    } catch {
        Write-Host "  [Price] Error fetching $Url : $_" -ForegroundColor Yellow
        return $null
    }
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $urlPath = $req.Url.LocalPath

        # ── /api/prices エンドポイント ──
        if ($urlPath -eq '/api/prices') {
            $keyword = $req.QueryString["keyword"]
            if (-not $keyword) { $keyword = "" }
            $kwEnc = [System.Uri]::EscapeDataString($keyword)

            Write-Host "  [API] Price lookup: $keyword" -ForegroundColor Cyan

            # 各ショップから並行取得（PowerShellでは順次だが十分高速）
            $results = @{}

            # メルカリ
            $mUrl = "https://jp.mercari.com/search?keyword=$kwEnc"
            $mPrice = Get-ShopPrice -Url $mUrl -Pattern '(\d{1,3}(,\d{3})*)\s*円|"price"\s*:\s*(\d+)'
            if ($mPrice) { $results["mercari"] = $mPrice } else { $results["mercari"] = $null }

            # カードラッシュ
            $crUrl = "https://www.cardrush-pokemon.jp/product-list?keyword=$kwEnc"
            $crPrice = Get-ShopPrice -Url $crUrl -Pattern '(?:販売価格|price)[^0-9]*(\d{1,3}(,\d{3})*)\s*円'
            if ($crPrice) { $results["cardrush"] = $crPrice } else { $results["cardrush"] = $null }

            # 遊々亭
            $yyUrl = "https://yuyu-tei.jp/sell/poc/s/search?search_word=$kwEnc"
            $yyPrice = Get-ShopPrice -Url $yyUrl -Pattern '(?:販売価格|price|card_price)[^0-9]*(\d{1,3}(,\d{3})*)\s*円'
            if ($yyPrice) { $results["yuyutei"] = $yyPrice } else { $results["yuyutei"] = $null }

            # ドラゴンスター
            $dsUrl = "https://dorasuta.jp/pokemon/?s=$kwEnc"
            $dsPrice = Get-ShopPrice -Url $dsUrl -Pattern '(\d{1,3}(,\d{3})*)\s*円'
            if ($dsPrice) { $results["dragonstar"] = $dsPrice } else { $results["dragonstar"] = $null }

            # 晴れる屋2
            $hrUrl = "https://www.hareruya2.com/products/search?suggest_type=all&keyword=$kwEnc"
            $hrPrice = Get-ShopPrice -Url $hrUrl -Pattern '(\d{1,3}(,\d{3})*)\s*円'
            if ($hrPrice) { $results["hareruya2"] = $hrPrice } else { $results["hareruya2"] = $null }

            # JSON構築
            $jsonParts = @()
            foreach ($key in $results.Keys) {
                $val = $results[$key]
                if ($val) {
                    $jsonParts += """$key"":""$val"""
                } else {
                    $jsonParts += """$key"":null"
                }
            }
            $jsonBody = "{" + ($jsonParts -join ",") + "}"
            $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)

            $res.StatusCode = 200
            $res.ContentType = 'application/json; charset=utf-8'
            $res.Headers.Add("Access-Control-Allow-Origin", "*")
            $res.ContentLength64 = $bodyBytes.Length
            $res.OutputStream.Write($bodyBytes, 0, $bodyBytes.Length)
            $res.Close()
            continue
        }

        # ── 静的ファイル配信 ──
        if ($urlPath -eq '/') { $urlPath = '/index.html' }

        # パストラバーサル防止
        $filePath = Join-Path $root $urlPath.TrimStart('/')
        $filePath = [System.IO.Path]::GetFullPath($filePath)

        if (-not $filePath.StartsWith($root)) {
            $res.StatusCode = 403
            $res.Close()
            continue
        }

        if (Test-Path $filePath -PathType Leaf) {
            $ext      = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mimeType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
            $content  = [System.IO.File]::ReadAllBytes($filePath)

            $res.StatusCode  = 200
            $res.ContentType = $mimeType
            $res.ContentLength64 = $content.Length
            $res.OutputStream.Write($content, 0, $content.Length)
        } else {
            $body    = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
            $res.StatusCode  = 404
            $res.ContentType = 'text/plain; charset=utf-8'
            $res.ContentLength64 = $body.Length
            $res.OutputStream.Write($body, 0, $body.Length)
        }

        $res.Close()
    }
} finally {
    $listener.Stop()
    Write-Host "  サーバーを停止しました。" -ForegroundColor Gray
}

