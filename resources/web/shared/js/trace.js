/*
 * trace.js - the live WCP trace pane.
 *
 * A development aid, not part of either shipped surface, and shared because both of them
 * want the same one: `--watch` turns the terminal into a running list of what each click
 * sent, and the pane is where that is read on screen.
 *
 * The Device page's own filament artwork used to live in this file and moved out with
 * it - it is that page's drawing, not a trace concern.
 */
'use strict';

import { el } from './dom.js';

/* ---- trace ---------------------------------------------------------- */
export function makeTrace(pane) {
  return (kind, packet) => {
    if (!pane || pane.dataset.paused === '1') return;
    const line = el('div', `t t-${kind}`);
    const cmd = (packet && packet.payload && packet.payload.cmd)
      || (packet && packet.header && packet.header.event_id ? 'push' : '');
    line.textContent = `${String(kind).padEnd(9)} ${cmd}`;
    line.title = JSON.stringify(packet);
    pane.appendChild(line);
    while (pane.childElementCount > 200) pane.removeChild(pane.firstChild);
    pane.scrollTop = pane.scrollHeight;
  };
}

