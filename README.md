# AeroLab V0.2

Build. Simulate. Explore. Design multi-stage rockets, program their flight computers in JavaScript, and fly them to orbit. The physics is a real simulation, so a rocket reaches orbit only when both the design and the program are right.

## What is new in V0.2

- **Multi-stage rockets.** Stage decouplers split the stack into stages. Separation follows the physics: the springs push the stages apart, momentum is conserved, and the spent stage falls on its own path to an impact point.
- **Programmable flight computer.** Write a JavaScript flight program that ignites, throttles, steers and stages the rocket by itself. Six example programs come with the game; all of them are flown by the automated tests. See [docs/PROGRAMMING_GUIDE.md](docs/PROGRAMMING_GUIDE.md).
- **Orbit.** The HUD shows apoapsis, periapsis, orbital speed and time to apoapsis. A to-scale map view shows the orbit around Earth.
- **New parts:**
  - LR-60 Condor first-stage engine.
  - RV-9 Kestrel vacuum engine, with three ignitions.
  - Carbon tanks C3 and C5.
  - Reaction wheels, for turning while coasting.
  - Stage decoupler.
- **Six missions,** from 10 km to a circular orbit flown with no manual input.
- **Failure analysis for staging and orbit:**
  - separating while the lower stage is still firing, or too low in the air;
  - an unlit upper stage;
  - coasting past apoapsis without circularising;
  - the ΔV budget of an orbit attempt.
- **V0.1 is preserved exactly.** All eleven V0.1 baseline flights reproduce bit for bit under the new physics version.

## Play

Open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari). No install or server is needed. Everything runs offline except the Barlow and JetBrains Mono web fonts, which fall back to system fonts without a connection.

1. **Pick a mission** in the top-right menu. Each mission names a reference rocket you can load with one click.
2. **Build** on the Build tab. Parts stack top to bottom. Use *Add a stage below* for a multi-stage rocket, and the *Tanks and engines go into* buttons to choose which stage new parts join. The engineering panel shows ΔV, thrust-to-weight and burn time for every stage, and the checks list tells you what to fix.
3. **Program** on the Program tab, or fly by hand. Load an example, press **Test flight** to fly the whole mission instantly, then **Watch this flight**.
4. **Launch.** Press **Go to launch pad**. With a program, press Space to start it. The report after the flight explains what happened and what to try next.

| Mission | Objective | Reference rocket |
| --- | --- | --- |
| M001 First flight | Payload above 10 km | Sounder |
| M002 Edge of space | Payload above 100 km | Sounder |
| M003 Two stages | Two or more stages, payload above 500 km | Twin |
| M004 Orbit | Periapsis above 150 km, engine off | Orbiter |
| M005 Circular orbit | Periapsis and apoapsis between 180 and 220 km | Orbiter |
| M006 Hands off | M004 with the program alone; any manual input fails | Orbiter |

Flight controls (manual flight, or after *Take manual control*):

| Key | Action |
| --- | --- |
| Space | Ignite, or start the flight program |
| G | Separate the spent stage |
| W / S | Throttle up / down (liquid engines, 40–100%) |
| A / D or ← / → | Pitch west / east |
| X | Cut engine |
| M | Map view; scroll to zoom |
| , / . | Time warp down / up (1× to 100×) |
| Esc | End flight and open the report |

The attitude menu holds a pitch angle, surface prograde (along the airflow) or orbital prograde. While a program is flying, the manual controls are locked; **Take manual control** stops the program. The on-screen buttons do the same things on touch devices.

## Run with Streamlit in VS Code

The Streamlit dashboard wraps the game and adds research pages:

- **Play:** the game itself, embedded.
- **Flight Lab:** pick a mission, build any vehicle (a stack editor for multi-stage rockets, or the V0.1 single-stage form), and fly it manually or with a flight program. Then read the report, chart any telemetry channel against its limit, and download the CSV.
- **Parameter Sweep:** fly many variations in one go. Sweep a constant in your flight program, such as the gravity-turn end pitch. For single-stage designs you can also sweep the throttle through max Q, tank combinations, or every engine with every fin set.
- **Experiments:** reproduce saved experiments and check that nothing has drifted.

Setup, once:

1. Install Python 3.10+ and Node.js 18+. Check with `python --version` and `node --version` in a new VS Code terminal.
2. Install the VS Code Python extension (VS Code suggests it when you open the folder).
3. Open the project folder (`aerolab-v02`) in VS Code (File → Open Folder).
4. Create a virtual environment: Ctrl+Shift+P → *Python: Create Environment* → Venv, and tick `requirements.txt`. Or in the terminal:

   ```
   python -m venv .venv
   .venv\Scripts\activate        (Windows)
   source .venv/bin/activate      (macOS / Linux)
   pip install -r requirements.txt
   ```

Run it, any of three ways:

- Press **F5** and choose *AeroLab: Streamlit dashboard*. This also lets you set breakpoints in the Python files.
- Ctrl+Shift+P → *Tasks: Run Task* → *AeroLab: run dashboard*.
- In the terminal: `streamlit run dashboard/Home.py`

The dashboard opens at http://localhost:8501. Always run it from the project root so the paths resolve.

How it connects: Python never re-implements the physics. Every analysis and flight in the dashboard goes to Node through `tools/run_flight.js`, which drives the same `src/core.js` and `src/flight_computer.js` the game uses. The game, the tests and the dashboard therefore always give identical results. For example, the Orbiter's reference program reaches the same 193.1 × 200.3 km orbit in all three. When you edit anything in `src/`, the Play page rebuilds `index.html` automatically and the analysis caches refresh.

## Experiments and reproducibility

A sweep on the Parameter Sweep page can be saved as an **experiment**. The manifest (JSON, in `experiments/`) records:

- the exact flight requests, including the full source of any flight program and its random seed;
- the physics model versions;
- the code version: Git commit, tag, an uncommitted-changes flag, and a SHA-256 hash of the core and the runner;
- the runtime: Node, Python and platform;
- a SHA-256 fingerprint of every result, including its full telemetry.

Experiments are never overwritten.

The **Experiments** page lists saved manifests, or accepts an uploaded one. It shows the record and reruns it without any cache. Each run is reported as one of:

- **identical**;
- **within tolerance**: same outcome, apogee within one part per million;
- **different**.

It warns if the simulation core or model version has changed since recording.

From the terminal:

```
python tools/reproduce.py --all            reproduce every saved experiment
python tools/reproduce.py experiments/EXP-….json
```

Two regression baselines are committed:

- `experiments/EXP-BASELINE-AeroModel-0.1.json` holds the eleven designs of the V0.1 learning path.
- `experiments/EXP-BASELINE-AeroModel-0.2.json` holds those eleven plus eight V0.2 flights: staging, orbit, and three deliberate mistakes.

Both reproduce exactly. V0.2 added telemetry channels, so an older manifest is also compared in its original format, with telemetry limited to the V0.1 channels. That is how the V0.1 baseline can prove bit-for-bit reproduction under AeroModel 0.2. After any physics change, `reproduce.py --all` shows exactly which outcomes moved. If a change is intentional, bump the model version in `core.js` and record a new baseline with `python tools/record_baseline.py`.

## Project layout

```
aerolab-v02/
├── index.html              Built game, one self-contained file
├── src/
│   ├── core.js             Simulation core: parts, missions, atmosphere, staging, orbit, flight, failure analysis
│   ├── flight_computer.js  Runs player flight programs: parse, guard, seed, and the ship API
│   ├── programs.js         Reference rockets and example flight programs (data)
│   ├── ui.js               Builder, program editor, flight view, map, reports (reads state only)
│   └── template.html       Page structure and styles
├── vendor/acorn.js         JavaScript parser used to check and guard programs (MIT licence)
├── dashboard/
│   ├── Home.py             Streamlit entry point, Play page
│   ├── sim_bridge.py       Streamlit bridge: caching, chart helpers
│   ├── aerolab_runner.py   Plain-Python access to the Node runner
│   ├── experiments.py      Record, save, load and reproduce experiments
│   └── pages/              Flight Lab, Parameter Sweep, Experiments
├── experiments/            Saved experiment manifests (JSON), including both baselines
├── tools/
│   ├── build.py            Syntax-checks src/ and combines it into index.html
│   ├── run_flight.js       JSON-in, JSON-out runner for the core
│   ├── reproduce.py        Reproduce experiments from the terminal
│   └── record_baseline.py  Record the regression baseline for the current model
├── tests/
│   ├── flight-tests.js     75 headless tests of the core and flight computer
│   └── test_experiments.py 10 reproducibility tests
├── docs/
│   ├── PROGRAMMING_GUIDE.md How to write flight programs, from hello to orbit
│   ├── PHYSICS_MODEL.md    Equations, assumptions and limits
│   └── PROJECT_REPORT.md   Full hand-off report: decisions, balance, change log
├── .vscode/                Run/debug configurations and tasks
├── .streamlit/config.toml  Dashboard theme
├── requirements.txt        Python packages
└── package.json            npm shortcuts for build and test
```

## Develop in VS Code

1. Open the project folder in VS Code.
2. Edit files in `src/`. Never edit `index.html` directly, because the build overwrites it.
3. Rebuild with `python tools/build.py` (or `npm run build`, or the *AeroLab: build game* task). The build syntax-checks every source file first.
4. Refresh `index.html` in the browser.
5. Run `npm test` before every commit. It runs the 75 core tests, the 10 experiment tests, and reproduces both baselines. Or run the *AeroLab: test* task.

Requirements: Python 3 for the build, Node.js 18 or later for the tests.

## Architecture

The simulation core is the single source of truth. `core.js` has no knowledge of the page. It never touches the DOM or a canvas, so the same code runs in the browser, in the Node tests and behind the dashboard. `ui.js` only reads simulation state and sends player commands. The flight computer sends commands through the same methods as the buttons, so a program cannot do anything a pilot could not.

| Piece | Role | Unity equivalent from the build plan |
| --- | --- | --- |
| `PARTS`, `MISSIONS` | Parts and missions as data | `ScriptableObject` assets |
| `atmosphere(h)` | Temperature, pressure, density, speed of sound | `AtmosphereModel.cs` |
| `stageSegments`, `buildVehicle`, `massProps` | Stages, stack positions, mass, CG, inertia, CP | `VehicleManager.cs`, `StageManager.cs` |
| `analyze(design, mission)` | Builder numbers, per-stage ΔV, validation messages | `VehicleAnalyzer.cs` |
| `Flight` | State, forces, RK4, engine state machine, attitude hold, staging, events, failures, telemetry | `SimulationEngine.cs`, `EngineController.cs`, `FlightController.cs`, `FailureManager.cs`, `TelemetryRecorder.cs` |
| `Debris` | Spent stages falling to their impact point | Debris tracking |
| `orbitElements` | Apoapsis, periapsis, eccentricity, period, time to apoapsis | `OrbitCalculator.cs` |
| `FlightComputer` (`flight_computer.js`) | Runs player programs deterministically at 20 Hz | Flight-software sandbox |
| `flightReport` | Cause, evidence, factors and fixes | Failure analysis |

All internal units are SI: kg, m, s, N, Pa, K, rad. Conversion to km, kN and degrees happens only in the UI.

## Parts

| Part | Mass | Key figures |
| --- | --- | --- |
| Ogive nose cone | 18 kg | Cd 0.15, 1.2 m |
| Conical nose cone | 12 kg | Cd 0.24, 0.8 m |
| Science payload | 25 kg | 10 kg instrument, 15 g limit |
| Heavy payload | 85 kg | 60 kg instrument, 12 g limit |
| Flight computer | 12 kg | Runs the flight program; required for liquid engines; must be in the top stage |
| Reaction wheels | 9 kg | 400 N·m, turns the vehicle without thrust |
| Propellant tank S / M / L | 40 / 70 / 100 kg empty | 160 / 330 / 500 kg propellant |
| Carbon tank C3 / C5 | 38 / 60 kg empty | 540 / 900 kg propellant |
| Stage decoupler | 15 kg | 600 N·s separation push; stays with the lower stage |
| LR-12 Sparrow | 55 kg | 16 kN vacuum, Isp 250–285 s, 5° gimbal, 1 ignition |
| LR-40 Heron | 110 kg | 42 kN vacuum, Isp 262–298 s, 4° gimbal, 1 ignition |
| LR-60 Condor | 125 kg | 68 kN vacuum, Isp 284–312 s, 5° gimbal, 1 ignition |
| RV-9 Kestrel vacuum engine | 30 kg | 12 kN vacuum, Isp 170–345 s, 4° gimbal, 3 ignitions |
| SR-9 Needle solid motor | 140 kg + 600 kg propellant | 24 kN vacuum, Isp 228–252 s, no steering or throttle |
| Small / large fin set | 10 / 20 kg | Normal-force slope 6 / 11, on the stage 1 tail |

To add a part, add an entry to `PARTS` in `src/core.js`, rebuild, and it appears in the builder automatically. To add a mission, add an entry to `MISSIONS`.

## Saved data

Designs are saved in the browser's local storage as versions (`Orbiter_v001`, `Orbiter_v002` and so on), together with their flight program and mission. Saving never overwrites an earlier version. V0.1 saves still load.

## Model versions

Physics AeroModel 0.2, atmosphere US76-lite 1.0, gravity point mass 1.0, integrator RK4 at 100 Hz, staging Impulse 1.0, flight computer 1.0 at 20 Hz. These are shown in the builder so results can be traced to the model that produced them. The physics model is described in [docs/PHYSICS_MODEL.md](docs/PHYSICS_MODEL.md).

## Not yet in V0.2

Flight is still 2D, in Earth's equatorial plane, so there are no inclination changes or rendezvous. Also missing: recovery and parachutes, re-entry heating, wind, multiple planets, AI crew, and a research mode with uncertainty models. See the roadmap in the project report.
