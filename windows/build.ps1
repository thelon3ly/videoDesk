param(
    [Parameter(Mandatory=$true)][string]$YtDlpExe,
    [Parameter(Mandatory=$true)][string]$FfmpegExe,
    [string]$PythonExe = 'python',
    [string]$IsccExe
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ytDlpPath = (Resolve-Path -LiteralPath $YtDlpExe).Path
$ffmpegPath = (Resolve-Path -LiteralPath $FfmpegExe).Path
$distPath = Join-Path $projectRoot 'dist/windows'
$buildPath = Join-Path $projectRoot 'build/windows'
New-Item -ItemType Directory -Path $distPath, $buildPath -Force | Out-Null

& $PythonExe -m PyInstaller --noconfirm --clean --onedir --name VideoDesk `
    --distpath $distPath --workpath $buildPath --specpath $buildPath `
    --icon (Join-Path $PSScriptRoot 'videodesk.ico') `
    --add-binary "${ytDlpPath};." --add-binary "${ffmpegPath};." `
    --add-data "$(Join-Path $PSScriptRoot 'public');public" `
    (Join-Path $PSScriptRoot 'app.py')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed.' }

if ($IsccExe) {
    & (Resolve-Path -LiteralPath $IsccExe).Path (Join-Path $PSScriptRoot 'videodesk.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed.' }
}
