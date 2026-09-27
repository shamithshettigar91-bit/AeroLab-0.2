import re

import pandas as pd
import streamlit as st

import experiments as ex
import sim_bridge as sb

st.set_page_config(page_title="AeroLab Parameter Sweep", page_icon="📈", layout="wide")
st.title("Parameter Sweep")
st.caption("Fly many variations of one design and compare the outcomes. Every run uses the game's own simulation core.")

P = sb.parts()
base = st.session_state.get("lab_design") or {
    "stack": ["nose_ogive", "payload_sci", "avionics", "tank_m", "eng_sparrow"], "fins": "fins_s"}
base_sas = st.session_state.get("lab_sas", True)
base_program = st.session_state.get("lab_program")
base_mission = st.session_state.get("lab_mission", "M002")
base_seed = st.session_state.get("lab_seed", 1)
multi = "decoupler" in base["stack"]
st.markdown("**Base design** (from Flight Lab): " + " → ".join(P[p]["name"] for p in base["stack"])
            + (f", plus {P[base['fins']]['name'].lower()}" if base.get("fins") else ", no fins")
            + f". Mission **{base_mission}**" + (", flown by a flight program." if base_program else ", flown manually."))

CONST_RE = re.compile(r"^const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;", re.M)
consts = {m.group(1): float(m.group(2)) for m in CONST_RE.finditer(base_program or "")}
kinds = ["Flight program constant"] if base_program else []
if not multi:
    kinds += ["Throttle through max Q", "Propellant tanks", "Engine and fins"]
if not kinds:
    st.info("This multi-stage design is flown manually. In Flight Lab, choose **Flight program** to sweep a program constant.")
    st.stop()
kind = st.radio("What to vary", kinds, horizontal=True)
if multi and not base_program:
    st.caption("Tank, engine and throttle sweeps edit single-stage designs only.")

def with_stack(tanks=None, engine=None, fins="keep"):
    keep = [p for p in base["stack"] if P[p]["cat"] not in ("tank", "engine")]
    eng = engine or next((p for p in base["stack"] if P[p]["cat"] == "engine"), None)
    tk = tanks if tanks is not None else [p for p in base["stack"] if P[p]["cat"] == "tank"]
    stack = keep + tk + ([eng] if eng else [])
    stack.sort(key=lambda p: sb.RANK[P[p]["cat"]])
    return {"stack": stack, "fins": base.get("fins") if fins == "keep" else fins}

runs, labels, xs = [], [], []
if kind == "Flight program constant":
    if not consts:
        st.warning("The program has no top-level numeric constants to vary. Write them as  const NAME = 123;  on their own line.")
    else:
        c = st.columns(4)
        cname = c[0].selectbox("Constant", list(consts))
        v0 = consts[cname]
        lo = c[1].number_input("From", value=float(v0 * 0.5 if v0 else -1.0))
        hi = c[2].number_input("To", value=float(v0 * 1.5 if v0 else 1.0))
        n = c[3].slider("Flights", 3, 25, 9)
        st.caption(f"The program currently sets {cname} = {v0:g}. Every other line stays exactly as written in Flight Lab.")
        for i in range(n):
            v = lo + (hi - lo) * i / (n - 1)
            v = round(v, 6)
            src = CONST_RE.sub(lambda m: f"const {m.group(1)} = {v};" if m.group(1) == cname else m.group(0), base_program)
            runs.append({"design": base, "mission": base_mission, "program": src, "seed": base_seed})
            labels.append(f"{cname} = {v:g}"); xs.append(v)
elif kind == "Throttle through max Q":
    c = st.columns(3)
    band = c[0].slider("Altitude band, km", 0.0, 40.0, (3.0, 20.0), step=0.5)
    lo, hi = c[1].slider("Throttle range, %", 40, 100, (40, 100), step=5)
    step = c[2].select_slider("Step, %", [5, 10, 20], value=5)
    for lvl in range(lo, hi + 1, step):
        runs.append({"design": base, "sas": base_sas, "stopAtApogee": True,
                     "throttlePlan": [{"from": band[0] * 1000, "to": band[1] * 1000, "throttle": lvl / 100}]})
        labels.append(f"{lvl}%"); xs.append(lvl)
    if P[with_stack()["stack"][-1]].get("type") != "liquid":
        st.warning("The base design uses a solid motor, which cannot throttle. Choose a liquid engine in Flight Lab.")
elif kind == "Propellant tanks":
    combos = {"S": ["tank_s"], "M": ["tank_m"], "L": ["tank_l"], "M + S": ["tank_m", "tank_s"],
              "L + S": ["tank_l", "tank_s"], "L + M": ["tank_l", "tank_m"], "L + L": ["tank_l", "tank_l"]}
    pick = st.multiselect("Tank combinations", list(combos), default=list(combos))
    for k in pick:
        runs.append({"design": with_stack(tanks=combos[k]), "sas": base_sas, "stopAtApogee": True})
        labels.append(k); xs.append(k)
else:
    engines = [k for k, v in P.items() if v["cat"] == "engine"]
    fin_opts = [None] + [k for k, v in P.items() if v["cat"] == "fins"]
    for e in engines:
        for f in fin_opts:
            d = with_stack(engine=e, fins=f)
            if P[e].get("type") == "solid":
                d["stack"] = [p for p in d["stack"] if P[p]["cat"] not in ("tank", "avionics")]
            runs.append({"design": d, "sas": base_sas, "stopAtApogee": True})
            labels.append(f"{P[e]['name']}, {P[f]['name'].lower() if f else 'no fins'}"); xs.append(labels[-1])

st.caption(f"{len(runs)} flights")
for r in runs:
    r["telemetry"] = True  # experiment fingerprints cover the full flight history
if st.button("Run sweep", type="primary", disabled=not runs):
    with st.spinner(f"Flying {len(runs)} vehicles…"):
        st.session_state["sweep"] = (kind, labels, xs, sb.fly(runs), runs)
        st.session_state.pop("sweep_saved", None)

if "sweep" not in st.session_state or st.session_state["sweep"][0] != kind:
    st.info("Set up the sweep and press **Run sweep**.")
    st.stop()

_, labels, xs, results, sweep_runs = st.session_state["sweep"]
rows = []
for lab, x, res in zip(labels, xs, results):
    if res.get("error"):
        rows.append({"Variant": lab, "Outcome": "Invalid design"}); continue
    fail = res.get("failure")
    orb = res.get("orbit") or {}
    rows.append({
        "Variant": lab,
        "Outcome": "Success" if res["success"] else ("Failed: " + fail["kind"] if fail else "Fell short"),
        "Apogee, km": round(res["apogee"] / 1000, 1),
        "Periapsis, km": round(orb["periapsis"] / 1000, 1) if orb.get("periapsis") is not None else None,
        "Apoapsis, km": round(orb["apoapsis"] / 1000, 1) if orb.get("apoapsis") is not None else None,
        "Propellant left, kg": round(res.get("propellantLeft", 0)),
        "Max Q, kPa": round(res["max"]["q"] / 1000, 1),
        "Peak g": round(res["max"]["g"], 1),
        "ΔV, m/s": round(res["analysis"]["dvVac"]),
        "TWR": round(res["analysis"]["twr"], 2),
        "Lift-off mass, kg": round(res["analysis"]["wet"]),
        "Gravity loss, m/s": round(res["loss"]["grav"]),
        "Drag loss, m/s": round(res["loss"]["drag"]),
        "Cause": res["report"]["cause"],
    })
df = pd.DataFrame(rows)
ok = df[df["Outcome"] == "Success"]
st.metric("Successful variants", f"{len(ok)} of {len(df)}")
if kind == "Flight program constant":
    import altair as alt  # installed with Streamlit
    orbit_mission = "Periapsis, km" in df and df["Periapsis, km"].notna().any() and base_mission in ("M004", "M005", "M006")
    ycol = "Periapsis, km" if orbit_mission else "Apogee, km"
    df["x"] = xs
    pts = alt.Chart(df).mark_line(point=alt.OverlayMarkDef(size=80, filled=True), color="#8FD3F4").encode(
        x=alt.X("x:Q", title=labels[0].split(" = ")[0] if labels else "value"),
        y=alt.Y(f"{ycol}:Q", title=ycol),
        tooltip=["Variant", "Outcome", ycol, "Propellant left, kg"])
    dots = alt.Chart(df).mark_point(size=160, filled=True).encode(
        x="x:Q", y=f"{ycol}:Q",
        color=alt.Color("Outcome:N", scale=alt.Scale(domain=sorted(set(df["Outcome"])),
                        range=[{"Success": "#6CC4A1", "Fell short": "#E9C46A"}.get(o, "#EE6A55") for o in sorted(set(df["Outcome"]))])))
    st.altair_chart((pts + dots).properties(height=380), use_container_width=True)
    df = df.drop(columns=["x"])
elif kind == "Throttle through max Q":
    chart = pd.DataFrame({"Throttle in band, %": xs, "Apogee, km": df.get("Apogee, km"), "Target, km": 100}).set_index("Throttle in band, %")
    st.line_chart(chart, height=360, x_label="Throttle in band, %", y_label="km")
else:
    import altair as alt  # installed with Streamlit
    COLORS = {"Success": "#6CC4A1", "Fell short": "#E9C46A", "Failed: overload": "#EE6A55", "Failed: breakup": "#F28B50",
              "Failed: tumble": "#C2412D", "Failed: gforce": "#D98BD0", "Failed: twr": "#9BB0C9", "Failed: recontact": "#B06AD9", "Invalid design": "#56698A"}
    present = [o for o in COLORS if o in set(df["Outcome"])]
    bars = alt.Chart(df).mark_bar().encode(
        x=alt.X("Variant:N", sort=labels, title=None, axis=alt.Axis(labelAngle=0 if len(df) <= 5 else -35, labelLimit=240, labelOverlap=False)),
        y=alt.Y("Apogee, km:Q", title="Apogee, km"),
        color=alt.Color("Outcome:N", scale=alt.Scale(domain=present, range=[COLORS.get(o, "#9BB0C9") for o in present])),
        tooltip=["Variant", "Outcome", "Apogee, km", "Max Q, kPa", "Peak g"])
    target = alt.Chart(pd.DataFrame({"y": [100]})).mark_rule(strokeDash=[6, 4], color="#E7EDF4").encode(y="y:Q")
    st.altair_chart((bars + target).properties(height=380), use_container_width=True)
st.dataframe(df, hide_index=True, use_container_width=True)
st.download_button("Download results CSV", df.to_csv(index=False).encode(), "aerolab_sweep.csv", "text/csv")
st.caption("Each variant is one deterministic flight, not a probability. Monte Carlo with uncertainty models comes with research mode.")

st.subheader("Save as experiment")
st.caption("Stores the exact flight requests, model and code versions, and a fingerprint of every result in experiments/. "
           "Open the Experiments page to reproduce it later.")
c1, c2 = st.columns([1, 2])
exp_name = c1.text_input("Experiment name", value=kind)
exp_notes = c2.text_input("Notes (optional)", placeholder="What question does this sweep answer?")
if st.button("Save experiment", disabled="sweep_saved" in st.session_state):
    m = ex.record(exp_name, kind, sweep_runs, labels, results, sb.model(), exp_notes)
    path = ex.save(m)
    st.session_state["sweep_saved"] = m["experimentId"]
    if m["code"]["gitDirty"]:
        st.warning("Saved, but the simulation code has uncommitted changes. Commit them so this experiment can be traced to a Git commit.")
if "sweep_saved" in st.session_state:
    st.success(f"Saved as **{st.session_state['sweep_saved']}**. Find it on the Experiments page.")
