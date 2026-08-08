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
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PAGE="$REPO/docs/ace-mmu/build-status.html"
BIN="$HERE/bin"

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

building() { pgrep -f "cmake --build build" >/dev/null 2>&1; }

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

case "${1:-help}" in
  status) status ;;

  open)   status; open_file "$PAGE" ;;

  watch)
    every="${2:-20}"
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

  *)
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    ;;
esac
