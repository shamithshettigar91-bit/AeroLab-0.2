// ================= AEROLAB UI (reads simulation state, never computes physics) =================
const $ = s => document.querySelector(s);
const fmt = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAT = [['nose', 'Nose cones'], ['payload', 'Payload'], ['avionics', 'Avionics'], ['tank', 'Propellant tanks'], ['engine', 'Engines'], ['decoupler', 'Staging'], ['fins', 'Fins, on the first stage tail']];
const RANK = { decoupler: -1, nose: 0, payload: 1, avionics: 2, tank: 3, engine: 4 };
const MAX_PARTS = 20;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
const EVAL_OK = (() => { try { return new Function('return 1')() === 1; } catch (e) { return false; } })();

// ---------- State ----------
const saved = store.get('aerolab.v02.current', null);
const legacy = !saved ? store.get('aerolab.v01.current', null) : null; // V0.1 designs still load
let design = saved ? saved.design : (legacy ? { name: legacy.name, stack: legacy.stack, fins: legacy.fins } : { name: 'Sounder', stack: ['nose_ogive', 'payload_sci', 'avionics', 'tank_m', 'eng_sparrow'], fins: null });
let prog = saved ? saved.prog : { code: EXAMPLE_PROGRAMS[0].code, exampleId: 'hello' };
let missionId = saved ? saved.missionId : 'M002';
let useProg = saved ? saved.useProg !== false : false;
let missionsDone = store.get('aerolab.v02.missions', store.get('aerolab.v01.missionDone', false) ? { M002: true } : {});
let selected = null, an = null, activeStage = 1, progCheck = null, screen = 'build';
const persist = () => store.set('aerolab.v02.current', { design, prog, missionId, useProg });

function partStat(d) {
  switch (d.cat) {
    case 'tank': return `${d.prop} kg propellant, ${d.mass} kg empty`;
    case 'engine': return d.type === 'solid' ? `${fmt(d.tvac / 1000, 0)} kN, Isp ${d.ispSL}–${d.ispVac} s, ${d.mass + d.prop} kg loaded`
      : `${fmt(d.tvac / 1000, 1)} kN, Isp ${d.ispSL}–${d.ispVac} s, ${d.mass} kg${(d.ignitions || 1) > 1 ? `, ${d.ignitions} ignitions` : ''}`;
    case 'fins': return `${d.mass} kg, pulls pressure aft`;
    case 'decoupler': return `${d.mass} kg, ${d.impulse} N·s separation push`;
    default: return d.torque ? `${d.mass} kg, ${d.torque} N·m` : `${d.mass} kg, ${d.len} m long`;
  }
}
const partMass = d => d.mass + (d.prop || 0);
const segs = () => stageSegments(design.stack);
const stageOfIndex = i => segs().findIndex(([a, b]) => i >= a && i < b) + 1;

// ---------- Screens ----------
function showScreen(s) {
  screen = s;
  $('#builder').classList.toggle('hidden', s !== 'build');
  $('#programmer').classList.toggle('hidden', s !== 'program');
  $('#tabBuild').classList.toggle('on', s === 'build'); $('#tabBuild').setAttribute('aria-selected', s === 'build');
  $('#tabProgram').classList.toggle('on', s === 'program'); $('#tabProgram').setAttribute('aria-selected', s === 'program');
  if (s === 'build') drawBuilder(); else { refreshGutter(); $('#code').focus({ preventScroll: true }); }
}
$('#tabBuild').onclick = () => showScreen('build');
$('#tabProgram').onclick = () => showScreen('program');

// ---------- Missions ----------
function renderMissionSel() {
  $('#missionSel').innerHTML = MISSIONS.map(m => `<option value="${m.id}" ${m.id === missionId ? 'selected' : ''}>${missionsDone[m.id] ? '✓ ' : ''}${m.id}: ${esc(m.title)}</option>`).join('');
  $('#missionFlag').classList.toggle('done', !!missionsDone[missionId]);
}
$('#missionSel').onchange = e => { missionId = e.target.value; renderMissionSel(); update(); };
function renderMissionBrief() {
  const m = missionById(missionId);
  const ref = Object.entries(REFERENCE_DESIGNS).find(([, d]) => d.mission === missionId) || (m.objective.type === 'orbit' ? ['orbiter', REFERENCE_DESIGNS.orbiter] : null);
  $('#missionBrief').innerHTML = `<h2>Mission ${m.id}: ${esc(m.title)}</h2><p>${esc(m.brief)}</p>` +
    (ref ? `<p class="muted" style="font-size:13.5px;margin-top:6px">Reference rocket: <button class="linkbtn" id="loadRef">${ref[1].name}</button></p>` : '');
  if (ref) $('#loadRef').onclick = () => loadReference(ref[0]);
}
function loadReference(id) {
  const r = REFERENCE_DESIGNS[id]; if (!r) return;
  design = { name: r.name, stack: [...r.stack], fins: r.fins }; $('#dname').value = r.name; selected = null; activeStage = 1;
  update(); flash(`Loaded the ${r.name} reference rocket`);
}

// ---------- Builder ----------
function renderRefSel() {
  $('#refSel').innerHTML = '<option value="">Choose…</option>' + Object.entries(REFERENCE_DESIGNS).map(([id, r]) => `<option value="${id}">${r.name}: ${esc(r.note.split('.')[0])}</option>`).join('');
}
$('#refSel').onchange = e => { if (e.target.value) loadReference(e.target.value); e.target.value = ''; };
function renderPalette() {
  const el = $('#palette'); el.innerHTML = '';
  for (const [cat, label] of CAT) {
    const g = document.createElement('div'); g.className = 'group';
    g.innerHTML = `<h3>${label}</h3>`;
    for (const [id, d] of Object.entries(PARTS)) if (d.cat === cat) {
      const b = document.createElement('button'); b.className = 'pbtn';
      b.innerHTML = `<strong>${d.name}</strong><small>${partStat(d)}</small>`;
      b.title = d.note; b.onclick = () => addPart(id); g.appendChild(b);
    }
    el.appendChild(g);
  }
}
function renderAddTo() {
  const S = segs(), el = $('#addTo');
  if (S.length < 2) { el.innerHTML = ''; return; }
  activeStage = Math.min(activeStage, S.length);
  el.innerHTML = '<span>Tanks and engines go into</span>' + S.map((_, k) => `<button class="${k + 1 === activeStage ? 'on' : ''}" data-s="${k + 1}">Stage ${k + 1}</button>`).reverse().join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { activeStage = +b.dataset.s; update(); });
}
function addPart(id) {
  const d = PARTS[id], st = design.stack;
  if (d.cat === 'fins') { design.fins = id; selected = 'fins'; return update(); }
  if (st.length >= MAX_PARTS && d.cat !== 'nose') return flash(`The stack is limited to ${MAX_PARTS} parts.`);
  if (d.cat === 'nose') { const i = st.findIndex(p => PARTS[p].cat === 'nose'); if (i >= 0) st.splice(i, 1); st.unshift(id); selected = 0; return update(); }
  if (d.cat === 'decoupler') { st.push(id); activeStage = 1; selected = st.length - 1; flash('New stage 1 added below. Give it a tank and an engine.'); return update(); }
  const S = segs(), n = S.length;
  const stage = ['payload', 'avionics'].includes(d.cat) ? n : Math.min(activeStage, n);
  let [a, b] = S[stage - 1];
  if (d.cat === 'engine') {
    for (let i = b - 1; i >= a; i--) if (PARTS[st[i]].cat === 'engine') { st.splice(i, 1); b--; }
    st.splice(b, 0, id); selected = b; return update();
  }
  let at = a; for (let i = a; i < b; i++) if (RANK[PARTS[st[i]].cat] <= RANK[d.cat]) at = i + 1;
  st.splice(at, 0, id); selected = at; update();
}
$('#addStageBtn').onclick = () => addPart('decoupler');
function renderStack() {
  const ul = $('#stack'); ul.innerHTML = '';
  if (!design.stack.length) ul.innerHTML = '<li class="empty">Add parts from the list. They stack top to bottom.</li>';
  const S = segs(), multi = S.length > 1;
  design.stack.forEach((id, i) => {
    const k = S.findIndex(([a]) => a === i);
    if (multi && k >= 0) {
      const n = k + 1, h = document.createElement('li'); h.className = 'stagehead' + (n === activeStage ? ' active' : '');
      h.textContent = `Stage ${n}${n === S.length ? ', top' : ''}${n === 1 ? ', fires first' : ''}`;
      h.onclick = () => { activeStage = n; update(); }; ul.appendChild(h);
    }
    const d = PARTS[id], li = document.createElement('li'); if (selected === i) li.className = 'sel';
    li.innerHTML = `<span class="nm">${d.name}</span><span class="kg">${fmt(partMass(d))} kg</span>
      <button class="ib" aria-label="Move ${d.name} up" ${i === 0 ? 'disabled' : ''}>▲</button>
      <button class="ib" aria-label="Move ${d.name} down" ${i === design.stack.length - 1 ? 'disabled' : ''}>▼</button>
      <button class="ib" aria-label="Remove ${d.name}">✕</button>`;
    const [up, dn, rm] = li.querySelectorAll('button');
    li.querySelector('.nm').onclick = () => { selected = i; activeStage = stageOfIndex(i) || 1; update(); };
    up.onclick = () => { [design.stack[i - 1], design.stack[i]] = [design.stack[i], design.stack[i - 1]]; selected = i - 1; update(); };
    dn.onclick = () => { [design.stack[i + 1], design.stack[i]] = [design.stack[i], design.stack[i + 1]]; selected = i + 1; update(); };
    rm.onclick = () => { design.stack.splice(i, 1); selected = null; update(); };
    ul.appendChild(li);
  });
  const fr = $('#finsRow');
  if (design.fins) {
    const d = PARTS[design.fins];
    fr.innerHTML = `<ul class="stack"><li class="${selected === 'fins' ? 'sel' : ''}"><span class="nm">${d.name}, on the stage 1 tail</span><span class="kg">${d.mass} kg</span><button class="ib" aria-label="Remove fins">✕</button></li></ul>`;
    fr.querySelector('.nm').onclick = () => { selected = 'fins'; update(); };
    fr.querySelector('button').onclick = () => { design.fins = null; selected = null; update(); };
  } else fr.innerHTML = '<div class="muted" style="font-size:13.5px">No fins attached.</div>';
}
function status(v, rules) { for (const [test, cls, txt] of rules) if (test(v)) return [cls, txt]; return ['', '']; }
function renderAnalysis() {
  an = analyze(design, missionId);
  const m = missionById(missionId), need = m.dvHint;
  const e = an.veh.eng, row = (k, v, cls = '', sub = '') => `<tr><td>${k}</td><td class="${cls}">${v}</td></tr>` + (sub ? `<tr class="sub"><td colspan="2" style="text-align:left">${sub}</td></tr>` : '');
  const [tc, tt] = status(an.twr, [[x => x < 1, 'st-bad', 'Will not leave the pad'], [x => x < 1.5, 'st-caution', 'Slow climb, large gravity losses'],
    [x => x <= 3.5, 'st-good', 'Healthy'], [x => true, 'st-caution', 'Fast in thick air. Watch dynamic pressure.']]);
  const [sc, stx] = status(an.smFull, [[x => x < 0, 'st-bad', 'Unstable: pressure acts ahead of gravity'], [x => x < 1, 'st-caution', 'Marginal'],
    [x => x <= 3, 'st-good', 'Stable'], [x => true, 'st-caution', an.nStages > 1 ? 'Very stable. Normal for a long multi-stage rocket.' : 'Overstable: turns hard into any wind']]);
  const scale = Math.max(4000, need * 1.2), dvPct = Math.min(100, an.dvVac / scale * 100), needPct = need / scale * 100;
  const dvCls = an.dvVac >= need ? 'st-good' : an.dvVac >= need * 0.9 ? 'st-caution' : 'st-bad';
  const needTxt = m.objective.type === 'orbit' ? `what reaching a ${m.objective.peri / 1000} km orbit needs once gravity and drag take their share` : `what a vertical flight to ${m.objective.value / 1000} km needs once gravity and drag take their share`;
  $('#engTable').innerHTML =
    row('Lift-off mass', `${fmt(an.wet)} kg`) + row('Stages', an.nStages) +
    (e ? row('Stage 1 thrust, sea level / vacuum', `${fmt(an.thrustSL / 1000, 1)} / ${fmt(an.thrustVac / 1000, 1)} kN`) : '') +
    row('Thrust-to-weight at lift-off', e ? fmt(an.twr, 2) : '—', tc, tt) +
    `<tr><td colspan="2" style="border-bottom:0;padding-bottom:0;text-align:left;font-weight:400">ΔV, vacuum, all stages <span style="float:right;font-weight:600" class="${dvCls}">${fmt(an.dvVac)} m/s</span>
      <div class="dvbar"><div style="width:${dvPct}%"></div><span style="left:${needPct}%"></span></div></td></tr>
      <tr class="sub"><td colspan="2" style="text-align:left">The mark shows roughly ${fmt(need)} m/s, ${needTxt}.</td></tr>` +
    row('Length', `${fmt(an.L, 1)} m`) +
    row('Centre of gravity, full / empty', `${fmt(an.cgFull, 2)} / ${fmt(an.cgEmpty, 2)} m`, '', 'Measured from the nose tip, for the whole vehicle.') +
    row('Centre of pressure', `${fmt(an.cp, 2)} m`) +
    row('Stability margin', `${fmt(an.smFull, 1)} cal`, sc, stx + '. One calibre is one body diameter, 0.6 m.') +
    row('Structural limit', `${fmt(an.veh.qMax / 1000)} kPa`, '', 'Maximum dynamic pressure the airframe survives.') +
    (an.veh.payloads.length ? row('Payload acceleration limit', `${an.veh.gMax} g`) : '');
  $('#stageTable').innerHTML = `<table class="stagetbl"><thead><tr><th>Stage</th><th>ΔV</th><th>TWR</th><th>Burn</th><th>Mass</th></tr></thead><tbody>` +
    an.stages.slice().reverse().map(s => `<tr><td>${s.stage}${s.engine ? `<div class="muted" style="font-size:12px">${esc(s.engine)}${s.ignitions > 1 ? `, ${s.ignitions} ignitions` : ''}</div>` : '<div class="muted" style="font-size:12px">no engine</div>'}</td>
      <td>${s.dvVac ? fmt(s.dvVac) + ' m/s' : '—'}</td><td>${s.twr ? fmt(s.twr, 2) : '—'}</td><td>${s.burn ? fmt(s.burn) + ' s' : '—'}</td><td>${fmt(s.m0)} kg</td></tr>`).join('') +
    `</tbody></table><div class="muted" style="font-size:12.5px;margin:-8px 0 14px">TWR is at sea level for stage 1 and in vacuum for upper stages. Mass includes every stage above.</div>`;
  const ul = $('#issues'); ul.innerHTML = '';
  if (!an.issues.length) ul.innerHTML = '<li class="ok" style="border-left-color:var(--good)">No problems found. Ready for the pad.</li>';
  for (const i of an.issues) {
    const li = document.createElement('li'); li.className = i.level;
    li.innerHTML = `<div>${esc(i.text)}${i.part ? ` <span class="muted">(${esc(i.part)})</span>` : ''}</div><div class="fix">${esc(i.fix)}</div>`;
    ul.appendChild(li);
  }
  const errs = an.issues.filter(i => i.level === 'error').length;
  $('#launchBtn').disabled = !an.valid;
  $('#launchMsg').textContent = an.valid ? (useProg ? 'Flight program on' : 'Manual flight') : `Fix ${errs} problem${errs > 1 ? 's' : ''} to launch`;
  $('#models').innerHTML = Object.entries({ Physics: MODEL.physics, Atmosphere: MODEL.atmosphere, Gravity: MODEL.gravity, Integrator: MODEL.integrator, Staging: MODEL.staging, 'Flight computer': MODEL.flightComputer })
    .map(([k, v]) => `${k} ${v}`).join('<br>');
}
function renderInspector() {
  const el = $('#inspector');
  let d = null;
  if (selected === 'fins' && design.fins) d = PARTS[design.fins];
  else if (typeof selected === 'number' && design.stack[selected]) d = PARTS[design.stack[selected]];
  el.innerHTML = d ? `<b>${d.name}</b><div>${d.note}</div><div class="muted">${partStat(d)}</div>`
    : `<span class="muted">Select a part in the drawing or the stack to inspect it.</span>`;
}
function update() {
  design.name = $('#dname').value.trim() || 'Rocket';
  persist();
  renderAddTo(); renderStack(); renderAnalysis(); renderInspector(); renderMissionBrief(); drawBuilder();
}
function flash(msg) { $('#barMsg').textContent = msg; clearTimeout(flash.t); flash.t = setTimeout(() => $('#barMsg').textContent = '', 3500); }

// ---------- Save / load (versioned, never overwrites) ----------
function refreshLoad() {
  const list = store.get('aerolab.v02.designs', null) ?? store.get('aerolab.v01.designs', []), sel = $('#loadSel');
  sel.innerHTML = '<option value="">Load design</option>' + list.map((d, i) => `<option value="${i}">${esc(d.label)}</option>`).reverse().join('');
}
$('#saveBtn').onclick = () => {
  const list = store.get('aerolab.v02.designs', null) ?? store.get('aerolab.v01.designs', []), name = (design.name || 'Rocket').replace(/[^\w\- ]/g, '');
  const n = list.filter(d => d.name === name).length + 1;
  const label = `${name}_v${String(n).padStart(3, '0')}`;
  list.push({ name, label, stack: [...design.stack], fins: design.fins, program: prog.code, mission: missionId, savedAt: Date.now() });
  if (store.set('aerolab.v02.designs', list)) { flash(`Saved ${label}, with its flight program`); refreshLoad(); } else flash('This browser blocked saving.');
};
$('#loadSel').onchange = e => {
  const list = store.get('aerolab.v02.designs', null) ?? store.get('aerolab.v01.designs', []), d = list[+e.target.value]; if (!d) return;
  design = { name: d.name, stack: [...d.stack], fins: d.fins }; $('#dname').value = d.name; selected = null;
  if (d.program) { prog = { code: d.program, exampleId: null }; $('#code').value = d.program; refreshGutter(); }
  if (d.mission) { missionId = d.mission; renderMissionSel(); }
  update(); flash(`Loaded ${d.label}`); e.target.value = '';
};
$('#dname').oninput = () => update();

// ---------- Rocket drawing (shared by builder and flight) ----------
const PAINT = { body: '#E3E8EE', shade: '#B6BFCB', line: '#27303E', metal: '#6A7280', metalDark: '#3B424D', accent: '#F2A541', fin: '#3C4A5E', window: '#2C4A70', tank: '#D3DAE3', carbon: '#4A525E' };
function drawRocket(ctx, veh, sc, opt = {}) {
  const r = DIAM / 2 * sc, lw = Math.max(1, Math.min(2, sc * 0.02));
  ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.strokeStyle = PAINT.line;
  const shadeFill = (a = PAINT.shade, b = PAINT.body) => { const g = ctx.createLinearGradient(-r, 0, r, 0); g.addColorStop(0, a); g.addColorStop(0.35, b); g.addColorStop(1, a); return g; };
  if (veh.fins) {
    const span = (veh.design.fins === 'fins_l' ? 0.55 : 0.36) * sc, y0 = (veh.sFin - 0.4) * sc, y1 = (veh.sFin + 0.4) * sc;
    ctx.fillStyle = PAINT.fin;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * r, y0); ctx.lineTo(s * (r + span), y0 + 0.5 * (y1 - y0)); ctx.lineTo(s * (r + span), y1 + 0.06 * sc); ctx.lineTo(s * r, y1); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }
  veh.items.forEach((it, idx) => {
    const d = it.def, h = d.len * sc; ctx.save(); ctx.translate(0, it.sTop * sc);
    ctx.fillStyle = shadeFill();
    if (d.cat === 'nose') {
      ctx.beginPath(); ctx.moveTo(-r, h);
      if (d.cpFrac < 0.5) { ctx.quadraticCurveTo(-r, h * 0.3, 0, 0); ctx.quadraticCurveTo(r, h * 0.3, r, h); }
      else { ctx.lineTo(0, 0); ctx.lineTo(r, h); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (d.cat === 'engine' && d.type === 'liquid') {
      const vac = d.ispSL < 200, ts = Math.min(0.35 * sc, h * 0.3);
      ctx.fillStyle = PAINT.metalDark; ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.lineTo(r * 0.45, ts); ctx.lineTo(-r * 0.45, ts); ctx.closePath(); ctx.fill(); ctx.stroke();
      const g = ctx.createLinearGradient(-r, 0, r, 0); g.addColorStop(0, vac ? '#5A3E2A' : '#3E4550'); g.addColorStop(0.4, vac ? '#B9804F' : '#8C95A3'); g.addColorStop(1, vac ? '#5A3E2A' : '#3E4550');
      ctx.fillStyle = g; const tw = r * (vac ? 0.2 : 0.28), ew = r * (vac ? 0.98 : 0.85);
      ctx.beginPath(); ctx.moveTo(-tw, ts); ctx.lineTo(tw, ts); ctx.quadraticCurveTo(tw * 1.1, ts + (h - ts) * 0.55, ew, h); ctx.lineTo(-ew, h); ctx.quadraticCurveTo(-tw * 1.1, ts + (h - ts) * 0.55, -tw, ts); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (d.cat === 'engine') {
      const nz = Math.min(0.5 * sc, h * 0.2), body = h - nz;
      ctx.fillRect(-r, 0, 2 * r, body); ctx.strokeRect(-r, 0, 2 * r, body);
      ctx.fillStyle = PAINT.accent; ctx.fillRect(-r, body * 0.08, 2 * r, Math.max(2, 0.12 * sc)); ctx.strokeRect(-r, body * 0.08, 2 * r, Math.max(2, 0.12 * sc));
      ctx.fillStyle = PAINT.metalDark; ctx.beginPath(); ctx.moveTo(-r * 0.4, body); ctx.lineTo(r * 0.4, body); ctx.lineTo(r * 0.7, h); ctx.lineTo(-r * 0.7, h); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (d.cat === 'decoupler') {
      ctx.fillStyle = PAINT.metalDark; ctx.fillRect(-r, 0, 2 * r, h); ctx.strokeRect(-r, 0, 2 * r, h);
      ctx.fillStyle = PAINT.accent; ctx.fillRect(-r, h * 0.42, 2 * r, Math.max(1.5, h * 0.16));
    } else {
      const carbon = d.cat === 'tank' && id(it).startsWith('tank_c');
      ctx.fillStyle = carbon ? shadeFill('#2E343D', PAINT.carbon) : shadeFill();
      ctx.fillRect(-r, 0, 2 * r, h); ctx.strokeRect(-r, 0, 2 * r, h);
      if (d.cat === 'tank') { ctx.globalAlpha = 0.5; if (carbon) ctx.strokeStyle = '#8A93A0'; for (const y of [0.1 * sc, h - 0.1 * sc]) { ctx.beginPath(); ctx.moveTo(-r, y); ctx.lineTo(r, y); ctx.stroke(); } ctx.globalAlpha = 1; ctx.strokeStyle = PAINT.line; }
      if (d.cat === 'payload') { ctx.fillStyle = PAINT.accent; ctx.fillRect(-r, h * 0.72, 2 * r, h * 0.12); ctx.fillStyle = PAINT.window; ctx.beginPath(); ctx.arc(0, h * 0.38, Math.min(r * 0.3, h * 0.2), 0, 7); ctx.fill(); }
      if (d.computer) { ctx.fillStyle = PAINT.metalDark; const n = 4; for (let k = 0; k < n; k++) ctx.fillRect(-r + (k + 0.5) * (2 * r / n) - r * 0.08, h * 0.3, r * 0.16, h * 0.4); }
      if (d.torque) { ctx.strokeStyle = PAINT.metalDark; ctx.beginPath(); ctx.ellipse(0, h / 2, r * 0.6, h * 0.28, 0, 0, 7); ctx.stroke(); ctx.strokeStyle = PAINT.line; }
    }
    if (opt.highlight === idx) { ctx.strokeStyle = opt.hl; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeRect(-r - 6, -3, 2 * r + 12, h + 6); ctx.setLineDash([]); ctx.strokeStyle = PAINT.line; ctx.lineWidth = lw; }
    ctx.restore();
  });
  if (opt.highlight === 'fins' && veh.fins) { const span = (veh.design.fins === 'fins_l' ? 0.55 : 0.36) * sc; ctx.strokeStyle = opt.hl; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeRect(-r - span - 6, (veh.sFin - 0.45) * sc, 2 * (r + span) + 12, 0.95 * sc); ctx.setLineDash([]); }
}
const id = it => it.id;
function cgMarker(ctx, x, y, R, col, hollow) {
  ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.stroke();
  if (!hollow) { ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, R, -Math.PI / 2, 0); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, R, Math.PI / 2, Math.PI); ctx.closePath(); ctx.fill(); }
}
let bGeom = null;
function drawBuilder() {
  const cv = $('#bcv'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H || !an) return;
  cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const muted = css('--muted'), line = css('--line'), data = css('--data'), acc = css('--accent'), f = css('--font');
  ctx.strokeStyle = line; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
  for (let x = (W / 2) % 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const veh = an.veh; if (!veh.items.length) { ctx.fillStyle = muted; ctx.font = '15px ' + f; ctx.textAlign = 'center'; ctx.fillText('Your vehicle appears here', W / 2, H / 2); bGeom = null; return; }
  const sc = Math.min((H - 70) / veh.L, W * 0.16 / DIAM, 120), top = (H - veh.L * sc) / 2, cx = W / 2;
  bGeom = { sc, top, cx };
  ctx.save(); ctx.translate(cx, top); drawRocket(ctx, veh, sc, { highlight: selected, hl: acc }); ctx.restore();
  const r = DIAM / 2 * sc, markX = cx + Math.max(r, 0.36 * sc) + 58;
  ctx.strokeStyle = muted; ctx.setLineDash([8, 4, 2, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, top - 16); ctx.lineTo(cx, top + veh.L * sc + 16); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = `13px ${f}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const yCg = top + an.cgFull * sc, yCgE = top + an.cgEmpty * sc, yCp = top + an.cp * sc;
  ctx.strokeStyle = data; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(cx, yCg); ctx.lineTo(markX - 9, yCg); ctx.stroke(); ctx.globalAlpha = 1;
  cgMarker(ctx, markX, yCg, 8, data, false); cgMarker(ctx, markX, yCgE, 5, data, true);
  ctx.fillStyle = data; ctx.fillText(`CG ${fmt(an.cgFull, 2)} m`, markX + 14, yCg);
  ctx.strokeStyle = acc; ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(markX, yCp, 8, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(markX, yCp, 2.5, 0, 7); ctx.fill();
  ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(cx, yCp); ctx.lineTo(markX - 9, yCp); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillText(`CP ${fmt(an.cp, 2)} m`, markX + 14, yCp + (Math.abs(yCp - yCg) < 16 ? 16 : 0));
  const dx = cx - Math.max(r, 0.36 * sc) - 44; ctx.strokeStyle = muted; ctx.fillStyle = muted; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(dx, top); ctx.lineTo(dx, top + veh.L * sc); ctx.stroke();
  for (const y of [top, top + veh.L * sc]) { ctx.beginPath(); ctx.moveTo(dx - 6, y); ctx.lineTo(dx + 6, y); ctx.stroke(); }
  ctx.save(); ctx.translate(dx - 10, top + veh.L * sc / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(`${fmt(veh.L, 1)} m`, 0, 0); ctx.restore();
  // stage boundaries and labels
  const S = segs();
  if (S.length > 1) {
    ctx.font = `600 14px ${css('--cond')}`; ctx.textAlign = 'right';
    S.forEach(([a, b], k) => {
      const it0 = veh.items[a], it1 = veh.items[b - 1]; if (!it0 || !it1) return;
      const y0 = top + it0.sTop * sc, y1 = top + it1.sBot * sc, x = dx - 28;
      if (a > 0) { ctx.strokeStyle = acc; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x - 30, y0); ctx.lineTo(cx - r - 4, y0); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = k + 1 === activeStage ? acc : muted;
      ctx.fillText(`Stage ${k + 1}`, x, (y0 + y1) / 2);
    });
  }
}
$('#bcv').addEventListener('click', e => {
  if (!bGeom) return; const rc = e.target.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
  const s = (y - bGeom.top) / bGeom.sc, lat = Math.abs(x - bGeom.cx) / bGeom.sc;
  if (an.veh.fins && lat > DIAM / 2 && lat < DIAM / 2 + 0.6 && Math.abs(s - an.veh.sFin) < 0.5) { selected = 'fins'; return update(); }
  if (lat > DIAM / 2 + 0.1) { selected = null; return update(); }
  const i = an.veh.items.findIndex(it => s >= it.sTop && s < it.sBot); selected = i >= 0 ? i : null;
  if (i >= 0) activeStage = stageOfIndex(i) || 1;
  update();
});
window.addEventListener('resize', () => { if (!$('#flight').classList.contains('hidden')) resizeFlight(); else if (screen === 'build') drawBuilder(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => drawBuilder());

// ---------- Program editor ----------
const codeEl = $('#code');
function refreshGutter(errLine = progCheck && !progCheck.ok ? progCheck.error.line : null) {
  const n = codeEl.value.split('\n').length;
  let s = ''; for (let i = 1; i <= n; i++) s += (i === errLine ? `<span class="err">${i}</span>` : i) + '\n';
  $('#gutter').innerHTML = s; $('#gutter').scrollTop = codeEl.scrollTop;
}
codeEl.addEventListener('scroll', () => { $('#gutter').scrollTop = codeEl.scrollTop; });
codeEl.addEventListener('input', () => { prog.code = codeEl.value; progCheck = null; refreshGutter(null); clearTimeout(codeEl.t); codeEl.t = setTimeout(persist, 400); });
codeEl.addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); document.execCommand ? document.execCommand('insertText', false, '  ') : null; }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); checkUI(); }
  else if (e.key === 'Escape') codeEl.blur();
});
function gotoLine(line) {
  const lines = codeEl.value.split('\n'); let pos = 0; for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  codeEl.focus(); codeEl.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
  codeEl.scrollTop = Math.max(0, (line - 5) * parseFloat(getComputedStyle(codeEl).lineHeight));
}
function renderExamples() {
  $('#examples').innerHTML = EXAMPLE_PROGRAMS.map(e => `<button class="excard ${e.id === prog.exampleId ? 'on' : ''}" data-id="${e.id}"><strong>${esc(e.title)}</strong><small>${esc(e.summary)}</small>${e.design ? `<em>${REFERENCE_DESIGNS[e.design].name} rocket, Mission ${e.mission}</em>` : ''}</button>`).join('');
  $('#examples').querySelectorAll('button').forEach(b => b.onclick = () => loadExample(b.dataset.id));
}
function loadExample(exId) {
  const ex = EXAMPLE_PROGRAMS.find(e => e.id === exId); if (!ex) return;
  if (prog.code !== ex.code && prog.code.trim() && !prog.exampleId && !confirm('Replace your program with this example? Save your design first if you want to keep it.')) return;
  prog = { code: ex.code, exampleId: ex.id }; codeEl.value = ex.code; progCheck = null; refreshGutter();
  if (ex.design) { const r = REFERENCE_DESIGNS[ex.design]; design = { name: r.name, stack: [...r.stack], fins: r.fins }; $('#dname').value = r.name; selected = null; }
  if (ex.mission) { missionId = ex.mission; renderMissionSel(); }
  useProg = true; $('#useProg').checked = true;
  $('#progTitle').textContent = ex.title;
  renderExamples(); update();
  $('#output').innerHTML = `<span class="muted">Loaded "${esc(ex.title)}"${ex.design ? ` with the ${REFERENCE_DESIGNS[ex.design].name} rocket and Mission ${ex.mission}` : ''}. Press Test flight to fly it instantly, or Go to launch pad to watch.</span>`;
}
function renderApiRef() {
  const dl = rows => `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  $('#apiRef').innerHTML = `<div class="api">
    <p class="muted small-p">Your program sees one object, <code>ship</code>. It can read the vehicle and give commands. The physics stays out of reach.</p>
    <h3>Commands</h3>${dl(SHIP_API.commands)}
    <h3>Waiting</h3>${dl(SHIP_API.waits)}
    <h3>Readings</h3><div class="rd">${SHIP_API.readings.map(([k, v]) => `<code>ship.${k}</code><span>${esc(v)}</span>`).join('')}</div>
    <h3>Rules</h3><dl><dd>Everything is in SI units: metres, seconds, kilograms, newtons. Angles are in degrees.</dd>
      <dd>Math.random is seeded, so every flight of the same program is identical. Date, timers and the page are not available.</dd>
      <dd>A loop that waits for something must contain a yield, or the flight computer halts the program.</dd></dl></div>`;
}
function showCheck(res) {
  progCheck = res; refreshGutter();
  if (res.ok) $('#output').innerHTML = `<span class="ok">Program compiles. No problems found.</span> <span class="muted">Press Test flight to fly it.</span>`;
  else {
    $('#output').innerHTML = `<div class="bad">${esc(res.error.message)}${res.error.line ? ` <button class="linkbtn" id="gotoErr">Line ${res.error.line}</button>` : ''}</div>`;
    if (res.error.line) $('#gotoErr').onclick = () => gotoLine(res.error.line);
  }
}
function checkUI() {
  if (!EVAL_OK) { $('#output').innerHTML = '<div class="bad">This page\'s security settings block running custom code. Open index.html from the project folder to use flight programs.</div>'; return null; }
  const res = checkProgram(codeEl.value); showCheck(res); return res;
}
$('#checkBtn').onclick = checkUI;
$('#useProg').onchange = e => { useProg = e.target.checked; persist(); renderAnalysis(); };

let testRun = null;
function testFlight() {
  const res = checkUI(); if (!res || !res.ok) return;
  const a = analyze(design, missionId);
  if (!a.valid) { $('#output').innerHTML = `<div class="bad">The rocket has ${a.issues.filter(i => i.level === 'error').length} design problem(s). Fix them on the Build tab first.</div>`; return; }
  const f = new Flight(design, { program: codeEl.value, mission: missionId }), orbit = f.mission.objective.type === 'orbit', maxT = missionId === 'M007' ? 12000 : orbit ? 3600 : 1500;
  const token = {}; testRun = token;
  $('#output').innerHTML = `<div>Simulating the flight at 100 Hz…</div><div class="progress"><div id="prog"></div></div>`;
  let extra = null;
  const chunk = () => {
    if (testRun !== token) return;
    const t0 = performance.now();
    while (!f.done && f.t < maxT && performance.now() - t0 < 30) {
      for (let i = 0; i < 500 && !f.done; i++) f.advance(0.01);
      if (extra === null && (f.missionState !== 'pending' || (!orbit && f.ballistic))) extra = f.t + 2;
      if (extra !== null && f.t >= extra) break;
      if (orbit && f.program.status !== 'running' && f.throttle === 0 && f.missionState === 'pending' && f.t > 60 && f.d.peri < 0 && f.d.vr < 0 && f.t - (f.apogeeT ?? f.t) > 30) break;
    }
    const p = $('#prog'); if (p) p.style.width = Math.min(100, f.t / maxT * 100) + '%';
    if (!f.done && f.t < maxT && !(extra !== null && f.t >= extra) && !(orbit && f.program.status !== 'running' && f.throttle === 0 && f.missionState === 'pending' && f.t > 60 && f.d.peri < 0 && f.d.vr < 0 && f.t - (f.apogeeT ?? f.t) > 30)) return setTimeout(chunk, 0);
    showTestResult(f, a);
  };
  setTimeout(chunk, 0);
}
function showTestResult(f, a) {
  const R = flightReport(f, a), o = f.mission.objective;
  if (R.success) markDone(f.mission.id);
  const evs = f.events.filter(e => e.kind !== 'info' || /separation|ignition|cut-off|burnout|depleted|Apogee|Lift-off|Orbit/.test(e.msg)).slice(0, 40)
    .map(e => `T+${fmt(e.t - (f.liftoffT ?? 0), 1).padStart(6)}  ${e.msg}`).join('\n');
  const nums = o.type === 'orbit' ? `Periapsis ${f.d.peri > -RE * 0.9 ? fmt(f.d.peri / 1000, 1) + ' km' : 'none'}, apoapsis ${Number.isFinite(f.d.apo) ? fmt(f.d.apo / 1000, 1) + ' km' : 'escape'}, ${fmt(f.prop)} kg propellant left in stage ${f.stageNo}`
    : `Peak altitude ${fmt(f.max.alt / 1000, 1)} km, target ${o.value / 1000} km`;
  $('#output').innerHTML = `<div class="res"><div>
      <div class="${R.success ? 'ok' : 'bad'}" style="font-weight:600;font-size:15px">${R.success ? 'Mission complete' : 'Mission failed'}: ${esc(R.cause)}</div>
      <div class="muted" style="margin-top:4px">${nums}. Simulated ${fmt(f.t / 60, 1)} minutes of flight.</div>
      ${f.program.error ? `<div class="bad" style="margin-top:6px">${esc(f.program.error.message)}${f.program.error.line ? ` <button class="linkbtn" id="gotoErr">Line ${f.program.error.line}</button>` : ''}</div>` : ''}
      <div class="evs">${esc(evs)}</div>
      <div class="acts"><button class="btn primary" id="watchBtn">Watch this flight</button><button class="btn" id="repBtn">Full report</button></div>
    </div><canvas id="miniTraj" width="220" height="130" aria-label="Trajectory of the test flight"></canvas></div>`;
  if (f.program.error && f.program.error.line) { $('#gotoErr').onclick = () => gotoLine(f.program.error.line); refreshGutter(f.program.error.line); }
  $('#watchBtn').onclick = () => { useProg = true; $('#useProg').checked = true; startFlight(); };
  $('#repBtn').onclick = () => { F = f; fAn = a; reportFrom = 'program'; openReport(); };
  drawMiniTraj($('#miniTraj'), f);
}
$('#testBtn').onclick = testFlight;
function drawMiniTraj(cv, f) {
  const W = 220, H = 130, dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css('--panel-2'); ctx.fillRect(0, 0, W, H);
  const tl = f.tele, maxA = Math.max(...tl.map(s => s.alt), 1000) * 1.12, maxD = Math.max(...tl.map(s => Math.abs(s.down)), 1000) * 1.05;
  const X = v => 10 + Math.abs(v) / maxD * (W - 20), Y = v => H - 14 - Math.max(0, v) / maxA * (H - 30);
  ctx.strokeStyle = css('--line'); ctx.beginPath(); ctx.moveTo(10, H - 14); ctx.lineTo(W - 10, H - 14); ctx.stroke();
  let st = 1;
  ctx.lineWidth = 2; ctx.beginPath();
  tl.forEach((s, i) => { if (s.stage !== st) { ctx.stroke(); ctx.beginPath(); st = s.stage; } ctx.strokeStyle = st === 1 ? css('--accent') : css('--data'); i ? ctx.lineTo(X(s.down), Y(s.alt)) : ctx.moveTo(X(s.down), Y(s.alt)); });
  ctx.stroke();
  ctx.fillStyle = css('--muted'); ctx.font = '11px ' + css('--font'); ctx.fillText(`${fmt(maxA / 1.12 / 1000)} km up, ${fmt(maxD / 1.05 / 1000)} km downrange`, 10, 13);
}

// ---------- Flight ----------
let F = null, fAn = null, warp = 1, lastFrame = 0, accum = 0, hudTick = 0, logCount = 0, particles = [], stars = [], boom = null, reportShown = false, running = false;
let armed = true, mapOn = false, mapZoom = 1, bannerKey = '', reportFrom = 'build';
let fxEv = 0, pendingSep = false, cautionOn = false; // effects bookkeeping (presentation only)
const WARPS = [1, 2, 5, 10, 25, 50, 100, 1000, 10000];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function buildWarp() {
  $('#warp').innerHTML = WARPS.map(w => `<button class="btn ${w === warp ? 'on' : ''}" data-w="${w}">${w >= 1000 ? w / 1000 + 'k' : w}×</button>`).join('');
  $('#warp').querySelectorAll('button').forEach(b => b.onclick = () => setWarp(+b.dataset.w));
}
function setWarp(w) { warp = w; buildWarp(); }
const programActive = () => F && F.program && (F.program.status === 'running' || F.program.status === 'ready');
function startFlight() {
  const withProg = useProg && EVAL_OK && checkProgram(prog.code).ok;
  if (useProg && !withProg) { showScreen('program'); checkUI(); flash('Fix the flight program, or turn off "Fly with this program".'); return; }
  F = new Flight(design, { program: withProg ? prog.code : null, mission: missionId }); fAn = analyze(design, missionId);
  warp = 1; accum = 0; logCount = 0; boom = null; reportShown = false; bannerKey = ''; mapOn = false; mapZoom = 1; armed = !withProg;
  fxEv = 0; pendingSep = false; FX.clear(); SFX.unlock(); syncSoundBtn();
  $('#log').innerHTML = ''; $('#banner').classList.add('hidden'); $('#modal').classList.add('hidden'); $('#mapcv').classList.add('hidden');
  $('#app').classList.add('hidden'); $('#flight').classList.remove('hidden');
  $('#thr').value = 100; $('#thrVal').textContent = '100%'; $('#attSel').value = F.sas ? 'pitch' : 'off';
  syncControls(); buildWarp();
  stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.4 + 0.3 }));
  particles = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), l: Math.random() }));
  if (withProg) showBanner('Flight program loaded', 'The program will fly the whole mission. Press Space or Start program to begin.', 'Start program', startProgram);
  else showBanner('On the pad', F.veh.eng.type === 'liquid' ? 'Press Space or Ignite. Stage with G once a stage has burned out.' : 'Press Space or Ignite. A solid motor burns to the end once lit.');
  resizeFlight(); running = true; lastFrame = performance.now(); requestAnimationFrame(loop);
}
function startProgram() { armed = true; $('#banner').classList.add('hidden'); }
function showBanner(h, p, btn, fn, btn2, fn2) {
  const b = $('#banner'); b.innerHTML = `<h2>${h}</h2><div>${p}</div>` + (btn ? `<div style="margin-top:10px;display:flex;gap:8px;justify-content:center"><button class="btn primary" id="bannerBtn">${btn}</button>${btn2 ? `<button class="btn" id="bannerBtn2">${btn2}</button>` : ''}</div>` : '');
  b.classList.remove('hidden'); if (btn) $('#bannerBtn').onclick = fn || openReport; if (btn2) $('#bannerBtn2').onclick = fn2;
}
function syncControls() {
  const e = F.veh.eng, liquid = e && e.type === 'liquid', auto = programActive();
  $('#thrCtl').style.display = liquid ? '' : 'none';
  $('#pl').style.display = liquid || F.veh.wheelTorque ? '' : 'none'; $('#pr').style.display = $('#pl').style.display;
  $('#attSel').style.display = F.veh.hasComputer ? '' : 'none';
  $('#stageBtn').style.display = F.stack.some((id, i) => i > 0 && PARTS[id].cat === 'decoupler') ? '' : 'none';
  const lit = F.engine === 'running' || F.engine === 'ignition';
  $('#igniteBtn').classList.toggle('hidden', lit || !F.canIgnite());
  $('#cutBtn').classList.toggle('hidden', !(lit && liquid));
  $('#takeBtn').classList.toggle('hidden', !auto);
  for (const b of ['#igniteBtn', '#cutBtn', '#stageBtn', '#pl', '#pr', '#attSel', '#thr']) $(b).disabled = auto;
  if (document.activeElement !== $('#attSel')) $('#attSel').value = !F.sas ? 'off' : F.attMode === 'retrograde' ? 'prograde' : F.attMode;
  if (auto) { $('#thr').value = Math.round(F.throttleCmd * 100); $('#thrVal').textContent = $('#thr').value + '%'; }
}
function resizeFlight() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const c of ['#fcv', '#mapcv']) { const cv = $(c); cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; }
}
function manual(what, fn) {
  if (!F) return;
  if (programActive()) { flashFlight('The flight program has control. Press Take manual control first.'); return; }
  F.manual(what); fn(); syncControls();
}
function flashFlight(msg) { const d = document.createElement('div'); d.className = 'bad'; d.innerHTML = `<b>Note</b>${esc(msg)}`; $('#log').prepend(d); }
function doIgnite() { manual('ignite', () => { F.ignite(); $('#banner').classList.add('hidden'); }); }
$('#igniteBtn').onclick = doIgnite;
$('#cutBtn').onclick = () => manual('cut-off', () => F.shutdown());
$('#stageBtn').onclick = () => manual('stage', () => F.stage());
$('#thr').oninput = e => manual('throttle', () => { F.setThrottle(e.target.value / 100); $('#thrVal').textContent = e.target.value + '%'; });
$('#attSel').onchange = e => manual('attitude', () => {
  const v = e.target.value; F.sas = v !== 'off';
  if (v === 'pitch') F.setPitch(Math.max(0, Math.min(90, F.d.pitch))); else if (v !== 'off') F.setMode(v);
});
$('#takeBtn').onclick = () => { if (!F || !F.program) return; F.program.stop('Pilot took manual control'); F.manual('take-over'); armed = true; syncControls(); };
$('#soundBtn').onclick = () => { SFX.toggle(); syncSoundBtn(); };
$('#endBtn').onclick = () => { if (F && !F.done) { F.userEnded = true; F.end(); } openReport(); };
$('#mapBtn').onclick = () => { mapOn = !mapOn; $('#mapcv').classList.toggle('hidden', !mapOn); $('#mapBtn').classList.toggle('on', mapOn); resizeFlight(); };
$('#mapcv').addEventListener('wheel', e => { e.preventDefault(); mapZoom = Math.max(1, Math.min(60, mapZoom * (e.deltaY < 0 ? 1.25 : 0.8))); }, { passive: false });
const hold = (el, v) => {
  const on = e => { e.preventDefault(); if (programActive()) return flashFlight('The flight program has control. Press Take manual control first.'); if (F) { F.manual('pitch'); F.pitchInput = v; } }, off = () => { F && (F.pitchInput = 0); };
  el.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => el.addEventListener(t, off));
};
hold($('#pl'), -1); hold($('#pr'), 1);
window.addEventListener('keydown', e => {
  if ($('#flight').classList.contains('hidden') || !F) return;
  if (!$('#modal').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); if (!armed) startProgram(); else doIgnite(); }
  else if (k === 'g') $('#stageBtn').click();
  else if (k === 'm') $('#mapBtn').click();
  else if (k === 'n') $('#soundBtn').click();
  else if (k === 'w' || k === 's') { if (programActive()) return flashFlight('The flight program has control.'); const t = $('#thr'); t.value = +t.value + (k === 'w' ? 5 : -5); t.oninput({ target: t }); }
  else if (k === 'a' || k === 'arrowleft' || k === 'd' || k === 'arrowright') { if (programActive()) return; if (!F.pitchInput) F.manual('pitch'); F.pitchInput = (k === 'a' || k === 'arrowleft') ? -1 : 1; }
  else if (k === 'x') $('#cutBtn').click();
  else if (k === '.' || k === ',') { const i = WARPS.indexOf(warp) + (k === '.' ? 1 : -1); setWarp(WARPS[Math.max(0, Math.min(WARPS.length - 1, i))]); }
  else if (k === 'escape') $('#endBtn').click();
});
window.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (F && ['a', 'd', 'arrowleft', 'arrowright'].includes(k)) F.pitchInput = 0; });

function loop(now) {
  if (!running) return;
  const real = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  if (!F.done && armed) {
    accum += real * warp; const t0 = performance.now();
    while (accum >= 0.01 && !F.done && performance.now() - t0 < 14) { const k = F.advance(0.01); accum -= 0.01 * k; }
    if (accum > 0.5) accum = 0.5; // the computer could not keep up with this warp; play slower rather than stutter
    if (F.done) {
      accum = 0; setWarp(1);
      const impact = !F.failure && F.liftoffT !== null && F.d.alt <= 1 && !F.userEnded;
      if (F.failure || impact) { boom = { t: now, pending: true, ground: impact || F.d.alt < 50 }; SFX.explosion(Math.min(1, F.d.p / P0)); $('#banner').classList.add('hidden'); bannerKey = 'boom'; }
    }
  }
  fxEvents();
  const e = F.veh.eng, running_ = F.throttle > 0 && F.prop > 0 && !F.done;
  SFX.update({ thrust: running_ && e ? F.d.thrust / e.tvac : 0, air: F.d.p / P0, q: F.done ? 0 : F.d.q, mach: F.d.mach, solid: !!e && e.type === 'solid', warp });
  const a = F._aux, caution = !F.done && !F.clamped && armed && (F.d.q > 0.85 * F.veh.qMax || (F.veh.payloads.length && F.sensedG > 0.85 * F.veh.gMax) || (a && F.d.q > 2000 && a.sina * F.d.q > 0.8 * LIMITS.qAlpha));
  if (caution) SFX.alarm();
  if (caution !== cautionOn) { cautionOn = caution; $('#caution').classList.toggle('hidden', !caution); }
  if (mapOn) drawMap(); else renderFlight(real, now);
  if (++hudTick % 3 === 0) renderHud();
  if (F.done && !reportShown && (!boom || now - boom.t > 2800)) { reportShown = true; setTimeout(openReport, 250); }
  requestAnimationFrame(loop);
}

// One-shot sounds from the flight's own event log, so nothing is missed at high time warp.
function fxEvents() {
  while (fxEv < F.events.length) {
    const m = F.events[fxEv++].msg, air = Math.min(1, F.d.p / P0);
    if (/ignition$|separation$/i.test(m) && warp > 100) setWarp(10); // slow down so a short burn is visible
    if (/ignition$/i.test(m)) SFX.ignition(air);
    else if (/ separation$/.test(m)) { SFX.separation(); pendingSep = true; }
    else if (/cut-off|burnout|depleted/i.test(m)) SFX.cutoff(air);
    else if (m === 'Supersonic') SFX.sonicBoom();
    else if (m === F.mission.successMsg) SFX.chime();
  }
}
function syncSoundBtn() {
  const b = $('#soundBtn'); if (!b) return;
  b.textContent = SFX.enabled ? 'Sound on' : 'Sound off'; b.setAttribute('aria-pressed', SFX.enabled); b.classList.toggle('on', SFX.enabled);
  if (!SFX.available) { b.disabled = true; b.textContent = 'No sound'; }
}
function mix(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = i => Math.round(((pa >> i) & 255) * (1 - t) + ((pb >> i) & 255) * t); return `rgb(${c(16)},${c(8)},${c(0)})`; }
function renderFlight(real, now) {
  const cv = $('#fcv'), ctx = cv.getContext('2d'), dpr = cv.width / cv.clientWidth, W = cv.clientWidth, H = cv.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const d = F.d, alt = Math.max(0, d.alt), veh = F.veh, mp = F.mp || massProps(veh, F.prop);
  const t = Math.min(1, Math.pow(Math.max(0, alt) / 70000, 0.6));
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mix('#3F7EC4', '#000004', t)); g.addColorStop(1, mix('#A9D0EE', '#070B18', Math.min(1, t * 1.1)));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const sa = Math.min(1, Math.max(0, (alt - 25000) / 30000));
  if (sa > 0) { ctx.fillStyle = '#fff'; for (const s of stars) { ctx.globalAlpha = sa * (0.4 + 0.6 * s.s / 1.7); ctx.fillRect(s.x * W, s.y * H, s.s, s.s); } ctx.globalAlpha = 1; }
  const la = Math.min(1, Math.max(0, (alt - 6000) / 12000));
  if (la > 0) {
    const k = Math.min(1, alt / 200000), R = W * (6 - 4.8 * k), topY = H * (0.8 + 0.12 * k), cy = topY + R;
    ctx.globalAlpha = la;
    const glow = ctx.createRadialGradient(W / 2, cy, R, W / 2, cy, R + 40);
    glow.addColorStop(0, 'rgba(120,180,255,.55)'); glow.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(W / 2, cy, R + 40, 0, 7); ctx.fill();
    const pg = ctx.createLinearGradient(0, topY, 0, H); pg.addColorStop(0, '#2F6FA8'); pg.addColorStop(0.3, '#1D4C7C'); pg.addColorStop(1, '#10304F');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(W / 2, cy, R, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  const [kx, ky] = FX.offset(); ctx.translate(kx, ky);
  const L = Math.max(veh.L, 6), sc = Math.min(H * 0.3, 210) / L, cx = W / 2, cy = H * 0.52;
  let shx = 0, shy = 0;
  if (!reduceMotion && !F.done && F.throttle > 0) { const s = Math.min(3, d.q / 20000 + (F.clamped ? 1.5 : 0)); shx = (Math.random() - 0.5) * s; shy = (Math.random() - 0.5) * s; }
  const groundY = cy + (alt * sc) + (veh.L - mp.cg) * sc;
  if (groundY < H + 20) {
    const padX = cx - d.downrange * sc + shx;
    ctx.fillStyle = '#56684F'; ctx.fillRect(0, groundY, W, H - groundY + 10);
    ctx.fillStyle = '#8B8F93'; ctx.fillRect(padX - DIAM * sc * 3, groundY - 4, DIAM * sc * 6, 6);
    ctx.strokeStyle = '#B04A2F'; ctx.lineWidth = 2; const tx = padX - DIAM * sc * 1.6, th = F.design ? buildVehicle(F.design).L * sc * 1.05 : L * sc;
    ctx.strokeRect(tx - 10, groundY - th, 10, th);
    for (let y = groundY - th; y < groundY; y += 14) { ctx.beginPath(); ctx.moveTo(tx - 10, y); ctx.lineTo(tx, y + 14); ctx.stroke(); }
    if (F.throttle > 0 && F.prop > 0 && !F.done && alt < 600) for (let i = 0; i < 3; i++) FX.padSmoke({ x: padX, y: groundY, strength: F.throttle * (1 - alt / 600) });
  }
  const dens = Math.min(1, Math.sqrt(d.rho / 1.225)), vp = d.velPitch * DEG;
  if (dens > 0.02 && d.speed > 5 && !F.clamped) {
    const spd = Math.min(d.speed * sc, 2200) * real, dxp = -Math.cos(vp), dyp = Math.sin(vp), len = Math.min(120, 6 + d.speed * 0.08);
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * dens * Math.min(1, d.speed / 200)})`; ctx.lineWidth = 1;
    for (const p of particles) {
      p.x += dxp * spd / W; p.y += dyp * spd / H; p.x = (p.x % 1 + 1) % 1; p.y = (p.y % 1 + 1) % 1;
      const x = p.x * W, y = p.y * H; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - dxp * len * (0.5 + p.l), y - dyp * len * (0.5 + p.l)); ctx.stroke();
    }
  }
  // spent stages falling away, drawn at their true positions relative to the vehicle
  const fr = F.localFrame(F.x, F.y);
  for (const db of F.debris) {
    if (!db.alive) continue;
    const rx = db.x - F.x, ry = db.y - F.y, east = rx * fr.ex + ry * fr.ey, up = rx * fr.ux + ry * fr.uy;
    const X = cx + east * sc, Y = cy - up * sc; if (X < -200 || X > W + 200 || Y < -400 || Y > H + 400) continue;
    const dmp = massProps(db.veh, 0);
    ctx.save(); ctx.translate(X, Y); ctx.rotate((90 - F.pitchOf(db.th, db.x, db.y)) * DEG); ctx.translate(0, -dmp.cg * sc); ctx.globalAlpha = 0.9; drawRocket(ctx, db.veh, sc); ctx.restore(); ctx.globalAlpha = 1;
  }
  if (!boom) {
    ctx.save(); ctx.translate(cx + shx, cy + shy); ctx.rotate((90 - d.pitch) * DEG); ctx.translate(0, -mp.cg * sc);
    if (F.throttle > 0 && F.prop > 0) drawPlume(ctx, veh, sc, d);
    drawRocket(ctx, veh, sc);
    ctx.restore();
    if (d.speed > 20 && !F.clamped) {
      const R = L * sc * 0.72, x = cx + Math.cos(vp) * R, y = cy - Math.sin(vp) * R;
      ctx.strokeStyle = '#8FE0BE'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke();
      for (const a of [0, Math.PI / 2, Math.PI]) { ctx.beginPath(); ctx.moveTo(x + Math.cos(a - vp) * 7, y + Math.sin(a - vp) * 7); ctx.lineTo(x + Math.cos(a - vp) * 13, y + Math.sin(a - vp) * 13); ctx.stroke(); }
    }
  }
  // effects: exhaust trail in the lower atmosphere, separation puffs, explosions
  const ang = (90 - d.pitch) * DEG, tail = h => [cx - Math.sin(ang) * h, cy + Math.cos(ang) * h];
  if (!boom && F.throttle > 0 && F.prop > 0 && !F.clamped && dens > 0.25) {
    const [tx, ty] = tail((veh.L - mp.cg) * sc + 6), sp = Math.min(500, d.speed * sc * 0.5);
    FX.trail({ x: tx, y: ty, vx: -Math.cos(vp) * sp, vy: Math.sin(vp) * sp, strength: (veh.eng.type === 'solid' ? 0.9 : 0.3) * dens });
  }
  if (pendingSep) { pendingSep = false; const [jx, jy] = tail((veh.L - mp.cg) * sc); FX.separation({ x: jx, y: jy, angle: ang, sc }); }
  if (boom && boom.pending) {
    boom.pending = false;
    const y = boom.ground ? Math.min(groundY, cy + (veh.L - mp.cg) * sc) : cy;
    FX.explode({ x: cx, y, air: Math.min(1, d.p / P0), sc, angle: ang, ground: boom.ground,
      pieces: veh.items.map(it => ({ len: it.def.len, cat: it.def.cat, carbon: it.id.startsWith('tank_c') })) });
  }
  FX.draw(ctx, real, W, H);
}
function drawPlume(ctx, veh, sc, d) {
  const solid = veh.eng.type === 'solid', r = DIAM / 2 * sc, exp = 1 + 2.2 * (1 - Math.min(1, d.p / P0));
  const len = veh.L * sc * (0.45 + 0.55 * F.throttle) * (0.9 + 0.2 * Math.random()) * (0.8 + 0.5 * (exp - 1) / 2.2);
  const w0 = r * 0.8, w1 = r * (solid ? 1.2 : 0.9) * exp, y0 = veh.L * sc;
  const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
  if (solid) { g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.25, 'rgba(255,200,110,.95)'); g.addColorStop(1, 'rgba(255,120,40,0)'); }
  else if (veh.eng.ispSL < 200) { g.addColorStop(0, 'rgba(235,240,255,1)'); g.addColorStop(0.25, 'rgba(160,190,255,.7)'); g.addColorStop(1, 'rgba(120,150,255,0)'); }
  else { g.addColorStop(0, 'rgba(255,245,220,1)'); g.addColorStop(0.2, 'rgba(255,178,80,.9)'); g.addColorStop(1, 'rgba(255,90,30,0)'); }
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-w0, y0); ctx.quadraticCurveTo(-w1 * 1.1, y0 + len * 0.4, 0, y0 + len); ctx.quadraticCurveTo(w1 * 1.1, y0 + len * 0.4, w0, y0); ctx.closePath(); ctx.fill();
  if (d.p > 20000 && F.clamped === false && d.alt < 8000 && solid) {
    ctx.fillStyle = 'rgba(230,230,230,.25)'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc((Math.random() - 0.5) * r * 2, y0 + len + i * r * 1.2, r * (1 + i * 0.5), 0, 7); ctx.fill(); }
  }
}

// ---------- Map view: the true shape of the orbit around Earth ----------
function conicPoints(x, y, vx, vy, n = 360) {
  const r = Math.hypot(x, y), v2 = vx * vx + vy * vy, h = x * vy - y * vx, rv = x * vx + y * vy;
  const ex = ((v2 - MU / r) * x - rv * vx) / MU, ey = ((v2 - MU / r) * y - rv * vy) / MU, e = Math.hypot(ex, ey);
  const p = h * h / MU, w = Math.atan2(ey, ex), sgn = Math.sign(h) || 1, pts = [];
  for (let i = 0; i <= n; i++) {
    const nu = i / n * 2 * Math.PI; const den = 1 + e * Math.cos(nu); if (den <= 0.02) { pts.push(null); continue; }
    const rr = p / den; if (rr > RE * 30) { pts.push(null); continue; }
    const ang = w + sgn * nu; pts.push([rr * Math.cos(ang), rr * Math.sin(ang)]);
  }
  return { pts, e, w, sgn, p };
}
function drawMap() {
  const cv = $('#mapcv'), ctx = cv.getContext('2d'), dpr = cv.width / cv.clientWidth, W = cv.clientWidth, H = cv.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#050913'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; for (const s of stars) { ctx.globalAlpha = 0.25 + 0.4 * s.s / 1.7; ctx.fillRect(s.x * W, s.y * H, s.s, s.s); } ctx.globalAlpha = 1;
  const el = F.clamped ? null : F.orbit();
  const reach = Math.max(RE + 400000, el && el.bound && Number.isFinite(el.apo) ? RE + el.apo : 0, RE + F.max.alt) * 1.08;
  // fit between the objective chip at the top and the control bar at the bottom
  const top = 64, bottom = H - 128, midY = (top + bottom) / 2;
  const k = Math.max(180, Math.min(W > 900 ? W - 520 : W - 24, bottom - top)) * 0.5 / reach * mapZoom;
  const z = Math.min(1, (mapZoom - 1) / 4), Cx = F.x * z, Cy = F.y * z;
  const S = (x, y) => [W / 2 + (x - Cx) * k, midY - (y - Cy) * k];
  const muted = 'rgba(234,241,248,.6)', f = css('--font');
  // atmosphere and Earth
  const [ex0, ey0] = S(0, 0);
  const atm = ctx.createRadialGradient(ex0, ey0, RE * k, ex0, ey0, (RE + 100000) * k);
  atm.addColorStop(0, 'rgba(110,170,255,.45)'); atm.addColorStop(1, 'rgba(110,170,255,0)');
  ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(ex0, ey0, (RE + 100000) * k, 0, 7); ctx.fill();
  // predicted orbit, drawn before Earth so the part below ground is hidden
  if (el) {
    const { pts } = conicPoints(F.x, F.y, F.vx, F.vy);
    ctx.strokeStyle = el.peri > 100000 ? '#6CC4A1' : '#8FD3F4'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath();
    let pen = false; for (const pt of pts) { if (!pt) { pen = false; continue; } const [sx, sy] = S(...pt); pen ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); pen = true; }
    ctx.stroke(); ctx.setLineDash([]);
  }
  const eg = ctx.createRadialGradient(ex0 - RE * k * 0.3, ey0 - RE * k * 0.3, RE * k * 0.1, ex0, ey0, RE * k);
  eg.addColorStop(0, '#3C7FC0'); eg.addColorStop(0.7, '#1D4C7C'); eg.addColorStop(1, '#10304F');
  ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(ex0, ey0, RE * k, 0, 7); ctx.fill();
  // launch site, turning with Earth
  const pa = Math.PI / 2 + WE * F.t, [px, py] = S(RE * Math.cos(pa), RE * Math.sin(pa));
  ctx.fillStyle = '#F2A541'; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 7); ctx.fill();
  ctx.font = '12px ' + f; ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.fillText('Launch site', px + 7, py - 6);
  // flown path
  ctx.strokeStyle = '#F2A541'; ctx.lineWidth = 2; ctx.beginPath();
  F.tele.forEach((s, i) => { const [sx, sy] = S(s.x, s.y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
  const [vxS, vyS] = S(F.x, F.y); ctx.lineTo(vxS, vyS); ctx.stroke();
  // apsis markers
  if (el && el.bound) {
    const { e, w, sgn, p } = conicPoints(F.x, F.y, F.vx, F.vy, 4);
    const mark = (nu, label, val) => {
      const rr = p / (1 + e * Math.cos(nu)); if (rr < RE) return;
      const a = w + sgn * nu, [sx, sy] = S(rr * Math.cos(a), rr * Math.sin(a));
      ctx.fillStyle = '#EAF1F8'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill();
      const [qx, qy] = S(F.x, F.y); if (Math.hypot(sx - qx, sy - qy) < 60) return; // the vehicle is here; its label wins
      ctx.fillStyle = '#EAF1F8'; ctx.font = '13px ' + f; ctx.textAlign = sx > W / 2 ? 'left' : 'right';
      ctx.fillText(`${label} ${fmt(val / 1000, 0)} km`, sx + (sx > W / 2 ? 9 : -9), sy + 4);
    };
    if (e > 1e-4) { mark(Math.PI, 'Apoapsis', el.apo); mark(0, 'Periapsis', el.peri); }
  }
  for (const db of F.debris) if (db.alive) { const [sx, sy] = S(db.x, db.y); ctx.fillStyle = '#8B95A5'; ctx.fillRect(sx - 2, sy - 2, 4, 4); }
  // the vehicle
  const va = Math.atan2(F.vy, F.vx);
  ctx.save(); ctx.translate(vxS, vyS); ctx.rotate(-va); ctx.fillStyle = '#EAF1F8'; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, 5); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#F2A541'; ctx.font = `600 15px ${css('--cond')}`; ctx.textAlign = vxS > W / 2 ? 'left' : 'right';
  const [ox, oy] = [vxS - W / 2, vyS - midY], on = Math.hypot(ox, oy) || 1;
  ctx.fillText(design.name || 'Vehicle', vxS + ox / on * 26 + (vxS > W / 2 ? 4 : -4), vyS + oy / on * 26);
  ctx.font = '13px ' + f; ctx.fillStyle = muted; ctx.textAlign = 'center';
  ctx.fillText("Map view, to scale, looking along Earth's axis. Scroll to zoom in on the vehicle. Press M to return.", W / 2, 62);
}

function renderHud() {
  const d = F.d, tp = F.liftoffT === null ? (F.engine === 'off' ? 0 : F.t - F.ignT) : F.t - F.liftoffT;
  const hh = Math.floor(Math.abs(tp) / 3600), mm = Math.floor(Math.abs(tp) % 3600 / 60), ss = Math.floor(Math.abs(tp) % 60);
  $('#tplus').textContent = `${F.liftoffT === null ? 'T–' : 'T+'} ${hh ? hh + ':' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${warp > 1 ? `   ${warp.toLocaleString('en-US')}× time` : ''}${F.onRails ? '   coasting on rails' : ''}`;
  const altKm = Math.max(0, d.alt) / 1000;
  $('#hAlt').innerHTML = `${fmt(altKm, altKm >= 100 ? 1 : 2)}<small>km</small>`;
  const aoa = Math.asin(Math.min(1, F._aux ? F._aux.sina : 0)) / DEG;
  const qPct = Math.min(100, d.q / F.veh.qMax * 100), qCol = qPct > 80 ? '#EE6A55' : qPct > 55 ? '#E9C46A' : '#6CC4A1';
  const km = v => `${fmt(v / 1000, 1)} km`;
  const apo = F.clamped ? '—' : d.apo === Infinity ? 'escape' : km(Math.max(0, d.apo));
  const peri = F.clamped ? '—' : d.peri < -100000 ? 'inside Earth' : km(d.peri);
  const orbitish = F.mission.objective.type === 'orbit' || F.nStages > 1;
  const holding = F.sas && F.veh.hasComputer ? ({ pitch: `pitch ${fmt(F.targetPitch, 0)}°`, prograde: 'orbital prograde', surface: 'surface prograde', retrograde: 'retrograde' }[F.attMode]) : null;
  const rows = [
    ['Velocity, air', `${fmt(d.speed)} m/s`], ...(orbitish ? [['Velocity, orbital', `${fmt(d.orbitalSpeed)} m/s`]] : []),
    ['Vertical speed', `${fmt(d.vr)} m/s`], ['Acceleration', `${fmt(F.sensedG || 0, 1)} g`],
    ['Dynamic pressure', `${fmt(d.q / 1000, 1)} kPa`], ['meter', qPct, qCol],
    ['Angle of attack', d.speed > 20 ? fmt(aoa, 1) + '°' : '—'],
    ['Pitch', `${fmt(d.pitch, 1)}°`], ...(holding ? [['Holding', holding]] : []),
    ['Thrust', `${fmt(d.thrust / 1000, 1)} kN`], ['Thrust-to-weight', fmt(d.twr, 2)], ['Mass', `${fmt(d.mass)} kg`],
    ['Stage propellant', `${fmt(d.fuel * 100)}%`], ['meter', d.fuel * 100, '#F2A541'],
    [orbitish ? 'Apoapsis' : 'Predicted apogee', apo], ...(orbitish ? [['Periapsis', peri], ['Time to apoapsis', F.clamped || !Number.isFinite(d.timeToApo) ? '—' : `${fmt(d.timeToApo)} s`]] : []),
    ['Downrange', `${fmt(Math.abs(d.downrange) / 1000, 1)} km${Math.abs(d.downrange) > 100 ? (d.downrange > 0 ? ' east' : ' west') : ''}`]];
  $('#readouts').innerHTML = rows.map(r => r[0] === 'meter' ? `<span style="grid-column:1/3" class="meter"><div style="width:${r[1]}%;background:${r[2]}"></div></span>`
    : `<span class="k">${r[0]}</span><span class="v">${r[1]}</span>`).join('');
  // stage box
  const e = F.veh.eng, stateTxt = { off: 'ready', ignition: 'igniting', running: 'running', shutdown: 'shut down', burnout: 'burned out' }[F.engine];
  $('#stagebox').innerHTML = `<b>Stage ${F.stageNo} of ${F.nStages}</b><div>${e ? esc(e.name) : 'No engine'}${e ? `, ${stateTxt}` : ''}</div>` +
    (e && e.type === 'liquid' && !['running', 'ignition'].includes(F.engine) ? `<div class="muted">${F.ignitionsLeft ? `${F.ignitionsLeft} ignition${F.ignitionsLeft === 1 ? '' : 's'} left` : 'No restarts left'}</div>` : '') +
    `<div class="stagebar">${Array.from({ length: F.nStages }, (_, i) => `<span class="${i + 1 === F.stageNo ? 'now' : i + 1 < F.stageNo ? 'gone' : ''}"></span>`).join('')}</div>`;
  const pb = $('#progbox'), P = F.program;
  if (!P) { pb.className = 'progbox'; pb.innerHTML = '<b>Manual flight</b><div class="muted">No flight program</div>'; }
  else {
    const st = P.status;
    pb.className = 'progbox ' + (st === 'error' || st === 'budget' ? 'err' : st === 'running' ? 'run' : '');
    pb.innerHTML = st === 'ready' ? '<b>Program loaded</b><div class="muted">Press Space to start</div>'
      : st === 'running' ? `<b>Program flying</b><div class="muted">${P.wait ? 'Waiting: ' + esc(P.waitingFor) : 'Steering'}</div>`
      : st === 'finished' ? '<b>Program finished</b><div class="muted">You have the controls</div>'
      : st === 'stopped' ? '<b>Manual control</b><div class="muted">Program stopped</div>'
      : `<b>Program halted</b><div>${P.error.line ? `Line ${P.error.line}: ` : ''}${esc(P.error.message).slice(0, 90)}</div>`;
  }
  syncControls();
  // objective
  const o = F.mission.objective, ob = $('#objective'); ob.classList.toggle('done', F.missionState === 'success');
  $('#objText').textContent = o.type === 'orbit'
    ? (F.missionState === 'success' ? `${F.mission.title}: complete` : `Periapsis above ${o.peri / 1000} km${o.apo ? `, apoapsis below ${o.apo / 1000} km` : ''}: ${F.clamped || d.peri < -100000 ? 'no orbit yet' : `periapsis ${fmt(d.peri / 1000, 0)} km`}`)
    : (F.missionState === 'success' ? `Payload above ${o.value / 1000} km: complete` : `Payload above ${o.value / 1000} km: ${fmt(Math.max(0, F.max.alt) / 1000, 1)} km so far`);
  if (F.missionState === 'failed') $('#objText').textContent = F.missionFailReason;
  while (logCount < F.events.length) {
    const ev = F.events[logCount++], div = document.createElement('div'); div.className = ev.kind;
    const tt = F.liftoffT === null ? 0 : ev.t - F.liftoffT;
    div.innerHTML = `<b>T${tt < 0 ? '–' : '+'}${fmt(Math.abs(tt), 1)}</b>${esc(ev.msg)}`; $('#log').prepend(div);
    while ($('#log').children.length > 9) $('#log').lastChild.remove();
  }
  // banners at the moments that matter
  if (!F.done) {
    if (F.missionState === 'success' && o.type === 'orbit' && bannerKey !== 'orbit') {
      bannerKey = 'orbit'; markDone(F.mission.id); setWarp(1);
      showBanner('In orbit', `${fmt(d.peri / 1000, 0)} × ${fmt(d.apo / 1000, 0)} km, one lap every ${fmt(d.period / 60, 1)} minutes. Open the map to see it, or read the report.`, 'View flight report', openReport, mapOn ? null : 'Open map', mapOn ? null : () => { $('#banner').classList.add('hidden'); if (!mapOn) $('#mapBtn').click(); });
    } else if (F.ballistic && o.type === 'altitude' && bannerKey !== 'apogee') {
      bannerKey = 'apogee';
      showBanner(F.reached ? 'Apogee, objective complete' : `Apogee, short of ${o.value / 1000} km`, 'The vehicle is falling back. Keep watching at high time warp, or read the report now.', 'View flight report');
    } else if (o.type === 'orbit' && F.missionState === 'pending' && F.ballistic && d.peri < 0 && bannerKey !== 'fall') {
      bannerKey = 'fall'; showBanner('Not in orbit', 'Nothing left to fire, and the periapsis is below the surface. The vehicle is falling back.', 'View flight report');
    }
  }
  if (hudTick % 15 === 0) drawTraj();
}
function drawTraj() {
  const cv = $('#traj'), ctx = cv.getContext('2d'), W = 220, H = 150, dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const o = F.mission.objective, target = o.type === 'orbit' ? o.peri : o.value;
  const tl = F.tele; const maxA = Math.max(target * 1.2, F.max.alt * 1.1), maxD = Math.max(20000, ...tl.map(s => Math.abs(s.down))) * 1.1;
  const X = v => 26 + (v / maxD) * (W - 36) * 0.5 + (W - 36) * 0.5, Y = v => H - 18 - v / maxA * (H - 30);
  ctx.font = '11px ' + css('--font'); ctx.fillStyle = 'rgba(234,241,248,.7)';
  ctx.strokeStyle = 'rgba(234,241,248,.25)'; ctx.beginPath(); ctx.moveTo(26, H - 18); ctx.lineTo(W - 10, H - 18); ctx.stroke();
  ctx.setLineDash([4, 3]); ctx.strokeStyle = '#6CC4A1'; ctx.beginPath(); ctx.moveTo(26, Y(target)); ctx.lineTo(W - 10, Y(target)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillText(`${target / 1000} km`, 28, Y(target) - 4); ctx.fillText('Altitude against downrange', 8, 13);
  // one line per stage: amber for stage 1, blue for the upper stages
  ctx.lineWidth = 2;
  let st = null;
  tl.forEach((s, i) => {
    const x = X(s.down), y = Y(Math.max(0, s.alt));
    if (s.stage !== st) {
      if (st !== null) ctx.stroke();
      st = s.stage; ctx.strokeStyle = st === 1 ? '#F2A541' : '#8FD3F4'; ctx.beginPath();
      if (i) ctx.moveTo(X(tl[i - 1].down), Y(Math.max(0, tl[i - 1].alt))); else ctx.moveTo(x, y);
    }
    ctx.lineTo(x, y);
  });
  if (st !== null) ctx.stroke();
  ctx.lineWidth = 1;
}

// ---------- Report ----------
const CH = [
  ['alt', 'Altitude', 'km', s => s.alt / 1000], ['speed', 'Velocity', 'm/s', s => s.speed], ['vorb', 'Orbital speed', 'm/s', s => s.vorb],
  ['apo', 'Apoapsis', 'km', s => s.apo === null ? NaN : Math.min(s.apo, 5e6) / 1000], ['peri', 'Periapsis', 'km (clipped at −200)', s => s.peri === null ? NaN : Math.max(s.peri, -200000) / 1000],
  ['g', 'Acceleration', 'g', s => s.g], ['q', 'Dynamic pressure', 'kPa', s => s.q / 1000], ['thrust', 'Thrust', 'kN', s => s.thrust / 1000], ['mass', 'Mass', 'kg', s => s.mass], ['pitch', 'Pitch', '°', s => s.pitch]];
let chan = 'alt';
function markDone(mid) { if (!missionsDone[mid]) { missionsDone[mid] = true; store.set('aerolab.v02.missions', missionsDone); renderMissionSel(); } }
function openReport() {
  if (!F) return; if (!F.done) F.end();
  const R = flightReport(F, fAn), o = F.mission.objective;
  if (R.success) markDone(F.mission.id);
  const li = a => a.map(x => `<li>${esc(x)}</li>`).join('');
  const stages = F.stageLog.length ? `<h3>Staging</h3><ul>${F.stageLog.map(s => `<li>Stage ${s.stage} separated at T+${fmt(s.t - (F.liftoffT ?? 0), 1)} s, ${fmt(s.alt / 1000, 1)} km, ${fmt(s.q / 1000, 1)} kPa, ${fmt(s.propLeft)} kg propellant left${s.thrusting ? ', engine still firing' : ''}</li>`).join('')}</ul>` : '';
  const P = F.program;
  const progLine = P ? `<h3>Flight program</h3><ul><li>${P.status === 'error' || P.status === 'budget' ? `Halted${P.error.line ? ` on line ${P.error.line}` : ''}: ${esc(P.error.message)}` : P.status === 'finished' ? 'Ran to the end' : P.status === 'stopped' ? 'Stopped by the pilot' : 'Still running when the flight ended'}. ${F.manualInputs} manual input${F.manualInputs === 1 ? '' : 's'}.</li></ul>` : '';
  $('#repL').innerHTML = `<div class="verdict ${R.success ? 'good' : 'bad'}" id="verdict">${R.success ? 'Mission complete' : 'Mission failed'}</div>
    <div class="muted" style="font-size:13.5px;margin-bottom:4px">Mission ${F.mission.id}: ${esc(F.mission.title)}</div>
    <div class="cause">${esc(R.cause)}</div>
    <h3>Evidence</h3><ul>${li(R.evidence)}</ul>
    ${R.factors.length ? `<h3>Contributing factors</h3><ul>${li(R.factors)}</ul>` : ''}
    ${stages}${progLine}
    <h3>${R.success ? 'Next' : 'What to try'}</h3><ul>${li(R.fixes)}</ul>`;
  const st = o.type === 'orbit'
    ? [[F.d.peri > -100000 ? fmt(F.d.peri / 1000, 1) + ' km' : '—', 'Periapsis'], [Number.isFinite(F.d.apo) ? fmt(F.d.apo / 1000, 1) + ' km' : '—', 'Apoapsis'], [fmt(Math.max(...F.tele.map(s => s.vorb || 0))) + ' m/s', 'Peak orbital speed'], [fmt(F.max.q / 1000, 1) + ' kPa', 'Max Q']]
    : [[fmt(F.max.alt / 1000, 1) + ' km', 'Peak altitude'], [fmt(F.max.q / 1000, 1) + ' kPa', 'Max Q'], [fmt(F.max.g, 1) + ' g', 'Peak acceleration'], [fmt(F.max.mach, 2), 'Peak Mach']];
  $('#repStats').innerHTML = st.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
  const chans = CH.filter(c => o.type === 'orbit' || F.nStages > 1 || !['vorb', 'apo', 'peri'].includes(c[0]));
  if (!chans.some(c => c[0] === chan)) chan = 'alt';
  $('#chips').innerHTML = chans.map(c => `<button class="${c[0] === chan ? 'on' : ''}" data-c="${c[0]}">${c[1]}</button>`).join('');
  $('#chips').querySelectorAll('button').forEach(b => b.onclick = () => { chan = b.dataset.c; $('#chips').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); drawChart(); });
  $('#progBtnRep').style.display = P ? '' : 'none';
  $('#modal').classList.remove('hidden'); $('#banner').classList.add('hidden');
  requestAnimationFrame(() => drawChart()); $('#backBtn').focus();
}
let hoverX = null;
function drawChart() {
  const cv = $('#rcv'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const c = CH.find(x => x[0] === chan), tl = F.tele; if (tl.length < 2) return;
  const t0 = F.liftoffT ?? 0, xs = tl.map(s => s.t - t0), ys = tl.map(c[3]);
  const fin = ys.filter(Number.isFinite); if (!fin.length) return;
  const o = F.mission.objective;
  const lim = chan === 'alt' ? (o.type === 'orbit' ? null : o.value / 1000) : chan === 'peri' || chan === 'apo' ? (o.peri ? o.peri / 1000 : null) : chan === 'q' ? F.veh.qMax / 1000 : chan === 'g' && F.veh.payloads.length ? F.veh.gMax : null;
  let ymax = Math.max(...fin, lim ? lim * 1.05 : 0) * 1.08 || 1, ymin = Math.min(0, ...fin);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), L = 56, B = 30, T = 10, Rm = 12;
  const X = v => L + (v - x0) / (x1 - x0 || 1) * (W - L - Rm), Y = v => H - B - (v - ymin) / (ymax - ymin || 1) * (H - B - T);
  const text = css('--text'), muted = css('--muted'), line = css('--line'), acc = css('--accent'), good = css('--good'), bad = css('--bad');
  ctx.font = '12px ' + css('--font'); ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
  const step = niceStep((ymax - ymin) / 5);
  for (let v0 = Math.ceil(ymin / step) * step; v0 <= ymax; v0 += step) { const v = Math.abs(v0) < 1e-9 ? 0 : v0; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - Rm, Y(v)); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(fmt(v, step < 1 ? 1 : 0), L - 6, Y(v) + 4); }
  const xs2 = niceStep((x1 - x0) / 6);
  for (let v0 = Math.ceil(x0 / xs2) * xs2; v0 <= x1; v0 += xs2) { const v = Math.abs(v0) < 1e-9 ? 0 : v0; ctx.textAlign = 'center'; ctx.fillText(fmt(v), X(v), H - B + 16); }
  ctx.textAlign = 'left'; ctx.fillText(`${c[1]}${c[2] ? ', ' + c[2] : ''}`, L + 4, T + 12); ctx.textAlign = 'right'; ctx.fillText('Seconds after lift-off', W - Rm, H - 2);
  for (const s of F.stageLog) { ctx.strokeStyle = 'rgba(143,211,244,.5)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(s.t - t0), T); ctx.lineTo(X(s.t - t0), H - B); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = css('--data'); ctx.textAlign = 'left'; ctx.fillText(`Stage ${s.stage} off`, X(s.t - t0) + 4, H - B - 6); }
  if (lim) { ctx.setLineDash([5, 4]); ctx.strokeStyle = ['alt', 'peri', 'apo'].includes(chan) ? good : bad; ctx.beginPath(); ctx.moveTo(L, Y(lim)); ctx.lineTo(W - Rm, Y(lim)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'right'; ctx.fillText(['alt', 'peri', 'apo'].includes(chan) ? 'Target' : 'Limit', W - Rm - 4, Y(lim) - 5); }
  ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.beginPath(); let pen = false;
  xs.forEach((x, i) => { if (!Number.isFinite(ys[i])) { pen = false; return; } pen ? ctx.lineTo(X(x), Y(ys[i])) : ctx.moveTo(X(x), Y(ys[i])); pen = true; }); ctx.stroke();
  if (hoverX !== null && hoverX > L) {
    const tv = x0 + (hoverX - L) / (W - L - Rm) * (x1 - x0); let i = xs.findIndex(x => x >= tv); if (i < 0) i = xs.length - 1;
    if (Number.isFinite(ys[i])) {
      ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(xs[i]), T); ctx.lineTo(X(xs[i]), H - B); ctx.stroke();
      ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(X(xs[i]), Y(ys[i]), 4, 0, 7); ctx.fill();
      ctx.fillStyle = text; ctx.textAlign = X(xs[i]) > W - 160 ? 'right' : 'left';
      ctx.fillText(`T+${fmt(xs[i], 1)} s   ${fmt(ys[i], Math.abs(ys[i]) < 10 ? 2 : 1)} ${c[2]}`, X(xs[i]) + (ctx.textAlign === 'left' ? 8 : -8), T + 30);
    }
  }
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }
$('#rcv').addEventListener('pointermove', e => { hoverX = e.clientX - e.target.getBoundingClientRect().left; drawChart(); });
$('#rcv').addEventListener('pointerleave', () => { hoverX = null; drawChart(); });
$('#againBtn').onclick = () => { running = false; startFlight(); };
function leaveFlight(to) {
  running = false; SFX.silence(); FX.clear(); $('#modal').classList.add('hidden'); $('#flight').classList.add('hidden'); $('#app').classList.remove('hidden');
  const err = F && F.program && F.program.error; F = null; showScreen(to);
  if (to === 'program' && err && err.line) { refreshGutter(err.line); gotoLine(err.line); $('#output').innerHTML = `<div class="bad">The last flight halted the program: ${esc(err.message)} <button class="linkbtn" id="gotoErr">Line ${err.line}</button></div>`; $('#gotoErr').onclick = () => gotoLine(err.line); }
}
$('#backBtn').onclick = () => { const to = reportFrom === 'program' && $('#flight').classList.contains('hidden') ? 'program' : 'build'; reportFrom = 'build'; leaveFlight(to); };
$('#progBtnRep').onclick = () => { reportFrom = 'build'; leaveFlight('program'); };
$('#modal').addEventListener('keydown', e => { if (e.key === 'Escape') $('#backBtn').click(); });
$('#launchBtn').onclick = () => { if (analyze(design, missionId).valid) startFlight(); };

// ---------- Boot ----------
$('#dname').value = design.name || 'Sounder';
codeEl.value = prog.code; $('#useProg').checked = useProg;
if (prog.exampleId) { const ex = EXAMPLE_PROGRAMS.find(e => e.id === prog.exampleId); if (ex) $('#progTitle').textContent = ex.title; }
if (!EVAL_OK) { useProg = false; $('#useProg').checked = false; $('#useProg').disabled = true; }
renderMissionSel(); renderRefSel(); renderPalette(); renderExamples(); renderApiRef(); refreshLoad(); update(); refreshGutter();
if (document.fonts) document.fonts.ready.then(drawBuilder);
