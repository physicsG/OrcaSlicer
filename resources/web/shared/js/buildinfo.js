/*
 * buildinfo.js - resolve and display the running build number.
 *
 * Shared by both reconstructed surfaces. It exists so a rebuilt surface is
 * visually identifiable at a glance: if the badge is showing, you are looking
 * at the reconstruction, not the shipped Flutter bundle.
 *
 * The build number is read, in order of preference:
 *   1. sw_GetSoftwareInfo over the bridge - what Orca itself reports
 *   2. the shipped bundle's version.json - correct even with no host
 *   3. a literal fallback, so the badge always renders something
 *
 * version.json is the same file the Flutter bundle reads:
 *   resources/web/flutter_web/version.json
 *   {"app_name":"orca","version":"2.3.26","build_number":"20260813142841", ...}
 *
 * The git commit cannot come from the bundle, so it is stamped separately into
 * build-stamp.json by resources/web/shared/stamp_build.py. That file is optional:
 * with it, the badge shows the commit the surfaces were built from; without it,
 * the badge simply omits the commit.
 */
'use strict';

import { CMD } from './protocol.js';

/** Used only if both the bridge and version.json are unreachable. */
const FALLBACK = { version: '2.3.26', build_number: '20260813142841', source: 'fallback' };

/** Both paths are relative to a surface served out of resources/web/<surface>/. */
const VERSION_URL = '../flutter_web/version.json';
const STAMP_URL = '../shared/build-stamp.json';

/** 20260813142841 -> 2026-08-13 14:28:41 */
export function formatBuildNumber(bn) {
  const s = String(bn || '');
  if (!/^\d{14}$/.test(s)) return s;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} `
       + `${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
}

/** Read the git stamp. Returns null when it has not been generated. */
async function readStamp() {
  try {
    const r = await fetch(STAMP_URL, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && j.commit) ? j : null;
  } catch {
    return null;
  }
}

/**
 * Resolve build info by MERGING the available sources rather than picking one.
 *
 * They carry different facts and none of them has all three:
 *   - build-stamp.json    the git commit these surfaces were built from
 *   - sw_GetSoftwareInfo  Orca's own version (it returns no build number)
 *   - version.json        the Flutter bundle's version and build number
 *
 * Never rejects: a badge showing a fallback is better than no badge, because the
 * point of it is to be visible.
 */
export async function resolveBuildInfo(bridge) {
  const info = { ...FALLBACK, sources: [] };
  info.stamp = await readStamp();
  if (info.stamp) info.sources.push('build-stamp.json');

  // The shipped bundle's own file: version + build number.
  try {
    const r = await fetch(VERSION_URL, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && j.build_number) {
        info.version = j.version || info.version;
        info.build_number = j.build_number;
        info.sources.push('version.json');
      }
    }
  } catch { /* keep the fallback */ }

  // Orca itself, when a host is present. It reports `version` but no build
  // number, so it refines the version and leaves the build number alone.
  if (bridge) {
    try {
      const d = await bridge.request(CMD.GET_SOFTWARE_INFO, {});
      if (d && (d.version || d.build_number)) {
        if (d.version) info.version = d.version;
        if (d.build_number || d.buildNumber) {
          info.build_number = d.build_number || d.buildNumber;
        }
        info.sources.push('sw_GetSoftwareInfo');
      }
    } catch { /* no host, or the command failed - keep what we have */ }
  }

  info.source = info.sources.length ? info.sources.join(' + ') : 'fallback';
  return info;
}

/**
 * Render the badge into `el`.
 *
 * `surface` names which reconstruction this is, so the two are told apart when
 * both are open - the whole point of the marker.
 */
export function renderBuildBadge(el, info, surface) {
  if (!el) return;
  const st = info.stamp;
  el.className = 'build-badge';
  el.title = `build ${info.build_number} (${formatBuildNumber(info.build_number)})`
           + `\nreported by: ${info.source}`
           + (st ? `\ncommit ${st.commit_full || st.commit}`
                 + (st.branch ? ` on ${st.branch}` : '')
                 + (st.dirty ? ' (uncommitted changes present)' : '')
                 + (st.subject ? `\n"${st.subject}"` : '')
             : '\ncommit: not stamped - run resources/web/shared/stamp_build.py');
  el.innerHTML = '';

  const add = (cls, text) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    el.appendChild(s);
    return s;
  };
  add('bb-surface', surface);
  add('bb-sep', '·');
  add('bb-version', `v${info.version}`);
  add('bb-sep', '·');
  add('bb-build', `build ${info.build_number}`);
  if (st) {
    add('bb-sep', '·');
    // A dirty tree means the running surface is not exactly this commit, so say so
    // rather than showing a hash that does not describe what is on screen.
    add('bb-commit', st.commit + (st.dirty ? '+' : ''));
  }
}

/** Resolve and render in one call. Returns the resolved info. */
export async function mountBuildBadge(el, surface, bridge) {
  const info = await resolveBuildInfo(bridge);
  renderBuildBadge(el, info, surface);
  return info;
}
