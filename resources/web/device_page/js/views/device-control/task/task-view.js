/*
 * The Printing Task card's DOM.
 *
 * A band, not a stack. The card was 306px tall in a panel 766px wide, and it spent that
 * on a 152px thumbnail, a 40px grey percentage, a row carrying the machine's own name -
 * which the rail already shows - and a row of its own for two buttons. Read as four
 * blocks down the page; drawn to a shape that was right when every panel was one cell of
 * an equal 2x2 grid.
 *
 * It is 127 now, and the three moves are the ones in Bambu's own progress card:
 *
 *   the thumbnail ANCHORS the block instead of sitting above the bar
 *   the metadata joins the filename's line instead of taking one
 *   the buttons ride the BAR's line - a 6px bar and a 30px button cost 70 stacked
 *     and 30 side by side, which is the single biggest saving here
 *
 * And the status word moved to the panel header, where a panel says what it is and what
 * it is doing on one line. See task-panel.js.
 *
 * One thing that did NOT change, because a conformance check holds it: this is ONE card
 * at every state, zeroed rather than replaced. An idle machine and a printing one differ
 * in the numbers, not in the furniture.
 */
'use strict';

import { $, el } from '../../../../../shared/js/dom.js';
import { PRINT_STATE } from '../../../../../shared/js/protocol.js';
import { rebuildOn, text, attr } from '../../../../../shared/js/render.js';

/**
 * What the header badge says.
 *
 * Klipper calls a machine with no job `standby`; the shipped page shows `idle`. Exported
 * because the badge is declared in task-panel.js now and the mapping belongs with the
 * rest of the card's language rather than with its declaration.
 */
export function stateLabel(st) {
  return st === PRINT_STATE.STANDBY ? 'idle' : (st || PRINT_STATE.UNKNOWN);
}

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
      wrap.appendChild(tw);

      const col = el('div', 'job-col');

      // row 1: what is printing, and what it has cost so far
      const r1 = el('div', 'job-row');
      r1.appendChild(el('div', 'job-name'));
      const meta = el('div', 'job-meta');
      // Elapsed and filament used, because those are what `print_stats` actually
      // reports. Bambu's card shows grams here; grams need a diameter and a density
      // this page is not told, so metres of filament is the same fact without the guess.
      meta.appendChild(el('span', 'job-elapsed'));
      meta.appendChild(el('span', 'job-used'));
      r1.appendChild(meta);
      col.appendChild(r1);

      // row 2: how far, and how far to go
      const r2 = el('div', 'job-row');
      r2.appendChild(el('div', 'job-pct'));
      const nums = el('div', 'job-nums');
      // Layers read as a pair; a machine that reports neither shows the pair as zero,
      // which is what the original does rather than hiding the row.
      nums.appendChild(el('span', 'job-layer'));
      nums.appendChild(el('span', 'job-time'));
      r2.appendChild(nums);
      col.appendChild(r2);

      // row 3: the bar, and the buttons that act on it
      const r3 = el('div', 'job-row');
      const bar = el('div', 'job-bar');
      bar.appendChild(el('div'));
      r3.appendChild(bar);

      const btns = el('div', 'job-actions');
      // Idle is not a dead end. The card's one useful action with nothing running is to
      // go and find something to print, which is what Storage is for - the button used
      // to be present, disabled, and titled "Nothing to start here".
      btns.appendChild(roundBtn(
        paused || !active ? 'play' : 'pause',
        paused ? 'Resume the print'
               : (active ? 'Pause the print' : 'Choose a file to print'),
        () => (active ? (paused ? handlers.resume() : handlers.pause())
                      : handlers.showFiles())));
      if (active) {
        btns.appendChild(roundBtn('stop', 'Cancel the print',
                                  () => handlers.confirmCancel()));
      }
      r3.appendChild(btns);
      col.appendChild(r3);

      if (job.message) col.appendChild(el('div', 'job-msg'));
      wrap.appendChild(col);
      root.appendChild(wrap);
    });

  // ---- the numbers, which is all that moves ------------------------------
  if (thumb) {
    attr(root.querySelector('.job-thumb img'), 'src',
         thumb.startsWith('data:') ? thumb : `data:image/png;base64,${thumb}`);
  }

  const pct = Math.round(job.progress * 100);
  const nameEl = root.querySelector('.job-name');
  const name = job.filename ? (job.filename.split('/').pop() || job.filename) : '—';
  text(nameEl, name);
  // The row ellipsises, so the whole name has to be reachable somehow.
  nameEl.title = job.filename || '';
  text(root.querySelector('.job-elapsed'), hm(job.printDuration));
  text(root.querySelector('.job-used'), metres(job.filamentUsed));
  text(root.querySelector('.job-pct'), `${pct}%`);
  text(root.querySelector('.job-layer'),
       `Layer ${job.layer ?? 0}/${job.totalLayer ?? 0}`);
  text(root.querySelector('.job-time'), `— ${hm(remaining(job))}`);
  root.querySelector('.job-bar > div').style.width = `${pct}%`;
  if (job.message) text(root.querySelector('.job-msg'), job.message);
}

/** `0h 0m`, the way the shipped card writes it - clock() pads the minutes and this
 *  row does not. */
function hm(sec) {
  const t = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`;
}

/** `print_stats.filament_used` is millimetres of filament. Metres, to one decimal. */
function metres(mm) {
  const m = Math.max(0, Number(mm) || 0) / 1000;
  return `${m.toFixed(1)} m`;
}

/** What is left, from what has run and how far it has got. Zero when unknowable. */
function remaining(job) {
  if (!(job.progress > 0) || !(job.printDuration > 0)) return 0;
  return Math.max(0, job.printDuration * (1 - job.progress) / job.progress);
}

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
