// Görüntü: three.js sahnesi, model şehir, araç modelleri, kamera.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { LINE, NB, STREET, CURB } from './world.js';

export const QUALITY = {
  dusuk: { label: 'Düşük', pr: 1.0, aa: false, shadows: false, others: 'proc', player: 'lo', fog: [6, 16], trees: true },
  orta: { label: 'Orta', pr: 1.5, aa: false, shadows: false, others: 'lo', player: 'hi', fog: [8, 22], trees: true },
  yuksek: { label: 'Yüksek', pr: 2.0, aa: true, shadows: true, others: 'lo', player: 'hi', fog: [10, 30], trees: true },
};

// GPU adına göre otomatik kalite (Redmi 14C: Mali-G52, Redmi Note 9 Pro: Adreno 618, MatePad: yüksek çözünürlüklü ekran)
export function autoQuality() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : '');
    const g = String(name);
    let q = 'yuksek';
    if (/Mali-(G5\d|G3\d|T\d)|PowerVR|Adreno \(TM\) [345]\d\d|SwiftShader|llvmpipe/i.test(g)) q = 'dusuk';
    else if (/Adreno \(TM\) 6[0-4]\d|Mali-G(6\d|7[0-7])|Maleoon/i.test(g)) q = 'orta';
    return { q, gpu: g };
  } catch (e) { return { q: 'orta', gpu: '?' }; }
}

export function createRenderer(canvas, qk) {
  const Q = QUALITY[qk];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, powerPreference: 'high-performance', stencil: false });
  renderer.shadowMap.enabled = Q.shadows; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const sky = new THREE.Color('#bfdcf2');
  scene.background = sky; scene.fog = new THREE.Fog(sky, Q.fog[0], Q.fog[1]);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.02, Q.fog[1] + 5);
  const hemi = new THREE.HemisphereLight('#e8f3ff', '#5b5a4c', 1.7); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.3); sun.position.set(-3, 6, 2); scene.add(sun); scene.add(sun.target);
  if (Q.shadows) {
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera; sc.left = -2.5; sc.right = 2.5; sc.top = 2.5; sc.bottom = -2.5; sc.near = 0.5; sc.far = 14;
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.01;
  }
  let scale = 1;           // dinamik çözünürlük çarpanı
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, Q.pr);
    const capW = 2000 / Math.max(w, 1);            // çok yüksek çözünürlüklü tablette (2.8K) çizim genişliğini ~2000 px ile sınırla
    renderer.setPixelRatio(Math.min(dpr, capW) * scale);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();
  return {
    renderer, scene, camera, sun, Q,
    setScale(s) { if (Math.abs(s - scale) > 0.01) { scale = s; resize(); } }, get scale() { return scale; }, resize,
    followSun(x, z) { sun.position.set(x - 3, 6, z + 2); sun.target.position.set(x, 0, z); },
  };
}

// ------------------------------------------------------------------ yardımcı dokular
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4; return t;
}
const windowTex = () => canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5f7486'; g.fillRect(12, 14, 40, 34);
  g.fillStyle = '#8fa6b8'; g.fillRect(12, 14, 40, 6);
  g.fillStyle = '#d9d9d9'; g.fillRect(0, 58, w, 6);
});
const stripeTex = () => canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#f1c40f'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d1f22';
  for (let k = -2; k < 4; k++) { g.beginPath(); g.moveTo(k * 32, 0); g.lineTo(k * 32 + 16, 0); g.lineTo(k * 32 + 16 + 64, h); g.lineTo(k * 32 + 64, h); g.closePath(); g.fill(); }
});
export const checkerTex = () => canvasTex(64, 16, (g, w, h) => {
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 4, j * 4, 4, 4); }
});

// ------------------------------------------------------------------ şehir
export function buildCity(scene, W, Q) {
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const E = W.edge + W.border + 0.2;
  // dış zemin (çim) ve asfalt
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), lam({ color: '#6f9a55' }));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.04; scene.add(grass);          // asfaltın belirgin altında: uzakta titreşme olmasın
  const asph = new THREE.Mesh(new THREE.PlaneGeometry(2 * E, 2 * E), lam({ color: '#43474d' }));
  asph.rotation.x = -Math.PI / 2; asph.receiveShadow = true; scene.add(asph);
  // şerit çizgileri ve yaya geçitleri (instanced)
  const dash = [], zebra = [];
  for (let i = 0; i <= NB; i++) {
    const c = LINE(i);
    for (let t = -W.edge; t < W.edge; t += 0.36) {
      const nearX = Array.from({ length: NB + 1 }, (_, j) => Math.abs(t + 0.09 - LINE(j)) < STREET / 2 + 0.05).some(Boolean);
      if (!nearX) { dash.push([c, t + 0.09, 0]); dash.push([t + 0.09, c, Math.PI / 2]); }
    }
    for (let j = 0; j <= NB; j++) for (const sgn of [-1, 1]) for (let k = -3; k <= 3; k++) {
      zebra.push([LINE(i) + k * 0.12, LINE(j) + sgn * (STREET / 2 + 0.12), 0]);
      zebra.push([LINE(j) + sgn * (STREET / 2 + 0.12), LINE(i) + k * 0.12, Math.PI / 2]);
    }
  }
  const flat = (list, w, l, color, y) => {
    const g = new THREE.PlaneGeometry(w, l); g.rotateX(-Math.PI / 2);
    const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color }), list.length);
    const o = new THREE.Object3D();
    list.forEach(([x, z, r], k) => { o.position.set(x, y, z); o.rotation.set(0, r, 0); o.updateMatrix(); m.setMatrixAt(k, o.matrix); });
    m.receiveShadow = true; scene.add(m); return m;
  };
  flat(dash, 0.016, 0.18, '#e9e4c8', 0.0006);
  flat(zebra, 0.06, 0.2, '#e6e6e6', 0.0006);
  if (W.parkLines.length) flat(W.parkLines.map(([x, z0, z1]) => [x, (z0 + z1) / 2, 0]), 0.012, W.parkLines[0][2] - W.parkLines[0][1], '#f0f0f0', CURB + 0.0008);

  // kutular: kaldırım blokları, duvarlar, masa, bariyer, çeşme tabanı
  const boxes = W.colliders.filter(c => c.half && ['curb', 'wall', 'table', 'barrier', 'fountain'].includes(c.kind));
  const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lam({}), boxes.length);
  const o = new THREE.Object3D(), col = new THREE.Color();
  boxes.forEach((c, k) => {
    o.position.set(...c.center); o.rotation.set(0, c.yaw, 0); o.scale.set(2 * c.half[0], 2 * c.half[1], 2 * c.half[2]); o.updateMatrix();
    bm.setMatrixAt(k, o.matrix);
    const blk = W.blocks.find(b => c.kind === 'curb' && Math.abs((b.x0 + b.x1) / 2 - c.center[0]) < 0.01 && Math.abs((b.z0 + b.z1) / 2 - c.center[2]) < 0.01);
    const hex = c.kind === 'wall' ? '#8a7f72' : c.kind === 'table' ? '#c9a227' : c.kind === 'barrier' ? '#e05a1b' : c.kind === 'fountain' ? '#a7a39a'
      : blk && blk.type === 'park' ? '#5b9445' : blk && blk.type === 'parking' ? '#55595f' : blk && blk.type === 'plaza' ? '#cdbfa6' : '#b6b9bd';
    bm.setColorAt(k, col.set(hex));
  });
  bm.receiveShadow = true; scene.add(bm);
  if (W.fountain) {
    const f = W.fountain;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.01, 24), lam({ color: '#5aa7d6', emissive: '#12324a' }));
    water.position.set(f.x, CURB + 0.091, f.z); scene.add(water);
    const col2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.35, 12), lam({ color: '#d8d2c4' }));
    col2.position.set(f.x, CURB + 0.26, f.z); scene.add(col2);
  }

  // binalar: tek geometri, cepheler pencere dokulu, çatı düz renk
  const pos = [], uv = [], colr = [], idxS = [], idxR = [];
  const pushQuad = (a, b, c, d, uva, color, roof) => {
    const base = pos.length / 3;
    for (const p of [a, b, c, d]) pos.push(...p);
    uv.push(...uva); for (let k = 0; k < 4; k++) colr.push(color.r, color.g, color.b);
    (roof ? idxR : idxS).push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const PAL = ['#e8d5b5', '#d9c3c0', '#c7d3dc', '#d8dcc3', '#e3c9a1', '#bfc7cf', '#e6e0d4', '#cbb8a6'];
  for (const b of W.buildings) {
    const y0 = CURB, y1 = CURB + b.h, cc = new THREE.Color(PAL[Math.floor(b.hue * PAL.length)]);
    const wx = 0.22, wy = 0.26;            // pencere aralığı (m)
    const sides = [[[b.x0, b.z1], [b.x1, b.z1]], [[b.x1, b.z1], [b.x1, b.z0]], [[b.x1, b.z0], [b.x0, b.z0]], [[b.x0, b.z0], [b.x0, b.z1]]];
    for (const [p, q] of sides) {
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      pushQuad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], [0, 0, l / wx, 0, l / wx, b.h / wy, 0, b.h / wy], cc, false);
    }
    const rc = cc.clone().multiplyScalar(0.72);
    pushQuad([b.x0, y1, b.z1], [b.x1, y1, b.z1], [b.x1, y1, b.z0], [b.x0, y1, b.z0], [0, 0, 1, 0, 1, 1, 0, 1], rc, true);
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  bg.setIndex(idxS.concat(idxR)); bg.addGroup(0, idxS.length, 0); bg.addGroup(idxS.length, idxR.length, 1);
  bg.computeVertexNormals();
  const bmesh = new THREE.Mesh(bg, [lam({ map: windowTex(), vertexColors: true }), lam({ vertexColors: true })]);
  bmesh.castShadow = Q.shadows; bmesh.receiveShadow = true; scene.add(bmesh);

  // ağaçlar, lambalar, koniler, variller
  const inst = (geo, mat, list, place) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, k) => { place(o, it); o.updateMatrix(); m.setMatrixAt(k, o.matrix); });
    m.castShadow = Q.shadows; scene.add(m); return m;
  };
  const reset = () => { o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); };
  inst(new THREE.CylinderGeometry(0.012, 0.018, 0.2, 6), lam({ color: '#6b4a2e' }), W.trees, (o, [x, z, s]) => { reset(); o.position.set(x, CURB + 0.1, z); });
  inst(new THREE.IcosahedronGeometry(1, 0), lam({ color: '#4f8a3c', flatShading: true }), W.trees, (o, [x, z, s]) => { reset(); o.position.set(x, CURB + 0.18 + s * 0.7, z); o.scale.setScalar(s * 0.55); });
  inst(new THREE.CylinderGeometry(0.006, 0.009, 0.42, 6), lam({ color: '#3c4148' }), W.lamps, (o, [x, z]) => { reset(); o.position.set(x, CURB + 0.21, z); });
  inst(new THREE.BoxGeometry(0.05, 0.012, 0.025), lam({ color: '#fff6c8', emissive: '#6b6230' }), W.lamps, (o, [x, z]) => { reset(); o.position.set(x + 0.02, CURB + 0.42, z); });
  W.vis.cones = inst(new THREE.ConeGeometry(0.022, 0.06, 10), lam({ color: '#f26a1b' }), W.cones, (o, [x, z, y0]) => { reset(); o.position.set(x, y0 + 0.03, z); });
  W.vis.barrels = inst(new THREE.CylinderGeometry(0.034, 0.034, 0.09, 12), lam({ color: '#e45a1e' }), W.barrels, (o, [x, z, y0]) => { reset(); o.position.set(x, (y0 || 0) + 0.045, z); });

  // masa atlamaların düz üstleri
  if (W.tops.length) {
    const tm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lam({ color: '#c9a227' }), W.tops.length);
    W.tops.forEach((t, k) => { o.position.set(t.x, t.y0 + t.h / 2, t.z); o.rotation.set(0, t.yaw, 0); o.scale.set(t.len + 0.004, t.h, t.w); o.updateMatrix(); tm.setMatrixAt(k, o.matrix); });
    tm.castShadow = Q.shadows; tm.receiveShadow = true; scene.add(tm);
  }
  // rampalar (eğik yüzey sarı-siyah çizgili)
  const rp = [], ru = [], ri = [], rsi = [];
  for (const r of W.ramps) {
    if (r.table || r.barrier) continue;
    const ex = [Math.cos(r.yaw), 0, -Math.sin(r.yaw)], ez = [Math.sin(r.yaw), 0, Math.cos(r.yaw)];
    const P = (lx, ly, lz) => [r.x + ex[0] * lx + ez[0] * lz, r.y0 + ly, r.z + ex[2] * lx + ez[2] * lz];
    const a = P(-r.L / 2, 0.0005, -r.W / 2), b = P(-r.L / 2, 0.0005, r.W / 2), c = P(r.L / 2, r.H, r.W / 2), d = P(r.L / 2, r.H, -r.W / 2);
    const e = P(r.L / 2, 0, r.W / 2), f = P(r.L / 2, 0, -r.W / 2);
    const add = (verts, uvs, list) => { const base = rp.length / 3; verts.forEach(v => rp.push(...v)); ru.push(...uvs); list.push(base, base + 1, base + 2, base, base + 2, base + 3); };
    add([a, b, c, d], [0, 0, r.W / 0.12, 0, r.W / 0.12, r.L / 0.12, 0, r.L / 0.12], ri);            // eğik yüz
    add([e, f, d, c], [0, 0, 1, 0, 1, 1, 0, 1], rsi);                                                 // dik arka yüz
    const base = rp.length / 3; [a, f, d, b, c, e].forEach(v => rp.push(...v)); ru.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    rsi.push(base, base + 1, base + 2, base + 3, base + 4, base + 5);                                  // yan üçgenler
  }
  if (rp.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
    g.setIndex(ri.concat(rsi)); g.addGroup(0, ri.length, 0); g.addGroup(ri.length, rsi.length, 1); g.computeVertexNormals();
    const m = new THREE.Mesh(g, [lam({ map: stripeTex(), side: THREE.DoubleSide }), lam({ color: '#2d3035', side: THREE.DoubleSide })]);
    m.castShadow = Q.shadows; m.receiveShadow = true; scene.add(m);
  }
}

// ------------------------------------------------------------------ pist süslemeleri (yalnız yarışta)
export function buildTrackDecor(scene, tr) {
  const g = new THREE.Group();
  const p = tr.path[0], d = tr.dir[0], yaw = Math.atan2(-d[1], d[0]);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, STREET), new THREE.MeshLambertMaterial({ map: checkerTex() }));
  line.rotation.set(-Math.PI / 2, 0, 0); line.position.set(p[0], 0.0012, p[1]);
  const lh = new THREE.Group(); lh.add(line); lh.rotation.y = yaw; lh.position.set(0, 0, 0);
  line.position.set(0, 0.0012, 0); lh.position.set(p[0], 0, p[1]); g.add(lh);
  // başlangıç takı
  const arch = new THREE.Group();
  const postM = new THREE.MeshLambertMaterial({ color: '#2b47c4' });
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.03), postM); post.position.set(0, 0.21, s * (STREET / 2 + 0.06)); arch.add(post); }
  const ban = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, STREET + 0.2), new THREE.MeshLambertMaterial({ map: checkerTex() }));
  ban.position.set(0, 0.42, 0); arch.add(ban);
  arch.rotation.y = yaw; arch.position.set(p[0], 0, p[1]); g.add(arch);
  // yol okları
  const arrowG = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0.09, 0), new THREE.Vector2(-0.05, 0.07), new THREE.Vector2(-0.02, 0), new THREE.Vector2(-0.05, -0.07)]));
  arrowG.rotateX(-Math.PI / 2);
  const am = new THREE.MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.75, depthWrite: false });
  const n = Math.floor(tr.len / 1.2), arrows = new THREE.InstancedMesh(arrowG, am, n), o = new THREE.Object3D();
  for (let k = 0; k < n; k++) {
    const i = Math.floor(k * tr.path.length / n), q = tr.path[i], dd = tr.dir[i];
    o.position.set(q[0], 0.0015, q[1]); o.rotation.set(0, Math.atan2(-dd[1], dd[0]), 0); o.updateMatrix(); arrows.setMatrixAt(k, o.matrix);
  }
  g.add(arrows);
  // kontrol noktası işaretleri (yan direkler)
  for (const ci of tr.cps.slice(1)) {
    const q = tr.path[ci], dd = tr.dir[ci], yy = Math.atan2(-dd[1], dd[0]);
    const cp = new THREE.Group();
    for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), new THREE.MeshLambertMaterial({ color: '#ffd23a' })); m.position.set(0, 0.1, s * (STREET / 2 - 0.02)); cp.add(m); }
    cp.rotation.y = yy; cp.position.set(q[0], 0, q[1]); g.add(cp);
  }
  scene.add(g); return g;
}

// ------------------------------------------------------------------ araç modelleri
const loader = new GLTFLoader();
const loadGLB = (url) => new Promise((res, rej) => loader.load(url, (g) => res(g.scene), undefined, rej));
let MODELS = null;
export async function loadCarModels(need) {
  MODELS = {};
  for (const k of need) if (k !== 'proc') {
    const sc = await loadGLB(`models/car_${k}.glb`);
    sc.traverse((m) => { if (m.isMesh) { m.geometry.deleteAttribute('color'); m.geometry = toCreasedNormals(m.geometry, 0.6); } });   // CAD kenarları keskin kalsın
    MODELS[k] = sc;
  }
}
const CORNER = { FL: [0.037, -0.05505, 0], RL: [-0.037, -0.05505, 0], FR: [0.037, 0.05505, 1], RR: [-0.037, 0.05505, 1] };
const MAT = {};
function mats() {
  if (MAT.rim) return MAT;
  const st = (o) => new THREE.MeshStandardMaterial(o);
  Object.assign(MAT, {
    rim: st({ color: '#1d2a66', roughness: 0.55 }), tire: st({ color: '#17181a', roughness: 0.92 }), gear: st({ color: '#2b47c4', roughness: 0.5 }),
    steel: st({ color: '#c9ced4', roughness: 0.3, metalness: 1 }), cap: st({ color: '#1b1c1f', roughness: 0.8 }),
  });
  return MAT;
}
function bodyMat(color) { return new THREE.MeshStandardMaterial({ color, roughness: 0.6 }); }

// araç görünümü: kök (konum + dönüş) ve dört dönen teker grubu
export function makeCarView(kind, color) {
  const root = new THREE.Group(), body = bodyMat(color), wheels = [];
  const M = mats();
  if (kind === 'proc' || !MODELS || !MODELS[kind]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.087, 0.026, 0.081), body); b.position.y = 0.0025; root.add(b);
    for (const [name, [x, z, side]] of Object.entries(CORNER)) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.0348, 0.0348, 0.0096, 14), M.tire); t.rotation.x = Math.PI / 2; g.add(t);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 10), M.rim); r.rotation.x = Math.PI / 2; r.position.z = Math.sign(z) * -0.004; g.add(r);
      root.add(g); wheels.push({ g, side });
    }
  } else {
    const src = MODELS[kind].clone(true);
    const groups = {};
    for (const [name, [x, z, side]] of Object.entries(CORNER)) { const g = new THREE.Group(); g.position.set(x, 0, z); root.add(g); groups[name] = g; wheels.push({ g, side }); }
    const meshes = []; src.traverse((m) => { if (m.isMesh) meshes.push(m); });
    for (const m of meshes) {
      const n = (m.name || m.parent?.name || '');
      const corner = (n.match(/_(FL|FR|RL|RR)$/) || [])[1];
      m.material = /^(chassis|lid|switch)/.test(n) ? body : /^wheel/.test(n) ? M.rim : /^tire/.test(n) ? M.tire : /^hubcap/.test(n) ? M.cap
        : /^(compound|pinion)/.test(n) ? M.gear : M.steel;
      m.castShadow = true;
      const wp = new THREE.Vector3(); m.getWorldPosition(wp);
      if (corner) { const g = groups[corner]; m.position.copy(wp).sub(g.position); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); g.add(m); }
      else { m.position.copy(wp); root.add(m); }
    }
  }
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.085, 20), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.32, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.renderOrder = 1;
  return {
    root, blob, body, wheels,
    setColor(c) { body.color.set(c); },
    setPose(p, q, th) {
      root.position.set(p[0], p[1], p[2]); root.quaternion.set(q[0], q[1], q[2], q[3]);
      for (const w of wheels) w.g.rotation.z = th[w.side];
    },
    setBlob(x, y, z, a) { blob.position.set(x, y + 0.0015, z); blob.material.opacity = a; blob.visible = a > 0.02; },
  };
}

// ------------------------------------------------------------------ çarpılan duba ve variller savrulur, 10 s sonra yerine döner
const fo = new THREE.Object3D();
export function knock(W, c, v) {
  const mesh = c.knock === 'cone' ? W.vis.cones : W.vis.barrels; if (!mesh) return;
  const sp = Math.hypot(v[0], v[2]);
  W.flying.push({ mesh, k: c.ci, c, p: c.center.slice(), v: [v[0] * 1.35, 0.6 + sp * 0.35, v[2] * 1.35], r: [0, 0, 0],
    w: [(Math.random() - 0.5) * 24, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 24], t: 0, h: c.half[1], rest: false });
}
export function updateFlying(W, dt) {
  for (let i = W.flying.length - 1; i >= 0; i--) {
    const f = W.flying[i]; f.t += dt;
    if (f.t > 10) {                                       // yerine dön
      fo.position.set(...f.c.center); fo.rotation.set(0, 0, 0); fo.updateMatrix();
      f.mesh.setMatrixAt(f.k, fo.matrix); f.mesh.instanceMatrix.needsUpdate = true; f.c.dead = false; W.flying.splice(i, 1); continue;
    }
    if (!f.rest) {
      f.v[1] -= 9.81 * dt;
      for (let a = 0; a < 3; a++) { f.p[a] += f.v[a] * dt; f.r[a] += f.w[a] * dt; }
      if (f.p[1] < f.h * 0.75) {
        f.p[1] = f.h * 0.75; f.v[1] = Math.abs(f.v[1]) * 0.3; f.v[0] *= 0.55; f.v[2] *= 0.55; f.w = f.w.map(x => x * 0.5);
        if (Math.hypot(...f.v) < 0.15) { f.rest = true; f.r = [Math.PI / 2, f.r[1], 0]; }
      }
    }
    fo.position.set(...f.p); fo.rotation.set(...f.r); fo.updateMatrix();
    f.mesh.setMatrixAt(f.k, fo.matrix); f.mesh.instanceMatrix.needsUpdate = true;
  }
}
