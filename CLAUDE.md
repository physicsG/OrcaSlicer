# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Snapmaker_Orca is an open-source 3D slicer application forked from Bambu Studio, built using C++ with wxWidgets for the GUI and CMake as the build system. The project uses a modular architecture with separate libraries for core slicing functionality, GUI components, and platform-specific code.

## Build Commands

### Building on Windows
```bash
# Build everything
build_release_vs2022.bat

# Build with debug symbols
build_release_vs2022.bat debug

# Build only dependencies
build_release_vs2022.bat deps

# Build only slicer (after deps are built)
build_release_vs2022.bat slicer


```

### Building on macOS
```bash
# Build everything (dependencies and slicer)
./build_release_macos.sh

# Build only dependencies
./build_release_macos.sh -d

# Build only slicer (after deps are built)
./build_release_macos.sh -s

# Use Ninja generator for faster builds
./build_release_macos.sh -x

# Build for specific architecture
./build_release_macos.sh -a arm64    # or x86_64 or universal

# Build for specific macOS version target
./build_release_macos.sh -t 11.3
```

### Building on Linux
```bash
# First time setup - install system dependencies
./build_linux.sh -u

# Build dependencies and slicer
./build_linux.sh -dsi

# Build everything (alternative)
./build_linux.sh -dsi

# Individual options:
./build_linux.sh -d    # dependencies only
./build_linux.sh -s    # slicer only  
./build_linux.sh -i    # build AppImage

# Performance and debug options:
./build_linux.sh -j N  # limit to N cores
./build_linux.sh -1    # single core build
./build_linux.sh -b    # debug build
./build_linux.sh -c    # clean build
./build_linux.sh -r    # skip RAM/disk checks
./build_linux.sh -l    # use Clang instead of GCC
```

### Build System
- Uses CMake with minimum version 3.13 (maximum 3.31.x on Windows)
- Primary build directory: `build/`
- Dependencies are built in `deps/build/`
- The build process is split into dependency building and main application building
- Windows builds use Visual Studio generators
- macOS builds use Xcode by default, Ninja with -x flag
- Linux builds use Ninja generator

### Testing
Tests are located in the `tests/` directory and use the Catch2 testing framework. Test structure:
- `tests/libslic3r/` - Core library tests (21 test files)
  - Geometry processing, algorithms, file formats (STL, 3MF, AMF)
  - Polygon operations, clipper utilities, Voronoi diagrams
- `tests/fff_print/` - Fused Filament Fabrication tests (12 test files)
  - Slicing algorithms, G-code generation, print mechanics
  - Fill patterns, extrusion, support material
- `tests/sla_print/` - Stereolithography tests (4 test files)
  - SLA-specific printing algorithms, support generation
- `tests/libnest2d/` - 2D nesting algorithm tests
- `tests/slic3rutils/` - Utility function tests
- `tests/sandboxes/` - Experimental/sandbox test code

Run all tests after building:
```bash
cd build && ctest
```

Run tests with verbose output:
```bash
cd build && ctest --output-on-failure
```

Run individual test suites:
```bash
# From build directory
./tests/libslic3r/libslic3r_tests
./tests/fff_print/fff_print_tests
./tests/sla_print/sla_print_tests
```

### The U1 Device page (`resources/web/device_page/`)

The reconstructed U1 web UI needs **no rebuild** — `build/resources` is a symlink to
`resources/`, the HTTP server reads files per request and sends no cache headers, so
edit and reload. Only C++ changes need `ninja`.

**Where things are.** The page has two destinations in one webview — Device control and
Storage — switched by the left rail with no reload.
[`js/registry.js`](resources/web/device_page/js/registry.js) lists them and their panels;
everything inside `.content` is built from it. **One panel is one directory**, holding all
three of its files:

```
js/views/device-control/camera/
    camera-panel.js      what it reads, and its mount/update
    camera-view.js       its DOM: built once, then patched
    camera-commands.js   everything it can ask the machine to do
```

The four control panels sit in **two unequal columns**, not a 2x2 grid: a main column
that takes what is left, and a side column pinned at `--col-w` (830) holding Control and
Filament. A panel names its own column in its declaration (`column`, `grow`); the
destination names them in `registry.js`. Below a 1600px window it is one centred column
and none of that applies.

**The Filament panel integrates with multiACE, a plugin — not with "the ACE".**
[decay71/multiACE](https://github.com/decay71/multiACE) is a third-party Klipper plugin
deployed onto a U1; the `ace` object, the macros and the override store are all its, and a
stock U1 has none of them. **Everything about it lives in one module,
[`shared/js/multiACE.js`](resources/web/shared/js/multiACE.js)** — macros and the line
builder, constants, the state model and the bay merge — named for the plugin rather than
the hardware. `MachineState.ace()` calls into it. It was spread over three files, and that
is how the panel came to read bay identity from a source that does not carry it.

**The Filament panel has two shapes and the machine picks.** A printer that reports no
`ace` Klipper object gets the four slots the page always drew; one that reports it gets
four toolhead cards, two by two, each with its own header choosing what feeds that head -
stock feeder, one of up to four ACE units, or hand-fed - the source drawn under it as a
cabinet or a feeder module, and a tube into the head's inlet. `ace` is **not** on the
subscription (that list is pinned to the shipped bundle's), so it is read on its own by
`session.refreshAce()` and re-read after anything that changes it. **What is in each BAY is not machine state.** The `ace` object carries no per-bay
identity — the raw slots read `{material:"", brand:"", rfid:0}` — and multiACE keeps the
names in an override store. Orca's Prepare page polls the merged `/multiace/api/state`
from C++ and saw filament the panel drew as `?`. nginx serves `/multiace/` with no CORS
header, but Moonraker on :7125 reflects the Origin and the store is a file under its
`config` root, so the page reads it directly: `syncBays()` → `store.aceBays`, merged with
multiACE's own precedence **rfid → override → derived**. Four things that are in
the code because hardware said so: **`head_ace` does not answer "what feeds this head"**
(resolve `head_manual` → `head_feeder` → `head_ace`, in that order); **no bay has a
level** — `spool_binding` is empty, so a disc is a colour and not a gauge; and **an `ok` is
not a yes** — `ACE_SET_AUTO_DRY THRESHOLD=` returns `ok` and changes nothing, and
`ACE_DRY DURATION=` is in **minutes**, so a dialog offering hours would have dried for
four. Every macro argument was settled by sending it and reading the object back. The macro
surface is evidence too: `tools/ace_macros.py` reads `printer.gcode.help` into
`data/ace-macros.json` and `check_coverage.py` holds its table to it. The reasoning is
[docs/u1-webui/02-device-page/10-multiace-filament.md](docs/u1-webui/02-device-page/10-multiace-filament.md);
what to build next is
[11-multiace-handover.md](docs/u1-webui/02-device-page/11-multiace-handover.md).

with `js/core/` for what every view needs (`dom`, `render`, `pending`, `store`,
`session`, `connection`, `overlay`, `diag`, `mock`, `thumbs`) and `js/widgets/` for the
rail, the trace pane and shared art. A panel is handed **its own commands and nothing
else**. Full rationale: [docs/u1-webui/02-device-page/09-restructure.md](docs/u1-webui/02-device-page/09-restructure.md).

Iterate on it with `run_webkit.py`, which drives the real page in **WebKitGTK — the
engine Orca's own webview uses**. It needs a display (WSLg provides one); playwright and
the vendored chromium do not work here.

```bash
# checks against the simulated printer, then exits
python3 resources/web/shared/tests/run_webkit.py --shots /tmp/shots

# --size matters: the two-column layout only engages at 1600 and above, so the
# default 1500 checks the single-column one instead
python3 resources/web/shared/tests/run_webkit.py --size 1920x1080

# the same page against the REAL printer, with no Orca at all
python3 resources/web/shared/tests/run_webkit.py --real --watch    # stays open
python3 resources/web/shared/tests/run_webkit.py --real --drive script.js
python3 resources/web/shared/tests/run_webkit.py --real --device-ip 192.0.2.1

# the SHIPPED Flutter bundle instead of the reconstruction (implies --real)
python3 resources/web/shared/tests/run_webkit.py --original --sn <SN> --watch
```

- `--watch` keeps the window open until it is closed, and the terminal becomes a live
  trace of what each click sends.
- `--size WxH` sets the window, which the Device page's layout depends on - see above.
- Committed drive scripts live in `resources/web/shared/tests/drive/`: the DOM walker,
  the camera panel against the simulator and against a printer, the multiACE filament
  card, and the no-printer branch. See its README - they were re-written from scratch
  every time before.
- `--drive FILE` runs JavaScript in the live page; the script reports by setting
  `window.__report`. This is how hardware behaviour gets measured rather than assumed.
- `--device-ip` points the saved device somewhere unroutable, to exercise the page with
  no printer there.
- `--original` loads the real Snapmaker bundle instead of the reconstruction, and
  reaches a connected page with live telemetry. Add `--sn <SN>`: Orca's config can hold
  stale device records and the bundle tries to connect every one it is handed. What it
  took is in `docs/u1-webui/tools/harness/README.md` - chiefly that Orca posts replies
  as a JSON **string**, which the reconstruction's client parses either way and the
  bundle does not.
- **`--real` needs Orca closed** — it authenticates with the same saved `clientId`, and
  a broker evicts the older holder. It is a second host speaking Orca's contract
  (`docs/u1-webui/tools/u1_bridge.py`), so it proves the page and the printer agree, not
  that Orca agrees.

Use it to check engine behaviour that source-text checks cannot see: focus and
selection, whether a committed value survives the next state push, layout that must not
shift, and anything about a real machine's timing.

**Every suite has been green while the page was visibly broken.** A `ReferenceError` left
the page with no motion column and all 17 browser checks passed; a rename broke `boot()`
and the simulator stayed green because the broken line was on the *not-connected* branch,
which the mock never takes. Two habits follow:

- **Dump the DOM and diff it** before and after any move — a `--drive` script that walks
  `.app` printing every tag, id, class and `data-*` answers *what is on the page* rather
  than *is this one thing right*. It caught both failures above.
- **`--real --device-ip 192.0.2.1`** forces the not-connected branch with no printer
  involved. Run it on anything touching the device record.

**`--shots` works again, and is real evidence.** It used to write blank PNGs — EGL finds
no driver under WSL, so WebKit's accelerated compositor never put anything in the window
`GdkPixbuf` was reading back, and every file was byte-identical whatever changed. An
unattended `--shots` run now renders into a `Gtk.OffscreenWindow` with
`WEBKIT_DISABLE_COMPOSITING_MODE=1`, which goes through cairo on the CPU. A `--watch` run
still gets a real window, and still gets blank PNGs with it. Pictures are worth having,
but they are still the weaker half: **the seam through a spool was 3 px out to the eye and
exactly right when measured.** Subtract two numbers.

The other suites:

```bash
python3 resources/web/shared/tests/conformance_test.py   # constants vs evidence
python3 resources/web/shared/tests/unit_jsc.py           # pure logic, in JavaScriptCore
python3 docs/u1-webui/tools/run_all.py                   # regenerate every data file
python3 docs/u1-webui/tools/check_coverage.py            # nothing unimplemented in silence
```

Start at [docs/u1-webui/STATUS.md](docs/u1-webui/STATUS.md): what is proven against
hardware, what is not, and what to pick up next.

## Architecture

### Core Libraries
- **libslic3r/**: Core slicing engine and algorithms (platform-independent)
  - Main slicing logic, geometry processing, G-code generation
  - Key classes: Print, PrintObject, Layer, GCode, Config
  - Modular design with specialized subdirectories:
    - `GCode/` - G-code generation, cooling, pressure equalization, thumbnails
    - `Fill/` - Infill pattern implementations (gyroid, honeycomb, lightning, etc.)
    - `Support/` - Tree supports and traditional support generation
    - `Geometry/` - Advanced geometry operations, Voronoi diagrams, medial axis
    - `Format/` - File I/O for 3MF, AMF, STL, OBJ, STEP formats
    - `SLA/` - SLA-specific print processing and support generation
    - `Arachne/` - Advanced wall generation using skeletal trapezoidation

- **src/slic3r/**: Main application framework and GUI
  - GUI application built with wxWidgets
  - Integration between libslic3r core and user interface
  - Located in `src/slic3r/GUI/` (not shown in this directory but exists)

### Key Algorithmic Components
- **Arachne Wall Generation**: Variable-width perimeter generation using skeletal trapezoidation
- **Tree Supports**: Organic support generation algorithm  
- **Lightning Infill**: Sparse infill optimization for internal structures
- **Adaptive Slicing**: Variable layer height based on geometry
- **Multi-material**: Multi-extruder and soluble support processing
- **G-code Post-processing**: Cooling, fan control, pressure advance, conflict checking

### File Format Support
- **3MF/BBS_3MF**: Native format with extensions for multi-material and metadata
- **STL**: Standard tessellation language for 3D models
- **AMF**: Additive Manufacturing Format with color/material support  
- **OBJ**: Wavefront OBJ with material definitions
- **STEP**: CAD format support for precise geometry
- **G-code**: Output format with extensive post-processing capabilities

### External Dependencies
- **Clipper2**: Advanced 2D polygon clipping and offsetting
- **libigl**: Computational geometry library for mesh operations
- **TBB**: Intel Threading Building Blocks for parallelization
- **wxWidgets**: Cross-platform GUI framework
- **OpenGL**: 3D graphics rendering and visualization
- **CGAL**: Computational Geometry Algorithms Library (selective use)
- **OpenVDB**: Volumetric data structures for advanced operations
- **Eigen**: Linear algebra library for mathematical operations

## File Organization

### Resources and Configuration
- `resources/profiles/` - Printer and material profiles organized by manufacturer
- `resources/printers/` - Printer-specific configurations and G-code templates  
- `resources/images/` - UI icons, logos, calibration images
- `resources/calib/` - Calibration test patterns and data
- `resources/handy_models/` - Built-in test models (benchy, calibration cubes)

### Internationalization and Localization  
- `localization/i18n/` - Source translation files (.pot, .po)
- `resources/i18n/` - Runtime language resources
- Translation managed via `scripts/run_gettext.sh` / `scripts/run_gettext.bat`

### Platform-Specific Code
- `src/libslic3r/Platform.cpp` - Platform abstractions and utilities
- `src/libslic3r/MacUtils.mm` - macOS-specific utilities (Objective-C++)
- Windows-specific build scripts and configurations
- Linux distribution support scripts in `scripts/linux.d/`

### Build and Development Tools
- `cmake/modules/` - Custom CMake find modules and utilities
- `scripts/` - Python utilities for profile generation and validation  
- `tools/` - Windows build tools (gettext utilities)
- `deps/` - External dependency build configurations

## Development Workflow

### Code Style and Standards
- **C++17 standard** with selective C++20 features
- **Naming conventions**: PascalCase for classes, snake_case for functions/variables
- **Header guards**: Use `#pragma once` 
- **Memory management**: Prefer smart pointers, RAII patterns
- **Thread safety**: Use TBB for parallelization, be mindful of shared state

### Common Development Tasks

#### Adding New Print Settings
1. Define setting in `PrintConfig.cpp` with proper bounds and defaults
2. Add UI controls in appropriate GUI components  
3. Update serialization in config save/load
4. Add tooltips and help text for user guidance
5. Test with different printer profiles

#### Modifying Slicing Algorithms  
1. Core algorithms live in `libslic3r/` subdirectories
2. Performance-critical code should be profiled and optimized
3. Consider multi-threading implications (TBB integration)
4. Validate changes don't break existing profiles
5. Add regression tests where appropriate

#### GUI Development
1. GUI code resides in `src/slic3r/GUI/` (not visible in current tree)
2. Use existing wxWidgets patterns and custom controls
3. Support both light and dark themes
4. Consider DPI scaling on high-resolution displays
5. Maintain cross-platform compatibility

#### Adding Printer Support
1. Create JSON profile in `resources/profiles/[manufacturer].json`
2. Add printer-specific start/end G-code templates
3. Configure build volume, capabilities, and material compatibility
4. Test thoroughly with actual hardware when possible
5. Follow existing profile structure and naming conventions

### Dependencies and Build System
- **CMake-based** with separate dependency building phase
- **Dependencies** built once in `deps/build/`, then linked to main application  
- **Cross-platform** considerations important for all changes
- **Resource files** embedded at build time, platform-specific handling

### Performance Considerations
- **Slicing algorithms** are CPU-intensive, profile before optimizing
- **Memory usage** can be substantial with complex models
- **Multi-threading** extensively used via TBB
- **File I/O** optimized for large 3MF files with embedded textures
- **Real-time preview** requires efficient mesh processing

## Important Development Notes

### Codebase Navigation
- Use search tools extensively - codebase has 500k+ lines
- Key entry points: `src/Snapmaker_Orca.cpp` for application startup
- Core slicing: `libslic3r/Print.cpp` orchestrates the slicing pipeline
- Configuration: `PrintConfig.cpp` defines all print/printer/material settings

### Compatibility and Stability
- **Backward compatibility** maintained for project files and profiles
- **Cross-platform** support essential (Windows/macOS/Linux)  
- **File format** changes require careful version handling
- **Profile migrations** needed when settings change significantly

### Quality and Testing
- **Regression testing** important due to algorithm complexity
- **Performance benchmarks** help catch performance regressions
- **Memory leak** detection important for long-running GUI application
- **Cross-platform** testing required before releases