/*
 * commands/storage.js - Commands Storage issues, across all four of its kinds.
 *
 * Recordings, finished prints and two file roots are four different sources behind one
 * grid, so this is where they are made to look alike.
 *
 * Thumbnails have two commands and only one of them returns bytes:
 * server.files.thumbnails answers with PATHS, and the base64 lives behind
 * server.files.thumbnails_base64. Asking the first and reading it as the second is why a
 * real printer showed no thumbnail at all.
 *
 * check_coverage.py reads the CMD references out of this file to answer "can a user
 * reach this command", and attributes them to the storage panel because this is the module
 * that panel is handed. That makes the attribution a fact about the imports rather than
 * a promise in a declaration - which is the difference that let a handler nothing called
 * count as implemented for as long as it did.
 */
'use strict';

import { CMD, timelapseUrl }
  from '../../../../../shared/js/protocol.js';
import { openDialog } from '../../../core/overlay.js';
import { pickThumb } from '../../../core/thumbs.js';

export function create(deps) {
  // `bridge` is deliberately NOT destructured: it does not exist yet when these are
  // built - boot() decides between the real host and the simulator - so it is reached
  // through deps each time rather than captured as null once.
  const { state, store, pending, session, cmd,
          send, setpoint, setStatus, render } = deps;

  const HISTORY_PAGE = 20;

  /** The root each file-backed kind reads from. */
  const STORAGE_ROOT = { gcodes: 'gcodes', logs: 'logs' };

  /** Watch a machine-file transfer until it stops moving. */
  async function pollTransfer() {
    for (let i = 0; i < 60; i++) {
      let st;
      try { st = await deps.bridge.request(CMD.FILE_STATUS, {}); } catch { return; }
      const pct = Number(st && (st.progress ?? st.percent));
      if (Number.isFinite(pct)) {
        setStatus(`transfer ${Math.round(pct > 1 ? pct : pct * 100)}%`);
        if (pct >= 1 || pct >= 100) { setStatus('transfer complete', 'ok'); return; }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  /**
   * What Storage is showing, in the one shape its grid reads.
   *
   * Four different sources - recordings, store.history, and two file roots - normalised here
   * rather than in the renderer, so the store.view stays one thing.
   */
  function storageData() {
    if (store.storageKind === 'timelapses') {
      return { items: store.cam.timelapses || [], loading: false, error: store.cam.error || '' };
    }
    if (store.storageKind === 'prints') {
      return { items: store.history.items || [], loading: store.history.loading,
               error: store.history.error, hasMore: store.history.hasMore };
    }
    return { items: store.files.items || [], loading: store.files.loading, error: store.files.error };
  }

  function openStorage(kind) {
    store.storageKind = kind;
    // No cache to bust: the rebuild guard is keyed on `kind:shape`, so changing kind
    // rebuilds by construction rather than by remembering to invalidate something.
    if (kind === 'timelapses') cmd.loadTimelapses();
    else if (kind === 'prints') cmd.loadHistory();
    else cmd.openRoot(STORAGE_ROOT[kind]);
    render();
  }

  return {
    openStorage: (kind) => openStorage(kind),

    /** What Storage is showing, in the one shape its grid reads. */
    storageData,

    reloadStorage: () => openStorage(store.storageKind),

    loadMoreStorage: (n) => (store.storageKind === 'prints' ? cmd.loadHistory(n) : null),

    /** The one useful action from an idle job card: go and find something to print. */

    openRoot: async (root) => {
      store.files = { loading: true, error: '', root: root || store.files.root, roots: store.files.roots, items: [] };
      render();
      try {
        if (!store.files.roots.length) {
          const r = await deps.bridge.request(CMD.FILES_ROOTS, {});
          store.files.roots = Array.isArray(r) ? r : (r && (r.roots || r.result)) || [];
          if (!store.files.root) {
            const first = store.files.roots[0];
            store.files.root = typeof first === 'string' ? first : (first && (first.name || first.root)) || 'gcodes';
          }
        }
        // Firmware builds differ on which listing command answers; try the paged
        // one first and fall back to the directory walk.
        let items = [];
        try {
          const page = await deps.bridge.request(CMD.FILE_LIST_PAGE,
            { root: store.files.root, page_number: 0, files_per_page: 50 });
          items = (page && (page.files || page.items || page.result)) || (Array.isArray(page) ? page : []);
        } catch {
          const dir = await deps.bridge.request(CMD.FILES_GET_DIRECTORY,
            { path: store.files.root, extended: true });
          items = (dir && (dir.files || dir.result)) || [];
        }
        store.files.items = Array.isArray(items) ? items : [];
      } catch (e) {
        store.files.error = `could not read the machine: ${e.message}`;
      }
      store.files.loading = false;
      render();
    },

    printFile: (path) => openDialog({
      title: 'Start this print?',
      build: (b) => {
        const p = document.createElement('p');
        p.style.cssText = 'margin:4px 0 6px;font-size:13px;line-height:1.55;color:#39434F';
        p.textContent = path;
        b.appendChild(p);
      },
      confirmLabel: 'Print',
      onConfirm: () => { send(CMD.PRINT_START, { filename: path }, 'start print'); },
    }),

    /* ---- camera ---- */

    loadHistory: async (start = 0) => {
      store.history.loading = start === 0;
      store.history.error = '';
      render();
      try {
        const r = await deps.bridge.request(CMD.PRINT_HISTORY,
                                       { start, limit: HISTORY_PAGE, order: 'desc' });
        const jobs = (r && (r.jobs || r.items)) || (Array.isArray(r) ? r : []);
        store.history.items = start === 0 ? jobs : store.history.items.concat(jobs);
        store.history.hasMore = jobs.length >= HISTORY_PAGE;
      } catch (e) {
        store.history.error = `could not read print history: ${e.message}`;
        if (start === 0) store.history.items = [];
      }
      store.history.loading = false;
      render();
    },

    loadTimelapses: async () => {
      try {
        const r = await deps.bridge.request(CMD.TIMELAPSE_LIST,
          { page_index: 0, page_rows: 24, thumbnail_direct: true });
        // `instances` is the printer's own name for the list, and the reply is now
        // unwrapped from its JSON-RPC envelope before it gets here (see unwrapRpc).
        store.cam.timelapses = (r && (r.instances || r.list || r.items))
                      || (Array.isArray(r) ? r : []);
        store.cam.error = '';
      } catch (e) {
        store.cam.timelapses = [];
        store.cam.error = `could not list recordings: ${e.message}`;
      }
      render();
    },

    /**
     * Play a recording, rather than only offering to delete it.
     *
     * The sheet used to say playback was Orca's job and then show a Delete button, which
     * made "open" mean "destroy". The file is served by Moonraker and the URL is on the
     * instance itself; see timelapseUrl for the port that actually answers with video.
     */

    openTimelapse: (t) => {
      const url = timelapseUrl(store.device, t);
      const name = t.gcode_name || t.name || t.filename || 'Recording';
      openDialog({
        title: name,
        wide: true,
        build: (b) => {
          // Whether this engine can play the file at all is a different question from
          // whether the printer serves it, and they need different answers. Measured:
          // WebKitGTK here reports canPlayType('video/mp4') === '' and fails with
          // MEDIA_ERR_SRC_NOT_SUPPORTED - it ships without H.264. Orca's Windows and
          // macOS webviews do not have that limitation.
          const playable = !!document.createElement('video').canPlayType('video/mp4');
          if (url && playable) {
            const v = document.createElement('video');
            v.src = url;
            v.controls = true;
            v.autoplay = true;
            v.style.cssText = 'width:100%;max-height:52vh;background:#000;border-radius:6px';
            v.onerror = () => {
              v.remove();
              const p = document.createElement('p');
              p.style.cssText = 'margin:4px 0;font-size:13px;color:#9A5B12';
              p.textContent = `The printer did not serve this recording (${url}).`;
              b.prepend(p);
            };
            b.appendChild(v);
          } else if (url) {
            // Show the still it already has, and say why there is no player.
            const thumb = t.thumbnail_base64 || '';
            if (thumb) {
              const im = document.createElement('img');
              im.src = thumb.startsWith('data:') ? thumb : `data:image/jpeg;base64,${thumb}`;
              im.style.cssText = 'width:100%;max-height:40vh;object-fit:contain;'
                               + 'background:#000;border-radius:6px;display:block';
              b.appendChild(im);
            }
            const p = document.createElement('p');
            p.style.cssText = 'margin:10px 0 0;font-size:13px;line-height:1.5;color:#9A5B12';
            p.textContent = 'This browser engine has no H.264 support, so the recording '
                          + 'cannot play here. Download plays it in any video player.';
            b.appendChild(p);
          } else {
            const p = document.createElement('p');
            p.style.cssText = 'margin:4px 0 6px;font-size:13px;color:#39434F';
            p.textContent = 'This recording carries no playable URL.';
            b.appendChild(p);
          }
          const meta = [t.generate_date, t.video_duration,
                        t.video_file_size ? `${(t.video_file_size / 1048576).toFixed(1)} MB` : '']
            .filter(Boolean).join(' \u00B7 ');
          if (meta) {
            const m = document.createElement('p');
            m.style.cssText = 'margin:10px 0 0;font-size:12px;color:#666';
            m.textContent = meta;
            b.appendChild(m);
          }
          // Deleting is still reachable, but it is no longer what opening a recording
          // does. It asks again, because this one cannot be undone.
          const row = document.createElement('div');
          row.style.cssText = 'margin-top:14px;display:flex;gap:10px';
          if (url) {
            const dl = document.createElement('a');
            dl.href = url;
            dl.download = `${name}.mp4`;
            dl.className = 'btn';
            dl.textContent = 'Download';
            row.appendChild(dl);
          }
          const del = document.createElement('button');
          del.className = 'btn';
          del.textContent = 'Delete from printer\u2026';
          del.onclick = () => cmd.deleteTimelapse(t);
          row.appendChild(del);
          b.appendChild(row);
        },
        confirmLabel: 'Close',
        onConfirm: () => true,
      });
    },

    deleteTimelapse: (t) => openDialog({
      title: 'Delete this recording?',
      build: (b) => {
        const p = document.createElement('p');
        p.style.cssText = 'margin:4px 0 6px;font-size:13px;line-height:1.55;color:#39434F';
        p.textContent = `${t.gcode_name || t.name || 'This recording'} will be removed `
                      + 'from the printer. This cannot be undone.';
        b.appendChild(p);
      },
      confirmLabel: 'Delete',
      onConfirm: async () => {
        await send(CMD.TIMELAPSE_DELETE,
                   { date_index: t.date_index || t.dateIndex || '',
                     name: t.name || t.gcode_name || '' }, 'delete recording');
        cmd.loadTimelapses();
      },
    }),

    /* ---- diagnostics ---- */

    fileDetails: async (path) => {
      const [meta, thumb] = await Promise.all([
        deps.bridge.request(CMD.FILES_METADATA, { filename: path }).catch((e) => ({ error: e.message })),
        // Both thumbnail commands ship, and the order matters more than it looks.
        // sw_MachineFilesThumbnails *succeeds* and returns {width,height,size,
        // thumbnail_path} - paths, no image data - so asking it first meant the
        // catch-fallback never fired and no thumbnail was ever shown. The base64
        // command is the only one that returns bytes, so it goes first.
        deps.bridge.request(CMD.FILE_THUMBS_B64, { path })
          .catch(() => deps.bridge.request(CMD.FILE_THUMBNAILS, { filename: path }))
          .catch(() => null),
      ]);
      openDialog({
        title: path.split('/').pop() || path,
        build: (b) => {
          const img = pickThumb(thumb);
          if (img) {
            const im = document.createElement('img');
            im.src = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
            im.style.cssText = 'width:100%;max-height:180px;object-fit:contain;'
                             + 'border:1px solid #E6E6E6;border-radius:6px;margin-bottom:12px';
            b.appendChild(im);
          }
          const dl = document.createElement('dl');
          dl.className = 'info-grid';
          Object.entries(meta || {}).forEach(([k, v]) => {
            if (v == null || typeof v === 'object') return;
            const dt = document.createElement('dt'); dt.textContent = k;
            const dd = document.createElement('dd'); dd.textContent = String(v);
            dl.appendChild(dt); dl.appendChild(dd);
          });
          b.appendChild(dl);
        },
        confirmLabel: 'Download to this computer',
        onConfirm: () => {
          send(CMD.DOWNLOAD_MACHINE_FILE, { filename: path, url: '' }, 'download');
          pollTransfer();
        },
      });
    },

    /* ---- saved-store.device management ---- */
  };
}
