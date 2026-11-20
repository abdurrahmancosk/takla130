// Yerel ağ (aynı Wi-Fi / hotspot) çok oyunculu katmanı.
// Taşıma: Android'de UDP yayını (yerel köprü TaklaLan), tarayıcıda BroadcastChannel (aynı tarayıcıdaki sekmeler, test için).
// Sunucu yok: herkes kendi aracını kendisi sürer ve durumunu 20 Hz yayınlar; oda kuran kişi (ev sahibi) yarışı yönetir ve botları sürer.
export const PORT = 47130, VER = 1;

class AndroidTransport {
  constructor() { this.ok = !!window.TaklaLan && window.TaklaLan.start(PORT); this.kind = 'wifi'; }
  send(o) { if (this.ok) window.TaklaLan.send(JSON.stringify(o)); }
  poll() {
    if (!this.ok) return [];
    let a; try { a = JSON.parse(window.TaklaLan.poll()); } catch (e) { return []; }
    const out = []; for (const s of a) { try { const m = JSON.parse(s.d); m._ip = s.a; out.push(m); } catch (e) { } } return out;
  }
  info() { try { return JSON.parse(window.TaklaLan.info()); } catch (e) { return { ip: '', ok: false }; } }
  stop() { try { window.TaklaLan.stop(); } catch (e) { } }
}
class BrowserTransport {
  constructor() { this.q = []; this.kind = 'tab'; this.ok = 'BroadcastChannel' in window; if (this.ok) { this.ch = new BroadcastChannel('takla130'); this.ch.onmessage = (e) => { if (this.q.length < 4000) this.q.push(e.data); }; } }
  send(o) { if (this.ok) this.ch.postMessage(JSON.parse(JSON.stringify(o))); }
  poll() { const a = this.q; this.q = []; return a; }
  info() { return { ip: 'tarayıcı sekmeleri', ok: this.ok }; }
  stop() { }
}

const rid = () => Math.random().toString(36).slice(2, 8);
const now = () => performance.now();

export class Net {
  constructor(profile) {
    this.tr = window.TaklaLan ? new AndroidTransport() : new BrowserTransport();
    this.me = { id: rid(), name: profile.name, color: profile.color };
    this.peers = new Map();      // id -> { id, name, color, mode, room, last, states: [], bot }
    this.mode = 'menu';          // menu | free | lobby | race
    this.room = null;            // { id(host), host, track, laps, bots, diff, same, members:[], status, startAt }
    this.hosting = false;
    this.offset = 0;             // ev sahibi saati - benim saatim (ms)
    this.pings = [];
    this.seq = 0; this.lastBeacon = 0; this.lastState = 0;
    this.handlers = {};          // olay -> fonksiyon
  }
  on(ev, f) { this.handlers[ev] = f; }
  emit(ev, ...a) { if (this.handlers[ev]) this.handlers[ev](...a); }
  setProfile(p) { this.me.name = p.name; this.me.color = p.color; }
  hostNow() { return now() + (this.hosting ? 0 : this.offset); }

  send(o) { o.id = this.me.id; o.v = VER; this.tr.send(o); }
  beacon() {
    const b = { t: 'b', n: this.me.name, c: this.me.color, m: this.mode, r: this.room ? this.room.id : '' };
    if (this.hosting && this.room) b.h = { tr: this.room.track, laps: this.room.laps, bots: this.room.bots, n: this.room.members.length, st: this.room.status };
    this.send(b);
  }
  // her karede çağrılır
  update() {
    const t = now();
    if (t - this.lastBeacon > 1000) { this.lastBeacon = t; this.beacon(); if (this.room && !this.hosting) this.ping(); }
    for (const m of this.tr.poll()) this.handle(m, t);
    for (const [id, p] of this.peers) if (t - p.last > 4500) {
      this.peers.delete(id); this.emit('peers');
      if (this.room && !this.hosting && id === this.room.id) { this.room = null; this.emit('roomClosed'); }
      if (this.hosting && this.room) { this.room.members = this.room.members.filter(x => x.id !== id); this.pushRoom(); }
    }
  }
  peer(id) {
    let p = this.peers.get(id);
    if (!p) { p = { id, name: '?', color: '#999', mode: 'menu', room: '', last: now(), states: [], host: null }; this.peers.set(id, p); this.emit('peers'); }
    return p;
  }
  handle(m, t) {
    if (!m || m.v !== VER || !m.id || m.id === this.me.id) return;
    if (m.to && m.to !== this.me.id) return;
    const p = this.peer(m.id); p.last = t;
    switch (m.t) {
      case 'b': {
        const ch = p.name !== m.n || p.mode !== m.m || JSON.stringify(p.host) !== JSON.stringify(m.h || null) || p.room !== m.r;
        p.name = String(m.n).slice(0, 16); p.color = /^#[0-9a-f]{6}$/i.test(m.c) ? m.c : '#999'; p.mode = m.m; p.room = m.r; p.host = m.h || null; p.ip = m._ip;
        if (ch) this.emit('peers'); break;
      }
      case 's': {   // araç durumu (oyuncu ya da ev sahibinin botu)
        const key = m.bot ? m.bot : m.id;
        let q = key === m.id ? p : this.peer(key);
        if (m.bot) { q.last = t; q.bot = true; q.owner = m.id; q.name = m.bn; q.color = m.bc; q.mode = m.m; q.room = m.r; }
        if (q.seq && m.k <= q.seq && m.k > q.seq - 1000) return;      // eski ya da yinelenen paket
        q.seq = m.k;
        q.states.push({ rt: t, p: m.p, q: m.q, th: m.th, sp: m.sp, lap: m.lap, cp: m.cp, pr: m.pr, fin: m.fin });
        if (q.states.length > 12) q.states.shift();
        q.race = { lap: m.lap, pr: m.pr, fin: m.fin, cp: m.cp };
        break;
      }
      case 'join': if (this.hosting && this.room) {
        if (!this.room.members.find(x => x.id === m.id) && this.room.status === 'wait' && this.room.members.length < 8) this.room.members.push({ id: m.id, name: p.name, color: p.color });
        this.pushRoom(); } break;
      case 'leave': if (this.hosting && this.room) { this.room.members = this.room.members.filter(x => x.id !== m.id); this.pushRoom(); } break;
      case 'room': if (this.room && this.room.id === m.id && !this.hosting) {
        const was = this.room.status; Object.assign(this.room, m.room);
        const inRoom = !!this.room.members.find(x => x.id === this.me.id);
        if (inRoom) this.room.joined = true;
        else if (this.room.joined) { this.room = null; this.emit('roomClosed'); break; }     // ev sahibi beni çıkardı
        else { this.send({ t: 'join', to: this.room.id }); break; }                          // katılma isteğim henüz işlenmedi
        this.emit('room'); if (was !== 'count' && this.room.status === 'count') this.emit('go');
      } break;
      case 'close': if (this.room && this.room.id === m.id && !this.hosting) { this.room = null; this.emit('roomClosed'); } break;
      case 'ping': if (this.hosting) this.send({ t: 'pong', to: m.id, t0: m.t0, th: now() }); break;
      case 'pong': {
        const rtt = now() - m.t0; if (rtt < 0 || rtt > 1500) break;
        this.pings.push({ rtt, off: m.th + rtt / 2 - now() }); if (this.pings.length > 9) this.pings.shift();
        const best = this.pings.slice().sort((a, b) => a.rtt - b.rtt).slice(0, 3);
        this.offset = best.reduce((s, x) => s + x.off, 0) / best.length; break;
      }
      case 'fin': if (this.hosting && this.room) this.emit('fin', m.id, m.time, m.best, false); break;
      case 'res': if (this.room && this.room.id === m.id) { this.room.results = m.list; this.emit('results', m.list); } break;
    }
  }
  ping() { this.send({ t: 'ping', to: this.room.id, t0: now() }); }

  // ---------------------------------------------------------------- oda
  createRoom(opts) {
    this.hosting = true; this.offset = 0;
    this.room = { id: this.me.id, host: this.me.name, track: opts.track, laps: opts.laps, bots: opts.bots, diff: opts.diff, same: opts.same,
      members: [{ id: this.me.id, name: this.me.name, color: this.me.color }], status: 'wait', startAt: 0 };
    this.mode = 'lobby'; this.beacon(); this.pushRoom();
  }
  joinRoom(hostId) {
    const h = this.peers.get(hostId); if (!h || !h.host) return false;
    this.hosting = false; this.pings = []; this.offset = 0;
    this.room = { id: hostId, host: h.name, track: h.host.tr, laps: h.host.laps, bots: h.host.bots, members: [], status: 'wait' };
    this.mode = 'lobby';
    for (let k = 0; k < 4; k++) setTimeout(() => { if (this.room && this.room.id === hostId) { this.send({ t: 'join', to: hostId }); this.ping(); } }, k * 250);
    return true;
  }
  leaveRoom() {
    if (!this.room) return;
    if (this.hosting) this.send({ t: 'close' }); else this.send({ t: 'leave', to: this.room.id });
    this.room = null; this.hosting = false; this.mode = 'menu';
  }
  pushRoom() { if (this.hosting && this.room) { const { results, joined, ...r } = this.room; this.send({ t: 'room', room: r }); this.emit('room'); } }
  startRace(grid) {       // ev sahibi: 4 s sonra başlat
    this.room.status = 'count'; this.room.startAt = now() + 4000; this.room.grid = grid; this.pushRoom();
    for (let k = 1; k <= 3; k++) setTimeout(() => this.pushRoom(), k * 300);
    this.emit('go');
  }
  finish(time, best) { if (this.hosting) this.emit('fin', this.me.id, time, best, false); else if (this.room) for (let k = 0; k < 3; k++) setTimeout(() => this.room && this.send({ t: 'fin', to: this.room.id, time, best }), k * 200); }
  sendResults(list) { this.room.results = list; this.room.status = 'done'; this.pushRoom(); for (let k = 0; k < 3; k++) setTimeout(() => this.send({ t: 'res', list }), k * 250); this.emit('results', list); }

  // ---------------------------------------------------------------- araç durumu (20 Hz)
  sendState(st, bot) {
    const r3 = (v) => Math.round(v * 1000) / 1000, r4 = (v) => Math.round(v * 10000) / 10000;
    const o = { t: 's', k: ++this.seq, m: this.mode, r: this.room ? this.room.id : '', p: st.p.map(r3), q: st.q.map(r4), th: st.th.map(x => Math.round(x * 100) / 100),
      sp: Math.round(st.sp * 100) / 100, lap: st.lap | 0, cp: st.cp | 0, pr: Math.round((st.pr || 0) * 100) / 100, fin: st.fin || 0 };
    if (bot) { o.bot = bot.id; o.bn = bot.name; o.bc = bot.color; }
    this.send(o);
  }
  // görünmesi gereken uzak araçlar: serbest sürüşte diğer serbest sürücüler, yarışta aynı odadakiler
  visible() {
    const out = [];
    for (const p of this.peers.values()) {
      if (!p.states.length) continue;
      if (now() - p.states[p.states.length - 1].rt > 2500) continue;
      if (this.mode === 'free' && p.mode === 'free') out.push(p);
      else if ((this.mode === 'race' || this.mode === 'lobby') && this.room && p.room === this.room.id && (p.mode === 'race' || p.bot)) out.push(p);
    }
    return out;
  }
  info() { return this.tr.info(); }
}

// 120 ms geriden ara değerleme (titreme yok), en fazla 250 ms ileri tahmin
export function sampleRemote(p, delay = 120) {
  const S = p.states; if (!S.length) return null;
  const t = now() - delay;
  let a = S[0], b = S[S.length - 1];
  for (let i = 0; i < S.length - 1; i++) if (S[i].rt <= t && S[i + 1].rt >= t) { a = S[i]; b = S[i + 1]; break; }
  if (t > b.rt) {     // ileri tahmin
    const prev = S.length > 1 ? S[S.length - 2] : b, dt = Math.min(0.25, (t - b.rt) / 1000), span = Math.max(0.02, (b.rt - prev.rt) / 1000);
    const v = b.p.map((x, k) => (x - prev.p[k]) / span);
    return { p: b.p.map((x, k) => x + v[k] * dt), q: b.q, th: b.th, sp: b.sp };
  }
  const f = b.rt > a.rt ? (t - a.rt) / (b.rt - a.rt) : 1;
  return { p: a.p.map((x, k) => x + (b.p[k] - x) * f), q: slerp(a.q, b.q, f), th: a.th.map((x, k) => x + (b.th[k] - x) * f), sp: a.sp + (b.sp - a.sp) * f };
}
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const s = d < 0 ? -1 : 1; d *= s;
  if (d > 0.9995) { const r = a.map((x, k) => x + (s * b[k] - x) * t), l = Math.hypot(...r); return r.map(x => x / l); }
  const th = Math.acos(d), sa = Math.sin((1 - t) * th) / Math.sin(th), sb = Math.sin(t * th) / Math.sin(th);
  return a.map((x, k) => sa * x + sb * s * b[k]);
}
