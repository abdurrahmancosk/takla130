// Kontroller: dokunmatik çift çubuk (gerçek kumanda gibi: sol çubuk ileri/geri, sağ çubuk sağ/sol),
// tek çubuk seçeneği, klavye ve oyun kolu (Bluetooth gamepad).
export class Input {
  constructor(el, settings) {
    this.el = el; this.s = settings;
    this.thr = 0; this.st = 0; this._flip = false; this._reset = false; this._cam = false;
    this.sticks = {};        // pointerId -> { side, x0, y0, x, y, knob, base }
    this.keys = new Set();
    const R = () => Math.min(70, window.innerHeight * 0.16);
    const down = (e) => {
      if (e.target.closest('button')) return;
      const side = e.clientX < window.innerWidth / 2 ? 'L' : 'R';
      if (Object.values(this.sticks).some(s => s.side === side)) return;
      e.preventDefault(); el.setPointerCapture?.(e.pointerId);
      const base = document.getElementById('stick' + side), knob = base.firstElementChild;
      base.style.left = e.clientX + 'px'; base.style.top = e.clientY + 'px'; base.classList.add('on');
      this.sticks[e.pointerId] = { side, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, base, knob, R: R() };
      move(e);
    };
    const move = (e) => {
      const s = this.sticks[e.pointerId]; if (!s) return;
      e.preventDefault();
      let dx = e.clientX - s.x0, dy = e.clientY - s.y0; const l = Math.hypot(dx, dy);
      if (l > s.R) { dx *= s.R / l; dy *= s.R / l; }
      const two = this.s.controls === 'iki';
      if (two || this.s.controls === 'egim') { if (s.side === 'L') dx = 0; else dy = 0; }
      s.dx = dx / s.R; s.dy = dy / s.R;
      s.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const up = (e) => { const s = this.sticks[e.pointerId]; if (!s) return; s.base.classList.remove('on'); s.knob.style.transform = ''; delete this.sticks[e.pointerId]; };
    el.addEventListener('pointerdown', down, { passive: false });
    el.addEventListener('pointermove', move, { passive: false });
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT/.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this._flip = true; if (e.code === 'KeyR') this._reset = true; if (e.code === 'KeyC') this._cam = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); for (const id in this.sticks) up({ pointerId: +id }); });
    this.padPrev = [];
    // eğerek direksiyon: ekran düzlemindeki yerçekimi yönü (telefonu direksiyon gibi sağa/sola yatır)
    this.tilt = { ok: false, raw: 0, zero: 0 };
    window.addEventListener('devicemotion', (e) => {
      const g = e.accelerationIncludingGravity; if (!g || g.x == null || g.y == null) return;
      const a = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 90 + 360) % 360;
      let gx, gy;
      if (a === 90) { gx = -g.y; gy = g.x; } else if (a === 270) { gx = g.y; gy = -g.x; } else if (a === 180) { gx = -g.x; gy = -g.y; } else { gx = g.x; gy = g.y; }
      if (Math.hypot(gx, gy) < 2) return;                    // telefon düz yatıyorsa açı anlamsız
      const ang = Math.atan2(-gx, gy) * 180 / Math.PI;       // + : sağa yatık
      this.tilt.raw = this.tilt.ok ? this.tilt.raw * 0.7 + ang * 0.3 : ang; this.tilt.ok = true;
    });
  }
  calibrate() { if (this.tilt.ok) this.tilt.zero = Math.max(-20, Math.min(20, this.tilt.raw)); }
  tiltSteer() {
    if (!this.tilt.ok) return 0;
    let d = (this.tilt.raw - this.tilt.zero) * (this.s.tiltInvert ? -1 : 1);
    d = Math.abs(d) < 1.5 ? 0 : d - Math.sign(d) * 1.5;      // ölü bölge
    return Math.max(-1, Math.min(1, d / (this.s.tiltMax || 24)));
  }
  bindButton(id, what) {
    const b = document.getElementById(id); if (!b) return;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this['_' + what] = true; b.classList.add('press'); });
    const off = () => b.classList.remove('press'); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off);
  }
  // her karede: birleşik komut
  read() {
    const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), this.s.expo || 1.35);
    let thr = 0, st = 0;
    if (this.s.controls === 'egim') st = this.tiltSteer();
    for (const s of Object.values(this.sticks)) {
      if (this.s.controls === 'iki' || this.s.controls === 'egim') { if (s.side === 'L') thr = -(s.dy || 0); else st = s.dx || 0; }
      else if (s.side === 'L') { thr = -(s.dy || 0); st = s.dx || 0; }
    }
    const K = this.keys;
    if (K.has('ArrowUp') || K.has('KeyW')) thr = 1; if (K.has('ArrowDown') || K.has('KeyS')) thr = -1;
    if (K.has('ArrowRight') || K.has('KeyD')) st = 1; if (K.has('ArrowLeft') || K.has('KeyA')) st = -1;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const dz = (v) => Math.abs(v) < 0.12 ? 0 : v;
      const a1 = dz(p.axes[1] || 0), a2 = dz(p.axes[2] ?? 0), a0 = dz(p.axes[0] || 0);
      if (a1) thr = -a1; if (a2) st = a2; else if (a0) st = a0;
      const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (rt > 0.05 || lt > 0.05) thr = rt - lt;
      const pr = (i) => p.buttons[i] && p.buttons[i].pressed && !this.padPrev[i];
      if (pr(0)) this._flip = true; if (pr(1)) this._reset = true; if (pr(3)) this._cam = true; if (pr(9)) this._pause = true;
      this.padPrev = p.buttons.map(b => b.pressed);
      break;
    }
    this.thr = curve(Math.max(-1, Math.min(1, thr))) * (this.s.throttleLimit || 1);
    this.st = (this.s.controls === 'egim' && !Object.values(this.sticks).some(x => x.side === 'R') ? Math.max(-1, Math.min(1, st)) : curve(Math.max(-1, Math.min(1, st)))) * (this.s.steerGain || 1);
    const out = { thr: this.thr, st: Math.max(-1, Math.min(1, this.st)), flip: this._flip, reset: this._reset, cam: this._cam, pause: this._pause };
    this._flip = this._reset = this._cam = this._pause = false;
    return out;
  }
  releaseAll() { for (const id in this.sticks) { const s = this.sticks[id]; s.base.classList.remove('on'); s.knob.style.transform = ''; } this.sticks = {}; this.keys.clear(); }
}
