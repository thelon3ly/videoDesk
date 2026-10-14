param(
    [Parameter(Mandatory=$true)][string]$YtDlpExe,
    [Parameter(Mandatory=$true)][string]$FfmpegExe,
    [Parameter(Mandatory=$true)][string]$PythonExe,
    [string]$IsccExe
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ytDlpPath = (Resolve-Path -LiteralPath $YtDlpExe).Path
$ffmpegPath = (Resolve-Path -LiteralPath $FfmpegExe).Path
$distPath = Join-Path $projectRoot 'dist/windows7'
$buildPath = Join-Path $projectRoot 'build/windows7'
New-Item -ItemType Directory -Path $distPath, $buildPath -Force | Out-Null

& $PythonExe -m PyInstaller --noconfirm --clean --onedir --name VideoDesk `
    --distpath $distPath --workpath $buildPath --specpath $buildPath `
    --icon (Join-Path $projectRoot 'windows/videodesk.ico') `
    --add-binary "${ytDlpPath};." --add-binary "${ffmpegPath};." `
    --add-data "$(Join-Path $projectRoot 'windows/public');public" `
    (Join-Path $projectRoot 'windows/app.py')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed.' }

if ($IsccExe) {
    & (Resolve-Path -LiteralPath $IsccExe).Path (Join-Path $PSScriptRoot 'videodesk-win7.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed.' }
}
