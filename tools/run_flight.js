// Bridge between Python (Streamlit) and the AeroLab simulation core.
// Reads one JSON request on stdin, writes one JSON response on stdout.
// The physics lives only in src/core.js; this file just drives it.
//
//   {"cmd":"parts"}
//   {"cmd":"analyze","design":{...},"mission":"M004"}
//   {"cmd":"check","program":"function* flight(ship) {...}"}
//   {"cmd":"fly","runs":[RUN, ...]}
//
// RUN options
//   design        {stack:[part ids, top to bottom], fins}           required
//   mission       'M001'…'M006'                                       default 'M002'
//   program       flight program source. If present, it flies the vehicle;
//                 otherwise the engine is lit at t = 0 (V0.1 behaviour).
//   seed          integer for the program's Math.random                default 1
//   sas           attitude hold on/off (manual flights)
//   throttlePlan  [{from, to, throttle}] by altitude (manual flights only)
//   telemetry     include the 10 Hz telemetry
//   stopAtApogee  stop at the first apogee (V0.1 sounding flights)
//   maxTime       simulated seconds; default 900, or 3600 for orbit missions
const { PARTS, MISSIONS, missionById, analyze, Flight, flightReport, MODEL } = require('../src/core.js');
const { checkProgram } = require('../src/flight_computer.js');
const { REFERENCE_DESIGNS, EXAMPLE_PROGRAMS } = require('../src/programs.js');

function summarize(an) {
  return {
    valid: an.valid, wet: an.wet, dry: an.dry, prop: an.prop, twr: an.twr, dvVac: an.dvVac, dvSL: an.dvSL,
    burn: an.burn, L: an.L, cgFull: an.cgFull, cgEmpty: an.cgEmpty, cp: an.cp, smFull: an.smFull, smEmpty: an.smEmpty,
    thrustSL: an.thrustSL || 0, thrustVac: an.thrustVac || 0, qMax: an.veh.qMax, gMax: an.veh.gMax, issues: an.issues,
    nStages: an.nStages, stages: an.stages,
  };
}
function fly(run) {
  const mission = missionById(run.mission || 'M002'), orbit = mission.objective.type === 'orbit';
  const an = analyze(run.design, run.mission);
  if (!an.valid) return { analysis: summarize(an), error: 'Design is not valid. Fix the issues first.' };
  if (run.program) { const c = checkProgram(run.program); if (!c.ok) return { analysis: summarize(an), error: `Program error${c.error.line ? ` on line ${c.error.line}` : ''}: ${c.error.message}` }; }
  const f = new Flight(run.design, { program: run.program || null, mission: run.mission, seed: run.seed ?? 1 });
  if (run.sas !== undefined && f.veh.hasComputer) f.sas = !!run.sas;
  const plan = run.program ? [] : (run.throttlePlan || []);
  const maxT = run.maxTime || (orbit ? 3600 : 900);
  if (!run.program) f.ignite();
  let resolvedAt = null;
  while (!f.done && f.t < maxT) {
    if (plan.length) {
      const alt = f.d.alt; let thr = 1;
      for (const p of plan) if (alt >= p.from && alt < p.to) thr = p.throttle;
      f.setThrottle(thr);
    }
    f.step(0.01);
    if (run.stopAtApogee && f.apogeeT !== null) break;
    if (!run.stopAtApogee && (run.program || run.mission)) {
      // stop 2 s after the outcome is known, so every run ends the same way
      if (resolvedAt === null && (f.missionState !== 'pending' || (!orbit && f.ballistic))) resolvedAt = f.t;
      if (resolvedAt !== null && f.t - resolvedAt >= 2) break;
    }
  }
  if (!f.done) f.end();
  const r = flightReport(f, an), d = f.d;
  return {
    analysis: summarize(an), report: r, success: r.success,
    apogee: f.apogee ?? f.max.alt, max: f.max, loss: f.loss,
    failure: f.failure, events: f.events, liftoffT: f.liftoffT,
    mission: mission.id, missionState: f.missionState, stages: f.stageLog, stageReached: f.stageNo,
    orbit: { periapsis: d.peri > -6e6 ? d.peri : null, apoapsis: Number.isFinite(d.apo) ? d.apo : null, eccentricity: d.ecc, period: d.period, bestPeriapsis: f.bestPeri > -6e6 ? f.bestPeri : null },
    propellantLeft: f.prop, flightTime: f.t,
    program: f.program ? { status: f.program.status, error: f.program.error } : null,
    telemetry: run.telemetry ? f.tele : undefined,
  };
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  try {
    const req = JSON.parse(input || '{}');
    let out;
    if (req.cmd === 'parts') out = { parts: PARTS, model: MODEL };
    else if (req.cmd === 'catalog') out = { parts: PARTS, model: MODEL, missions: MISSIONS, designs: REFERENCE_DESIGNS, programs: EXAMPLE_PROGRAMS };
    else if (req.cmd === 'analyze') out = summarize(analyze(req.design, req.mission));
    else if (req.cmd === 'check') out = checkProgram(req.program || '');
    else if (req.cmd === 'fly') out = { results: req.runs.map(fly), model: MODEL };
    else throw new Error(`Unknown command: ${req.cmd}`);
    process.stdout.write(JSON.stringify(out));
  } catch (e) {
    process.stderr.write(String(e && e.stack || e));
    process.exit(1);
  }
});
