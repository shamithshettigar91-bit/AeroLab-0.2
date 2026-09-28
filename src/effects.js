// ================= AEROLAB SOUND AND VISUAL EFFECTS =================
// Presentation only. Nothing here reads or changes the physics; the UI passes in
// numbers it already has (thrust, air pressure, positions on screen).
//
// SFX: every sound is synthesised with the Web Audio API (filtered noise and
//      oscillators), so the game needs no audio files and stays one HTML page.
//      Sound needs air: as the air thins, the roar fades to the muffled rumble a
//      microphone bolted to the structure would pick up.
// FX:  a small particle system drawn in screen space: explosions, spark showers,
//      smoke, tumbling pieces of the rocket, separation puffs and pad smoke.

const SFX = (() => {
  let ac = null, master = null, buf = null, alarmUntil = 0;
  let engGain, engFilter, crackleGain, crackleFilter, rumble, rumbleGain, windGain, windFilter;
  let enabled = true;
  try { const v = localStorage.getItem('aerolab.v02.sound'); if (v !== null) enabled = v === 'true'; } catch (e) { /* storage blocked */ }
  const LEVEL = 0.8;

  function noise() {
    const n = ac.sampleRate * 3, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; brown = (brown + 0.02 * w) / 1.02; d[i] = 0.35 * w + 2.6 * brown; }
    return b;
  }
  function loop(rate = 1) { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * 2); return s; }
  function init() {
    if (ac) return true;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    try { ac = new AC(); } catch (e) { return false; }
    buf = noise();
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
    master = ac.createGain(); master.gain.value = enabled ? LEVEL : 0; master.connect(comp); comp.connect(ac.destination);
    // engine roar: low-passed noise
    engFilter = ac.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 300; engFilter.Q.value = 0.6;
    engGain = ac.createGain(); engGain.gain.value = 0; loop(1).connect(engFilter); engFilter.connect(engGain); engGain.connect(master);
    // crackle: the hard edge of a solid motor or a big engine in thick air
    crackleFilter = ac.createBiquadFilter(); crackleFilter.type = 'bandpass'; crackleFilter.frequency.value = 2400; crackleFilter.Q.value = 0.9;
    crackleGain = ac.createGain(); crackleGain.gain.value = 0; loop(1.7).connect(crackleFilter); crackleFilter.connect(crackleGain); crackleGain.connect(master);
    // rumble you feel more than hear
    rumble = ac.createOscillator(); rumble.type = 'sawtooth'; rumble.frequency.value = 36;
    const rf = ac.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 110;
    rumbleGain = ac.createGain(); rumbleGain.gain.value = 0; rumble.connect(rf); rf.connect(rumbleGain); rumbleGain.connect(master); rumble.start();
    // wind over the airframe
    windFilter = ac.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 600; windFilter.Q.value = 0.7;
    windGain = ac.createGain(); windGain.gain.value = 0; loop(1.3).connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
    document.addEventListener('visibilitychange', () => { if (document.hidden) ac.suspend().catch(() => {}); else if (enabled) ac.resume().catch(() => {}); });
    return true;
  }
  const now = () => ac.currentTime;
  const to = (p, v, tc = 0.08) => p.setTargetAtTime(v, now(), tc);
  const live = () => ac && enabled && ac.state !== 'closed';

  function burst({ dur, f0, f1, gain, type = 'lowpass', q = 0.7, delay = 0 }) {
    if (!live()) return;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t0 = now() + delay;
    s.buffer = buf; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t0, Math.random() * 2); s.stop(t0 + dur + 0.05);
  }
  function tone({ f0, f1 = f0, dur, gain, type = 'sine', delay = 0 }) {
    if (!live()) return;
    const o = ac.createOscillator(), g = ac.createGain(), t0 = now() + delay; o.type = type;
    o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  return {
    get enabled() { return enabled; },
    get available() { return !!(window.AudioContext || window.webkitAudioContext); },
    get state() { return ac ? ac.state : 'none'; },
    // Browsers only allow audio after a click or key press, so the UI calls this from one.
    unlock() { if (init() && enabled && ac.state === 'suspended') ac.resume().catch(() => {}); },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('aerolab.v02.sound', String(enabled)); } catch (e) { /* storage blocked */ }
      if (enabled) this.unlock();
      if (ac) to(master.gain, enabled ? LEVEL : 0, 0.05);
      return enabled;
    },
    // Called every frame during a flight.
    //   thrust: 0–1 of rated thrust · air: ambient pressure / sea level · q: dynamic pressure, Pa
    //   mach · solid: solid motor · warp: time-warp factor
    update({ thrust, air, q, mach, solid, warp }) {
      if (!ac) return;
      const w = warp > 10 ? 0 : 1 / Math.sqrt(warp), sa = Math.sqrt(Math.max(0, Math.min(1, air)));
      to(engGain.gain, 0.6 * thrust * (0.16 + 0.84 * sa) * w);
      to(engFilter.frequency, 160 + (solid ? 2200 : 1400) * sa * (0.5 + 0.5 * thrust), 0.15);
      to(crackleGain.gain, (solid ? 0.22 : 0.08) * thrust * sa * w);
      to(rumbleGain.gain, 0.32 * thrust * (0.35 + 0.65 * sa) * w);
      to(rumble.frequency, 32 + 12 * thrust, 0.2);
      to(windGain.gain, 0.3 * Math.min(1, q / 35000) * w);
      to(windFilter.frequency, 450 + 1500 * Math.min(1, mach / 3), 0.3);
    },
    silence() { if (!ac) return; for (const g of [engGain, crackleGain, rumbleGain, windGain]) to(g.gain, 0, 0.25); },
    ignition(air = 1) {
      const a = 0.3 + 0.7 * air;
      burst({ dur: 0.35, f0: 4000, f1: 400, gain: 0.45 * a, type: 'bandpass', q: 0.8 });
      burst({ dur: 1.4, f0: 900, f1: 120, gain: 0.55 * a, delay: 0.04 });
      tone({ f0: 75, f1: 38, dur: 0.9, gain: 0.45 });
    },
    cutoff(air = 1) { burst({ dur: 0.5, f0: 1400, f1: 140, gain: 0.22 * (0.3 + 0.7 * air) }); },
    separation() {  // pyro bolts, then the gas of the springs and vents
      tone({ f0: 190, f1: 55, dur: 0.16, gain: 0.7, type: 'square' });
      burst({ dur: 0.22, f0: 6000, f1: 900, gain: 0.6, type: 'bandpass', q: 1.2 });
      burst({ dur: 1.0, f0: 3000, f1: 500, gain: 0.25, type: 'highpass', delay: 0.06 });
      tone({ f0: 70, f1: 45, dur: 0.35, gain: 0.35, delay: 0.02 });
    },
    sonicBoom() { tone({ f0: 58, f1: 28, dur: 0.55, gain: 0.55 }); burst({ dur: 0.4, f0: 700, f1: 70, gain: 0.45 }); },
    explosion(air = 1, big = true) {
      const a = 0.3 + 0.7 * air;
      burst({ dur: 0.07, f0: 9000, f1: 2500, gain: 0.9 * a, type: 'highpass' });   // the crack
      burst({ dur: big ? 3.2 : 1.8, f0: 2600, f1: 50, gain: 1.0 * a });              // the blast
      tone({ f0: 62, f1: 20, dur: big ? 1.8 : 1.0, gain: 0.9 });                     // the thump
      burst({ dur: 4, f0: 450, f1: 40, gain: 0.45 * a, delay: 0.3 });                // the rolling rumble
      for (let i = 0; i < 8; i++) burst({ dur: 0.1 + Math.random() * 0.1, f0: 3500, f1: 600, gain: 0.25 * a, type: 'bandpass', q: 2.5, delay: 0.25 + Math.random() * 1.8 });
    },
    chime() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f0: f, dur: 1.1, gain: 0.16, type: 'triangle', delay: i * 0.13 })); },
    alarm() {  // master caution: two tones, at most once a second
      if (!live() || now() < alarmUntil) return;
      alarmUntil = now() + 1.0;
      tone({ f0: 880, dur: 0.13, gain: 0.13, type: 'square' }); tone({ f0: 660, dur: 0.13, gain: 0.13, type: 'square', delay: 0.17 });
    },
    click() { tone({ f0: 1400, f1: 900, dur: 0.05, gain: 0.08, type: 'triangle' }); },
  };
})();

const FX = (() => {
  const parts = [];
  let shake = 0, flash = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PART_COLOUR = { nose: '#E3E8EE', payload: '#E3E8EE', avionics: '#C9D1DB', tank: '#D3DAE3', decoupler: '#3B424D', engine: '#4A525E' };

  return {
    get count() { return parts.length; },
    clear() { parts.length = 0; shake = 0; flash = 0; },
    // x, y: screen point · air: 0–1 ambient pressure · sc: pixels per metre · angle: rocket's screen rotation (rad)
    // pieces: [{len, cat, carbon}] from nose to tail · ground: explosion on the ground (adds dust)
    explode({ x, y, air, sc, angle = 0, pieces = [], ground = false }) {
      const k = reduce ? 0.35 : 1, thick = 0.25 + 0.75 * Math.sqrt(air);
      for (let i = 0; i < 7 * k + 1; i++) parts.push({ kind: 'fire', x: x + rnd(-10, 10), y: y + rnd(-10, 10), vx: rnd(-30, 30), vy: rnd(-40, 10), r0: rnd(8, 18), r1: rnd(60, 150) * thick + 30, life: rnd(0.7, 1.3), age: 0 });
      for (let i = 0; i < 110 * k; i++) { const a = rnd(0, 2 * Math.PI), v = rnd(120, 650); parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.5, 1.7), age: 0, g: 260 * (0.3 + air) }); }
      for (let i = 0; i < (ground ? 34 : 24) * k; i++) { const a = rnd(0, 2 * Math.PI), v = rnd(10, 70) * thick; parts.push({ kind: 'smoke', x: x + rnd(-20, 20), y: y + rnd(-20, 20), vx: Math.cos(a) * v, vy: Math.sin(a) * v - (ground ? 25 : 12) * air, r0: rnd(12, 24), r1: rnd(55, 120) * thick + 20, life: rnd(2.2, 4.2) * (0.4 + 0.6 * thick), age: rnd(-0.2, 0), dust: ground, a0: 0.55 * thick + 0.15 }); }
      // the rocket's own parts, flung apart and tumbling
      let s = 0; const total = pieces.reduce((a, p) => a + p.len, 0) || 1;
      for (const p of pieces) {
        const along = (s + p.len / 2 - total / 2) * sc; s += p.len;
        const px = x + Math.sin(angle) * -along, py = y + Math.cos(angle) * along;
        const out = rnd(40, 180), dir = Math.atan2(py - y, px - x) + rnd(-0.9, 0.9);
        parts.push({ kind: 'chunk', x: px, y: py, vx: Math.cos(dir) * out + rnd(-40, 40), vy: Math.sin(dir) * out + rnd(-120, 20), rot: angle, spin: rnd(-6, 6),
          w: Math.max(3, 0.6 * sc * rnd(0.6, 1)), h: Math.max(4, p.len * sc * rnd(0.35, 0.8)), colour: p.carbon ? '#4A525E' : (PART_COLOUR[p.cat] || '#C9D1DB'), life: 6, age: 0, g: 9.8 * sc * 0.3, hot: 1 }); // reduced fall: the view drifts with the wreckage
      }
      shake = reduce ? 0 : 16; flash = reduce ? 0.25 : 0.9;
    },
    separation({ x, y, angle, sc }) {  // flash at the joint, vented gas sideways, a few sparks
      const k = reduce ? 0.4 : 1, nx = Math.cos(angle), ny = Math.sin(angle);
      parts.push({ kind: 'fire', x, y, vx: 0, vy: 0, r0: 4, r1: 14 + 0.6 * sc, life: 0.35, age: 0, cool: true });
      for (let i = 0; i < 18 * k; i++) { const side = i % 2 ? 1 : -1, v = rnd(60, 220); parts.push({ kind: 'gas', x, y, vx: nx * v * side + rnd(-25, 25), vy: ny * v * side + rnd(-25, 25), r0: 3, r1: rnd(10, 26), life: rnd(0.6, 1.2), age: 0 }); }
      for (let i = 0; i < 14 * k; i++) { const a = rnd(0, 2 * Math.PI), v = rnd(80, 300); parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.3, 0.7), age: 0, g: 0 }); }
      shake = Math.max(shake, reduce ? 0 : 4);
    },
    // exhaust smoke rolling out across the pad (called every frame while firing near the ground)
    padSmoke({ x, y, strength }) {
      if (Math.random() > strength || parts.length > 600) return;
      const side = Math.random() < 0.5 ? -1 : 1;
      parts.push({ kind: 'smoke', x: x + rnd(-8, 8), y: y - rnd(0, 6), vx: side * rnd(60, 190), vy: rnd(-22, -4), r0: rnd(8, 16), r1: rnd(40, 90), life: rnd(2.5, 4.5), age: 0, a0: 0.45 });
    },
    // a smoke trail from a motor in the lower atmosphere, drifting back along the flight path
    trail({ x, y, vx, vy, strength }) {
      if (Math.random() > strength || parts.length > 600) return;
      parts.push({ kind: 'smoke', x: x + rnd(-3, 3), y: y + rnd(-3, 3), vx: vx + rnd(-15, 15), vy: vy + rnd(-15, 15), r0: rnd(5, 9), r1: rnd(22, 45), life: rnd(1.2, 2.2), age: 0, a0: 0.35 });
    },
    offset() { return reduce || shake < 0.2 ? [0, 0] : [(Math.random() - 0.5) * 2 * shake, (Math.random() - 0.5) * 2 * shake]; },
    // advance and draw; call after the rocket so the blast covers it
    draw(ctx, dt, W, H) {
      shake *= Math.exp(-3.2 * dt); flash *= Math.exp(-7 * dt);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        if (p.age < 0) continue;
        const u = p.age / p.life, drag = p.kind === 'spark' ? 1.2 : p.kind === 'chunk' ? 0.15 : 1.6;
        p.vx *= Math.exp(-drag * dt); p.vy *= Math.exp(-drag * dt); p.vy += (p.g || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.kind === 'smoke') {
          const r = p.r0 + (p.r1 - p.r0) * Math.sqrt(u), a = p.a0 * (1 - u) * Math.min(1, p.age * 4);
          ctx.fillStyle = p.dust ? `rgba(122,104,82,${a})` : `rgba(190,194,200,${a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
        } else if (p.kind === 'gas') {
          const r = p.r0 + (p.r1 - p.r0) * Math.sqrt(u); ctx.fillStyle = `rgba(235,240,248,${0.5 * (1 - u)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
        } else if (p.kind === 'fire') {
          const r = p.r0 + (p.r1 - p.r0) * Math.pow(u, 0.45), g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          if (p.cool) { g.addColorStop(0, `rgba(255,255,255,${1 - u})`); g.addColorStop(1, 'rgba(200,220,255,0)'); }
          else { g.addColorStop(0, `rgba(255,248,220,${1 - u})`); g.addColorStop(0.35, `rgba(255,170,60,${0.9 * (1 - u)})`); g.addColorStop(0.7, `rgba(200,70,30,${0.55 * (1 - u)})`); g.addColorStop(1, 'rgba(60,30,20,0)'); }
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
        } else if (p.kind === 'spark') {
          ctx.strokeStyle = `rgba(255,${Math.round(220 - 120 * u)},${Math.round(120 - 100 * u)},${1 - u})`; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025); ctx.stroke();
        } else if (p.kind === 'chunk') {
          p.rot += p.spin * dt; p.hot = Math.max(0, p.hot - dt * 0.5);
          if (p.y > H + 200) { parts.splice(i, 1); continue; }
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.min(1, (p.life - p.age) * 1.5);
          ctx.fillStyle = p.colour; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          if (p.hot > 0) { ctx.strokeStyle = `rgba(255,140,50,${p.hot})`; ctx.lineWidth = 2; ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h); }
          ctx.restore(); ctx.globalAlpha = 1;
          if (p.hot > 0.3 && Math.random() < 0.5) parts.push({ kind: 'smoke', x: p.x, y: p.y, vx: 0, vy: -6, r0: 2, r1: 9, life: 0.9, age: 0, a0: 0.35 * p.hot });
        }
      }
      if (flash > 0.01) { ctx.fillStyle = `rgba(255,244,225,${flash})`; ctx.fillRect(0, 0, W, H); }
    },
  };
})();

if (typeof module !== 'undefined') module.exports = { SFX, FX };
