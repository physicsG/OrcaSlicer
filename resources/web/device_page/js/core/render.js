/*
 * render.js - one answer to "the state changed, what do I do with the DOM".
 *
 * There were four, all in the same page, and every focus, scroll and popover-anchor bug
 * in the log is downstream of the difference between them:
 *
 *   status card   built once on a signature, then values patched in place
 *   storage       signature-guarded, then rebuilt whole, with scrollTop saved by hand
 *   the other five  `innerHTML = ''` on every frame, about once a second
 *
 * The third is the one that hurts. A node rebuilt under the user cannot hold focus, a
 * selection, a scroll position, an open popover anchored to it, or a hover. Each of
 * those was noticed separately and fixed with a guard invented on the spot - which is
 * how there came to be four disciplines rather than one.
 *
 * The rule these primitives encode: **build structure once, then write only what
 * differs.** Structure changes are keyed by a signature, so they happen when the shape
 * genuinely changes rather than on every tick; lists are reconciled by key, so a list
 * that gains an item at the end does not throw away the items already on screen.
 */
'use strict';

/**
 * Rebuild `root` only when `sig` changes.
 *
 * Returns whether it rebuilt, because a caller usually has wiring to redo when it did.
 * `data-built` is the same attribute the status card already used - the stylesheet and
 * the structural DOM dump both read it.
 */
export function rebuildOn(root, sig, build) {
  if (root.dataset.built === sig) return false;
  root.dataset.built = sig;
  root.innerHTML = '';
  build(root);
  return true;
}

/**
 * Reconcile `root`'s children against `items`, matching by key.
 *
 * What this buys over `innerHTML = ''`: the container is never replaced, so its scroll
 * position survives without being saved and restored by hand; a node that is still in
 * the list is the *same* node, so anything the browser is holding on it - focus, a text
 * selection, a hover, a popover anchored to it - survives too; and a list that grew by
 * ten items rebuilds ten nodes rather than all of them.
 *
 *   key    identity: the same item across frames must give the same key
 *   sig    optional; when it changes the node is rebuilt. Use it for a card whose
 *          contents change but which is not worth patching field by field.
 *   create build a fresh node
 *   update optional; patch an existing node in place
 */
export function keyedList(root, items, { key, sig, create, update }) {
  const have = new Map();
  for (const n of Array.from(root.children)) {
    if (n.dataset.key != null) have.set(n.dataset.key, n);
  }

  let prev = null;
  const used = new Set();
  (items || []).forEach((it, i) => {
    // A key the caller did not make unique. Two nodes cannot share one, so the second
    // is created fresh every frame while the first stays unreachable - not in `have`,
    // so the sweep below cannot see it either. It leaks one node per duplicate per
    // repaint, silently and without limit: Storage's grid drew 72 cards for 60
    // recordings before the key that caused it was fixed.
    //
    // The key is still the caller's business - see cardKey in storage-view.js for what
    // a right one costs - but getting it wrong should cost a rebuilt card, which is
    // what this makes it, and not an unbounded DOM.
    let k = String(key(it, i));
    if (used.has(k)) k = `${k}#${i}`;
    used.add(k);
    const s = sig ? String(sig(it, i)) : null;
    let n = have.get(k);
    if (n) {
      have.delete(k);
      // Same item, different contents: cheaper to rebuild one card than to write a
      // patcher for every field of every kind of card.
      //
      // The old node has to be taken OUT, not merely passed over. It was dropped from
      // `have` on the line above, so the sweep at the end of this function can no longer
      // see it - abandoning it here left it in the DOM for good, and a list whose
      // contents changed grew by one node per change per repaint. The Filament panel
      // reached ten slots where there are four.
      if (s != null && n.dataset.sig !== s) {
        n.remove();
        n = null;
      }
    }
    if (!n) {
      n = create(it, i);
      n.dataset.key = k;
      if (s != null) n.dataset.sig = s;
    }
    if (update) update(n, it, i);

    // Put it where it belongs, and only if it is not already there - a move is a
    // reparent, which costs whatever the browser was holding on the node.
    const at = prev ? prev.nextElementSibling : root.firstElementChild;
    if (n !== at) root.insertBefore(n, at);
    prev = n;
  });

  have.forEach((n) => n.remove());
}

/**
 * Write text only when it differs.
 *
 * Assigning `textContent` replaces the text node even when the string is identical,
 * which collapses any selection inside it. At one repaint a second that makes text
 * inside a live panel impossible to select.
 */
export function text(node, value) {
  const v = value == null ? '' : String(value);
  if (node.textContent !== v) node.textContent = v;
}

/** Set an attribute, or remove it when the value is null/undefined/false. */
export function attr(node, name, value) {
  if (value == null || value === false) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
    return;
  }
  const v = String(value);
  if (node.getAttribute(name) !== v) node.setAttribute(name, v);
}

/** Same, for a `data-*` entry, which is how this page carries state the CSS reads. */
export function data(node, name, value) {
  if (value == null || value === false || value === '') {
    if (node.dataset[name] !== undefined) delete node.dataset[name];
    return;
  }
  const v = String(value);
  if (node.dataset[name] !== v) node.dataset[name] = v;
}
