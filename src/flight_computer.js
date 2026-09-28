// ================= AEROLAB FLIGHT COMPUTER =================
// Runs the player's flight program inside the simulation, deterministically.
//
// A program is JavaScript that defines a generator:   function* flight(ship) { ... }
// The simulation advances the generator 20 times per simulated second. Each `yield`
// hands control back to the simulation:
//   yield;                              resume on the next tick (1/20 s later)
//   yield ship.wait(5);                 resume after 5 simulated seconds
//   yield ship.until(() => cond);       resume on the first tick where cond is true
//
// Safety and determinism:
// - The source is parsed with Acorn and every loop and function body gets a guard call,
//   so an infinite loop halts the program with a clear error instead of freezing the game.
// - Math.random is replaced by a seeded generator; Date, timers, the page and the network are hidden.
// - The program only sees the `ship` object. It can command the vehicle but never touch the physics.
const acornLib = typeof acorn !== 'undefined' ? acorn : require('../vendor/acorn.js');
// constants from core.js: shared globals in the browser, required in Node
const K = typeof G0 !== 'undefined' ? { G0, MU, RE, DEG } : require('./core.js');
const FC_BUDGET = 200000; // guard hits (loop iterations and function calls) allowed per tick

class ProgramError extends Error {
  constructor(message, line = null, column = null, kind = 'error') { super(message); this.line = line; this.column = column; this.kind = kind; }
}
class BudgetError extends Error {}

function walkAst(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const key in node) {
    if (key === 'loc') continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walkAst(c, fn); }
    else if (v && typeof v.type === 'string') walkAst(v, fn);
  }
}

// Parse, check the program's shape, and insert __guard() calls. Line numbers are preserved.
function instrumentSource(src) {
  let ast;
  try { ast = acornLib.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true }); }
  catch (e) {
    const msg = String(e.message).replace(/\s*\(\d+:\d+\)$/, '');
    throw new ProgramError(`Syntax error: ${msg}`, e.loc ? e.loc.line : null, e.loc ? e.loc.column : null, 'syntax');
  }
  const main = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id && n.id.name === 'flight');
  if (!main) throw new ProgramError('The program needs a main function:  function* flight(ship) { ... }', 1, 0, 'structure');
  if (!main.generator) throw new ProgramError('flight must be a generator function. Write  function* flight(ship)  with an asterisk.', main.loc.start.line, main.loc.start.column, 'structure');
  const edits = [];
  const LOOPS = ['ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForInStatement', 'ForOfStatement'];
  const FUNCS = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];
  walkAst(ast, n => {
    if (LOOPS.includes(n.type)) {
      const b = n.body;
      if (b.type === 'BlockStatement') edits.push([b.start + 1, '__guard();']);
      else { edits.push([b.start, '{__guard();']); edits.push([b.end, '}']); }
    } else if (FUNCS.includes(n.type) && n.body.type === 'BlockStatement') edits.push([n.body.start + 1, '__guard();']);
  });
  edits.sort((a, b) => b[0] - a[0]);
  let out = src;
  for (const [pos, text] of edits) out = out.slice(0, pos) + text + out.slice(pos);
  return out;
}

let LINE_OFFSET = null; // how many lines the Function constructor adds before our body
function lineOffset() {
  if (LINE_OFFSET !== null) return LINE_OFFSET;
  try { new Function('"use strict";\nthrow new Error("probe");\n//# sourceURL=aerolab-probe.js')(); }
  catch (e) { const m = /aerolab-probe\.js:(\d+)/.exec(String(e.stack || '')); LINE_OFFSET = m ? (+m[1] - 2) : 0; }
  return LINE_OFFSET;
}
function userLine(e) {
  const m = /flight-program\.js:(\d+)(?::(\d+))?/.exec(String((e && e.stack) || ''));
  if (!m) return null;
  const line = +m[1] - 1 - lineOffset();
  return line > 0 ? line : null;
}

function seededRandom(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function safeMath(seed) {
  const M = {}; for (const k of Object.getOwnPropertyNames(Math)) M[k] = Math[k];
  M.random = seededRandom(seed);
  return Object.freeze(M);
}

const HIDDEN = ['Date', 'window', 'document', 'globalThis', 'self', 'fetch', 'XMLHttpRequest', 'WebSocket', 'setTimeout', 'setInterval',
  'requestAnimationFrame', 'localStorage', 'sessionStorage', 'indexedDB', 'require', 'process', 'Function'];

// Compile only (for the editor's "Check" button and for tests). Returns { ok, error }.
function checkProgram(src) {
  try { compileProgram(src); return { ok: true, error: null }; }
  catch (e) { return { ok: false, error: { message: e.message, line: e.line ?? null, column: e.column ?? null, kind: e.kind || 'error' } }; }
}
function compileProgram(src) {
  const code = instrumentSource(src);
  try { return new Function('ship', 'Math', 'console', '__guard', ...HIDDEN, '"use strict";\n' + code + '\nreturn flight;\n//# sourceURL=flight-program.js'); }
  catch (e) { throw new ProgramError(`Syntax error: ${e.message}`, null, null, 'syntax'); }
}

class FlightComputer {
  constructor(source, flight, seed = 1) {
    this.f = flight; this.source = source; this.seed = seed;
    this.status = 'ready'; this.error = null; this.wait = null; this.ticks = 0; this.logCount = 0; this.logThisTick = 0; this.count = 0;
    this.ship = makeShip(this);
    try { this.factory = compileProgram(source); }
    catch (e) { this.status = 'error'; this.error = { message: e.message, line: e.line ?? null }; flight.log(`Flight program error${e.line ? ` on line ${e.line}` : ''}: ${e.message}`, 'bad'); }
  }
  guard() { if (++this.count > FC_BUDGET) throw new BudgetError(); }
  get waitingFor() { return this.wait ? this.wait.text : ''; }
  get active() { return this.status === 'running'; }
  stop(reason = 'Flight program stopped by the pilot') { if (this.status === 'running' || this.status === 'ready') { this.status = 'stopped'; this.wait = null; this.f.log(reason); } }

  tick() {
    if (this.status !== 'ready' && this.status !== 'running') return;
    this.count = 0; this.logThisTick = 0; this.ticks++;
    try {
      if (this.status === 'ready') {
        const main = this.factory(this.ship, safeMath(this.seed), { log: (...a) => this.ship.log(...a) }, () => this.guard());
        this.gen = main(this.ship); this.status = 'running'; this.f.log('Flight program started');
      }
      if (this.wait) { if (!this.waitDone()) return; this.wait = null; }
      const r = this.gen.next();
      if (r.done) { this.status = 'finished'; this.f.log('Flight program finished'); return; }
      this.wait = this.toWait(r.value);
    } catch (e) { this.halt(e); }
  }
  waitDone() {
    const w = this.wait;
    if (w.kind === 'time') return this.f.t >= w.until - 1e-9;
    if (w.kind === 'cond') { const v = w.fn(); return !!v; }
    return true;
  }
  toWait(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return { kind: 'time', until: this.f.t + v, text: `wait ${v} s` };
    if (typeof v === 'function') return { kind: 'cond', fn: v, text: 'until a condition is true' };
    if (v && v.__aerolabWait) return v;
    throw new TypeError('yield needs ship.wait(seconds), ship.until(() => condition), or nothing (plain "yield;" waits one tick)');
  }
  halt(e) {
    this.wait = null;
    if (e instanceof BudgetError) {
      this.status = 'budget';
      this.error = { message: 'The program ran too long in one tick and was halted. Every loop that waits for something needs a yield inside it.', line: null };
      this.f.log('Flight program halted: it ran too long without yielding (a loop without yield?)', 'bad');
    } else {
      this.status = 'error';
      const line = userLine(e);
      this.error = { message: (e && e.message) || String(e), line };
      this.f.log(`Flight program error${line ? ` on line ${line}` : ''}: ${this.error.message}`, 'bad');
    }
  }
}

// ---------- The ship API: everything a flight program can read or command ----------
function makeShip(fc) {
  const f = () => fc.f;
  const num = (x, name) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`${name} needs a number, got ${x}`); return x; };
  const stageDv = () => {
    const F = f(), e = F.veh.eng; if (!e || F.prop <= 0) return 0;
    const m = F.veh.dryMass + F.prop; return e.ispVac * K.G0 * Math.log(m / (m - F.prop));
  };
  const api = {
    // commands
    ignite() { return f().ignite(); },
    shutdown() { return f().shutdown(); },
    stage() { return f().stage(); },
    throttle(x) { num(x, 'ship.throttle'); f().setThrottle(x); },
    pitch(deg) { num(deg, 'ship.pitch'); f().setPitch(deg); },
    prograde() { f().setMode('prograde'); },
    retrograde() { f().setMode('retrograde'); },
    surfacePrograde() { f().setMode('surface'); },
    sas(on = true) { f().sas = !!on; },
    log(...args) {
      if (fc.logThisTick >= 3 || fc.logCount >= 400) return;
      fc.logThisTick++; fc.logCount++;
      const text = args.map(a => typeof a === 'number' ? (Number.isInteger(a) ? String(a) : a.toFixed(2)) : String(a)).join(' ');
      f().log('▸ ' + text.slice(0, 160), 'program');
    },
    // waiting (use with yield)
    wait(seconds) { num(seconds, 'ship.wait'); return { __aerolabWait: true, kind: 'time', until: f().t + seconds, text: `wait ${seconds} s` }; },
    until(fn) { if (typeof fn !== 'function') throw new TypeError('ship.until needs a function, for example ship.until(() => ship.altitude > 10000)'); return { __aerolabWait: true, kind: 'cond', fn, text: 'until a condition is true' }; },
  };
  const getters = {
    time: () => f().t,
    missionTime: () => f().liftoffT === null ? 0 : f().t - f().liftoffT,
    liftedOff: () => f().liftoffT !== null,
    altitude: () => f().d.alt,
    speed: () => f().d.speed,
    orbitalSpeed: () => f().d.orbitalSpeed,
    verticalSpeed: () => f().d.vr,
    horizontalSpeed: () => f().d.hSpeed,
    apoapsis: () => f().d.apo,
    periapsis: () => f().d.peri,
    eccentricity: () => f().d.ecc,
    period: () => f().d.period,
    timeToApoapsis: () => f().d.timeToApo,
    dynamicPressure: () => f().d.q,
    mach: () => f().d.mach,
    pitchAngle: () => f().d.pitch,
    flightPathAngle: () => { const F = f(); return F.pitchOf(Math.atan2(F.vy, F.vx), F.x, F.y); },
    angleOfAttack: () => { const a = f()._aux; return a ? Math.asin(Math.min(1, a.sina)) / K.DEG : 0; },
    downrange: () => f().d.downrange,
    mass: () => f().d.mass,
    thrust: () => f().d.thrust,
    maxThrust: () => { const e = f().veh.eng; return e ? e.tvac : 0; },
    twr: () => f().d.twr,
    throttleSetting: () => f().throttleCmd,
    propellant: () => f().prop,
    propellantFraction: () => f().d.fuel,
    burnTime: () => { const F = f(); return F.veh.mdotMax > 0 ? F.prop / (F.veh.mdotMax * F.throttleCmd) : 0; },
    stageDeltaV: stageDv,
    stage_: () => f().stageNo,
    stagesLeft: () => f().nStages - f().stageNo,
    engine: () => f().engine,
    engineName: () => f().veh.eng ? f().veh.eng.name : null,
    engineType: () => f().veh.eng ? f().veh.eng.type : null,
    ignitionsLeft: () => f().ignitionsLeft,
    isp: () => { const F = f(), e = F.veh.eng; return e ? e.ispVac - (e.ispVac - e.ispSL) * F.d.p / 101325 : 0; },
    hasReactionWheels: () => f().veh.wheelTorque > 0,
    radius: () => Math.hypot(f().x, f().y),
    gravity: () => { const r = Math.hypot(f().x, f().y); return K.MU / (r * r); },
    circularSpeed: () => Math.sqrt(K.MU / Math.hypot(f().x, f().y)),
    earthRadius: () => K.RE,
    mu: () => K.MU,
    missionId: () => f().mission.id,
    targetPeriapsis: () => f().mission.objective.peri ?? null,
    targetApoapsis: () => f().mission.objective.apo ?? null,
    targetAltitude: () => f().mission.objective.value ?? null,
  };
  for (const [k, g] of Object.entries(getters)) Object.defineProperty(api, k === 'stage_' ? 'stageNumber' : k, { get: g, enumerable: true });
  return Object.freeze(api);
}

// Names shown in the editor's reference panel
const SHIP_API = {
  commands: [
    ['ship.ignite()', 'Light the current stage\'s engine. Liquid engines have a limited number of ignitions.'],
    ['ship.shutdown()', 'Cut the current engine (liquid engines only).'],
    ['ship.throttle(x)', 'Throttle from 0.4 to 1.0. Values below 0.4 hold 0.4; use shutdown() for zero.'],
    ['ship.stage()', 'Separate the spent stage at the lowest decoupler. Only when its engine is off.'],
    ['ship.pitch(deg)', 'Hold a pitch angle above the horizon, heading east. 90 is straight up, 0 is horizontal.'],
    ['ship.prograde()', 'Point along the orbital velocity. Best for orbit insertion and circularising.'],
    ['ship.surfacePrograde()', 'Point along the velocity relative to the air. Zero angle of attack in the atmosphere.'],
    ['ship.retrograde()', 'Point against the orbital velocity.'],
    ['ship.sas(on)', 'Turn attitude hold on or off.'],
    ['ship.log(...values)', 'Write a line in the flight log (up to 3 per tick).'],
  ],
  waits: [
    ['yield;', 'Wait one tick (1/20 s).'],
    ['yield ship.wait(s);', 'Wait s simulated seconds.'],
    ['yield ship.until(() => condition);', 'Wait until the condition is true. Checked every tick.'],
  ],
  readings: [
    ['altitude', 'm above sea level'], ['speed', 'm/s relative to the air'], ['orbitalSpeed', 'm/s inertial'],
    ['verticalSpeed', 'm/s, positive up'], ['horizontalSpeed', 'm/s inertial, along the horizon'],
    ['apoapsis', 'm, highest point of the current orbit (Infinity if escaping)'], ['periapsis', 'm, lowest point (negative means it hits Earth)'],
    ['eccentricity', '0 is circular'], ['period', 's'], ['timeToApoapsis', 's'],
    ['dynamicPressure', 'Pa'], ['mach', ''], ['pitchAngle', '° above the horizon'], ['flightPathAngle', '° of the orbital velocity above the horizon'],
    ['angleOfAttack', '°'], ['downrange', 'm east of the pad'], ['mass', 'kg'], ['thrust', 'N now'], ['maxThrust', 'N, vacuum rating'],
    ['twr', 'thrust-to-weight now'], ['throttleSetting', '0.4–1'], ['propellant', 'kg left in the current stage'], ['propellantFraction', '0–1'],
    ['burnTime', 's left at the current throttle'], ['stageDeltaV', 'm/s left in the current stage (vacuum)'],
    ['stageNumber', '1 is the first stage'], ['stagesLeft', 'separations still to come'], ['engine', "'off', 'ignition', 'running', 'shutdown', 'burnout'"],
    ['engineName', 'name of the current engine'], ['engineType', "'liquid', 'solid' or null"], ['ignitionsLeft', ''], ['isp', 's at the current pressure'], ['hasReactionWheels', 'true or false'],
    ['gravity', 'm/s² here'], ['circularSpeed', 'm/s for a circular orbit at this height'], ['radius', 'm from Earth\'s centre'],
    ['earthRadius', 'm'], ['mu', "Earth's gravitational parameter, m³/s²"],
    ['time', 's since the program started'], ['missionTime', 's since lift-off'], ['liftedOff', 'true or false'],
    ['missionId', "for example 'M004'"], ['targetPeriapsis', 'm, from the mission'], ['targetApoapsis', 'm or null'], ['targetAltitude', 'm or null'],
  ],
};

if (typeof module !== 'undefined') {
  module.exports = { FlightComputer, checkProgram, instrumentSource, compileProgram, SHIP_API, ProgramError, FC_BUDGET };
}
