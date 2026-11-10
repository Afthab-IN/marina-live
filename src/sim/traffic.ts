import * as THREE from 'three';
import type { Typed } from '../data/types';
import type { Grid } from '../world/sampler';

// Illustrated traffic on mapped roads. India drives on the left: on two-way roads every
// lane sits to the left of the centre line for its direction of travel.
interface Kind { name: string; len: number; w: number; h: number; colors: number[]; speed: [number, number]; share: number }
const KINDS: Kind[] = [
  { name: 'car', len: 4.3, w: 1.8, h: 1.5, colors: [0xf2f2f0, 0xc9ccd0, 0x8f979f, 0x2f3236, 0xa52a2a, 0x274a7a, 0xd8d0c0], speed: [10, 14], share: 0.42 },
  { name: 'bike', len: 1.9, w: 0.7, h: 1.3, colors: [0x26292d, 0x6b1f1f, 0x1f3f6b, 0x444444], speed: [9, 13], share: 0.27 },
  { name: 'auto', len: 2.7, w: 1.4, h: 1.7, colors: [0xf0c419, 0xe8b818], speed: [7, 10], share: 0.15 },
  { name: 'bus', len: 11.5, w: 2.6, h: 3.1, colors: [0xb8352c, 0x2d6ea8, 0x3f8f56], speed: [7, 10], share: 0.08 },
  { name: 'van', len: 5.6, w: 2.0, h: 2.3, colors: [0xe9e6de, 0xd9d2c2, 0x6f7f8c], speed: [8, 11], share: 0.08 },
];

function vehicleGeo(k: Kind) {
  const body = new THREE.BoxGeometry(k.len, k.h * 0.55, k.w).translate(0, k.h * 0.32, 0);
  let cab: THREE.BufferGeometry;
  if (k.name === 'car') cab = new THREE.BoxGeometry(k.len * 0.55, k.h * 0.42, k.w * 0.9).translate(-k.len * 0.05, k.h * 0.78, 0);
  else if (k.name === 'bike') cab = new THREE.BoxGeometry(0.5, 0.75, 0.45).translate(-0.1, 1.0, 0);
  else if (k.name === 'auto') cab = new THREE.BoxGeometry(k.len * 0.8, k.h * 0.45, k.w * 0.98).translate(-k.len * 0.05, k.h * 0.8, 0);
  else cab = new THREE.BoxGeometry(k.len * 0.98, k.h * 0.4, k.w * 0.99).translate(0, k.h * 0.8, 0);
  const pos: number[] = [], nor: number[] = [];
  for (const g of [body, cab]) {
    const ng = g.toNonIndexed();
    pos.push(...(ng.getAttribute('position').array as Float32Array));
    nor.push(...(ng.getAttribute('normal').array as Float32Array));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

function lightsGeo(k: Kind) {
  // two headlights at the front (+x) and two tail lights at the back; aTail marks the red ones
  const pos: number[] = [], tail: number[] = [];
  const quad = (x: number, z: number, red: number) => {
    const y = k.h * 0.4, s = k.name === 'bike' ? 0.12 : 0.18;
    const nx = red ? -1 : 1;
    const v = [[x, y - s, z - s], [x, y - s, z + s], [x, y + s, z + s], [x, y - s, z - s], [x, y + s, z + s], [x, y + s, z - s]];
    if (nx < 0) v.reverse();
    for (const p of v) { pos.push(...p); tail.push(red); }
  };
  const fz = k.name === 'bike' ? [0] : [-k.w * 0.32, k.w * 0.32];
  for (const z of fz) { quad(k.len / 2 + 0.02, z, 0); quad(-k.len / 2 - 0.02, z, 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aTail', new THREE.Float32BufferAttribute(tail, 1));
  return geo;
}

interface Path { pts: Float32Array; s: Float32Array; length: number; lanes: number; oneway: boolean; cls: number }
interface Car { path: number; lane: number; s: number; v: number; vmax: number; kind: number; idx: number; delay: number }

export function buildTraffic(a: Record<string, Typed>, quant: number, ter: Grid, opts: { lite: boolean }) {
  const st = a.trf_start, xz = a.trf_xz, at = a.trf_attr;
  const paths: Path[] = [];
  for (let i = 0; i < st.length - 1; i++) {
    const n = st[i + 1] - st[i];
    const pts = new Float32Array(n * 2), s = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      pts[2 * j] = xz[2 * (st[i] + j)] * quant; pts[2 * j + 1] = xz[2 * (st[i] + j) + 1] * quant;
      if (j) s[j] = s[j - 1] + Math.hypot(pts[2 * j] - pts[2 * j - 2], pts[2 * j + 1] - pts[2 * j - 1]);
    }
    paths.push({ pts, s, length: s[n - 1], cls: at[4 * i], lanes: Math.max(1, at[4 * i + 1]), oneway: at[4 * i + 2] === 1 });
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pickKind = () => { let r = rnd(); for (let k = 0; k < KINDS.length; k++) { r -= KINDS[k].share; if (r <= 0) return k; } return 0; };

  // vehicles per path and lane: denser on the trunk and primary roads
  const cars: Car[] = [];
  const counts = KINDS.map(() => 0);
  const spacing = (cls: number) => (cls <= 1 ? 26 : 40) * (opts.lite ? 2 : 1);
  paths.forEach((p, pi) => {
    for (let lane = 0; lane < p.lanes; lane++) {
      const n = Math.floor(p.length / spacing(p.cls));
      for (let i = 0; i < n; i++) {
        const kind = pickKind();
        const [v0, v1] = KINDS[kind].speed;
        const vmax = v0 + (v1 - v0) * rnd();
        cars.push({ path: pi, lane, s: (i + rnd() * 0.6) * spacing(p.cls), v: vmax, vmax, kind, idx: counts[kind]++, delay: 0 });
      }
    }
  });

  const group = new THREE.Group();
  group.name = 'traffic';
  const night = { value: 0 };
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const lightMat = new THREE.ShaderMaterial({
    uniforms: { uNight: night },
    vertexShader: /* glsl */ `attribute float aTail; varying float vTail;
void main() { vTail = aTail; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uNight; varying float vTail;
void main() { vec3 c = mix(vec3(1.0, 0.93, 0.75) * 2.2, vec3(1.0, 0.12, 0.08) * 1.4, vTail);
  gl_FragColor = vec4(c * (0.15 + uNight), 1.0); }`,
  });
  const meshes = KINDS.map((k, ki) => {
    const body = new THREE.InstancedMesh(vehicleGeo(k), bodyMat, Math.max(1, counts[ki]));
    const lights = new THREE.InstancedMesh(lightsGeo(k), lightMat, Math.max(1, counts[ki]));
    body.count = lights.count = counts[ki];
    body.castShadow = !opts.lite && k.name === 'bus';
    body.receiveShadow = false;
    body.frustumCulled = lights.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < counts[ki]; i++) body.setColorAt(i, col.setHex(k.colors[Math.floor(rnd() * k.colors.length)]));
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    group.add(body, lights);
    return { body, lights };
  });

  // lane bookkeeping for car-following: cars sorted by s per (path, lane)
  const lanes = new Map<number, Car[]>();
  for (const c of cars) {
    const key = c.path * 8 + c.lane;
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key)!.push(c);
  }
  for (const l of lanes.values()) l.sort((x, y) => x.s - y.s);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const laneW = 3.2;
  let enabled = true;
  function place(c: Car) {
    const p = paths[c.path];
    const { s, pts } = p;
    const d = Math.min(Math.max(c.s, 0), p.length);
    let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid] <= d) lo = mid; else hi = mid; }
    const t = (d - s[lo]) / Math.max(1e-6, s[hi] - s[lo]);
    const dx = pts[2 * hi] - pts[2 * lo], dz = pts[2 * hi + 1] - pts[2 * lo + 1];
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    // left of travel: (uz, -ux) in x-z; two-way roads keep left of the centre line
    const off = p.oneway ? (c.lane - (p.lanes - 1) / 2) * laneW : (c.lane + 0.5) * laneW;
    const x = pts[2 * lo] + dx * t + uz * off, z = pts[2 * lo + 1] + dz * t - ux * off;
    // grow in and out over the first and last 8 m so vehicles never pop
    const edge = Math.min(1, d / 8, (p.length - d) / 8);
    pos.set(x, ter.at(x, z) + 0.08, z);
    q.setFromAxisAngle(up, Math.atan2(-uz, ux));
    scl.setScalar(Math.max(0.001, edge));
    m.compose(pos, q, scl);
    meshes[c.kind].body.setMatrixAt(c.idx, m);
    meshes[c.kind].lights.setMatrixAt(c.idx, m);
  }

  return {
    group, count: cars.length,
    setEnabled(on: boolean) { enabled = on; group.visible = on; },
    update(dt: number, nightValue: number) {
      night.value = nightValue;
      if (!enabled) return;
      dt = Math.min(dt, 0.1);
      for (const l of lanes.values()) {
        for (let i = l.length - 1; i >= 0; i--) {
          const c = l[i];
          if (c.delay > 0) { c.delay -= dt; continue; }
          const ahead = i < l.length - 1 ? l[i + 1] : null;
          const gap = ahead && ahead.delay <= 0 ? ahead.s - KINDS[ahead.kind].len - c.s : 1e9;
          const want = gap < 4 ? 0 : gap < 14 ? c.vmax * (gap - 4) / 10 : c.vmax;
          c.v += Math.max(-6 * dt, Math.min(2.2 * dt, want - c.v));
          c.s += c.v * dt;
        }
        // vehicles that reach the end start again at the beginning after a short pause
        while (l.length && l[l.length - 1].s > paths[l[l.length - 1].path].length) {
          const c = l.pop()!;
          c.s = 0; c.v = c.vmax * 0.6; c.delay = 1 + rnd() * 6;
          l.unshift(c);
        }
        for (const c of l) {
          if (c.delay > 0) { m.compose(pos.set(0, -100, 0), q, scl.setScalar(0.001)); meshes[c.kind].body.setMatrixAt(c.idx, m); meshes[c.kind].lights.setMatrixAt(c.idx, m); continue; }
          place(c);
        }
      }
      for (const mm of meshes) { mm.body.instanceMatrix.needsUpdate = true; mm.lights.instanceMatrix.needsUpdate = true; }
    },
  };
}
