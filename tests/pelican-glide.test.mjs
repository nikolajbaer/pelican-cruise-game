import assert from "node:assert/strict";
import { createServer } from "vite";

// Pelican Glide (index.html): the sea it flies over and the flight model, without a screen.
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
try {
  const W = await server.ssrLoadModule("/src/waves.ts");
  const F = await server.ssrLoadModule("/src/flight.ts");
  const sample = { height: 0, amp: 0, broken: 0, crestX: 0, breakX: 0 };

  // The sea: waves stand up in the surf, die at the shoreline, and are peaky (a crest is tall in places and low in others).
  let tallest = 0;
  const crests = [];
  for (let t = 0; t < 40; t += 2) {
    for (let z = -2000; z <= 0; z += 10) {
      for (let x = -200; x <= 12; x += 1) {
        const h = W.oceanHeight(x, z, t);
        assert(Number.isFinite(h) && h > -1 && h < W.WAVE_MAX_HEIGHT + 0.6, `sea height ${h} at ${x},${z},${t}`);
        if (x > 4) assert(Math.abs(h) < 0.35, `the sea is flat (only the surge) past the waterline: ${h} at x=${x}`);
        tallest = Math.max(tallest, h);
      }
    }
  }
  assert(tallest > 2.4, `big waves come through (tallest ${tallest.toFixed(2)} m)`);
  for (let z = -3000; z <= 0; z += 4) {
    // One wave, followed along its crest.
    W.sampleWave(-150, z, 10, sample);
    W.sampleWave(sample.crestX, z, 10, sample);
    crests.push({ ...sample });
  }
  const sizes = crests.map((c) => c.amp);
  assert(Math.max(...sizes) > 2 * Math.min(...sizes), "a wave has peaks and shoulders along its length");
  const big = crests.reduce((a, b) => (a.amp > b.amp ? a : b)), small = crests.reduce((a, b) => (a.amp < b.amp ? a : b));
  assert(big.breakX < small.breakX - 15, "a peak breaks farther out than a shoulder");

  // The shore: sand rises out of the sea into dunes.
  assert(W.beachHeight(-20, 0) < -0.5 && W.beachHeight(10, 0) > 0.3, "the beach slopes out of the water");
  let dune = 0;
  for (let z = -500; z < 0; z += 7) for (let x = 30; x < 110; x += 5) dune = Math.max(dune, W.beachHeight(x, z));
  assert(dune > 4, "there are dunes behind the beach");

  const fly = (f, seconds, t0, control) => {
    const dt = 1 / 60;
    let low = Infinity, fastest = 0;
    for (let t = t0; t < t0 + seconds; t += dt) {
      const [steer, pitch] = control(f);
      F.stepFlight(f, steer, pitch, t, dt);
      low = Math.min(low, f.y - W.surfaceHeight(f.x, f.z, t));
      fastest = Math.max(fastest, f.speed);
      assert(Number.isFinite(f.x + f.y + f.z + f.speed), "the flight stays finite");
    }
    return { low, fastest };
  };

  // Hands off, the pelican flies on along the shore at cruising speed and holds its height.
  let f = F.createFlight();
  let run = fly(f, 90, 0, () => [0, 0]);
  assert(f.z < -800, `it covers ground along the shore (${f.z.toFixed(0)})`);
  assert(f.speed > F.CRUISE_SPEED - 1.5, `it keeps cruising speed (${f.speed.toFixed(1)})`);
  assert(run.low > 0.15, "it never goes into the water");

  // Hard over toward the sea or the dunes: it is turned back, never lost, and never put into a dune.
  f = F.createFlight();
  fly(f, 120, 0, () => [-1, 0]);
  assert(f.x > -420 && f.z < -300, `it cannot fly off to sea (${f.x.toFixed(0)})`);
  f = F.createFlight();
  run = fly(f, 120, 0, () => [1, -1]);
  assert(f.x < 190 && run.low > 0, `it cannot fly off inland or into a dune (${f.x.toFixed(0)}, ${run.low.toFixed(2)})`);

  // Flown down onto calm water it lands and sits; it stays there over unbroken swells, takes off by itself when
  // whitewater is about to reach it, and takes off when told to climb.
  const calm = (x, z, t) => { for (let s = 0; s < 4; s += 0.25) if (F.whitewaterComing(x, z, t + s) || W.oceanHeight(x, z, t + s) > 0.5) return false; return true; };
  let spot = null;
  for (let t = 5; t < 60 && !spot; t += 0.5) for (let z = -1500; z < 0 && !spot; z += 20) if (calm(-45, z, t) && calm(-45, z - 12, t)) spot = { t, z };
  assert(spot, "there is a calm patch of water in the surf");
  f = F.createFlight();
  Object.assign(f, { x: -45, z: spot.z + 12, y: 1.5 });
  let clock = spot.t;
  const advance = (seconds, control, until) => {
    for (let s = 0; s < seconds; s += 1 / 60, clock += 1 / 60) {
      F.stepFlight(f, ...control, clock, 1 / 60);
      assert(f.y - W.oceanHeight(f.x, f.z, clock) > -0.05, `it is never under the water (${(f.y - W.oceanHeight(f.x, f.z, clock)).toFixed(2)} at x=${f.x.toFixed(1)} afloat=${f.afloat} evade=${f.evade.toFixed(2)} climb=${f.climb.toFixed(2)} v=${f.speed.toFixed(1)})`);
      if (until?.()) return true;
    }
    return false;
  };
  assert(advance(3, [0, -1], () => f.afloat), "held down onto calm water, it lands");
  advance(1.5, [0, 0]);
  assert(f.afloat && f.speed < 1.5, `it sits on the water once the stick is let go (${f.speed.toFixed(1)} m/s)`);
  assert(advance(40, [0, 0], () => !f.afloat), "it takes off by itself");
  assert(F.whitewaterComing(f.x, f.z, clock) || f.x > -7, "and that is because whitewater was about to reach it");
  advance(2, [0, 0]);
  assert(f.clearance > 1 && f.speed > 7, `the take-off is a climb (${f.clearance.toFixed(1)} m up)`);
  // Again, and this time the player pulls back.
  f = F.createFlight();
  clock = 3;
  Object.assign(f, { x: -150, z: 0, y: W.oceanHeight(-150, 0, clock) + 1.2 });
  assert(advance(4, [0, -1], () => f.afloat), "it lands out beyond the break too");
  advance(1, [0, 0]);
  assert(f.afloat, "and waits there: unbroken swells pass under it");
  assert(advance(1, [0, 1], () => !f.afloat), "pulling back takes it off");

  // A wave met in the air: skimming level straight at the incoming waves, it pulls up over them by itself.
  f = F.createFlight();
  Object.assign(f, { x: -30, z: 0, y: 0.8, heading: -1 });
  clock = 10;
  let pulledUp = 0;
  for (let s = 0; s < 12; s += 1 / 60, clock += 1 / 60) {
    // The player holds a low, level line out to sea (and so is steering: no sliding in with a wave).
    F.stepFlight(f, f.heading > -0.9 ? -0.5 : 0.31, f.clearance > 1 ? -0.25 : 0, clock, 1 / 60);
    assert(!f.afloat && f.y - W.oceanHeight(f.x, f.z, clock) > 0.1, `a wave never catches it (${(f.y - W.oceanHeight(f.x, f.z, clock)).toFixed(2)} m at x=${f.x.toFixed(0)})`);
    if (f.evade > 1.05) pulledUp++;
  }
  assert(pulledUp >= 1, "it pulled up over a wave");

  // Riding: low on the face of a big wave, the rising air is worth speed and the wings stop beating.
  let ride = null;
  for (let t = 20; t < 60 && !ride; t += 0.5) {
    for (let z = -2000; z < 0 && !ride; z += 5) {
      for (let x = -110; x < -60; x += 0.5) {
        W.sampleWave(x, z, t, sample);
        if (sample.amp > 0.8 && Math.abs(sample.crestX - x) < 0.3 && sample.broken < 0.05) ride = { t, x, z };
      }
    }
  }
  assert(ride, "a big unbroken wave turns up");
  const lift = W.waveLift(ride.x + 3, W.oceanHeight(ride.x + 3, ride.z, ride.t) + 1, ride.z, ride.t);
  assert(lift > 1.5, `the air rises in front of the face (${lift.toFixed(2)} m/s)`);
  assert(W.waveLift(ride.x + 3, 40, ride.z, ride.t) < 0.2, "and not high above it");
  f = F.createFlight();
  Object.assign(f, { x: ride.x + 3, z: ride.z + 40, y: W.oceanHeight(ride.x + 3, ride.z + 40, ride.t) + 1.2, speed: F.CRUISE_SPEED });
  // The player's part: keep low over the face (the stick is otherwise let go, so the bird slides in with the wave).
  run = fly(f, 5, ride.t, (b) => [0, Math.max(-1, Math.min(1, (1.3 - b.clearance) * 0.8))]);
  assert(run.fastest > F.CRUISE_SPEED + 3, `riding the wave is a boost (${run.fastest.toFixed(1)} m/s)`);
  assert(f.glide > 50 && f.flap < 0.2, `and a glide (${f.glide.toFixed(0)} m)`);
  console.log(`pelican glide: tallest wave ${tallest.toFixed(1)} m, lift ${lift.toFixed(1)} m/s, ride ${run.fastest.toFixed(1)} m/s`);
} finally {
  await server.close();
}
