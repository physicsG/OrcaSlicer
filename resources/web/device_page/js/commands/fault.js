/*
 * commands/fault.js - The one command the fault banner issues: re-ask the machine what is wrong.
 *
 * check_coverage.py reads the CMD references out of this file to answer "can a user
 * reach this command", and attributes them to the fault panel because this is the module
 * that panel is handed. That makes the attribution a fact about the imports rather than
 * a promise in a declaration - which is the difference that let a handler nothing called
 * count as implemented for as long as it did.
 */
'use strict';

import { CMD }
  from '../../../shared/js/protocol.js';

export function create(deps) {
  // `bridge` is deliberately NOT destructured: it does not exist yet when these are
  // built - boot() decides between the real host and the simulator - so it is reached
  // through deps each time rather than captured as null once.
  const { state, store, pending, session, cmd,
          send, setpoint, setStatus, render } = deps;



  return {
    queryException: async () => {
      try {
        store.exception = await deps.bridge.request(CMD.EXCEPTION_QUERY, {});
      } catch (e) {
        store.exception = null;
      }
      render();
    },

    /** Everything the printer will tell us about itself, in one sheet. */
  };
}
