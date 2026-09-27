const C = require('./src/core.js'), { REFERENCE_DESIGNS: D, EXAMPLE_PROGRAMS: E } = require('./src/programs.js');
const base = E.find(e => e.id === 'orbit').code;
function fly(design, code, mission) {
  const an = C.analyze(design, mission), f = new C.Flight(design, { program: code, mission });
  while (!f.done && f.t < 4000 && !(f.missionState !== 'pending')) f.step(0.01);
  while (!f.done && f.missionState === 'success' && f.t - f.missionT < 1) f.step(0.01);
  return { f, R: C.flightReport(f, an) };
}
const out = [];
for (const TE of [50000, 60000, 70000]) for (const EP of [20, 25, 30, 35]) for (const AOA of [3, 6, 9]) for (const MINP of [0, 5]) {
  const code = base.replace('const TURN_END = 50000;', `const TURN_END = ${TE};`).replace('const END_PITCH = 20;', `const END_PITCH = ${EP};`)
    .replace('ship.pitch(Math.max(5, ship.flightPathAngle - 6));', `ship.pitch(Math.max(${MINP}, ship.flightPathAngle - ${AOA}));`);
  const { f, R } = fly(D.orbiter, code, 'M005');
  const cut = f.events.find(e => e.msg.includes('Coasting')), ign = f.events.filter(e => e.msg === 'Stage 2 ignition')[1];
  out.push({ ok: R.success, TE, EP, AOA, MINP, coast: cut && ign ? (ign.t - cut.t).toFixed(0) : '-', t: f.t.toFixed(0), prop: f.prop.toFixed(0), orbit: `${(f.d.peri/1000).toFixed(0)}x${(f.d.apo/1000).toFixed(0)}`, cause: R.cause.slice(0, 60) });
}
out.filter(o => o.ok).sort((a, b) => b.prop - a.prop).slice(0, 12).forEach(o => console.log(JSON.stringify(o)));
console.log('successes', out.filter(o => o.ok).length, '/', out.length);
