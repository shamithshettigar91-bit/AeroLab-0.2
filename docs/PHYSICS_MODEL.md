# AeroLab physics model, V0.2

Model identifiers: AeroModel 0.3 (Kepler coasting on rails, section below), and previously AeroModel 0.2, US76-lite 1.0, PointMass 1.0, RK4 at 100 Hz, Impulse 1.0 (staging), FlightComputer 1.0 at 20 Hz.

AeroModel 0.2 adds staging, reaction wheels, engine restarts, orbital elements and the flight computer. It is a strict extension of 0.1. Every calculation 0.1 made is still made the same way, in the same order, so a V0.1 design flies bit-for-bit identically; the committed V0.1 baseline proves it (`python tools/reproduce.py --all`). The new sections are marked *(0.2)*.

## Frame and state

The flight is simulated in a two-dimensional inertial frame in Earth's equatorial plane, with the origin at Earth's centre. Earth rotates at 7.2921159 × 10⁻⁵ rad/s, and the launch pad sits on the equator. The vehicle therefore starts with about 465 m/s of eastward inertial velocity.

State vector: position x, y; velocity vx, vy; attitude angle θ; angular rate ω; propellant mass.

Integration uses fourth-order Runge–Kutta at a fixed 0.01 s step, independent of the frame rate. Time warp runs more steps per frame, never larger steps. Mass properties (CG, moment of inertia) are refreshed at the start of each step.

## Gravity

Point mass: g = μ / r², with μ = 3.986004418 × 10¹⁴ m³/s² and Earth radius 6,371 km.

## Atmosphere

US Standard Atmosphere 1976 layers up to 86 km, using a lapse-rate or isothermal barometric formula in each layer. Above 86 km the model is isothermal at 184.65 K. It outputs temperature, pressure, density ρ = p / (R T) and speed of sound a = √(1.4 R T).

The atmosphere rotates with Earth. All aerodynamic forces use air-relative velocity: v_air = v − ω × r.

## Propulsion

Mass flow is derived from the vacuum rating, never stored separately:

ṁ = T_vac / (Isp_vac · g₀)

Isp varies linearly with ambient pressure between its sea-level and vacuum values. Thrust = ṁ · throttle · g₀ · Isp(p).

Liquid engines throttle between 40% and 100% and gimbal a few degrees. Solid motors run at 100% until burnout and cannot shut down or steer. Every engine has a fixed 0.15° thrust misalignment, as any real vehicle does, so instabilities have something to grow from.

Engine states: off, ignition (0.6 s thrust ramp), running, shutdown, burnout.

*(0.2)* Each liquid engine has a number of ignitions: one for the Sparrow, Heron and Condor, three for the Kestrel vacuum engine. A shut-down engine with ignitions left can be relit. A burned-out engine cannot. The Kestrel's low sea-level Isp (170 s against 345 s in vacuum) models a large nozzle built for vacuum.

## Aerodynamics

Dynamic pressure: q = ½ ρ v_air².

Drag: D = q · A · Cd, with reference area A = π (0.3 m)².
Cd = Cd₀ × Mach factor + base drag when unpowered (0.12) + 1.5 sin²α.
Cd₀ = nose-cone term + 0.012 × length + fin term. The Mach factor peaks at 1.9 near Mach 1.05 and falls to about 1.05 at high Mach.

Normal force: N = q · A · CNα · sin α, acting at the centre of pressure.

Centre of pressure uses Barrowman-style normal-force slopes: CNα = 2 for the nose (at 0.466 of its length for an ogive, 0.667 for a cone), plus the fin set's slope at the tail.

Static margin = (CP − CG) / diameter, in calibres. A positive margin means aerodynamically stable.

Pitch damping torque is proportional to q · A · L² · ω / v, with a coefficient derived from each surface's distance from the CG.

## Attitude hold

A PID controller computes the torque needed to hold a target attitude. It includes a feed-forward term that cancels the predicted aerodynamic torque. The gimbal is rate-limited to 20°/s.

*(0.2)* The target can be:

- a pitch angle above the local horizon, heading east;
- surface prograde: along the air-relative velocity, which is zero angle of attack;
- orbital prograde or retrograde: along or against the inertial velocity.

Near the pad the air-relative and inertial velocities differ by Earth's rotation, about 465 m/s eastward. So orbital prograde can be several degrees off the airflow while the vehicle is still in the atmosphere.

*(0.2)* Reaction wheels supply up to their rated torque (400 N·m per unit) directly about the centre of gravity, with or without thrust. The controller uses the wheels first and gives the remainder to the gimbal. Wheels are not modelled as saturating. Without wheels, a coasting stage cannot turn.

## Staging *(0.2)*

Decouplers split the stack into stages. Everything below the lowest decoupler, including the decoupler itself and the fins, is stage 1 and fires first. Only the current bottom stage's engine can run, fed by the tanks in its own stage. Upper-stage propellant is carried as full, fixed mass until that stage becomes active.

At separation:

1. The stack is cut at the lowest decoupler. The upper stage's mass m_u and centre of gravity come from its own parts. The lower stage's mass is m_l = m − m_u, and its centre of gravity follows from the moment balance about the nose.
2. Each body's position moves to its own centre of gravity along the body axis.
3. The decoupler's spring impulse J (600 N·s) acts along the body axis: Δv_u = +J / m_u, Δv_l = −J / m_l. Total momentum is conserved exactly (tested).
4. The upper stage's engine starts in the off state with its full number of ignitions. Separation never lights it; the pilot or program must.
5. If the lower stage's engine was producing thrust at the moment of separation, the flight fails with *recontact*: a still-thrusting stage accelerates into the one above.

A spent stage becomes debris: a tumbling point mass with gravity and drag (Cd·A = 1.1 A + 0.02 L d) integrated with RK4 at the same step until it reaches the ground, where its impact point is logged. Debris does not interact with the vehicle.

Separation is refused while the vehicle is still on the pad.

## Failure criteria

| Failure | Criterion |
| --- | --- |
| Structural overload | q above the weakest part's limit (120 kPa for tanks and payloads) |
| Aerodynamic break-up | q · sin α above 4,500 Pa while q above 2 kPa |
| Loss of control | α above about 44° while q above 500 Pa |
| Payload overload | Sensed acceleration above the payload's g limit |
| Insufficient thrust | Still on the pad 4 s after ignition |
| Recontact *(0.2)* | Separation while the lower stage is thrusting |

*(0.2)* Failures are checked until the vehicle is **ballistic**: past its first apogee, descending, and with no engine running, no engine it can still ignite, and no stage left to separate. In V0.1 every vehicle was ballistic at apogee, so this reproduces the V0.1 rule exactly. A multi-stage vehicle that coasts to apoapsis before its next burn is still checked. The flight report treats a break-up while falling back as a symptom and reports the underlying problem, such as not reaching orbit.

## Losses reported in the flight report

- Gravity loss: ∫ g · (v̂ · r̂) dt while the engine runs.
- Drag loss: ∫ D / m dt until the vehicle is ballistic.

## Orbital elements

Computed every step from the inertial state, assuming vacuum and a point-mass Earth:

- specific energy ε = v² / 2 − μ / r; semi-major axis a = −μ / (2ε);
- angular momentum h = x v_y − y v_x; eccentricity e = √(1 + 2 ε h² / μ²);
- apoapsis a (1 + e) − R and periapsis a (1 − e) − R, as altitudes;
- period 2π √(a³ / μ);
- time to apoapsis from the mean anomaly: E = atan2(r·v / √(μ a), 1 − r / a), M = E − e sin E.

An unbound path (ε ≥ 0) has an infinite apoapsis. While the vehicle is in the atmosphere these values ignore drag, so apoapsis is overestimated. Above about 140 km the modelled density is so low that an orbit stays unchanged for the length of a mission.

A mission's orbit objective is met when the engine is off, the vehicle is above 100 km, and the periapsis (and, if the mission sets one, the apoapsis) is inside the band.

## Coasting on rails *(0.3)*

Above 140 km the modelled drag on any AeroLab vehicle is below 10⁻⁵ m/s², so an unpowered coast follows a two-body Kepler orbit. AeroModel 0.3 advances such coasts analytically instead of with RK4. Each chunk uses the f and g functions with the eccentric-anomaly form of Kepler's equation:

  n Δt = ΔE − (1 − r₀/a) sin ΔE + (r₀·v₀ / √(μa)) (1 − cos ΔE)

This form is solved by Newton's method and stays stable for circular orbits.

Rails apply only when all of these hold:

- the vehicle is off the pad, with no engine running or igniting;
- the altitude is above 142 km, and the whole chunk stays above 140 km;
- the orbit is bound;
- there is no pilot pitch input;
- the step counter sits on a flight-computer tick.

The chunk is 1 s. It drops to one tick (0.05 s) while a flight program is steering or waiting on a condition, or while a spent stage is still falling. Attitude with reaction wheels is held exactly on target, and without them the body keeps rotating freely.

The decision uses only the simulation state, never the time warp, so a flight is bit-identical at 1× and 10,000× (tested). Over one full orbit the Kepler step matches RK4 to under 1 m. After an hour in a 200 km orbit, the rails path stays within 1 km of the full integrator, the difference being the faint drag that rails ignore. Telemetry is recorded every 5 s while on rails.

Physics versions: AeroModel 0.1 and 0.2 never coast on rails. `new Flight(design, {model: 'AeroModel 0.2'})` runs exactly as V0.2 did, and experiment reproduction replays each manifest under the model it records.

## Flight computer *(0.2)*

A flight program is a JavaScript generator run by `src/flight_computer.js`. The simulation advances it once every 5 steps (20 Hz), before that step's physics, so its commands act immediately. `yield ship.wait(s)` resumes on the first tick at or after the requested time. `yield ship.until(f)` evaluates `f` each tick.

For determinism:

- the program's `Math.random` is a seeded Mulberry32 generator;
- clocks, timers, the page and the network are hidden;
- each tick has a budget of 200,000 loop iterations and function calls. Guard calls are inserted by parsing the program with Acorn, and the insertion does not change line numbers.

A program error or budget overrun halts the program. The vehicle keeps its last commands. Commands go through the same methods as the pilot's controls.

## Known simplifications

The vehicle is rigid, with a single diameter (0.6 m) for every stage. Separation is instantaneous apart from the spring push, and stages cannot collide after separating. Flight is planar, with no yaw or roll. Earth is a sphere with point-mass gravity (no J2). There is no wind. Tanks drain proportionally. Reaction wheels never saturate. There is no heating model and no aerodynamic hysteresis. The numbers teach the right trends but are not engineering-grade predictions.

## Validation

`tests/flight-tests.js` (76 tests) checks:

- the atmosphere against US76 reference values;
- mass and the rocket equation, per stage;
- validation rules;
- momentum conservation at separation;
- orbital elements against analytic circular and elliptical orbits;
- the flight computer's error lines, loop guard, hidden globals and seeded randomness;
- every example program on its reference rocket;
- determinism of repeated programmed flights;
- the failure analysis for classic mistakes.

The baselines in `experiments/` pin the outcomes of 19 reference flights.
