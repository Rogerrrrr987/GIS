$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $candidatePaths = @(
        "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin",
        "C:\Program Files\nodejs",
        "C:\Program Files (x86)\nodejs"
    )
    foreach ($p in $candidatePaths) {
        if (Test-Path (Join-Path $p "node.exe")) {
            $env:PATH = "$p;$env:PATH"
            break
        }
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'Node.js was not found. Install Node.js to run tests, or use run_gis.bat to start the application.'
}

$testFiles = @(
    'test_p2.js',
    'test_security.js',
    'test_geoprocessing.js',
    'test_i18n.js',
    'test_phase2_ui.js'
)

foreach ($testFile in $testFiles) {
    Write-Host "`n=== $testFile ===" -ForegroundColor Cyan
    & node $testFile
    if ($LASTEXITCODE -ne 0) {
        Write-Error "$testFile failed with exit code $LASTEXITCODE."
    }
}

Write-Host "`nAll offline tests passed." -ForegroundColor Green
