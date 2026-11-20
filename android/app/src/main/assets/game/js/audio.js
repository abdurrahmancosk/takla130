// Sesler WebAudio ile anında üretilir (dosya yok): iki DC130 motorunun vızıltısı, çarpma, geri sayım, bitiş.
export class Audio {
  constructor(settings) { this.s = settings; this.ctx = null; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.s.sound ? this.s.volume : 0; this.master.connect(c.destination);
    this.motors = [0, 1].map(() => {
      const o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 7; f.type = 'lowpass'; f.frequency.value = 1800; f.Q.value = 2; g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master); o.start(); o2.start();
      return { o, o2, f, g };
    });
    const len = c.sampleRate * 0.25, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    this.noise = buf;
  }
  setEnabled() { if (this.master) this.master.gain.value = this.s.sound ? this.s.volume : 0; }
  pause(p) { if (!this.ctx) return; if (p) this.ctx.suspend(); else this.ctx.resume(); }
  // side: telemetry().side ; her karede
  motorsFrom(side) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    side.forEach((s, k) => {
      const m = this.motors[k], rpm = Math.abs(s.rpm || 0), load = Math.min(1, Math.abs(s.I || 0) / 2.2);
      const f = 60 + rpm / 60 * 1.0;                       // komütatör vızıltısı ~ devir/60 Hz
      m.o.frequency.setTargetAtTime(f, t, 0.03); m.o2.frequency.setTargetAtTime(f * 2, t, 0.03);
      m.f.frequency.setTargetAtTime(600 + rpm * 0.25, t, 0.05);
      m.g.gain.setTargetAtTime(Math.abs(s.u || 0) > 0.01 || rpm > 300 ? 0.025 + 0.06 * load + rpm / 9000 * 0.04 : 0, t, 0.05);
    });
  }
  silence() { if (!this.ctx) return; const t = this.ctx.currentTime; for (const m of this.motors) m.g.gain.setTargetAtTime(0, t, 0.05); }
  bump(strength) {
    if (!this.ctx || strength < 0.15) return;
    const c = this.ctx, src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    src.buffer = this.noise; f.type = 'lowpass'; f.frequency.value = 900 + 2400 * Math.min(1, strength);
    g.gain.value = Math.min(0.5, strength * 0.4); src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }
  beep(freq = 660, dur = 0.15) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + dur + 0.02);
  }
  finish() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f, 0.18), i * 130)); }
}
