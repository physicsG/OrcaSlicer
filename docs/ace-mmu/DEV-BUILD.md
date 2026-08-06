# Fast dev build (ACE MMU iteration)

Reproducible fast build/run loop used while developing the ACE MMU feature.
The **first** full build is slow (~30 min) regardless; these steps make every
*incremental* rebuild fast (~15 s here) so the edit → build → run loop is quick.

## Linux / WSL — mold + ccache

Prereqs (once): `sudo apt install -y mold ccache` (plus the normal deps from
`./build_linux.sh -u` and a completed `./build_linux.sh -d`).

**Configure `build/` to use ccache + mold** (once; re-run only if flags change).
Triggers one full recompile that warms ccache (~28 min, peak RAM ~4.5 GB):

```bash
cmake -S . -B build -G "Ninja Multi-Config" \
  -DSLIC3R_PCH=ON \
  -DCMAKE_PREFIX_PATH="$PWD/deps/build/destdir/usr/local" \
  -DSLIC3R_STATIC=1 -DORCA_TOOLS=ON \
  -DBBL_RELEASE_TO_PUBLIC=1 -DBBL_INTERNAL_TESTING=0 \
  -DBUILD_TESTS=ON -DSLIC3R_GTK=3 \
  -DCMAKE_C_COMPILER_LAUNCHER=ccache \
  -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
  -DCMAKE_EXE_LINKER_FLAGS="-fuse-ld=mold"
```
(`CMAKE_POLICY_VERSION_MINIMUM=3.5` may be needed in the env for older CMake policy.)

**Iterate** (fast — recompiles only changed TUs, then a mold link):
```bash
cmake --build build --config Release --target Snapmaker_Orca -j 8   # app  (~15 s incremental)
cmake --build build --config Release --target libslic3r_tests -j 8  # tests
./build/tests/libslic3r/Release/libslic3r_tests "[ace_mmu]"         # run ACE tests
```

**Run** (WSLg): `GDK_BACKEND=x11 ./build/src/Release/snapmaker-orca`
(if the 3D view is black, add `LIBGL_ALWAYS_SOFTWARE=1`.)

**Keep rebuilds tiny:** put ACE logic in the small `src/libslic3r/AceMmuState.hpp`
and `src/slic3r/GUI/AceMmu*` files. Editing `Plater.cpp` / `DeviceManager.cpp`
recompiles a huge TU (minutes); the small files recompile in seconds so you only
pay the ~15 s mold link.

Measured: 28 min first/warm build; **~15 s** incremental (one small file + mold link).

### Why a rebuild is sometimes long again
Editing a **widely-included header** invalidates every TU that includes it, so ccache
can't help (their input changed) and hundreds of files recompile. Examples in this
tree: `MainFrame.hpp` (~93 includers), `GUI_App.hpp` / `DeviceManager.hpp` (more).
A `.cpp` edit only recompiles that one TU. Keep changes in `.cpp` files and the
narrow `AceMmu*` headers; when a header edit is unavoidable (e.g. adding a member to
`MainFrame`), it's a one-time broad rebuild — the next `.cpp`-only edit is fast again.
The Snapmaker-account persistence was implemented as free functions in a tiny
`SMAccountPersist.hpp` (not `GUI_App.hpp`) specifically to avoid that fan-out.

## Windows — Ninja + sccache (+ optional lld-link)

Use [`../../build_fast_win.bat`](../../build_fast_win.bat) (canonical
`build_release_vs2022.bat` is left untouched). It builds the **slicer only** into a
separate `build-fast\` dir.

Prereqs (once): `winget install Ninja-build.Ninja Mozilla.sccache`, and build deps
once with `build_release_vs2022.bat deps`.

```bat
build_fast_win.bat            REM Ninja + sccache
set USE_LLD=1 & build_fast_win.bat   REM also use lld-link (needs lld-link.exe on PATH)
```

> The Windows script is unverified on Windows from this dev environment — confirm it
> before relying on it. For day-to-day ACE iteration the WSL loop above is fastest.
