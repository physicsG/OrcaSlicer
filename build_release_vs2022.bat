@REM Snapmaker_Orca build script for Windows
@echo off
set WP=%CD%

@REM Prefer repo-local cmake (tools\cmake\bin) over any system cmake.
@REM Run scripts\setup_tools_win.ps1 once to populate it.
@REM NOTE: avoid if()block here — parentheses in %PATH% (e.g. NVIDIA) break it.
if not exist "%WP%\tools\cmake\bin\cmake.exe" goto :skip_local_cmake
set "PATH=%WP%\tools\cmake\bin;%PATH%"
echo [build] Using local cmake: %WP%\tools\cmake\bin\cmake.exe
:skip_local_cmake

@REM Add local Perl (perl\bin only — NOT c\bin, which conflicts with cmake per CMakeLists.txt).
@REM Required for OpenSSL's deps build (perl Configure).
if not exist "%WP%\tools\perl\perl\bin\perl.exe" goto :skip_local_perl
set "PATH=%WP%\tools\perl\perl\bin;%PATH%"
echo [build] Using local Perl   : %WP%\tools\perl\perl\bin\perl.exe
:skip_local_perl

@REM Find VS Build Tools — probe in priority order, set VS_INSTANCE + VS_GENERATOR.
@REM CMAKE_GENERATOR_INSTANCE bypasses vswhere for Build-Tools-only installs.
set "VS_INSTANCE="
set "VS_GENERATOR=Visual Studio 17 2022"
if not exist "%WP%\tools\vs_buildtools\VC\Auxiliary\Build\vcvarsall.bat" goto :try_sys22_x86
set "VS_INSTANCE=%WP%\tools\vs_buildtools"
goto :found_vs
:try_sys22_x86
if not exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" goto :try_sys22_x64
set "VS_INSTANCE=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
goto :found_vs
:try_sys22_x64
if not exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" goto :try_sys19_x86
set "VS_INSTANCE=C:\Program Files\Microsoft Visual Studio\2022\BuildTools"
goto :found_vs
:try_sys19_x86
if not exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" goto :try_sys19_x64
set "VS_INSTANCE=C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools"
set "VS_GENERATOR=Visual Studio 16 2019"
goto :found_vs
:try_sys19_x64
if not exist "C:\Program Files\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" goto :found_vs
set "VS_INSTANCE=C:\Program Files\Microsoft Visual Studio\2019\BuildTools"
set "VS_GENERATOR=Visual Studio 16 2019"
:found_vs
if "%VS_INSTANCE%"=="" (
    echo [build] WARNING: no VS Build Tools found; CMake will try to auto-detect.
    goto :skip_vs_setup
)
call "%VS_INSTANCE%\VC\Auxiliary\Build\vcvarsall.bat" amd64
echo [build] Using VS Build Tools : %VS_INSTANCE%
echo [build] CMake generator      : %VS_GENERATOR%
:skip_vs_setup


@REM Pack deps
if "%1"=="pack" (
    setlocal ENABLEDELAYEDEXPANSION 
    cd %WP%/deps/build
    for /f "tokens=2-4 delims=/ " %%a in ('date /t') do set build_date=%%c%%b%%a
    echo packing deps: OrcaSlicer_dep_win64_!build_date!_vs2022.zip

    %WP%/tools/7z.exe a OrcaSlicer_dep_win64_!build_date!_vs2022.zip OrcaSlicer_dep
    exit /b 0
)

set debug=OFF
set debuginfo=OFF
if "%1"=="debug" set debug=ON
if "%2"=="debug" set debug=ON
if "%1"=="debuginfo" set debuginfo=ON
if "%2"=="debuginfo" set debuginfo=ON
if "%debug%"=="ON" (
    set build_type=Debug
    set build_dir=build-dbg
) else (
    if "%debuginfo%"=="ON" (
        set build_type=RelWithDebInfo
        set build_dir=build-dbginfo
    ) else (
        set build_type=Release
        set build_dir=build
    )
)
echo build type set to %build_type%

setlocal DISABLEDELAYEDEXPANSION 
cd deps
mkdir %build_dir%
cd %build_dir%
set DEPS=%CD%/OrcaSlicer_dep
set "SIG_FLAG="
if defined ORCA_UPDATER_SIG_KEY set "SIG_FLAG=-DORCA_UPDATER_SIG_KEY=%ORCA_UPDATER_SIG_KEY%"

if "%1"=="slicer" (
    GOTO :slicer
)
echo "building deps.."

echo on
cmake ../ -G "%VS_GENERATOR%" -A x64 -DDESTDIR="%DEPS%" -DCMAKE_BUILD_TYPE=%build_type% -DDEP_DEBUG=%debug% -DORCA_INCLUDE_DEBUG_INFO=%debuginfo% "-DCMAKE_GENERATOR_INSTANCE=%VS_INSTANCE%"
cmake --build . --config %build_type% --target deps -- -m
@echo off

if "%1"=="deps" exit /b 0

:slicer
echo "building Snapmaker Orca..."
cd %WP%
mkdir %build_dir%
cd %build_dir%

echo on
cmake .. -G "%VS_GENERATOR%" -A x64 -DBBL_RELEASE_TO_PUBLIC=1 -DORCA_TOOLS=ON %SIG_FLAG% -DCMAKE_PREFIX_PATH="%DEPS%/usr/local" -DCMAKE_INSTALL_PREFIX="./Snapmaker_Orca" -DCMAKE_BUILD_TYPE=%build_type% -DWIN10SDK_PATH="%WindowsSdkDir%Include\%WindowsSDKVersion%\" "-DCMAKE_GENERATOR_INSTANCE=%VS_INSTANCE%" "-DOPENSSL_ROOT_DIR=%DEPS%/usr/local"
cmake --build . --config %build_type% --target ALL_BUILD -- -m
@echo off
cd ..
call scripts/run_gettext.bat
cd %build_dir%
cmake --build . --target install --config %build_type%
