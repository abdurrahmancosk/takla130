// takla-physics.js — dedicated rigid-body model of the TAKLA-130 stunt car. Pure JS, no WASM.
// Frame: world Y-up. Car body frame: +X forward, +Y up, +Z right (left side = -Z).
// DOF: chassis 6-DOF (all non-spinning mass incl. wheels as rigid) + 2 geared spin DOF (left/right side).
// Lagrangian coupling (exact for rigid transverse drivetrain):
//   L = I*w + sum_s J_s*Om_s*a       J_s = 2*Iw + G*Ir   (wheel + rotor relative spin momentum)
//   side s:  J_s*(a·dw) + E_s*dOm_s = Q_s,   E_s = 2*Iw + G^2*Ir   (reflected inertia)
// Motor reaction on the chassis emerges from this coupling (no hand-applied reaction torque).
// Contacts: penalty spring-damper + regularised Coulomb friction; tyre = cylinder support function.

export const MOTORS = {
  strong: { id: 'strong', name: 'DC130 · 3V tipi (~1.6 Ω)', short: '3V tipi', Ke: 2.1e-3, Kt: 2.1e-3, Rm: 1.65, I0: 0.15, Ir: 1.1e-7 },
  medium: { id: 'medium', name: 'DC130 · standart (~2.4 Ω)', short: 'standart', Ke: 2.5e-3, Kt: 2.5e-3, Rm: 2.4, I0: 0.15, Ir: 1.1e-7 },
  weak:   { id: 'weak',   name: 'DC130 · 6V tipi (~7.5 Ω)', short: '6V tipi', Ke: 4.55e-3, Kt: 4.55e-3, Rm: 7.5, I0: 0.07, Ir: 1.1e-7 },
};

export function motorCurve(Mo, V, Rextra = 0.47) {
  const R = Mo.Rm + Rextra;
  const w0 = (V - Mo.I0 * R) / Mo.Ke;
  const Is = V / R;
  return { rpm0: w0 * 60 / (2 * Math.PI), Ts: Mo.Kt * (Is - Mo.I0), Is };
}

// ------------------------------------------------------------------ small vector helpers
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
};
function quatToMat(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
function mmul(a, b) { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; }
function mT(a) { return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]; }
function solve3(A, b) {
  const [a, bb, c, d, e, f, g, h, i] = A;
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  const inv = 1 / det;
  return [
    ((e * i - f * h) * b[0] - (bb * i - c * h) * b[1] + (bb * f - c * e) * b[2]) * inv,
    (-(d * i - f * g) * b[0] + (a * i - c * g) * b[1] - (a * f - c * d) * b[2]) * inv,
    ((d * h - e * g) * b[0] - (a * h - bb * g) * b[1] + (a * e - bb * d) * b[2]) * inv,
  ];
}

// ------------------------------------------------------------------ world geometry
// convex polyhedron: { planes:[{n:[..], d}], mu, center:[..], radius }  inside: n·x <= d for all planes
export function halfSpace(n, d, mu) { return { planes: [{ n, d }], mu, center: null, radius: Infinity, kind: 'ground' }; }
export function boxPoly(center, half, yaw, mu, kind = 'box') {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ax = [[c, 0, -s], [0, 1, 0], [s, 0, c]];
  const planes = [];
  for (let k = 0; k < 3; k++) for (const sg of [1, -1]) {
    const n = V.mul(ax[k], sg); planes.push({ n, d: V.dot(n, center) + half[k] });
  }
  return { planes, mu, center, radius: Math.hypot(...half) + 0.01, kind, half, yaw };
}
// wedge ramp: rises along local +x from 0 at x=-L/2 to height H at x=+L/2 ; width W ; base at y=y0
export function rampPoly(center, L, W, H, yaw, mu) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ex = [c, 0, -s], ez = [s, 0, c], ey = [0, 1, 0];
  const planes = [];
  const pt = (lx, ly, lz) => V.add(center, V.add(V.add(V.mul(ex, lx), V.mul(ey, ly)), V.mul(ez, lz)));
  planes.push({ n: [0, -1, 0], d: -center[1] });                       // bottom
  planes.push({ n: ex, d: V.dot(ex, pt(L / 2, 0, 0)) });               // high back face
  planes.push({ n: ez, d: V.dot(ez, pt(0, 0, W / 2)) });
  planes.push({ n: V.mul(ez, -1), d: V.dot(V.mul(ez, -1), pt(0, 0, -W / 2)) });
  const nt = V.add(V.mul(ex, -H), V.mul(ey, L)); const ln = V.len(nt); const ntn = V.mul(nt, 1 / ln);
  planes.push({ n: ntn, d: V.dot(ntn, pt(-L / 2, 0, 0)) });            // slope
  return { planes, mu, center: V.add(center, [0, H / 2, 0]), radius: Math.hypot(L / 2, H, W / 2) + 0.01, kind: 'ramp', L, W, H, yaw, base: center };
}

// ------------------------------------------------------------------ car
export function createCar(cp, opts = {}) {
  const P = {
    G: opts.G ?? cp.gears.DENGE.ratio, eta: opts.eta ?? 0.78,
    motor: opts.motor ?? MOTORS.medium,
    bat: { Voc: opts.Voc ?? 3.85, Rint: 0.07 },
    drv: { Rdrv: 0.40, Imax: opts.Imax ?? 3.2, brake: false },
    mu: opts.mu ?? 0.9, muBody: 0.35, Crr: 0.035,
    kT: opts.kT ?? 6000, zT: opts.zT ?? 0.65, kB: 9000, zB: opts.zB ?? 0.8, vEps: 0.04,
    h: opts.h ?? 1 / 4000,
  };
  const M = cp.mass;
  const Ib = [].concat(...cp.inertia);
  const cOff = cp.com;                    // CoM relative to car reference point (body frame)
  const R = cp.R, hw = cp.tireHalfW;
  const wheelsB = [
    { side: 0, o: [cp.axleX, 0, -cp.tireCenterZ] }, { side: 0, o: [-cp.axleX, 0, -cp.tireCenterZ] },
    { side: 1, o: [cp.axleX, 0, cp.tireCenterZ] }, { side: 1, o: [-cp.axleX, 0, cp.tireCenterZ] },
  ].map(w => ({ ...w, oc: V.sub(w.o, cOff), N: 0, contact: false, slip: 0 }));
  const bx = cp.box, gb = cp.gearBox;
  const pts = [];
  for (const sx of [-1, 1]) for (const sy of [bx.yb, bx.yt]) for (const sz of [-1, 1]) pts.push([sx * bx.x, sy, sz * bx.z]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * gb.x, sy * gb.y, sz * gb.z1]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { pts.push([sx * 0.02, bx.yt, sz * 0.025]); pts.push([sx * 0.02, bx.yb, sz * 0.025]); }
  const bodyPts = pts.map(p => V.sub(p, cOff));

  const S = {
    p: [0, R + cOff[1] + 0.0005, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0],
    Om: [0, 0], th: [0, 0], t: 0,
    side: [mk(), mk()], Vbat: P.bat.Voc, Ibat: 0, flips: 0, upSign: 1, upY: 1,
    airborne: false, maxPitch: 0,
  };
  function mk() { return { u: 0, I: 0, Tm: 0, tau: 0, rpm: 0, Ofwd: 0 }; }
  let world = [halfSpace([0, 1, 0], 0, P.mu)];
  const J = () => 2 * cp.wheelIspin + P.G * P.motor.Ir;
  const E = () => 2 * cp.wheelIspin + P.G * P.G * P.motor.Ir;

  function setWorld(polys) { world = polys; }
  function setMu(mu) { P.mu = mu; for (const w of world) if (w.kind === 'ground') w.mu = mu; }

  function tireContact(c, a, poly) {
    // SAT over polyhedron face normals; returns deepest/min-translation contact
    let best = null;
    for (const pl of poly.planes) {
      const n = pl.n;
      const na = V.dot(n, a);
      const perp = V.sub(n, V.mul(a, na));
      const pl2 = V.len(perp);
      let xs = c;
      if (pl2 > 1e-9) xs = V.sub(xs, V.mul(perp, R / pl2));
      xs = V.sub(xs, V.mul(a, hw * Math.sign(na || 1)));
      const depth = pl.d - V.dot(n, xs);
      if (depth <= 0) return null; // separating plane
      if (!best || depth < best.depth) best = { depth, n, x: xs };
    }
    return best;
  }
  function pointContact(x, poly) {
    let best = null;
    for (const pl of poly.planes) {
      const depth = pl.d - V.dot(pl.n, x);
      if (depth <= 0) return null;
      if (!best || depth < best.depth) best = { depth, n: pl.n, x };
    }
    return best;
  }
  function near(poly, x, r) {
    if (!poly.center) return true;
    return V.len(V.sub(poly.center, x)) < poly.radius + r;
  }

  function substep(h, uL, uR) {
    const Rm = quatToMat(S.q);
    const a = [Rm[2], Rm[5], Rm[8]];             // body +Z (axle axis) in world
    let F = [0, -9.81 * M, 0], T = [0, 0, 0];
    const Q = [0, 0], Nside = [0, 0];
    const p = S.p, v = S.v, w = S.w;
    // ---- tyres
    for (let i = 0; i < 4; i++) {
      const wb = wheelsB[i];
      const c = V.add(p, mv(Rm, wb.oc));
      wb.N = 0; wb.contact = false;
      for (const poly of world) {
        if (!near(poly, c, R + hw)) continue;
        const ct = tireContact(c, a, poly);
        if (!ct) continue;
        const r = V.sub(ct.x, p), rw = V.sub(ct.x, c);
        const vc = V.add(V.add(v, V.cross(w, r)), V.cross(V.mul(a, S.Om[wb.side]), rw));
        const vn = V.dot(vc, ct.n);
        const meff = M / 4;
        let Fn = P.kT * ct.depth - 2 * P.zT * Math.sqrt(P.kT * meff) * vn;
        if (Fn <= 0) continue;
        const vt = V.sub(vc, V.mul(ct.n, vn));
        const vtl = V.len(vt);
        const mu = poly.mu;
        let ft = mu * Fn * vtl / Math.sqrt(vtl * vtl + P.vEps * P.vEps);
        const ftCap = 0.02 * vtl / h; if (ft > ftCap) ft = ftCap;
        const Fc = V.add(V.mul(ct.n, Fn), vtl > 1e-9 ? V.mul(vt, -ft / vtl) : [0, 0, 0]);
        F = V.add(F, Fc); T = V.add(T, V.cross(r, Fc));
        Q[wb.side] += V.dot(V.cross(rw, Fc), a);
        wb.N += Fn; wb.contact = true; wb.slip = vtl; Nside[wb.side] += Fn;
      }
    }
    // ---- body points
    for (const bp of bodyPts) {
      const x = V.add(p, mv(Rm, bp));
      for (const poly of world) {
        if (!near(poly, x, 0.002)) continue;
        const ct = pointContact(x, poly);
        if (!ct) continue;
        const r = V.sub(x, p);
        const vc = V.add(v, V.cross(w, r));
        const vn = V.dot(vc, ct.n);
        let Fn = P.kB * ct.depth - 2 * P.zB * Math.sqrt(P.kB * M / 3) * vn;
        if (Fn <= 0) continue;
        const vt = V.sub(vc, V.mul(ct.n, vn)); const vtl = V.len(vt);
        let ft = P.muBody * Fn * vtl / Math.sqrt(vtl * vtl + P.vEps * P.vEps);
        const ftCap = 0.03 * vtl / h; if (ft > ftCap) ft = ftCap;
        const Fc = V.add(V.mul(ct.n, Fn), vtl > 1e-9 ? V.mul(vt, -ft / vtl) : [0, 0, 0]);
        F = V.add(F, Fc); T = V.add(T, V.cross(r, Fc));
      }
    }
    // ---- motors (forward-positive torque on wheels = -a direction)
    S.Vbat = P.bat.Voc - P.bat.Rint * S.Ibat;
    let Ib_ = 0;
    const mo = P.motor, G = P.G;
    for (let s = 0; s < 2; s++) {
      const sd = S.side[s];
      sd.u = s === 0 ? uL : uR;
      const Ofwd = -S.Om[s];
      const wm = G * Ofwd;
      let I = 0; const Rt = mo.Rm + P.drv.Rdrv;
      if (sd.u !== 0) I = (sd.u * S.Vbat - mo.Ke * wm) / Rt; else if (P.drv.brake) I = -mo.Ke * wm / Rt;
      I = Math.max(-P.drv.Imax, Math.min(P.drv.Imax, I));
      const Tm = mo.Kt * I - mo.Kt * mo.I0 * Math.tanh(wm / 15);
      const tau = G * Tm * (Tm * wm >= 0 ? P.eta : 1 / P.eta);
      const rr = P.Crr * Nside[s] * R * Math.tanh(Ofwd / 2);
      Q[s] += -(tau - rr);
      sd.I = I; sd.Tm = Tm; sd.tau = tau; sd.rpm = wm * 60 / (2 * Math.PI); sd.Ofwd = Ofwd;
      Ib_ += sd.u * I;
    }
    S.Ibat = Math.max(-2, Ib_);
    // ---- coupled rotational dynamics
    const Iw = mmul(mmul(Rm, Ib), mT(Rm));
    const Lr = mv(Iw, w);
    const Js = J(), Es = E();
    let tauA = V.sub(T, V.cross(w, Lr));
    const wxa = V.cross(w, a);
    tauA = V.sub(tauA, V.mul(wxa, Js * (S.Om[0] + S.Om[1])));
    const K = 2 * Js * Js / Es;
    const A = Iw.slice();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i * 3 + j] -= K * a[i] * a[j];
    const b = V.sub(tauA, V.mul(a, Js * (Q[0] + Q[1]) / Es));
    const dw = solve3(A, b);
    const adw = V.dot(a, dw);
    for (let s = 0; s < 2; s++) {
      const dOm = (Q[s] - Js * adw) / Es;
      S.Om[s] += dOm * h;
      S.th[s] += S.Om[s] * h;
    }
    S.v = V.add(v, V.mul(F, h / M));
    S.w = V.add(w, V.mul(dw, h));
    S.p = V.add(p, V.mul(S.v, h));
    const [qx, qy, qz, qw] = S.q, [wx, wy, wz] = S.w;
    let nq = [qx + 0.5 * h * (wx * qw + wy * qz - wz * qy), qy + 0.5 * h * (wy * qw + wz * qx - wx * qz), qz + 0.5 * h * (wz * qw + wx * qy - wy * qx), qw + 0.5 * h * (-wx * qx - wy * qy - wz * qz)];
    const ql = Math.hypot(...nq); S.q = nq.map(x => x / ql);
    S.t += h;
  }

  function step(dt, uL, uR) {
    const n = Math.max(1, Math.round(dt / P.h));
    const h = dt / n;
    for (let i = 0; i < n; i++) substep(h, uL, uR);
    const Rm = quatToMat(S.q);
    const up = [Rm[1], Rm[4], Rm[7]];
    S.upY = up[1];
    const sg = up[1] > 0.5 ? 1 : (up[1] < -0.5 ? -1 : 0);
    if (sg !== 0 && sg !== S.upSign) { S.flips++; S.upSign = sg; }
    S.airborne = !wheelsB.some(w => w.contact);
  }

  function telemetry() {
    const Rm = quatToMat(S.q);
    const fwd = [Rm[0], Rm[3], Rm[6]], up = [Rm[1], Rm[4], Rm[7]];
    const vf = V.dot(S.v, fwd);
    const pitch = Math.atan2(fwd[1], Math.hypot(fwd[0], fwd[2]));
    return { t: S.t, speed: Math.hypot(S.v[0], S.v[2]), vf, pitch, up: up[1], flips: S.flips, Vbat: S.Vbat, Ibat: S.Ibat, side: S.side, wheels: wheelsB };
  }

  function refPose() { // reference point (car centre) position & quaternion for rendering
    const Rm = quatToMat(S.q);
    return { pos: V.sub(S.p, mv(Rm, cOff)), q: S.q.slice() };
  }

  function reset(pos = [0, 0, 0], yaw = 0) {
    const q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    S.q = q; const Rm = quatToMat(q);
    S.p = V.add([pos[0], R + 0.0008 + pos[1], pos[2]], mv(Rm, cOff));
    S.v = [0, 0, 0]; S.w = [0, 0, 0]; S.Om = [0, 0]; S.flips = 0; S.upSign = 1; S.Ibat = 0; S.t = 0;
  }
  function setGear(G) { P.G = G; }
  function setMotor(m) { P.motor = m; }

  return { P, S, step, telemetry, refPose, reset, setWorld, setMu, setGear, setMotor, wheelsB, get world() { return world; } };
}
