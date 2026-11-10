import * as THREE from "three";
import { createSoundscape } from "./audio";
import { createPelican } from "./bird";
import { CRUISE_SPEED, TOP_SPEED, createFlight, stepFlight } from "./flight";
import { SUN_DIR, createSeaside } from "./scene";
import { oceanHeight } from "./waves";

// Pelican Glide: fly a pelican along a beach break and ride the air in front of the waves. This file is the
// page: the renderer, the touch stick, the chase camera and the few numbers on screen.

const canvas = document.getElementById("view") as HTMLCanvasElement;
const coarse = matchMedia("(pointer: coarse)").matches;
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: pixelRatio < 2, powerPreference: "high-performance" });
renderer.setPixelRatio(pixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);
const seaside = createSeaside();
const pelican = createPelican();
scene.add(seaside.group, pelican.group);
const sun = new THREE.DirectionalLight(0xffe2bd, 2.4);
sun.position.copy(SUN_DIR);
scene.add(sun, new THREE.HemisphereLight(0xcfe2ff, 0x4f8a86, 1.5));

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// --- Input: touch anywhere and drag (a stick that appears under the thumb), or the arrow keys / WASD.
const stickEl = document.getElementById("stick") as HTMLElement;
const knobEl = stickEl.firstElementChild as HTMLElement;
const STICK_RADIUS = 58;
const stick = { id: -1, x: 0, y: 0, ox: 0, oy: 0 };
const keys = new Set<string>();
const sound = createSoundscape();
let started = false;

function begin() {
  try {
    sound.start();
  } catch {
    // A browser that will not give us sound still gets the game.
  }
  if (started) return;
  started = true;
  document.getElementById("title")!.classList.add("hidden");
  document.getElementById("stats")!.classList.remove("hidden");
}

canvas.addEventListener("pointerdown", (event) => {
  begin();
  if (stick.id !== -1) return;
  stick.id = event.pointerId;
  stick.ox = event.clientX;
  stick.oy = event.clientY;
  stick.x = stick.y = 0;
  canvas.setPointerCapture(event.pointerId);
  stickEl.style.transform = `translate(${stick.ox}px,${stick.oy}px)`;
  knobEl.style.transform = "";
  stickEl.style.opacity = "1";
});
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== stick.id) return;
  let dx = event.clientX - stick.ox, dy = event.clientY - stick.oy;
  const length = Math.hypot(dx, dy);
  if (length > STICK_RADIUS) {
    // Past the rim the stick's centre is dragged along, so the thumb never has to come back far to reverse.
    stick.ox += (dx / length) * (length - STICK_RADIUS);
    stick.oy += (dy / length) * (length - STICK_RADIUS);
    dx = event.clientX - stick.ox;
    dy = event.clientY - stick.oy;
    stickEl.style.transform = `translate(${stick.ox}px,${stick.oy}px)`;
  }
  stick.x = dx / STICK_RADIUS;
  stick.y = -dy / STICK_RADIUS;
  knobEl.style.transform = `translate(${dx}px,${dy}px)`;
});
const release = (event: PointerEvent) => {
  if (event.pointerId !== stick.id) return;
  stick.id = -1;
  stick.x = stick.y = 0;
  stickEl.style.opacity = "0";
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("keydown", (event) => {
  if (event.key.startsWith("Arrow") || "wasd".includes(event.key.toLowerCase())) {
    begin();
    keys.add(event.key.toLowerCase());
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());
const held = (...names: string[]) => (names.some((name) => keys.has(name)) ? 1 : 0);

const muteEl = document.getElementById("mute") as HTMLButtonElement;
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows: nothing is kept, and that is fine.
  }
};
let muted = stored("pelican-muted") === "1";
const showMuted = () => {
  muteEl.classList.toggle("off", muted);
  sound.setMuted(muted);
};
showMuted();
muteEl.addEventListener("click", () => {
  muted = !muted;
  store("pelican-muted", muted ? "1" : "0");
  begin();
  showMuted();
});

// --- The flight.
const flight = createFlight();
flight.best = Number(stored("pelican-best")) || 0;
let savedBest = flight.best;
const glideEl = document.getElementById("glide")!.firstChild as Text;
const bestEl = document.getElementById("best")!;
const liftEl = document.querySelector("#lift i") as HTMLElement;
let hudTimer = 0;

const cam = { yaw: 0, pos: new THREE.Vector3(), ready: false, fov: 62, liftShown: 0 };
const target = new THREE.Vector3();
const look = new THREE.Vector3();
const position = new THREE.Vector3();
let time = 0;
let last = performance.now();
let slowFor = 0;
let frameMs = 16;

function frame(now: number) {
  requestAnimationFrame(frame);
  const elapsed = now - last;
  last = now;
  const dt = Math.min(0.05, elapsed / 1000);
  time += dt;

  // Until the first touch the pelican flies itself: a lazy weave along the break.
  const auto = !started;
  const steer = auto ? 0.25 * Math.sin(time * 0.35) : Math.max(-1, Math.min(1, stick.x + held("arrowright", "d") - held("arrowleft", "a")));
  const pitch = auto ? Math.max(-0.4, Math.min(0.4, (6 - flight.clearance) * 0.1)) : Math.max(-1, Math.min(1, stick.y + held("arrowup", "w") - held("arrowdown", "s")));
  stepFlight(flight, steer, pitch, time, dt);

  position.set(flight.x, flight.y, flight.z);
  pelican.group.position.copy(position);
  const boost = Math.min(1, Math.max(0, (flight.speed - CRUISE_SPEED) / (TOP_SPEED - CRUISE_SPEED)));
  // Nose down a touch when it is drawing speed from the wave.
  pelican.group.rotation.set(flight.climb - 0.1 * Math.min(1, Math.max(0, flight.lift) / 3), -flight.heading, -flight.bank, "YXZ");
  pelican.animate(dt, flight.flap, Math.min(1, Math.max(0, flight.lift) / 2.5));

  // Chase camera: behind and above, swinging round more slowly than the bird turns, never under the water.
  cam.yaw += (flight.heading - cam.yaw) * (1 - Math.exp(-dt * 2.6));
  const portrait = camera.aspect < 1;
  const back = (portrait ? 7.6 : 6.0) + 1.5 * boost;
  target.set(flight.x - Math.sin(cam.yaw) * back, flight.y + 2.8 + 0.5 * boost, flight.z + Math.cos(cam.yaw) * back);
  if (!cam.ready) {
    cam.pos.copy(target);
    cam.ready = true;
  }
  cam.pos.lerp(target, 1 - Math.exp(-dt * 5));
  cam.pos.y = Math.max(cam.pos.y, oceanHeight(cam.pos.x, cam.pos.z, time) + 0.8);
  camera.position.copy(cam.pos);
  look.set(flight.x + Math.sin(cam.yaw) * 9, flight.y - 0.2, flight.z - Math.cos(cam.yaw) * 9);
  camera.lookAt(look);
  camera.rotateZ(-flight.bank * 0.22);
  const fov = (portrait ? 76 : 60) + 13 * boost;
  cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 3));
  if (Math.abs(camera.fov - cam.fov) > 0.02) {
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
  }

  seaside.update(time, position, camera, {
    x: flight.x,
    z: flight.z,
    radius: 1.3 + flight.clearance * 0.22,
    strength: 0.3 * Math.exp(-flight.clearance / 9),
  });
  renderer.render(scene, camera);

  const nearSurf = Math.exp(-Math.max(0, flight.clearance) / 22) * Math.exp(-Math.pow((flight.x + 45) / 90, 2));
  sound.update(boost * 0.8 + 0.2, nearSurf, time);

  cam.liftShown += (Math.min(1, Math.max(0, flight.lift) / 3) - cam.liftShown) * (1 - Math.exp(-dt * 6));
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.1;
    glideEl.data = String(Math.round(flight.glide));
    bestEl.textContent = flight.best >= 50 ? `best ${Math.round(flight.best)} m` : "";
    liftEl.style.width = `${Math.round(cam.liftShown * 100)}%`;
    if (flight.best > savedBest + 25) {
      savedBest = flight.best;
      store("pelican-best", String(Math.round(savedBest)));
    }
  }

  // A phone that cannot keep up gets fewer pixels, a step at a time.
  if (elapsed < 200) frameMs += (elapsed - frameMs) * 0.05;
  slowFor = frameMs > 24 ? slowFor + dt : 0;
  if (slowFor > 2.5 && pixelRatio > (coarse ? 0.75 : 1)) {
    pixelRatio = Math.max(coarse ? 0.75 : 1, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio);
    resize();
    slowFor = 0;
    frameMs = 16;
  }
}
requestAnimationFrame(frame);

// For poking at from the console.
(window as unknown as { pelican: unknown }).pelican = { flight, renderer, setTime: (value: number) => (time = value) };
