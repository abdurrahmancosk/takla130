// Mini şehir: RC ölçeğinde (1 birim = 1 m) bir model şehir. Araç 14 cm, cadde 1 m, blok 3,2 m.
// Dünya tamamen sabit tohumlu üretilir: aynı ağdaki herkes birebir aynı şehri görür.
import { halfSpace, boxPoly, rampPoly } from './physics.js';

export const BLOCK = 3.2, STREET = 1.0, PITCH = BLOCK + STREET, NB = 5, CURB = 0.012, WALK = 0.18;
export const LINE = (i) => (i - NB / 2) * PITCH;               // cadde ekseni i = 0..5  ->  -10.5 .. 10.5
const MU = { asphalt: 0.9, walk: 0.85, grass: 0.62, ramp: 0.9, wall: 0.4, cone: 0.5 };

function rng(seed) {             // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const yawOf = (dx, dz) => Math.atan2(-dz, dx);                 // fizik: yerel +x bu yöne baksın

// ------------------------------------------------------------------ pistler (cadde eksenleri üzerinde kapalı çokgenler)
const L = LINE;
export const TRACKS = [
  { id: 'merkez', name: 'Merkez Turu', desc: 'Kısa ve hızlı, iki rampa', pts: [[L(1), L(1)], [L(4), L(1)], [L(4), L(4)], [L(1), L(4)]], laps: 3 },
  { id: 'rampa', name: 'Rampa Turu', desc: 'Atlama ve çift rampa dolu', pts: [[L(0), L(1)], [L(3), L(1)], [L(3), L(3)], [L(2), L(3)], [L(2), L(5)], [L(0), L(5)]], laps: 3 },
  { id: 'buyuk', name: 'Büyük Tur', desc: 'Şehrin çevresi, uzun düzlükler', pts: [[L(0), L(0)], [L(5), L(0)], [L(5), L(5)], [L(0), L(5)]], laps: 2 },
];

// rampalar: [x, z, yön dx, dz, L, H, genişlik, tür]   tür: 'k' sıçrama, 'd' çift (sıçrama + iniş)
const RAMPS = [
  [L(4), 0, 0, 1, 0.45, 0.055, 0.55, 'k'],
  [L(1), 0, 0, -1, 0.45, 0.055, 0.55, 'k'],
  [L(3), -4.2, 0, 1, 0.45, 0.06, 0.6, 'k'],
  [L(2), 3.8, 0, 1, 0.45, 0.07, 0.6, 'd'],
  [-8.4, L(5), -1, 0, 0.5, 0.07, 0.6, 'k'],
  [L(0), 4.2, 0, -1, 0.45, 0.06, 0.6, 'k'],
  [L(0), -4.6, 0, -1, 0.45, 0.07, 0.6, 'd'],
  [L(5), -4.2, 0, 1, 0.45, 0.06, 0.6, 'k'],
  [L(5), 4.2, 0, 1, 0.5, 0.075, 0.6, 'd'],
];

export function buildWorld() {
  const R = rng(130);
  const W = { flying: [], vis: {}, tops: [], colliders: [], blocks: [], buildings: [], trees: [], lamps: [], cones: [], barrels: [], ramps: [], fountain: null, parkLines: [], grassZones: [] };
  const box = (c, h, yaw, mu, kind) => { const b = boxPoly(c, h, yaw, mu, kind); W.colliders.push(b); return b; };

  // --- bloklar
  for (let bx = 0; bx < NB; bx++) for (let bz = 0; bz < NB; bz++) {
    const x0 = L(bx) + STREET / 2, x1 = L(bx + 1) - STREET / 2, z0 = L(bz) + STREET / 2, z1 = L(bz + 1) - STREET / 2;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    let type = 'city';
    if (bx === 2 && bz === 2) type = 'plaza';
    else if (bx === 1 && bz === 3) type = 'park';
    else if (bx === 3 && bz === 1) type = 'parking';
    W.blocks.push({ x0, x1, z0, z1, type });
    box([cx, CURB / 2, cz], [BLOCK / 2, CURB / 2, BLOCK / 2], 0, type === 'park' ? MU.grass : MU.walk, 'curb');
    if (type === 'park') W.grassZones.push([x0, x1, z0, z1]);
    // kaldırım ağaçları ve lambalar (her blokta değil)
    if (type === 'city' && R() < 0.75) {
      for (let k = 0; k < 2; k++) {
        const along = x0 + 0.5 + R() * (BLOCK - 1.0), side = R() < 0.5 ? z0 + 0.09 : z1 - 0.09;
        W.trees.push([along, side, 0.25 + R() * 0.12]);
        box([along, CURB + 0.08, side], [0.018, 0.08, 0.018], 0, MU.wall, 'tree');
      }
    }
    if (type !== 'park') for (const [lx, lz] of [[x0 + 1.0, z0 + 0.09], [x1 - 1.0, z1 - 0.09]]) {          // köşelerde değil: viraj içinden geçen araç takılmasın
      W.lamps.push([lx, lz]); box([lx, CURB + 0.2, lz], [0.012, 0.2, 0.012], 0, MU.wall, 'lamp');
    }
    if (type === 'city') {
      // 2x2 ya da 2x1 bina, aralarında 0,4 m ara sokak (araç girebilir)
      const ix0 = x0 + WALK, ix1 = x1 - WALK, iz0 = z0 + WALK, iz1 = z1 - WALK;
      const splitX = R() < 0.6, splitZ = R() < 0.6, gap = 0.4;
      const xs = splitX ? [[ix0, (ix0 + ix1) / 2 - gap / 2], [(ix0 + ix1) / 2 + gap / 2, ix1]] : [[ix0, ix1]];
      const zs = splitZ ? [[iz0, (iz0 + iz1) / 2 - gap / 2], [(iz0 + iz1) / 2 + gap / 2, iz1]] : [[iz0, iz1]];
      for (const [a0, a1] of xs) for (const [c0, c1] of zs) {
        const h = 0.7 + R() * R() * 2.8, hue = R();
        const b = { x0: a0, x1: a1, z0: c0, z1: c1, h, hue, style: Math.floor(R() * 3) };
        W.buildings.push(b);
        box([(a0 + a1) / 2, CURB + h / 2, (c0 + c1) / 2], [(a1 - a0) / 2, h / 2, (c1 - c0) / 2], 0, MU.wall, 'building');
      }
    } else if (type === 'plaza') {
      W.fountain = { x: cx, z: cz, r: 0.38, h: 0.09 };
      box([cx, CURB + 0.045, cz], [0.38, 0.045, 0.38], Math.PI / 4, MU.wall, 'fountain');
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {           // dört alçak rampa: meydandan caddeye sıçrama
        const rx = cx + dx * 1.15, rz = cz + dz * 1.15;
        addRamp(rx, rz, dx, dz, 0.35, 0.035, 0.45, 'k', CURB);
      }
    } else if (type === 'park') {
      addRamp(cx - 0.9, cz - 0.9, 1, 1, 0.55, 0.11, 0.5, 'k', CURB);
      addRamp(cx + 0.9, cz + 0.9, -1, -1, 0.55, 0.11, 0.5, 'k', CURB);
      addRamp(cx - 0.9, cz + 0.8, 1, 0, 0.4, 0.06, 0.5, 'd', CURB);
      addRamp(cx + 0.9, cz - 0.8, -1, 0, 0.6, 0.15, 0.5, 'k', CURB);
      // masa (iki tarafı rampalı düz platform)
      const tx = cx + 0.05, tz = cz;
      box([tx, CURB + 0.04, tz], [0.25, 0.04, 0.25], 0, MU.ramp, 'table');
      W.ramps.push({ table: true, x: tx, z: tz, w: 0.5, d: 0.5, h: 0.08, y0: CURB });
      addRamp(tx - 0.25 - 0.2, tz, 1, 0, 0.4, 0.08, 0.5, 'k', CURB);
      addRamp(tx + 0.25 + 0.2, tz, -1, 0, 0.4, 0.08, 0.5, 'k', CURB);
      for (const [px, pz] of [[x0 + 0.25, z0 + 0.25], [x1 - 0.25, z0 + 0.25], [x0 + 0.25, z1 - 0.25], [x1 - 0.25, z1 - 0.25]]) {
        W.trees.push([px, pz, 0.32]); box([px, CURB + 0.08, pz], [0.02, 0.08, 0.02], 0, MU.wall, 'tree');
      }
    } else if (type === 'parking') {
      for (let k = 0; k < 7; k++) W.parkLines.push([x0 + 0.35 + k * 0.42, z0 + 0.2, z0 + 0.75], [x0 + 0.35 + k * 0.42, z1 - 0.75, z1 - 0.2]);
      for (let k = 0; k < 6; k++) addCone(x0 + 0.5 + k * 0.42, cz + (k % 2 ? 0.12 : -0.12), CURB);        // slalom
      for (let k = 0; k < 3; k++) { const bxp = x1 - 0.35, bzp = cz - 0.5 + k * 0.5; W.barrels.push([bxp, bzp, CURB]); const c = box([bxp, CURB + 0.045, bzp], [0.035, 0.045, 0.035], 0, MU.cone, 'barrel'); c.knock = 'barrel'; c.ci = W.barrels.length - 1; }
    }
  }
  function addRamp(x, z, dx, dz, Lr, H, Wd, kind, y0 = 0) {
    const n = Math.hypot(dx, dz); dx /= n; dz /= n;
    if (kind === 'd') {               // masa atlama: çıkış rampası + düz masa + iniş rampası (yavaş gelen araç da takılmadan geçer)
      // tek dışbükey cisim (iç kenar yok): parçalı kurulsa birleşme çizgisi tekere görünmez duvar gibi davranır
      const top = 0.3, yaw = yawOf(dx, dz);
      W.colliders.push(tablePoly([x, y0, z], yaw, Lr, top, H, Wd, MU.ramp));
      W.ramps.push({ x: x - dx * (Lr / 2 + top / 2), z: z - dz * (Lr / 2 + top / 2), dx, dz, L: Lr, H, W: Wd, yaw, y0 });
      W.ramps.push({ x: x + dx * (Lr / 2 + top / 2), z: z + dz * (Lr / 2 + top / 2), dx: -dx, dz: -dz, L: Lr, H, W: Wd, yaw: yawOf(-dx, -dz), y0 });
      W.tops.push({ x, z, yaw, len: top, w: Wd, h: H, y0 });
      return;
    }
    const yaw = yawOf(dx, dz);
    W.colliders.push(rampPoly([x, y0, z], Lr, Wd, H, yaw, MU.ramp));
    W.ramps.push({ x, z, dx, dz, L: Lr, H, W: Wd, yaw, y0 });
  }
  function addCone(x, z, y0 = 0) {
    W.cones.push([x, z, y0]); const c = box([x, y0 + 0.03, z], [0.022, 0.03, 0.022], 0, MU.cone, 'cone');
    c.knock = 'cone'; c.ci = W.cones.length - 1;                  // çarpınca savrulur, 10 s sonra yerine döner
  }
  for (const r of RAMPS) addRamp(...r);

  // --- caddelerde kenara dizilmiş koniler ve bariyerler (yarış çizgisinden uzakta: eksenden 0,4 m)
  const onTrack = (x, z) => TRACKS.some(t => t.pts.some((p, i) => { const q = t.pts[(i + 1) % t.pts.length]; return segDist(x, z, p, q) < 0.3; }));
  for (let i = 0; i <= NB; i++) for (let j = 0; j < NB; j++) {
    const a = (L(j) + L(j + 1)) / 2;
    if (R() < 0.35) { const side = R() < 0.5 ? -0.4 : 0.4; for (let k = -1; k <= 1; k++) addCone(L(i) + side, a + k * 0.18); }
    if (R() < 0.25) { const side = R() < 0.5 ? -0.4 : 0.4; for (let k = -1; k <= 1; k++) addCone(a + k * 0.18, L(i) + side); }
    if (R() < 0.18 && !onTrack(L(i), a)) {               // yolu kısmen kapatan inşaat bariyeri (yalnız yarış dışı caddelerde)
      const side = R() < 0.5 ? -0.22 : 0.22;
      W.barrels.push([L(i) + side, a - 0.25, 0]); W.barrels.push([L(i) + side, a + 0.25, 0]);
      box([L(i) + side, 0.04, a], [0.045, 0.04, 0.3], 0, MU.wall, 'barrier');
      W.ramps.push({ barrier: true, x: L(i) + side, z: a, w: 0.09, d: 0.6, h: 0.08 });
    }
  }
  // --- şehir sınırı: dış kaldırım + duvar
  const E = L(NB) + STREET / 2, Wt = 0.6;
  for (const s of [-1, 1]) {
    box([0, CURB / 2, s * (E + Wt / 2)], [E + Wt, CURB / 2, Wt / 2], 0, MU.walk, 'curb');
    box([s * (E + Wt / 2), CURB / 2, 0], [Wt / 2, CURB / 2, E], 0, MU.walk, 'curb');
    box([0, 0.15, s * (E + Wt + 0.05)], [E + Wt + 0.1, 0.15, 0.05], 0, MU.wall, 'wall');
    box([s * (E + Wt + 0.05), 0.15, 0], [0.05, 0.15, E + Wt + 0.1], 0, MU.wall, 'wall');
  }
  W.edge = E; W.border = Wt;
  W.ground = halfSpace([0, 1, 0], 0, MU.asphalt);
  W.surfaceMu = (x, z) => W.grassZones.some(([a, b, c, d]) => x > a && x < b && z > c && z < d) ? MU.grass : MU.asphalt;
  W.tracks = TRACKS.map(buildTrack);
  W.spawn = { x: 0, z: L(2), yaw: yawOf(1, 0) };                          // meydanın altındaki caddede, doğuya bakar
  // serbest sürüşte oyuncular farklı yerlerde doğsun (aynı noktada doğup çarpışmasınlar)
  W.spawns = [[0, L(2), 1, 0], [0, L(3), -1, 0], [L(2), 0, 0, -1], [L(3), 0, 0, 1], [-4.2, L(2), 1, 0], [4.2, L(3), -1, 0], [L(2), -4.2, 0, 1], [L(3), 4.2, 0, -1]]
    .map(([x, z, dx, dz]) => ({ x, z, yaw: yawOf(dx, dz) }));
  buildGrid(W);
  return W;
}

// çıkış rampası + düz masa + iniş rampası tek dışbükey çokyüzlü (yamuk prizma)
function tablePoly(c, yaw, Lr, T, H, Wd, mu) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw), ex = [cs, 0, -sn], ez = [sn, 0, cs], a = Lr + T / 2;
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const P = (lx, ly, lz) => [c[0] + ex[0] * lx + ez[0] * lz, c[1] + ly, c[2] + ex[2] * lx + ez[2] * lz];
  const N = (nx, ny) => { const l = Math.hypot(nx, ny); return [ex[0] * nx / l, ny / l, ex[2] * nx / l]; };
  const planes = [];
  const add = (n, p) => planes.push({ n, d: dot(n, p) });
  add([0, -1, 0], P(0, 0, 0)); add([0, 1, 0], P(0, H, 0));
  add(ez, P(0, 0, Wd / 2)); add(ez.map(v => -v), P(0, 0, -Wd / 2));
  add(N(-H, Lr), P(-a, 0, 0)); add(N(H, Lr), P(a, 0, 0));
  return { planes, mu, center: [c[0], c[1] + H / 2, c[2]], radius: Math.hypot(a, H, Wd / 2) + 0.01, kind: 'ramp2', yaw, base: c, a, T, H, W: Wd };
}

function segDist(x, z, p, q) {
  const dx = q[0] - p[0], dz = q[1] - p[1], l2 = dx * dx + dz * dz;
  let t = ((x - p[0]) * dx + (z - p[1]) * dz) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (p[0] + t * dx), z - (p[1] + t * dz));
}

// ------------------------------------------------------------------ çarpışma ızgarası (1 m hücre)
function buildGrid(W) {
  const cell = 1.0, map = new Map();
  const key = (i, j) => i * 1000 + j;
  for (const c of W.colliders) {
    const r = c.radius, x = c.center[0], z = c.center[2];
    for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++)
      for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) {
        const k = key(i, j); if (!map.has(k)) map.set(k, []); map.get(k).push(c);
      }
  }
  W.query = (x, z, r, out) => {
    out.length = 0; const seen = new Set();
    for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++)
      for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) {
        const l = map.get(key(i, j)); if (!l) continue;
        for (const c of l) if (!seen.has(c)) { seen.add(c); out.push(c); }
      }
    return out;
  };
}

// ------------------------------------------------------------------ pist: köşeleri yuvarlatılmış yol, kontrol noktaları, çıkış ızgarası
function buildTrack(T) {
  const P = T.pts, n = P.length, rc = 0.55, pts = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
    const d1 = norm([b[0] - a[0], b[1] - a[1]]), d2 = norm([c[0] - b[0], c[1] - b[1]]);
    const p0 = [b[0] - d1[0] * rc, b[1] - d1[1] * rc], p2 = [b[0] + d2[0] * rc, b[1] + d2[1] * rc];
    for (let k = 0; k <= 8; k++) {               // ikinci derece Bezier ile köşe yayı
      const t = k / 8, u = 1 - t;
      pts.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]]);
    }
  }
  // yeniden örnekle (0,1 m) ve başlangıcı ilk düzlüğün ortasına kaydır
  const dense = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(l / 0.1));
    for (let k = 0; k < m; k++) dense.push([a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m]);
  }
  const mid = [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2];
  let i0 = 0, best = 1e9;
  dense.forEach((p, i) => { const d = Math.hypot(p[0] - mid[0], p[1] - mid[1]); if (d < best) { best = d; i0 = i; } });
  const path = dense.slice(i0).concat(dense.slice(0, i0));
  const s = [0];
  for (let i = 1; i <= path.length; i++) { const a = path[i - 1], b = path[i % path.length]; s.push(s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const len = s[path.length];
  const dir = path.map((p, i) => norm([path[(i + 1) % path.length][0] - p[0], path[(i + 1) % path.length][1] - p[1]]));
  const curv = path.map((p, i) => { const a = dir[(i - 3 + path.length) % path.length], b = dir[(i + 3) % path.length]; return Math.abs(a[0] * b[1] - a[1] * b[0]) / 0.6; });
  // kontrol noktaları: başlangıç + her düzlüğün ortası + her köşenin çıkışı
  const cps = [];
  const nCp = Math.max(4, Math.round(len / 7));
  for (let k = 0; k < nCp; k++) cps.push(Math.round((k / nCp) * path.length) % path.length);
  return { ...T, path, s, len, dir, curv, cps };
}
const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

// pist üzerindeki en yakın nokta (son bilinen indeksin çevresinde arar)
export function projectOnTrack(tr, x, z, hint = -1) {
  const N = tr.path.length; let bi = 0, bd = 1e9;
  const scan = (i) => { const p = tr.path[(i + N) % N]; const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; bi = (i + N) % N; } };
  if (hint >= 0) { for (let k = -60; k <= 60; k++) scan(hint + k); if (bd > 1.5 * 1.5) for (let i = 0; i < N; i++) scan(i); }
  else for (let i = 0; i < N; i++) scan(i);
  return { i: bi, d: Math.sqrt(bd), s: tr.s[bi] };
}
export function gridSlot(tr, k) {
  const back = 0.5 + 0.42 * Math.floor(k / 2), lat = (k % 2 ? 0.2 : -0.2);
  const N = tr.path.length, step = Math.round(back / 0.1);
  const i = (N - step) % N, p = tr.path[i], d = tr.dir[i];
  return { x: p[0] - d[1] * lat, z: p[1] + d[0] * lat, yaw: Math.atan2(-d[1], d[0]), i };
}
export function pointAt(tr, i, lat = 0) {
  const N = tr.path.length, p = tr.path[(i % N + N) % N], d = tr.dir[(i % N + N) % N];
  return { x: p[0] - d[1] * lat, z: p[1] + d[0] * lat, yaw: Math.atan2(-d[1], d[0]) };
}

// ------------------------------------------------------------------ zemin yüksekliği (gölge, yeniden doğma ve kamera için)
export function heightAt(W, x, z, out = []) {
  let h = 0;
  for (const c of W.query(x, z, 0.05, out)) {
    if (c.kind === 'ramp2') {
      const ex = [Math.cos(c.yaw), -Math.sin(c.yaw)], ez = [Math.sin(c.yaw), Math.cos(c.yaw)];
      const dx = x - c.base[0], dz = z - c.base[2], lx = Math.abs(dx * ex[0] + dz * ex[1]), lz = dx * ez[0] + dz * ez[1];
      if (lx <= c.a && Math.abs(lz) <= c.W / 2) h = Math.max(h, c.base[1] + (lx <= c.T / 2 ? c.H : c.H * (c.a - lx) / (c.a - c.T / 2)));
    } else if (c.kind === 'ramp') {
      const ex = [Math.cos(c.yaw), -Math.sin(c.yaw)], ez = [Math.sin(c.yaw), Math.cos(c.yaw)];
      const dx = x - c.base[0], dz = z - c.base[2];
      const lx = dx * ex[0] + dz * ex[1], lz = dx * ez[0] + dz * ez[1];
      if (Math.abs(lx) <= c.L / 2 && Math.abs(lz) <= c.W / 2) h = Math.max(h, c.base[1] + c.H * (lx / c.L + 0.5));
    } else if (c.half && c.kind !== 'building' && c.kind !== 'wall' && c.kind !== 'lamp' && c.kind !== 'tree') {
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), dx = x - c.center[0], dz = z - c.center[2];
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      if (Math.abs(lx) <= c.half[0] && Math.abs(lz) <= c.half[2]) h = Math.max(h, c.center[1] + c.half[1]);
    }
  }
  return h;
}
