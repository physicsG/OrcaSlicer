/*
 * commands/util.js - the one thing two command modules genuinely share.
 *
 * Kept to one function on purpose. Anything that lands here is something two panels
 * both need, which is worth noticing rather than letting spread.
 */
'use strict';

/** Thumbnail responses vary by firmware; sniff the plausible shapes. */
/**
 * Pull image bytes out of a thumbnail reply, if it has any.
 *
 * `server.files.thumbnails_base64` puts them in `data`; `thumbnail_base64` is the
 * timelapse listing's spelling. `server.files.thumbnails` and the directory listing
 * carry only `thumbnail_path` / `relative_path`, which are paths on the printer and
 * not bytes - this returns null for those rather than handing a filename to an <img>
 * that would render it as a broken image.
 */
export function pickThumb(r) {
  if (!r) return null;
  const d = r.data !== undefined ? r.data : r;
  if (typeof d === 'string' && d.length > 64) return d;
  if (Array.isArray(d) && d.length) return pickThumb(d[0]);
  for (const k of ['thumbnail_base64', 'thumbnail', 'thumb', 'image', 'base64', 'data']) {
    const v = d && d[k];
    if (typeof v === 'string' && v.length > 64) return v;
    if (Array.isArray(v) && v.length) return pickThumb(v[0]);
  }
  return null;
}
