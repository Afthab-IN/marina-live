import * as THREE from 'three';
import type { SceneData } from '../data/types';
import type { Grid } from './sampler';

/** Illustrated rooftop water tanks (positions come from the geometry worker). */
export function buildTanks(tanks: Float32Array) {
  const n = tanks.length / 4;
  const geo = new THREE.CylinderGeometry(1, 1, 1, 7, 1, false).translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x26282b }), Math.max(1, n));
  mesh.count = n;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const r = tanks[4 * i + 3];
    p.set(tanks[4 * i], tanks[4 * i + 1], tanks[4 * i + 2]);
    s.set(r, r * 1.5, r);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.name = 'tanks';
  return { mesh, count: n, update(mpp: number) { mesh.visible = mpp < 0.9; } };
}

const BOAT_COLORS = [0x2f6db5, 0xc23b30, 0xe0b52c, 0xe9e6de, 0x3f8f56, 0x1f3f6b];
const STALL_COLORS = [0xc23b30, 0x2f6db5, 0xe0b52c, 0x3f8f56, 0xe86f2a, 0x8a3fa0];

/**
 * Illustrated beach life: fishing boats drawn up at the waterline south of the lighthouse
 * (the fishing hamlets there), and rows of food stalls behind Marina Beach that light up at night.
 */
export function buildBeach(data: SceneData, ter: Grid, coast: Grid) {
  const group = new THREE.Group();
  group.name = 'beach';
  const [x0, , x1, z1] = data.meta.frame_m;
  const light = data.landmarks.find((l) => l.key === 'lighthouse');
  const beach = data.landmarks.find((l) => l.key === 'marina_beach');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // walk west from the sea until the coast distance reaches the wanted value
  const findX = (z: number, d: number) => {
    for (let x = x1 - 2; x > x0 + 50; x -= 3) if (coast.at(x, z) < d) return x;
    return null;
  };
  const seaward = (x: number, z: number) => {
    const gx = coast.at(x + 2, z) - coast.at(x - 2, z), gz = coast.at(x, z + 2) - coast.at(x, z - 2);
    return Math.atan2(gz, gx);
  };

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();

  // boats: a tapered hull pointing out to sea
  const hull = new THREE.CylinderGeometry(1.0, 1.0, 8.6, 6, 1, false);
  hull.rotateZ(Math.PI / 2);
  hull.scale(1, 0.6, 1.05);
  hull.translate(0, 0.42, 0);
  const boatPos: [number, number, number][] = [];
  if (light) {
    for (let z = light.z + 90; z < z1 - 20; z += 5.5 + rnd() * 6) {
      const x = findX(z, -12 - rnd() * 14);
      if (x === null || rnd() < 0.25) continue;
      boatPos.push([x, z, seaward(x, z) + (rnd() - 0.5) * 0.5]);
    }
  }
  const boats = new THREE.InstancedMesh(hull, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, boatPos.length));
  boats.count = boatPos.length;
  boatPos.forEach(([x, z, a], i) => {
    p.set(x, ter.at(x, z), z);
    q.setFromAxisAngle(up, -a);
    m.compose(p, q, s);
    boats.setMatrixAt(i, m);
    boats.setColorAt(i, col.setHex(BOAT_COLORS[Math.floor(rnd() * BOAT_COLORS.length)]));
  });
  boats.castShadow = true;

  // stalls: a small kiosk with a coloured canopy, in loose rows behind the beach
  const hut = new THREE.BoxGeometry(2.6, 2.1, 2.4).translate(0, 1.05, 0);
  const canopy = new THREE.BoxGeometry(3.4, 0.25, 3.2).translate(0, 2.55, 0);
  const bulb = new THREE.BoxGeometry(0.5, 0.25, 0.5).translate(0, 2.3, 1.2);
  const stallPos: [number, number, number][] = [];
  if (beach) {
    const zA = beach.z - 1450, zB = beach.z + 1250;
    for (let z = zA; z < zB; z += 6 + rnd() * 9) {
      if (rnd() < 0.3) { z += 30 * rnd(); continue; }
      // the coast field is clamped near 190 m, so stalls sit 150 to 180 m up the beach
      const d = -150 - rnd() * 30;
      const x = findX(z, d);
      if (x === null) continue;
      const g = ter.at(x, z);
      if (g > 6) continue;
      stallPos.push([x, z, seaward(x, z)]);
    }
  }
  const k = Math.max(1, stallPos.length);
  const huts = new THREE.InstancedMesh(hut, new THREE.MeshLambertMaterial({ color: 0xe4ddd0 }), k);
  const canopies = new THREE.InstancedMesh(canopy, new THREE.MeshLambertMaterial({ color: 0xffffff }), k);
  const bulbMat = new THREE.MeshLambertMaterial({ color: 0xd9d4c4, emissive: 0xffd08a, emissiveIntensity: 0 });
  const bulbs = new THREE.InstancedMesh(bulb, bulbMat, k);
  huts.count = canopies.count = bulbs.count = stallPos.length;
  stallPos.forEach(([x, z, a], i) => {
    p.set(x, ter.at(x, z), z);
    q.setFromAxisAngle(up, -a + Math.PI / 2);
    m.compose(p, q, s);
    huts.setMatrixAt(i, m);
    canopies.setMatrixAt(i, m);
    bulbs.setMatrixAt(i, m);
    canopies.setColorAt(i, col.setHex(STALL_COLORS[Math.floor(rnd() * STALL_COLORS.length)]));
  });
  huts.castShadow = canopies.castShadow = true;
  // warm pools of light on the sand around each stall at night
  const poolMat = new THREE.ShaderMaterial({
    uniforms: { uNight: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uNight; varying vec2 vUv;
void main() { float d = length(vUv - 0.5) * 2.0; float a = pow(1.0 - smoothstep(0.0, 1.0, d), 1.6) * uNight * 1.5;
  gl_FragColor = vec4(vec3(1.0, 0.75, 0.42) * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(17, 17).rotateX(-Math.PI / 2), poolMat, k);
  pools.count = stallPos.length;
  stallPos.forEach(([x, z], i) => { p.set(x, ter.at(x, z) + 0.2, z); m.compose(p, new THREE.Quaternion(), s); pools.setMatrixAt(i, m); });
  pools.renderOrder = 2;
  for (const im of [boats, huts, canopies, bulbs, pools]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); }
  group.add(boats, huts, canopies, bulbs, pools);
  return {
    group, boats: boatPos.length, stalls: stallPos.length,
    update(night: number, mpp: number) {
      bulbMat.emissiveIntensity = night * 2.4;
      poolMat.uniforms.uNight.value = night;
      pools.visible = night > 0.02;
      group.visible = mpp < 1.6;
    },
  };
}
