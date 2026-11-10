import { WAVE_SPEED, type WaveSample, oceanHeight, sampleWave, surfaceHeight, waveLift } from "./waves";

// How the pelican flies. It is a glider that never falls out of the sky: left alone it holds its height and
// beats its wings to keep a cruising speed. Rising air in front of a wave is turned into speed (the bird noses
// down into it to hold its height), flying within a wingspan of the water costs less drag (ground effect), and
// both together are what make a long fast glide down the face of a wave. No rendering here, so it runs in a test.
//
// Meeting the water: flown down onto calm water the bird lands and sits there, riding over the unbroken swells,
// until it is told to climb or whitewater is about to reach it. A wave about to hit it in the air (a face rising
// into its path, or the surface coming up under a bird already skimming) makes it pull up over the wave by itself.

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
  /** Sitting on the water, and for how long. */
  afloat: boolean;
  floated: number;
  /** Seconds left of a climb the bird is making by itself (over a wave, or off the water). */
  evade: number;
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
  return { x: -70, y: 9, z: 0, speed: 12, heading: 0, climb: 0, bank: 0, flap: 0, lift: 0, clearance: 9, glide: 0, best: 0, beating: 0, afloat: false, floated: 0, evade: 0 };
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const wave: WaveSample = { height: 0, amp: 0, broken: 0, crestX: 0, breakX: 0 };

/** Whether broken water will reach this spot on the sea within a couple of seconds. */
export function whitewaterComing(x: number, z: number, time: number): boolean {
  for (let reach = 1; reach <= 13; reach += 3) {
    sampleWave(x - reach, z, time, wave);
    if (wave.broken > 0.25 && wave.height > 0.35) return true;
  }
  return false;
}

function takeOff(f: Flight): void {
  f.afloat = false;
  f.speed = 8.5;
  f.climb = 0.2;
  f.evade = 1.5;
  f.y += 0.3;
}

/** A step spent sitting on the water: it coasts to a stop, bobs, paddles round to the stick, and waits. */
function stepAfloat(f: Flight, steer: number, pitch: number, time: number, dt: number): void {
  f.floated += dt;
  f.speed = Math.max(0, f.speed - (4 + f.speed) * dt);
  f.heading = Math.min(MAX_HEADING, Math.max(-MAX_HEADING, f.heading + steer * 0.7 * dt));
  f.x += Math.sin(f.heading) * f.speed * dt;
  f.z -= Math.cos(f.heading) * f.speed * dt;
  const settle = 1 - Math.exp(-dt * 10);
  // It drops onto the water, and from then on is carried by it exactly (a swell does not wash over it).
  const water = oceanHeight(f.x, f.z, time) + 0.05;
  f.y = Math.max(water, f.y + (water - f.y) * settle);
  f.climb *= 1 - settle;
  f.bank *= 1 - settle;
  f.flap *= 1 - settle;
  f.lift = 0;
  f.glide = 0;
  f.clearance = 0.05;
  // Up again when told to climb, when whitewater is nearly on it, or when it has been carried into the shallows.
  if (f.floated > 0.6 && (pitch > 0.25 || f.x > -6 || whitewaterComing(f.x, f.z, time))) takeOff(f);
}

/** One step. `steer` and `pitch` are -1 to 1: positive steers toward the beach, positive pitch climbs. */
export function stepFlight(f: Flight, steer: number, pitch: number, time: number, dt: number): void {
  if (f.afloat) {
    stepAfloat(f, steer, pitch, time, dt);
    return;
  }
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
  if (f.evade > 0) {
    f.evade -= dt;
    wantClimb = Math.max(wantClimb, 0.42);
  }
  if (f.y > CEILING - 10) wantClimb = Math.min(wantClimb, (CEILING - f.y) * 0.05);
  f.climb += (wantClimb - f.climb) * ease(4);

  const lift = waveLift(f.x, f.y, f.z, time);
  f.lift += (lift - f.lift) * ease(6);

  // Speed: climbing spends it, diving and rising air earn it, drag takes its share (less of one near the surface).
  const groundEffect = 0.5 + 0.5 * smoothstep(0.6, 5, f.clearance);
  const want = f.speed < CRUISE_SPEED + 0.5 ? Math.min(1, (CRUISE_SPEED + 0.5 - f.speed) * 1.5) : 0;
  f.flap += (Math.max(want, f.evade > 0 ? 1 : 0, f.climb > 0.12 && f.speed < 15 ? 0.8 : 0) - f.flap) * ease(want > f.flap ? 8 : 3);
  const thrust = f.flap * (3.2 + GRAVITY * Math.max(0, Math.sin(f.climb)));
  f.speed += (-GRAVITY * Math.sin(f.climb) + (GRAVITY * f.lift) / f.speed - DRAG * groundEffect * f.speed * f.speed + thrust) * dt;
  f.speed = Math.min(TOP_SPEED, Math.max(7, f.speed));

  const forward = f.speed * Math.cos(f.climb) * dt;
  // Riding: with the stick let go on a wave, the bird slides shoreward with the wave and so stays on its face.
  const riding = Math.min(1, Math.max(0, f.lift) / 1.5) * Math.max(0, 1 - Math.abs(steer) / 0.3);
  const vx = Math.sin(f.heading) * f.speed * Math.cos(f.climb) + WAVE_SPEED * riding;
  const vz = -Math.cos(f.heading) * f.speed * Math.cos(f.climb);
  const vy = f.speed * Math.sin(f.climb);
  f.x += vx * dt;
  f.z += vz * dt;
  f.y += vy * dt;

  const ground = surfaceHeight(f.x, f.z, time);
  const overSea = f.x < -6;
  if (overSea && f.evade <= 0 && f.y - ground < 1.6) {
    // Where the bird and the water will each be in a moment. Water that will be well above where it is now is a
    // wave arriving; water at the same height is just the sea the bird is descending to.
    const soon = 0.3;
    const ahead = oceanHeight(f.x + vx * soon, f.z + vz * soon, time + soon);
    const rising = ahead - ground > 0.35;
    if (rising && ahead > f.y + vy * soon - 0.2) {
      f.evade = 1.1;
    } else if (f.y - ground < 0.5) {
      if (rising || whitewaterComing(f.x, f.z, time)) f.evade = 1.1;
      else if (pitch < -0.3) {
        // Held down onto calm water: it lands.
        f.afloat = true;
        f.floated = 0;
        f.clearance = 0.05;
        return;
      }
    }
  }

  // The cushion: the bird does not go into the sea or the sand; it skims them.
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
