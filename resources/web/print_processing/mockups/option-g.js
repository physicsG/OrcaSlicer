/*
 * option-g.js - the grouping, and a way back.
 *
 * Adapted from the two-nozzle flow in ui-snapshots-inspiration/Slicing/. Its four steps
 * map onto the U1 like this:
 *
 *   01 Slicing result       which filaments were GROUPED onto which nozzle, and what the
 *                           grouping saved -> here, the Filament section's heading line
 *   02 Filament grouping    Auto (filament-saving | convenience) or Custom
 *                           -> the Regroup sheet
 *   03 Send print job       per-nozzle chips carrying the slot each comes from
 *                           -> the toolhead boxes
 *   04 Select filament      the AMS units drawn, the one that cannot feed this nozzle
 *                           greyed -> the source picker
 *
 * The one thing that does not carry over is WHEN a change takes effect. There, the slot
 * mapping is sent at print time. Here both levers - which head a filament runs on and
 * which bay it comes from - are written into the gcode, so changing either needs the
 * plate sliced again. So this dialog's second door is `Re-slice`, not `Send`, and the
 * button says which one it is.
 */
'use strict';

import {
  SCENARIO, MODE, WITH_PRINT_SETUP, $, makeModel, blockers, runSend, prefRows,
  markMockup, expose, el, svg,
} from './ace-shell.js';
import { FILAMENTS, humanDuration, grams, megabytes, bayAddr } from './ace-fixture.js';
import { feederBadge, fnum, inkOn } from './ace-art.js';
import { aceBadge, ACE_MODE_LABELS } from '../../shared/js/multiACE.js';

/*
 * WHERE THE CABINET IS NAMED
 *
 * On the HEAD, once - not on every chip.
 *
 * The first draft put the unit's badge on each filament chip, which drew the same cabinet
 * three times on one toolhead and said nothing a fourth copy could add. Which unit feeds
 * a head is a property of THE HEAD: `ACE_SET_HEAD_ACE HEAD=n ACE=a` binds one to one, and
 * the Prepare tab's per-head `ACE` row is that same fact in that same place. So the badge
 * sits beside `Toolhead N`, filled with that unit's four bay colours, and the chips carry
 * only the address - which is the half that differs between them.
 *
 * In MULTI mode there is no such unit to name. See `headSource` below.
 */

const model = makeModel();

/*
 * G's own state, on top of the shared model.
 *
 *   sources   filament index -> where the operator says it comes from, when they have
 *             moved one. Empty until they touch a chip; `dirty` is that emptiness.
 *   mode      which grouping the plan was made with. `saving` is what the slicer used.
 */
const g = { sources: {}, mode: 'saving', dirty: false };

/*
 * PRINT PREFERENCES ARE D AND E's, NOT THE FLOW'S.
 *
 * The two-nozzle dialog this option is adapted from offers four settings as three-state
 * segmented controls - Auto / On / Off - and Auto is a genuinely useful state there: it
 * means the printer decides. It was copied here, and it was wrong twice.
 *
 * `SET_PRINT_PREFERENCES` takes BOOLEANS. `prefsLine()` sends `1` or `0`
 * (shared/js/protocol.js), because the shipped bundle keeps two parallel maps of the same
 * toggles - bools for the checkboxes, ints for the wire - and builds the macro line from
 * the int one. There is no third value to send, so an `Auto` segment is a control whose
 * middle position cannot leave the page.
 *
 * And there are THREE of them, not four: `PRINT_PREFERENCES` is Extrusion Flow
 * Calibration, Time-lapse Camera and Auto Leveling. `shaper_calibrate` is a field on
 * `print_task_config` and is not one of the popup's toggles; the fourth row was the
 * screenshot's, not this machine's.
 *
 * So the switches come from D and E, which had it right: two states, three rows, each
 * with the hint that says what it does.
 */

/* ---- Model Information -------------------------------------------------- */

/*
 * D's, which is the one that says what the plate NEEDS: the render, the file's own
 * numbers, and a wrapping strip of every filament in it.
 *
 * The strip is not made redundant by the chips below. The chips answer "where does each
 * of these come from", one per toolhead; the strip answers "what does this plate use",
 * in the plate's own order, in one line. Seven filaments do not fit four cards, and that
 * sentence is the whole reason this dialog is being rebuilt - so it is worth stating
 * before the machine is discussed at all.
 *
 * The PLATE - which build surface is fitted - stays where G puts it, beside the printer:
 * it is a fact about the machine rather than about the file, and it is the one thing in
 * this dialog that neither the plate nor the file can answer.
 */
function paintModel() {
  const body = $('#s-model .grp-body');
  body.textContent = '';
  const m = model.mapping;

  const row = el('div', 'model-row');
  const img = document.createElement('img');
  img.className = 'thumb';
  img.width = 84; img.height = 84;
  img.src = m.thumbnails[0].url;
  img.alt = 'The sliced plate';
  row.appendChild(img);

  const facts = el('div', 'model-facts');
  const name = el('div', 'model-name');
  name.appendChild(el('span', null, m.filename));
  /* Kept from the flow this option is adapted from: it is the only rename in the dialog,
     and dropping a control is not the same as preferring another layout. */
  name.appendChild(pencil());
  facts.appendChild(name);

  const line = el('div', 'model-meta');
  line.appendChild(el('span', null, humanDuration(m.estimated_time)));
  line.appendChild(el('span', null, grams(m.filament_weight_total)));
  line.appendChild(el('span', null, megabytes(31402118)));
  line.appendChild(el('span', null, `${m.filament_type.length} filaments`));
  facts.appendChild(line);

  const strip = el('div', 'plate-strip');
  m.filament_type.forEach((type, i) =>
    strip.appendChild(fnum(i, m.filament_color_rgba[i], type)));
  facts.appendChild(strip);

  row.appendChild(facts);
  body.appendChild(row);
}

const ICON = (d, extra = {}) => {
  const s = svg('svg', Object.assign({ viewBox: '0 0 16 16', width: 13, height: 13,
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, extra));
  d.forEach((path) => s.appendChild(svg('path', { d: path })));
  return s;
};
const pencil = () => ICON(['M11.2 2.4 13.6 4.8 5.4 13H3v-2.4Z'], { class: 'pencil' });

/* ---- the printer -------------------------------------------------------- */

function paintPrinter() {
  const body = $('#s-printer .grp-body');
  body.textContent = '';
  const cards = el('div', 'pcards');

  const p = el('div', 'pcard');
  const grow = el('div', 'grow');
  if (model.device) {
    grow.appendChild(el('div', 'pname', model.device.name));
    grow.appendChild(el('div', 'pmodel',
      `${model.device.model} · ${model.mapping.nozzle_info[0]} mm × 4`));
  } else {
    grow.appendChild(el('div', 'pname', 'No printer connected'));
  }
  p.appendChild(grow);
  const refresh = el('button', null);
  refresh.type = 'button';
  refresh.title = 'Read the printer again';
  refresh.appendChild(ICON(['M13.4 6.6A5.6 5.6 0 1 0 13.8 10', 'M13.8 3v3.6h-3.6'],
                           { width: 15, height: 15 }));
  p.appendChild(refresh);
  cards.appendChild(p);

  /* The plate, as its own small card. It is a fact about the print that lives on the
     machine rather than in the file, which is why it sits beside the printer. */
  const plate = el('div', 'pcard plate-card');
  const sw = el('div');
  sw.style.cssText = 'width:34px;height:30px;border-radius:3px;margin:0 auto;'
    + 'background:linear-gradient(150deg,#C9A15E,#9C7638);border:1px solid var(--line)';
  plate.appendChild(sw);
  plate.appendChild(el('div', 'pname', 'Textured PEI'));
  cards.appendChild(plate);

  body.appendChild(cards);
}

/* ---- the grouping ------------------------------------------------------- */

function paintFilament() {
  const body = $('#s-filament .grp-body');
  body.textContent = '';
  const saving = $('#saving');
  saving.textContent = '';

  if (!WITH_PRINT_SETUP) {
    body.appendChild(el('div', 'note muted', 'Upload only — the plate is not started.'));
    return;
  }
  if (!model.plan) {
    body.appendChild(el('div', 'note muted',
      'One filament per toolhead — nothing was grouped.'));
  }

  /*
   * The heading line, which is step 01's: what the grouping bought. Against the same
   * plate run entirely off the ACE head, because that is the arrangement a machine with
   * no free tool changes would be forced into.
   */
  if (model.plan) {
    saving.appendChild(document.createTextNode('Saves '));
    saving.appendChild(el('b', null, String(model.plan.savedSwaps)));
    saving.appendChild(document.createTextNode(' swaps and '));
    saving.appendChild(el('b', null, grams(model.plan.savedPurge_g)));
    saving.appendChild(document.createTextNode(' against one spool per head'));
  }

  /*
   * The mode, and where the units are named.
   *
   * The Device page's own three shapes, and they are not cosmetic - the mode decides what
   * a head's places even ARE:
   *
   *   head    each head is its own feeder or wired to one unit. The unit is named ON the
   *           head, so there is no band.
   *   multi   bay `i` of every unit feeds head `i`. No head is wired to a unit, so the
   *           units belong to the PANEL: a band above the grid.
   *   normal  stock feeders only. The cabinets are idle, and a band BELOW the grid
   *           because an idle cabinet still reports humidity and can still dry.
   */
  const mode = model.ace.present ? (model.ace.mode || 'head') : null;
  body.appendChild(modeRow(mode));
  if (mode === 'multi') body.appendChild(unitBand());

  const grid = el('div', 'heads');
  const c = model.check;
  model.heads.forEach((head, h) => {
    const planned = model.plan ? model.plan.heads.find((p) => p.head === h) : null;
    grid.appendChild(headBox(h, planned, c.rows.filter((r) => r.head === h)));
  });
  body.appendChild(grid);

  if (mode === 'normal') body.appendChild(unitBand());

  /* The way back. Both doors are behind it, which is why it is one control and not two:
     the operator's question is "this arrangement is wrong", not "which algorithm". */
  if (model.plan) {
    const link = el('button', 'regroup',
      'Not satisfied with the grouping? Regroup and re-slice →');
    link.type = 'button';
    link.onclick = openRegroup;
    body.appendChild(link);
  }
}

/**
 * One file filament, from whichever list this plate has.
 *
 * A plate with a plan is the seven-filament fixture; a plain one is four filaments off
 * the mapping, with different colours. Reading `FILAMENTS` for both drew nothing at all
 * on a plain plate - found by the scenario sweep, and it is the exact regression item 7
 * of 06-multiace.md exists to prevent.
 */
function filAt(i) {
  if (model.plan) return FILAMENTS[i];
  const m = model.mapping;
  return { index: i, type: m.filament_type[i], color: m.filament_color_rgba[i],
           name: `Filament ${i + 1}`, weight: m.filament_weight[i] };
}

/*
 * What this head runs. With a plan that is the planner's answer; without one it is the
 * ordinary dialog's - filament i on head i, one each, which is every plate the slicer can
 * make today.
 */
function runsFor(h, planned) {
  if (planned) return planned.run;
  return h < model.mapping.filament_type.length ? [{ filament: h }] : [];
}

/**
 * The machine's mode, stated and not offered.
 *
 * Read-only on purpose. `SET_ACE_MODE` re-plumbs the printer, some of it only after a
 * restart, and a dialog whose job is to send one plate has no business changing what the
 * machine is between pressing Print and pressing Send. It is here because the mode
 * decides what every address below means.
 *
 * The words are the Device page's - `ACE_MODE_LABELS` - so the two surfaces call one
 * state one thing.
 */
function modeRow(mode) {
  const row = el('div', 'mode-row');
  if (!mode) {
    row.appendChild(el('span', 'mode-pill dim', 'No ACE'));
    row.appendChild(el('span', 'mode-say', 'This printer reports no ACE unit.'));
    return row;
  }
  row.appendChild(el('span', 'mode-pill', `ACE mode · ${ACE_MODE_LABELS[mode] || mode}`));
  row.appendChild(el('span', 'mode-say', {
    head: 'Each toolhead is its own feeder, or wired to one ACE.',
    multi: 'Bay 1 of every ACE feeds toolhead 1, bay 2 feeds toolhead 2, and so on.',
    normal: 'Stock feeders only — no ACE is feeding a toolhead.',
  }[mode] || ''));
  return row;
}

/**
 * The units, named once for the panel rather than once per head.
 *
 * In multi and normal no head is wired to a cabinet, so nothing about a cabinet belongs
 * on a head's box - which is exactly why the Device page moves this row out of the cards
 * in those two modes and leaves it inside them in head mode.
 */
function unitBand() {
  const band = el('div', 'unit-band');
  const units = model.ace.units || [];
  if (!units.length) {
    band.appendChild(el('span', 'hsrc-name dim', 'No ACE unit reported'));
    return band;
  }
  units.forEach((u) => {
    const one = el('div', 'unit-one');
    const badge = aceBadge(u.bays, 20 / 26);
    badge.setAttribute('aria-hidden', 'true');
    one.appendChild(badge);
    one.appendChild(el('span', 'hsrc-name', `ACE ${u.id}`));
    one.appendChild(el('span', 'unit-model', u.model));
    if (u.humidity != null) one.appendChild(el('span', 'unit-hum', `${u.humidity}%`));
    one.title = `ACE ${u.id} · ${u.model}`;
    band.appendChild(one);
  });
  return band;
}

function headBox(h, planned, rows) {
  const box = el('div', 'hbox');
  const run = runsFor(h, planned);
  if (!run.length) box.classList.add('is-idle');

  /* The head's name, and what feeds it, on one line - which is the Prepare tab's own
     `Toolhead N` heading over an `ACE` row, folded into a single row because a print
     dialog has a quarter of the sidebar's height. */
  const head = el('div', 'hhead');
  head.appendChild(el('h4', null, `Toolhead ${h + 1}`));
  head.appendChild(el('span', 'spacer'));
  head.appendChild(headSource(planned));
  box.appendChild(head);

  const chips = el('div', 'chips');
  if (!run.length) {
    chips.appendChild(el('span', 'note muted', 'Not used'));
  } else {
    run.forEach((step) => {
      chips.appendChild(chipFor(filAt(step.filament), planned,
                                rows.find((r) => r.want.index === step.filament), h));
    });
  }
  box.appendChild(chips);
  return box;
}

/**
 * One filament, and where it comes from.
 *
 * The material on a bar in its own colour, the source under it. A source that disagrees
 * with what is loaded is marked on the chip rather than replaced on it: `A2` is still
 * where the plan looks, and hiding that would make the picker's job unexplainable.
 */
function chipFor(fil, planned, row, h) {
  const chip = el('button', 'chip');
  chip.type = 'button';
  // Which file filament this chip stands for. Three feeder chips legitimately read the
  // same words - "PLA" over "Feeder" - so the text cannot identify them and this does.
  chip.dataset.fil = String(fil.index);

  const type = el('span', 'chip-type', fil.type);
  type.style.background = fil.color;
  type.style.color = inkOn(fil.color);
  chip.appendChild(type);

  /*
   * Where it comes from. With a plan the file names a bay, and that is an address the
   * operator can go and look at. WITHOUT one the file addresses nothing - a plain plate
   * prints whatever is in the head - so the chip says what is loaded and offers no
   * picker, because there is no plan to change and nothing to re-slice.
   */
  const chosen = g.sources[fil.index];
  const head = model.heads[h];
  const step = planned ? planned.run.find((s) => s.filament === fil.index) : null;
  /* The STEP's unit, never the head's. In multi a head has no unit - its places come one
     from each cabinet - and reading `planned.unit` there gave `bayAddr(undefined, 0)`,
     which renders as `NaN1`. Green on every check, and wrong on screen. */
  const unitOfStep = step && step.unit != null ? step.unit : (planned && planned.unit);
  const addr = chosen != null ? chosen
    : (!planned ? (head && head.loaded ? 'Loaded' : 'Empty')
       : (planned.feeder ? 'Feeder' : bayAddr(unitOfStep, step.slot)));
  const from = el('span', 'chip-from');
  from.appendChild(el('span', 'addr-t', addr));
  if (planned) from.appendChild(el('span', 'caret', '▾'));
  chip.appendChild(from);

  if (chosen != null) chip.classList.add('is-dirty');
  else if (row && row.verdict === 'differs') chip.classList.add('is-bad');
  else if (row && row.verdict === 'unsure') chip.classList.add('is-warn');

  chip.title = row
    ? `${fil.name} ${fil.type} · ${addr} · ${row.say}`
    : `${fil.name} ${fil.type} · ${addr}`;
  if (planned) chip.onclick = () => openPicker(chip, fil, planned);
  else chip.disabled = true;
  return chip;
}

/**
 * What feeds this head, drawn beside its name.
 *
 * Three answers, and the mode decides which:
 *
 *   head    one unit, named and drawn - the badge carries that cabinet's four bay
 *           colours, so two units are two different objects rather than two letters
 *   multi   no unit. Bay `i` of EVERY cabinet is plumbed to head `i`, so the head has a
 *           LANE and its label is the bays in it. A single badge here would name one
 *           cabinet out of a set and be wrong about the rest.
 *   feeder  the feeder module's own white-over-black badge, never a small ACE - a
 *           different device with one bay, and at 13px the ACE's glyph was the same
 *           picture
 */
function headSource(planned) {
  const wrap = el('div', 'hsrc');
  if (!planned) return wrap;

  if (planned.feeder) {
    wrap.appendChild(feederBadge(17));
    wrap.appendChild(el('span', 'hsrc-name', 'Stock feeder'));
    return wrap;
  }

  const units = model.ace.units || [];

  if (model.ace.mode === 'multi') {
    /* The lane, named by the bays in it - `aceLaneLabel`'s own form. Every unit
       contributes bay `lane`, so the head's places are one from each. */
    const lane = planned.lane != null ? planned.lane : planned.head;
    const ids = units.map((u) => bayAddr(u.index, lane));
    wrap.classList.add('is-lane');
    wrap.appendChild(el('span', 'hsrc-name',
      ids.length ? `Lane · ${ids.join(' · ')}` : `Lane ${lane + 1}`));
    return wrap;
  }

  const unit = units.find((u) => u.index === planned.unit);
  if (!unit) {
    wrap.appendChild(el('span', 'hsrc-name dim', 'No ACE reported'));
    return wrap;
  }
  /* The badge is the Prepare tab's `AceBadge` and the Device page's unit strip, at
     ACE_ART's own numbers. One drawing of a cabinet, in a third place. */
  const badge = aceBadge(unit.bays, 20 / 26);
  badge.setAttribute('aria-hidden', 'true');
  wrap.appendChild(badge);
  const name = el('span', 'hsrc-name', `ACE ${unit.id}`);
  name.title = `ACE ${unit.id} · ${unit.model}`
    + (unit.humidity != null ? ` · ${unit.humidity}% RH` : '');
  wrap.appendChild(name);
  return wrap;
}

/* ---- the source picker (step 04) ---------------------------------------- */

/**
 * Every place that could feed this head, drawn as the unit it lives in.
 *
 * A unit that does not feed this head is GREYED, not dropped - the flow this is adapted
 * from greys the other nozzle's AMS, and it is right to: an absence cannot answer "why is
 * my second unit not in this list".
 */
function openPicker(anchor, fil, planned) {
  closeOverlays();
  const scrim = el('div', 'pick-scrim');
  scrim.onclick = closeOverlays;
  document.body.appendChild(scrim);

  const box = el('div', 'pick');
  box.appendChild(el('h4', null,
    `Where does ${fil.name} ${fil.type} come from on Toolhead ${planned.head + 1}?`));

  let chosen = g.sources[fil.index] || null;
  const units = model.ace.units || [];

  units.forEach((u) => {
    const feedsThisHead = !planned.feeder && planned.unit === u.index;
    const unit = el('div', 'pick-unit' + (feedsThisHead ? '' : ' is-off'));
    unit.appendChild(el('div', 'ul',
      `ACE ${u.id} · ${u.model}` + (feedsThisHead ? '' : ' — does not feed this toolhead')));
    const row = el('div', 'pick-row');
    u.bays.forEach((b) => row.appendChild(bayButton(u, b, () => chosen, (v) => {
      chosen = v; repaintPicker(box, chosen);
    })));
    unit.appendChild(row);
    box.appendChild(unit);
  });

  /* The stock feeder is this machine's "External": one place, no address, and the only
     source a head has when no unit feeds it. */
  const feederOn = !!planned.feeder;
  const fu = el('div', 'pick-unit' + (feederOn ? '' : ' is-off'));
  fu.appendChild(el('div', 'ul',
    'Stock feeder' + (feederOn ? '' : ' — this toolhead is fed by an ACE')));
  const frow = el('div', 'pick-row');
  const head = model.heads[planned.head];
  frow.appendChild(bayButton(null,
    { index: 0, addr: 'Feeder', occupied: head.loaded, known: !!head.type,
      material: head.type || '', color: head.color },
    () => chosen, (v) => { chosen = v; repaintPicker(box, chosen); }));
  frow.appendChild(el('div', null));
  frow.appendChild(el('div', null));
  frow.appendChild(el('div', null));
  fu.appendChild(frow);
  box.appendChild(fu);

  box.appendChild(el('p', 'pick-note',
    'The bay a filament comes from is written into the sliced file, so changing it here '
    + 'means slicing the plate again.'));

  const foot = el('div', 'pick-foot');
  const cancel = el('button', 'ghost', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = closeOverlays;
  const ok = el('button', 'primary', 'Use this and re-slice');
  ok.type = 'button';
  ok.style.minWidth = '0';
  ok.onclick = () => {
    if (chosen) { g.sources[fil.index] = chosen; g.dirty = true; }
    closeOverlays();
    paint();
  };
  foot.appendChild(cancel);
  foot.appendChild(ok);
  box.appendChild(foot);

  document.body.appendChild(box);
  position(box, anchor);
  repaintPicker(box, chosen);
}

function bayButton(unit, bay, get, set) {
  const b = el('button', 'pbay');
  b.type = 'button';
  b.dataset.addr = bay.addr;
  const top = el('span', 'pb-top');
  top.style.background = bay.occupied && bay.color ? bay.color
    : (bay.occupied ? '#B7BDC6' : 'var(--line)');
  b.appendChild(top);
  b.appendChild(el('span', 'pb-addr', bay.addr));
  b.appendChild(el('span', 'pb-mat', bay.occupied ? (bay.material || '?') : 'Empty'));
  const tick = svg('svg', { class: 'tickmark', viewBox: '0 0 10 10', width: 8, height: 8,
                            fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6,
                            'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  tick.appendChild(svg('path', { d: 'M1.6 5.2 3.8 7.4 8.4 2.6' }));
  b.appendChild(tick);
  b.onclick = () => set(bay.addr);
  b.setAttribute('aria-pressed', String(get() === bay.addr));
  return b;
}

function repaintPicker(box, chosen) {
  box.querySelectorAll('.pbay').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.addr === chosen));
  });
}

/* Anchored to the chip, then pulled back inside the dialog - a 340px popover opened from
   a chip in the right-hand column runs off a 714px window otherwise. */
function position(box, anchor) {
  const a = anchor.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  let left = a.left + a.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = a.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
}

/* ---- the regroup sheet (step 02) ---------------------------------------- */

/*
 * Three ways to group, and the third is the reason this option exists.
 *
 * `match` is the flow's Convenience Mode: group around what is ALREADY in the machine.
 * On a plate whose bays disagree, that is the whole fix - it turns an errand at the
 * printer into a re-slice at the desk, and it is the door D, E and F do not have.
 */
const MODES = [
  { key: 'saving', title: 'Fewest swaps',
    body: 'Groups filaments so the ACE head changes spools as little as possible. The '
        + 'plate may then need spools moved.' },
  { key: 'match', title: 'What is loaded',
    body: 'Groups filaments around the spools already in the bays and feeders, so '
        + 'nothing has to be moved. Usually costs more swaps.' },
  { key: 'custom', title: 'Choose myself',
    body: 'Place every filament by hand, in Prepare.' },
];

function openRegroup() {
  closeOverlays();
  const scrim = el('div', 'pick-scrim');
  scrim.onclick = closeOverlays;
  document.body.appendChild(scrim);

  let pick = g.mode;
  const sheet = el('div', 'sheet');
  sheet.appendChild(el('h4', null, 'Regroup filaments'));
  const body = el('div', 'sheet-body');
  const row = el('div', 'modes');

  MODES.forEach((m) => {
    const b = el('button', 'mode');
    b.type = 'button';
    b.dataset.key = m.key;
    const t = el('div', 'mtitle');
    t.appendChild(el('span', null, m.title));
    b.appendChild(t);
    b.appendChild(el('div', 'mbody', m.body));
    /* What it would cost THIS plate. The flow this is from describes each mode in the
       abstract; with the machine already read, the consequence is knowable, and a mode
       whose cost is unknown says so rather than showing a number it does not have. */
    b.appendChild(el('div', 'mcost', costOf(m.key)));
    b.onclick = () => {
      pick = m.key;
      row.querySelectorAll('.mode').forEach((x) => {
        x.setAttribute('aria-pressed', String(x.dataset.key === pick));
      });
    };
    b.setAttribute('aria-pressed', String(m.key === pick));
    row.appendChild(b);
  });

  body.appendChild(row);
  sheet.appendChild(body);

  const foot = el('div', 'sheet-foot');
  const cancel = el('button', 'ghost', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = closeOverlays;
  const ok = el('button', 'primary', 'Regroup and re-slice');
  ok.type = 'button';
  ok.style.minWidth = '0';
  ok.onclick = () => { g.mode = pick; g.dirty = true; closeOverlays(); paint(); };
  foot.appendChild(cancel);
  foot.appendChild(ok);
  sheet.appendChild(foot);
  document.body.appendChild(sheet);
}

function costOf(key) {
  const c = model.check;
  if (key === 'saving') {
    return `${model.plan.swaps} swaps · ${grams(model.plan.purge_g)}`;
  }
  if (key === 'match') {
    /* A mockup does not run the planner, so it says what it knows: how many places would
       stop disagreeing. The swap count is the planner's and is not invented here. */
    const n = c.differs + c.unsure;
    return n ? `no spools to move · ${n} fewer to fix` : 'nothing to move';
  }
  return 'you decide';
}

function closeOverlays() {
  document.querySelectorAll('.pick-scrim, .pick, .sheet').forEach((n) => n.remove());
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlays(); });

/* ---- options ------------------------------------------------------------ */

function paintOptions() {
  $('#s-prefs').hidden = !WITH_PRINT_SETUP;
  const body = $('#s-prefs .grp-body');
  body.textContent = '';
  body.appendChild(prefRows(model, () => {}));
}

/* ---- the foot ----------------------------------------------------------- */

/*
 * Two buttons in one, and which one it is depends on whether the plan still describes
 * the file. Nothing was overridden here and there is no tick: the operator either fixes
 * the machine, or changes the plan and slices again. Both are real; neither is a promise
 * that a wrong spool will do.
 */
function paintFoot() {
  const send = $('#send');
  const stage = $('#stage');
  const b = blockers(model);

  if (g.dirty) {
    send.disabled = false;
    send.textContent = 'Re-slice';
    stage.textContent = 'The plate has to be sliced again before it can be sent.';
  } else if (!WITH_PRINT_SETUP) {
    send.disabled = !model.device;
    send.textContent = 'Upload';
    stage.textContent = 'Ready';
  } else if (b.length) {
    send.disabled = true;
    send.textContent = 'Send';
    stage.textContent = `${b[0].text} Move the spools, or regroup and re-slice.`;
  } else {
    send.disabled = false;
    send.textContent = 'Send';
    stage.textContent = 'Ready';
  }
  stage.title = stage.textContent;
}

function paint() {
  paintModel();
  paintPrinter();
  $('#s-filament').hidden = false;
  paintFilament();
  paintOptions();
  paintFoot();
}

$('#subtitle').textContent = MODE === 'upload' ? 'Upload only' : SCENARIO.label;

$('#send').onclick = () => {
  if (g.dirty) {
    /* A mockup cannot slice. What it can do is show the state honestly: the plan is the
       new one, nothing disagrees with it any more, and the dialog is sendable again. */
    g.dirty = false;
    g.sources = {};
    $('#stage').textContent = 'Sliced with the new grouping.';
    paint();
    return;
  }
  $('#send').disabled = true;
  runSend(model, {
    onStage: ({ step, pct }) => {
      $('#stage').textContent = step.say;
      $('#fill').style.width = pct == null ? '100%' : `${pct}%`;
      $('#pct').textContent = pct == null ? '' : `${pct}%`;
    },
    onDone: () => { $('#stage').textContent = 'Sent'; $('#pct').textContent = ''; },
    onFail: (e) => { $('#stage').textContent = `Failed: ${e.message}`; },
  });
};

paint();
markMockup('G · Grouping');
expose(model, {
  destinationControls: () => document.querySelectorAll('.chip').length,
  disclosed: true,
  group: g,
  headSources: () => document.querySelectorAll('.hsrc').length,
  openPicker: () => { const c = document.querySelector('.chip'); if (c) c.click(); },
  openRegroup,
});
