import pandas as pd
import streamlit as st

import sim_bridge as sb

st.set_page_config(page_title="AeroLab Flight Lab", page_icon="🧪", layout="wide")
st.title("Flight Lab")
st.caption("Design a vehicle, fly it headlessly with the game's own simulation core, and study the telemetry. "
           "Multi-stage rockets and flight programs run exactly as they do in the game.")

CAT = sb.catalog()
P, MISSIONS, REF, PROGS = CAT["parts"], CAT["missions"], CAT["designs"], CAT["programs"]
M = {m["id"]: m for m in MISSIONS}
by_cat = lambda cat: [k for k, v in P.items() if v["cat"] == cat]
name = lambda k: P[k]["name"] if k else "None"

# ---------- Design ----------
col_d, col_a = st.columns([1, 1.25], gap="large")
with col_d:
    st.subheader("Mission")
    mission = st.selectbox("Mission", list(M), index=1, format_func=lambda i: f"{i}: {M[i]['title']}", label_visibility="collapsed")
    st.caption(M[mission]["brief"])

    st.subheader("Design")
    mode = st.radio("Build with", ["Stack editor (any number of stages)", "Single-stage form (V0.1)"], horizontal=True)
    if mode.startswith("Stack"):
        ref = st.selectbox("Start from a reference rocket", list(REF), index=2 if M[mission]["objective"]["type"] == "orbit" else 0,
                           format_func=lambda k: f"{REF[k]['name']}: {REF[k]['note'].split('.')[0]}")
        if st.session_state.get("lab_ref") != ref:
            st.session_state["lab_ref"] = ref
            st.session_state["lab_stack_text"] = "\n".join(REF[ref]["stack"])
            st.session_state["lab_fins"] = REF[ref]["fins"]
        stack_text = st.text_area("Stack, top to bottom, one part id per line", key="lab_stack_text", height=250,
                                  help="Decouplers split the stack into stages. Everything below a decoupler drops away at separation.")
        fins_opts = [None, *by_cat("fins")]
        fins = st.selectbox("Fins, on the stage 1 tail", fins_opts, key="lab_fins", format_func=name)
        stack = sb.parse_stack(stack_text)
        unknown = [p for p in stack if p not in P]
        if unknown:
            st.error(f"Unknown part id: {', '.join(unknown)}")
            stack = [p for p in stack if p in P]
        with st.expander("Part ids"):
            st.dataframe(pd.DataFrame([{"id": k, "name": v["name"], "category": v["cat"]} for k, v in P.items()]),
                         hide_index=True, use_container_width=True)
        design = {"stack": stack, "fins": fins}
    else:
        nose = st.selectbox("Nose cone", [None, *by_cat("nose")], index=1, format_func=name)
        payload = st.selectbox("Payload", [None, *by_cat("payload")], index=1, format_func=name)
        avionics = st.checkbox("Flight computer", value=True, help="Liquid engines need one to steer.")
        tank_opts = [None, *by_cat("tank")]
        t1, t2, t3 = st.columns(3)
        tanks = [t1.selectbox("Tank 1", tank_opts, index=2, format_func=name),
                 t2.selectbox("Tank 2", tank_opts, index=0, format_func=name),
                 t3.selectbox("Tank 3", tank_opts, index=0, format_func=name)]
        engine = st.selectbox("Engine", by_cat("engine"), format_func=name)
        fins = st.selectbox("Fins", [None, *by_cat("fins")], index=1, format_func=name)
        design = sb.make_design(nose, payload, avionics, [t for t in tanks if t], engine, fins)

    st.subheader("Flight control")
    control = st.radio("Who flies", ["Flight program", "Manual plan (engine lit at t = 0)"], horizontal=True,
                       index=0 if M[mission]["objective"]["type"] == "orbit" else 1)
    program, plan, sas, stop_apogee, seed = None, [], True, False, 1
    if control == "Flight program":
        ex = st.selectbox("Load an example program", [p["id"] for p in PROGS],
                          index=next((i for i, p in enumerate(PROGS) if p["id"] == ("orbit" if M[mission]["objective"]["type"] == "orbit" else "staging" if mission == "M003" else "hello")), 0),
                          format_func=lambda i: next(p["title"] for p in PROGS if p["id"] == i))
        if st.session_state.get("lab_ex") != ex:
            st.session_state["lab_ex"] = ex
            st.session_state["lab_prog"] = next(p["code"] for p in PROGS if p["id"] == ex)
        program = st.text_area("Program source", key="lab_prog", height=320)
        seed = st.number_input("Seed for Math.random", value=1, step=1, help="Change it to test whether randomness in your program matters.")
        chk = sb.check_program(program)
        if chk["ok"]:
            st.caption("Program compiles.")
        else:
            st.error(f"{chk['error']['message']}" + (f" (line {chk['error']['line']})" if chk["error"].get("line") else ""))
    else:
        eng = next((p for p in design["stack"] if P.get(p, {}).get("cat") == "engine"), None)
        liquid = bool(eng) and P[eng].get("type") == "liquid"
        sas = st.checkbox("Attitude hold", value=True, disabled=not liquid)
        throttle_down = st.checkbox("Throttle down through the lower atmosphere", value=False, disabled=not liquid)
        if throttle_down and liquid:
            band = st.slider("Altitude band, km", 0.0, 40.0, (3.0, 20.0), step=0.5)
            level = st.slider("Throttle in band, %", 40, 100, 45, step=5)
            plan = [{"from": band[0] * 1000, "to": band[1] * 1000, "throttle": level / 100}]
        stop_apogee = st.checkbox("Stop at apogee", value=True, help="Skip the long fall back to Earth.")
        st.caption("A manual plan never separates stages. Use a flight program for multi-stage rockets.")

st.session_state.update(lab_design=design, lab_plan=plan, lab_sas=sas, lab_mission=mission,
                        lab_program=program, lab_seed=int(seed))

# ---------- Analysis ----------
an = sb.analyze(design, mission)
with col_a:
    st.subheader("Engineering")
    m = st.columns(3)
    m[0].metric("Lift-off mass", f"{an['wet']:,.0f} kg")
    m[1].metric("Thrust-to-weight", f"{an['twr']:.2f}")
    m[2].metric("ΔV, vacuum, all stages", f"{an['dvVac']:,.0f} m/s", f"{an['dvVac'] - M[mission]['dvHint']:+,.0f} vs ~{M[mission]['dvHint']:,} needed")
    m = st.columns(3)
    m[0].metric("Stages", an["nStages"])
    m[1].metric("Stability margin", f"{an['smFull']:.1f} cal")
    m[2].metric("Structural limit", f"{an['qMax'] / 1000:.0f} kPa")
    if an["stages"]:
        st.dataframe(pd.DataFrame([{"Stage": s["stage"], "Engine": s["engine"] or "none", "ΔV, m/s": round(s["dvVac"]),
                                    "TWR": round(s["twr"], 2), "Burn, s": round(s["burn"]), "Mass at ignition, kg": round(s["m0"]),
                                    "Ignitions": s["ignitions"]} for s in reversed(an["stages"])]),
                     hide_index=True, use_container_width=True)
        st.caption("TWR is at sea level for stage 1 and in vacuum for upper stages.")
    for i in an["issues"]:
        (st.error if i["level"] == "error" else st.warning)(f"{i['text']}  \n*{i['fix']}*")
    if not an["issues"]:
        st.success("No problems found.")
    ready = an["valid"] and (program is None or sb.check_program(program)["ok"])
    run = st.button("Fly this design", type="primary", disabled=not ready, use_container_width=True)

if run:
    req = {"design": design, "mission": mission, "telemetry": True}
    if program:
        req.update(program=program, seed=int(seed))
    else:
        req.update(sas=sas, throttlePlan=plan, stopAtApogee=stop_apogee)
    with st.spinner("Flying…"):
        res = sb.fly([req])[0]
    st.session_state["lab_result"] = res

res = st.session_state.get("lab_result")
if not res:
    st.info("Press **Fly this design** to run a flight.")
    st.stop()
if res.get("error"):
    st.error(res["error"])
    st.stop()

# ---------- Results ----------
st.divider()
r, mres = res["report"], M[res["mission"]]
(st.success if r["success"] else st.error)(f"**{'Mission complete' if r['success'] else 'Mission failed'}** ({mres['id']}: {mres['title']}). {r['cause']}")
orbit = mres["objective"]["type"] == "orbit"
m = st.columns(5)
if orbit:
    o = res["orbit"]
    km = lambda v: f"{v / 1000:,.1f} km" if v is not None else "none"
    m[0].metric("Periapsis", km(o["periapsis"]), f"{(o['periapsis'] - mres['objective']['peri']) / 1000:+,.1f} km vs target" if o["periapsis"] is not None else None)
    m[1].metric("Apoapsis", km(o["apoapsis"]))
    m[2].metric("Propellant left", f"{res['propellantLeft']:,.0f} kg", f"stage {res['stageReached']}", delta_color="off")
else:
    target = mres["objective"]["value"]
    m[0].metric("Apogee", f"{res['apogee'] / 1000:,.1f} km", f"{(res['apogee'] - target) / 1000:+,.1f} km vs target")
    m[1].metric("Max Q", f"{res['max']['q'] / 1000:.1f} kPa")
    m[2].metric("Peak acceleration", f"{res['max']['g']:.1f} g")
m[3].metric("Gravity loss", f"{res['loss']['grav']:,.0f} m/s")
m[4].metric("Drag loss", f"{res['loss']['drag']:,.0f} m/s")
if res.get("program"):
    pr = res["program"]
    msg = {"finished": "ran to the end", "running": "was still running when the run stopped", "stopped": "was stopped",
           "error": "halted with an error", "budget": "was halted for running too long without yielding"}.get(pr["status"], pr["status"])
    (st.warning if pr["status"] in ("error", "budget") else st.caption)(
        f"Flight program {msg}." + (f" {pr['error']['message']}" + (f" (line {pr['error']['line']})" if pr["error"].get("line") else "") if pr.get("error") else ""))

c1, c2 = st.columns([1, 1.6], gap="large")
with c1:
    st.markdown("**Evidence**\n" + "\n".join(f"- {x}" for x in r["evidence"]))
    if r["factors"]:
        st.markdown("**Contributing factors**\n" + "\n".join(f"- {x}" for x in r["factors"]))
    st.markdown(("**Next**\n" if r["success"] else "**What to try**\n") + "\n".join(f"- {x}" for x in r["fixes"]))
    if res.get("stages"):
        t0 = res.get("liftoffT") or 0
        st.markdown("**Staging**")
        st.dataframe(pd.DataFrame([{"Stage": s["stage"], "T+ s": round(s["t"] - t0, 1), "Altitude, km": round(s["alt"] / 1000, 1),
                                    "q, kPa": round(s["q"] / 1000, 2), "Propellant left, kg": round(s["propLeft"]),
                                    "Still firing": s["thrusting"]} for s in res["stages"]]), hide_index=True, use_container_width=True)
    ev = pd.DataFrame(res["events"])
    if not ev.empty:
        ev["T+ s"] = (ev["t"] - (res.get("liftoffT") or 0)).round(1)
        st.markdown("**Event log**")
        st.dataframe(ev[["T+ s", "msg"]].rename(columns={"msg": "Event"}), hide_index=True, use_container_width=True)
with c2:
    df = sb.telemetry_frame(res)
    labels = {"altitude_km": "Altitude, km", "velocity_m_s": "Velocity, m/s", "orbital_speed_m_s": "Orbital speed, m/s",
              "apoapsis_km": "Apoapsis, km", "periapsis_km": "Periapsis, km (clipped at −200)", "pitch_deg": "Pitch, °",
              "acceleration_g": "Acceleration, g", "dynamic_pressure_kPa": "Dynamic pressure, kPa", "mach": "Mach",
              "thrust_kN": "Thrust, kN", "mass_kg": "Mass, kg", "propellant_pct": "Stage propellant, %", "downrange_km": "Downrange, km", "stage": "Stage"}
    labels = {k: v for k, v in labels.items() if k in df}
    chans = st.multiselect("Channels", list(labels), default=["altitude_km", "periapsis_km"] if orbit else ["altitude_km"], format_func=labels.get)
    tgt = mres["objective"].get("value", mres["objective"].get("peri", 0)) / 1000
    limits = {"altitude_km": None if orbit else (tgt, "Target"), "periapsis_km": (tgt, "Target") if orbit else None,
              "dynamic_pressure_kPa": (an["qMax"] / 1000, "Structural limit"),
              "acceleration_g": (an["gMax"], "Payload limit") if an["gMax"] < 99 else None}
    for ch in chans:
        st.altair_chart(sb.channel_chart(df, ch, labels[ch], limits.get(ch)), use_container_width=True)
    st.download_button("Download telemetry CSV", df.to_csv(index=False).encode(), "aerolab_telemetry.csv", "text/csv")
