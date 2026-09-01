/*
 * The Homing dialog against the G28 this machine actually performs.
 *
 * The first two attempts at this wait both closed the dialog while the bed was still
 * moving, and both were built on `homed_axes`. A real G28 was then watched end to end
 * (811002511261022618B3, 2026-09-01, 42 s, sampled every 200 ms) and disposed of it:
 *
 *       0.0s  homed_axes "xyz"   idle_timeout "Ready"     vel 0    <- G28 sent
 *       1.6s  homed_axes "xyz"   idle_timeout "Printing"  vel 0
 *       5.5s  homed_axes "xyz"                            vel 40
 *       7.6s  homed_axes "xyz"                            vel 0    <- and seven more
 *      27.6s  homed_axes "xyz"                            vel 0     z 309
 *      41.7s  homed_axes "xyz"   idle_timeout "Ready"     vel 0    <- done
 *
 * `homed_axes` never moved, so as a done() it was true before the machine started; and
 * `live_velocity` sat at exactly 0 for two seconds at a time, eight times, so no
 * stillness window short enough to be responsive survives it. `idle_timeout` bracketed
 * the operation exactly, and that is what the wait ends on.
 *
 * That shape is replayed here, shortened but with the killer intervals intact: the
 * lead-in before the machine picks the command up, and a long zero-velocity gap in the
 * middle of the work. The simulator models neither field, so both are posed on `state`
 * - the object the wait reads them from. The loop under test is the page's.
 */
(function(){
  const out=[]; const P=window.__devicePage;
  const say=(n,g,w)=>out.push(`${g===w?'PASS':'FAIL'}  ${n}`+(g===w?'':`   got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const open=()=>!!document.querySelector('.dialog.blocking');
  const msg =()=>{const m=document.querySelector('.blocking-msg');return m?m.textContent:null;};

  // What the machine says. `homed` is fixed at xyz for the whole run, because that is
  // what it read - changing it here would be testing a printer nobody has.
  const homed = 'xyz';
  let running = false, vel = 0;
  const S = P.state;
  S.toolhead = () => ({ activeKey:null, activeIndex:null, x:0, y:0, z:0, e:0,
    homedAxes: homed, isHomed:()=>true, allHomed:true, present:true });
  S.busyReason = () => ({ label: vel ? 'Moving…' : (running ? 'Working…' : null),
    busy: !!vel || running, vague: true, homing:false,
    homedAxes: homed, calibrationStep:null });
  S.activity = () => ({ mainState:0, actionCode:0 });

  (async ()=>{
   try{
    P.byModule.control.home();
    await wait(600);
    say('the dialog opens', open(), true);
    // 0.0 -> 1.6s: the command is sent, the machine has not picked it up. Nothing is
    // moving and idle_timeout still reads Ready, so every "it has stopped" test is
    // momentarily true - and homed_axes has been true since before the press.
    say('and does not close before the machine has started', open(), true);
    say('nor on the homed_axes it was already reporting',
        P.state.toolhead().allHomed, true);

    running = true;                    // idle_timeout -> Printing, still nothing moving
    await wait(1200);
    say('still up once the machine takes the command', open(), true);

    vel = 40;                          // the first homing move
    await wait(1200);
    say('still up while an axis is homing', open(), true);

    vel = 0;                           // the measured two-second gap BETWEEN moves
    await wait(2600);
    say('STILL up across a two-second gap between homing moves', open(), true);

    vel = 2;                           // the bed, travelling
    await wait(1200);
    say('still up while the bed travels', open(), true);
    say('and the dialog keeps its own line rather than flickering Moving/Working',
        msg(), 'Homing all axes…');

    vel = 0; running = false;          // idle_timeout -> Ready
    await wait(1600);
    say('and closes when the machine goes quiet', open(), false);

    // ---- a G28 the machine never acknowledges is reported, not closed ----
    // Nothing ever reports busy, so there is no edge to end on. The wait must not sit
    // there for ever, and must not pretend it finished either.
    P.byModule.control.home();
    await wait(1200);
    say('a command the machine never picks up leaves the dialog up', open(), true);
    say('and it is still the waiting line', msg(), 'Homing all axes…');
   }catch(e){ out.push('FAIL  threw: '+(e&&e.stack||e)); }
   window.__report = out.join('\n');
  })();
})();
