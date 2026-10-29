/**
 * Loudness normalization with ITU-R BS.1770 K-weighting (coefficients for any sample rate, as in
 * libebur128). Short stimuli are measured ungated; longer tracks use the -70 LUFS absolute gate.
 */

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

function kWeighting(fs: number): [Biquad, Biquad] {
  // Stage 1: high-shelf (head effects).
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stage 2: RLB high-pass.
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/** Integrated loudness in LUFS (mono). */
export function measureLoudness(x: Float32Array, fs: number): number {
  const [s, h] = kWeighting(fs);
  const k = filter(filter(x, s), h);
  const block = Math.round(0.4 * fs);
  if (k.length < block * 2) {
    let ms = 0;
    for (let i = 0; i < k.length; i++) ms += k[i] * k[i];
    ms /= Math.max(1, k.length);
    return -0.691 + 10 * Math.log10(ms + 1e-12);
  }
  // 400 ms blocks with 75% overlap, absolute gate at -70 LUFS, relative gate at -10 LU.
  const hop = Math.round(block / 4);
  const powers: number[] = [];
  for (let start = 0; start + block <= k.length; start += hop) {
    let ms = 0;
    for (let i = start; i < start + block; i++) ms += k[i] * k[i];
    powers.push(ms / block);
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p + 1e-12);
  const abs = powers.filter((p) => lufs(p) > -70);
  if (abs.length === 0) return -70;
  const relGate = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const rel = abs.filter((p) => lufs(p) > relGate);
  return lufs(rel.reduce((a, b) => a + b, 0) / rel.length);
}

/** Scale in place to the target loudness, never letting peaks exceed `peakCeiling`. */
export function normalizeLoudness(x: Float32Array, fs: number, targetLufs: number, peakCeiling = 0.89): number {
  const current = measureLoudness(x, fs);
  let gain = 10 ** ((targetLufs - current) / 20);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak * gain > peakCeiling) gain = peakCeiling / peak;
  for (let i = 0; i < x.length; i++) x[i] *= gain;
  return gain;
}
