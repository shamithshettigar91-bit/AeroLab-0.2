# AeroLab: project report

Status as of 28 September 2026. Version V0.2: multi-stage rockets with stage separation, a programmable flight computer, orbit, six missions, the Streamlit research dashboard, Git version control and reproducible experiments. Section 17 describes everything V0.2 added.

Attach this file at the start of any future session so work can continue from exactly this point. Section 14 has a ready-made message to paste.

---

## 1. What AeroLab is

AeroLab is a rocket and spacecraft engineering game built on one principle from the original build plan: **the simulation is the source of truth**. The vehicle drawing, the numbers, the flight view, the report, the charts and the future AI and research features all read from one simulation state. Nothing calculates physics on its own.

The long-term plan (from the original 100-section build plan) targets Unity and C#, with three kinds of user: player, AI mission team, and researcher. Development is staged: physics, rocket, flight, builder, orbit, missions, spacecraft, worlds, cognitive AI, research.

What exists today is the V0.1 slice from that plan. It is a browser prototype, built to prove the physics and the game loop before any Unity work:

> Build a vehicle, launch it, fly it, fail or succeed, read why, improve it, fly again.

**Mission 002:** carry a 10 kg science payload above 100 km (the Kármán line) with one stage and one engine.

V0.2 extends the slice to orbit. Rockets can have any number of stages. Players can write a JavaScript flight program that flies the whole mission by itself, and six missions run from 10 km to a circular orbit flown with no manual input.

---

## 2. Timeline of work so far

| Step | What was done |
| --- | --- |
| 1. Plan review | Reviewed the 100-section build plan. Kept its staging, single source of truth, "never just say FAIL" and "LLM never does physics" principles. Raised seven structural fixes (section 3). |
| 2. Simulation core | Wrote `core.js`: parts as data, US76 atmosphere, vehicle analysis, 2D flight on a rotating Earth, RK4 at 100 Hz, attitude autopilot, failure detection, flight reports. Balanced it with about 15 headless test flights before any interface existed. |
| 3. Playable game | Built the builder screen, flight screen and report screen as one self-contained HTML page. Published it as a claude.ai artifact. |
| 4. Project zip | Split the game into sources, a build script, 20 automated tests, a README and a physics document. |
| 5. Streamlit dashboard | Added a Streamlit app (Play, Flight Lab, Parameter Sweep) that drives the same JavaScript core from Python through Node, plus VS Code run, debug and task configurations. |
| 6. This report | Written as the hand-off for future sessions. |
| 7. External review | An outside review rated the concept highly and confirmed the architecture. Accepted: scope discipline, LLM kept out of control loops, AI never modifies physics directly, reproducibility before more AI. Adjusted: seeds only matter once uncertainty models exist; Unity port should be checked against golden reference results; reinforcement learning needs a faster step-by-step bridge; V0.2 orbit is equatorial only (section 15). |
| 8. Git and experiments (V0.1.1) | Put the project under Git and tagged `v0.1`. Added experiment manifests, an Experiments page, a terminal reproduce tool, 10 reproducibility tests and a committed regression baseline (section 16). |
| 9. V0.2: staging, flight computer, orbit | AeroModel 0.2 with stage separation, relightable engines, reaction wheels and orbital elements. A flight computer runs player programs deterministically. Six missions, three reference rockets, six example programs. Build/Program/Fly interface with a to-scale map view. Dashboard support for programs and a program-constant sweep. A new baseline was recorded, and the V0.1 baseline still reproduces bit for bit (section 17). |

Published game (claude.ai artifact): https://claude.ai/artifact/PccpSrP7zJHSB2DwXRLKbT

---

## 3. Design decisions and why

These came from reviewing the original plan. Keep them unless there is a strong reason to change.

1. **Simulation core has no rendering dependency.** `core.js` never touches the page, canvas or browser. This lets the same code run in the game, in Node tests and in the Streamlit dashboard, and later run thousands of research flights headlessly. In Unity this becomes a separate assembly (`.asmdef`) with no engine references.
2. **Parts are data.** Every part is an entry in `PARTS`. Adding a part means adding data, not code, just like Unity ScriptableObjects.
3. **Engine data is not overdetermined.** Engines store only vacuum thrust and two Isp values. Mass flow is derived: ṁ = T_vac / (Isp_vac · g₀). Burn time comes from the attached propellant. Storing thrust, Isp, burn time and fuel flow separately would let them contradict each other.
4. **Earth rotates.** The flight is integrated in an inertial frame, and the pad starts with about 465 m/s of eastward velocity. The atmosphere rotates with Earth, so drag uses air-relative velocity.
5. **RK4 at a fixed 100 Hz.** Explicit Euler makes orbits drift. Time warp runs more steps per frame, never bigger steps, so results do not depend on the frame rate or warp setting.
6. **Deterministic.** There is no randomness in the physics. The same design and flight plan always give the same result, which is a requirement for the planned research mode ("run again reproduces the experiment").
7. **Versioned data.** Saved designs get version labels (`Sounder_v001`, `_v002`), and saving never overwrites. The physics model versions are shown in the builder and returned by the dashboard.
8. **One language for physics.** The Streamlit dashboard does not re-implement physics in Python. It calls the JavaScript core through Node, so the two can never disagree.

Floating origin (point 6 of the original review) is not needed in the browser prototype but is required once rendering moves to Unity's float-based transforms.

---

## 4. Project structure

*V0.2 added `src/flight_computer.js`, `src/programs.js`, `vendor/acorn.js`, `docs/PROGRAMMING_GUIDE.md` and a second baseline; the README has the current tree.*

```
aerolab-v01/
├── index.html              Built game, one self-contained file (generated, do not edit)
├── src/
│   ├── core.js             Simulation core, 418 lines
│   ├── ui.js               Game interface, 494 lines
│   └── template.html       Page structure and CSS, 288 lines
├── dashboard/
│   ├── Home.py             Streamlit entry point, Play page
│   ├── sim_bridge.py       Python ↔ Node bridge, caching, chart helper
│   └── pages/
│       ├── 1_Flight_Lab.py
│       └── 2_Parameter_Sweep.py
├── tools/
│   ├── build.py            Inlines core.js and ui.js into template.html → index.html
│   └── run_flight.js       JSON-in, JSON-out runner used by the dashboard
├── dashboard/aerolab_runner.py  Plain-Python access to the Node runner (no Streamlit)
├── dashboard/experiments.py     Record, save, load, reproduce experiment manifests
├── dashboard/pages/3_Experiments.py
├── experiments/            Saved manifests; EXP-BASELINE-AeroModel-0.1.json is committed
├── tools/reproduce.py      Reproduce experiments from the terminal
├── tools/record_baseline.py  Record the regression baseline
├── tests/flight-tests.js   20 headless tests
├── tests/test_experiments.py 10 reproducibility tests
├── docs/
│   ├── PHYSICS_MODEL.md    Equations, assumptions, limits
│   └── PROJECT_REPORT.md   This file
├── .vscode/                launch.json, tasks.json, extensions.json
├── .streamlit/config.toml  Dashboard theme
├── requirements.txt        streamlit>=1.37, pandas>=2.0
├── package.json            npm run build / npm test shortcuts
├── README.md
└── .gitignore
```

**Rule:** edit only files in `src/`, then rebuild. `index.html` is overwritten by `tools/build.py`. The Streamlit Play page rebuilds automatically when `src/` is newer than `index.html`.

---

## 5. Simulation core (`src/core.js`)

### 5.1 Constants (SI units everywhere)

| Name | Value | Meaning |
| --- | --- | --- |
| `G0` | 9.80665 m/s² | Standard gravity, used for Isp |
| `MU` | 3.986004418 × 10¹⁴ m³/s² | Earth gravitational parameter |
| `RE` | 6,371,000 m | Earth radius |
| `WE` | −7.2921159 × 10⁻⁵ rad/s | Earth rotation (negative so east is +x in this frame) |
| `P0` | 101,325 Pa | Sea-level pressure |
| `RAIR` | 287.053 J/(kg·K) | Gas constant for air |
| `DIAM` | 0.6 m | Single vehicle diameter in V0.1 |
| `AREF` | π × 0.3² ≈ 0.283 m² | Aerodynamic reference area |
| `LIMITS.qAlpha` | 4,500 Pa | Bending limit, q × sin α |
| `MODEL` | AeroModel 0.1, US76-lite 1.0, PointMass 1.0, RK4 at 100 Hz | Model version labels |

### 5.2 Functions and classes

| Name | Purpose | Unity equivalent in the plan |
| --- | --- | --- |
| `PARTS` | Part definitions (section 6) | Part ScriptableObjects |
| `atmosphere(h)` | T, p, ρ, speed of sound from altitude | `AtmosphereModel.cs` |
| `buildVehicle(design)` | Places parts along the body axis, finds engine, tanks, propellant capacity, dry mass, CP, Cd₀, limits | `VehicleManager.cs` |
| `massProps(veh, prop)` | Mass, CG, moment of inertia and pitch damping for the current propellant | part of `VehicleManager.cs` |
| `analyze(design)` | Builder numbers (wet and dry mass, TWR, ΔV, burn time, CG, CP, stability margin) and validation issues | `VehicleAnalyzer.cs` |
| `orbitApo(x,y,vx,vy)` | Apoapsis altitude from orbital energy and angular momentum | `OrbitCalculator.cs` |
| `machFactor(M)` | Drag rise through the transonic region | part of `AerodynamicsModel.cs` |
| `class Flight` | Full flight simulation (5.3) | `SimulationEngine.cs` and related |
| `flightReport(f, an)` | Result, cause, evidence, contributing factors, suggested fixes | failure analysis |

A design is a plain object: `{ stack: [partIds top to bottom], fins: finId | null }`. Positions along the body are measured in metres from the nose tip, increasing aft.

### 5.3 The `Flight` class

- **State:** `x, y, vx, vy` (inertial, Earth-centred), `th` (body angle), `om` (angular rate), `prop` (propellant mass), `t`.
- **Pad:** while `clamped`, the vehicle rotates with Earth. It releases when thrust along local up exceeds weight. If it is still clamped 4 s after ignition, that is the "insufficient thrust" failure.
- **Engine state machine:** `off → ignition` (0.6 s thrust ramp) `→ running → shutdown` or `burnout`. Liquid engines throttle between 40% and 100% with a rate limit and can be cut once (no relight). Solid motors run at 100% to burnout.
- **Forces (`deriv`):** point-mass gravity; thrust with pressure-dependent Isp and gimbal angle plus a fixed 0.15° misalignment; drag along the relative wind; normal force at CP; pitch damping. Torques are computed about the current CG.
- **Integration (`step`):** RK4 over the 7-element state at dt = 0.01 s, with mass properties fixed within a step.
- **Attitude hold, "SAS" (`control`):** a PID loop on pitch above the local horizon (gains 12, 4, 7 per unit inertia) with a feed-forward that cancels the aerodynamic torque. It computes the required gimbal angle, clamped to the engine's limit and rate-limited to 20°/s. With SAS off, the pitch keys drive the gimbal directly. There is no steering without thrust, since V0.1 has no RCS.
- **Events:** ignition, lift-off, supersonic, Max Q (logged when q falls 3% below its peak), burnout or cut-off, 100 km crossed, apogee, impact.
- **Failure checks (only before apogee):** structural overload, aerodynamic break-up, loss of control (tumble), payload g-overload, insufficient thrust. Criteria are in `docs/PHYSICS_MODEL.md`.
- **Loss accounting:** gravity loss while burning, drag loss until apogee, and delivered ΔV. These feed the "fell short" report.
- **Telemetry:** recorded at 10 Hz: time, altitude, speed, sensed g, q, mass, Mach, thrust, fuel fraction, downrange.
- **Derived values (`derived`):** altitude, air-relative speed, vertical speed, q, Mach, downrange, pitch, velocity pitch, predicted apogee, current TWR.

### 5.4 Validation rules in `analyze`

Errors (block launch): no parts, no engine, more than one engine, engine not at the bottom, more than one nose, nose not at top, no payload, liquid engine without a tank, liquid engine without a flight computer.

Warnings: no nose cone (flat top, Cd 0.8); liquid tanks with a solid motor (dead weight); TWR below 1; negative stability margin (unstable), with a different message for gimballed and solid engines; margin between 0 and 1 calibre with fins (thin).

### 5.5 Flight report logic (`flightReport`)

- **Success:** peak altitude, margin, ΔV, next-step suggestion.
- **`twr`:** thrust-to-weight evidence, stronger engine or less mass.
- **`overload`:** q against the limit; throttle down between about 5 and 15 km, or use a smaller engine.
- **`breakup`:** stability margin and q. If unstable, suggest fins. If the break-up came within 8 s of burnout, explain that the gimbal lost authority at burnout.
- **`tumble`:** unstable airframe or attitude hold switched off.
- **`gforce`:** acceleration rises as propellant burns off; throttle late in the burn.
- **Fell short:** ΔV budget with gravity and drag losses, low TWR, high drag, downrange drift.
- **Ended early by the player:** say so, show predicted apogee.

---

## 6. Parts library

| id | Name | Category | Mass | Other data |
| --- | --- | --- | --- | --- |
| `nose_ogive` | Ogive nose cone | nose | 18 kg | 1.2 m, Cd 0.15, CP at 0.466 L, q limit 150 kPa |
| `nose_cone` | Conical nose cone | nose | 12 kg | 0.8 m, Cd 0.24, CP at 0.667 L |
| `payload_sci` | Science payload | payload | 25 kg | 0.6 m, 10 kg instrument, 15 g limit, q limit 120 kPa |
| `payload_heavy` | Heavy payload | payload | 85 kg | 0.9 m, 60 kg instrument, 12 g limit |
| `avionics` | Flight computer | avionics | 12 kg | 0.3 m, required for liquid engines |
| `tank_s` | Propellant tank S | tank | 40 kg | 160 kg propellant, 1.0 m, q limit 120 kPa |
| `tank_m` | Propellant tank M | tank | 70 kg | 330 kg propellant, 2.0 m |
| `tank_l` | Propellant tank L | tank | 100 kg | 500 kg propellant, 3.0 m |
| `eng_sparrow` | LR-12 Sparrow | liquid engine | 55 kg | 16 kN vac, Isp 250 / 285 s, 5° gimbal, 0.9 m |
| `eng_heron` | LR-40 Heron | liquid engine | 110 kg | 42 kN vac, Isp 262 / 298 s, 4° gimbal, 1.3 m |
| `srm_needle` | SR-9 Needle | solid motor | 140 kg | plus 600 kg propellant, 24 kN vac, Isp 228 / 252 s, 4.0 m, no gimbal |
| `fins_s` | Small fin set | fins | 10 kg | CNα 6, Cd +0.03, span 0.36 m |
| `fins_l` | Large fin set | fins | 20 kg | CNα 11, Cd +0.06, span 0.55 m |

Fins are a radial attachment at 0.45 m forward of the tail, not a stack item. The stack is limited to 8 parts.

---

## 7. Game balance: tested outcomes

These results define the intended learning path. The tests in `tests/flight-tests.js` lock most of them in, so a physics change that breaks the lessons will be caught.

| Design (nose + payload + computer + …) | Result | Lesson |
| --- | --- | --- |
| Tank M + Sparrow, no fins (the starter design) | Break-up at about 35 km, right after burnout | Unstable vehicles need fins; the gimbal only helps while the engine runs |
| Tank M + Sparrow, small fins | Success, apogee 134.5 km, max Q 63 kPa, 7.9 g | The fix |
| Tank M + Sparrow, large fins | Success, 111.5 km | More fins cost mass and drag |
| Conical nose, tank M + Sparrow, small fins | Success, 103.3 km | Nose shape matters |
| Tank S + Sparrow, small fins | Falls short, 20 km, drag loss about 1,100 m/s | Light vehicles lose badly to drag |
| Tank M + Sparrow, no fins, attitude hold off | Tumbles within 3 s | Instability without control |
| Heavy payload, tank M + Sparrow | Falls short, 85 km | Payload mass costs ΔV |
| Heavy payload, tank L + Sparrow | Success, 168 km | Add propellant |
| Tank L + Heron, full throttle | Structural overload at 4 km | Too much thrust in thick air |
| Tank L + Heron, 45% throttle from 3 to 20 km | Success, 214 km, peak 15 g | Throttle through max Q |
| Tank M + Heron | Overload | |
| Needle solid, no fins | Tumbles | |
| Needle solid, small fins | Falls short, 67.5 km, drifts 337 km west | Weathercocking and gravity turn |
| Needle solid, large fins | Success, 120.8 km | |
| Heavy payload, tanks L + M + Heron | Success, 304 km | |

ΔV guide shown in the builder: about 2,500 m/s for a vertical flight to 100 km (`DV_NEEDED` in `ui.js`).

---

## 8. Game interface (`src/ui.js`, `src/template.html`)

### 8.1 Builder screen

- Left: parts palette grouped by category. Clicking a part adds it where it belongs (nose on top, engine at the bottom, others in category order).
- Centre: canvas drawing of the vehicle on a drawing-sheet grid, with CG (full and empty) and CP markers and a length dimension. Clicking a part selects it, and an inspector below shows its note.
- Right: mission brief, the stack list (move up or down, remove), fins row, engineering table with colour-coded status, a ΔV bar with the 2,500 m/s mark, the checks list, and model versions.
- Bottom bar: design name, "Save version", "Load design", launch button (disabled with a count of errors).
- Local storage keys: `aerolab.v01.current` (autosave), `aerolab.v01.designs` (versioned list), `aerolab.v01.missionDone`.

### 8.2 Flight screen

- Canvas view: sky that darkens with altitude, stars above 25 km, Earth's limb and atmosphere glow above 6 km, launch pad and tower near the ground, airflow streaks whose density follows air density and whose direction shows the relative wind, the vehicle rotated to its real pitch, an exhaust plume that widens as pressure drops, a velocity marker, camera shake scaled with q (off if the system prefers reduced motion), and an explosion on failure.
- HUD: mission time, large altitude, readouts (velocity, vertical speed, acceleration, Mach, q with a bar against the limit, angle of attack, pitch and held pitch, thrust, TWR, mass, propellant with a bar, predicted apogee, downrange), objective chip, trajectory inset, event log.
- Controls: Ignite (Space), Cut engine (X), throttle slider 40–100% (W and S), pitch buttons (A and D, or arrows), attitude hold (T), time warp 1×, 2×, 5×, 10×, 25× (comma and full stop), End flight (Esc).
- The loop runs up to 4,000 fixed steps per frame, updates the HUD every third frame, and drops warp to 1× when the flight ends.
- After apogee a banner offers the report. The report opens automatically after impact or failure.

### 8.3 Report screen

Verdict, cause, evidence, contributing factors, next steps, four headline stats, and a telemetry chart with channel chips, target and limit lines, and a hover readout. Buttons: Fly again, Back to builder.

### 8.4 Visual design tokens

Dark: background `#16233A`, panel `#1D2E4A`, line `#34507A`, text `#E7EDF4`, accent amber `#F2A541`, good `#6CC4A1`, caution `#E9C46A`, bad `#EE6A55`, data cyan `#8FD3F4`. A light palette is also defined. The theme follows the system unless `data-theme` is set on `<html>`. Fonts: Barlow and Barlow Condensed from Google Fonts, with system fallbacks. The layout switches to a single column below 900 px.

---

## 9. Streamlit dashboard

Run from the project root: `streamlit run dashboard/Home.py`, or press F5 in VS Code and choose "AeroLab: Streamlit dashboard".

| Page | What it does |
| --- | --- |
| Home (Play) | Embeds the built game with `components.html`. Sidebar: game height, colour theme (injects `data-theme`), rebuild button, controls help, Node check. |
| Flight Lab | Dropdown design editor (nose, payload, computer, up to three tanks, engine, fins), flight plan (attitude hold, optional throttle band, stop at apogee), live engineering metrics and issues, headless flight, report, event log, Altair charts per channel with target and limit lines, telemetry CSV download. Stores the design in `st.session_state["lab_design"]` for the sweep page. |
| Parameter Sweep | Uses the Flight Lab design as a base. Three sweep types: throttle level through a max Q band, tank combinations, and every engine × fin option. Shows a success count, a chart (line for throttle, bars coloured by outcome with a dashed 100 km line), a results table and CSV download. |

### 9.1 Bridge protocol (`tools/run_flight.js`)

One JSON request on stdin, one JSON response on stdout.

```
{"cmd":"parts"}                     → {"parts": PARTS, "model": MODEL}
{"cmd":"analyze","design":{...}}    → analysis summary with issues
{"cmd":"fly","runs":[{
   "design": {...},
   "sas": true,
   "throttlePlan": [{"from": 3000, "to": 20000, "throttle": 0.45}],
   "telemetry": true,
   "stopAtApogee": true,
   "maxTime": 900
}]}                                 → {"results": [...], "model": MODEL}
```

Each result holds `analysis`, `report`, `success`, `apogee`, `max`, `loss`, `failure`, `events`, `liftoffT` and, if requested, `telemetry`.

### 9.2 `sim_bridge.py`

`parts()`, `model()`, `analyze(design)` and `fly(runs)` call Node and are cached with `st.cache_data`. The cache key includes the modification time of `src/` and the runner, so edits invalidate it. Also: `build_game()`, `game_html()` (rebuilds when stale), `make_design(...)`, `telemetry_frame(result)` and `channel_chart(...)`. If Node is missing, the page shows install instructions and stops.

### 9.3 VS Code files

- `launch.json`: "AeroLab: Streamlit dashboard" (debugpy, module streamlit, run on save) and "AeroLab: flight tests (Node)".
- `tasks.json`: install Python packages, run dashboard, build game (default build task), test (default test task).
- `extensions.json`: recommends the Python and Python Debugger extensions.

---

## 10. Tests

`npm test` runs everything: the 76 core tests, the 10 reproducibility tests and a reproduction of every saved experiment. Each can also run on its own (`node tests/flight-tests.js`, `python tests/test_experiments.py`, `python tools/reproduce.py --all`). All 86 tests pass and both baselines reproduce exactly.

Core tests (`tests/flight-tests.js`):

- Atmosphere: sea-level density, 11 km pressure and temperature, sea-level speed of sound, against US76 values.
- Analysis: validity, mass sum (520 kg), rocket equation, stable with fins, unstable without, and three validation errors.
- Flights: the eight scenarios marked in section 7.
- *(V0.2)* Staging analysis and validation (10 tests):
  - per-stage rocket equation;
  - total ΔV as the sum of the stages;
  - the reference designs are valid;
  - the rules for the computer, payload, decoupler, engine and tank placement.
- *(V0.2)* Separation physics (9 tests):
  - refused on the pad;
  - mass split exactly between the stages;
  - momentum conserved to 1 part in 10⁹;
  - the stages move apart;
  - the upper stage starts fresh;
  - the fins leave with stage 1;
  - recontact when separating while firing, and its report;
  - the Kestrel allows exactly 3 ignitions.
- *(V0.2)* Orbital elements against analytic orbits (6 tests).
- *(V0.2)* Flight computer (12 tests):
  - compile errors and their line numbers;
  - runtime error line;
  - the vehicle survives a program crash;
  - an infinite loop is halted;
  - hidden globals;
  - seeded randomness;
  - wait timing;
  - yield forms.
- *(V0.2)* Every example program completes its mission on its reference rocket (9 flights, including M004–M006 orbits). Also: the Heron survives max Q under the throttle program; M005's orbit is within its band; the spent stage is tracked to impact; programmed flights are deterministic.
- *(V0.2)* Mission rules and failure analysis (6 tests): an unlit stage 2, a manual input in the hands-off mission, skipping circularisation, and the orbit ΔV budget.

Reproducibility tests (`tests/test_experiments.py`): manifest schema and ID, recorded outcomes, core hash, save, refusal to overwrite, load round-trip, exact reproduction, no false code-change warning, a changed result is caught, a tiny difference counts as within tolerance.

Run the tests after every change to `core.js`. If a test fails after a deliberate physics change, update the test and record the change in section 13.

---

## 11. Known limitations and small issues

Physics simplifications (deliberate for V0.1):
- 2D planar flight, equatorial launch site, no yaw or roll.
- One diameter (0.6 m), one stage, rigid body, proportional tank draining.
- No wind, no aerodynamic heating, no recovery system.
- Predicted apogee assumes vacuum, so it overestimates in the lower atmosphere.
- Heavily finned solid rockets drift far downrange (weathercocking plus gravity turn). This is physically plausible but large.
- Light vehicles show very high drag losses (about 1,100 m/s for tank S).

Interface issues worth fixing:
- Ignition and lift-off both show T+0.0 in the in-game event log, because events are labelled only once lift-off time is known. The Flight Lab event log shows the correct −0.2 s.
- In Streamlit, the player must click inside the game before it receives key presses.
- Saved designs live in browser local storage, so designs saved in the standalone `index.html` and in the Streamlit Play page are separate.
- Fonts need an internet connection; without it the system fallback is used.
- The published artifact and the zip may drift apart if one is updated without the other.
- The Experiments page lists the baseline first because of alphabetical sorting.

New with V0.2:
- **Every stage has the same 0.6 m diameter**, so the Orbiter is 23 m tall and very slender. Orbit needs about 9 km/s, which forces long stacks. Parts with different diameters would make orbital rockets look and fly more realistically.
- **There is no analytic "on rails" coasting.** Every second is integrated with RK4, so time warp stops at 100×, where one orbit takes about 53 real seconds. The plan's Kepler propagation for coasts is still to do.
- **Reaction wheels never saturate** and cost no power, and there is no RCS. Turning while coasting is therefore free.
- **Debris does not collide with the vehicle after separation.** Recontact is judged only at the moment of separation.
- **Runner flights with a program or mission stop 2 s after the outcome is known.** Their "apogee" is then the highest point so far, not the true apogee. For example, the Twin records 505.4 km in the baseline, but its full apogee is about 950 km.
- **A re-entry break-up is labelled by its failure kind.** In sweep tables it shows as, for example, "Failed: tumble", while the report's cause correctly says the vehicle did not reach orbit.
- **The published artifact page may block player code.** A published page's security settings may forbid running code built at runtime. The game detects this and says so on the Program tab. The local `index.html` and the Streamlit Play page are unaffected.
- **Streamlit 1.64 warns about deprecated calls**: `use_container_width` and `st.components.v1.html`. They still work. Replace them with `width="stretch"` and `st.iframe` when the minimum Streamlit version is raised.
- **Audio starts only after a click or key press** (browser autoplay policy), and it pauses when the tab is hidden. Sound in near-vacuum is kept faint on purpose, as structure-borne rumble rather than silence.
- **Flight programs are guarded for determinism, not security.** Deliberately hostile code could still reach browser globals through tricks. Run programs you trust.

Found with the new reproducibility tool:
- **Solid-motor results are highly sensitive to the fixed thrust misalignment.** Changing it from 0.15° to 0.16° moved "Solid, large fins" from 120.8 to 106.4 km and "Solid, small fins" from 67.5 to 52.3 km, while the liquid designs, which attitude hold corrects, moved by centimetres. The solid-motor lesson therefore depends on an arbitrary constant. This is the first strong candidate for a Monte Carlo study once uncertainty models exist, and a reason to treat the solid-motor outcomes as indicative rather than precise.

---

## 12. Roadmap: what comes next

Done since V0.1: Git with tags `v0.1`, `v0.1.1` and `v0.2`; experiment manifests with reproduction (the review's "Experiment 3"); V0.2 staging, orbit, missions 001 to 006 and the flight computer (section 17).

From the original plan's order, the next stages are:

1. **Done in V0.2:** staging, orbit (equatorial), the map view, missions 001 to 006 as data, and the flight computer.
2. **V0.3, orbit operations.** Analytic Kepler propagation for coasts, so time warp can reach 1,000× and beyond. Orbit-change missions such as raising to 400 km or a Hohmann transfer, which the Kestrel's three ignitions already allow. De-orbit and re-entry heating.
3. **Parts with different diameters,** with interstage adapters. Aerodynamics would then use the widest part, and the first stage could be wider.
4. **Recovery.** Parachutes, landing legs, a descent and landing check.
5. **Research features.** Monte Carlo with uncertainty models, experiment objects storing seed, versions and parameters, reproducible reruns. The dashboard's sweep page is the foundation.
6. **Unity port.** Move `core.js` to C# in a no-engine assembly, parts to ScriptableObjects, the builder and flight view to Unity scenes, and add a floating origin. The flight tests become Unity EditMode tests with the same expected results.
7. **Later:** spacecraft systems (power, thermal, communication, electric propulsion), Moon and Mars, rovers, cognitive NPC mission team, AI assistants.

Smaller improvements that fit any time:
- reaction control thrusters and wheel saturation;
- wind;
- a telemetry CSV download inside the game;
- syntax highlighting and autocomplete in the program editor;
- a program library shared between the game and the dashboard;
- fixing the issues in section 11.

---

## 13. Change log

| Version | Date | Changes |
| --- | --- | --- |
| V0.1 | 27 Sep 2026 | First playable build: builder, flight, report. Simulation core AeroModel 0.1. 13 parts. Mission 002. |
| V0.1 + dashboard | 27 Sep 2026 | Streamlit dashboard (Play, Flight Lab, Parameter Sweep), Node bridge, VS Code configs, 900 px layout breakpoint, theme injection. |
| V0.1.1 | 27 Sep 2026 | Git repository, tag `v0.1`. Experiment manifests (schema `aerolab.experiment/1`), Save experiment on the sweep page, Experiments page with reproduce, `tools/reproduce.py`, `tools/record_baseline.py`, committed baseline `EXP-BASELINE-AeroModel-0.1`, 10 reproducibility tests. Physics unchanged (still AeroModel 0.1). |

| V0.2 | 28 Sep 2026 | **AeroModel 0.2** (physics).<br>• Stage decouplers and momentum-conserving separation, spent stages tracked to impact, recontact failure.<br>• Engine ignition counts and relights; reaction wheels; attitude modes for pitch, surface prograde, orbital prograde and retrograde.<br>• Orbital elements; the failure window changed from "until apogee" to "until ballistic", identical for V0.1 designs.<br>• 6 new parts: Condor, Kestrel, carbon tanks C3 and C5, reaction wheels, decoupler.<br>**Flight computer** (`flight_computer.js`): generator programs at 20 Hz, Acorn loop guards, seeded `Math.random`, hidden globals, error lines, and a `ship` API with 10 commands and 45 readings.<br>**Content:** missions M001–M006 as data; reference rockets Sounder, Twin and Orbiter; 6 example programs.<br>**Interface:** Build and Program tabs, stage-aware builder with a per-stage table, code editor, instant test flight, staging and program control in flight, to-scale map view, staging timeline in the report, warp up to 100×.<br>**Dashboard:** multi-stage stack editor, program control, program-constant sweep, legacy digest for pre-V0.2 manifests.<br>**Tests and baselines:** 76 core tests; baseline `EXP-BASELINE-AeroModel-0.2` (19 cases). The V0.1 baseline still reproduces bit for bit. |

| V0.2.1 | 28 Sep 2026 | **Sound and effects** (`src/effects.js`, presentation only; physics, tests and baselines unchanged).<br>• Sound, all synthesised with Web Audio (no files): engine roar, solid-motor crackle, low rumble and wind, all shaped by thrust, air pressure and dynamic pressure; one-shot sounds from the event log for ignition, separation, cut-off, sonic boom and the mission chime; explosion sounds; a master-caution alarm above 85% of the structural, g or bending limit, with a blinking HUD badge.<br>• Visual effects: a particle explosion (flash, fireball, sparks, smoke, the vehicle's own parts tumbling with embers), a dust cloud on ground impact, screen shake, a separation flash and vented gas, pad smoke, and an exhaust trail in the lower atmosphere.<br>• A Sound button and the N key, remembered in local storage. The report now waits 2.8 s so the explosion can play. Reduced-motion users get no shake and lighter effects. |

Add a row here for every future update.

---

## 14. How to continue in a new session

Attach this file (and the project zip if you want code changes made directly), then paste:

> This is my AeroLab project. The attached PROJECT_REPORT.md describes everything built so far: the architecture, the simulation core, the parts, the tested balance, the game interface, the Streamlit dashboard and the roadmap. Keep the design decisions in section 3. Next I want to: **[describe the update, for example "add staging for V0.2"]**. Update the code, keep the tests passing (add tests for new behaviour), and update this report's change log.

Working rules to keep:
- Physics changes go only in `src/core.js`; the interface and dashboard read state and never compute physics. The flight computer (`src/flight_computer.js`) may only call the same `Flight` methods as the pilot's controls.
- Reference rockets and example programs live in `src/programs.js`. Every example must stay covered by a test in `tests/flight-tests.js`.
- New parts are data entries in `PARTS`.
- SI units internally; conversion only for display.
- Rebuild with `python3 tools/build.py` and run `npm test` after every change. The build refuses files with syntax errors.
- Bump the `MODEL` version string whenever the physics changes, so old results stay traceable.
- After any physics change, run `python tools/reproduce.py --all`. If the change was intended, commit it, bump the model version and run `python tools/record_baseline.py` to record a new baseline. Keep the old baseline file.
- Commit before recording experiments, so each manifest points at a clean Git commit.

---

## 15. External review: decisions taken

An outside review of the project (September 2026) was assessed. Decisions:

- **Accepted:** single-player first; one simulation core shared by game and research; LLMs only for conversation, explanation and planning, never inside control loops; AI issues commands and never changes physics directly; every AI decision should carry a reason and evidence; NPC decisions at different rates (flight control fast, background agents slow); a first AI agent should be one Flight Dynamics Officer using rules and utility scoring, not a team.
- **Adjusted:** random seeds become meaningful only when uncertainty models are added, since V0.1 has no randomness. The Unity port should pass against golden reference results exported from the JavaScript engine (for example apogee within 0.1% for every baseline case). Reinforcement learning needs a persistent, step-by-step simulation process; the one-flight-per-call runner is only suitable for sweeps. V0.2 orbit is equatorial, because the simulation is planar.
- **Open questions that decide the architecture:** what "people thinking" means (react, have goals, reason about engineering, learn, collaborate, run experiments); the primary research question; the primary audience. Record the answers here once chosen.

---

## 16. Experiments and reproducibility (V0.1.1)

**Manifest** (`dashboard/experiments.py`, schema `aerolab.experiment/1`), saved as `experiments/<experimentId>.json` and never overwritten:

- `experimentId` (`EXP-YYYYMMDD-HHMMSS-xxxx`, or `EXP-BASELINE-…`), `name`, `kind`, `notes`, `createdAt` (UTC)
- `model`: the `MODEL` versions from `core.js`
- `code`: SHA-256 of `core.js` and `run_flight.js`, Git commit, tag description, and whether `src/` or `tools/` had uncommitted changes
- `runtime`: Node version, Python version, platform
- `runs`: for each run, `runId`, `label`, the exact `request` sent to the runner, `requestSha256`, `outcome`, `apogee_m`, `maxQ_Pa`, `maxG` and `resultSha256`
- `manifestSha256`: hash of the whole record

**Result fingerprint:** SHA-256 over success, apogee, maxima, losses, failure, events and a SHA-256 of the full telemetry. Telemetry is hashed rather than stored, so manifests stay small but any change anywhere in the flight is detected.

**Reproduce:** reruns every stored request against the current code with no cache, then reports each run as *identical* (same fingerprint), *within tolerance* (same outcome and apogee within one part per million) or *different*. It also warns if the core hash or model version changed since recording. The overall verdict is "reproduced exactly", "reproduced within tolerance" or "not reproduced". `tools/reproduce.py` exits with code 1 when anything is not reproduced, so it can gate commits.

**Cross-machine note:** results should be bit-identical on the same Node version. V8's maths functions are consistent across platforms, but a different Node major version could in principle change the last digits, which is what the tolerance level is for.

**Baseline:** `experiments/EXP-BASELINE-AeroModel-0.1.json` holds the eleven learning-path designs from section 7, recorded from clean commit `45fc52c`.


---

## 17. V0.2: staging, flight computer and orbit

### 17.1 What the player does

1. Pick a mission from the top-right menu.
2. Build a rocket on the Build tab, or load a reference rocket.
3. Write or load a flight program on the Program tab, and check it with **Test flight**, which flies the whole mission instantly.
4. Watch the flight, or fly manually.
5. Read the report.

A mission can be completed by hand or by program, except M006, which forbids manual input.

### 17.2 Design decisions

| Decision | Why |
| --- | --- |
| Stages are defined by decouplers in the one stack, not a separate stage editor | The V0.1 stack UI carries over. A design stays one list of part ids, so saves, experiments and the dashboard needed no new format. |
| The decoupler and the fins leave with the lower stage | This matches real interstages and keeps the rule simple: everything below the lowest decoupler goes. |
| Separation never lights the next engine | Real vehicles sequence these separately. Forgetting to ignite is a lesson in its own right, and the report names it. |
| Recontact if the lower stage is still firing | This is the most common staging mistake. It is detected at the one moment it can happen, with no collision model needed. |
| Programs are generators with `yield` | Sequential code reads like a flight plan (wait until burnout, stage, ignite), yet runs deterministically inside fixed simulation ticks. No threads or timers are involved. |
| 20 Hz program rate, before the physics step | This is a realistic flight-computer rate. Commands take effect in the same step, so results do not depend on frame rate or warp. |
| Acorn guards instead of a Web Worker | A worker could be killed on a hang, but would make the sim asynchronous and harder to reproduce. Inserted guards halt runaway loops synchronously, and they keep line numbers, so errors point at the right line. |
| Seeded `Math.random`, hidden `Date` and timers | Programs must produce identical flights everywhere, or experiments lose their meaning. |
| V0.1 arithmetic preserved exactly | The new features only add terms when they are active, such as wheel torque, which is zero for V0.1 designs. The V0.1 learning path and its baseline therefore stay valid, and old experiments still reproduce bit for bit. |

### 17.3 Balance: tested outcomes (AeroModel 0.2)

The 11 V0.1 cases in section 7 are unchanged. The new baseline adds these eight:

| Case | Outcome |
| --- | --- |
| Twin, staging program (M003) | Success. Separates at about 35 km (q ≈ 6 kPa); apogee about 950 km |
| Twin, stage 2 never lit | Tumble, just after separation at 37 km |
| Twin, separated 20 s into the burn | Recontact at 2.4 km |
| Orbiter, coast and circularise (M004, M005) | Success, 193.1 × 200.3 km orbit, 29 kg left in stage 2 (about 600 m/s) |
| Orbiter, direct insertion (M005) | Success, about 190 × 197 km |
| Orbiter, no circularisation (M004) | Falls back; break-up on re-entry, reported as not reaching orbit |
| Sounder, hello program (M002) | Success, same trajectory as the manual flight (134.5 km apogee) |

Reference rockets:

| Rocket | Stage 1 | Stage 2 | Total ΔV (vacuum) | Lift-off TWR |
| --- | --- | --- | --- | --- |
| Sounder | Sparrow, tank M, small fins | — | 2,814 m/s | 2.75 |
| Twin | Heron, 2 × tank L, small fins | Sparrow, tank M | about 5,190 m/s | 2.04 |
| Orbiter | Condor, C5 + C5 + C3, small fins | Kestrel, C5, reaction wheels | 9,567 m/s (3,059 + 6,507) | 1.70 (stage 2: 1.16 in vacuum) |

### 17.4 Findings while balancing

- **Orbital prograde is the wrong pointing in the atmosphere.** Right after separation at 40–50 km, holding orbital prograde turned the finless upper stage several degrees off the airflow, because the air moves with Earth at about 465 m/s. The stage tumbled every time. Switching to surface prograde fixed it. The finding is built into the examples and the programming guide.
- **Separation altitude matters.** A Twin variant with less first-stage propellant separates at 28 km (q ≈ 16 kPa). It survives with small fins on stage 1 but breaks up with large ones.
- **A low-thrust upper stage makes coast-and-circularise inefficient** unless the turn is shallow. At 9.5 kN the Kestrel wasted too much ΔV to gravity. It was raised to 12 kN, a realistic value for a 30 kg vacuum engine.
- **The gravity-turn end pitch has a wide working band.** Sweeping `END_PITCH` from 10° to 50° on the Orbiter (M004):
  - 20° to 45° reaches orbit; 20° to 30° gives near-circular orbits;
  - 10° to 15° is too flat, reaching only 77–109 km periapsis;
  - 50° is too steep, with periapsis at −40 km.
- **Guidance quality matters but is not a knife-edge.** In a grid of 72 guidance variants on the Orbiter, 26 reached the M005 circular band.

### 17.5 New and changed files

- `src/flight_computer.js`: program compilation, guards and the `ship` API.
- `src/programs.js`: reference rockets and example programs.
- `vendor/acorn.js`: parser, MIT licence in `vendor/ACORN-LICENSE.txt`.
- `docs/PROGRAMMING_GUIDE.md`: how to write flight programs.
- `experiments/EXP-BASELINE-AeroModel-0.2.json`: the new baseline.
- `tools/run_flight.js`: new run options `mission`, `program` and `seed`, and new `catalog` and `check` commands.
- `dashboard/experiments.py`: `legacy_digest` for manifests recorded before V0.2.
