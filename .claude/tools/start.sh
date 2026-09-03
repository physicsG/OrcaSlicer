#!/usr/bin/env bash
# Entry point for the multiACE dev tools. Runnable from a terminal or from VS Code
# (Ctrl+Shift+P → "Tasks: Run Task" → any "multiACE: …" task; see .vscode/tasks.json).
#
#   ./.claude/tools/start.sh status          regenerate the build status page
#   ./.claude/tools/start.sh open            …and open it in a browser
#   ./.claude/tools/start.sh watch [secs]    refresh until the build finishes, then report
#   ./.claude/tools/start.sh check <page>    load a page in WebKit, report JS errors
#   ./.claude/tools/start.sh review [pages]  re-inject the click-to-annotate overlay
#   ./.claude/tools/start.sh mockups         open every mockup in a browser
#   ./.claude/tools/start.sh run [--debug]   run Orca with the crash catcher armed
#   ./.claude/tools/start.sh trace           resolve the last captured crash to source lines
#   ./.claude/tools/start.sh headless        run Orca on a virtual display (Xvfb), catcher armed
#   ./.claude/tools/start.sh shot [out.png]  screenshot the virtual display
#   ./.claude/tools/start.sh click <x> <y>   click on the virtual display
#   ./.claude/tools/start.sh stop            stop the headless instance and Xvfb
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PAGE="$HERE/build-status.html"
BIN="$HERE/bin"
CRASH="${CRASH_LOG:-/tmp/orca_crash.log}"
HDISPLAY="${ORCA_HEADLESS_DISPLAY:-:99}"     # :0 is the user's real session - never touch it
HSIZE="${ORCA_HEADLESS_SIZE:-1600x1000}"
HDATA="/tmp/orca-headless-datadir"
HCRASH="/tmp/orca_headless_crash.log"

c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
ok()   { c '0;32' "  $*"; }
warn() { c '0;33' "  $*"; }
err()  { c '0;31' "  $*"; }

# WSL has no xdg-open; explorer.exe takes a Windows path.
open_file() {
  local f="$1"
  if command -v wslview >/dev/null 2>&1;      then wslview "$f"; return; fi
  if command -v xdg-open >/dev/null 2>&1;     then xdg-open "$f" >/dev/null 2>&1 & return; fi
  if command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$(wslpath -w "$f")" >/dev/null 2>&1 || true; return; fi
  warn "no opener found — the file is at: $f"
}

# Match ninja by process name: `cmake --build` is just a wrapper, and a build whose
# wrapper died (or was killed) still has a live ninja doing the work.
building() { pgrep -x ninja >/dev/null 2>&1; }

status() {
  python3 "$HERE/build_status.py" --probe || return 1
  if building; then warn "a build is running"; else ok "no build running"; fi
  ok "page: $PAGE"
}

# Compile the WebKit page checker on demand; it needs gtk3 + webkit2gtk dev packages.
ensure_pagecheck() {
  mkdir -p "$BIN"
  if [ -x "$BIN/pagecheck" ] && [ "$BIN/pagecheck" -nt "$HERE/pagecheck.c" ]; then return 0; fi
  if ! pkg-config --exists gtk+-3.0 webkit2gtk-4.1 2>/dev/null; then
    err "missing dev packages: sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev"
    return 1
  fi
  gcc -O0 -g -o "$BIN/pagecheck" "$HERE/pagecheck.c" \
      $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1) || return 1
  ok "built $BIN/pagecheck"
}

# There is no gdb here, so crashes are caught by an LD_PRELOAD signal handler instead.
ensure_catcher() {
  mkdir -p "$BIN"
  if [ -f "$BIN/crash_catcher.so" ] && [ "$BIN/crash_catcher.so" -nt "$HERE/crash_catcher.c" ]; then return 0; fi
  gcc -O0 -g -shared -fPIC -o "$BIN/crash_catcher.so" "$HERE/crash_catcher.c" -ldl || return 1
  ok "built $BIN/crash_catcher.so"
}

# Screenshots exist so a GUI crash can be seen here rather than described over chat.
ensure_xshot() {
  mkdir -p "$BIN"
  if [ -x "$BIN/xshot" ] && [ "$BIN/xshot" -nt "$HERE/xshot.c" ]; then return 0; fi
  gcc -O2 -o "$BIN/xshot" "$HERE/xshot.c" -lX11 -lz || return 1
  ok "built $BIN/xshot"
}

case "${1:-help}" in
  status) status ;;

  open)   status; open_file "$PAGE" ;;

  watch)
    every="${2:-10}"   # under the page's 15s meta-refresh, so a reload always sees fresh state
    if ! building; then warn "nothing is building — reporting current state"; fi
    while building; do status >/dev/null; sleep "$every"; done
    status
    for log in /tmp/orca_build*.log; do
      [ -f "$log" ] || continue
      n=$(grep -c 'error:' "$log" 2>/dev/null || echo 0)
      [ "$n" = 0 ] && ok "$(basename "$log"): clean" || err "$(basename "$log"): $n errors"
    done
    ;;

  check)
    page="${2:-}"
    [ -z "$page" ] && { err "usage: start.sh check <page.html>"; exit 2; }
    [ -f "$page" ] || { err "no such file: $page"; exit 2; }
    ensure_pagecheck || exit 1
    GDK_BACKEND=x11 timeout 90 "$BIN/pagecheck" "$(realpath "$page")" \
      "document.body.innerText.length + ' chars rendered'" 2>&1 |
      grep -E "CONSOLE|js_error|probe =" || warn "no output (page may not have rendered)"
    ;;

  review)
    shift || true
    python3 "$HERE/inject_review.py" "$@"
    ;;

  mockups)
    for m in "$REPO"/docs/ace-mmu/*mockup*.html; do [ -f "$m" ] && open_file "$m"; done
    ;;

  headless)
    # Reproduce GUI crashes without a human at the keyboard: Xvfb provides a display,
    # xdotool clicks, xshot screenshots. The datadir is a COPY of the real config, so a
    # test instance cannot disturb presets - and can run while the real Orca is open.
    shift || true
    command -v Xvfb >/dev/null || { err "needs: sudo apt install -y xvfb xdotool"; exit 1; }
    ensure_catcher || exit 1
    ensure_xshot   || exit 1
    exe="$REPO/build/src/Release/snapmaker-orca"
    [ -x "$exe" ] || { err "no Release binary"; exit 2; }

    if ! DISPLAY=$HDISPLAY xdotool getdisplaygeometry >/dev/null 2>&1; then
      setsid nohup Xvfb "$HDISPLAY" -screen 0 "${HSIZE}x24" -nolisten tcp > /tmp/xvfb.log 2>&1 < /dev/null &
      sleep 3
      ok "Xvfb on $HDISPLAY ($HSIZE)"
    else
      ok "Xvfb already on $HDISPLAY"
    fi

    if [ ! -d "$HDATA" ]; then
      cp -r "$HOME/.config/Snapmaker_Orca" "$HDATA" 2>/dev/null && ok "copied config to $HDATA"
    fi

    : > "$HCRASH"
    # THROW_LOG=1 records every C++ throw site: an exception escaping a wx handler aborts
    # during teardown, so the crash backtrace alone shows only destructors.
    setsid nohup env DISPLAY="$HDISPLAY" GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 \
      CRASH_LOG="$HCRASH" THROW_LOG="${THROW_LOG:-}" LD_PRELOAD="$BIN/crash_catcher.so" \
      "$exe" --datadir "$HDATA" "$@" > /tmp/orca_headless.log 2>&1 < /dev/null &
    ok "starting; give it ~30s, then: start.sh shot"
    warn "crashes land in $HCRASH -> start.sh trace $HCRASH"
    ;;

  shot)
    ensure_xshot || exit 1
    "$BIN/xshot" "${2:-/tmp/orca_screen.png}" "$HDISPLAY"
    ;;

  click)
    [ $# -ge 3 ] || { err "usage: start.sh click <x> <y>"; exit 2; }
    # The first click into an unfocused window is swallowed, so focus then click.
    DISPLAY=$HDISPLAY xdotool mousemove "$2" "$3"; sleep 0.4
    DISPLAY=$HDISPLAY xdotool click --delay 120 1
    ok "clicked $2,$3"
    ;;

  stop)
    # Safe to match plainly: this script's own cmdline is "bash start.sh stop", so the
    # pattern lives in the file, not in a command line that pkill could match.
    pkill -f "datadir $HDATA"  2>/dev/null && ok "stopped Orca" || warn "no headless Orca"
    pkill -f "Xvfb $HDISPLAY"  2>/dev/null && ok "stopped Xvfb" || warn "no Xvfb"
    ;;

  run)
    shift || true
    cfg=Release
    if [ "${1:-}" = "--debug" ]; then cfg=Debug; shift; fi
    exe="$REPO/build/src/$cfg/snapmaker-orca"
    [ -x "$exe" ] || { err "no $cfg binary at $exe"; exit 2; }
    ensure_catcher || exit 1
    : > "$CRASH"
    ok "$cfg build, crash catcher armed -> $CRASH"
    warn "reproduce the crash, then run: ./.claude/tools/start.sh trace"
    CRASH_LOG="$CRASH" LD_PRELOAD="$BIN/crash_catcher.so" GDK_BACKEND=x11 "$exe" "$@"
    st=$?
    if grep -q "FATAL signal" "$CRASH" 2>/dev/null; then err "crash captured (exit $st)"; else ok "exited $st, no crash captured"; fi
    ;;

  trace)
    log="${2:-$CRASH}"
    [ -f "$log" ] || { err "no crash log at $log"; exit 2; }
    grep -q "FATAL signal" "$log" || { warn "no crash recorded in $log"; exit 0; }
    grep -E "^=== FATAL" "$log" | tail -1
    # Frames are module+offset; addr2line turns them into file:line, inlines included.
    grep -E "^#[0-9]+ +[./]" "$log" | while read -r frame modoff sym; do
      mod="${modoff%%+0x*}"; off="0x${modoff##*+0x}"
      # A relative path means the app was launched as ./build/... - resolve from the repo.
      case "$mod" in ./*) mod="$REPO/${mod#./}" ;; esac
      src=""
      [ -f "$mod" ] && src=$(addr2line -e "$mod" -f -C -i "$off" 2>/dev/null | paste -sd' <- ' - )
      case "$src" in ""|*"??"*) src="${sym:-?}" ;; esac
      printf '%-5s %-24s %s\n' "$frame" "$(basename "$mod")" "$src"
    done
    echo
    sed -n '/--- registers/,/=== end/p' "$log" | tail -40
    ;;

  *)
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    ;;
esac
