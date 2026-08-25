/*
 * The Printing Task card's DOM.
 */
'use strict';

import { $, el } from '../../../core/dom.js';
import { PRINT_STATE, deviceLabel } from '../../../../../shared/js/protocol.js';
import { clock } from '../../../widgets/format.js';
import { illustration } from '../../../widgets/art.js';
import { rebuildOn, text, attr, data } from '../../../core/render.js';

/**
 * The job card, laid out the way the shipped page lays it out.
 *
 * The rebuild used to show an illustration and the words "No active print" when the
 * machine was idle, which is a different card rather than the same card at zero. The
 * original keeps ONE card and zeroes it: status badge, machine name, thumbnail,
 * filename, percentage, layers, time, progress bar, and one round button. An idle
 * printer and a printing one differ in the numbers, not in the furniture.
 */
export function renderTask(root, job, handlers, device, thumb) {
  const active = job.state === PRINT_STATE.PRINTING || job.state === PRINT_STATE.PAUSED;
  const paused = job.state === PRINT_STATE.PAUSED;

  // The card's *shape*: which controls exist and whether there is a thumbnail or a
  // message at all. The numbers move every second and the shape does not, which is the
  // whole point - this used to rebuild the card, the buttons and the image once a
  // second, so a click could land on a node that was about to be replaced.
  rebuildOn(root, `${active ? 1 : 0}:${paused ? 1 : 0}:${thumb ? 1 : 0}:${job.message ? 1 : 0}`,
    () => {
      const wrap = el('div', 'job');

      const head = el('div', 'job-head');
      head.appendChild(el('span', 'job-badge'));
      head.appendChild(el('span', 'job-dev'));
      wrap.appendChild(head);

      const main = el('div', 'job-main');
      const tw = el('div', 'job-thumb');
      if (thumb) {
        tw.appendChild(el('img'));
      } else {
        // The bundle's own empty-box art, not the not-connected device illustration -
        // which answers "there is no printer" rather than "there is no file".
        const ph = el('img', 'job-thumb-ph');
        ph.src = 'icons/empty-box.png';
        ph.alt = '';
        tw.appendChild(ph);
      }
      main.appendChild(tw);

      const info = el('div', 'job-info');
      info.appendChild(el('div', 'job-name'));
      info.appendChild(el('div', 'job-pct'));
      const nums = el('div', 'job-nums');
      // Layers read as a pair; a machine that reports neither shows the pair as zero,
      // which is what the original does rather than hiding the row.
      nums.appendChild(el('span', 'job-layer'));
      nums.appendChild(el('span', 'job-time'));
      info.appendChild(nums);
      main.appendChild(info);
      wrap.appendChild(main);

      const bar = el('div', 'job-bar');
      bar.appendChild(el('div'));
      wrap.appendChild(bar);

      const btns = el('div', 'job-actions');
      // Idle is not a dead end. The card's one useful action with nothing running is to
      // go and find something to print, which is what Storage is for - the button used
      // to be present, disabled, and titled "Nothing to start here".
      const main_btn = roundBtn(
        paused || !active ? 'play' : 'pause',
        paused ? 'Resume the print'
               : (active ? 'Pause the print' : 'Choose a file to print'),
        () => (active ? (paused ? handlers.resume() : handlers.pause())
                      : handlers.showFiles()));
      btns.appendChild(main_btn);
      if (active) {
        btns.appendChild(roundBtn('stop', 'Cancel the print',
                                  () => handlers.confirmCancel()));
      }
      wrap.appendChild(btns);

      if (job.message) wrap.appendChild(el('div', 'job-msg'));
      root.appendChild(wrap);
    });

  // ---- the numbers, which is all that moves ------------------------------
  const st = job.state || PRINT_STATE.STANDBY;
  const badge = root.querySelector('.job-badge');
  // Klipper calls a machine with no job `standby`; the shipped page shows `idle`.
  // The machine's own word stays on the title, so nothing is hidden by the rename.
  text(badge, st === PRINT_STATE.STANDBY ? 'idle' : st);
  badge.title = `print_stats.state: ${st}`;
  data(badge, 'state', st);
  text(root.querySelector('.job-dev'), device ? deviceLabel(device) : '');

  if (thumb) {
    attr(root.querySelector('.job-thumb img'), 'src',
         thumb.startsWith('data:') ? thumb : `data:image/png;base64,${thumb}`);
  }

  const pct = Math.round(job.progress * 100);
  text(root.querySelector('.job-name'),
       job.filename ? (job.filename.split('/').pop() || job.filename) : '\u2014');
  text(root.querySelector('.job-pct'), `${pct}%`);
  text(root.querySelector('.job-layer'), `${job.layer ?? 0}/${job.totalLayer ?? 0}`);
  text(root.querySelector('.job-time'), `\u2014 ${hm(remaining(job))}`);
  root.querySelector('.job-bar > div').style.width = `${pct}%`;
  if (job.message) text(root.querySelector('.job-msg'), job.message);
}

/** `0h 0m`, the way the shipped card writes it - clock() pads the minutes and this
 *  row does not. */

/** `0h 0m`, the way the shipped card writes it - clock() pads the minutes and this
 *  row does not. */
function hm(sec) {
  const t = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`;
}

/** What is left, from what has run and how far it has got. Zero when unknowable. */

/** What is left, from what has run and how far it has got. Zero when unknowable. */
function remaining(job) {
  if (!(job.progress > 0) || !(job.printDuration > 0)) return 0;
  return Math.max(0, job.printDuration * (1 - job.progress) / job.progress);
}

/** One round control, the shape the original uses for print actions. */

/** One round control, the shape the original uses for print actions. */
function roundBtn(kind, title, onClick) {
  const b = el('button', 'job-btn');
  b.type = 'button';
  b.dataset.kind = kind;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true">'
         + '<rect x="7.5" y="6.5" width="3.5" height="11" rx="1"/>'
         + '<rect x="13" y="6.5" width="3.5" height="11" rx="1"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
  }[kind];
  b.onclick = onClick;
  return b;
}

/* ---- print history --------------------------------------------------- */

/** Klipper's own job outcomes; anything else is shown verbatim. */
