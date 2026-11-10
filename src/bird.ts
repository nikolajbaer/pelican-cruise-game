import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// The pelican: a brown pelican in flight, head drawn back onto its shoulders and the long bill resting on its
// neck. One merged, vertex-coloured mesh for the body and one for each half of each wing (five draw calls),
// so the wings can beat and bow. It faces -z.

type RGB = [number, number, number];

function tinted(geometry: THREE.BufferGeometry, color: RGB, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute("uv");
  g.applyMatrix4(matrix);
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set(color, i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(sx, sy, sz));

/** A flat wing panel from four corners (root front, root back, tip front, tip back), coloured root to tip. */
function panel(corners: [number, number][], root: RGB, tip: RGB): THREE.BufferGeometry {
  const [rf, rb, tf, tb] = corners;
  const geometry = new THREE.BufferGeometry();
  const at = (p: [number, number]) => [p[0], 0, p[1]];
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([...at(rf), ...at(rb), ...at(tf), ...at(rb), ...at(tb), ...at(tf)], 3));
  const dark = (c: RGB): RGB => [c[0] * 0.72, c[1] * 0.72, c[2] * 0.72];
  // The trailing edge (the flight feathers) is darker than the leading edge.
  geometry.setAttribute("color", new THREE.Float32BufferAttribute([...root, ...dark(root), ...tip, ...dark(root), ...dark(tip), ...tip], 3));
  geometry.computeVertexNormals();
  return geometry;
}

export interface Pelican {
  group: THREE.Group;
  /** `flap` 0 (gliding, wings bowed) to 1 (beating); `lift` 0 to 1 spreads the wings flat on rising air; `afloat` folds them. */
  animate(dt: number, flap: number, lift: number, afloat: boolean): void;
}

export function createPelican(): Pelican {
  const sphere = () => new THREE.SphereGeometry(1, 9, 7);
  const brown: RGB = [0.5, 0.44, 0.39];
  const cream: RGB = [0.96, 0.92, 0.8];
  const body = mergeGeometries([
    tinted(sphere(), brown, place(0, 0, 0.05, 0.2, 0.18, 0.48)),
    tinted(sphere(), [0.78, 0.74, 0.68], place(0, -0.03, 0.0, 0.17, 0.15, 0.4)),
    tinted(sphere(), cream, place(0, 0.1, -0.36, 0.09, 0.1, 0.2)),
    tinted(sphere(), [0.98, 0.9, 0.62], place(0, 0.17, -0.5, 0.105, 0.105, 0.115)),
    tinted(new THREE.ConeGeometry(0.05, 0.52, 6), [0.96, 0.74, 0.34], place(0, 0.13, -0.82, 1, 1, 0.75, -Math.PI / 2 - 0.12)),
    tinted(sphere(), [0.86, 0.48, 0.24], place(0, 0.07, -0.7, 0.04, 0.075, 0.2, -0.12)),
    tinted(new THREE.ConeGeometry(0.17, 0.32, 5), [0.3, 0.27, 0.25], place(0, 0.01, 0.62, 1, 1, 0.22, -Math.PI / 2)),
    tinted(sphere(), [0.08, 0.07, 0.07], place(0.088, 0.19, -0.54, 0.02, 0.02, 0.02)),
    tinted(sphere(), [0.08, 0.07, 0.07], place(-0.088, 0.19, -0.54, 0.02, 0.02, 0.02)),
  ]);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const wingMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const group = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(1.2);
  group.add(model);
  model.add(new THREE.Mesh(body, material));

  const wingBrown: RGB = [0.56, 0.5, 0.44];
  const innerGeometry = panel([[0, -0.19], [0, 0.24], [0.62, -0.17], [0.62, 0.21]], wingBrown, [0.5, 0.45, 0.4]);
  const outerGeometry = panel([[0, -0.17], [0, 0.21], [0.8, 0.0], [0.62, 0.17]], [0.5, 0.45, 0.4], [0.17, 0.15, 0.15]);
  const wings = [1, -1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.13, 0.09, -0.04);
    shoulder.scale.x = side;
    const inner = new THREE.Mesh(innerGeometry, wingMaterial);
    const outer = new THREE.Mesh(outerGeometry, wingMaterial);
    outer.position.x = 0.62;
    inner.add(outer);
    shoulder.add(inner);
    model.add(shoulder);
    return { inner, outer };
  });

  let phase = 0;
  let beat = 0;
  let fold = 0;
  return {
    group,
    animate(dt, flap, lift, afloat) {
      fold += ((afloat ? 1 : 0) - fold) * Math.min(1, dt * (afloat ? 5 : 9));
      beat += (flap - beat) * Math.min(1, dt * 5);
      phase += dt * Math.PI * 2 * (2.1 + 0.6 * beat);
      const stroke = Math.sin(phase) * beat;
      const follow = Math.sin(phase - 1.1) * beat;
      // Gliding, a pelican holds its wings slightly raised at the shoulder and bowed down at the wrist.
      const inner = 0.16 - 0.1 * lift + 0.62 * stroke + 0.02 * Math.sin(phase * 0.13);
      const outer = -0.34 + 0.2 * lift + 0.55 * follow;
      for (const wing of wings) {
        // Folded, the wing lies back along the body with the hand tucked forward over it.
        // (the panel is stood on edge against the flank, swept back, and the hand doubled back over the arm).
        wing.inner.rotation.set(-1.15 * fold, -1.42 * fold, inner * (1 - fold), "YXZ");
        wing.outer.rotation.set(0, 3.0 * fold, outer * (1 - fold));
        wing.outer.scale.setScalar(1 - 0.3 * fold);
      }
      // On the water it sits low, and rocks a little.
      model.position.y = -0.06 * stroke - 0.06 * fold;
      model.rotation.z = 0.05 * fold * Math.sin(phase * 0.21);
    },
  };
}
