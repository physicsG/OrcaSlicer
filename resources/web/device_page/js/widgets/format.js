/*
 * format.js - formatting shared by more than one view. Small on purpose: a helper only
 * one panel uses belongs in that panel.
 */
'use strict';

import { $ } from '../core/dom.js';
import { illustration } from './art.js';

/** hh:mm:ss from seconds, the granularity the shipped page uses for a job. */
export function clock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * The job card, laid out the way the shipped page lays it out.
 *
 * The rebuild used to show an illustration and the words "No active print" when the
 * machine was idle, which is a different card rather than the same card at zero. The
 * original keeps ONE card and zeroes it: status badge, machine name, thumbnail,
 * filename, percentage, layers, time, progress bar, and one round button. An idle
 * printer and a printing one differ in the numbers, not in the furniture.
 */
