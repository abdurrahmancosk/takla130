// TAKLA-130 oyunu: menüler, oyun döngüsü, kamera, gösterge, mini harita, ağ olayları.
import * as THREE from 'three';
import { buildWorld, TRACKS, heightAt } from './world.js';
import { createRenderer, buildCity, buildTrackDecor, loadCarModels, autoQuality, QUALITY } from './render.js';
import { Game, DIFF, quatFwd, quatUp } from './game.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const native = window.TaklaLan || null;
const COLORS = ['#b9cf1f', '#2b47c4', '#e2621b', '#d6336c', '#18a0a6', '#7b3fd1', '#f0c419', '#eceff1'];
const GARAGE = { DENGE_strong: { top: 13, t5: 0.22 }, DENGE_medium: { top: 10.5, t5: 0.28 }, DENGE_weak: { top: 5.5, t5: 0.85 }, TAKLA_strong: { top: 11.4, t5: 0.21 },
  TAKLA_medium: { top: 9.3, t5: 0.27 }, TAKLA_weak: { top: 4.8, t5: null }, HIZ_strong: { top: 14.5, t5: 0.23 }, HIZ_medium: { top: 11.8, t5: 0.28 }, HIZ_weak: { top: 6.1, t5: 0.72 } };

// ------------------------------------------------------------------ ayarlar (cihazda saklanır)
const DEF = { name: '', color: COLORS[0], quality: 'oto', fps: 60, cam: 'takip', controls: 'iki', autoReset: true, steerGain: 0.85, expo: 1.35,
  sound: true, volume: 0.7, vib: true, gear: 'DENGE', motor: 'medium', rTrack: 0, rLaps: 3, rBots: 3, rDiff: 'orta', oTrack: 0, oLaps: 3, oBots: 2, oDiff: 'orta', best: {} };
const S = (() => { let s = {}; try { s = JSON.parse(localStorage.getItem('takla130') || '{}'); } catch (e) { } return { ...DEF, ...s }; })();
if (!S.name) S.name = 'Pilot' + Math.floor(10 + Math.random() * 89);
const save = () => { try { localStorage.setItem('takla130', JSON.stringify(S)); } catch (e) { } };
save();

// ------------------------------------------------------------------ kurulum
const AQ = autoQuality();
const qk = S.quality === 'oto' ? AQ.q : S.quality;
const R = createRenderer($('gl'), qk);
const W = buildWorld();
buildCity(R.scene, W, R.Q);
const net = new Net({ name: S.name, color: S.color });
const audio = new Audio(S);
const input = new Input($('ctl'), S);
input.bindButton('bFlip', 'flip'); input.bindButton('bReset', 'reset'); input.bindButton('bCam', 'cam');
const vib = (ms) => { if (!S.vib) return; try { if (native && native.vibrate) native.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { } };

let toastT = 0;
const hud = {
  toast(t, ms = 1200) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms); },
  lap(n, of, lt, best) { $('hLast').textContent = fmt(lt); $('hBest').textContent = fmt(best); $('lapInfo').hidden = false; if (n < of) this.toast(n === of - 1 ? 'SON TUR!' : `TUR ${n + 1}`); },
  wrong(on) { $('wrongWrap').hidden = !on; },
  finished(t, best) { this.toast('BİTTİ! ' + fmt(t), 2500); vib(120); saveBest(t, best); },
  results(list) { showResults(list); },
};
const game = new Game({ R, W, net, settings: S, hud, audio, buildDecor: (tr) => buildTrackDecor(R.scene, tr) });

function fmt(t) { if (!t && t !== 0) return '–'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1).replace('.', ',')}`; }
function saveBest(t, best) {
  if (!game.race || game.race.online) return;
  const k = game.race.tr.id + '_' + game.race.laps, b = S.best[k] || {};
  if (!b.total || t < b.total) b.total = t; if (best && (!b.lap || best < b.lap)) b.lap = best;
  S.best[k] = b; save();
}

// ------------------------------------------------------------------ ekranlar
const screens = ['sMenu', 'sRace', 'sLobby', 'sRoom', 'sGarage', 'sSettings', 'sPause', 'sResults'];
let state = 'menu', returnTo = 'sMenu';
function show(id) { for (const s of screens) $(s).hidden = s !== id; if (id) refresh[id]?.(); }
function playing(on) {
  for (const id of ['hud', 'ctl', 'actions', 'stickL', 'stickR']) $(id).hidden = !on;
  $('hintL').hidden = $('hintR').hidden = !on || S.controls !== 'iki';
  if (!on) { input.releaseAll(); audio.silence(); $('countWrap').hidden = true; $('wrongWrap').hidden = true; }
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => show(returnTo)));
const seg = (el, items, cur, onPick) => {
  el.innerHTML = '';
  for (const [v, label] of items) {
    const b = document.createElement('button'); b.textContent = label; b.className = String(v) === String(cur) ? 'on' : '';
    b.onclick = () => { onPick(v); [...el.children].forEach(x => x.classList.toggle('on', x === b)); }; el.appendChild(b);
  }
};

// ana menü
$('pName').value = S.name;
$('pName').addEventListener('input', () => { S.name = $('pName').value.trim().slice(0, 14) || 'Pilot'; net.setProfile(S); save(); });
const pc = $('pColors');
COLORS.forEach(c => { const b = document.createElement('button'); b.className = 'sw' + (c === S.color ? ' on' : ''); b.style.background = c; b.setAttribute('aria-label', 'Renk ' + c);
  b.onclick = () => { S.color = c; save(); net.setProfile(S); [...pc.children].forEach(x => x.classList.toggle('on', x === b)); }; pc.appendChild(b); });
$('goFree').onclick = () => startFree();
$('goRace').onclick = () => { returnTo = 'sMenu'; show('sRace'); };
$('goLobby').onclick = () => { returnTo = 'sMenu'; net.mode = 'menu'; show('sLobby'); };
$('goGarage').onclick = () => { returnTo = 'sMenu'; show('sGarage'); };
$('goSettings').onclick = () => { returnTo = 'sMenu'; show('sSettings'); };

const refresh = {};
refresh.sMenu = () => { updateStatus(); };
function updateStatus() {
  const inf = net.info(), others = [...net.peers.values()].filter(p => !p.bot).length;
  const where = net.tr.kind === 'wifi' ? (inf.ip ? `Wi-Fi: ${inf.ip}` : 'Wi-Fi bağlı değil') : 'Tarayıcı modu (aynı tarayıcıdaki sekmeler)';
  const txt = `${where} · ağda <b>${others}</b> oyuncu görünüyor`;
  $('netStatus').innerHTML = txt; $('lobbyStatus').innerHTML = txt + ` · cihaz GPU: ${AQ.gpu.slice(0, 40) || '?'}`;
}

// yarış kurulumu
function trackThumb(cv, tr) {
  const c = cv.getContext('2d'), w = cv.width = 300, h = cv.height = 70; c.clearRect(0, 0, w, h);
  const xs = tr.path.map(p => p[0]), zs = tr.path.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), sc = Math.min((w - 20) / (x1 - x0), (h - 14) / (z1 - z0));
  c.strokeStyle = '#b9cf1f'; c.lineWidth = 4; c.lineJoin = 'round'; c.beginPath();
  tr.path.forEach((p, i) => { const X = w / 2 + (p[0] - (x0 + x1) / 2) * sc, Y = h / 2 + (p[1] - (z0 + z1) / 2) * sc; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath(); c.stroke();
}
refresh.sRace = () => {
  const tc = $('trackCards'); tc.innerHTML = '';
  W.tracks.forEach((tr, i) => {
    const b = document.createElement('button'); b.className = 'track' + (i === S.rTrack ? ' on' : '');
    const best = S.best[tr.id + '_' + S.rLaps];
    b.innerHTML = `<b>${tr.name}</b><span class="note">${tr.desc} · ${tr.len.toFixed(0)} m${best && best.total ? ' · rekor ' + fmt(best.total) : ''}</span><canvas></canvas>`;
    trackThumb(b.querySelector('canvas'), tr);
    b.onclick = () => { S.rTrack = i; save(); refresh.sRace(); }; tc.appendChild(b);
  });
  seg($('rLaps'), [[1, '1'], [2, '2'], [3, '3'], [5, '5']], S.rLaps, v => { S.rLaps = v; save(); refresh.sRace(); });
  seg($('rBots'), [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], S.rBots, v => { S.rBots = v; save(); });
  seg($('rDiff'), Object.entries(DIFF).map(([k, d]) => [k, d.name]), S.rDiff, v => { S.rDiff = v; save(); });
};
$('rStart').onclick = () => startRace({ track: S.rTrack, laps: S.rLaps, bots: S.rBots, diff: S.rDiff, online: false, startLocal: performance.now() + 3500 });

// garaj
refresh.sGarage = () => {
  const GN = { DENGE: 'Denge 15,7:1', TAKLA: 'Takla 17,9:1', HIZ: 'Hız 13,9:1' }, MN = { strong: '3V tipi', medium: 'Standart', weak: '6V tipi' };
  seg($('gGear'), Object.entries(GN), S.gear, v => { S.gear = v; save(); stats(); });
  seg($('gMotor'), Object.entries(MN), S.motor, v => { S.motor = v; save(); stats(); });
  $('gGearNote').textContent = 'Aynı deliklere takılan üç set: Takla daha çok tork, Hız daha çok tepe hız.';
  $('gMotorNote').textContent = 'Motorunun uçları arası 1,5–3 Ω ise 3V tipi, 6 Ω ve üstüyse 6V tipidir.';
  stats();
  function stats() {
    const g = GARAGE[S.gear + '_' + S.motor], rows = [['Tepe hız', g.top, 15, `${String(g.top).replace('.', ',')} km/h`], ['0–5 km/h', g.t5 ? 1 / g.t5 : 0, 5, g.t5 ? `${String(g.t5).replace('.', ',')} s` : 'ulaşamaz'],
      ['Takla', S.motor === 'weak' ? 0.5 : 1, 1, S.motor === 'weak' ? 'zor' : 'kolay']];
    $('gStats').innerHTML = rows.map(([n, v, mx, t]) => `<div class="stat"><span>${n}</span><span class="bar"><i style="width:${Math.min(100, v / mx * 100)}%"></i></span><b>${t}</b></div>`).join('');
  }
};

// ayarlar
refresh.sSettings = () => {
  seg($('sQual'), [['oto', 'Otomatik'], ['dusuk', 'Düşük'], ['orta', 'Orta'], ['yuksek', 'Yüksek']], S.quality, v => { S.quality = v; save(); $('sQualNote').textContent = 'Yeni grafik ayarı için oyun yeniden yükleniyor…'; setTimeout(() => location.reload(), 600); });
  $('sQualNote').textContent = `Şu an: ${QUALITY[qk].label}${S.quality === 'oto' ? ' (otomatik)' : ''}. Kare hızı düşerse çözünürlük kendiliğinden azalır.`;
  seg($('sFps'), [[30, '30'], [60, '60']], S.fps, v => { S.fps = v; save(); });
  seg($('sCam'), [['takip', 'Takip'], ['uzak', 'Uzak'], ['ust', 'Üstten'], ['surucu', 'Sürücü']], S.cam, v => { S.cam = v; save(); });
  seg($('sCtl'), [['iki', 'İki çubuk (kumanda gibi)'], ['tek', 'Tek çubuk']], S.controls, v => { S.controls = v; save(); });
  const ck = (id, k, after) => { const e = $(id); e.checked = !!S[k]; e.onchange = () => { S[k] = e.checked; save(); after && after(); }; };
  ck('sAutoReset', 'autoReset'); ck('sSound', 'sound', () => audio.setEnabled()); ck('sVib', 'vib');
  const rg = (id, k, after) => { const e = $(id); e.value = S[k]; e.oninput = () => { S[k] = +e.value; save(); after && after(); }; };
  rg('sSteer', 'steerGain'); rg('sExpo', 'expo'); rg('sVol', 'volume', () => audio.setEnabled());
};
$('sDefaults').onclick = () => { const keep = { name: S.name, color: S.color, best: S.best }; Object.assign(S, DEF, keep); save(); refresh.sSettings(); audio.setEnabled(); };

// ------------------------------------------------------------------ çok oyunculu lobi
refresh.sLobby = () => {
  updateStatus();
  const peers = [...net.peers.values()].filter(p => !p.bot);
  const MODE = { menu: 'menüde', free: 'serbest sürüşte', lobby: 'odada', race: 'yarışta' };
  $('peerList').innerHTML = peers.length ? '' : '<div class="empty">Henüz kimse görünmüyor. Diğer cihazlarda oyunu açın.</div>';
  for (const p of peers) { const d = document.createElement('div'); d.className = 'item'; d.innerHTML = `<i class="dot"></i><span class="grow"></span><span class="meta"></span>`;
    d.querySelector('.dot').style.background = p.color; d.querySelector('.grow').textContent = p.name; d.querySelector('.meta').textContent = MODE[p.mode] || ''; $('peerList').appendChild(d); }
  const rooms = peers.filter(p => p.host);
  $('roomList').innerHTML = rooms.length ? '' : '<div class="empty">Açık oda yok. Sağdan bir oda kurabilirsin.</div>';
  for (const p of rooms) {
    const d = document.createElement('div'); d.className = 'item';
    const tr = W.tracks[p.host.tr] || W.tracks[0], open = p.host.st === 'wait';
    d.innerHTML = `<i class="dot"></i><span class="grow"></span><span class="meta"></span><button class="btn sm pri">Katıl</button>`;
    d.querySelector('.dot').style.background = p.color; d.querySelector('.grow').textContent = p.name + ' · ' + tr.name;
    d.querySelector('.meta').textContent = `${p.host.n} kişi · ${p.host.laps} tur${open ? '' : ' · yarışta'}`;
    const b = d.querySelector('button'); b.disabled = !open; b.onclick = () => { if (net.joinRoom(p.id)) { show('sRoom'); } };
    $('roomList').appendChild(d);
  }
  seg($('oTrack'), W.tracks.map((t, i) => [i, t.name]), S.oTrack, v => { S.oTrack = v; save(); });
  seg($('oLaps'), [[1, '1'], [2, '2'], [3, '3'], [5, '5']], S.oLaps, v => { S.oLaps = v; save(); });
  seg($('oBots'), [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], S.oBots, v => { S.oBots = v; save(); });
  seg($('oDiff'), Object.entries(DIFF).map(([k, d]) => [k, d.name]), S.oDiff, v => { S.oDiff = v; save(); });
};
$('oCreate').onclick = () => { net.createRoom({ track: S.oTrack, laps: S.oLaps, bots: S.oBots, diff: S.oDiff, same: $('oSame').checked }); show('sRoom'); };
$('freeTogether').onclick = () => startFree();
refresh.sRoom = () => {
  const r = net.room; if (!r) { show('sLobby'); return; }
  const tr = W.tracks[r.track] || W.tracks[0];
  $('roomTitle').textContent = (net.hosting ? 'Odan' : r.host + ' odası') + ' · ' + tr.name;
  $('roomInfo').innerHTML = `<span>Pist</span><span>${tr.name} (${tr.len.toFixed(0)} m)</span><span>Tur</span><span>${r.laps}</span><span>Bot</span><span>${r.bots} (${(DIFF[r.diff] || DIFF.orta).name})</span><span>Araç</span><span>${r.same ? 'herkes aynı (DENGE, standart)' : 'herkes kendi garajı'}</span>`;
  $('roomMembers').innerHTML = '';
  for (const m of r.members || []) { const d = document.createElement('div'); d.className = 'item'; d.innerHTML = `<i class="dot"></i><span class="grow"></span><span class="meta"></span>`;
    d.querySelector('.dot').style.background = m.color; d.querySelector('.grow').textContent = m.name; d.querySelector('.meta').textContent = m.id === r.id ? 'ev sahibi' : (m.id === net.me.id ? 'sen' : ''); $('roomMembers').appendChild(d); }
  $('roomStart').hidden = !net.hosting;
  $('roomWait').textContent = net.hosting ? `${(r.members || []).length} oyuncu + ${r.bots} bot. En fazla 8 oyuncu.` : (r.joined ? 'Ev sahibinin yarışı başlatması bekleniyor…' : 'Odaya bağlanılıyor…');
};
$('roomLeave').onclick = () => { net.leaveRoom(); show('sLobby'); };
$('roomStart').onclick = () => {
  const r = net.room, grid = {}; let k = 0;
  for (const m of r.members) grid[m.id] = k++;
  for (let b = 0; b < r.bots; b++) grid[net.me.id + '-b' + b] = k++;
  r.results = null; net.startRace(grid);
};
net.on('peers', () => { if (!$('sLobby').hidden) refresh.sLobby(); if (!$('sMenu').hidden) updateStatus(); });
net.on('room', () => { if (!$('sRoom').hidden) refresh.sRoom(); });
net.on('roomClosed', () => { if (state === 'race' && game.race && game.race.online) { endSession(); } hud.toast('Oda kapandı', 2000); show('sLobby'); });
net.on('go', () => {
  const r = net.room; if (!r) return;
  net.mode = 'race';
  startRace({ track: r.track, laps: r.laps, bots: r.bots, diff: r.diff, online: true, grid: r.grid, same: r.same, startLocal: r.startAt - (net.hosting ? 0 : net.offset) });
});
net.on('fin', (id, time, best, bot) => game.hostFin(id, time, best, bot));
net.on('results', (list) => { if (game.race && game.race.online && !game.race.results) { game.race.results = list; showResults(list); } });

// ------------------------------------------------------------------ oturum
function startFree() {
  audio.unlock(); state = 'free'; net.mode = 'free';
  game.startFree(); show(null); playing(true);
  $('raceInfo').hidden = true; $('lapInfo').hidden = true; $('stand').innerHTML = '';
  drawMiniBase(null); hud.toast('Serbest sürüş', 1000);
}
function startRace(o) {
  audio.unlock(); state = 'race'; if (!o.online) net.mode = 'menu';
  game.startRace(o); show(null); playing(true);
  $('raceInfo').hidden = false; $('lapInfo').hidden = true;
  drawMiniBase(game.race.tr); lastCount = 99; paused = false;
}
function endSession() { game.dispose(); state = 'menu'; playing(false); paused = false; if (net.room && !net.room.status) net.mode = 'menu'; }
function toMenu() {
  if (net.room) net.leaveRoom();
  net.mode = 'menu'; endSession(); show('sMenu');
}
function showResults(list) {
  const body = $('resBody'); body.innerHTML = '';
  for (const r of list) {
    const tr = document.createElement('tr'); if (r.id === game.player?.id || r.id === net.me.id) tr.className = 'me';
    tr.innerHTML = `<td>${r.dnf ? '–' : r.pos}</td><td></td><td>${r.dnf ? 'bitiremedi' : fmt(r.time)}</td><td>${r.best ? fmt(r.best) : '–'}</td>`;
    tr.children[1].textContent = r.name + (r.bot ? ' (bot)' : ''); body.appendChild(tr);
  }
  const me = list.find(r => r.id === game.player?.id || r.id === net.me.id);
  $('resTitle').textContent = me && !me.dnf ? `${me.pos}. oldun!` : 'Sonuçlar';
  const online = game.race && game.race.online;
  $('resAgain').textContent = online ? 'Odaya dön' : 'Tekrar yarış';
  setTimeout(() => { if (state === 'race') { playing(false); show('sResults'); } }, 1800);
}
$('resAgain').onclick = () => {
  const online = game.race && game.race.online, last = game.race;
  endSession();
  if (online) {
    if (net.room) { if (net.hosting) { net.room.status = 'wait'; net.room.results = null; net.pushRoom(); } net.mode = 'lobby'; show('sRoom'); } else show('sLobby');
  } else startRace({ track: W.tracks.indexOf(last.tr), laps: last.laps, bots: S.rBots, diff: S.rDiff, online: false, startLocal: performance.now() + 3500 });
};
$('resMenu').onclick = () => toMenu();

// duraklatma
let paused = false;
function pause(on) {
  if (state === 'menu') return;
  const online = game.race && game.race.online;
  paused = on && !online;                // çok oyunculuda zaman durmaz
  if (on) { playing(false); show('sPause'); $('pauseNote').textContent = online ? 'Çok oyunculu yarışta oyun arkada sürüyor.' : ''; $('pRestart').hidden = !!online; audio.pause(true); }
  else { show(null); playing(true); audio.pause(false); }
}
$('bPause').onclick = () => pause(true);
$('pResume').onclick = () => pause(false);
$('pRestart').onclick = () => { if (state === 'free') { pause(false); game.startFree(); } else if (game.race) { const r = game.race; startRace({ track: W.tracks.indexOf(r.tr), laps: r.laps, bots: S.rBots, diff: S.rDiff, online: false, startLocal: performance.now() + 3500 }); } };
$('pSettings').onclick = () => { returnTo = 'sPause'; show('sSettings'); };
$('pMenu').onclick = () => toMenu();

// Android geri tuşu
let backT = 0;
window.onAndroidBack = () => {
  if (state !== 'menu' && $('sPause').hidden && $('sSettings').hidden && $('sResults').hidden) { pause(true); return; }
  if (!$('sPause').hidden) { pause(false); return; }
  if (!$('sSettings').hidden && returnTo === 'sPause') { show('sPause'); return; }
  if (!$('sResults').hidden) { toMenu(); return; }
  if (!$('sRoom').hidden) { net.leaveRoom(); show('sLobby'); return; }
  if (!$('sMenu').hidden) {
    if (performance.now() - backT < 2000) { native && native.exitApp && native.exitApp(); return; }
    backT = performance.now(); hud.toast('Çıkmak için tekrar geri tuşuna bas', 1800); return;
  }
  show('sMenu');
};
window.onAndroidPause = () => { if (state !== 'menu' && !paused && !(game.race && game.race.online)) pause(true); audio.pause(true); };
window.onAndroidResume = () => { if (state === 'menu' || paused) audio.pause(false); };
window.setSafeArea = (l, t, r, b) => { const st = document.documentElement.style; st.setProperty('--sa-l', l + 'px'); st.setProperty('--sa-t', t + 'px'); st.setProperty('--sa-r', r + 'px'); st.setProperty('--sa-b', b + 'px'); };
document.addEventListener('keydown', (e) => { if (e.code === 'Escape') window.onAndroidBack(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) window.onAndroidPause(); });

// ------------------------------------------------------------------ mini harita
const mini = $('mini'), mc = mini.getContext('2d'), base = document.createElement('canvas'); base.width = base.height = 264;
const MS = 264 / 25.5, mx = (x) => 132 + x * MS, mz = (z) => 132 + z * MS;
function drawMiniBase(tr) {
  const c = base.getContext('2d'); c.clearRect(0, 0, 264, 264);
  c.fillStyle = 'rgba(80,85,92,0.9)'; c.fillRect(mx(-11.6), mz(-11.6), 23.2 * MS, 23.2 * MS);
  for (const b of W.blocks) { c.fillStyle = b.type === 'park' ? '#4f8a3c' : b.type === 'plaza' ? '#a99c86' : '#2b2f35'; c.fillRect(mx(b.x0), mz(b.z0), (b.x1 - b.x0) * MS, (b.z1 - b.z0) * MS); }
  c.fillStyle = '#f1c40f'; for (const r of W.ramps) if (!r.table && !r.barrier) c.fillRect(mx(r.x) - 2, mz(r.z) - 2, 4, 4);
  if (tr) { c.strokeStyle = '#b9cf1f'; c.lineWidth = 3; c.beginPath(); tr.path.forEach((p, i) => i ? c.lineTo(mx(p[0]), mz(p[1])) : c.moveTo(mx(p[0]), mz(p[1]))); c.closePath(); c.stroke();
    c.fillStyle = '#fff'; c.fillRect(mx(tr.path[0][0]) - 3, mz(tr.path[0][1]) - 3, 6, 6); }
}
function drawMini() {
  mc.clearRect(0, 0, 264, 264); mc.drawImage(base, 0, 0);
  const dot = (x, z, col, r = 4) => { mc.fillStyle = col; mc.beginPath(); mc.arc(mx(x), mz(z), r, 0, 7); mc.fill(); };
  for (const d of game.drivers.slice(1)) { const p = d.car.S.p; dot(p[0], p[2], d.color); }
  for (const rv of game.remotes.values()) if (rv.cur) dot(rv.cur.p[0], rv.cur.p[2], rv.p.color);
  const P = game.player; if (!P) return;
  const p = P.car.S.p, f = quatFwd(P.car.S.q), a = Math.atan2(f[2] * (P.inv ? -1 : 1), f[0] * (P.inv ? -1 : 1));
  mc.save(); mc.translate(mx(p[0]), mz(p[2])); mc.rotate(a); mc.fillStyle = '#fff'; mc.strokeStyle = '#000'; mc.lineWidth = 2;
  mc.beginPath(); mc.moveTo(9, 0); mc.lineTo(-6, 6); mc.lineTo(-3, 0); mc.lineTo(-6, -6); mc.closePath(); mc.stroke(); mc.fill(); mc.restore();
}

// ------------------------------------------------------------------ kamera
const cam = R.camera, camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), head = new THREE.Vector3(1, 0, 0), tmp = new THREE.Vector3(), qbuf = [];
let camMode = S.cam, camInit = false;
const CAMS = ['takip', 'uzak', 'ust', 'surucu'];
function blockedAt(x, y, z) {
  for (const c of W.query(x, z, 0.02, qbuf)) if (c.kind === 'building') {
    if (Math.abs(x - c.center[0]) < c.half[0] + 0.03 && Math.abs(z - c.center[2]) < c.half[2] + 0.03 && y < c.center[1] + c.half[1] + 0.03) return true;
  }
  return false;
}
function updateCamera(dt) {
  const P = game.player; if (!P) return;
  const rp = P.car.refPose(), p = rp.pos, f = quatFwd(rp.q), sg = P.inv ? -1 : 1;
  tmp.set(f[0] * sg, 0, f[2] * sg); if (tmp.lengthSq() > 0.05) { tmp.normalize(); head.lerp(tmp, 1 - Math.exp(-dt * 5)).normalize(); }
  const cfg = { takip: [0.42, 0.17], uzak: [0.9, 0.42] }[camMode];
  let want;
  if (camMode === 'ust') { want = new THREE.Vector3(p[0] - head.x * 0.4, p[1] + 2.0, p[2] - head.z * 0.4); camLook.set(p[0] + head.x * 0.3, p[1], p[2] + head.z * 0.3); }
  else if (camMode === 'surucu') { const u = quatUp(rp.q); want = new THREE.Vector3(p[0] + u[0] * 0.05 * sg + head.x * 0.02, p[1] + 0.05, p[2] + u[2] * 0.05 * sg + head.z * 0.02); camLook.set(p[0] + head.x * 1.2, p[1] + 0.02, p[2] + head.z * 1.2); }
  else {
    const gh = heightAt(W, p[0], p[2], qbuf);
    want = new THREE.Vector3(p[0] - head.x * cfg[0], Math.max(p[1], gh + 0.035) + cfg[1], p[2] - head.z * cfg[0]);
    for (let k = 0; k < 6 && blockedAt(want.x, want.y, want.z); k++) want.lerp(new THREE.Vector3(p[0], want.y + 0.05, p[2]), 0.3);   // binaya girme
    camLook.set(p[0] + head.x * 0.28, p[1] + 0.03, p[2] + head.z * 0.28);
  }
  if (!camInit) { camPos.copy(want); camInit = true; } else camPos.lerp(want, camMode === 'surucu' ? 1 : 1 - Math.exp(-dt * 7));
  cam.position.copy(camPos); cam.lookAt(camLook);
  cam.fov = camMode === 'surucu' ? 72 : 62; cam.updateProjectionMatrix();
  R.followSun(p[0], p[2]);
}
let orbit = 0;
function menuCamera(dt) {
  orbit += dt * 0.08;
  cam.position.set(Math.cos(orbit) * 9, 4.2, Math.sin(orbit) * 9); cam.lookAt(0, 0.4, 0); cam.fov = 55; cam.updateProjectionMatrix(); R.followSun(0, 0);
}

// ------------------------------------------------------------------ döngü
let last = performance.now(), lastRender = 0, hudT = 0, frames = 0, perfT = 0, slowSecs = 0, fastSecs = 0, lastCount = 99, prevV = null, prevFlips = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  net.update();
  const inp = input.read();
  if (inp.pause) pause(!paused && $('sPause').hidden);
  if (state !== 'menu' && !paused) {
    if (inp.cam) { camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length]; S.cam = camMode; save(); hud.toast({ takip: 'Takip kamerası', uzak: 'Uzak kamera', ust: 'Üstten kamera', surucu: 'Sürücü kamerası' }[camMode], 800); }
    if (inp.reset && game.player) game.respawn(game.player);
    game.update(dt, inp);
    if (game.race) game.checkEnd();
    game.netSync();
    gameFeedback(dt);
  } else if (state !== 'menu' && game.race && game.race.online) { game.update(dt, { thr: 0, st: 0 }); game.netSync(); }
  else if (state === 'menu') { if (net.mode !== 'menu' && net.mode !== 'lobby') net.mode = 'menu'; }
  // çizim (kare hızı sınırı)
  const minGap = 1000 / S.fps - 2;
  if (t - lastRender < minGap) return;
  lastRender = t;
  if (state === 'menu') menuCamera(dt); else { game.render(dt); updateCamera(Math.max(dt, 1 / S.fps)); }
  R.renderer.render(R.scene, R.camera);
  frames++;
  if (t - perfT > 1000) {                // dinamik çözünürlük
    const fps = frames * 1000 / (t - perfT); frames = 0; perfT = t;
    if (state !== 'menu') {
      if (fps < S.fps * 0.82) { slowSecs++; fastSecs = 0; } else if (fps > S.fps * 0.96) { fastSecs++; slowSecs = 0; } else { slowSecs = fastSecs = 0; }
      if (slowSecs >= 2 && R.scale > 0.55) { R.setScale(Math.max(0.55, R.scale - 0.1)); slowSecs = 0; }
      if (fastSecs >= 4 && R.scale < 1) { R.setScale(Math.min(1, R.scale + 0.05)); fastSecs = 0; }
    }
    if (state === 'menu') updateStatus();
  }
  if (state !== 'menu' && t - hudT > 100) { hudT = t; updateHud(); }
}
function gameFeedback(dt) {
  const P = game.player; if (!P) return;
  const S2 = P.car.S, tm = P.car.telemetry();
  audio.motorsFrom(tm.side);
  if (prevV) { const dv = Math.hypot(S2.v[0] - prevV[0], S2.v[1] - prevV[1], S2.v[2] - prevV[2]) / Math.max(dt, 1 / 120); if (dv > 25) { audio.bump(dv / 80); if (dv > 45) vib(Math.min(60, dv / 2)); } }
  prevV = S2.v.slice();
  if (S2.flips > prevFlips) { hud.toast('TAKLA!'); vib(30); }
  prevFlips = S2.flips;
  $('bFlip').classList.toggle('cool', P.flipT > 0);
  // geri sayım
  if (game.race) {
    const rt = game.raceTime();
    if (rt < 0) { const n = Math.ceil(-rt); $('countWrap').hidden = false; $('count').textContent = n; if (n !== lastCount) { lastCount = n; audio.beep(520, 0.15); } }
    else if (rt < 0.8) { $('countWrap').hidden = false; $('count').textContent = 'BAŞLA!'; if (lastCount !== 0) { lastCount = 0; audio.beep(880, 0.35); vib(60); } }
    else $('countWrap').hidden = true;
  }
}
function updateHud() {
  const P = game.player; if (!P) return;
  const sp = Math.hypot(P.car.S.v[0], P.car.S.v[2]) * 3.6;
  $('hSpeed').textContent = sp.toFixed(1).replace('.', ',');
  if (game.race) {
    const st = game.standings(), me = st.findIndex(r => r.me), rr = P.r;
    $('hLap').textContent = `${Math.min(rr.lapsDone + 1, game.race.laps)}/${game.race.laps}`;
    $('hPos').textContent = `${me + 1}/${st.length}`;
    $('hTime').textContent = fmt(Math.max(0, rr.fin || game.raceTime()));
    $('stand').innerHTML = '';
    for (const [i, r] of st.slice(0, 5).entries()) { const d = document.createElement('div'); if (r.me) d.className = 'me'; d.innerHTML = `<b>${i + 1}</b><i></i><span></span>`; d.querySelector('i').style.background = r.color; d.querySelector('span').textContent = r.name; $('stand').appendChild(d); }
  }
  drawMini();
}

// ------------------------------------------------------------------ başlangıç
(async () => {
  try {
    const need = new Set([R.Q.player, R.Q.others]);
    await loadCarModels([...need]);
  } catch (e) { console.warn('model yüklenemedi, basit araç kullanılacak', e); }
  $('loading').hidden = true; show('sMenu'); requestAnimationFrame(loop);
})();
window.__game = { game, net, W, S };       // test için
