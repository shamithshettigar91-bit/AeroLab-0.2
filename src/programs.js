// ================= AEROLAB REFERENCE DESIGNS AND EXAMPLE FLIGHT PROGRAMS =================
// Data only. Every example here is flown by the automated tests, so if a physics change
// breaks one, the tests say so.

const REFERENCE_DESIGNS = {
  sounder: {
    name: 'Sounder', mission: 'M002',
    note: 'Single-stage sounding rocket from V0.1. Reaches about 135 km.',
    stack: ['nose_ogive', 'payload_sci', 'avionics', 'tank_m', 'eng_sparrow'], fins: 'fins_s',
  },
  twin: {
    name: 'Twin', mission: 'M003',
    note: 'Two-stage sounding rocket. A Heron first stage lifts a Sparrow upper stage and separates at about 35 km.',
    stack: ['nose_ogive', 'payload_sci', 'avionics', 'tank_m', 'eng_sparrow', 'decoupler', 'tank_l', 'tank_l', 'eng_heron'], fins: 'fins_s',
  },
  orbiter: {
    name: 'Orbiter', mission: 'M004',
    note: 'Two-stage orbital rocket: Condor booster, Kestrel vacuum upper stage with reaction wheels. About 9,570 m/s of ΔV.',
    stack: ['nose_ogive', 'payload_sci', 'avionics', 'wheels', 'tank_c5', 'eng_kestrel', 'decoupler', 'tank_c5', 'tank_c5', 'tank_c3', 'eng_condor'], fins: 'fins_s',
  },
};

const EXAMPLE_PROGRAMS = [
  {
    id: 'hello', title: 'Hello, rocket', design: 'sounder', mission: 'M002',
    summary: 'The smallest useful program: light the engine, then report the climb until apogee.',
    code: `// Hello, rocket
// Every flight program defines  function* flight(ship) { ... }
// The simulation runs it 20 times per simulated second.
// "yield" hands control back to the simulation until the next tick.

function* flight(ship) {
  ship.throttle(1);      // full throttle
  ship.pitch(90);        // hold straight up
  ship.ignite();         // light the engine

  // wait until the rocket has left the pad
  yield ship.until(() => ship.liftedOff);
  ship.log('Lift-off!');

  // report every 10 seconds while climbing
  while (ship.verticalSpeed > 0) {
    ship.log('Altitude', (ship.altitude / 1000).toFixed(1), 'km, speed', ship.speed.toFixed(0), 'm/s');
    yield ship.wait(10);
  }
  ship.log('Apogee reached at', (ship.altitude / 1000).toFixed(1), 'km');
}
`,
  },
  {
    id: 'maxq', title: 'Throttle through max Q', design: 'sounder', mission: 'M002',
    summary: 'A closed-loop throttle: ease off when dynamic pressure gets high, then return to full power.',
    code: `// Throttle through max Q
// Powerful engines can push a rocket so fast in thick air that the
// dynamic pressure (q) breaks it. This program watches q and throttles down.
// Try it with the LR-40 Heron engine, which overloads at full throttle.

const Q_LIMIT = 45000;   // Pa. The airframe fails at 120 kPa; keep a big margin.

function* flight(ship) {
  ship.throttle(1);
  ship.pitch(90);
  ship.ignite();

  while (ship.propellant > 0) {
    if (ship.dynamicPressure > Q_LIMIT) {
      ship.throttle(0.5);
    } else if (ship.dynamicPressure < Q_LIMIT * 0.8) {
      ship.throttle(1);
    }
    yield;   // check again next tick
  }
  ship.log('Burnout at', (ship.altitude / 1000).toFixed(1), 'km');
}
`,
  },
  {
    id: 'staging', title: 'Two-stage staging', design: 'twin', mission: 'M003',
    summary: 'Burn stage 1 to empty, separate cleanly, then light stage 2. Reaches about 950 km.',
    code: `// Two-stage staging
// Rule 1: never separate while the lower stage is still firing,
//         or it rams the upper stage. Wait for burnout first.
// Rule 2: light the upper stage quickly. It has no fins, so in the
//         air it needs its engine's gimbal to stay pointed straight.

function* flight(ship) {
  ship.throttle(1);
  ship.pitch(90);
  ship.ignite();

  // --- stage 1 ---
  yield ship.until(() => ship.propellant <= 0);
  ship.log('Stage 1 burnout at', (ship.altitude / 1000).toFixed(1), 'km');
  yield ship.wait(1);            // let thrust tail off
  ship.stage();                  // separate at the decoupler

  // --- stage 2 ---
  yield ship.wait(0.5);          // clear the spent stage
  ship.ignite();
  yield ship.until(() => ship.propellant <= 0);
  ship.log('Stage 2 burnout. Apoapsis will be', (ship.apoapsis / 1000).toFixed(0), 'km');
}
`,
  },
  {
    id: 'orbit', title: 'Orbit: gravity turn, coast, circularise', design: 'orbiter', mission: 'M005',
    summary: 'The classic route to orbit. Turn gradually, raise apoapsis to 200 km, coast, then burn at apoapsis to lift the periapsis.',
    code: `// Orbit: gravity turn, coast, circularise
// 1. Climb straight up, then tilt east gradually (a "gravity turn").
// 2. Stage 1 burns out; separate and light the vacuum upper stage.
// 3. Burn until the apoapsis (highest point) reaches the target.
// 4. Coast up to apoapsis, pointed prograde.
// 5. Burn prograde at apoapsis until the periapsis comes up to meet it.

const TARGET = 200000;      // m, target orbit altitude
const TURN_START = 800;     // m, begin tilting
const TURN_END = 50000;     // m, end of the pitch programme
const END_PITCH = 30;       // degrees above the horizon at TURN_END

function* flight(ship) {
  ship.throttle(1);
  ship.pitch(90);
  ship.ignite();
  yield ship.until(() => ship.altitude > TURN_START);

  // --- stage 1: gravity turn ---
  while (ship.propellant > 0) {
    const k = Math.min(1, (ship.altitude - TURN_START) / (TURN_END - TURN_START));
    ship.pitch(90 - (90 - END_PITCH) * Math.sqrt(k));
    yield;
  }
  yield ship.wait(1);
  ship.stage();
  // In the air, point along the airflow ("surface prograde"). Orbital prograde
  // differs by Earth's rotation, and a finless stage flips if it points off the airflow.
  ship.surfacePrograde();
  yield ship.wait(0.5);
  ship.ignite();

  // --- stage 2: raise the apoapsis ---
  while (ship.apoapsis < TARGET && ship.propellant > 0) {
    if (ship.dynamicPressure > 300) ship.surfacePrograde();
    else ship.pitch(Math.max(5, ship.flightPathAngle - 6));   // fly a little flatter than the velocity
    yield;
  }
  ship.shutdown();
  ship.log('Apoapsis', (ship.apoapsis / 1000).toFixed(0), 'km. Coasting.');

  // --- plan the circularisation burn (vis-viva equation) ---
  ship.prograde();                              // the reaction wheels turn us while coasting
  const rA = ship.earthRadius + ship.apoapsis;
  const rP = ship.earthRadius + ship.periapsis;
  const vAtApo = Math.sqrt(ship.mu * (2 / rA - 2 / (rA + rP)));   // speed we will have at apoapsis
  const vCircular = Math.sqrt(ship.mu / rA);                        // speed a circular orbit needs
  const dv = vCircular - vAtApo;
  const ve = ship.isp * 9.80665;                                    // exhaust velocity
  const burnTime = ship.mass * (1 - Math.exp(-dv / ve)) / (ship.maxThrust / ve);
  ship.log('Circularisation needs', dv.toFixed(0), 'm/s, a', burnTime.toFixed(0), 's burn');

  // centre the burn on apoapsis (if we already passed it, burn straight away)
  if (ship.verticalSpeed > 0) {
    yield ship.until(() => ship.timeToApoapsis < burnTime / 2);
  }
  ship.ignite();
  yield ship.until(() => ship.periapsis > TARGET - 15000 || ship.propellant <= 0);
  ship.shutdown();
  ship.log('Orbit', (ship.periapsis / 1000).toFixed(0), 'x', (ship.apoapsis / 1000).toFixed(0), 'km');
}
`,
  },
  {
    id: 'orbit_eta', title: 'Orbit: direct insertion (advanced)', design: 'orbiter', mission: 'M004',
    summary: 'No coast. The upper stage burns continuously, steering to keep the apoapsis about a minute ahead.',
    code: `// Orbit: direct insertion (advanced)
// Instead of coasting, the upper stage keeps burning and steers so the
// apoapsis stays about ETA seconds ahead. If it gets closer, pitch up;
// if it runs away, pitch down. The burn ends when the periapsis is high enough.

const TARGET = 200000;   // m
const ETA = 75;          // s, keep the apoapsis this far ahead
const K_ETA = 0.5;       // degrees of pitch per second of ETA error
const K_APO = 0.5;       // degrees of pitch per km of apoapsis error

function* flight(ship) {
  ship.throttle(1);
  ship.pitch(90);
  ship.ignite();
  yield ship.until(() => ship.altitude > 800);

  while (ship.propellant > 0) {
    const k = Math.min(1, (ship.altitude - 800) / (50000 - 800));
    ship.pitch(90 - 70 * Math.sqrt(k));
    yield;
  }
  yield ship.wait(1);
  ship.stage();
  ship.surfacePrograde();
  yield ship.wait(0.5);
  ship.ignite();

  while (ship.periapsis < TARGET - 15000 && ship.propellant > 0) {
    const eta = ship.verticalSpeed > 0 ? ship.timeToApoapsis : -10;
    const p = 5 + K_ETA * (ETA - eta) + K_APO * (TARGET - ship.apoapsis) / 1000;
    if (ship.dynamicPressure > 300) ship.surfacePrograde();
    else ship.pitch(Math.max(-20, Math.min(45, p)));
    yield;
  }
  ship.shutdown();
  ship.log('Orbit', (ship.periapsis / 1000).toFixed(0), 'x', (ship.apoapsis / 1000).toFixed(0), 'km');
}
`,
  },
  {
    id: 'hohmann', title: 'Higher orbit: Hohmann transfer', design: 'orbiter', mission: 'M007',
    summary: 'Reach a low orbit, then raise it to 400 km with two short burns half an orbit apart. Uses all three Kestrel ignitions.',
    code: `// Higher orbit: Hohmann transfer
// The cheapest way between two circular orbits is two burns:
//   burn 1, prograde: raises the far side of the orbit (the apoapsis) to the new height
//   coast half an orbit, about 46 minutes, to that new apoapsis
//   burn 2, prograde: raises the near side (the periapsis) to match, making it circular
// Use time warp for the coast. Above 140 km the simulation coasts on an exact Kepler orbit.

const LOW = 200000;      // m, first orbit
const HIGH = 400000;     // m, target orbit

function* flight(ship) {
  // --- ascent: direct insertion into a low orbit (one Kestrel ignition) ---
  ship.throttle(1); ship.pitch(90); ship.ignite();
  yield ship.until(() => ship.altitude > 800);
  while (ship.propellant > 0) {
    const k = Math.min(1, (ship.altitude - 800) / (50000 - 800));
    ship.pitch(90 - 70 * Math.sqrt(k));
    yield;
  }
  yield ship.wait(1);
  ship.stage();
  ship.surfacePrograde();
  yield ship.wait(0.5);
  ship.ignite();
  while (ship.periapsis < LOW - 15000 && ship.propellant > 0) {
    const eta = ship.verticalSpeed > 0 ? ship.timeToApoapsis : -10;
    const p = 5 + 0.5 * (75 - eta) + 0.5 * (LOW - ship.apoapsis) / 1000;
    if (ship.dynamicPressure > 300) ship.surfacePrograde();
    else ship.pitch(Math.max(-20, Math.min(45, p)));
    yield;
  }
  ship.shutdown();
  ship.log('Low orbit', (ship.periapsis / 1000).toFixed(0), 'x', (ship.apoapsis / 1000).toFixed(0), 'km');

  // --- plan the transfer (vis-viva) ---
  ship.prograde();
  yield ship.wait(10);                               // let the reaction wheels line up
  const r1 = ship.radius, r2 = ship.earthRadius + HIGH, aT = (r1 + r2) / 2;
  const dv1 = Math.sqrt(ship.mu * (2 / r1 - 1 / aT)) - ship.orbitalSpeed;
  const dv2 = Math.sqrt(ship.mu / r2) - Math.sqrt(ship.mu * (2 / r2 - 1 / aT));
  ship.log('Transfer: burn 1', dv1.toFixed(0), 'm/s, burn 2', dv2.toFixed(0), 'm/s, coast', (Math.PI * Math.sqrt(aT ** 3 / ship.mu) / 60).toFixed(0), 'min');

  // --- burn 1: raise the apoapsis ---
  ship.ignite();
  yield ship.until(() => ship.apoapsis >= HIGH || ship.propellant <= 0);
  ship.shutdown();

  // --- coast to the new apoapsis, then burn 2 centred on it ---
  const ve = ship.isp * 9.80665;
  const burnTime = ship.mass * (1 - Math.exp(-dv2 / ve)) / (ship.maxThrust / ve);
  yield ship.until(() => ship.timeToApoapsis < burnTime / 2 && ship.verticalSpeed > 0);
  ship.ignite();
  yield ship.until(() => ship.periapsis >= HIGH - 15000 || ship.propellant <= 0);
  ship.shutdown();
  ship.log('Orbit', (ship.periapsis / 1000).toFixed(0), 'x', (ship.apoapsis / 1000).toFixed(0), 'km');
}
`,
  },
  {
    id: 'blank', title: 'Blank program', design: null, mission: null,
    summary: 'A starting point with the structure in place.',
    code: `// My flight program

function* flight(ship) {
  ship.throttle(1);
  ship.pitch(90);
  ship.ignite();

  yield ship.until(() => ship.propellant <= 0);
  ship.log('Burnout at', (ship.altitude / 1000).toFixed(1), 'km');
}
`,
  },
];

if (typeof module !== 'undefined') module.exports = { REFERENCE_DESIGNS, EXAMPLE_PROGRAMS };
