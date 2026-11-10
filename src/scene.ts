import * as THREE from "three";
import { BEACH_GLSL, WAVE_GLSL, beachHeight } from "./waves";

// Everything the pelican flies over: the sky, the sea, the beach and the dune grass. Four draw calls in all.
// Each is one mesh that follows the pelican along the shore (snapped to its own grid, so the vertices do not
// swim) and takes its shape in the vertex shader from the functions in waves.ts.

/** Where the sun stands: low over the sea, ahead and to the left. */
export const SUN_DIR = new THREE.Vector3(-0.62, 0.24, -0.74).normalize();

const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
// The sky without its clouds and sun disc: what the water reflects and what distance fades to.
vec3 skyBase(vec3 d) {
  float y = max(d.y, 0.0);
  vec3 c = mix(vec3(1.0, 0.80, 0.62), vec3(0.66, 0.77, 0.86), smoothstep(0.0, 0.2, y));
  c = mix(c, vec3(0.25, 0.47, 0.74), smoothstep(0.12, 0.8, y));
  float sd = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.52, 0.22) * pow(sd, 6.0) * 0.2 + vec3(1.0, 0.8, 0.5) * pow(sd, 120.0) * 0.3;
  return c;
}
vec3 applyFog(vec3 col, vec3 toCamera, float dist) {
  float f = 1.0 - exp(-pow(dist / 520.0, 2.0));
  return mix(col, skyBase(normalize(vec3(-toCamera.x, 0.0, -toCamera.z))), f);
}
`;

/** A tiling noise texture: r and g are two soft cloud noises, b is a web of thin ridges (the lace of sea foam). */
function makeNoiseTexture(): THREE.DataTexture {
  const size = 256;
  const lattice = (period: number, seed: number) => {
    const values = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < values.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      values[i] = s / 4294967296;
    }
    return (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const at = (ix: number, iy: number) => values[(((iy % period) + period) % period) * period + (((ix % period) + period) % period)];
      return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v;
    };
  };
  const fbm = (seed: number, base: number) => {
    const octaves = [0, 1, 2, 3].map((o) => lattice(base << o, seed + o * 77));
    return (x: number, y: number) => {
      let sum = 0, weight = 0.5;
      for (let o = 0; o < 4; o++) {
        sum += weight * octaves[o]((x * (base << o)) / size, (y * (base << o)) / size);
        weight *= 0.5;
      }
      return sum / 0.9375;
    };
  };
  const a = fbm(11, 4), b = fbm(523, 4), c = fbm(977, 8), warp = fbm(31, 4);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const w = (warp(x, y) - 0.5) * 22;
      const ridge = 1 - Math.abs(2 * c(x + w, y - w) - 1);
      data[i] = a(x, y) * 255;
      data[i + 1] = b(x, y) * 255;
      data[i + 2] = Math.pow(Math.min(1, ridge), 3) * 255;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** A flat grid on the ground plane with the given x rows and evenly spaced z columns. */
function gridGeometry(xs: number[], zMin: number, zMax: number, zStep: number): THREE.BufferGeometry {
  const cols = Math.round((zMax - zMin) / zStep) + 1;
  const positions = new Float32Array(xs.length * cols * 3);
  for (let r = 0; r < xs.length; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 3;
      positions[i] = xs[r];
      positions[i + 2] = zMin + c * zStep;
    }
  }
  const count = (xs.length - 1) * (cols - 1) * 6;
  const index = xs.length * cols > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  let k = 0;
  for (let r = 0; r < xs.length - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      // Rows run toward -x: wound so the faces look up.
      index[k++] = i; index[k++] = i + 1; index[k++] = i + cols;
      index[k++] = i + 1; index[k++] = i + cols + 1; index[k++] = i + cols;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

const OCEAN_Z_STEP = 8;
const BEACH_Z_STEP = 8;

function makeOcean(uniforms: Record<string, THREE.IUniform>): THREE.Mesh {
  // Fine rows through the surf, where the waves stand up; coarser out to sea; one last row at the horizon.
  const xs: number[] = [];
  let x = 14;
  for (; x > -120; x -= 1) xs.push(x);
  for (; x > -330; x -= 2.5) xs.push(x);
  for (let step = 3; x > -1600; x -= step, step *= 1.16) xs.push(x);
  xs.push(-7000);
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      precision highp float;
      ${WAVE_GLSL}
      varying vec2 vP;
      varying vec3 vWorld;
      varying vec3 vN;
      vec3 displaced(vec2 P) {
        vec4 a, b;
        float h = swell(P, a, b) * smoothstep(-440.0, -300.0, P.x);
        // The crest leans ahead of its base as the wave steepens: a pitching lip.
        float lean = 0.7 * a.w * a.x * a.x * b.z * (1.0 - 0.6 * a.z);
        return vec3(P.x + lean, h + chop(P) + surge(P), P.y);
      }
      void main() {
        vec2 P = (modelMatrix * vec4(position, 1.0)).xz;
        vec3 p0 = displaced(P);
        vec3 px = displaced(P + vec2(0.6, 0.0));
        vec3 pz = displaced(P + vec2(0.0, 1.5));
        vN = normalize(cross(pz - p0, px - p0));
        vP = P;
        vWorld = p0;
        gl_Position = projectionMatrix * viewMatrix * vec4(p0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${WAVE_GLSL}
      ${SKY_GLSL}
      uniform sampler2D uNoise;
      uniform vec4 uShadow;
      varying vec2 vP;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec4 a, b;
        swell(vP, a, b);
        float s = a.x, d = a.y, brk = a.z, H = a.w, xc = b.x, xb = b.y, steep = b.z;
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;

        // Wind ripples: two scrolling layers of noise tilt the normal, which is what breaks the sun into glitter.
        // (The second layer is turned and at an unrelated scale, so the texture's repeat does not show as rows.)
        vec2 rip = texture2D(uNoise, vP * 0.071 + uTime * vec2(0.012, 0.02)).rg
          + texture2D(uNoise, mat2(0.8, 0.6, -0.6, 0.8) * vP * 0.31 - uTime * vec2(0.03, 0.017)).rg - 1.0;
        vec3 N = normalize(vN + vec3(rip.x, 0.0, rip.y) * 0.3);

        // Green over the sand bars, deep blue out to sea, and light coming through the thin face of a standing wave.
        vec3 base = mix(vec3(0.10, 0.47, 0.47), vec3(0.015, 0.13, 0.23), smoothstep(-4.0, -150.0, vP.x));
        float face = s * H / HMAX;
        base += vec3(0.04, 0.40, 0.30) * pow(face, 1.3) * (0.55 + 0.45 * step(0.0, d));
        float ndl = max(dot(N, uSunDir), 0.0);
        base *= 0.72 + 0.4 * ndl;

        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 col = mix(base, skyBase(R), fres * 0.9);
        col += vec3(1.0, 0.85, 0.6) * pow(max(dot(R, uSunDir), 0.0), 220.0) * 1.3;

        // Thin water over the sand at the shoreline.
        float depth = vWorld.y - ${"0.05"} * vP.x;
        col = mix(vec3(0.62, 0.55, 0.44), col, 0.35 + 0.65 * smoothstep(0.0, 0.7, depth));

        // Foam: the tumbling front of a broken wave, the lace it leaves behind, a feather on the lip just before it
        // goes, and the edge of the wash on the sand.
        float wf = mix(0.17, 0.062, steep);
        float front = brk * smoothstep(-0.04, 0.0, d) * (1.0 - smoothstep(wf * 0.9, wf * 2.4, d));
        float trail = smoothstep(xb, xb + 10.0, vP.x) * exp(d * 6.5) * step(d, 0.0) * step(xb, xc);
        float lip = smoothstep(xb - 12.0, xb, xc) * (1.0 - brk) * pow(s, 12.0) * 0.75;
        float edge = (1.0 - smoothstep(0.0, 0.09, depth)) * 0.8;
        float amount = clamp(max(max(front, trail * 0.95), max(lip, edge)), 0.0, 1.0);
        float pattern = 0.6 * texture2D(uNoise, vP * 0.035 + vec2(uTime * 0.012, 0.0)).b + 0.4 * texture2D(uNoise, mat2(0.8, 0.6, -0.6, 0.8) * vP * 0.11 + vec2(0.0, uTime * 0.017)).b
          + 0.25 * texture2D(uNoise, vP * 0.02).r;
        float foam = smoothstep(1.0 - amount, 1.2 - amount, pattern + amount * amount * 0.4) * smoothstep(0.0, 0.08, amount);
        vec3 foamCol = mix(vec3(0.66, 0.77, 0.85), vec3(1.0, 0.97, 0.92), 0.3 + 0.7 * ndl) * (0.8 + 0.25 * pattern);
        col = mix(col, foamCol, foam);

        // The pelican's shadow.
        float sh = 1.0 - smoothstep(uShadow.z * 0.35, uShadow.z, length(vP - uShadow.xy));
        col *= 1.0 - uShadow.w * sh;

        gl_FragColor = vec4(applyFog(col, V, dist), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(gridGeometry(xs, -900, 380, OCEAN_Z_STEP), material);
  mesh.frustumCulled = false;
  return mesh;
}

function makeBeach(uniforms: Record<string, THREE.IUniform>): THREE.Mesh {
  const xs: number[] = [];
  let x = 700;
  for (let step = 40; x > 130; x -= step, step = Math.max(2.5, step * 0.86)) xs.push(x);
  for (; x >= -32; x -= 2.5) xs.push(x);
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      precision highp float;
      ${BEACH_GLSL}
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec2 P = (modelMatrix * vec4(position, 1.0)).xz;
        float h = beachH(P);
        vN = normalize(vec3(h - beachH(P + vec2(1.0, 0.0)), 1.0, h - beachH(P + vec2(0.0, 1.0))));
        vWorld = vec3(P.x, h, P.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${SKY_GLSL}
      uniform sampler2D uNoise;
      uniform vec4 uShadow;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec2 P = vWorld.xz;
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 big = texture2D(uNoise, P * 0.011).rgb;
        vec3 fine = texture2D(uNoise, P * 0.45).rgb;
        // Wind ripples in the sand tilt the normal a little.
        vec3 N = normalize(vN + vec3(fine.r - 0.5, 0.0, fine.g - 0.5) * 0.14);
        float ndl = max(dot(N, uSunDir), 0.0);

        vec3 sand = mix(vec3(0.88, 0.76, 0.56), vec3(0.97, 0.87, 0.67), fine.g);
        // Scrub on the dunes, thicker inland, and dark hills behind.
        float scrub = smoothstep(0.42, 0.62, big.r + 0.25 * fine.b) * smoothstep(24.0, 70.0, P.x) * (0.5 + 0.5 * smoothstep(60.0, 160.0, P.x));
        vec3 col = mix(sand, mix(vec3(0.47, 0.50, 0.27), vec3(0.30, 0.40, 0.24), big.g), scrub);
        col = mix(col, vec3(0.27, 0.36, 0.25), smoothstep(110.0, 300.0, P.x) * 0.85);
        // Low sun: warm where it lands, cool blue in the lee of a dune.
        col *= mix(vec3(0.50, 0.55, 0.72), vec3(1.12, 1.02, 0.88), smoothstep(0.02, 0.5, ndl));

        // Sand the last wash left wet: darker, and it mirrors the sky.
        float wet = 1.0 - smoothstep(2.0, 8.0, P.x + (big.b - 0.3) * 3.0);
        vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
        float fres = 0.12 + 0.6 * pow(1.0 - max(V.y, 0.0), 4.0);
        col = mix(col, mix(col * vec3(0.58, 0.56, 0.56), skyBase(R), fres), wet);

        float sh = 1.0 - smoothstep(uShadow.z * 0.35, uShadow.z, length(P - uShadow.xy));
        col *= 1.0 - uShadow.w * sh;
        gl_FragColor = vec4(applyFog(col, V, dist), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(gridGeometry(xs, -900, 380, BEACH_Z_STEP), material);
  mesh.frustumCulled = false;
  return mesh;
}

function makeSky(uniforms: Record<string, THREE.IUniform>): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${SKY_GLSL}
      uniform sampler2D uNoise;
      uniform float uTime;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyBase(d);
        float sd = max(dot(d, uSunDir), 0.0);
        // Soft clouds, drawn as one flat layer overhead; lit warm from below toward the sun.
        vec2 uv = d.xz / (max(d.y, 0.0) + 0.14) * 0.07 + uTime * vec2(0.0012, 0.0004);
        float n = texture2D(uNoise, uv).r * 0.65 + texture2D(uNoise, uv * 2.3 + 0.37).g * 0.35;
        float cloud = smoothstep(0.50, 0.72, n) * smoothstep(0.015, 0.2, d.y);
        vec3 cloudCol = mix(vec3(1.0, 0.80, 0.66), vec3(1.0, 0.98, 0.96), smoothstep(0.0, 0.5, d.y)) + vec3(0.25, 0.12, 0.02) * pow(sd, 8.0);
        cloudCol *= 0.82 + 0.18 * smoothstep(0.55, 0.8, n);
        col = mix(col, cloudCol, cloud * 0.85);
        col += vec3(1.0, 0.93, 0.78) * smoothstep(0.9992, 0.9996, sd) * (1.0 - cloud * 0.7);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// Dune grass: one instanced mesh of tufts. The dunes are cut into chunks along the shore; each chunk's tufts
// are placed from a seed, and a chunk that falls behind hands its instances to the next one ahead.
const GRASS_CHUNK = 48;
const GRASS_CHUNKS = 15;
const GRASS_PER_CHUNK = 130;
const GRASS_BEHIND = 3;

function makeGrass(uniforms: Record<string, THREE.IUniform>) {
  const blades = 7;
  const positions: number[] = [];
  for (let i = 0; i < blades; i++) {
    const angle = (i / blades) * Math.PI * 2 + (i % 2) * 0.4;
    const out = 0.12 + 0.5 * ((i * 37) % 11) / 11;
    const height = 0.75 + 0.5 * ((i * 53) % 7) / 7;
    const cx = Math.cos(angle), cz = Math.sin(angle);
    // A thin triangle: two points at the root, the tip leaning outward.
    positions.push(cx * 0.08 - cz * 0.07, 0, cz * 0.08 + cx * 0.07, cx * 0.08 + cz * 0.07, 0, cz * 0.08 - cx * 0.07, cx * out, height, cz * out);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      varying float vTip;
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vTip = position.y;
        // The sea breeze: tips lean inland and nod.
        float sway = sin(uTime * 1.9 + world.x * 0.35 + world.z * 0.23) * 0.12 + 0.14;
        world.x += sway * position.y * position.y;
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${SKY_GLSL}
      varying float vTip;
      varying vec3 vWorld;
      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 col = mix(vec3(0.36, 0.40, 0.20), vec3(0.90, 0.80, 0.46), clamp(vTip, 0.0, 1.0));
        gl_FragColor = vec4(applyFog(col, toCam / dist, dist), 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, GRASS_CHUNKS * GRASS_PER_CHUNK);
  mesh.frustumCulled = false;
  const held = new Array<number>(GRASS_CHUNKS).fill(Number.NaN);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const fill = (slot: number, chunk: number) => {
    let seed = (chunk * 2654435761) >>> 0;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let cx = 0, cz = 0;
    for (let i = 0; i < GRASS_PER_CHUNK; i++) {
      // Tufts grow in clumps of five, most of them on the first dunes.
      if (i % 5 === 0) {
        cx = 23 + 135 * Math.pow(rnd(), 1.6);
        cz = (chunk + rnd()) * GRASS_CHUNK;
      }
      const x = cx + (rnd() - 0.5) * 5, z = cz + (rnd() - 0.5) * 5;
      const size = (0.8 + 1.1 * rnd()) * (1 + x / 150);
      pos.set(x, beachHeight(x, z) - 0.05, z);
      quat.setFromAxisAngle(up, rnd() * Math.PI * 2);
      scale.set(size, size * (0.8 + 0.5 * rnd()), size);
      mesh.setMatrixAt(slot * GRASS_PER_CHUNK + i, matrix.compose(pos, quat, scale));
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  /** Keeps the dunes around `z` planted. */
  const update = (z: number) => {
    const last = Math.floor(z / GRASS_CHUNK) + GRASS_BEHIND;
    for (let chunk = last - GRASS_CHUNKS + 1; chunk <= last; chunk++) {
      const slot = ((chunk % GRASS_CHUNKS) + GRASS_CHUNKS) % GRASS_CHUNKS;
      if (held[slot] !== chunk) {
        held[slot] = chunk;
        fill(slot, chunk);
      }
    }
  };
  return { mesh, update };
}

export interface Seaside {
  group: THREE.Group;
  /** Advances the sea to `time` and recentres the world on the pelican. */
  update(time: number, pelican: THREE.Vector3, camera: THREE.Camera, shadow: { x: number; z: number; radius: number; strength: number }): void;
}

export function createSeaside(): Seaside {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: SUN_DIR },
    uNoise: { value: makeNoiseTexture() },
    uShadow: { value: new THREE.Vector4(0, 0, 1, 0) },
  };
  const group = new THREE.Group();
  const sky = makeSky(uniforms);
  const ocean = makeOcean(uniforms);
  const beach = makeBeach(uniforms);
  const grass = makeGrass(uniforms);
  group.add(sky, beach, ocean, grass.mesh);
  return {
    group,
    update(time, pelican, _camera, shadow) {
      uniforms.uTime.value = time;
      uniforms.uShadow.value.set(shadow.x, shadow.z, shadow.radius, shadow.strength);
      ocean.position.z = Math.round(pelican.z / OCEAN_Z_STEP) * OCEAN_Z_STEP;
      beach.position.z = Math.round(pelican.z / BEACH_Z_STEP) * BEACH_Z_STEP;
      grass.update(pelican.z);
    },
  };
}
