param(
    [int]$StartPort = 8080,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$RootWithSeparator = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

function Find-AvailablePort {
    param([int]$FirstPort)

    for ($port = $FirstPort; $port -lt ($FirstPort + 50); $port++) {
        $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
        try {
            $probe.Start()
            return $port
        }
        catch {
            # Try the next port.
        }
        finally {
            $probe.Stop()
        }
    }

    throw "No available port found between $FirstPort and $($FirstPort + 49)."
}

function Get-ContentType {
    param([string]$Path)

    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.js' { 'application/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.geojson' { 'application/geo+json; charset=utf-8' }
        '.kml' { 'application/vnd.google-earth.kml+xml; charset=utf-8' }
        '.xml' { 'application/xml; charset=utf-8' }
        '.png' { 'image/png' }
        '.jpg' { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.svg' { 'image/svg+xml' }
        '.zip' { 'application/zip' }
        default { 'application/octet-stream' }
    }
}

$port = Find-AvailablePort -FirstPort $StartPort
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()
$url = "http://127.0.0.1:$port/index.html"

Write-Host ('=' * 60)
Write-Host '  GeoCanvas GIS tool started (Windows built-in server)'
Write-Host "  Open in browser: $url"
Write-Host '  Press Ctrl+C to stop the server'
Write-Host ('=' * 60)

if (-not $NoBrowser) {
    try {
        Start-Process $url
    }
    catch {
        Write-Warning "Could not open the browser automatically. Open this URL manually: $url"
    }
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $null
        $reader = $null
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)
            $requestLine = $reader.ReadLine()
            while (($headerLine = $reader.ReadLine()) -ne $null -and $headerLine -ne '') { }

            if ($requestLine -notmatch '^(GET|HEAD)\s+([^\s]+)\s+HTTP/') {
                $status = 'HTTP/1.1 405 Method Not Allowed'
                $methodNotAllowed = [System.Text.Encoding]::ASCII.GetBytes("$status`r`nContent-Length: 0`r`nConnection: close`r`n`r`n")
                $stream.Write($methodNotAllowed, 0, $methodNotAllowed.Length)
                continue
            }

            $method = $Matches[1]
            $requestPath = [System.Uri]::UnescapeDataString(($Matches[2] -split '\?')[0]).TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($requestPath)) {
                $requestPath = 'index.html'
            }

            $localPath = [System.IO.Path]::GetFullPath((Join-Path $Root $requestPath))
            if (-not $localPath.StartsWith($RootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $localPath -PathType Leaf)) {
                $notFound = [System.Text.Encoding]::ASCII.GetBytes("HTTP/1.1 404 Not Found`r`nContent-Length: 0`r`nConnection: close`r`n`r`n")
                $stream.Write($notFound, 0, $notFound.Length)
                continue
            }

            $bytes = [System.IO.File]::ReadAllBytes($localPath)
            $headers = "HTTP/1.1 200 OK`r`nContent-Type: $(Get-ContentType -Path $localPath)`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            if ($method -eq 'GET') {
                $stream.Write($bytes, 0, $bytes.Length)
            }
        }
        catch {
            try {
                if ($stream) {
                    $failure = [System.Text.Encoding]::ASCII.GetBytes("HTTP/1.1 500 Internal Server Error`r`nContent-Length: 0`r`nConnection: close`r`n`r`n")
                    $stream.Write($failure, 0, $failure.Length)
                }
            }
            catch { }
            Write-Warning "Request failed: $($_.Exception.Message)"
        }
        finally {
            if ($reader) { $reader.Dispose() }
            if ($client) { $client.Close() }
        }
    }
}
finally {
    $listener.Stop()
}
