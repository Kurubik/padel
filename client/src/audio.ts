/** Tiny WebAudio synth: every sound is generated, no audio files ship. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  return ctx;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function soundEnabled(): boolean {
  return enabled;
}

/** Browsers require a gesture before audio starts. */
export function primeAudio(): void {
  const c = ac();
  if (c && c.state === "suspended") void c.resume();
}

type ToneOpts = { freq: number; to?: number; dur: number; type?: OscillatorType; gain?: number; delay?: number };

function tone({ freq, to, dur, type = "sine", gain = 0.3, delay = 0 }: ToneOpts): void {
  const c = ac();
  if (!c || !master || !enabled) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, gain: number, filterFreq: number, delay = 0): void {
  const c = ac();
  if (!c || !master || !enabled) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(lp).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  hit(quality: number): void {
    tone({ freq: 320 + quality * 260, to: 140, dur: 0.09, type: "triangle", gain: 0.34 });
    noise(0.05, 0.16, 2600);
  },
  bounce(speed: number): void {
    const g = Math.min(0.3, 0.08 + speed * 0.02);
    tone({ freq: 180 + speed * 6, to: 90, dur: 0.08, type: "sine", gain: g });
  },
  glass(speed: number): void {
    tone({ freq: 900 + speed * 12, to: 420, dur: 0.13, type: "sine", gain: 0.2 });
    noise(0.06, 0.1, 4200);
  },
  fence(): void {
    noise(0.12, 0.2, 900);
    tone({ freq: 120, to: 70, dur: 0.12, type: "sawtooth", gain: 0.12 });
  },
  net(): void {
    noise(0.09, 0.2, 1200);
    tone({ freq: 150, to: 80, dur: 0.1, type: "triangle", gain: 0.14 });
  },
  serve(): void {
    tone({ freq: 420, to: 220, dur: 0.12, type: "triangle", gain: 0.26 });
  },
  fault(): void {
    tone({ freq: 200, to: 150, dur: 0.18, type: "square", gain: 0.16 });
  },
  let(): void {
    tone({ freq: 520, to: 620, dur: 0.1, type: "sine", gain: 0.2 });
    tone({ freq: 520, to: 620, dur: 0.1, type: "sine", gain: 0.2, delay: 0.14 });
  },
  point(win: boolean): void {
    if (win) {
      tone({ freq: 520, dur: 0.1, type: "triangle", gain: 0.3 });
      tone({ freq: 660, dur: 0.12, type: "triangle", gain: 0.28, delay: 0.1 });
      tone({ freq: 880, dur: 0.18, type: "triangle", gain: 0.24, delay: 0.22 });
    } else {
      tone({ freq: 300, to: 180, dur: 0.24, type: "sawtooth", gain: 0.2 });
    }
  },
  whistle(): void {
    tone({ freq: 1400, to: 1750, dur: 0.3, type: "sine", gain: 0.18 });
  },
  ui(): void {
    tone({ freq: 700, to: 520, dur: 0.05, type: "triangle", gain: 0.12 });
  },
};
