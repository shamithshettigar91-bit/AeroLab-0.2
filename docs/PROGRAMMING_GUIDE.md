# Programming your rocket

AeroLab's flight computer runs a program you write in JavaScript. The program reads the vehicle's instruments and gives commands: ignite, throttle, pitch, stage. If the program and the rocket are both right, the rocket flies itself to orbit.

This guide starts with the smallest program that works and ends with a complete orbital ascent. Every example program in the game is flown by the automated tests (`tests/flight-tests.js`), so if one of them stops working after a physics change, the tests say so.

## Where to write programs

- **In the game:** open the **Program** tab. Pick an example on the left, or write your own. **Check** compiles it and marks errors in the line numbers. **Test flight** flies the whole mission instantly and shows the result. **Go to launch pad** lets you watch it; press Space to start the program.
- **In the dashboard:** Flight Lab has the same programs in a text box, and Parameter Sweep can fly one program many times with a constant changed each time (see [Experiments with programs](#experiments-with-programs)).

The program is saved with the design when you press **Save version**.

## The shape of a program

Every program defines one function:

```js
function* flight(ship) {
  ship.throttle(1);
  ship.pitch(90);
  ship.ignite();
  yield ship.until(() => ship.propellant <= 0);
  ship.log('Burnout at', ship.altitude / 1000, 'km');
}
```

The asterisk in `function*` makes it a *generator*. That is what lets the program wait. The simulation runs at 100 steps per simulated second, and 20 times per second (every fifth step) it hands control to your program. Your code runs until it reaches a `yield`, which hands control back. The next tick resumes right after that `yield`.

There are three ways to wait:

| Write | Meaning |
| --- | --- |
| `yield;` | Wait one tick (1/20 s). Use it inside loops that steer continuously. |
| `yield ship.wait(5);` | Wait 5 simulated seconds. |
| `yield ship.until(() => ship.altitude > 10000);` | Wait until the condition is true. It is checked every tick. |

Time in a program is always simulated time. At 100× time warp, `ship.wait(60)` takes 0.6 real seconds, and the flight is identical to one watched at 1×.

### Continuous steering

A loop with a plain `yield` runs once per tick, so it can steer smoothly:

```js
while (ship.propellant > 0) {
  const k = Math.min(1, ship.altitude / 50000);
  ship.pitch(90 - 60 * Math.sqrt(k));   // tilt from 90° to 30° as the rocket climbs
  yield;                                 // essential: without it the program never gives time back
}
```

A loop that waits for something **must** contain a `yield`. Without one, the loop would run forever inside a single tick. The flight computer allows about 200,000 loop iterations and function calls per tick. Past that it halts the program with *"ran too long without yielding"*, and the rocket carries on with its last commands.

### Helper functions

Ordinary functions work as usual. A helper that needs to wait must itself be a generator, called with `yield*`:

```js
function* burnUntilEmpty(ship) {
  ship.ignite();
  yield ship.until(() => ship.propellant <= 0);
}

function* flight(ship) {
  ship.throttle(1);
  yield* burnUntilEmpty(ship);     // stage 1
  yield ship.wait(1);
  ship.stage();
  yield ship.wait(0.5);
  yield* burnUntilEmpty(ship);     // stage 2
}
```

## The ship object

Your program sees one object, `ship`. The game's own reference panel lists the same things.

### Commands

| Command | What it does |
| --- | --- |
| `ship.ignite()` | Lights the current stage's engine. Returns `true` if it lit. Liquid engines have a limited number of ignitions: one for the Sparrow, Heron and Condor, three for the Kestrel vacuum engine. A solid motor lights once and burns to the end. |
| `ship.shutdown()` | Cuts a liquid engine. |
| `ship.throttle(x)` | Sets throttle from 0.4 to 1.0. Liquid engines cannot throttle below 40%; lower values hold 40%. Use `shutdown()` for zero. |
| `ship.stage()` | Separates the spent stage at the lowest decoupler. The next stage's engine is then ready but **not** lit. |
| `ship.pitch(deg)` | Holds a pitch angle above the horizon, heading east. 90 is straight up, 0 is horizontal, negative points below the horizon. |
| `ship.surfacePrograde()` | Points along the velocity relative to the air. This is zero angle of attack. |
| `ship.prograde()` | Points along the orbital (inertial) velocity. Use it above the atmosphere. |
| `ship.retrograde()` | Points against the orbital velocity. |
| `ship.sas(on)` | Turns attitude hold on or off. |
| `ship.log(...values)` | Writes a line in the flight log. Numbers are rounded to two decimals. Up to 3 lines per tick. |

Commands take effect in the same simulation step. They go through the same code as the on-screen buttons, so a program cannot do anything a pilot could not.

### Readings

All readings use SI units (metres, seconds, kilograms, newtons, pascals), and angles are in degrees.

| Reading | Meaning |
| --- | --- |
| `altitude` | m above sea level |
| `speed` | m/s relative to the air |
| `orbitalSpeed` | m/s relative to Earth's centre (inertial) |
| `verticalSpeed` | m/s, positive up |
| `horizontalSpeed` | m/s along the horizon, inertial |
| `apoapsis`, `periapsis` | m above sea level, highest and lowest points of the current orbit. `apoapsis` is `Infinity` on an escape path; a negative `periapsis` means the orbit hits Earth. |
| `eccentricity`, `period` | 0 is circular; period in s |
| `timeToApoapsis` | s until the highest point |
| `dynamicPressure`, `mach` | Pa; Mach number |
| `pitchAngle` | ° of the rocket's nose above the horizon |
| `flightPathAngle` | ° of the orbital velocity above the horizon |
| `angleOfAttack` | ° between the nose and the airflow |
| `downrange` | m east of the launch pad |
| `mass`, `thrust`, `maxThrust`, `twr` | kg; N now; N vacuum rating; thrust-to-weight now |
| `throttleSetting` | the commanded throttle, 0.4 to 1 |
| `propellant`, `propellantFraction` | kg left in the current stage; 0 to 1 |
| `burnTime` | s of burning left at the current throttle |
| `stageDeltaV` | m/s left in the current stage, vacuum |
| `stageNumber`, `stagesLeft` | 1 is the first stage; separations still to come |
| `engine` | `'off'`, `'ignition'`, `'running'`, `'shutdown'` or `'burnout'` |
| `engineName`, `engineType`, `ignitionsLeft`, `isp` | Isp in s at the current air pressure |
| `hasReactionWheels` | `true` if the current vehicle can turn without thrust |
| `gravity`, `circularSpeed`, `radius` | m/s² here; m/s for a circular orbit at this height; m from Earth's centre |
| `earthRadius`, `mu` | 6,371,000 m; 3.986 × 10¹⁴ m³/s² |
| `time`, `missionTime`, `liftedOff` | s since the program started; s since lift-off; `true` after lift-off |
| `missionId`, `targetPeriapsis`, `targetApoapsis`, `targetAltitude` | from the selected mission, in m (or `null`) |

## From the pad to orbit

The reference program **Orbit: gravity turn, coast, circularise** flies the Orbiter rocket to a 193 × 200 km orbit with about 30 kg of propellant to spare. Each phase below explains one part of it.

### 1. Climb, then turn gradually

A rocket that stays vertical only goes up. Orbit is mostly *sideways* speed: about 7,800 m/s at 200 km. The program tilts east slowly as it climbs. This is a gravity turn, so called because gravity bends the path over naturally:

```js
while (ship.propellant > 0) {
  const k = Math.min(1, (ship.altitude - TURN_START) / (TURN_END - TURN_START));
  ship.pitch(90 - (90 - END_PITCH) * Math.sqrt(k));
  yield;
}
```

Turning too early costs speed to drag in thick air. Turning too late means a steep climb with high gravity losses and too little sideways speed. The best `END_PITCH` for the Orbiter lies between about 20° and 40° (see [Experiments with programs](#experiments-with-programs)).

### 2. Separate cleanly

```js
yield ship.wait(1);        // stage 1 is empty; let the thrust tail off
ship.stage();
ship.surfacePrograde();    // point along the airflow
yield ship.wait(0.5);      // let the spent stage fall clear
ship.ignite();
```

Three rules here are all enforced by the physics:

1. **Never separate while the lower stage is firing.** A stage that is still thrusting keeps accelerating after the springs let go and rams the stage above. The flight report calls this *recontact*.
2. **Separate high.** The upper stage has no fins. In thick air, any angle of attack flips it or breaks it. The Orbiter separates at about 55 km, where dynamic pressure is about 1 kPa.
3. **In the air, point along the airflow, not the orbit.** The atmosphere turns with Earth, which moves the launch site east at about 465 m/s. So below about 70 km, orbital prograde is several degrees off the airflow. `ship.prograde()` right after separation makes a finless stage tumble. `ship.surfacePrograde()` keeps it at zero angle of attack.

### 3. Raise the apoapsis

The upper stage burns until the highest point of the orbit reaches the target, flying a little flatter than its velocity:

```js
while (ship.apoapsis < TARGET && ship.propellant > 0) {
  if (ship.dynamicPressure > 300) ship.surfacePrograde();
  else ship.pitch(Math.max(5, ship.flightPathAngle - 6));
  yield;
}
ship.shutdown();
```

Now the vehicle is on a path that reaches 200 km, but its periapsis is far below the surface. Left alone, it would fall back.

### 4. Plan the circularisation burn

At apoapsis the vehicle is moving slowest. A prograde burn there raises the far side of the orbit, the periapsis. The vis-viva equation gives the speed at any point of an orbit with semi-major axis *a*:

  v² = μ (2 / r − 1 / a)

The program uses it to work out how much speed is missing, and the rocket equation to turn that into a burn time:

```js
const rA = ship.earthRadius + ship.apoapsis;
const rP = ship.earthRadius + ship.periapsis;
const vAtApo = Math.sqrt(ship.mu * (2 / rA - 2 / (rA + rP)));   // a = (rA + rP) / 2
const vCircular = Math.sqrt(ship.mu / rA);
const dv = vCircular - vAtApo;
const ve = ship.isp * 9.80665;                                    // exhaust velocity
const burnTime = ship.mass * (1 - Math.exp(-dv / ve)) / (ship.maxThrust / ve);
```

### 5. Coast, then burn at apoapsis

```js
ship.prograde();   // reaction wheels turn the stage while the engine is off
if (ship.verticalSpeed > 0) {
  yield ship.until(() => ship.timeToApoapsis < burnTime / 2);   // centre the burn on apoapsis
}
ship.ignite();     // the Kestrel's second ignition
yield ship.until(() => ship.periapsis > TARGET - 15000 || ship.propellant <= 0);
ship.shutdown();
```

The coast only works because the Orbiter's top stage carries **reaction wheels**. Without them, a stage cannot turn while its engine is off, so it cannot line up for the burn. The builder warns about this. The `verticalSpeed` check covers the case where the stage already passed apoapsis during its burn; it then circularises at once instead of waiting almost a whole orbit.

The mission completes when the engine is off and the periapsis is above the target.

### The other way: direct insertion

**Orbit: direct insertion (advanced)** never coasts. The upper stage burns continuously and steers so the apoapsis stays about 75 s ahead: pitch up if it gets closer, down if it runs away. This is a closed-loop controller, the same idea real launch guidance builds on. It reaches a 190 × 197 km orbit.

## When things go wrong

| You see | Cause | Fix |
| --- | --- | --- |
| *Syntax error* with a line number, before launch | The code does not parse | Press **Check**; the line number turns red |
| *The program needs a main function* | No `function* flight(ship)` | Keep that exact name and the asterisk |
| *Flight program error on line N: … is not a function* | A misspelt command, such as `ship.stagee()` | Compare with the reference panel |
| *Halted: ran too long without yielding* | A loop with no `yield` | Add `yield;` inside the loop |
| *yield needs ship.wait(seconds), ship.until(…)* | Yielding something else, such as a string | Yield a wait, a number of seconds, or nothing |
| Report: *Stage 2 was never ignited* | `ship.stage()` without a following `ship.ignite()` | Staging only separates; lighting is separate |
| Report: *recontact* | `ship.stage()` while the engine was firing | Wait for `ship.propellant <= 0`, or `shutdown()` first |
| Report: *coasted past apoapsis with fuel unused* | The program ended without circularising | Add the circularisation burn |

When a program halts, the vehicle keeps flying on its last commands, as a real vehicle would if its computer crashed. The report shows the error, and **Edit program** jumps to the line.

## Determinism and safety

The same program on the same rocket always produces exactly the same flight, whether it runs in the game, the Node tests or the dashboard. That is what makes experiments reproducible. To guarantee it:

- `Math.random()` is replaced by a seeded generator. The seed is 1 unless an experiment sets another, so random numbers repeat exactly.
- `Date`, timers, the page, local storage and the network are hidden from the program.
- The program is parsed with Acorn before it runs. Every loop and function body gets a budget check inserted, without changing line numbers, so error lines stay accurate.
- The program can only use `ship`. It cannot reach the physics, only command the vehicle.

These rules keep flights reproducible and stop accidental freezes. They are not a security boundary against deliberately hostile code. Run programs you wrote or trust.

A published web page may block custom code with its security settings. If it does, the Program tab says so; open `index.html` from the project folder instead.

## Experiments with programs

In the dashboard's **Parameter Sweep** page, choose **Flight program constant**. It finds every top-level line of the form `const NAME = number;`, lets you pick one and a range, and flies one flight per value. Everything else in the program stays exactly as written. Sweeping `END_PITCH` from 10° to 50° on the Orbiter (mission M004) gives this:

| End pitch | Outcome |
| --- | --- |
| 10°, 15° | Fell short. The turn is too flat: the orbit is only 77–109 km × 3,600 km. |
| 20° to 45° | Orbit. 20°–30° gives near-circular orbits with 29–36 kg left; 45° runs the stage dry at 181 × 1,288 km. |
| 50° | Fell short. The climb is too steep, and the periapsis is −40 km. |

Save the sweep as an experiment and the manifest stores every program source, so anyone can reproduce it exactly with `python tools/reproduce.py`.
