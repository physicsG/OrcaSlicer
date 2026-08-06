@REM Snapmaker_Orca FAST slicer build for Windows (Ninja + sccache [+ optional lld-link]).
@REM
@REM Purpose: quick iteration builds of the slicer only. It does NOT build deps —
@REM build those once with the normal script (`build_release_vs2022.bat deps`), then
@REM use this for the edit/build/run loop.
@REM
@REM Wins vs build_release_vs2022.bat (which uses the Visual Studio / MSBuild generator):
@REM   - Ninja generator      -> much faster incremental builds
@REM   - sccache launcher      -> unchanged translation units recompile from cache
@REM   - lld-link (optional)   -> faster final link (set USE_LLD=1; needs lld-link.exe on PATH)
@REM
@REM Prereqs on PATH: ninja, sccache (winget install Ninja-build.Ninja Mozilla.sccache),
@REM and a VS 2022/2019 Build Tools install (auto-detected below, like the normal script).
@REM Uses a separate build dir (build-fast\) so it never disturbs your `build\` dir.
@echo off
setlocal
set WP=%CD%

@REM Prefer repo-local cmake, matching build_release_vs2022.bat.
if not exist "%WP%\tools\cmake\bin\cmake.exe" goto :skip_local_cmake
set "PATH=%WP%\tools\cmake\bin;%PATH%"
echo [fast] Using local cmake: %WP%\tools\cmake\bin\cmake.exe
:skip_local_cmake

@REM Require ninja and sccache.
where ninja >nul 2>&1 || (echo [fast] ERROR: ninja not found on PATH. Install: winget install Ninja-build.Ninja & exit /b 1)
where sccache >nul 2>&1 || (echo [fast] ERROR: sccache not found on PATH. Install: winget install Mozilla.sccache & exit /b 1)

@REM Find VS Build Tools and import the MSVC x64 environment (cl.exe, headers, libs).
@REM Ninja needs cl on PATH; the VS generator did this implicitly, we do it explicitly.
set "VS_INSTANCE="
if exist "%WP%\tools\vs_buildtools\VC\Auxiliary\Build\vcvarsall.bat" set "VS_INSTANCE=%WP%\tools\vs_buildtools"
if not defined VS_INSTANCE if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" set "VS_INSTANCE=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
if not defined VS_INSTANCE if exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" set "VS_INSTANCE=C:\Program Files\Microsoft Visual Studio\2022\BuildTools"
if not defined VS_INSTANCE if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" set "VS_INSTANCE=C:\Program Files\Microsoft Visual Studio\2022\Community"
if not defined VS_INSTANCE (
    echo [fast] ERROR: no VS Build Tools found. Install VS 2022 Build Tools, or run from an x64 Native Tools prompt.
    exit /b 1
)
call "%VS_INSTANCE%\VC\Auxiliary\Build\vcvarsall.bat" amd64 || exit /b 1
echo [fast] MSVC env from: %VS_INSTANCE%

@REM Deps must already exist (built once by the normal script).
set "DEPS=%WP%\deps\build\OrcaSlicer_dep"
if not exist "%DEPS%\usr\local" (
    echo [fast] ERROR: deps not found at %DEPS%\usr\local
    echo [fast]        Build them once with:  build_release_vs2022.bat deps
    exit /b 1
)

@REM Optional lld-link (fast linker). Enable with:  set USE_LLD=1
set "LLD_FLAG="
if "%USE_LLD%"=="1" (
    where lld-link >nul 2>&1 && (
        set "LLD_FLAG=-DCMAKE_LINKER_TYPE=LLD"
        echo [fast] Using lld-link
    ) || echo [fast] USE_LLD=1 but lld-link not on PATH; using default link.exe
)

set "BUILD_DIR=build-fast"
if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"

echo on
cmake -S "%WP%" -B "%WP%\%BUILD_DIR%" -G Ninja ^
  -DCMAKE_BUILD_TYPE=Release ^
  -DBBL_RELEASE_TO_PUBLIC=1 -DORCA_TOOLS=ON ^
  -DCMAKE_PREFIX_PATH="%DEPS%/usr/local" ^
  -DOPENSSL_ROOT_DIR="%DEPS%/usr/local" ^
  -DCMAKE_INSTALL_PREFIX="./Snapmaker_Orca" ^
  -DCMAKE_C_COMPILER_LAUNCHER=sccache ^
  -DCMAKE_CXX_COMPILER_LAUNCHER=sccache ^
  %LLD_FLAG% || (@echo off & echo [fast] configure failed & exit /b 1)

cmake --build "%WP%\%BUILD_DIR%" --target Snapmaker_Orca
@echo off

echo [fast] Done. Binary under %BUILD_DIR%\src\ ; sccache stats:
sccache --show-stats
endlocal
