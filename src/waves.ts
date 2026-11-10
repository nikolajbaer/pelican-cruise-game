// The sea and the shore as functions of place and time, written twice: once here (the flight model reads the
// water's height, how fast it is rising and where the dunes are) and once in GLSL (`WAVE_GLSL`, `BEACH_GLSL`:
// the meshes are displaced and shaded by the same formulas). Keep the two in step: the pelican skims a surface
// it cannot see otherwise.
//
// Axes: the shore runs along z and the pelican flies toward -z. The sea is x < 0, the beach x > 0, and the
// swell travels toward +x. Each swell line is one "wave" n; along z its height rises into peaks and falls into
// shoulders (a beach break), it steepens as it nears the depth where it breaks, breaks first at the peak, and
// then runs in as a bore that dies at the shoreline.

/** Distance between swell lines, meters. */
export const WAVE_LENGTH = 46;
/** How fast a swell line travels toward the beach, m/s. */
export const WAVE_SPEED = 5.2;
/** Height of the tallest peak just before it breaks, meters. */
export const WAVE_MAX_HEIGHT = 3.2;
/** Rise of the beach per meter inland, near the waterline. */
export const BEACH_SLOPE = 0.05;

const TAU = 6.2832;
const fract = (v: number) => v - Math.floor(v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** How far the swell lines bow toward the beach at this z (they are not ruled straight). */
const bend = (z: number) => 9 * Math.sin(z * 0.011) + 5 * Math.sin(z * 0.023 + 1.7);

export interface WaveSample {
  /** Height of the swell alone at this point (no chop, no surge). */
  height: number;
  /** 0 to 1: this wave's size at this z, against the largest. */
  amp: number;
  /** 0 to 1: how far the crest has broken. */
  broken: number;
  /** Where this wave's crest is (x), and where it breaks. */
  crestX: number;
  breakX: number;
}

export function sampleWave(x: number, z: number, t: number, out: WaveSample): WaveSample {
  const p = (x + bend(z) - WAVE_SPEED * t) / WAVE_LENGTH;
  const n = Math.floor(p);
  const d = p - n - 0.5;
  const m = ((n % 1024) + 1024) % 1024;
  const r1 = fract(m * 0.618034);
  const r2 = fract(m * 0.754878 + 0.3);
  const r3 = fract(m * 0.56984 + 0.7);
  const peak = (0.5 + 0.5 * Math.sin(z * 0.05 + r1 * TAU)) * (0.55 + 0.45 * Math.sin(z * 0.019 + r2 * TAU));
  const amp = (0.6 + 0.4 * r3) * (0.45 + 0.55 * smoothstep(0.05, 0.55, peak));
  const xb = -(26 + 62 * amp);
  const xc = x - d * WAVE_LENGTH;
  const steep = smoothstep(-240, xb, xc);
  const brk = smoothstep(xb, xb + 14, xc);
  const H = WAVE_MAX_HEIGHT * amp * mix(0.5, 1, steep) * (1 - 0.5 * smoothstep(xb, xb + 40, xc)) * (1 - smoothstep(-14, 1, xc));
  const w = d > 0 ? mix(0.17, 0.062, steep) : mix(0.21, 0.13, steep);
  out.height = H * Math.exp(-(d * d) / (w * w));
  out.amp = amp;
  out.broken = brk;
  out.crestX = xc;
  out.breakX = xb;
  return out;
}

const scratch: WaveSample = { height: 0, amp: 0, broken: 0, crestX: 0, breakX: 0 };

/** Height of the sea surface (swell, wind chop and the surge up the beach). */
export function oceanHeight(x: number, z: number, t: number): number {
  let h = sampleWave(x, z, t, scratch).height;
  const off = Math.min(1, Math.max(0, -x / 40));
  h += off * (0.1 * Math.sin(x * 0.31 - t * 1.4 + z * 0.13) + 0.07 * Math.sin(z * 0.27 + x * 0.09 + t * 1.1));
  const u0 = fract((bend(z) - WAVE_SPEED * t) / WAVE_LENGTH);
  h += 0.2 * Math.cos(TAU * (u0 - 0.35)) * smoothstep(-45, 0, x);
  return h;
}

/** Height of the sand: a flat slope out of the sea, dunes from about 20 m inland, low hills behind. */
export function beachHeight(x: number, z: number): number {
  let h = BEACH_SLOPE * x;
  const dune = smoothstep(18, 55, x);
  h += dune * (2.6 + 2.2 * Math.sin(x * 0.07 + 2 * Math.sin(z * 0.013)) * Math.sin(z * 0.031 + x * 0.01) + 1.2 * Math.sin(z * 0.083 + 1) * Math.sin(x * 0.11 + 2));
  h += smoothstep(120, 420, x) * 26 * (0.65 + 0.35 * Math.sin(z * 0.004 + 0.5));
  return h;
}

/** What is under a point: the sea, or the sand where it stands above the sea. */
export function surfaceHeight(x: number, z: number, t: number): number {
  return x < -30 ? oceanHeight(x, z, t) : Math.max(oceanHeight(x, z, t), beachHeight(x, z));
}

/**
 * How fast the air is pushed up at a point, m/s: the face of an advancing wave lifts the air ahead of it (the
 * surface there is rising), and the effect fades with height. The sink behind the crest is mostly forgiven.
 */
export function waveLift(x: number, y: number, z: number, t: number): number {
  if (x > 6) return 0;
  const dt = 0.05;
  let rise = -1;
  // The lifted air reaches a few meters ahead of the face, so look there too.
  for (let i = 0; i < 3; i++) {
    const sx = x - i * 2;
    rise = Math.max(rise, (oceanHeight(sx, z, t + dt) - oceanHeight(sx, z, t)) / dt);
  }
  const above = Math.max(0, y - oceanHeight(x, z, t));
  return (rise > 0 ? Math.min(5, rise * 1.3) : rise * 0.4) * Math.exp(-above / 3.6);
}

export const WAVE_GLSL = /* glsl */ `
uniform float uTime;
const float WL = ${WAVE_LENGTH.toFixed(1)};
const float WC = ${WAVE_SPEED.toFixed(2)};
const float HMAX = ${WAVE_MAX_HEIGHT.toFixed(2)};
float bendF(float z) { return 9.0 * sin(z * 0.011) + 5.0 * sin(z * 0.023 + 1.7); }
// a: shape (1 at the crest), offset from the crest in wavelengths, broken 0..1, wave height
// b: crest x, break x, steepness 0..1, size 0..1
float swell(vec2 P, out vec4 a, out vec4 b) {
  float p = (P.x + bendF(P.y) - WC * uTime) / WL;
  float n = floor(p);
  float d = p - n - 0.5;
  float m = mod(n, 1024.0);
  float r1 = fract(m * 0.618034), r2 = fract(m * 0.754878 + 0.3), r3 = fract(m * 0.56984 + 0.7);
  float peak = (0.5 + 0.5 * sin(P.y * 0.050 + r1 * 6.2832)) * (0.55 + 0.45 * sin(P.y * 0.019 + r2 * 6.2832));
  float amp = (0.6 + 0.4 * r3) * (0.45 + 0.55 * smoothstep(0.05, 0.55, peak));
  float xb = -(26.0 + 62.0 * amp);
  float xc = P.x - d * WL;
  float steep = smoothstep(-240.0, xb, xc);
  float brk = smoothstep(xb, xb + 14.0, xc);
  float H = HMAX * amp * mix(0.5, 1.0, steep) * (1.0 - 0.5 * smoothstep(xb, xb + 40.0, xc)) * (1.0 - smoothstep(-14.0, 1.0, xc));
  float w = d > 0.0 ? mix(0.17, 0.062, steep) : mix(0.21, 0.13, steep);
  float s = exp(-(d * d) / (w * w));
  a = vec4(s, d, brk, H);
  b = vec4(xc, xb, steep, amp);
  return H * s;
}
float surge(vec2 P) {
  float u0 = fract((bendF(P.y) - WC * uTime) / WL);
  return 0.2 * cos(6.2832 * (u0 - 0.35)) * smoothstep(-45.0, 0.0, P.x);
}
float chop(vec2 P) {
  float off = clamp(-P.x / 40.0, 0.0, 1.0);
  return off * (0.10 * sin(P.x * 0.31 - uTime * 1.4 + P.y * 0.13) + 0.07 * sin(P.y * 0.27 + P.x * 0.09 + uTime * 1.1));
}
`;

export const BEACH_GLSL = /* glsl */ `
float beachH(vec2 P) {
  float h = ${BEACH_SLOPE.toFixed(3)} * P.x;
  float dune = smoothstep(18.0, 55.0, P.x);
  h += dune * (2.6 + 2.2 * sin(P.x * 0.07 + 2.0 * sin(P.y * 0.013)) * sin(P.y * 0.031 + P.x * 0.01) + 1.2 * sin(P.y * 0.083 + 1.0) * sin(P.x * 0.11 + 2.0));
  h += smoothstep(120.0, 420.0, P.x) * 26.0 * (0.65 + 0.35 * sin(P.y * 0.004 + 0.5));
  return h;
}
`;
