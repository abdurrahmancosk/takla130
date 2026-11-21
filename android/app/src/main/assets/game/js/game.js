// Oyun oturumu: serbest sürüş ve yarış; oyuncu aracı, botlar, uzak oyuncular, tur/sıra hesabı.
import { createCar, MOTORS, halfSpace, boxPoly } from './physics.js';
import { CP } from './carparams.js';
import { projectOnTrack, gridSlot, pointAt, heightAt } from './world.js';
import { makeCarView } from './render.js';
import { sampleRemote } from './net.js';

const TICK = 1 / 120;
export const BOT_NAMES = ['Kıvılcım', 'Fırtına', 'Roket', 'Şimşek', 'Tornado', 'Pırpır', 'Zıpzıp'];
export const BOT_COLORS = ['#e2621b', '#7b3fd1', '#18a0a6', '#d6336c', '#2f9e44', '#f08c00', '#495057'];
export const DIFF = { kolay: { name: 'Kolay', thr: 0.72, look: 0.65, noise: 0.18, band: 0.6 }, orta: { name: 'Orta', thr: 0.85, look: 0.6, noise: 0.1, band: 0.72 }, zor: { name: 'Zor', thr: 1.0, look: 0.55, noise: 0.04, band: 0.88 } };

// sürüş yardımı (yalnız oyuncu): direksiyon önceliği, istenen dönüş hızına yaw kontrolü, yanal kaymayı sönümleme
export const ASSIST = {
  kapali: null,
  // R: tam direksiyonda dönüş yarıçapı (m), rmax: en yüksek dönüş hızı (rad/s), keep: tam direksiyonda korunan gaz
  normal: { R: 0.5, rmax: 5.0, yaw: 80, lat: 15, keep: 0.8 },
  guclu: { R: 0.42, rmax: 6.0, yaw: 100, lat: 24, keep: 0.9 },
};
// çarpınca davranış: e = seksme katsayısı, hop = yukarı sıçrama, flip = takla (yalnız sert duvarlar)
const HIT = { building: { e: 0.4, hard: true }, wall: { e: 0.45, hard: true }, barrier: { e: 0.5, hard: true }, fountain: { e: 0.45, hard: true },
  table: { e: 0.4, hard: true }, lamp: { e: 0.6 }, tree: { e: 0.6 }, curb: { curb: true } };

const quatFwd = (q) => { const [x, y, z, w] = q; return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)]; };
const quatUp = (q) => { const [x, y, z, w] = q; return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)]; };

// komut (gaz, direksiyon) -> sol/sağ motor (kart gibi tank karışımı).
// Araç ters dönünce de aynı kalır: ters araçta teker zemine üstten değdiği için araç gövdeye göre geriye, yani
// kameraya göre yine ileri gider ve sol tekerler solda kalır (fizik testiyle doğrulandı). Kamera bu "etkin ileri" yönü izler.
export function mix(thr, st) {
  const c = (v) => Math.max(-1, Math.min(1, v));
  return [c(thr + st), c(thr - st)];
}

export class Game {
  constructor(ctx) {
    this.ctx = ctx;            // { R, W, net, settings, hud, audio }
    this.drivers = [];         // yerel olarak simüle edilen araçlar (oyuncu + botlar)
    this.remotes = new Map();  // uzak araç görünümleri
    this.acc = 0; this.mode = null; this.race = null; this.buf = [];
  }
  get player() { return this.drivers[0]; }

  makeDriver({ id, name, color, isBot, motor, gear, view }) {
    const s = this.ctx.settings;
    const car = createCar(CP, { motor: MOTORS[motor || s.motor], G: CP.gears[gear || s.gear].ratio, mu: 0.9, Imax: 2.5, zB: 0.45, h: isBot ? 1 / 900 : 1 / 1600 });
    const v = makeCarView(view, color);
    this.ctx.R.scene.add(v.root); this.ctx.R.scene.add(v.blob);
    const d = { id, name, color, isBot, car, view: v, ground: halfSpace([0, 1, 0], 0, 0.9), inv: false, ctrl: [0, 0], cmd: { thr: 0, st: 0 }, flipT: 0,
      stuckT: 0, sideT: 0, hitT: 0, ai: isBot ? { lane: 0, revT: 0, tries: 0, seed: Math.random() * 100 } : null, r: null, list: [] };
    return d;
  }
  clear() {
    for (const d of this.drivers) { this.ctx.R.scene.remove(d.view.root); this.ctx.R.scene.remove(d.view.blob); if (d.tag) d.tag.remove(); }
    for (const v of this.remotes.values()) { this.ctx.R.scene.remove(v.view.root); this.ctx.R.scene.remove(v.view.blob); v.tag.remove(); }
    this.drivers = []; this.remotes.clear(); this.race = null;
    if (this.decor) { this.ctx.R.scene.remove(this.decor); this.decor = null; }
  }

  // ---------------------------------------------------------------- başlat
  startFree() {
    const { W, settings: s } = this.ctx;
    this.clear(); this.mode = 'free';
    const p = this.makeDriver({ id: 'me', name: s.name, color: s.color, isBot: false, view: this.ctx.R.Q.player });
    this.drivers.push(p);
    const id = this.ctx.net ? this.ctx.net.me.id : 'me';
    let hsh = 0; for (const ch of id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
    const sp = W.spawns[hsh % W.spawns.length];
    this.place(p, sp.x, sp.z, sp.yaw);
  }
  // opts: { track (index), laps, bots, diff, online, grid {id:slot}, startLocal, same }
  startRace(opts) {
    const { W, settings: s, net } = this.ctx;
    this.clear(); this.mode = 'race';
    const tr = W.tracks[opts.track];
    const same = opts.same;
    const p = this.makeDriver({ id: opts.online ? net.me.id : 'me', name: s.name, color: s.color, isBot: false, view: this.ctx.R.Q.player,
      motor: same ? 'medium' : null, gear: same ? 'DENGE' : null });
    this.drivers.push(p);
    const runBots = !opts.online || net.hosting;
    const slots = opts.grid || { me: 0 };
    let mySlot = opts.online ? (slots[net.me.id] ?? 0) : 0;
    const used = new Set(Object.values(slots));
    if (runBots) for (let k = 0; k < opts.bots; k++) {
      const bid = (opts.online ? net.me.id : 'b') + '-b' + k;
      const b = this.makeDriver({ id: bid, name: 'Bot ' + BOT_NAMES[k % BOT_NAMES.length], color: BOT_COLORS[k % BOT_COLORS.length], isBot: true,
        view: this.ctx.R.Q.others, motor: 'medium', gear: 'DENGE' });
      b.ai.lane = ((k % 3) - 1) * 0.16; b.ai.diff = DIFF[opts.diff] || DIFF.orta;
      b.slot = slots[bid] ?? (() => { let i = 0; while (used.has(i)) i++; used.add(i); return i; })();
      this.drivers.push(b);
    }
    this.race = { tr, laps: opts.laps, online: !!opts.online, startLocal: opts.startLocal, results: null, finishOrder: [], firstFinish: 0, wrongT: 0, lastPr: 0 };
    for (const d of this.drivers) {
      const slot = d === p ? mySlot : d.slot;
      const g = gridSlot(tr, slot);
      this.place(d, g.x, g.z, g.yaw);
      d.r = { idx: g.i, pr: -(tr.len - tr.s[g.i]), lapsDone: 0, cpNext: 0, started: false, lapStart: 0, laps: [], best: 0, fin: 0, lastPrT: 0, prHist: [] };
    }
    this.decor = this.ctx.buildDecor(tr);
  }
  place(d, x, z, yaw, lift = 0.004) {
    const h = heightAt(this.ctx.W, x, z, this.buf);
    d.car.reset([x, h + lift, z], yaw); d.inv = false; d.flipT = 0; d.stuckT = 0; d.sideT = 0;
  }

  // ---------------------------------------------------------------- simülasyon
  update(dt, input) {
    this.acc = Math.min(this.acc + dt, 4 * TICK);
    while (this.acc >= TICK) { this.tick(TICK, input); this.acc -= TICK; }
  }
  // yarış saati: başlangıç anına kadar gerçek saat (herkes aynı anda çıksın), sonrası simülasyon zamanı
  // (yavaş bir cihazda fizik yavaşlarsa saat de onunla yavaşlar: süre adil kalır)
  raceTime() {
    const R = this.race; if (!R) return 0;
    return R.simStart == null ? (performance.now() - R.startLocal) / 1000 : this.simT - R.simStart;
  }
  tick(h, input) {
    const { W, net } = this.ctx;
    this.simT = (this.simT || 0) + h;
    if (this.race && this.race.simStart == null && performance.now() >= this.race.startLocal) this.race.simStart = this.simT;
    const R = this.race, running = !R || this.raceTime() >= 0;
    // diğer araçların çarpışma kutuları
    const others = [];
    for (const d of this.drivers) { const rp = d.car.refPose(); others.push({ id: d.id, p: rp.pos, q: rp.q }); }
    for (const [id, rv] of this.remotes) if (rv.cur) others.push({ id, p: rv.cur.p, q: rv.cur.q });
    for (const d of this.drivers) {
      const S = d.car.S, x = S.p[0], z = S.p[2];
      // komut
      let thr = 0, st = 0;
      if (!d.isBot) { thr = input.thr; st = input.st; if (input.flip && d.flipT <= 0 && S.v[0] ** 2 + S.v[2] ** 2 > 0.6) d.flipT = 0.32; }
      else if (running) [thr, st] = this.botDrive(d);
      const A = !d.isBot && d.flipT <= 0 ? ASSIST[this.ctx.settings.assist || 'normal'] : null;
      let stMotor = st;
      if (A) {
        // yüksek hızda dönüşü motorlar arası fark değil yardım yapar (fark aracı yavaşlatıp kaydırıyordu); düşük hızda tank gibi yerinde döner
        const sp = Math.hypot(S.v[0], S.v[2]);
        stMotor = st * Math.max(0.15, Math.min(1, 1 - (sp - 0.4) / 1.6));
        thr = Math.sign(thr) * Math.min(Math.abs(thr), 1 - Math.abs(st) * (1 - A.keep));
      }
      if (d.flipT > 0) { d.flipT -= h; thr = -1; st = 0; }        // takla: ileri giderken kısa süre tam geri
      if (!running || (d.r && d.r.fin)) { thr = 0; st = 0; if (d.r && d.r.fin) thr = 0; }
      const upY = d.car.S.upY ?? 1;
      if (upY < -0.3) d.inv = true; else if (upY > 0.3) d.inv = false;
      d.ctrl = mix(thr, A ? stMotor : st);
      // çevre
      // ön eleme: aracın merkezinden 0,14 m'den uzak cisimleri bu adımda hiç hesaba katma (fizik maliyetinin çoğu buradaydı)
      const cand = W.query(x, z, 0.45, d.list), list = d.near || (d.near = []); list.length = 0;
      const y = S.p[1], margin = 0.14 + Math.hypot(S.v[0], S.v[1], S.v[2]) * h * 2;
      for (const c of cand) { if (c.dead) continue; let m = -1e9; for (const pl of c.planes) { const v = pl.n[0] * x + pl.n[1] * y + pl.n[2] * z - pl.d; if (v > m) m = v; } if (m < margin) list.push(c); }
      d.ground.mu = W.surfaceMu(x, z); list.push(d.ground);
      for (const o of others) {
        if (o.id === d.id) continue;
        const dx = o.p[0] - x, dz = o.p[2] - z; if (dx * dx + dz * dz > 0.25) continue;
        const f = quatFwd(o.q);
        list.push(boxPoly([o.p[0], o.p[1], o.p[2]], [0.07, 0.034, 0.062], Math.atan2(-f[2], f[0]), 0.5, 'car'));
      }
      d.car.setWorld(list);
      d.car.step(h, d.ctrl[0], d.ctrl[1]);
      if (A) this.assist(d, A, st, h);
      this.impacts(d, h);
      this.watchdog(d, h);
      if (R && running) this.progress(d, h);
    }
  }
  assist(d, A, st, h) {
    const S = d.car.S;
    if (!d.car.wheelsB.some(w => w.contact)) return;           // havadayken (takla, sıçrama) dokunma
    const sp = Math.hypot(S.v[0], S.v[2]);
    if (sp < 0.35) return;                                     // yavaşken tank dönüşü kendi yeter
    const f0 = quatFwd(S.q), fwdSpeed = (S.v[0] * f0[0] + S.v[2] * f0[2]) * (d.inv ? -1 : 1);
    const dir = fwdSpeed < -0.2 ? -1 : 1;                      // geri giderken direksiyon araba gibi ters çalışır
    const target = -st * dir * Math.min(A.rmax, sp / A.R);     // dünya Y; eksi = saat yönü = sağa
    S.w[1] += (target - S.w[1]) * Math.min(1, h * A.yaw);
    const f = quatFwd(S.q), fl = Math.hypot(f[0], f[2]) || 1, rx = -f[2] / fl, rz = f[0] / fl;
    const vl = S.v[0] * rx + S.v[2] * rz, k = Math.min(1, h * A.lat);
    S.v[0] -= rx * vl * k; S.v[2] -= rz * vl * k;              // yana kaymayı azalt: daha çok tutunma
  }
  // çarpma tepkileri: direk/ağaçtan seker, kaldırımda zıplar, duvara sert çarpınca takla atar, duba/varil savrulur
  impacts(d, h) {
    const S = d.car.S, x = S.p[0], y = S.p[1], z = S.p[2];
    if (d.hitT > 0) d.hitT -= h;
    for (const c of d.near) {
      if (!c.half || c.dead) continue;
      let m = -1e9, n = null;
      for (const pl of c.planes) { const v = pl.n[0] * x + pl.n[1] * y + pl.n[2] * z - pl.d; if (v > m) { m = v; n = pl.n; } }
      if (Math.abs(n[1]) > 0.5 || m > 0.085) continue;           // üstünde duruyor ya da değmiyor
      const vn = S.v[0] * n[0] + S.v[2] * n[2], a = -vn;
      if (c.knock) {
        if (a > 0.15) { c.dead = true; this.ctx.onKnock && this.ctx.onKnock(c, S.v.slice(), d); S.v[0] *= 0.88; S.v[2] *= 0.88; S.v[1] += 0.12; }
        continue;
      }
      const H = HIT[c.kind]; if (!H) continue;
      if (!H.hard && !H.curb && m < 0.075) { S.p[0] += n[0] * 0.002; S.p[2] += n[2] * 0.002; }   // direğe sıkışmasın: yavaşça dışarı it
      if (d.hitT > 0 || a < 0.6) continue;
      d.hitT = 0.25;
      if (H.curb) { if (a > 0.8 && y < c.center[1] + c.half[1] + 0.05) S.v[1] += 0.2 * a; continue; }   // kaldırıma çarpınca hopla
      S.v[0] += n[0] * a * (1 + H.e); S.v[2] += n[2] * a * (1 + H.e);
      S.v[1] += H.hard ? 0.2 + 0.25 * a : 0.15 + 0.1 * a;
      if (H.hard && a > 1.1) { S.w[0] += n[2] * 6.5 * a; S.w[2] += -n[0] * 6.5 * a; }   // burun yukarı: takla
      else if (!H.hard) S.w[1] += (Math.random() - 0.5) * 6;                              // direkten sekip yön değiştir
      this.ctx.onImpact && this.ctx.onImpact(d, a, c.kind);
    }
  }
  // takıldı / ters / düştü kontrolü
  watchdog(d, h) {
    const S = d.car.S, sp = Math.hypot(S.v[0], S.v[2]), up = S.upY ?? 1;
    if (S.p[1] < -0.5 || Math.abs(S.p[0]) > 14 || Math.abs(S.p[2]) > 14 || !isFinite(S.p[0])) { this.respawn(d); return; }
    if (Math.abs(up) < 0.35) d.sideT += h; else d.sideT = 0;               // yan yatmış
    if (d.sideT > (d.isBot ? 1.5 : 3.0)) { if (d.isBot || this.ctx.settings.autoReset) this.respawn(d); d.sideT = 0; }
    if (!d.isBot) {                                            // oyuncu: gaz basılıyken 1 s kıpırdamazsa hoplayıp kurtulsun
      const pushing = Math.abs(d.ctrl[0]) + Math.abs(d.ctrl[1]) > 0.8, grounded = d.car.wheelsB.some(w => w.contact);
      if (pushing && grounded && sp < 0.05) d.stuckT += h; else d.stuckT = Math.max(0, d.stuckT - h * 2);
      if (d.stuckT > 1.0) {
        d.stuckT = 0; const f = quatFwd(S.q), sg = (d.inv ? -1 : 1) * Math.sign(d.ctrl[0] + d.ctrl[1] || 1);
        S.v[0] -= f[0] * sg * 0.35; S.v[2] -= f[2] * sg * 0.35; S.v[1] += 0.55;
        this.ctx.onImpact && this.ctx.onImpact(d, 0.7, 'unstick');
      }
    }
    if (d.isBot) {
      const pushing = Math.abs(d.ctrl[0]) + Math.abs(d.ctrl[1]) > 0.6;
      if (pushing && sp < 0.06) d.stuckT += h; else d.stuckT = Math.max(0, d.stuckT - h);
      if (d.stuckT > 1.2) { d.stuckT = 0; d.ai.tries++; if (d.ai.tries > 2) { this.respawn(d); d.ai.tries = 0; } else d.ai.revT = 0.7; }
    }
  }
  respawn(d) {
    if (this.race && d.r) { const pt = pointAt(this.race.tr, d.r.idx, d.ai ? d.ai.lane : 0); this.place(d, pt.x, pt.z, pt.yaw, 0.01); }
    else { const S = d.car.S, f = quatFwd(S.q), yaw = Math.atan2(-f[2], f[0]); const ok = Math.abs(S.p[0]) < 12 && Math.abs(S.p[2]) < 12;
      if (ok) this.place(d, S.p[0], S.p[2], isFinite(yaw) ? yaw : 0, 0.03); else this.place(d, this.ctx.W.spawn.x, this.ctx.W.spawn.z, this.ctx.W.spawn.yaw); }
    if (!d.isBot) this.ctx.hud.toast('Araç düzeltildi');
  }
  // ---------------------------------------------------------------- bot sürüşü
  botDrive(d) {
    const tr = this.race.tr, S = d.car.S, ai = d.ai, N = tr.path.length;
    if (ai.revT > 0) { ai.revT -= TICK; return [-0.8, 0.35 * Math.sin(ai.seed)]; }
    const sp = Math.hypot(S.v[0], S.v[2]);
    const look = ai.diff.look + 0.22 * sp;
    const ti = d.r.idx + Math.round(look / 0.1);
    // trafik: önümde araç varsa şerit değiştir
    let lane = ai.lane;
    for (const o of this.drivers) { if (o === d || !o.r) continue; const ahead = o.r.pr - d.r.pr; if (ahead > 0 && ahead < 0.6) { lane = (o.ai ? o.ai.lane : 0) > 0 ? -0.2 : 0.2; break; } }
    const tp = pointAt(tr, ti, lane);
    const f = quatFwd(S.q); let fx = f[0], fz = f[2];
    if (d.inv) { fx = -fx; fz = -fz; }
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const dx = tp.x - S.p[0], dz = tp.z - S.p[2];
    const rx = -fz, rz = fx;                                      // etkin sağ yön
    const err = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    let st = Math.max(-1, Math.min(1, err * 2.4));
    let curv = 0; for (let k = 3; k < 16; k++) curv = Math.max(curv, tr.curv[(d.r.idx + k) % N]);
    let thr = ai.diff.thr * (1 - Math.min(0.4, curv * 0.36));
    if (Math.abs(err) > 0.9) thr = 0.4;
    thr += (Math.sin(this.raceTime() * 1.7 + ai.seed) * 0.5) * ai.diff.noise;
    // lastik bandı: en iyi insan oyuncudan öndeyse yavaşla, gerideyse tam gaz (zorlukta daha az)
    const lead = this.humanBest();
    if (lead !== null) {
      const gap = d.r.pr - lead;                                  // + : bot önde
      if (gap > 1.5) thr *= Math.max(ai.diff.band, 1 - (gap - 1.5) * 0.06);
      else if (gap < -2) thr = Math.min(1, thr * 1.1);
    }
    return [Math.max(-1, Math.min(1, thr)), st];
  }
  humanBest() {
    let best = null;
    const P = this.player; if (P && P.r && !P.r.fin) best = P.r.pr;
    for (const rv of this.remotes.values()) if (rv.p.race && !rv.p.race.fin && !rv.p.bot) best = best === null ? rv.p.race.pr : Math.max(best, rv.p.race.pr);
    return best;
  }
  // ---------------------------------------------------------------- tur ve sıralama
  progress(d, h) {
    const R = this.race, tr = R.tr, N = tr.path.length, r = d.r, S = d.car.S;
    if (r.fin) return;
    const pj = projectOnTrack(tr, S.p[0], S.p[2], r.idx);
    let ds = tr.s[pj.i] - tr.s[r.idx];
    if (ds < -tr.len / 2) ds += tr.len; if (ds > tr.len / 2) ds -= tr.len;
    const normal = Math.abs(ds) < 0.6 && pj.d < 1.2;
    if (normal) {
      const steps = (pj.i - r.idx + N) % N;
      if (steps > 0 && steps < N / 2) {                         // ileri: kontrol noktası geçildi mi
        const c = tr.cps[r.cpNext];
        if (((c - r.idx + N) % N) > 0 && ((c - r.idx + N) % N) <= steps && pj.d < 0.95) {
          if (r.cpNext === 0) {
            if (r.started) {                                     // tur tamamlandı
              const t = this.raceTime(), lt = t - r.lapStart; r.laps.push(lt); r.lapStart = t; r.lapsDone++;
              if (!r.best || lt < r.best) r.best = lt;
              if (!d.isBot) this.ctx.hud.lap(r.lapsDone, R.laps, lt, r.best);
              if (r.lapsDone >= R.laps) this.finish(d, t);
            } else { r.started = true; r.lapStart = 0; }
          }
          if (!r.fin) r.cpNext = (r.cpNext + 1) % tr.cps.length;
        }
      }
      r.pr += ds;
    }
    r.idx = pj.i;
    if (!d.isBot) {        // ters yön uyarısı
      r.prHist.push(r.pr); if (r.prHist.length > 120) r.prHist.shift();
      const back = r.prHist.length > 100 && r.prHist[r.prHist.length - 1] - r.prHist[0] < -0.4;
      if (back !== R.wrong) { R.wrong = back; this.ctx.hud.wrong(back); }
    }
  }
  finish(d, t) {
    const R = this.race; d.r.fin = t;
    if (!d.isBot) { this.ctx.hud.finished(t, d.r.best); this.ctx.audio.finish(); }
    if (!R.firstFinish) R.firstFinish = performance.now();
    if (R.online) { if (d === this.player) this.ctx.net.finish(t, d.r.best); else this.hostFin(d.id, t, d.r.best, true); }
    else R.finishOrder.push({ id: d.id, name: d.name, color: d.color, time: t, best: d.r.best, bot: d.isBot });
  }
  hostFin(id, time, best, bot) {          // ev sahibi: biten araçları topla
    const R = this.race; if (!R) return;
    if (R.finishOrder.find(x => x.id === id)) return;
    const net = this.ctx.net, m = net.room.members.find(x => x.id === id), b = this.drivers.find(x => x.id === id);
    R.finishOrder.push({ id, name: m ? m.name : b ? b.name : '?', color: m ? m.color : b ? b.color : '#999', time, best, bot: !!bot });
    if (!R.firstFinish) R.firstFinish = performance.now();
  }
  // yarış bitti mi (her karede)
  checkEnd() {
    const R = this.race; if (!R || R.results) return;
    const net = this.ctx.net, now = performance.now();
    if (!R.online) {
      const humanDone = !!this.player.r.fin, allDone = this.drivers.every(d => d.r.fin);
      if (humanDone && (allDone || now - R.firstFinish > 20000)) this.makeResults(R.finishOrder, this.drivers.filter(d => !d.r.fin).map(d => ({ id: d.id, name: d.name, color: d.color, bot: d.isBot })));
    } else if (net.hosting) {
      const humans = net.room.members.map(x => x.id), done = humans.every(id => R.finishOrder.find(x => x.id === id));
      const allBots = this.drivers.filter(d => d.isBot).every(d => d.r.fin);
      if (R.firstFinish && ((done && allBots) || (done && now - R.firstFinish > 8000) || now - R.firstFinish > 40000)) {
        const left = humans.filter(id => !R.finishOrder.find(x => x.id === id)).map(id => { const m = net.room.members.find(x => x.id === id); return { id, name: m.name, color: m.color }; })
          .concat(this.drivers.filter(d => d.isBot && !d.r.fin).map(d => ({ id: d.id, name: d.name, color: d.color, bot: true })));
        const list = this.makeResults(R.finishOrder, left);
        net.sendResults(list);
      }
    }
  }
  makeResults(order, dnf) {
    const list = order.slice().sort((a, b) => a.time - b.time).map((x, i) => ({ ...x, pos: i + 1 })).concat(dnf.map(x => ({ ...x, dnf: true })));
    this.race.results = list; this.ctx.hud.results(list); return list;
  }
  // canlı sıralama (yerel + uzak)
  standings() {
    const R = this.race; if (!R) return [];
    const rows = this.drivers.map(d => ({ id: d.id, name: d.isBot ? d.name : (d === this.player ? this.ctx.settings.name : d.name), color: d.color, pr: d.r.fin ? 1e6 - d.r.fin : d.r.pr + d.r.lapsDone * 0, me: d === this.player, fin: d.r.fin }));
    for (const [id, rv] of this.remotes) if (rv.p.race) rows.push({ id, name: rv.p.name, color: rv.p.color, pr: rv.p.race.fin ? 1e6 - rv.p.race.fin : rv.p.race.pr, me: false, fin: rv.p.race.fin });
    rows.sort((a, b) => b.pr - a.pr);
    return rows;
  }

  // ---------------------------------------------------------------- ağ ve görüntü
  netSync() {
    const net = this.ctx.net; if (!net || net.mode === 'menu') return;
    const t = performance.now(); if (t - (this.lastSend || 0) < 50) return; this.lastSend = t;
    for (const d of this.drivers) {
      if (d.isBot && !(this.race && this.race.online && net.hosting)) continue;
      const rp = d.car.refPose(), S = d.car.S;
      net.sendState({ p: rp.pos, q: rp.q, th: S.th, sp: Math.hypot(S.v[0], S.v[2]), lap: d.r ? d.r.lapsDone : 0, cp: d.r ? d.r.cpNext : 0, pr: d.r ? d.r.pr : 0, fin: d.r ? d.r.fin : 0 },
        d.isBot ? { id: d.id, name: d.name, color: d.color } : null);
    }
  }
  render(dt) {
    const { W, net, R } = this.ctx;
    for (const d of this.drivers) {
      const rp = d.car.refPose(); d.view.setPose(rp.pos, rp.q, d.car.S.th);
      const gh = heightAt(W, rp.pos[0], rp.pos[2], this.buf), air = rp.pos[1] - gh;
      d.view.setBlob(rp.pos[0], gh, rp.pos[2], Math.max(0, 0.34 - air * 1.5));
    }
    // uzak araçlar
    if (net && net.mode !== 'menu') {
      const vis = net.visible(), seen = new Set();
      for (const p of vis) {
        if (this.drivers.find(d => d.id === p.id)) continue;
        seen.add(p.id);
        let rv = this.remotes.get(p.id);
        if (!rv) {
          const view = makeCarView(this.ctx.R.Q.others, p.color); R.scene.add(view.root); R.scene.add(view.blob);
          const tag = document.createElement('div'); tag.className = 'tag'; document.getElementById('tags').appendChild(tag);
          rv = { view, tag, p, cur: null }; this.remotes.set(p.id, rv);
        }
        rv.p = p; rv.tag.textContent = p.name; rv.tag.style.borderColor = p.color; rv.view.setColor(p.color);
        const s = sampleRemote(p); if (!s) continue;
        rv.cur = s; rv.view.setPose(s.p, s.q, s.th);
        const gh = heightAt(W, s.p[0], s.p[2], this.buf); rv.view.setBlob(s.p[0], gh, s.p[2], Math.max(0, 0.34 - (s.p[1] - gh) * 1.5));
      }
      for (const [id, rv] of this.remotes) if (!seen.has(id)) { R.scene.remove(rv.view.root); R.scene.remove(rv.view.blob); rv.tag.remove(); this.remotes.delete(id); }
    }
    // botların isim etiketleri
    this.placeTags();
  }
  placeTags() {
    const cam = this.ctx.R.camera, v = this.v3 || (this.v3 = new (cam.position.constructor)());
    const w = window.innerWidth, h = window.innerHeight;
    const put = (el, p) => {
      v.set(p[0], p[1] + 0.13, p[2]); const dist = v.distanceTo(cam.position); v.project(cam);
      if (v.z > 1 || dist > 7) { el.style.display = 'none'; return; }
      el.style.display = 'block'; el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      el.style.opacity = String(Math.max(0.35, 1 - dist / 8));
    };
    for (const d of this.drivers) {
      if (!d.isBot) continue;
      if (!d.tag) { d.tag = document.createElement('div'); d.tag.className = 'tag bot'; d.tag.textContent = d.name; d.tag.style.borderColor = d.color; document.getElementById('tags').appendChild(d.tag); }
      put(d.tag, d.car.refPose().pos);
    }
    for (const rv of this.remotes.values()) if (rv.cur) put(rv.tag, rv.cur.p);
  }
  dispose() { this.clear(); }
}
export { quatFwd, quatUp };
