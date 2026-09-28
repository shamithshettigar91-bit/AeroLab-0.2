import json

import pandas as pd
import streamlit as st

import experiments as ex
import sim_bridge as sb

st.set_page_config(page_title="AeroLab Experiments", page_icon="🧾", layout="wide")
st.title("Experiments")
st.caption("Every saved sweep, with the exact inputs and versions that produced it. Reproduce one to prove the result still holds.")
sb.require_node()

saved = ex.list_saved()
src = st.radio("Source", ["Saved in experiments/", "Upload a manifest"], horizontal=True)
manifest = None
if src == "Saved in experiments/":
    if not saved:
        st.info("No experiments yet. Run a sweep on the Parameter Sweep page and press **Save experiment**.")
        st.stop()
    pick = st.selectbox("Experiment", saved, format_func=lambda e: f"{e['id']}  {e['name']}  ({e['runs']} runs)")
    manifest = ex.load(pick["path"])
else:
    up = st.file_uploader("AeroLab experiment JSON", type="json")
    if up:
        try:
            manifest = json.loads(up.read())
            ex.check_schema(manifest)
        except (ValueError, json.JSONDecodeError) as e:
            st.error(str(e)); st.stop()
if not manifest:
    st.stop()

# ---------- metadata ----------
m, code = manifest, manifest["code"]
c = st.columns(4)
c[0].metric("Runs", len(m["runs"]))
c[1].metric("Successful", sum(r["outcome"] == "Success" for r in m["runs"]))
c[2].metric("Code version", code.get("gitTag") or "no Git")
c[3].metric("Physics", m["model"].get("physics", "?"))
with st.expander("Full record"):
    st.markdown(f"**{m['name']}** ({m['kind']}), created {m['createdAt']}")
    if m.get("notes"):
        st.markdown(f"Notes: {m['notes']}")
    st.json({"model": m["model"], "code": code, "runtime": m["runtime"], "manifestSha256": m.get("manifestSha256")})
if code.get("gitDirty"):
    st.warning("This experiment was recorded with uncommitted code changes, so its Git commit alone does not identify the code. The core hash still does.")

table = pd.DataFrame([{"Run": r["runId"], "Variant": r["label"], "Outcome": r["outcome"],
                       "Apogee, km": round((r["apogee_m"] or 0) / 1000, 2),
                       "Max Q, kPa": round((r["maxQ_Pa"] or 0) / 1000, 1),
                       "Peak g": round(r["maxG"] or 0, 1)} for r in m["runs"]])
st.dataframe(table, hide_index=True, use_container_width=True)
st.download_button("Download manifest JSON", json.dumps(m, indent=2).encode(), f"{m['experimentId']}.json", "application/json")

# ---------- reproduce ----------
st.subheader("Reproduce")
st.caption("Reruns every stored request against the current code, without any cache, and compares result fingerprints, including the full telemetry.")
if st.button("Reproduce this experiment", type="primary"):
    with st.spinner(f"Re-flying {len(m['runs'])} vehicles…"):
        st.session_state["repro"] = (m["experimentId"], ex.reproduce(m))

rep = st.session_state.get("repro")
if rep and rep[0] == m["experimentId"]:
    r = rep[1]
    msg = f"**{r['verdict'].capitalize()}.** {r['counts']['identical']} identical, {r['counts']['within tolerance']} within tolerance, {r['counts']['different']} different."
    {"reproduced exactly": st.success, "reproduced within tolerance": st.info}.get(r["verdict"], st.error)(msg)
    if r["codeChanged"]:
        st.warning("The simulation core has changed since this experiment was recorded, so differences can be expected. "
                   f"Recorded core {code['coreSha256'][:12]}, current core {r['codeNow']['coreSha256'][:12]}."
                   + (f" Flight computer recorded {code['flightComputerSha256'][:12]}, now {r['codeNow']['flightComputerSha256'][:12]}." if code.get('flightComputerSha256') else ""))
    if r["modelChanged"]:
        st.warning(f"The physics model version changed: recorded {m['model']}, now {r['modelNow']}.")
    df = pd.DataFrame(r["rows"])
    df["Apogee recorded, km"] = (df["apogee_recorded_m"].fillna(0) / 1000).round(3)
    df["Apogee now, km"] = (df["apogee_now_m"].fillna(0) / 1000).round(3)
    st.dataframe(df[["runId", "label", "status", "Apogee recorded, km", "Apogee now, km", "outcome_recorded"]]
                 .rename(columns={"runId": "Run", "label": "Variant", "status": "Result", "outcome_recorded": "Recorded outcome"}),
                 hide_index=True, use_container_width=True)
