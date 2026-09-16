$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'Node.js was not found. Install Node.js to run tests, or use run_gis.bat to start the application.'
}

$testFiles = @(
    'test_p2.js',
    'test_security.js',
    'test_geoprocessing.js',
    'test_i18n.js'
)

foreach ($testFile in $testFiles) {
    Write-Host "`n=== $testFile ===" -ForegroundColor Cyan
    & node $testFile
    if ($LASTEXITCODE -ne 0) {
        Write-Error "$testFile failed with exit code $LASTEXITCODE."
    }
}

Write-Host "`nAll offline tests passed." -ForegroundColor Green
