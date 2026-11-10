import { WAVE_SPEED, surfaceHeight, waveLift } from "./waves";

// How the pelican flies. It is a glider that never falls out of the sky: left alone it holds its height and
// beats its wings to keep a cruising speed. Rising air in front of a wave is turned into speed (the bird noses
// down into it to hold its height), flying within a wingspan of the water costs less drag (ground effect), and
// both together are what make a long fast glide down the face of a wave. No rendering here, so it runs in a test.

export interface Flight {
  x: number;
  y: number;
  z: number;
  /** Airspeed, m/s. */
  speed: number;
  /** 0 flies along the shore (toward -z); positive turns toward the beach. */
  heading: number;
  /** Climb angle, radians. */
  climb: number;
  /** Roll, radians; positive banks toward the beach. */
  bank: number;
  /** 0 to 1: how hard the wings are beating. */
  flap: number;
  /** Rising air at the pelican, m/s (smoothed). */
  lift: number;
  /** Height over the water or sand below. */
  clearance: number;
  /** Meters covered since the last wingbeat, and the longest such glide. */
  glide: number;
  best: number;
  /** Seconds of beating since the glide was last unbroken (a short flutter does not end a glide). */
  beating: number;
}

export const CRUISE_SPEED = 10.5;
export const TOP_SPEED = 27;
const GRAVITY = 9.8;
const DRAG = 0.0062;
const MAX_HEADING = 1.05;
const SEA_LIMIT = -230;
const LAND_LIMIT = 80;
const CEILING = 60;

export function createFlight(): Flight {
  return { x: -70, y: 9, z: 0, speed: 12, heading: 0, climb: 0, bank: 0, flap: 0, lift: 0, clearance: 9, glide: 0, best: 0, beating: 0 };
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One step. `steer` and `pitch` are the stick, -1 to 1: right is toward the beach, up climbs. */
export function stepFlight(f: Flight, steer: number, pitch: number, time: number, dt: number): void {
  const ease = (rate: number) => 1 - Math.exp(-dt * rate);

  // Turning: bank, and the bank turns the bird. It will not turn back up the shore or fly off to sea or inland.
  f.bank += (steer * 0.85 - f.bank) * ease(5);
  let turn = (GRAVITY * Math.tan(f.bank)) / f.speed * 1.25;
  if (turn > 0) turn *= Math.min(1, (MAX_HEADING - f.heading) / 0.3);
  else turn *= Math.min(1, (MAX_HEADING + f.heading) / 0.3);
  // Past the limits the headings that lead farther out close off, until only a gentle turn back is left.
  const lowest = -MAX_HEADING + Math.min(1, Math.max(0, (SEA_LIMIT - f.x) / 60)) * (MAX_HEADING + 0.15);
  const highest = MAX_HEADING - Math.min(1, Math.max(0, (f.x - LAND_LIMIT) / 50)) * (MAX_HEADING + 0.15);
  if (f.heading < lowest) turn = Math.max(turn, (lowest - f.heading) * 2.5);
  if (f.heading > highest) turn = Math.min(turn, (highest - f.heading) * 2.5);
  f.heading = Math.min(MAX_HEADING, Math.max(-MAX_HEADING, f.heading + turn * dt));

  let wantClimb = pitch * 0.5;
  if (f.y > CEILING - 10) wantClimb = Math.min(wantClimb, (CEILING - f.y) * 0.05);
  f.climb += (wantClimb - f.climb) * ease(4);

  const lift = waveLift(f.x, f.y, f.z, time);
  f.lift += (lift - f.lift) * ease(6);

  // Speed: climbing spends it, diving and rising air earn it, drag takes its share (less of one near the surface).
  const groundEffect = 0.5 + 0.5 * smoothstep(0.6, 5, f.clearance);
  const want = f.speed < CRUISE_SPEED + 0.5 ? Math.min(1, (CRUISE_SPEED + 0.5 - f.speed) * 1.5) : 0;
  f.flap += (Math.max(want, f.climb > 0.12 && f.speed < 15 ? 0.8 : 0) - f.flap) * ease(want > f.flap ? 8 : 3);
  const thrust = f.flap * (3.2 + GRAVITY * Math.max(0, Math.sin(f.climb)));
  f.speed += (-GRAVITY * Math.sin(f.climb) + (GRAVITY * f.lift) / f.speed - DRAG * groundEffect * f.speed * f.speed + thrust) * dt;
  f.speed = Math.min(TOP_SPEED, Math.max(7, f.speed));

  const forward = f.speed * Math.cos(f.climb) * dt;
  f.x += Math.sin(f.heading) * forward;
  f.z -= Math.cos(f.heading) * forward;
  f.y += f.speed * Math.sin(f.climb) * dt;
  // Riding: with the stick let go on a wave, the bird slides shoreward with the wave and so stays on its face.
  const riding = Math.min(1, Math.max(0, f.lift) / 1.5) * Math.max(0, 1 - Math.abs(steer) / 0.3);
  f.x += WAVE_SPEED * riding * dt;

  // The cushion: the bird does not go into the sea or the sand; it skims them.
  const ground = surfaceHeight(f.x, f.z, time);
  const floor = ground + (f.x > 2 ? 1.2 : 0.45);
  if (f.y < floor) {
    f.y += (floor - f.y) * Math.min(1, dt * 14);
    f.y = Math.max(f.y, ground + 0.2);
    if (f.climb < 0) f.climb *= Math.exp(-dt * 10);
  }
  f.clearance = f.y - ground;

  if (f.flap > 0.35) {
    f.beating += dt;
    if (f.beating > 0.7) f.glide = 0;
  } else {
    f.beating = 0;
    f.glide += forward;
    f.best = Math.max(f.best, f.glide);
  }
}
