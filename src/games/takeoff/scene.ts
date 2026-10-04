// Canvas drawing for the "Take off" game: a sunrise airport, a plane that takes off
// as the person holds "aaah", a cloud bank to climb through and a sea of cloud above.
// Pure drawing: it never touches the microphone or the DOM outside the canvas.

type Ctx = CanvasRenderingContext2D;

interface Particle {
  x: number; y: number; vx: number; vy: number;
  r: number; g: number; life: number; max: number;
  c: string; star?: boolean;
}

export type SceneStage = "intro" | "waiting" | "flying" | "done";

export interface SceneInput {
  stage: SceneStage;
  held: number;      // seconds of steady voice so far
  voiced: boolean;   // is the voice heard right now?
  wobble: number;    // recent pitch unsteadiness in semitones
}

export interface SceneOutput {
  knots: number;
  feet: number;
  progress: number;  // 0 to 1 along the flight path
}

export function createScene(maxSeconds: number, reduce: boolean) {
  const MAX = maxSeconds;
  const LIFT = maxSeconds / 3;

  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a: string, b: string, t: number) => { const p = hex(a), q = hex(b); return `rgb(${p.map((x, i) => Math.round(x + (q[i] - x) * t)).join(",")})`; };
  const ease = (t: number) => 1 - (1 - t) * (1 - t);
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  const wrap = (x: number, span: number) => ((x % span) + span) % span;

  // fixed random layouts so the scene is the same every time
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const highClouds = Array.from({ length: 6 }, () => ({ x: rnd(), y: 0.08 + rnd() * 0.22, s: 0.5 + rnd() * 0.4 }));
  const bank = Array.from({ length: 9 }, (_, i) => ({ x: i / 9 + rnd() * 0.05, y: rnd() * 40, s: 1.0 + rnd() * 0.6 }));
  const topClouds = Array.from({ length: 5 }, () => ({ x: rnd(), y: 0.12 + rnd() * 0.3, s: 0.6 + rnd() * 0.5 }));
  const streaks = Array.from({ length: 14 }, () => ({ x: rnd(), y: 0.15 + rnd() * 0.7, l: 40 + rnd() * 90 }));
  const birds = Array.from({ length: 4 }, (_, i) => ({ x: 0.62 + i * 0.05 + rnd() * 0.03, y: 0.32 + rnd() * 0.06 }));
  const parts: Particle[] = [];

  function puffs(ctx: Ctx, x: number, y: number, s: number) {
    ctx.beginPath();
    [[0, 0, 24], [28, -16, 30], [62, -10, 27], [90, 2, 20], [40, 8, 28], [-22, 8, 18], [112, 10, 14]].forEach(([dx, dy, rr]) => {
      ctx.moveTo(x + dx * s + rr * s, y + dy * s); ctx.arc(x + dx * s, y + dy * s, rr * s, 0, Math.PI * 2);
    });
    ctx.fill();
  }
  function cloud(ctx: Ctx, x: number, y: number, s: number, a: number, shade: string) {
    ctx.globalAlpha = a;
    ctx.fillStyle = shade; puffs(ctx, x + 3 * s, y + 9 * s, s);
    ctx.fillStyle = "#FFFFFF"; puffs(ctx, x, y, s);
    ctx.globalAlpha = 1;
  }
  function ridge(ctx: Ctx, w: number, base: number, amp: number, f1: number, f2: number, phase: number, color: string, bottom: number) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, bottom);
    for (let x = 0; x <= w + 12; x += 12) ctx.lineTo(x, base - amp * (0.55 + 0.3 * Math.sin((x + phase) * f1) + 0.15 * Math.sin((x + phase) * f2 + 1.7)));
    ctx.lineTo(w, bottom); ctx.closePath(); ctx.fill();
  }

  function plane(ctx: Ctx, Lp: number, gear: number, glow: number) {
    const H = Lp * 0.15;
    // tail fin with a small sun logo
    const tg = ctx.createLinearGradient(0, -H * 1.8, 0, -H * 0.2);
    tg.addColorStop(0, "#F7B955"); tg.addColorStop(1, "#E3892A");
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.moveTo(-Lp * 0.40, -H * 0.35); ctx.lineTo(-Lp * 0.51, -H * 1.75); ctx.quadraticCurveTo(-Lp * 0.47, -H * 1.82, -Lp * 0.41, -H * 1.75);
    ctx.lineTo(-Lp * 0.25, -H * 0.42); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(-Lp * 0.43, -H * 1.12, H * 0.22, 0, Math.PI * 2); ctx.fill();
    // far wing and tailplane
    ctx.fillStyle = "#AEBBCC";
    ctx.beginPath(); ctx.moveTo(-Lp * 0.03, -H * 0.15); ctx.lineTo(Lp * 0.08, -H * 0.15); ctx.lineTo(-Lp * 0.10, -H * 0.9); ctx.lineTo(-Lp * 0.15, -H * 0.9); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-Lp * 0.40, -H * 0.1); ctx.lineTo(-Lp * 0.32, -H * 0.1); ctx.lineTo(-Lp * 0.45, -H * 0.55); ctx.lineTo(-Lp * 0.48, -H * 0.55); ctx.closePath(); ctx.fill();
    // fuselage with soft shading
    const fg = ctx.createLinearGradient(0, -H * 0.5, 0, H * 0.5);
    fg.addColorStop(0, "#FFFFFF"); fg.addColorStop(0.55, "#F3F6FA"); fg.addColorStop(1, "#C9D3E0");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-Lp * 0.47, -H * 0.42); ctx.lineTo(Lp * 0.34, -H * 0.5);
    ctx.bezierCurveTo(Lp * 0.47, -H * 0.5, Lp * 0.53, -H * 0.1, Lp * 0.53, H * 0.12);
    ctx.quadraticCurveTo(Lp * 0.52, H * 0.5, Lp * 0.36, H * 0.5);
    ctx.lineTo(-Lp * 0.34, H * 0.5);
    ctx.quadraticCurveTo(-Lp * 0.47, H * 0.42, -Lp * 0.52, -H * 0.3);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(19,35,63,.18)"; ctx.lineWidth = 1.2; ctx.stroke();
    // livery stripes
    ctx.fillStyle = "#1D4E89"; ctx.fillRect(-Lp * 0.45, H * 0.13, Lp * 0.86, H * 0.11);
    ctx.fillStyle = "#F2A541"; ctx.fillRect(-Lp * 0.43, H * 0.27, Lp * 0.80, H * 0.05);
    // windows
    for (let x = -Lp * 0.31; x < Lp * 0.31; x += Lp * 0.043) {
      ctx.fillStyle = "#33507A"; ctx.beginPath(); ctx.ellipse(x, -H * 0.12, H * 0.075, H * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.beginPath(); ctx.arc(x - H * 0.025, -H * 0.16, H * 0.03, 0, Math.PI * 2); ctx.fill();
    }
    // cockpit
    ctx.fillStyle = "#1E3354";
    ctx.beginPath(); ctx.moveTo(Lp * 0.39, -H * 0.3); ctx.quadraticCurveTo(Lp * 0.46, -H * 0.32, Lp * 0.495, -H * 0.12); ctx.lineTo(Lp * 0.40, -H * 0.1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fillRect(Lp * 0.41, -H * 0.27, Lp * 0.02, H * 0.06);
    // door outline
    ctx.strokeStyle = "rgba(19,35,63,.2)"; ctx.lineWidth = 1; ctx.strokeRect(Lp * 0.33, -H * 0.36, Lp * 0.03, H * 0.42);
    // near wing with winglet
    const wg = ctx.createLinearGradient(0, H * 0.1, 0, H * 1.2);
    wg.addColorStop(0, "#8D9CB2"); wg.addColorStop(1, "#5F6F88");
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.moveTo(-Lp * 0.05, H * 0.2); ctx.lineTo(Lp * 0.11, H * 0.2); ctx.lineTo(-Lp * 0.13, H * 0.88); ctx.lineTo(-Lp * 0.21, H * 0.88); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#F2A541"; ctx.beginPath(); ctx.moveTo(-Lp * 0.21, H * 0.88); ctx.lineTo(-Lp * 0.13, H * 0.88); ctx.lineTo(-Lp * 0.19, H * 1.05); ctx.closePath(); ctx.fill();
    // engine
    const eg = ctx.createLinearGradient(0, H * 0.5, 0, H * 0.95);
    eg.addColorStop(0, "#6B7A92"); eg.addColorStop(1, "#2C3647");
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.ellipse(-Lp * 0.01, H * 0.72, Lp * 0.075, H * 0.23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#C5CEDB"; ctx.beginPath(); ctx.ellipse(Lp * 0.06, H * 0.72, H * 0.06, H * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    if (glow > 0.05) {
      const rg = ctx.createRadialGradient(-Lp * 0.09, H * 0.72, 0, -Lp * 0.09, H * 0.72, H * 0.5);
      rg.addColorStop(0, `rgba(255,214,140,${0.7 * glow})`); rg.addColorStop(1, "rgba(255,214,140,0)");
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(-Lp * 0.09, H * 0.72, H * 0.5, 0, Math.PI * 2); ctx.fill();
    }
    // landing gear
    if (gear > 0.01) {
      const gl = H * 0.42 * gear;
      ctx.fillStyle = "#3A4252";
      ctx.fillRect(Lp * 0.30, H * 0.45, 3, gl); ctx.fillRect(-Lp * 0.07, H * 0.45, 4, gl);
      ctx.fillStyle = "#1E222B";
      [[Lp * 0.30 + 1.5, H * 0.13], [-Lp * 0.07 + 2, H * 0.18]].forEach(([x, rr]) => { ctx.beginPath(); ctx.arc(x, H * 0.45 + gl, rr * gear, 0, Math.PI * 2); ctx.fill(); });
    }
  }

  // screen position of a point given in plane coordinates
  const toScreen = (px: number, py: number, ang: number, x: number, y: number): [number, number] => [px + x * Math.cos(ang) - y * Math.sin(ang), py + x * Math.sin(ang) + y * Math.cos(ang)];


  let vignette: { w: number; h: number; fill: CanvasGradient } | null = null;
  let shown = 0, speed = 0, dist = 0, tilt = 0, lastTs = 0, celebrated = false, gearShown = 1;

  return function draw(ctx: Ctx, w: number, h: number, ts: number, inp: SceneInput): SceneOutput {
    const dtF = Math.min(0.05, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    if (inp.stage === "intro" || inp.stage === "waiting") { shown = 0; celebrated = false; }
    const held = inp.held;
    const flying = inp.stage === "flying";
    const voiced = flying && inp.voiced;
    shown += (held - shown) * 0.35;
    const s = shown;
    const airborne = s >= LIFT;
    const targetSpeed = voiced ? Math.min(1, 0.2 + s / LIFT) : (airborne ? 0.5 : 0);
    speed += (targetSpeed - speed) * (targetSpeed > speed ? 0.2 : 0.15);
    if (!reduce) dist += speed * dtF;

      const alt = s <= LIFT ? 0 : Math.min(1, (s - LIFT) / (MAX - LIFT));
      const ea = ease(alt);

      /* sky: sunrise near the ground, deep clear blue up high */
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, mix("#6FB1E0", "#173F7A", ea));
      sky.addColorStop(0.55, mix("#BFE0F2", "#3F7FC4", ea));
      sky.addColorStop(1, mix("#FFD9A8", "#9CC9EE", ea));
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      /* sun with glow */
      const sx = w * 0.78, sy = h * (0.42 - 0.18 * ea), sr = Math.min(w, h) * 0.07;
      const glow = ctx.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 4.5);
      glow.addColorStop(0, "rgba(255,226,160,.75)"); glow.addColorStop(1, "rgba(255,226,160,0)");
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#FFE7A8"; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#FFF5D6"; ctx.beginPath(); ctx.arc(sx, sy, sr * 0.72, 0, Math.PI * 2); ctx.fill();

      /* thin high clouds */
      highClouds.forEach((c) => {
        const x = wrap(c.x * (w + 300) - dist * 25, w + 300) - 150;
        cloud(ctx, x, h * c.y + ea * h * 0.25, c.s * 0.7, 0.9 * (1 - ea), "rgba(250,214,196,.9)");
      });

      /* landscape layers drop away as the plane climbs (deeper layers move less) */
      const drop = ea * h * 1.25;
      const groundY = h * 0.78 + drop;
      if (groundY - h * 0.35 < h) {
        ridge(ctx, w, h * 0.62 + drop * 0.55, h * 0.16, 0.006, 0.017, dist * 20, mix("#A7B9D6", "#8FA9CF", ea), h + 400);
        ridge(ctx, w, h * 0.68 + drop * 0.75, h * 0.10, 0.009, 0.023, dist * 45 + 300, "#86A3B8", h + 400);
        // distant town
        ctx.fillStyle = "#7593A8";
        for (let i = 0; i < 22; i++) {
          const bw = 18 + (i * 37) % 26, bh = 14 + (i * 53) % 46;
          const x = wrap(i * 61 - dist * 80, w + 200) - 100;
          ctx.fillRect(x, h * 0.72 + drop * 0.85 - bh, bw, bh + 40);
        }
        // far grass
        const gg = ctx.createLinearGradient(0, groundY - h * 0.05, 0, h + drop);
        gg.addColorStop(0, "#9CC28A"); gg.addColorStop(1, "#5E9B5A");
        ctx.fillStyle = gg; ctx.fillRect(0, groundY - h * 0.05, w, h * 0.5);
        // tree line
        for (let i = 0; i < 26; i++) {
          const x = wrap(i * 47 - dist * 230, w + 120) - 60, r = 9 + (i * 7) % 8;
          ctx.fillStyle = i % 3 ? "#4E8A55" : "#3F7648";
          ctx.beginPath(); ctx.arc(x, groundY - h * 0.05 - r * 0.6, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(x - 1.5, groundY - h * 0.05 - r * 0.2, 3, r * 0.6);
        }
        // terminal and control tower, left behind as the plane rolls
        const tx = w * 0.50 - dist * 520;
        if (tx > -400) {
          ctx.fillStyle = "#E7ECF2"; ctx.fillRect(tx, groundY - h * 0.15, 260, h * 0.12);
          ctx.fillStyle = "#7FA6C9"; ctx.fillRect(tx + 10, groundY - h * 0.13, 240, h * 0.05);
          ctx.fillStyle = "#C9D3DE"; ctx.fillRect(tx - 6, groundY - h * 0.165, 272, 8);
          ctx.fillStyle = "#D7DEE8"; ctx.fillRect(tx + 300, groundY - h * 0.34, 18, h * 0.31);
          ctx.fillStyle = "#5E7FA6"; ctx.beginPath(); ctx.moveTo(tx + 288, groundY - h * 0.34); ctx.lineTo(tx + 330, groundY - h * 0.34); ctx.lineTo(tx + 326, groundY - h * 0.40); ctx.lineTo(tx + 292, groundY - h * 0.40); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#C9D3DE"; ctx.fillRect(tx + 286, groundY - h * 0.415, 46, 8);
        }
        // runway
        const rg = ctx.createLinearGradient(0, groundY, 0, groundY + h * 0.09);
        rg.addColorStop(0, "#4E5662"); rg.addColorStop(1, "#666F7B");
        ctx.fillStyle = rg; ctx.fillRect(0, groundY, w, h * 0.09);
        ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.fillRect(0, groundY + 3, w, 2); ctx.fillRect(0, groundY + h * 0.09 - 5, w, 2);
        const step = 130, off = wrap(dist * 520, step);
        ctx.fillStyle = "#F7F7F2";
        for (let x = -off; x < w; x += step) ctx.fillRect(x, groundY + h * 0.042, 62, 4);
        const th = w * 0.06 - dist * 520;
        if (th > -120) for (let k = 0; k < 6; k++) ctx.fillRect(th, groundY + 9 + k * (h * 0.012), 70, h * 0.006);
        // edge lights
        const loff = wrap(dist * 520, 64);
        for (let x = -loff; x < w; x += 64) {
          [groundY + 1, groundY + h * 0.09 - 1].forEach((y) => {
            ctx.fillStyle = "rgba(255,200,110,.35)"; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#FFD58A"; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
          });
        }
        // near grass
        ctx.fillStyle = "#6FAA62"; ctx.fillRect(0, groundY + h * 0.09, w, h);
        ctx.fillStyle = "rgba(255,255,255,.08)";
        for (let x = -wrap(dist * 700, 160); x < w; x += 160) ctx.fillRect(x, groundY + h * 0.09, 80, h);
      }

      /* plane placement */
      const Lp = Math.min(w * 0.3, 270), H = Lp * 0.15;
      const roll = Math.min(1, s / LIFT);
      const px = w * (0.16 + 0.28 * roll * roll);
      const climbPx = ease(Math.min(1, alt / 0.35)) * h * 0.28;
      const py = h * 0.78 - H * 0.95 - climbPx + (airborne || reduce ? 0 : Math.sin(ts * 0.03) * speed * 0.6);
      const nose = s < LIFT * 0.92 ? 0 : alt < 0.6 ? -0.14 : -0.14 + (alt - 0.6) / 0.4 * 0.11;
      let wob = 0;
      if (voiced && airborne) wob = Math.min(0.06, inp.wobble * 0.05);
      tilt += ((reduce ? 0 : wob * Math.sin(ts * 0.01)) - tilt) * 0.2;
      const ang = nose + tilt;
      gearShown += ((alt < 0.12 ? 1 : 0) - gearShown) * 0.06;

      /* shadow on the runway */
      if (groundY < h + 20) {
        const sa = clamp(0.28 - climbPx / h, 0, 0.28);
        if (sa > 0.01) {
          ctx.fillStyle = `rgba(20,30,45,${sa})`;
          ctx.beginPath(); ctx.ellipse(px - climbPx * 0.4, groundY + h * 0.05, Lp * 0.42 * (1 - climbPx / h), 7, 0, 0, Math.PI * 2); ctx.fill();
        }
      }

      /* particles: wheel spray on the runway, vapour trail in the air, sparkles at cruise */
      if (!reduce && flying && voiced) {
        if (!airborne && speed > 0.45 && Math.random() < 0.6) {
          const [wx, wy] = toScreen(px, py, ang, -Lp * 0.07, H * 0.9);
          parts.push({ x: wx, y: wy, vx: -60 - 200 * speed, vy: -10 - Math.random() * 20, r: 4, g: 22, life: 0, max: 0.7, c: "235,228,214" });
        }
        if (airborne && Math.random() < 0.9) {
          const [ex, ey] = toScreen(px, py, ang, -Lp * 0.1, H * 0.72);
          parts.push({ x: ex, y: ey, vx: -260, vy: 0, r: 3, g: 10, life: 0, max: 1.6, c: "255,255,255" });
        }
      }
      if (held >= MAX && !celebrated && !reduce) {
        celebrated = true;
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 120;
          parts.push({ x: px, y: py - H, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 3 + Math.random() * 3, g: 0, life: 0, max: 1.6, c: "255,205,110", star: true });
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.life += dtF;
        if (p.life > p.max) { parts.splice(i, 1); continue; }
        p.x += p.vx * dtF; p.y += p.vy * dtF;
        const k = p.life / p.max, a = (1 - k) * (p.star ? 1 : 0.55);
        ctx.fillStyle = `rgba(${p.c},${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + p.g * k, 0, Math.PI * 2); ctx.fill();
      }

      /* speed streaks once moving fast */
      if (!reduce && speed > 0.5) {
        ctx.strokeStyle = `rgba(255,255,255,${(speed - 0.5) * 0.5})`; ctx.lineWidth = 1.5;
        streaks.forEach((st) => {
          const x = wrap(st.x * (w + 200) - dist * 900, w + 200) - 100, y = st.y * h;
          if (Math.abs(y - py) < H * 2.2) return;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + st.l, y); ctx.stroke();
        });
      }

      /* the plane */
      ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
      plane(ctx, Lp, gearShown, voiced ? speed : 0);
      ctx.restore();

      /* birds in the early climb */
      if (alt > 0.02 && alt < 0.5) {
        ctx.strokeStyle = "rgba(40,50,70,.55)"; ctx.lineWidth = 2;
        birds.forEach((b, i) => {
          const x = b.x * w - (s - LIFT) * w * 0.08, y = b.y * h + ea * h * 0.6, f = 5 + 3 * Math.sin(ts * 0.012 + i);
          ctx.beginPath(); ctx.moveTo(x - 8, y - f * 0.4); ctx.quadraticCurveTo(x - 4, y - f, x, y); ctx.quadraticCurveTo(x + 4, y - f, x + 8, y - f * 0.4); ctx.stroke();
        });
      }

      /* the cloud bank the plane climbs through, in front of it */
      const bankY = -h * 0.35 + ea * h * 1.55;
      bank.forEach((c) => {
        const x = wrap(c.x * (w + 300) - dist * 160, w + 300) - 150;
        cloud(ctx, x, bankY + c.y, c.s, 0.95, "rgba(186,206,232,.85)");
      });
      // white-out when passing through
      const fog = clamp(1 - Math.abs(bankY - py) / 90, 0, 1) * 0.45;
      if (fog > 0) { ctx.fillStyle = `rgba(255,255,255,${fog})`; ctx.fillRect(0, 0, w, h); }

      /* above the clouds: a soft sea of cloud below */
      if (ea > 0.5) {
        const a = (ea - 0.5) * 2;
        ctx.globalAlpha = a;
        ctx.fillStyle = "rgba(200,218,240,1)";
        for (let x = -wrap(dist * 60, 70) - 70; x < w + 70; x += 70) { ctx.beginPath(); ctx.arc(x, h * 0.98 + 8 * Math.sin(x * 0.05), 46, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = "#FFFFFF";
        for (let x = -wrap(dist * 60, 70) - 40; x < w + 70; x += 70) { ctx.beginPath(); ctx.arc(x, h * 0.99 + 10 * Math.sin(x * 0.07), 40, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
        topClouds.forEach((c) => {
          const x = wrap(c.x * (w + 300) - dist * 60, w + 300) - 150;
          cloud(ctx, x, h * 0.62 + c.y * h * 0.5, c.s * 1.3, a * 0.95, "rgba(170,195,230,.8)");
        });
      }

      // gentle vignette
      if (!vignette || vignette.w !== w || vignette.h !== h) {
        const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.8);
        vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(10,25,50,.18)");
        vignette = { w, h, fill: vg };
      }
      ctx.fillStyle = vignette.fill; ctx.fillRect(0, 0, w, h);


    return {
      knots: Math.round(Math.min(1, s / LIFT) * 160 + (airborne ? alt * 120 : 0)),
      feet: Math.round(ea * 100) * 100,
      progress: clamp(s / MAX, 0, 1),
    };
  };
}
