# The build badge

Both reconstructed surfaces render a small badge in the bottom-right corner naming the
surface, the version, the bundle build number and the git commit:

```
Device · v2.3.26 · build 20260813142841 · 40ce3f0c38+
Print processing · v2.3.26 · build 20260813142841 · 40ce3f0c38+
```

A trailing `+` on the commit means the working tree had uncommitted changes when the
stamp was written — so what is on screen is not exactly that commit.

## Why it exists

It is a **visual marker for telling a reconstruction apart from the shipped Flutter
bundle**. The reconstructions imitate the real surfaces closely enough that a screenshot
alone is ambiguous; the badge removes the ambiguity at a glance, and names which of the
two surfaces you are looking at.

It is deliberately the smallest possible change that is still unmissable: one fixed
element, no layout shift, no interaction.

## Where the number comes from

`shared/js/buildinfo.js` **merges** three sources rather than picking one, because none
of them carries all three facts:

| Source | Supplies | When |
|---|---|---|
| `../shared/build-stamp.json` | the git commit, branch, dirty flag | when stamped — see below |
| `../flutter_web/version.json` | bundle version + build number | always; it ships in the repo |
| `sw_GetSoftwareInfo` | Orca's own version | only with a real host |

The ordering matters. `sw_GetSoftwareInfo` returns a `version` but **no** build number,
so it refines the version and leaves the build number to `version.json`. An earlier
version of this code treated the sources as exclusive and paired Orca's real version
with a hard-coded fallback build number — which looked right and was wrong.

The commit cannot come from the bundle, so it is stamped into a small JSON file:

```bash
python3 resources/web/shared/stamp_build.py
```

Re-run it after committing. The stamp is optional — without it the badge simply omits
the commit.

```json
{"app_name":"orca","version":"2.3.26","build_number":"20260813142841","package_name":"orca"}
```

Hovering the badge shows the source it resolved from and the build number formatted as a
timestamp (`2026-08-13 14:28:41`).

## Verifying a rebuild

1. Open either surface — in Orca, or standalone with `?mock=1`.
2. The badge names the surface and the build.
3. Change `build_number` in `resources/web/flutter_web/version.json`, reload with no host,
   and the badge follows — which confirms the page is reading the real file rather than a
   baked-in constant.
4. For the commit: make a commit, re-run `stamp_build.py`, reload. The hash follows and
   the `+` disappears once the tree is clean.

Inside Orca, the badge is also how you tell the reconstruction from the shipped Flutter
page — see [serving the reconstructions in Orca](03-serving-in-orca.md).

## Implementation

Both surfaces mount it identically, which is the point:

```js
import { mountBuildBadge } from '../../shared/js/buildinfo.js';
mountBuildBadge(ui.$('#build-badge'), 'Device', bridge);            // device_page
mountBuildBadge(ui.$('#build-badge'), 'Print processing', bridge);  // print_processing
```

Styling lives in `shared/css/base.css` under `.build-badge`. A surface that overrides
`:root` wholesale — as the Device tab does for its dark look — must alias the shared
tokens (`--ink`, `--ink-2`, `--accent-in`) or the badge inherits mismatched text colours.
