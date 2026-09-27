// ================= AEROLAB SIMULATION CORE (pure, no rendering) =================
// All internal units SI: kg, m, s, N, Pa, K, rad.
// The core never touches the page. The game, the Node tests and the Streamlit
// dashboard all run this same file, so they can never disagree.
const G0 = 9.80665, MU = 3.986004418e14, RE = 6371000, WE = -7.2921159e-5;
const P0 = 101325, RAIR = 287.053, DIAM = 0.6, AREF = Math.PI * (DIAM / 2) ** 2;
const DEG = Math.PI / 180;
const MODEL = {
  physics: 'AeroModel 0.2', atmosphere: 'US76-lite 1.0', gravity: 'PointMass 1.0', integrator: 'RK4 at 100 Hz',
  staging: 'Impulse 1.0', flightComputer: 'FlightComputer 1.0 at 20 Hz',
};
const PROGRAM_TICK = 5; // simulation steps per flight-computer tick (100 Hz / 5 = 20 Hz)

// ---------- Part definitions (data, not code) ----------
// `ignitions` defaults to 1. `computer` marks the flight computer. `torque` is reaction-wheel torque in N·m.
const PARTS = {
  nose_ogive: { cat: 'nose', name: 'Ogive nose cone', mass: 18, len: 1.2, cd: 0.15, cna: 2, cpFrac: 0.466, qMax: 150000,
    note: 'Low drag. The pointed shape keeps pressure forward.' },
  nose_cone: { cat: 'nose', name: 'Conical nose cone', mass: 12, len: 0.8, cd: 0.24, cna: 2, cpFrac: 0.667, qMax: 150000,
    note: 'Lighter and shorter, but more drag.' },
  payload_sci: { cat: 'payload', name: 'Science payload', mass: 25, len: 0.6, qMax: 120000, gMax: 15, payload: 10,
    note: '10 kg instrument in a 15 kg housing. Survives up to 15 g.' },
  payload_heavy: { cat: 'payload', name: 'Heavy payload', mass: 85, len: 0.9, qMax: 120000, gMax: 12, payload: 60,
    note: '60 kg instrument package. Survives up to 12 g.' },
  avionics: { cat: 'avionics', name: 'Flight computer', mass: 12, len: 0.3, qMax: 150000, computer: true,
    note: 'Runs your flight program, commands every engine and holds attitude. Keep it in the top stage.' },
  wheels: { cat: 'avionics', name: 'Reaction wheels', mass: 9, len: 0.25, qMax: 150000, torque: 400,
    note: 'Turns the vehicle without engine thrust, so it can line up for a burn while coasting. 400 N·m.' },
  tank_s: { cat: 'tank', name: 'Propellant tank S', mass: 40, prop: 160, len: 1.0, qMax: 120000,
    note: '160 kg kerosene and liquid oxygen.' },
  tank_m: { cat: 'tank', name: 'Propellant tank M', mass: 70, prop: 330, len: 2.0, qMax: 120000,
    note: '330 kg kerosene and liquid oxygen.' },
  tank_l: { cat: 'tank', name: 'Propellant tank L', mass: 100, prop: 500, len: 3.0, qMax: 120000,
    note: '500 kg kerosene and liquid oxygen.' },
  tank_c3: { cat: 'tank', name: 'Carbon tank C3', mass: 38, prop: 540, len: 3.0, qMax: 120000,
    note: 'Lightweight composite tank, 540 kg propellant. Built for orbital stages.' },
  tank_c5: { cat: 'tank', name: 'Carbon tank C5', mass: 60, prop: 900, len: 5.0, qMax: 120000,
    note: 'Large composite tank, 900 kg propellant.' },
  decoupler: { cat: 'decoupler', name: 'Stage decoupler', mass: 15, len: 0.3, qMax: 150000, impulse: 600,
    note: 'Joins two stages. Everything below it drops away at separation. Springs push the stages apart with 600 N·s.' },
  eng_sparrow: { cat: 'engine', type: 'liquid', name: 'LR-12 Sparrow', mass: 55, len: 0.9, tvac: 16000, ispSL: 250, ispVac: 285, gimbal: 5 * DEG, qMax: 150000,
    note: 'Small liquid engine. Throttles 40–100%, gimbals 5°. One ignition.' },
  eng_heron: { cat: 'engine', type: 'liquid', name: 'LR-40 Heron', mass: 110, len: 1.3, tvac: 42000, ispSL: 262, ispVac: 298, gimbal: 4 * DEG, qMax: 150000,
    note: 'Powerful liquid engine. Throttles 40–100%, gimbals 4°. One ignition.' },
  eng_condor: { cat: 'engine', type: 'liquid', name: 'LR-60 Condor', mass: 125, len: 1.4, tvac: 68000, ispSL: 284, ispVac: 312, gimbal: 5 * DEG, qMax: 150000,
    note: 'First-stage booster engine for orbital rockets. Throttles 40–100%, gimbals 5°. One ignition.' },
  eng_kestrel: { cat: 'engine', type: 'liquid', name: 'RV-9 Kestrel vacuum engine', mass: 30, len: 1.0, tvac: 12000, ispSL: 170, ispVac: 345, gimbal: 4 * DEG, qMax: 150000, ignitions: 3,
    note: 'Upper-stage engine with a large nozzle. Excellent in vacuum, weak at sea level. Three ignitions.' },
  srm_needle: { cat: 'engine', type: 'solid', name: 'SR-9 Needle solid motor', mass: 140, prop: 600, len: 4.0, tvac: 24000, ispSL: 228, ispVac: 252, gimbal: 0, qMax: 150000,
    note: 'Carries its own 600 kg propellant. Cannot throttle, steer or shut down.' },
  fins_s: { cat: 'fins', name: 'Small fin set', mass: 10, cna: 6, cd: 0.03,
    note: 'Four fins on the tail of the first stage. Moves the centre of pressure aft.' },
  fins_l: { cat: 'fins', name: 'Large fin set', mass: 20, cna: 11, cd: 0.06,
    note: 'Strong stability at the cost of mass and drag.' },
};
const LIMITS = { qAlpha: 4500 }; // Pa·rad bending limit (q × sin α)

// ---------- Missions (data) ----------
// objective.type: 'altitude' (value in m) or 'orbit' (peri minimum, optional apo maximum, in m)
const MISSIONS = [
  { id: 'M001', title: 'First flight', brief: 'Carry the payload above 10 km.', objective: { type: 'altitude', value: 10000 },
    successMsg: 'Payload crossed 10 km. Mission objective complete.', dvHint: 900 },
  { id: 'M002', title: 'Edge of space', brief: 'Carry the payload past the Kármán line at 100 km, where space begins by convention.',
    objective: { type: 'altitude', value: 100000 }, successMsg: 'Payload crossed 100 km. Mission objective complete.', dvHint: 2500 },
  { id: 'M003', title: 'Two stages', brief: 'Fly a rocket with at least two stages. Separate cleanly and take the payload above 500 km.',
    objective: { type: 'altitude', value: 500000 }, constraints: { minStages: 2 }, successMsg: 'Payload crossed 500 km. Mission objective complete.', dvHint: 4500 },
  { id: 'M004', title: 'Orbit', brief: 'Put the payload into orbit: periapsis above 150 km, engine off.',
    objective: { type: 'orbit', peri: 150000 }, constraints: { minStages: 2 }, successMsg: 'Orbit achieved. Mission objective complete.', dvHint: 9000 },
  { id: 'M005', title: 'Circular orbit', brief: 'Reach a circular orbit: periapsis and apoapsis both between 180 and 220 km.',
    objective: { type: 'orbit', peri: 180000, apo: 220000 }, constraints: { minStages: 2 }, successMsg: 'Circular orbit achieved. Mission objective complete.', dvHint: 9200 },
  { id: 'M006', title: 'Hands off', brief: 'Reach orbit (periapsis above 150 km) with the flight program alone. Any manual input fails the mission.',
    objective: { type: 'orbit', peri: 150000 }, constraints: { minStages: 2, programOnly: true }, successMsg: 'Autonomous orbit achieved. Mission objective complete.', dvHint: 9000 },
];
const missionById = id => MISSIONS.find(m => m.id === id) || MISSIONS[1];

// ---------- Atmosphere (US Standard 1976, simplified) ----------
const LAY = [
  [0, 288.15, -0.0065, 101325], [11000, 216.65, 0, 22632.1], [20000, 216.65, 0.001, 5474.89],
  [32000, 228.65, 0.0028, 868.019], [47000, 270.65, 0, 110.906], [51000, 270.65, -0.0028, 66.9389],
  [71000, 214.65, -0.002, 3.95642], [86000, 184.65, 0, 0.30230]];
function atmosphere(h) {
  if (h < 0) h = 0;
  let k = LAY.length - 1; while (k > 0 && h < LAY[k][0]) k--;
  const [hb, Tb, Lr, pb] = LAY[k]; const dh = h - hb;
  let T, p;
  if (Lr === 0) { T = Tb; p = pb * Math.exp(-G0 * dh / (RAIR * Tb)); }
  else { T = Tb + Lr * dh; p = pb * Math.pow(T / Tb, -G0 / (RAIR * Lr)); }
  return { T, p, rho: p / (RAIR * T), a: Math.sqrt(1.4 * RAIR * T) };
}

// ---------- Vehicle assembly ----------
// A design is { stack: [part ids, top to bottom], fins: id | null }. Decouplers split the stack into
// stages; the decoupler belongs to the stage below it. Stage 1 is the bottom stage and fires first.
// Fins attach to the tail of stage 1 and drop with it.
function stageSegments(stack) {
  const segs = []; let start = 0;
  stack.forEach((id, i) => { if (PARTS[id] && PARTS[id].cat === 'decoupler' && i > 0) { segs.push([start, i]); start = i; } });
  segs.push([start, stack.length]);
  return segs.reverse(); // index 0 = stage 1 (bottom)
}

function buildVehicle(design) {
  const items = []; let s = 0;
  for (const id of design.stack) {
    const def = PARTS[id]; if (!def) continue;
    items.push({ id, def, sTop: s, sMid: s + def.len / 2, sBot: s + def.len }); s += def.len;
  }
  const L = Math.max(s, 0.1);
  const fins = design.fins ? PARTS[design.fins] : null;
  // the active stage is the bottom segment (everything from the last decoupler down)
  let segStart = 0; items.forEach((it, i) => { if (it.def.cat === 'decoupler' && i > 0) segStart = i; });
  const bottom = items.slice(segStart);
  const engIt = bottom.filter(i => i.def.cat === 'engine').pop() || null;
  const eng = engIt ? engIt.def : null;
  const tanks = bottom.filter(i => i.def.cat === 'tank');
  const containers = !eng ? [] : (eng.type === 'solid' ? [engIt] : tanks);
  const propCap = containers.reduce((a, i) => a + i.def.prop, 0);
  const deadProp = items.filter(i => i.def.prop && !containers.includes(i)).reduce((a, i) => a + i.def.prop, 0);
  const sFin = L - 0.45;
  const dryMass = items.reduce((a, i) => a + i.def.mass, 0) + (fins ? fins.mass : 0) + deadProp;
  const top = items[0];
  const hasNoseTop = top && top.def.cat === 'nose';
  const aeroTerms = [];
  aeroTerms.push(hasNoseTop ? [top.def.cna, top.def.len * top.def.cpFrac] : [2, 0.05]);
  if (fins) aeroTerms.push([fins.cna, sFin]);
  const cna = aeroTerms.reduce((a, t) => a + t[0], 0);
  const cp = aeroTerms.reduce((a, t) => a + t[0] * t[1], 0) / cna;
  const cd0 = (hasNoseTop ? top.def.cd : 0.8) + 0.012 * L + (fins ? fins.cd : 0);
  const mdotMax = eng ? eng.tvac / (eng.ispVac * G0) : 0;
  const qMax = Math.min(...items.map(i => i.def.qMax || 1e9));
  const payloads = items.filter(i => i.def.cat === 'payload');
  const gMax = payloads.length ? Math.min(...payloads.map(p => p.def.gMax)) : 99;
  const sEng = engIt ? engIt.sTop + 0.25 : L;
  const hasComputer = items.some(i => i.def.computer);
  const wheelTorque = hasComputer ? items.reduce((a, i) => a + (i.def.torque || 0), 0) : 0;
  const stages = stageSegments(design.stack).length;
  return { design, items, L, fins, sFin, eng, engIt, containers, propCap, deadProp, dryMass, aeroTerms, cna, cp, cd0,
    mdotMax, qMax, gMax, sEng, hasComputer, payloads, wheelTorque, stages };
}

function massProps(veh, prop) {
  const frac = veh.propCap > 0 ? Math.max(prop, 0) / veh.propCap : 0;
  const pts = [];
  for (const it of veh.items) {
    let m = it.def.mass;
    if (veh.containers.includes(it)) m += it.def.prop * frac;
    else if (it.def.prop) m += it.def.prop; // propellant of stages not yet firing
    pts.push([m, it.sMid, it.def.len]);
  }
  if (veh.fins) pts.push([veh.fins.mass, veh.sFin, 0.8]);
  let m = 0, ms = 0; for (const p of pts) { m += p[0]; ms += p[0] * p[1]; }
  const cg = m > 0 ? ms / m : 0;
  let I = 0; for (const p of pts) I += p[0] * ((p[1] - cg) ** 2 + p[2] * p[2] / 12);
  let damp = 0.05; for (const t of veh.aeroTerms) damp += 0.5 * t[0] * ((t[1] - cg) / veh.L) ** 2;
  return { m, cg, I: Math.max(I, 1), damp };
}

// ---------- Static engineering analysis (builder panel) ----------
function analyze(design, missionId) {
  const veh = buildVehicle(design);
  const full = massProps(veh, veh.propCap), empty = massProps(veh, 0);
  const e = veh.eng;
  const r = { veh, wet: full.m, dry: empty.m, prop: veh.propCap, cgFull: full.cg, cgEmpty: empty.cg, cp: veh.cp, L: veh.L,
    smFull: (veh.cp - full.cg) / DIAM, smEmpty: (veh.cp - empty.cg) / DIAM, twr: 0, dvVac: 0, dvSL: 0, burn: 0, issues: [], stages: [] };
  if (e) {
    const tSL = veh.mdotMax * e.ispSL * G0;
    r.thrustSL = tSL; r.thrustVac = e.tvac; r.twr = tSL / (full.m * G0);
    if (veh.propCap > 0) {
      r.dvVac = e.ispVac * G0 * Math.log(full.m / empty.m);
      r.dvSL = e.ispSL * G0 * Math.log(full.m / empty.m);
      r.burn = veh.propCap / veh.mdotMax;
    }
  }
  // per-stage analysis: stage k flies with every stage above it attached
  const segs = stageSegments(design.stack);
  segs.forEach(([a, b], k) => {
    const sub = buildVehicle({ stack: design.stack.slice(0, b), fins: k === 0 ? design.fins : null });
    const m0 = massProps(sub, sub.propCap).m, mf = massProps(sub, 0).m, se = sub.eng;
    const st = { stage: k + 1, parts: design.stack.slice(a, b), engine: se ? se.name : null, m0, mf, prop: sub.propCap,
      dvVac: 0, twr: 0, burn: 0, ignitions: se ? (se.ignitions || 1) : 0 };
    if (se && sub.propCap > 0) {
      st.dvVac = se.ispVac * G0 * Math.log(m0 / mf);
      st.twr = (k === 0 ? sub.mdotMax * se.ispSL * G0 : se.tvac) / (m0 * G0);
      st.burn = sub.propCap / sub.mdotMax;
    }
    r.stages.push(st);
  });
  if (segs.length > 1) r.dvVac = r.stages.reduce((a, s) => a + s.dvVac, 0);
  r.nStages = segs.length;

  const I = r.issues, stk = design.stack;
  const add = (level, text, part, fix) => I.push({ level, text, part, fix });
  const items = veh.items, multi = segs.length > 1;
  const stageOf = i => segs.findIndex(([a, b]) => i >= a && i < b) + 1;
  const topSeg = segs[segs.length - 1];
  if (stk.length === 0) add('error', 'The vehicle has no parts yet.', null, 'Add a nose cone, payload, tank and engine from the parts list.');
  const engines = items.map((it, i) => [it, i]).filter(([it]) => it.def.cat === 'engine');
  if (engines.length === 0 && stk.length) add('error', 'The vehicle has no engine.', null, 'Add an engine at the bottom of the stack.');
  stk.forEach((id, i) => {
    if (PARTS[id].cat !== 'decoupler') return;
    if (i === 0) add('error', 'A decoupler cannot be the top part.', PARTS[id].name, 'Move it between two stages.');
    else if (i === stk.length - 1 || PARTS[stk[i + 1]].cat === 'decoupler') add('error', 'A decoupler has no stage below it.', PARTS[id].name, 'Put a tank and an engine below the decoupler, or remove it.');
    else if (PARTS[stk[i - 1]].cat === 'decoupler') add('error', 'Two decouplers are stacked together.', PARTS[id].name, 'Remove one of them.');
  });
  segs.forEach(([a, b], k) => {
    const seg = stk.slice(a, b), n = k + 1;
    const segEngines = seg.filter(id => PARTS[id].cat === 'engine');
    const isTop = k === segs.length - 1;
    const label = multi ? `Stage ${n}` : 'The vehicle';
    if (segEngines.length > 1) add('error', multi ? `Stage ${n} has more than one engine.` : 'Only one engine per stage is supported.', PARTS[segEngines[1]].name, 'Remove the extra engine, or put a decoupler between them.');
    if (segEngines.length && PARTS[seg[seg.length - 1]].cat !== 'engine') add('error', multi ? `Stage ${n}'s engine is not at the bottom of its stage.` : 'The engine is not at the bottom of the stack.', PARTS[segEngines[0]].name, 'Move the engine to the bottom of its stage.');
    if (!segEngines.length && !isTop && seg.length) add('error', `Stage ${n} has no engine.`, null, 'Add an engine at the bottom of that stage, or remove the decoupler.');
    const eDef = segEngines.length ? PARTS[segEngines[0]] : null;
    if (eDef && eDef.type === 'liquid' && !seg.some(id => PARTS[id].cat === 'tank'))
      add('error', `${label === 'The vehicle' ? 'The engine' : label + "'s engine"} has no propellant supply.`, eDef.name, multi ? 'Add a propellant tank to the same stage, above its engine.' : 'Add a propellant tank above the engine.');
    if (eDef && eDef.type === 'solid' && seg.some(id => PARTS[id].cat === 'tank'))
      add('warn', 'Liquid tanks cannot feed a solid motor. Their propellant is dead weight.', 'Propellant tank', 'Remove the tanks.');
    if (!eDef && isTop && multi && seg.some(id => PARTS[id].cat === 'tank')) add('warn', 'The top stage has tanks but no engine. Their propellant is dead weight.', null, 'Add an engine to the top stage or remove its tanks.');
    if (eDef && k === 0 && eDef === PARTS.eng_kestrel) add('warn', 'A vacuum engine on the first stage makes little thrust at sea level.', eDef.name, 'Use the Condor, Heron or Sparrow for stage 1.');
  });
  const noses = items.map((it, i) => [it, i]).filter(([it]) => it.def.cat === 'nose');
  if (noses.length > 1) add('error', 'The vehicle has more than one nose cone.', noses[1][0].def.name, 'Remove the extra nose cone.');
  if (noses.length && items[0].def.cat !== 'nose') add('error', 'The nose cone is not at the top.', noses[0][0].def.name, 'Move the nose cone to the top of the stack.');
  if (!noses.length && stk.length) add('warn', 'No nose cone. A flat top creates heavy drag.', null, 'Add a nose cone.');
  const payIdx = stk.findIndex(id => PARTS[id].cat === 'payload');
  if (payIdx < 0 && stk.length) add('error', 'The mission needs a science payload on board.', null, 'Add a payload section.');
  else if (multi && payIdx >= 0 && stageOf(payIdx) !== segs.length) add('error', 'The payload is in a lower stage and would be thrown away.', PARTS[stk[payIdx]].name, 'Move the payload into the top stage.');
  const compIdx = stk.map((id, i) => PARTS[id].computer ? i : -1).filter(i => i >= 0);
  const liquid = stk.some(id => PARTS[id].type === 'liquid');
  if (liquid && !compIdx.length) add('error', multi ? 'Liquid engines need a flight computer to command them.' : 'The liquid engine has no flight computer to command it.', null, 'Add a flight computer.');
  if (multi && compIdx.length && !compIdx.some(i => stageOf(i) === segs.length)) add('error', 'The flight computer is in a lower stage and would be thrown away at separation.', PARTS.avionics.name, 'Move the flight computer into the top stage.');
  if (multi && stk.includes('wheels') && stageOf(stk.indexOf('wheels')) !== segs.length) add('warn', 'Reaction wheels in a lower stage are lost at separation.', PARTS.wheels.name, 'Move them into the top stage.');
  if (multi && !stk.includes('wheels') && segs.length >= 2) add('warn', 'No reaction wheels. The upper stage cannot turn while its engine is off, so it cannot line up for a burn after coasting.', null, 'Add reaction wheels to the top stage, or plan one continuous burn.');
  if (e && r.twr > 0 && r.twr < 1) add('warn', `Lift-off thrust-to-weight is ${r.twr.toFixed(2)}. The vehicle will not leave the pad.`, e.name, 'Use a stronger engine or remove mass.');
  if (e && r.smFull < 0) add('warn', `The vehicle is aerodynamically unstable (margin ${r.smFull.toFixed(1)} cal).` +
    (e.gimbal > 0 ? ' The gimbal must fight to keep it straight.' : ' A solid motor cannot steer, so it will tumble.'), null, 'Add fins to move the centre of pressure behind the centre of gravity.');
  else if (e && r.smFull < 1 && veh.fins) add('warn', `Stability margin is thin (${r.smFull.toFixed(1)} cal). One to two calibres is typical.`, null, 'Use larger fins.');
  r.stages.slice(1).forEach(s => { if (s.engine && s.twr > 0 && s.twr < 0.5) add('warn', `Stage ${s.stage} thrust-to-weight is only ${s.twr.toFixed(2)} in vacuum. It will need a long burn.`, s.engine, 'Use a lighter upper stage or accept a long, flat burn.'); });
  if (missionId) {
    const m = missionById(missionId);
    if (m.constraints && m.constraints.minStages && segs.length < m.constraints.minStages)
      add('error', `Mission ${m.id} needs at least ${m.constraints.minStages} stages.`, null, 'Add a stage decoupler with a second stage below it.');
  }
  r.valid = !I.some(i => i.level === 'error');
  return r;
}

// ---------- Orbit calculation ----------
function orbitApo(x, y, vx, vy) {
  const r = Math.hypot(x, y), v2 = vx * vx + vy * vy;
  const eps = v2 / 2 - MU / r; if (eps >= 0) return Infinity;
  const h = x * vy - y * vx, a = -MU / (2 * eps);
  const e = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (MU * MU)));
  return a * (1 + e) - RE;
}
// Full planar orbital elements. Altitudes are above the surface (m); times in s.
function orbitElements(x, y, vx, vy) {
  const r = Math.hypot(x, y), v2 = vx * vx + vy * vy, rv = x * vx + y * vy;
  const eps = v2 / 2 - MU / r, h = x * vy - y * vx;
  const e = Math.sqrt(Math.max(0, 1 + 2 * eps * h * h / (MU * MU)));
  if (eps >= 0) return { apo: Infinity, peri: h * h / (MU * (1 + e)) - RE, ecc: e, sma: Infinity, period: Infinity, timeToApo: Infinity, timeToPeri: NaN, bound: false };
  const a = -MU / (2 * eps), n = Math.sqrt(MU / (a * a * a)), period = 2 * Math.PI / n;
  let E = 0, M = 0;
  if (e > 1e-9) { E = Math.atan2(rv / Math.sqrt(MU * a), 1 - r / a); M = E - e * Math.sin(E); }
  M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const timeToApo = ((Math.PI - M + 2 * Math.PI) % (2 * Math.PI)) / n;
  const timeToPeri = ((2 * Math.PI - M) % (2 * Math.PI)) / n;
  return { apo: a * (1 + e) - RE, peri: a * (1 - e) - RE, ecc: e, sma: a, period, timeToApo, timeToPeri, bound: true };
}

// ---------- Drag coefficient ----------
function machFactor(M) {
  if (M < 0.8) return 1;
  if (M < 1.05) return 1 + (M - 0.8) / 0.25 * 0.9;
  if (M < 1.3) return 1.9 - (M - 1.05) / 0.25 * 0.3;
  return Math.max(1.05, 1.6 - (M - 1.3) * 0.2);
}

// ---------- Spent stages ----------
// A jettisoned stage flies on as a tumbling point mass (gravity and drag) until it hits the ground.
class Debris {
  constructor(stack, fins, x, y, vx, vy, th, om, m, stageNo, t) {
    this.veh = buildVehicle({ stack, fins }); this.stageNo = stageNo;
    this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.th = th; this.om = om + 0.15; this.m = m;
    this.cdA = 1.1 * AREF + 0.02 * this.veh.L * DIAM; this.alive = true; this.sepT = t; this.impact = null;
  }
  acc(x, y, vx, vy) {
    const r = Math.hypot(x, y), gm = MU / (r * r), atm = atmosphere(r - RE);
    const ax = vx + WE * y, ay = vy - WE * x, va = Math.hypot(ax, ay);
    const k = 0.5 * atm.rho * va * this.cdA / this.m;
    return [vx, vy, -gm * x / r - k * ax, -gm * y / r - k * ay];
  }
  step(dt) {
    if (!this.alive) return;
    const S = [this.x, this.y, this.vx, this.vy];
    const k1 = this.acc(...S), S2 = S.map((s, i) => s + k1[i] * dt / 2), k2 = this.acc(...S2);
    const S3 = S.map((s, i) => s + k2[i] * dt / 2), k3 = this.acc(...S3), S4 = S.map((s, i) => s + k3[i] * dt), k4 = this.acc(...S4);
    [this.x, this.y, this.vx, this.vy] = S.map((s, i) => s + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    this.th += this.om * dt;
  }
}

// ---------- Flight simulation ----------
// opts: { program: source string, mission: id, seed: integer }
class Flight {
  constructor(design, opts = {}) {
    this.design = { stack: [...design.stack], fins: design.fins || null };
    this.stack = [...this.design.stack]; this.fins = this.design.fins;
    this.veh = buildVehicle({ stack: this.stack, fins: this.fins });
    const v = this.veh;
    this.mission = missionById(opts.mission || 'M002'); this.seed = opts.seed ?? 1;
    this.t = 0; this.prop = v.propCap; this.stepCount = 0;
    this.x = 0; this.y = RE; this.vx = -WE * RE; this.vy = 0; this.th = Math.PI / 2; this.om = WE;
    this.clamped = true; this.engine = 'off'; this.ignT = 0; this.throttleCmd = 1; this.throttle = 0;
    this.ignitionsLeft = v.eng ? (v.eng.ignitions || 1) : 0; this.everIgnited = false; this.stageIgnited = false;
    this.gimbal = 0; this.sas = v.hasComputer; this.targetPitch = 90; this.pitchInput = 0; this.attMode = 'pitch'; this.wheelTau = 0;
    this.misalign = 0.15 * DEG; // small thrust misalignment, as on any real vehicle
    this.events = []; this.tele = []; this.teleNext = 0;
    this.max = { alt: 0, q: 0, g: 0, mach: 0, speed: 0 };
    this.loss = { grav: 0, drag: 0, delivered: 0 }; this.liftoffT = null; this.apogeeT = null; this.reached = false;
    this.done = false; this.failure = null; this.qRising = true; this.mach1 = false; this.burnout = false; this.ballistic = false;
    this.stageNo = 1; this.nStages = v.stages; this.debris = []; this.stageLog = [];
    this.missionState = 'pending'; this.missionT = null; this.manualInputs = 0; this.bestPeri = -RE;
    this.d = this.derived(); this.sensedG = 1;
    this.program = null;
    if (opts.program) {
      const FC = typeof FlightComputer !== 'undefined' ? FlightComputer : require('./flight_computer.js').FlightComputer;
      this.program = new FC(opts.program, this, this.seed);
    }
  }
  log(msg, kind = 'info') { this.events.push({ t: this.t, msg, kind }); }
  manual(what) { // records a pilot input; used by the "hands off" mission
    this.manualInputs++;
    if (this.mission.constraints && this.mission.constraints.programOnly && this.missionState === 'pending') {
      this.missionState = 'failed'; this.missionFailReason = `Manual input (${what}) during a hands-off mission`; this.log(this.missionFailReason, 'bad');
    }
  }
  canIgnite() { const e = this.veh.eng; return !!e && this.prop > 0 && this.ignitionsLeft > 0 && (this.engine === 'off' || this.engine === 'shutdown'); }
  ignite() {
    const e = this.veh.eng;
    if (!e || this.prop <= 0 || this.engine === 'ignition' || this.engine === 'running' || this.engine === 'burnout') return false;
    if (this.ignitionsLeft <= 0) { this.log(`${e.name} has no ignitions left`, 'bad'); return false; }
    this.ignitionsLeft--; this.everIgnited = true; this.stageIgnited = true;
    this.engine = 'ignition'; this.ignT = this.t; this.log(this.stageNo > 1 ? `Stage ${this.stageNo} ignition` : 'Ignition');
    return true;
  }
  shutdown() {
    if (!this.veh.eng || this.veh.eng.type === 'solid') return false;
    if (this.engine === 'running' || this.engine === 'ignition') { this.engine = 'shutdown'; this.log(this.stageNo > 1 ? `Stage ${this.stageNo} engine cut-off` : 'Engine cut-off commanded'); return true; }
    return false;
  }
  setThrottle(v) { if (this.veh.eng && this.veh.eng.type === 'liquid') this.throttleCmd = Math.min(1, Math.max(0.4, v)); }
  setPitch(deg) { this.attMode = 'pitch'; this.targetPitch = Math.max(-90, Math.min(90, deg)); }
  setMode(mode) { if (['pitch', 'prograde', 'retrograde', 'surface'].includes(mode)) this.attMode = mode; }

  // Stage separation: shut the lower stage down, cut the stack at the lowest decoupler, and push the two
  // bodies apart with the decoupler's spring impulse. Momentum is conserved.
  stage() {
    let idx = -1; this.stack.forEach((id, i) => { if (PARTS[id].cat === 'decoupler' && i > 0) idx = i; });
    if (idx < 0) { this.log('No stage left to separate'); return false; }
    if (this.clamped) { this.log('Separation refused: the vehicle is still on the pad'); return false; }
    const thrusting = this.throttle > 0 && this.prop > 0;
    const before = massProps(this.veh, this.prop);
    const upperStack = this.stack.slice(0, idx), lowerStack = this.stack.slice(idx);
    const upperVeh = buildVehicle({ stack: upperStack, fins: null });
    const upper = massProps(upperVeh, upperVeh.propCap);
    const mU = upper.m, mL = before.m - mU;
    const bx = Math.cos(this.th), by = Math.sin(this.th);
    // lower-stage centre of gravity, from the moment balance about the nose
    const cgL = (before.m * before.cg - mU * upper.cg) / mL;
    const J = PARTS[this.stack[idx]].impulse || 0;
    const lx = this.x - (cgL - before.cg) * bx, ly = this.y - (cgL - before.cg) * by;
    const d = new Debris(lowerStack, this.fins, lx, ly, this.vx - J / mL * bx, this.vy - J / mL * by, this.th, this.om, mL, this.stageNo, this.t);
    this.debris.push(d);
    this.stageLog.push({ stage: this.stageNo, t: this.t, alt: this.d.alt, propLeft: this.prop, thrusting, speed: this.d.speed, q: this.d.q });
    this.x += (before.cg - upper.cg) * bx; this.y += (before.cg - upper.cg) * by;
    this.vx += J / mU * bx; this.vy += J / mU * by;
    this.stack = upperStack; this.fins = null; this.veh = upperVeh; this.prop = upperVeh.propCap;
    this.engine = 'off'; this.throttle = 0; this.gimbal = 0; this.iErr = 0; this.burnout = false; this.tauAero = 0; this.stageIgnited = false;
    this.ignitionsLeft = upperVeh.eng ? (upperVeh.eng.ignitions || 1) : 0;
    this.stageNo++;
    this.log(`Stage ${this.stageNo - 1} separation`, 'info');
    this.mp = massProps(this.veh, this.prop); this.d = this.derived();
    if (thrusting) this.fail('recontact', `Stage ${this.stageNo - 1} was still firing at separation and rammed the upper stage`);
    return true;
  }

  canPropel() {
    if (this.engine === 'running' || this.engine === 'ignition') return true;
    if (this.canIgnite()) return true;
    let idx = -1; this.stack.forEach((id, i) => { if (PARTS[id].cat === 'decoupler' && i > 0) idx = i; });
    return idx > 0 && this.stack.slice(0, idx).some(id => PARTS[id].cat === 'engine');
  }

  localFrame(x, y) { const r = Math.hypot(x, y); const ux = x / r, uy = y / r; return { ux, uy, ex: uy, ey: -ux }; }
  pitchOf(th, x, y) { const f = this.localFrame(x, y); const bx = Math.cos(th), by = Math.sin(th); return Math.atan2(bx * f.ux + by * f.uy, bx * f.ex + by * f.ey) / DEG; }
  orbit() { return orbitElements(this.x, this.y, this.vx, this.vy); }

  deriv(S, mp) {
    const [x, y, vx, vy, th, om, prop] = S, v = this.veh;
    const r = Math.hypot(x, y), alt = r - RE, m = v.dryMass + Math.max(prop, 0);
    const atm = atmosphere(alt);
    const gm = MU / (r * r);
    let fx = -gm * x / r * m, fy = -gm * y / r * m, tau = this.wheelTau;
    const bx = Math.cos(th), by = Math.sin(th);
    let T = 0, mdot = 0;
    if (this.throttle > 0 && prop > 0) {
      const e = v.eng; mdot = v.mdotMax * this.throttle;
      T = mdot * G0 * (e.ispVac - (e.ispVac - e.ispSL) * atm.p / P0);
      const d = this.gimbal + this.misalign, tx = bx * Math.cos(d) - by * Math.sin(d), ty = bx * Math.sin(d) + by * Math.cos(d);
      fx += T * tx; fy += T * ty;
      const arm = v.sEng - mp.cg; tau += -arm * bx * (T * ty) + arm * by * (T * tx);
    }
    const ax = vx + WE * y, ay = vy - WE * x; // air-relative velocity (atmosphere co-rotates)
    const va = Math.hypot(ax, ay), q = 0.5 * atm.rho * va * va;
    let D = 0, sina = 0; const tau0 = tau;
    if (va > 0.5) {
      const wx = -ax / va, wy = -ay / va, wb = wx * bx + wy * by, px = wx - wb * bx, py = wy - wb * by;
      sina = Math.hypot(px, py);
      const cd = v.cd0 * machFactor(va / atm.a) + (T > 0 ? 0 : 0.12) + 1.5 * sina * sina;
      D = q * AREF * cd; fx += D * wx; fy += D * wy;
      const N = q * AREF * v.cna; fx += N * px; fy += N * py;
      const arm = v.cp - mp.cg; tau += -arm * bx * (N * py) + arm * by * (N * px);
      tau += -mp.damp * q * AREF * v.L * v.L * om / Math.max(va, 20);
    }
    this._aux = { tauAero: tau - tau0, T, D, q, mach: va / atm.a, sina, m, atm, alt, va, gm, fxNG: fx + gm * x / r * m, fyNG: fy + gm * y / r * m };
    return [vx, vy, fx / m, fy / m, om, tau / mp.I, -mdot];
  }

  targetAngle() {
    if (this.attMode === 'prograde') return Math.atan2(this.vy, this.vx);
    if (this.attMode === 'retrograde') return Math.atan2(-this.vy, -this.vx);
    if (this.attMode === 'surface') return Math.atan2(this.vy - WE * this.x, this.vx + WE * this.y);
    const f = this.localFrame(this.x, this.y);
    return Math.atan2(f.ey, f.ex) + this.targetPitch * DEG;
  }

  control(dt) {
    const v = this.veh, e = v.eng;
    // engine state machine: OFF → IGNITION → RUNNING → SHUTDOWN / BURNOUT
    if (this.engine === 'ignition') {
      const k = Math.min(1, (this.t - this.ignT) / 0.6); this.throttle = k * this.throttleCmd;
      if (k >= 1) { this.engine = 'running'; }
    } else if (this.engine === 'running') {
      this.throttle += Math.max(-dt * 1.5, Math.min(dt * 1.5, this.throttleCmd - this.throttle));
    } else this.throttle = 0;
    // attitude: SAS holds the target using reaction wheels first, then the engine gimbal
    let cmd = 0; this.wheelTau = 0;
    const T = this.throttle > 0 && e ? v.mdotMax * this.throttle * G0 * e.ispVac : 0;
    const canGimbal = e && e.gimbal > 0 && T > 0, wheels = v.wheelTorque;
    if (canGimbal || wheels > 0) {
      const mp = this.mp;
      if (this.sas) {
        if (this.pitchInput !== 0) { this.attMode = 'pitch'; this.targetPitch = Math.max(0, Math.min(90, this.targetPitch - this.pitchInput * 10 * dt)); }
        const thT = this.targetAngle();
        let err = thT - this.th; err = Math.atan2(Math.sin(err), Math.cos(err));
        this.iErr = Math.max(-0.2, Math.min(0.2, (this.iErr || 0) + err * dt));
        const tauReq = mp.I * (12 * err + 4 * this.iErr - 7 * (this.om - WE)) - (this.tauAero || 0);
        let tauRem = tauReq;
        if (wheels > 0) { this.wheelTau = Math.max(-wheels, Math.min(wheels, tauReq)); tauRem = tauReq - this.wheelTau; }
        if (canGimbal) {
          const arm = v.sEng - mp.cg;
          const s = -tauRem / Math.max(arm * T, 1);
          cmd = Math.asin(Math.max(-Math.sin(e.gimbal), Math.min(Math.sin(e.gimbal), s)));
        }
      } else {
        if (canGimbal) cmd = this.pitchInput * e.gimbal;
        if (wheels > 0) this.wheelTau = -this.pitchInput * wheels;
      }
    }
    const rate = 20 * DEG * dt; this.gimbal += Math.max(-rate, Math.min(rate, cmd - this.gimbal));
  }

  step(dt) {
    if (this.done) return;
    if (this.program && this.stepCount % PROGRAM_TICK === 0) this.program.tick();
    this.stepCount++;
    if (this.done) return;
    const v = this.veh;
    this.mp = massProps(v, this.prop);
    this.control(dt);
    for (const d of this.debris) d.step(dt);
    const S = [this.x, this.y, this.vx, this.vy, this.th, this.om, this.prop];
    if (this.clamped) {
      const k1 = this.deriv(S, this.mp); const a = this._aux;
      const f = this.localFrame(this.x, this.y);
      const up = (a.fxNG) * f.ux + (a.fyNG) * f.uy; // thrust along local up
      if (a.T > 0 && up > a.m * a.gm * 1.0) { this.clamped = false; this.liftoffT = this.t; this.log('Lift-off', 'good'); }
      else {
        this.prop = Math.max(0, this.prop + k1[6] * dt);
        this.t += dt; const ang = Math.PI / 2 + WE * this.t;
        this.x = RE * Math.cos(ang); this.y = RE * Math.sin(ang); this.vx = -WE * this.y; this.vy = WE * this.x; this.th = ang; this.om = WE;
        this.after(dt, k1);
        return;
      }
    }
    const k1 = this.deriv(S, this.mp);
    const aux1 = this._aux; this.tauAero = aux1.tauAero;
    const S2 = S.map((s, i) => s + k1[i] * dt / 2), k2 = this.deriv(S2, this.mp);
    const S3 = S.map((s, i) => s + k2[i] * dt / 2), k3 = this.deriv(S3, this.mp);
    const S4 = S.map((s, i) => s + k3[i] * dt), k4 = this.deriv(S4, this.mp);
    const N = S.map((s, i) => s + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    [this.x, this.y, this.vx, this.vy, this.th, this.om, this.prop] = N;
    this.t += dt;
    // losses (evaluated with the step-start forces)
    const a = aux1;
    if (a.va > 1) {
      const r = Math.hypot(S[0], S[1]); const vr = (S[2] * S[0] + S[3] * S[1]) / r; const vs = Math.hypot(S[2], S[3]);
      if (a.T > 0) { this.loss.grav += a.gm * (vr / vs) * dt; this.loss.delivered += a.T / a.m * dt; }
      if (!this.ballistic) this.loss.drag += a.D / a.m * dt;
    }
    this.after(dt, k1);
  }

  after(dt, k1) {
    const v = this.veh;
    if (this.prop <= 0 && this.throttle > 0 && !this.burnout) {
      this.prop = 0; this.burnout = true; this.burnoutT = this.t; this.engine = 'burnout';
      const pre = this.stageNo > 1 || this.nStages > 1 ? `Stage ${this.stageNo}: ` : '';
      this.log(pre + (v.eng.type === 'solid' ? 'Motor burnout' : 'Propellant depleted, engine cut-off'));
    }
    if (this.engine === 'shutdown' || this.engine === 'burnout') this.throttle = 0;
    const d = this.derived(); this.d = d; const a = this._aux;
    this.sensedG = Math.hypot(a.fxNG, a.fyNG) / a.m / G0;
    if (!this.clamped) {
      this.max.alt = Math.max(this.max.alt, d.alt); this.max.speed = Math.max(this.max.speed, d.speed);
      this.max.g = Math.max(this.max.g, this.sensedG); this.max.mach = Math.max(this.max.mach, d.mach);
      if (d.peri > this.bestPeri) this.bestPeri = d.peri;
    }
    if (!this.ballistic && d.q > this.max.q) { this.max.q = d.q; this.maxQt = this.t; this.maxQalt = d.alt; }
    else if (!this.ballistic && this.qRising && this.max.q > 3000 && d.q < this.max.q * 0.97) { this.qRising = false; this.events.push({ t: this.maxQt, msg: `Max Q: ${(this.max.q / 1000).toFixed(1)} kPa at ${(this.maxQalt / 1000).toFixed(1)} km`, kind: 'info' }); }
    if (!this.mach1 && d.mach >= 1) { this.mach1 = true; this.log('Supersonic'); }
    this.evalMission(d);
    if (!this.clamped && this.apogeeT === null && this.liftoffT !== null && this.t - this.liftoffT > 2 && d.vr < 0 && this.throttle === 0) {
      this.apogeeT = this.t; this.apogee = this.max.alt;
      if (d.peri < 100000) this.log(`Apogee: ${(this.max.alt / 1000).toFixed(1)} km`, this.reached ? 'good' : (this.canPropel() ? 'info' : 'bad')); // not logged once in a real orbit
    }
    if (!this.ballistic && this.apogeeT !== null && d.vr < 0 && !this.canPropel()) this.ballistic = true;
    // failure detection (until the vehicle is coasting with nothing left to fire)
    if (!this.failure && !this.ballistic) {
      if (d.q > v.qMax) this.fail('overload', `Structural overload: dynamic pressure ${(d.q / 1000).toFixed(0)} kPa exceeded the ${(v.qMax / 1000).toFixed(0)} kPa limit`);
      else if (d.q * a.sina > LIMITS.qAlpha && d.q > 2000) this.fail('breakup', `Aerodynamic break-up at ${(Math.asin(Math.min(1, a.sina)) / DEG).toFixed(1)}° angle of attack`);
      else if (!this.clamped && a.sina > 0.7 && d.speed > 30 && d.q > 500) this.fail('tumble', 'Loss of control: the vehicle tumbled')
      else if (this.sensedG > v.gMax && v.payloads.length) this.fail('gforce', `Payload destroyed at ${this.sensedG.toFixed(1)} g (limit ${v.gMax} g)`);
      else if (this.clamped && this.engine !== 'off' && (this.t - this.ignT > 4 || this.prop <= 0)) this.fail('twr', 'The vehicle never left the pad');
    }
    for (const db of this.debris) if (db.alive && Math.hypot(db.x, db.y) - RE <= 0) {
      db.alive = false; db.impact = { t: this.t, down: this.downrangeOf(db.x, db.y) };
      this.log(`Stage ${db.stageNo} impact ${(Math.abs(db.impact.down) / 1000).toFixed(0)} km downrange`);
    }
    if (!this.clamped && d.alt <= 0 && this.liftoffT !== null && this.t - this.liftoffT > 1) {
      this.log(`Impact ${(d.downrange / 1000).toFixed(1)} km downrange`, 'bad'); this.end();
    }
    if (this.t >= this.teleNext) { this.teleNext += 0.1; this.record(d); }
  }

  evalMission(d) {
    if (this.missionState !== 'pending' || this.clamped) return;
    const o = this.mission.objective;
    let ok = false;
    if (o.type === 'altitude') ok = d.alt >= o.value;
    else if (o.type === 'orbit') ok = this.throttle === 0 && d.alt > 100000 && d.peri >= o.peri && (!o.apo || d.apo <= o.apo);
    const c = this.mission.constraints || {};
    if (ok && c.minStages && this.nStages < c.minStages) ok = false;
    if (ok) {
      this.missionState = 'success'; this.reached = true; this.missionT = this.t;
      this.log(this.mission.successMsg, 'good');
      if (o.type === 'orbit') this.log(`Orbit: ${(d.peri / 1000).toFixed(0)} × ${(d.apo / 1000).toFixed(0)} km, period ${(d.period / 60).toFixed(1)} min`, 'good');
    }
  }
  fail(kind, msg) { this.failure = { kind, msg, t: this.t, alt: this.d.alt }; this.log(msg, 'bad'); this.end(); }
  end() { if (!this.done) { this.done = true; this.record(this.d); } }
  downrangeOf(x, y) {
    const padAng = Math.PI / 2 + WE * this.t, ang = Math.atan2(y, x);
    let dang = padAng - ang; dang = Math.atan2(Math.sin(dang), Math.cos(dang));
    return RE * dang;
  }
  derived() {
    const r = Math.hypot(this.x, this.y), alt = r - RE, atm = atmosphere(alt);
    const ax = this.vx + WE * this.y, ay = this.vy - WE * this.x, va = Math.hypot(ax, ay);
    const vr = (this.vx * this.x + this.vy * this.y) / r;
    const padAng = Math.PI / 2 + WE * this.t, ang = Math.atan2(this.y, this.x);
    let dang = padAng - ang; dang = Math.atan2(Math.sin(dang), Math.cos(dang));
    const m = this.veh.dryMass + this.prop;
    const e = this.veh.eng; const T = e && this.throttle > 0 && this.prop > 0 ? this.veh.mdotMax * this.throttle * G0 * (e.ispVac - (e.ispVac - e.ispSL) * atm.p / P0) : 0;
    const q = 0.5 * atm.rho * va * va;
    const el = this.clamped ? null : orbitElements(this.x, this.y, this.vx, this.vy);
    return { alt, speed: va, vr, q, mach: va / atm.a, downrange: RE * dang, mass: m, thrust: T, twr: T / (m * MU / (r * r)),
      pitch: this.pitchOf(this.th, this.x, this.y), velPitch: va > 1 ? this.pitchOf(Math.atan2(ay, ax), this.x, this.y) : 90,
      apo: this.clamped ? 0 : orbitApo(this.x, this.y, this.vx, this.vy), p: atm.p, rho: atm.rho, fuel: this.veh.propCap ? this.prop / this.veh.propCap : 0,
      peri: el ? el.peri : -RE, ecc: el ? el.ecc : 1, period: el ? el.period : 0, timeToApo: el ? el.timeToApo : 0,
      orbitalSpeed: Math.hypot(this.vx, this.vy), hSpeed: Math.abs(this.x * this.vy - this.y * this.vx) / r };
  }
  record(d) {
    this.tele.push({ t: this.t, alt: d.alt, speed: d.speed, g: this.sensedG || 0, q: d.q, mass: d.mass, mach: d.mach, thrust: d.thrust, fuel: d.fuel, down: d.downrange,
      stage: this.stageNo, vorb: d.orbitalSpeed, x: this.x, y: this.y, apo: Number.isFinite(d.apo) ? d.apo : null, peri: d.peri > -RE ? d.peri : null, pitch: d.pitch });
  }
}

// ---------- Flight report / failure analysis ----------
function flightReport(f, an) {
  const v = f.veh, o = f.mission.objective;
  const R = { success: f.missionState === 'success', cause: '', evidence: [], factors: [], fixes: [], mission: f.mission.id };
  const km = x => (x / 1000).toFixed(1) + ' km';
  const apo = f.apogee ?? f.max.alt;
  const program = f.program;
  const progNote = () => {
    if (program && program.status === 'error') R.factors.push(`The flight program stopped with an error: ${program.error.message}${program.error.line ? ` (line ${program.error.line})` : ''}. After that the vehicle flew on its last commands.`);
    if (program && program.status === 'budget') R.factors.push('The flight program used too much computing time in one tick and was halted. A loop is probably missing a yield.');
  };
  if (R.success) {
    if (o.type === 'orbit') {
      const d = f.d;
      R.cause = f.failure ? `Orbit achieved, then the vehicle was lost: ${f.failure.msg.toLowerCase()}.` : `Payload placed in a ${km(d.peri)} × ${km(d.apo)} orbit.`;
      R.evidence.push(`Periapsis ${km(d.peri)}, apoapsis ${km(d.apo)}`, `Orbital speed ${d.orbitalSpeed.toFixed(0)} m/s`,
        `Period ${(d.period / 60).toFixed(1)} min`, `ΔV available ${an.dvVac.toFixed(0)} m/s`, `Propellant left in stage ${f.stageNo}: ${f.prop.toFixed(0)} kg`);
      R.fixes.push(f.mission.id === 'M004' ? 'Now try Mission M005: make the orbit circular.' : f.mission.id === 'M005' ? 'Try Mission M006: reach orbit with the program alone, no manual input.' : 'Try carrying the heavy payload to orbit.');
    } else {
      R.cause = f.failure ? `Objective complete. The vehicle was then lost: ${f.failure.msg.toLowerCase()}.` : `Science payload carried above ${o.value / 1000} km.`;
      R.evidence.push(`Peak altitude ${km(f.max.alt)}`, `Margin above target ${km(f.max.alt - o.value)}`);
      if (an.dvVac > 0) R.evidence.push(`ΔV available ${an.dvVac.toFixed(0)} m/s`);
      if (f.mission.id === 'M002') {
        if (f.max.alt > 160000) R.fixes.push('There is a lot of spare performance. Try the heavy payload or a smaller tank.');
        else R.fixes.push('Try the heavy payload next, or reach 100 km with a lighter vehicle.');
      } else R.fixes.push('Try the next mission.');
    }
    return R;
  }
  if (f.missionState === 'failed') {
    R.cause = f.missionFailReason + '.';
    R.evidence.push(`Manual inputs: ${f.manualInputs}`);
    R.fixes.push('Let the flight program do everything. Fix the program on the Program tab and fly again.');
    return R;
  }
  // a break-up while falling back is a symptom: the real problem is not reaching the objective
  const reentry = !!f.failure && f.apogeeT !== null && f.d.vr < 0 && f.failure.t > f.apogeeT && ['tumble', 'breakup', 'overload'].includes(f.failure.kind);
  const reentryNote = () => { if (reentry) R.cause += ' It then broke up falling back into the atmosphere.'; };
  if (f.failure && !reentry) {
    const k = f.failure.kind;
    R.evidence.push(`Failure at T+${(f.failure.t - (f.liftoffT ?? 0)).toFixed(1)} s, altitude ${km(f.failure.alt)}${f.nStages > 1 ? `, stage ${f.stageNo}` : ''}`);
    if (k === 'twr') {
      R.cause = 'Insufficient lift-off thrust.';
      R.evidence.push(`Thrust-to-weight ${an.twr.toFixed(2)}, required above 1.00`, `Lift-off mass ${an.wet.toFixed(0)} kg`);
      R.fixes.push('Use a stronger engine.', 'Carry less propellant or a lighter payload.');
    } else if (k === 'overload') {
      R.cause = 'Structural overload from excessive dynamic pressure.';
      R.evidence.push(`Dynamic pressure reached ${(f.max.q / 1000).toFixed(0)} kPa`, `Structural limit ${(v.qMax / 1000).toFixed(0)} kPa`, `Speed ${f.d.speed.toFixed(0)} m/s in dense air`);
      R.factors.push(`Lift-off thrust-to-weight of ${an.twr.toFixed(2)} accelerates the vehicle hard while the air is still thick.`);
      R.fixes.push(v.eng && v.eng.type === 'liquid' ? 'Throttle down between about 5 and 15 km, then return to full throttle.' : 'A solid motor cannot throttle. Use a liquid engine or add mass.', 'Use a lower-thrust engine.');
    } else if (k === 'breakup') {
      R.cause = 'The vehicle turned sideways into the airflow and broke apart.';
      R.evidence.push(`Stability margin at lift-off ${an.smFull.toFixed(1)} calibres`, `Dynamic pressure ${(f.d.q / 1000).toFixed(1)} kPa`);
      if (f.stageNo > 1) {
        R.factors.push(`Stage ${f.stageNo} has no fins and was flying in air still dense enough to turn it.`);
        R.fixes.push('Separate stages higher, where the air is thinner (above about 50 km dynamic pressure is tiny).', 'Keep the upper stage pointed along its velocity (prograde) right after separation.');
      } else if (an.smFull < 0) {
        R.factors.push('The centre of pressure sits ahead of the centre of gravity, so any small disturbance grows.');
        if (f.burnoutT != null && f.failure.t - f.burnoutT < 8) R.factors.push('The gimbal held it straight while the engine ran. At burnout the steering disappeared and the airflow turned it sideways.');
        R.fixes.push('Add fins to move the centre of pressure aft.');
      }
      else R.factors.push('Large steering inputs at high dynamic pressure bent the vehicle.');
      if (!f.sas && v.eng && v.eng.gimbal > 0) R.fixes.push('Keep attitude hold (SAS) on so the gimbal can correct errors.');
      R.fixes.push('Avoid pitching while dynamic pressure is high. Turn gradually.');
    } else if (k === 'tumble') {
      R.cause = 'Loss of control. The vehicle tumbled end over end.';
      R.evidence.push(`Stability margin at lift-off ${an.smFull.toFixed(1)} calibres`);
      if (f.stageNo > 1) { R.factors.push(`Stage ${f.stageNo} separated in air dense enough to flip it.`); R.fixes.push('Separate higher, or ignite the upper stage straight away so its gimbal can steer.'); }
      else if (an.smFull < 0) { R.factors.push('The centre of pressure sits ahead of the centre of gravity, so the airflow flips the vehicle around.'); R.fixes.push('Add fins to move the centre of pressure aft.'); }
      if (!f.sas && v.eng && v.eng.gimbal > 0) R.fixes.push('Keep attitude hold (SAS) on so the gimbal can correct errors.');
      if (!R.fixes.length) R.fixes.push('Use larger fins, and avoid sharp pitch inputs.');
    } else if (k === 'gforce') {
      R.cause = 'The payload was crushed by acceleration.';
      R.evidence.push(`Acceleration reached ${f.max.g.toFixed(1)} g`, `Payload limit ${v.gMax} g`);
      R.factors.push('As propellant burns off, the same thrust pushes a lighter vehicle, so acceleration climbs near burnout.');
      R.fixes.push(v.eng && v.eng.type === 'liquid' ? 'Throttle down late in the burn.' : 'Use a liquid engine you can throttle.', 'Use a less powerful engine.');
    } else if (k === 'recontact') {
      R.cause = 'Stage separation while the lower stage was still firing.';
      const s = f.stageLog[f.stageLog.length - 1];
      R.evidence.push(`Stage ${s.stage} had ${s.propLeft.toFixed(0)} kg of propellant left and its engine running`);
      R.factors.push('A stage that is still thrusting keeps accelerating after the springs let go, so it runs straight into the stage above.');
      R.fixes.push('Wait for burnout (propellant at zero) or command an engine cut-off, pause a second, then separate.',
        'In a flight program: yield ship.until(() => ship.propellant <= 0); yield ship.wait(1); ship.stage();');
    }
    if (f.stageNo > 1 && !f.stageIgnited && ['tumble', 'breakup'].includes(k)) R.factors.push(`Stage ${f.stageNo} was never ignited after separation, so its engine could not steer it.`);
    progNote();
    return R;
  }
  if (f.userEnded && f.apogeeT === null && o.type === 'altitude') {
    R.cause = f.liftoffT === null ? 'Flight ended on the pad.' : 'Flight ended before apogee.';
    if (f.liftoffT !== null) R.evidence.push(`Altitude at the end ${km(f.d.alt)}`, `Predicted apogee ${km(f.d.apo)}`);
    R.fixes.push('Fly again and let the flight run to apogee. Time warp speeds up the coast.');
    progNote();
    return R;
  }
  if (f.liftoffT === null) {
    R.cause = 'The vehicle never launched.';
    if (!f.everIgnited) R.factors.push(program ? 'The flight program never called ship.ignite().' : 'The engine was never ignited.');
    R.fixes.push(program ? 'Start the program with ship.throttle(1); ship.ignite();' : 'Press Space or Ignite to start the engine.');
    progNote();
    return R;
  }
  // staging and upper-stage diagnostics, shared by the "fell short" cases
  const stagingNotes = () => {
    f.stageLog.forEach(s => { if (s.propLeft > 5) R.factors.push(`Stage ${s.stage} was separated with ${s.propLeft.toFixed(0)} kg of propellant still in it.`); });
    if (f.nStages > f.stageNo && f.stack.some(id => PARTS[id].cat === 'decoupler')) R.factors.push(`Only ${f.stageNo} of ${f.nStages} stages were used. The rest were never separated.`);
    if (f.stageNo > 1 && !f.stageIgnited && f.engine === 'off' && f.prop > 0) R.factors.push(`Stage ${f.stageNo} was never ignited after separation.`);
    if (f.engine === 'shutdown' && f.prop > 5 && f.ignitionsLeft <= 0) R.factors.push(`Stage ${f.stageNo} was shut down with ${f.prop.toFixed(0)} kg left and had no ignitions left to restart.`);
  };
  if (o.type === 'orbit') {
    const d = f.d;
    const vCirc = Math.sqrt(MU / (RE + Math.max(o.peri, f.max.alt)));
    if (f.bestPeri >= o.peri && o.apo) {
      R.cause = `Orbit reached, but not the required band (periapsis ${km(d.peri)}, apoapsis ${km(d.apo)}).`;
      R.evidence.push(`Required: both between ${km(o.peri)} and ${km(o.apo)}`);
      R.fixes.push('Cut the engine as soon as the periapsis is high enough, and time the circularisation burn to be centred on apoapsis.');
    } else {
      R.cause = f.bestPeri > -RE * 0.5 && f.bestPeri > 0 ? `Periapsis reached ${km(f.bestPeri)}, short of the ${km(o.peri)} target.` : 'The vehicle did not reach orbital speed and fell back.';
      R.evidence.push(`Best periapsis ${f.bestPeri > -RE ? km(f.bestPeri) : 'none'}, target ${km(o.peri)}`,
        `Peak altitude ${km(f.max.alt)}`, `Peak orbital speed ${Math.max(...f.tele.map(s => s.vorb || 0)).toFixed(0)} m/s, circular speed at that height ${vCirc.toFixed(0)} m/s`,
        `ΔV available ${an.dvVac.toFixed(0)} m/s`, `Lost to gravity ${f.loss.grav.toFixed(0)} m/s`, `Lost to drag ${f.loss.drag.toFixed(0)} m/s`);
      stagingNotes();
      if (an.dvVac < f.mission.dvHint * 0.95) R.factors.push(`The vehicle carries ${an.dvVac.toFixed(0)} m/s of ΔV. Orbit typically needs about ${f.mission.dvHint} m/s including losses.`);
      if (f.loss.grav > 2000) R.factors.push(`Gravity took ${f.loss.grav.toFixed(0)} m/s. The climb was too steep or too slow: turn toward the horizon earlier.`);
      if (f.max.alt > 400000) R.factors.push('The trajectory went very high. Orbit needs horizontal speed, so pitch over further.');
      if (f.max.alt < 120000) R.factors.push('The trajectory stayed low, in the atmosphere. Climb more steeply at first, then turn.');
      if (f.apogeeT !== null && f.engine === 'shutdown' && f.prop > 5) R.factors.push(`The upper stage coasted past apoapsis with ${f.prop.toFixed(0)} kg of propellant unused. A burn at apoapsis would have raised the periapsis.`);
      R.fixes.push('Follow the reference "Orbit" program: gravity turn, burn until apoapsis reaches the target, coast, then circularise at apoapsis.');
      if (an.dvVac < f.mission.dvHint) R.fixes.push('Add propellant, a lighter upper stage, or a third stage.');
    }
    reentryNote();
    progNote();
    return R;
  }
  // fell short of an altitude target
  R.cause = `Insufficient ΔV to reach ${o.value / 1000} km.`;
  R.evidence.push(`Apogee ${km(apo)}, target ${o.value / 1000} km`, `ΔV available ${an.dvVac.toFixed(0)} m/s`,
    `Lost to gravity ${f.loss.grav.toFixed(0)} m/s`, `Lost to drag ${f.loss.drag.toFixed(0)} m/s`);
  const shortBy = o.value - apo;
  if (f.loss.grav > 0.45 * f.loss.delivered) R.factors.push(`Low thrust-to-weight (${an.twr.toFixed(2)}) meant a long, slow climb. Gravity took ${(100 * f.loss.grav / Math.max(1, f.loss.delivered)).toFixed(0)}% of the burn.`);
  if (f.loss.drag > 350) R.factors.push('Drag was high. A pointed nose and fewer fins help.');
  stagingNotes();
  const pitchLoss = f.tele.some(s => s.down > 5000);
  if (pitchLoss) R.factors.push(`The vehicle drifted ${km(Math.abs(f.d.downrange))} downrange. Horizontal speed does not help altitude.`);
  R.fixes.push(shortBy < 25000 ? 'You were close. A bigger tank or a lighter payload should get you there.' : 'Add propellant, or use a more efficient engine.');
  R.fixes.push('Fly straight up. For a sounding mission every degree of tilt costs altitude.');
  reentryNote();
  progNote();
  return R;
}

if (typeof module !== 'undefined') module.exports = { PARTS, MISSIONS, missionById, analyze, buildVehicle, massProps, stageSegments, Flight, flightReport,
  atmosphere, orbitElements, MODEL, G0, MU, RE, DEG, PROGRAM_TICK };
