import * as THREE from 'three';
import { along, type TrackPath } from '../world/rail';

// Illustrated trains on mapped track. MRTS: 9-car EMUs; Central: a long-distance rake of 18 coaches.
interface Spec { cars: number; carLen: number; gap: number; vmax: number; dwell: number; body: number; band: number; roof: number }
const SPECS: Record<string, Spec> = {
  mrts: { cars: 9, carLen: 20.6, gap: 0.8, vmax: 15, dwell: 22, body: 0xeeeae2, band: 0x2f5fa8, roof: 0x9ba0a4 },
  central: { cars: 18, carLen: 23.5, gap: 1.0, vmax: 11, dwell: 70, body: 0x2c4f8f, band: 0xe8dcc0, roof: 0x7b7f82 },
};

function carGeometry(spec: Spec, len: number) {
  // body, a window band and a roof, with vertex colours; the window band also lights up at night
  const parts: [THREE.BufferGeometry, number, number][] = [
    [new THREE.BoxGeometry(len, 2.4, 3.1).translate(0, 1.2 + 0.9, 0), spec.body, 0],
    [new THREE.BoxGeometry(len * 0.94, 0.85, 3.14).translate(0, 2.55, 0), 0x2a333b, 1],
    [new THREE.BoxGeometry(len * 0.97, 0.3, 2.9).translate(0, 3.45, 0), spec.roof, 0],
    [new THREE.BoxGeometry(len * 0.98, 0.25, 3.16).translate(0, 1.55, 0), spec.band, 0],
    [new THREE.BoxGeometry(len * 0.8, 0.6, 2.4).translate(0, 0.6, 0), 0x333333, 0],
  ];
  const pos: number[] = [], nor: number[] = [], col: number[] = [], win: number[] = [];
  for (const [g, hex, w] of parts) {
    const ng = g.toNonIndexed();
    const c = new THREE.Color(hex);
    const P = ng.getAttribute('position').array, N = ng.getAttribute('normal').array;
    for (let i = 0; i < P.length / 3; i++) {
      pos.push(P[3 * i], P[3 * i + 1], P[3 * i + 2]); nor.push(N[3 * i], N[3 * i + 1], N[3 * i + 2]);
      col.push(c.r, c.g, c.b); win.push(w);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aWin', new THREE.Float32BufferAttribute(win, 1));
  return geo;
}

function trainMaterial(night: { value: number }) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = night;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aWin;\nvarying float vWin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vWin;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vWin * uNight * vec3(1.0, 0.86, 0.62) * 1.2;');
  };
  m.customProgramCacheKey = () => 'train-v1';
  return m;
}

/** Trapezoidal run of distance D: returns [duration, position at time t]. */
function run(D: number, vmax: number, acc: number) {
  const ta = vmax / acc, da = 0.5 * acc * ta * ta;
  if (2 * da >= D) {
    const t1 = Math.sqrt(D / acc);
    return { dur: 2 * t1, at: (t: number) => (t < t1 ? 0.5 * acc * t * t : D - 0.5 * acc * (2 * t1 - t) ** 2) };
  }
  const tc = (D - 2 * da) / vmax;
  return {
    dur: 2 * ta + tc,
    at: (t: number) => (t < ta ? 0.5 * acc * t * t : t < ta + tc ? da + vmax * (t - ta) : D - 0.5 * acc * (2 * ta + tc - t) ** 2),
  };
}

export function buildTrains(paths: TrackPath[], night: { value: number }) {
  const group = new THREE.Group();
  group.name = 'trains';
  const mat = trainMaterial(night);
  const trains = paths.map((p, idx) => {
    const spec = SPECS[p.key.startsWith('mrts') ? 'mrts' : 'central'];
    const trainLen = spec.cars * (spec.carLen + spec.gap);
    const mesh = new THREE.InstancedMesh(carGeometry(spec, spec.carLen), mat, spec.cars);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    // timeline: run from stop to stop (head position), dwelling at each, then leave the frame
    const segs: { t0: number; t1: number; s0: number; s1: number; at?: (t: number) => number }[] = [];
    let t = 0, s = p.key === 'central' ? trainLen : -20;
    const targets = p.stops.map((st) => st.s + trainLen / 2).filter((v) => v > s + 30 && v < p.length);
    if (p.key === 'central') { segs.push({ t0: 0, t1: spec.dwell, s0: s, s1: s }); t = spec.dwell; }
    for (const target of [...targets, p.length + trainLen + 20]) {
      const r = run(target - s, spec.vmax, 0.7);
      segs.push({ t0: t, t1: t + r.dur, s0: s, s1: target, at: r.at });
      t += r.dur;
      s = target;
      if (target < p.length) { segs.push({ t0: t, t1: t + spec.dwell, s0: s, s1: s }); t += spec.dwell; }
    }
    const cycle = t + 25 + idx * 17;
    return { p, spec, mesh, segs, cycle, offset: idx * 140, trainLen };
  });

  const head = new THREE.Vector3(), tail = new THREE.Vector3(), mid = new THREE.Vector3();
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0);
  const xAxis = new THREE.Vector3(1, 0, 0), dir = new THREE.Vector3();
  return {
    group,
    update(time: number) {
      for (const tr of trains) {
        const tau = (time + tr.offset) % tr.cycle;
        const seg = tr.segs.find((g) => tau >= g.t0 && tau < g.t1);
        const sHead = seg ? (seg.at ? seg.s0 + seg.at(tau - seg.t0) : seg.s0) : -1e4;
        const { spec, p } = tr;
        for (let c = 0; c < spec.cars; c++) {
          const front = sHead - c * (spec.carLen + spec.gap);
          const back = front - spec.carLen;
          if (back < 0 || front > p.length) { m.compose(zero, qt, zero); tr.mesh.setMatrixAt(c, m); continue; }
          along(p, front, head);
          along(p, back, tail);
          mid.addVectors(head, tail).multiplyScalar(0.5);
          dir.subVectors(head, tail).normalize();
          qt.setFromUnitVectors(xAxis, dir);
          m.compose(mid, qt, one);
          tr.mesh.setMatrixAt(c, m);
        }
        tr.mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
