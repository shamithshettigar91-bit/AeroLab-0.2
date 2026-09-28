// Headless tests for the AeroLab simulation core. No browser needed.
// Run from the project root:  node tests/flight-tests.js
const C = require('../src/core.js');
const { analyze, Flight, flightReport, atmosphere, orbitElements, massProps, MU, RE, G0 } = C;
const FC = require('../src/flight_computer.js');
const { REFERENCE_DESIGNS: REF, EXAMPLE_PROGRAMS: EX } = require('../src/programs.js');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  pass  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
}
function fly(design, opts = {}) {
  const an = analyze(design), f = new Flight(design);
  if (opts.sas !== undefined) f.sas = opts.sas;
  f.ignite();
  while (!f.done && f.t < 900) {
    if (opts.throttle) f.setThrottle(opts.throttle(f));
    f.step(0.01);
  }
  return { an, f, r: flightReport(f, an) };
}
const D = (stack, fins = null) => ({ stack, fins });
const BASE = ['nose_ogive', 'payload_sci', 'avionics'];
const near = (a, b, tol) => Math.abs(a - b) / Math.abs(b) < tol;

console.log('\nAtmosphere, against US Standard 1976 reference values');
check('sea level density 1.225 kg/m³', near(atmosphere(0).rho, 1.225, 0.005));
check('11 km pressure 22.6 kPa', near(atmosphere(11000).p, 22632, 0.01));
check('11 km temperature 216.65 K', near(atmosphere(11000).T, 216.65, 0.001));
check('sea level speed of sound 340 m/s', near(atmosphere(0).a, 340.3, 0.005));

console.log('\nEngineering analysis');
const a = analyze(D([...BASE, 'tank_m', 'eng_sparrow'], 'fins_s'));
check('design with fins is valid', a.valid);
check('lift-off mass adds up to 520 kg', Math.round(a.wet) === 520, a.wet);
check('ΔV follows the rocket equation', near(a.dvVac, 285 * 9.80665 * Math.log(a.wet / a.dry), 1e-9));
check('fins give a positive stability margin', a.smFull > 0);
check('no fins means unstable', analyze(D([...BASE, 'tank_m', 'eng_sparrow'])).smFull < 0);
check('missing flight computer is an error', !analyze(D(['nose_ogive', 'payload_sci', 'tank_m', 'eng_sparrow'])).valid);
check('missing payload is an error', !analyze(D(['nose_ogive', 'avionics', 'tank_m', 'eng_sparrow'])).valid);
check('engine not at the bottom is an error', !analyze(D([...BASE, 'eng_sparrow', 'tank_m'])).valid);

console.log('\nFlights');
let t = fly(D([...BASE, 'tank_m', 'eng_sparrow']));
check('starter without fins breaks up after burnout', t.f.failure && t.f.failure.kind === 'breakup', t.f.failure && t.f.failure.kind);
t = fly(D([...BASE, 'tank_m', 'eng_sparrow'], 'fins_s'));
check('starter with small fins reaches 100 km', t.r.success, `${(t.f.max.alt / 1000).toFixed(1)} km`);
t = fly(D([...BASE, 'tank_m', 'eng_sparrow']), { sas: false });
check('unstable with attitude hold off tumbles', t.f.failure && t.f.failure.kind === 'tumble');
t = fly(D([...BASE, 'tank_l', 'eng_heron'], 'fins_s'));
check('Heron at full throttle overloads the structure', t.f.failure && t.f.failure.kind === 'overload');
t = fly(D([...BASE, 'tank_l', 'eng_heron'], 'fins_s'), { throttle: f => (f.d.alt > 3000 && f.d.alt < 20000) ? 0.45 : 1 });
check('Heron throttled through max Q succeeds', t.r.success);
t = fly(D(['nose_ogive', 'payload_heavy', 'avionics', 'tank_m', 'eng_sparrow'], 'fins_s'));
check('heavy payload on tank M falls short', !t.r.success && !t.f.failure);
t = fly(D(['nose_ogive', 'payload_sci', 'srm_needle'], 'fins_l'));
check('solid motor with large fins succeeds', t.r.success);
t = fly(D(['nose_ogive', 'payload_sci', 'srm_needle']));
check('solid motor without fins tumbles', t.f.failure && t.f.failure.kind === 'tumble');

// ======================= V0.2: staging, orbit, flight computer =======================
const run = (design, opts = {}, maxT = 3000, stop) => {
  const f = new Flight(design, opts);
  if (opts.manualIgnite) f.ignite();
  while (!f.done && f.t < maxT && !(stop && stop(f))) f.step(0.01);
  return f;
};
const untilResolved = f => f.missionState !== 'pending' || (f.ballistic && f.mission.objective.type === 'altitude');
const prog = id => EX.find(e => e.id === id).code;

console.log('\nStaging: analysis and validation');
const tw = analyze(REF.twin, 'M003');
check('Twin has two stages', tw.nStages === 2 && tw.stages.length === 2);
check('per-stage ΔV follows the rocket equation', tw.stages.every(s => near(s.dvVac, (s.stage === 1 ? 298 : 285) * G0 * Math.log(s.m0 / s.mf), 1e-12)));
check('total ΔV is the sum of stages', near(tw.dvVac, tw.stages[0].dvVac + tw.stages[1].dvVac, 1e-12));
check('reference designs are valid for their missions', Object.values(REF).every(d => analyze(d, d.mission).valid));
check('single stage fails the two-stage mission rule', !analyze(REF.sounder, 'M003').valid);
check('flight computer in a lower stage is an error', analyze({ stack: ['nose_ogive', 'payload_sci', 'tank_m', 'eng_sparrow', 'decoupler', 'avionics', 'tank_l', 'eng_heron'], fins: null }).issues.some(i => i.text.includes('lower stage and would be thrown away')));
check('payload in a lower stage is an error', !analyze({ stack: ['nose_ogive', 'avionics', 'tank_m', 'eng_sparrow', 'decoupler', 'payload_sci', 'tank_l', 'eng_heron'], fins: null }).valid);
check('decoupler on top is an error', !analyze({ stack: ['decoupler', 'nose_ogive', 'payload_sci', 'avionics', 'tank_m', 'eng_sparrow'], fins: null }).valid);
check('lower stage without an engine is an error', !analyze({ stack: ['nose_ogive', 'payload_sci', 'avionics', 'tank_m', 'eng_sparrow', 'decoupler', 'tank_l'], fins: null }).valid);
check('stage engine without a tank in its own stage is an error', !analyze({ stack: ['nose_ogive', 'payload_sci', 'avionics', 'tank_m', 'eng_sparrow', 'decoupler', 'eng_heron'], fins: null }).valid);

console.log('\nStaging: separation physics');
{
  const f = new Flight(REF.twin); f.ignite();
  check('separation is refused on the pad', f.stage() === false && f.stageNo === 1);
  while (f.prop > 0 && !f.done) f.step(0.01);
  for (let i = 0; i < 100; i++) f.step(0.01);
  const m0 = massProps(f.veh, f.prop).m, px = m0 * f.vx, py = m0 * f.vy;
  f.stage();
  const deb = f.debris[0], mU = massProps(f.veh, f.prop).m;
  check('mass is split between the stages', near(mU + deb.m, m0, 1e-12), `${mU} + ${deb.m} vs ${m0}`);
  check('momentum is conserved at separation', near(mU * f.vx + deb.m * deb.vx, px, 1e-9) && near(mU * f.vy + deb.m * deb.vy, py, 1e-9));
  check('stages move apart', (f.vx - deb.vx) * Math.cos(f.th) + (f.vy - deb.vy) * Math.sin(f.th) > 0);
  check('upper stage is now active with a full tank', f.stageNo === 2 && f.prop === 330 && f.engine === 'off');
  check('fins leave with stage 1', f.veh.fins === null);
  const g = run(REF.twin, { manualIgnite: true }, 900, f2 => f2.prop < 200);
  g.stage();
  check('separating while firing causes recontact', g.failure && g.failure.kind === 'recontact');
  check('recontact report explains the fix', flightReport(g, tw).fixes.some(x => x.includes('burnout')));
}
{
  const f = run(REF.orbiter, { manualIgnite: true }, 900, x => x.prop <= 0);
  for (let i = 0; i < 100; i++) f.step(0.01);
  f.stage(); let n = 0;
  for (let k = 0; k < 4; k++) { if (f.ignite()) n++; for (let i = 0; i < 100; i++) f.step(0.01); f.shutdown(); for (let i = 0; i < 10; i++) f.step(0.01); }
  check('vacuum engine allows exactly 3 ignitions', n === 3 && f.ignitionsLeft === 0, n);
  const spent = run(REF.twin, { manualIgnite: true }, 2000, x => x.debris.length && !x.debris[0].alive || x.done);
  // (twin without staging never drops a stage; use the program run below for the debris impact test)
}

console.log('\nOrbital elements');
{
  const r = RE + 200000, v = Math.sqrt(MU / r);
  const el = orbitElements(r, 0, 0, v);
  check('circular orbit has zero eccentricity', el.ecc < 1e-12);
  check('circular apo and peri equal the altitude', near(el.apo, 200000, 1e-9) && near(el.peri, 200000, 1e-9));
  check('period matches 2π√(r³/μ)', near(el.period, 2 * Math.PI * Math.sqrt(r ** 3 / MU), 1e-12));
  const e2 = orbitElements(r, 0, 0, v * 1.05);
  check('faster than circular raises apoapsis only', e2.apo > 200000 && near(e2.peri, 200000, 1e-9));
  check('at periapsis, time to apoapsis is half a period', near(e2.timeToApo, e2.period / 2, 1e-9));
  check('escape speed is unbound', orbitElements(r, 0, 0, v * Math.SQRT2 * 1.001).bound === false);
}

console.log('\nFlight computer: safety and errors');
check('valid program compiles', FC.checkProgram('function* flight(ship) { yield; }').ok);
check('missing flight() is reported', FC.checkProgram('const x = 1;').error.message.includes('function* flight'));
check('non-generator flight() is reported', FC.checkProgram('function flight(ship) {}').error.message.includes('generator'));
check('syntax error reports its line', FC.checkProgram('function* flight(ship) {\n  ship.ignite(\n  yield;\n}').error.line === 3);
{
  const f = run(REF.sounder, { program: 'function* flight(ship) {\n  ship.ignite();\n  yield ship.wait(1);\n  ship.nonsense();\n}' }, 5);
  check('runtime error halts the program with its line', f.program.status === 'error' && f.program.error.line === 4, JSON.stringify(f.program.error));
  check('vehicle keeps flying after a program error', !f.done && f.liftoffT !== null);
}
{
  const f = run(REF.sounder, { program: 'function* flight(ship) {\n  ship.ignite();\n  while (true) { }\n}' }, 3);
  check('infinite loop is halted, not frozen', f.program.status === 'budget' && f.t >= 2.99);
}
{
  const f = run(REF.sounder, { program: 'function* flight(ship) { ship.log(typeof Date, typeof window, typeof fetch, typeof Function); yield; }' }, 0.2);
  check('Date, window, fetch and Function are hidden', f.events.some(e => e.msg === '▸ undefined undefined undefined undefined'));
}
{
  const src = 'function* flight(ship) { ship.log(Math.random()); yield; }';
  const a = run(REF.sounder, { program: src, seed: 7 }, 0.2), b = run(REF.sounder, { program: src, seed: 7 }, 0.2), c = run(REF.sounder, { program: src, seed: 8 }, 0.2);
  const val = f => f.events.find(e => e.kind === 'program').msg;
  check('Math.random is seeded and repeatable', val(a) === val(b) && val(a) !== val(c));
}
{
  const f = run(REF.sounder, { program: 'function* flight(ship) { yield ship.wait(2); ship.ignite(); }' }, 3);
  const ign = f.events.find(e => e.msg === 'Ignition');
  check('ship.wait resumes on time (20 Hz ticks)', ign && Math.abs(ign.t - 2) < 0.051, ign && ign.t);
}
{
  const f = run(REF.sounder, { program: 'function* flight(ship) { yield 5; }' }, 1);
  check('yielding a bare number waits that many seconds', f.program.status === 'running');
  const g = run(REF.sounder, { program: 'function* flight(ship) { yield "soon"; }' }, 1);
  check('yielding something invalid is a clear error', g.program.status === 'error' && g.program.error.message.includes('ship.wait'));
}

console.log('\nExample programs fly their reference rockets');
const cases = [['hello', 'sounder', 'M002'], ['blank', 'sounder', 'M002'], ['maxq', 'sounder', 'M002'], ['staging', 'twin', 'M003'],
  ['orbit', 'orbiter', 'M004'], ['orbit', 'orbiter', 'M005'], ['orbit', 'orbiter', 'M006'], ['orbit_eta', 'orbiter', 'M004'], ['orbit_eta', 'orbiter', 'M005']];
const results = {};
for (const [id, d, m] of cases) {
  const f = run(REF[d], { program: prog(id), mission: m }, 3000, untilResolved);
  results[id + m] = f;
  check(`${id} on ${REF[d].name} completes ${m}`, f.missionState === 'success', `${flightReport(f, analyze(REF[d], m)).cause}`);
}
check('maxq program lets the Heron survive max Q', run({ stack: ['nose_ogive', 'payload_sci', 'avionics', 'tank_l', 'eng_heron'], fins: 'fins_s' }, { program: prog('maxq') }, 900, untilResolved).missionState === 'success');
check('orbit reached is circular within the M005 band', results.orbitM005.d.peri >= 180000 && results.orbitM005.d.apo <= 220000);
check('the spent first stage falls back and is tracked', (() => { const f = results.orbitM004; for (let i = 0; i < 40000 && f.debris[0].alive; i++) f.step(0.01); return !f.debris[0].alive && f.debris[0].impact.down > 100000; })());
{
  const a = run(REF.orbiter, { program: prog('orbit'), mission: 'M004' }, 3000, untilResolved);
  const b = run(REF.orbiter, { program: prog('orbit'), mission: 'M004' }, 3000, untilResolved);
  check('programmed flights are deterministic', JSON.stringify(a.tele) === JSON.stringify(b.tele) && JSON.stringify(a.events) === JSON.stringify(b.events));
}

console.log('\nMission rules and failure analysis');
{
  const noIgnite = prog('staging').replace("  yield ship.wait(0.5);          // clear the spent stage\n  ship.ignite();", '');
  const f = run(REF.twin, { program: noIgnite, mission: 'M003' }, 900, untilResolved);
  check('forgetting to light stage 2 fails the mission', f.missionState !== 'success');
  check('report names the unlit stage', flightReport(f, analyze(REF.twin, 'M003')).factors.some(x => x.includes('never ignited')));
  const g = run(REF.orbiter, { program: prog('orbit'), mission: 'M006' }, 30);
  g.manual('throttle'); for (let i = 0; i < 100; i++) g.step(0.01);
  check('manual input fails the hands-off mission', g.missionState === 'failed');
  const code = prog('orbit'), noCirc = code.slice(0, code.indexOf('  // --- plan the circularisation burn')) + '}\n';
  check('program without circularisation still compiles', FC.checkProgram(noCirc).ok, FC.checkProgram(noCirc).error);
  const h = run(REF.orbiter, { program: noCirc, mission: 'M004' }, 3000, x => x.done || x.missionState !== 'pending');
  check('skipping circularisation does not reach orbit', h.missionState !== 'success' && h.done);
  check('orbit failure report gives a ΔV budget', flightReport(h, analyze(REF.orbiter, 'M004')).evidence.some(x => x.includes('Lost to gravity')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
