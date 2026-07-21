# scripts/setup_tools_win.ps1
#
# Downloads build tools required for Windows builds into tools\ so the correct
# versions are used regardless of what is installed system-wide.
#
# Run once before building:
#   .\scripts\setup_tools_win.ps1
#
# Then build normally:
#   .\build_release_vs2022.bat

$ErrorActionPreference = 'Stop'
$root     = Split-Path $PSScriptRoot -Parent
$toolsDir = Join-Path $root 'tools'

# ── CMake 3.28.6 ────────────────────────────────────────────────────────────
# Must stay in the 3.13–3.31.x range; CMakeLists.txt hard-rejects 4.x on Windows.
# Matches the version pinned in the GitHub Actions CI workflow (~3.28.0).
$cmakeVer = '3.28.6'
$cmakeDir = Join-Path $toolsDir 'cmake'
$cmakeBin = Join-Path $cmakeDir 'bin\cmake.exe'

if (Test-Path $cmakeBin) {
    $installed = & $cmakeBin --version | Select-Object -First 1
    Write-Host "cmake already present: $installed" -ForegroundColor Green
} else {
    $url = "https://github.com/Kitware/CMake/releases/download/v$cmakeVer/cmake-$cmakeVer-windows-x86_64.zip"
    $zip = Join-Path $env:TEMP "cmake-$cmakeVer-windows-x86_64.zip"

    Write-Host "Downloading CMake $cmakeVer from GitHub..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

    Write-Host "Extracting to $cmakeDir ..."
    $tmp = Join-Path $env:TEMP "cmake-$cmakeVer-extract"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force

    # The zip contains a single top-level folder: cmake-3.28.6-windows-x86_64\
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (Test-Path $cmakeDir) { Remove-Item $cmakeDir -Recurse -Force }
    Move-Item $inner.FullName $cmakeDir

    Remove-Item $zip  -Force
    Remove-Item $tmp  -Recurse -Force

    Write-Host "CMake $cmakeVer installed to $cmakeDir" -ForegroundColor Green
}

# ── Strawberry Perl (portable) ───────────────────────────────────────────────
# Required by the OpenSSL deps build: its Windows configure step is a Perl script.
# Only perl\bin is added to PATH (not c\bin) to avoid the cmake/strawberry conflict
# documented in CMakeLists.txt.
$perlVer  = '5.32.1.1'
$perlDir  = Join-Path $toolsDir 'perl'
$perlBin  = Join-Path $perlDir 'perl\bin\perl.exe'

if (Test-Path $perlBin) {
    $installed = & $perlBin --version 2>&1 | Select-String 'This is perl'
    Write-Host "Perl already present: $installed" -ForegroundColor Green
} else {
    $url = "https://strawberryperl.com/download/$perlVer/strawberry-perl-$perlVer-64bit-portable.zip"
    $zip = Join-Path $env:TEMP "strawberry-perl-$perlVer.zip"

    Write-Host "Downloading Strawberry Perl $perlVer (~145 MB)..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

    Write-Host "Extracting to $perlDir ..."
    if (Test-Path $perlDir) { Remove-Item $perlDir -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $perlDir -Force
    Remove-Item $zip -Force

    Write-Host "Strawberry Perl $perlVer installed to $perlDir" -ForegroundColor Green
}

# ── Visual Studio Build Tools 2022 ──────────────────────────────────────────
# Installs to tools\vs_buildtools so the VS17 generator works without a
# system-wide VS IDE install.  ~3–5 GB download; takes 10–30 minutes.
# Components:
#   VCTools               — MSVC v143 compiler + C++ core
#   VC.ATL                — ATL (needed by some deps)
#   Windows11SDK.22000    — Windows 11 SDK (also covers Win10 targets)
#   + --includeRecommended adds CMake integration, testing tools, etc.
$vsDir     = Join-Path $toolsDir 'vs_buildtools'
$vcvarsAll = Join-Path $vsDir 'VC\Auxiliary\Build\vcvarsall.bat'

if (Test-Path $vcvarsAll) {
    Write-Host "VS Build Tools 2022 already present at $vsDir" -ForegroundColor Green
} else {
    $bsUrl = 'https://aka.ms/vs/17/release/vs_BuildTools.exe'
    $bs    = Join-Path $env:TEMP 'vs_BuildTools_2022.exe'

    Write-Host "Downloading VS Build Tools 2022 bootstrapper (~1.5 MB)..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $bsUrl -OutFile $bs -UseBasicParsing

    Write-Host "Installing VS Build Tools 2022 to $vsDir" -ForegroundColor Cyan
    Write-Host "  (downloads ~3-5 GB of compiler components; takes 10-30 min)" -ForegroundColor Yellow

    $args = @(
        '--installPath',    $vsDir,
        '--add',            'Microsoft.VisualStudio.Workload.VCTools',
        '--add',            'Microsoft.VisualStudio.Component.VC.ATL',
        '--add',            'Microsoft.VisualStudio.Component.Windows11SDK.22000',
        '--includeRecommended',
        '--quiet', '--wait', '--norestart'
    )
    $proc = Start-Process -FilePath $bs -ArgumentList $args -Wait -PassThru

    Remove-Item $bs -Force -ErrorAction SilentlyContinue

    # 0 = success, 3010 = success but reboot recommended (safe to ignore)
    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
        throw "VS Build Tools installer failed with exit code $($proc.ExitCode)"
    }
    Write-Host "VS Build Tools 2022 installed to $vsDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "All tools ready.  Build with:" -ForegroundColor Yellow
Write-Host "  .\build_release_vs2022.bat          (Release)" -ForegroundColor Yellow
Write-Host "  .\build_release_vs2022.bat debug     (Debug)" -ForegroundColor Yellow
Write-Host "  .\build_release_vs2022.bat deps      (deps only)" -ForegroundColor Yellow
Write-Host "  .\build_release_vs2022.bat slicer    (slicer only, after deps)" -ForegroundColor Yellow
