/*
 * Storage's DOM: one scrolling grid, one card, four kinds of thing on the machine.
 */
'use strict';

import { $, el, icon } from '../../../core/dom.js';
import { clock } from '../../../widgets/format.js';
import { illustration, placeholder } from '../../../widgets/art.js';
import { jobThumbUrl } from '../../../../../shared/js/protocol.js';
import { rebuildOn, keyedList, text, data } from '../../../core/render.js';

/** Klipper's own job outcomes; anything else is shown verbatim. */
const JOB_STATUS = {
  completed: 'Completed', cancelled: 'Cancelled', error: 'Error',
  klippy_shutdown: 'Interrupted', klippy_disconnect: 'Interrupted',
  in_progress: 'In progress', server_exit: 'Interrupted',
};

/* ---- storage ---------------------------------------------------------- */

/**
 * One scrolling grid for everything the printer is holding.
 *
 * Time-lapses, finished prints, print files and logs were four different shapes behind
 * three different tabs on two different panels. They are all "things on the machine you
 * might want to look at", so they get one view, one picker, and one card - normalised
 * here rather than four renderers kept in step by hand.
 *
 * The same rebuild guard as the task lists: this repaints on every state push, and
 * rebuilding threw away the scroll position.
 */

/**
 * One scrolling grid for everything the printer is holding.
 *
 * Time-lapses, finished prints, print files and logs were four different shapes behind
 * three different tabs on two different panels. They are all "things on the machine you
 * might want to look at", so they get one view, one picker, and one card - normalised
 * here rather than four renderers kept in step by hand.
 *
 * The same rebuild guard as the task lists: this repaints on every state push, and
 * rebuilding threw away the scroll position.
 */
export function renderStorage(root, kind, data, handlers, device) {
  const items = data.items || [];
  // What the body *is*, rather than what it contains: four shapes, and only a change of
  // shape needs the chrome rebuilt. The old guard hashed the item COUNT and so never
  // repainted a list whose contents changed without its length - a print going from
  // in_progress to completed left the old badge on screen.
  const shape = data.loading ? 'loading'
              : data.error ? 'error'
              : items.length ? 'grid' : 'empty';

  rebuildOn(root, `${kind}:${shape}`, () => {
    if (shape === 'loading') {
      root.appendChild(el('div', 'cam-msg', 'Reading the machine\u2026'));
      return;
    }
    if (shape === 'error') {
      const wrap = el('div', 'stor-empty');
      wrap.appendChild(el('div', 'cam-msg', ''));
      const again = el('button', 'btn', 'Try again');
      again.onclick = () => handlers.reloadStorage();
      wrap.appendChild(again);
      root.appendChild(wrap);
      return;
    }
    if (shape === 'empty') {
      const wrap = el('div', 'stor-empty');
      illustration(wrap);
      wrap.appendChild(el('div', 'cam-msg', EMPTY_TEXT[kind] || 'Nothing here'));
      root.appendChild(wrap);
      return;
    }
    const grid = el('div', 'stor-grid');
    grid.dataset.kind = kind;
    root.appendChild(grid);
    const foot = el('div', 'stor-foot');
    foot.appendChild(el('span', null, ''));
    const more = el('button', 'btn', 'Load more');
    more.onclick = () => handlers.loadMoreStorage(root.querySelectorAll('.stor-card').length);
    foot.appendChild(more);
    root.appendChild(foot);
  });

  if (shape === 'error') { text(root.querySelector('.cam-msg'), data.error); return; }
  if (shape !== 'grid') return;

  // The grid is never replaced, so its scroll position needs no saving and restoring -
  // that hand-rolled `at = keep.scrollTop` was paying for the rebuild above it.
  keyedList(root.querySelector('.stor-grid'), items, {
    key: (it, i) => cardKey(it, i),
    sig: (it) => cardSig(kind, it),
    create: (it) => storageCard(kind, it, handlers, device),
  });

  const foot = root.querySelector('.stor-foot');
  foot.hidden = !data.hasMore;
  text(foot.querySelector('span'), `${items.length} shown`);
}

/**
 * What makes two entries the same entry across frames.
 *
 * Falls back to the index, because none of the four sources promises an id: history
 * rows have a filename that repeats across reprints, and a log file has only its path.
 * An index-keyed list still reconciles correctly for the one mutation that happens here
 * - "load more" appending to the end.
 */

/**
 * What makes two entries the same entry across frames.
 *
 * Falls back to the index, because none of the four sources promises an id: history
 * rows have a filename that repeats across reprints, and a log file has only its path.
 * An index-keyed list still reconciles correctly for the one mutation that happens here
 * - "load more" appending to the end.
 */
function cardKey(it, i) {
  return it.job_id || it.id || it.path || it.filename || it.gcode_name || `#${i}`;
}

/** What has to change before a card is worth rebuilding. */

/** What has to change before a card is worth rebuilding. */
function cardSig(kind, it) {
  if (kind === 'prints') return `${it.status}:${it.exists}:${it.end_time}`;
  if (kind === 'timelapses') return `${it.video_file_size}:${it.video_duration}`;
  return `${it.size}:${it.modified}`;
}

const EMPTY_TEXT = {
  timelapses: 'No recordings on this printer',
  prints: 'No completed prints on this printer',
  gcodes: 'No print files on this machine',
  logs: 'No files in this folder',
};

/** The empty-box art the shipped page uses where there is nothing to show. */

/**
 * One card, from whichever shape the source hands over.
 *
 * Each kind answers the same four questions - what does it look like, what is it
 * called, what else is worth knowing, and what can be done with it - so the card is
 * built once and the differences live in this switch.
 */
function storageCard(kind, it, handlers, device) {
  const card = el('div', 'stor-card');
  const shot = el('div', 'stor-shot');
  const body = el('div', 'stor-info');
  const act = el('div', 'stor-actions');

  const withImg = (src, onFail) => {
    const im = el('img');
    im.src = src;
    im.alt = '';
    im.onerror = () => { im.remove(); shot.appendChild(onFail()); };
    shot.appendChild(im);
  };

  if (kind === 'timelapses') {
    const t = it.thumbnail_base64 || it.thumbnail || '';
    if (t) withImg(t.startsWith('data:') ? t : `data:image/jpeg;base64,${t}`,
                   () => el('span', 'tl-none', 'no preview'));
    else shot.appendChild(el('span', 'tl-none', 'no preview'));
    if (it.video_duration) shot.appendChild(el('span', 'tl-dur', it.video_duration));
    body.appendChild(el('span', 'stor-name', it.gcode_name || 'recording'));
    body.appendChild(el('span', 'stor-sub',
      [it.generate_date, it.video_file_size ? fmtSize(it.video_file_size) : '']
        .filter(Boolean).join(' \u00B7 ')));
    const play = el('button', 'btn primary', 'View');
    play.onclick = () => handlers.openTimelapse(it);
    act.appendChild(play);

  } else if (kind === 'prints') {
    const url = jobThumbUrl(device, it);
    if (url) withImg(url, placeholder);
    else shot.appendChild(placeholder());
    const status = String(it.status || '');
    const badge = el('span', 'stor-badge', JOB_STATUS[status] || status || '\u2014');
    badge.dataset.status = status === 'completed' ? 'ok'
                         : (status === 'in_progress' ? 'busy' : 'bad');
    shot.appendChild(badge);
    body.appendChild(el('span', 'stor-name',
                        String(it.filename || '(unnamed)').split('/').pop()));
    const when = it.end_time || it.start_time;
    const bits = [];
    if (when) bits.push(new Date(when * 1000).toLocaleDateString());
    if (it.print_duration) bits.push(clock(it.print_duration));
    const layers = it.metadata && it.metadata.layer_count;
    if (layers) bits.push(`${layers} layers`);
    body.appendChild(el('span', 'stor-sub', bits.join(' \u00B7 ')));
    const again = el('button', 'btn primary', 'Reprint');
    if (it.exists === false) {
      again.disabled = true;
      again.title = 'This file is no longer on the machine';
    } else {
      again.onclick = () => handlers.printFile(it.filename);
    }
    act.appendChild(again);

  } else {
    // gcodes and logs are both plain files; only what you can do with them differs.
    const path = it.path || it.filename || it.name || '';
    shot.appendChild(icon(kind === 'logs' ? 'iconModelFileFolder' : 'iconFile', 'stor-glyph'));
    body.appendChild(el('span', 'stor-name', path.split('/').pop() || path));
    const bits = [];
    if (it.size != null) bits.push(fmtSize(it.size));
    if (it.modified) bits.push(new Date(Number(it.modified) * 1000).toLocaleDateString());
    body.appendChild(el('span', 'stor-sub', bits.join(' \u00B7 ')));
    if (kind === 'gcodes') {
      const print = el('button', 'btn primary', 'Print');
      print.onclick = () => handlers.printFile(path);
      act.appendChild(print);
    }
    const info = el('button', 'btn', 'Details');
    info.onclick = () => handlers.fileDetails(path);
    act.appendChild(info);
  }

  card.appendChild(shot);
  card.appendChild(body);
  card.appendChild(act);
  card.title = it.filename || it.gcode_name || it.path || '';
  return card;
}

/* ---- shared formatting ----------------------------------------------- */

function fmtSize(n) {
  const v = Number(n) || 0;
  if (v > 1024 * 1024) return `${(v / 1048576).toFixed(1)} MB`;
  if (v > 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
}

/* ---- trace ---------------------------------------------------------- */
