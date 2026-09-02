/*
 * shell.js - the dialog's chrome, built from the registry.
 *
 * One <section> per panel, in the registry's order, with the spacing the bundle puts
 * between them. A panel is a title column of 120..180 (B.m4), a 12px gap (B.bA) and its
 * body - except a `bare` one, which is its body and nothing else.
 *
 * `mount` runs once. After that only `update` runs, so nothing here rebuilds a panel
 * that has an open menu under the pointer.
 */
'use strict';

import { el } from '../../../shared/js/dom.js';
import { panelsFor } from '../registry.js';

/** Build the whole body. Returns the panels that were mounted, with their roots. */
export function buildShell(container, route, ctx) {
  container.innerHTML = '';
  const panels = panelsFor(route);
  const mounted = [];

  container.appendChild(el('div', 'sp-16'));      // B.aE

  panels.forEach((panel, i) => {
    if (i > 0) container.appendChild(el('div', 'sp-8'));   // B.aB

    let body;
    if (panel.bare) {
      body = el('div', 'bare');
      body.id = `panel-${panel.id}`;
      container.appendChild(body);
    } else {
      const section = el('section', 'card');
      section.id = `panel-${panel.id}`;

      const title = el('div', 'card-title');
      title.appendChild(el('span', null, panel.title));
      if (panel.header && panel.header.kind === 'refresh') {
        const btn = el('button', 'card-refresh');
        btn.type = 'button';
        btn.title = panel.header.label;
        btn.setAttribute('aria-label', panel.header.label);
        btn.onclick = () => ctx.refresh(panel.id);
        title.appendChild(btn);
      }
      section.appendChild(title);
      section.appendChild(el('div', 'card-gap'));

      body = el('div', 'card-body');
      section.appendChild(body);
      container.appendChild(section);
    }

    panel.mount(body, ctx);
    mounted.push({ panel, root: body });
  });

  // The bundle pushes a 20 after the print half and another at the end; on ?path=5 only
  // the second exists.
  if (route === 'print') container.appendChild(el('div', 'sp-20'));
  container.appendChild(el('div', 'sp-20'));

  return mounted;
}
