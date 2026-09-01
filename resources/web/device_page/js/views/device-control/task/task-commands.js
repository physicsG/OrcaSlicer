/*
 * commands/task.js - Commands the Printing Task card issues: pause, resume, cancel, and the
 * thumbnail it shows.
 *
 * check_coverage.py reads the CMD references out of this file to answer "can a user
 * reach this command", and attributes them to the task panel because this is the module
 * that panel is handed. That makes the attribution a fact about the imports rather than
 * a promise in a declaration - which is the difference that let a handler nothing called
 * count as implemented for as long as it did.
 */
'use strict';

import { CMD }
  from '../../../../../shared/js/protocol.js';
import { openDialog } from '../../../core/overlay.js';
import { pickThumb } from '../../../core/thumbs.js';

export function create(deps) {
  // `bridge` is deliberately NOT destructured: it does not exist yet when these are
  // built - boot() decides between the real host and the simulator - so it is reached
  // through deps each time rather than captured as null once.
  const { state, store, pending, session, cmd,
          send, setpoint, setStatus, render } = deps;

  /**
   * Fetch the printing file's thumbnail, once.
   *
   * Keyed on the filename, so a card repainting every second asks the printer nothing.
   * `sw_FilesThumbnailsBase64` is the only command that returns bytes - the other one
   * returns paths, which is what made thumbnails silently absent before.
   */
  function refreshJobThumb(file) {
    if (store.jobThumb.file === (file || null)) return;
    store.jobThumb = { file: file || null, data: null };
    if (!file) return;
    const asked = file;
    deps.bridge.request(CMD.FILE_THUMBS_B64, { path: file })
      .then((r) => {
        if (store.jobThumb.file !== asked) return;      // the job moved on while we asked
        store.jobThumb.data = pickThumb(r);
        if (store.jobThumb.data) render();
      })
      .catch(() => { /* no thumbnail is a normal answer; the card shows its placeholder */ });
  }

  return {
    pause:  () => send(CMD.PRINT_PAUSE, {}, 'pause'),

    resume: () => send(CMD.PRINT_RESUME, {}, 'resume'),

    cancel: () => send(CMD.PRINT_CANCEL, {}, 'cancel'),

    confirmCancel: () => openDialog({
      title: 'Cancel this print?',
      build: (b) => {
        const p = document.createElement('p');
        p.style.cssText = 'margin:4px 0 6px;font-size:13px;line-height:1.55;color:#39434F';
        p.textContent = 'The job stops immediately and cannot be resumed.';
        b.appendChild(p);
      },
      confirmLabel: 'Cancel print',
      onConfirm: () => { cmd.cancel(); },
    }),

    /* ---- machine store.files ---- */

    // Storage's Prints, since the print-files tab that used to be the target was the
    // same list twice - see KINDS in storage-panel.js. Reprint is the verb there.
    showFiles: () => { store.storageKind = 'prints'; cmd.showView('storage'); },

    /* ---- print job ---- */

    refreshJobThumb: (f) => refreshJobThumb(f),

    /** The print-task options the header pill edits, straight onto print_task_config. */
  };
}
