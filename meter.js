/* Speech timing from the microphone level: how long the learner really talks, how fast, how many pauses,
   and how long they wait before answering. Estimates only, meant for comparing with your own earlier calls. */
"use strict";

class SpeechMeter {
  constructor() { this.t = []; this.r = []; this.model = []; }

  /** One 16 kHz PCM16 frame (40 ms) that starts at audio-clock time t (seconds). */
  feed(pcm, t) {
    let s = 0;
    for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 32768; s += v * v; }
    this.t.push(t);
    this.r.push(Math.sqrt(s / (pcm.length || 1)));
  }

  /** The model's voice plays from s to e (audio-clock seconds). */
  modelSpan(s, e) {
    const m = this.model, last = m[m.length - 1];
    if (last && s <= last[1] + 0.4) { if (e > last[1]) last[1] = e; } else m.push([s, e]);
  }
  /** The model's voice was cut off at time t. */
  cutModel(t) {
    const last = this.model[this.model.length - 1];
    if (last && last[1] > t) last[1] = Math.max(last[0], t);
  }

  /** Stretches of speech [start, end] (seconds), found from the frame energy. */
  segments() {
    const n = this.r.length;
    if (!n) return [];
    const nz = this.r.filter(x => x > 0.0005).sort((a, b) => a - b);
    const floor = nz.length ? nz[Math.floor(nz.length * 0.1)] : 0;
    const thr = Math.min(0.03, Math.max(0.01, floor * 3));
    const FR = 0.04, segs = [];
    for (let i = 0; i < n; i++) {
      if (this.r[i] <= thr) continue;
      const s = this.t[i], e = this.t[i] + FR, last = segs[segs.length - 1];
      if (last && s - last[1] < 0.3) last[1] = e; else segs.push([s, e]);
    }
    return segs.filter(g => g[1] - g[0] >= 0.12);
  }

  /** words = the learner's word count, turns = how many times they spoke. */
  stats(words, turns) {
    const segs = this.segments();
    const speechSec = segs.reduce((a, g) => a + (g[1] - g[0]), 0);
    const modelSec = this.model.reduce((a, m) => a + (m[1] - m[0]), 0);
    const spoke = (a, b) => this.model.some(m => m[0] < b && m[1] > a);
    let pauses = 0, longest = 0;
    for (let i = 1; i < segs.length; i++) {
      const gap = segs[i][0] - segs[i - 1][1];
      if (gap >= 0.8 && !spoke(segs[i - 1][1], segs[i][0])) { pauses++; longest = Math.max(longest, gap); }
    }
    const lats = [];
    for (const m of this.model) {
      const next = segs.find(g => g[0] >= m[1] - 0.05);
      if (!next) continue;
      const again = this.model.find(x => x[0] > m[1] + 0.001);
      if (again && again[0] < next[0]) continue;      // the model spoke again before the learner did
      const lat = next[0] - m[1];
      if (lat >= 0 && lat <= 20) lats.push(lat);
    }
    lats.sort((a, b) => a - b);
    const reaction = lats.length ? lats[Math.floor(lats.length / 2)] : null;
    const r1 = (x) => Math.round(x * 10) / 10;
    return {
      speechSec: Math.round(speechSec),
      share: speechSec + modelSec > 0 ? Math.round(speechSec / (speechSec + modelSec) * 100) : 0,
      wpm: speechSec >= 5 ? Math.round(words / (speechSec / 60)) : 0,
      avgWords: turns ? r1(words / turns) : 0,
      pauses, longest: r1(longest),
      reaction: reaction === null ? null : r1(reaction), reactions: lats.length
    };
  }
}

/** PCM16 chunks -> base64 WAV (16 kHz mono). */
function pcm16ToWavBase64(chunks, rate) {
  rate = rate || 16000;
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + total * 2), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); dv.setUint32(4, 36 + total * 2, true); str(8, "WAVE"); str(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, "data"); dv.setUint32(40, total * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) dv.setInt16(o, c[i], true);
  return b64FromBytes(new Uint8Array(buf));
}

/** Records the microphone as PCM16 chunks (for the one-minute monologue). */
class MonoRecorder {
  constructor(stream, ctx) {
    this.stream = stream; this.ctx = ctx;
    this.chunks = []; this.meter = new SpeechMeter(); this.level = 0; this.node = null; this.src = null; this.t0 = 0;
  }
  async start() {
    const ctx = this.ctx;
    if (ctx.state !== "running") { try { await ctx.resume(); } catch (e) {} }
    await ctx.audioWorklet.addModule("mic-worklet.js");
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, "mic-proc");
    const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);
    this.node.port.onmessage = (e) => {
      const pcm = new Int16Array(e.data);
      this.chunks.push(pcm);
      this.meter.feed(pcm, ctx.currentTime - 0.04);
      let s = 0; for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 32768; s += v * v; }
      this.level = Math.sqrt(s / pcm.length);
    };
    this.src.connect(this.node); this.node.connect(mute);
    this.t0 = ctx.currentTime;
  }
  stop(keepStream) {
    const seconds = this.chunks.reduce((a, c) => a + c.length, 0) / 16000;
    try { this.node.port.onmessage = null; this.node.disconnect(); this.src.disconnect(); } catch (e) {}
    if (!keepStream) { try { this.stream.getTracks().forEach(t => t.stop()); } catch (e) {} }
    return { chunks: this.chunks, meter: this.meter, seconds };
  }
}
