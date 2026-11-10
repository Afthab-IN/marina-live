// Senate House, University of Madras (Robert Fellowes Chisholm, built 1874 to 1879): an Indo-Saracenic hall with
// Byzantine elements in red hand-pressed brick with white dressings. Four towers with Byzantine domes mark the
// corners of the great hall and its entrances, smaller cupolas on octagonal drums line the long east and west
// sides, and the great hall in the middle is of "immense height".
//
// OSM (way 23894473) maps a clean 93.7 x 31.5 m rectangle, long side to the beach road (local +z, east).
// Google 2.5D heights put the four towers about 48 m apart, a little east of the middle, a tall western wing and a
// lower eastern one; the model follows that. Dome striping, bands and cupola count are illustrated.
import * as THREE from 'three';
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild, MatName } from '../kit';
import { Parts, archShape, flat, rng } from './_towers';
import {
  type Plan, attic, band, domeProf, edgesOf, finial, finish, gridAngle, openings, parapet, rect, roof, rotPts, shaft,
  triStats, walls,
} from './_heritage';

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const group = new THREE.Group();
  group.name = 'senate_house';
  const P = new Parts(kit);
  const rand = rng(1879);

  const ring0 = kit.ringLocal(lm);
  const th = ring0.length >= 3 ? gridAngle([ring0]) : 0;
  const ring = ring0.length >= 3 ? rotPts(ring0, th) : rect(-46.8, -15.8, 46.8, 15.8);
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const len = x1 - x0, W = (z1 - z0) / 2, zc = (z0 + z1) / 2;
  const base: Plan = { outer: rect(x0, z0, x1, z1), holes: [] };

  const H = 14.2, F1 = 7.0;
  const xa = x0 + 0.29 * len, xb = x0 + 0.795 * len;   // tower lines (2.5D)
  const TA = 3.6;                                        // tower half width
  const tz = W - TA - 0.3;                              // towers stand just inside the long faces

  // two-storey base over the whole footprint: red with white polychrome bands, arcaded verandas
  walls(P, 'red', base, 0, H);
  band(P, 'stone', base, 0, 0.8, 0.28);
  for (const y of [3.4, 10.6]) band(P, 'white', base, y, y + 0.32, 0.12);
  band(P, 'white', base, F1 - 0.25, F1 + 0.25, 0.3);
  band(P, 'white', base, H - 0.7, H, 0.45);
  const es = edgesOf(base.outer);
  const inTower = (x: number, z: number) => [xa, xb].some((tx) => Math.abs(x - tx) < TA + 0.5) && Math.abs(Math.abs(z - zc) - tz) < TA + 0.5;
  const mid = (xa + xb) / 2;
  const atDoor = (x: number) => Math.abs(x - mid) < 4.2;
  openings(P, rand, es, { y: 1.0, h: 4.4, w: 2.6, bay: 4.7, point: 1, seg: 3, lit: 0.3, frame: 'white', fw: 0.3, skip: (p) => inTower(p[0], p[1]) || atDoor(p[0]) });
  openings(P, rand, es, { y: F1 + 0.8, h: 3.8, w: 2.2, bay: 4.7, point: 1, seg: 3, lit: 0.35, skip: (p) => inTower(p[0], p[1]) || atDoor(p[0]) });

  // wings: the western one carries a third storey (2.5D about 20 m), the eastern one stays at two
  const wWest: Plan = { outer: rect(x0, z0, xa - TA, z1), holes: [] };
  const wEast: Plan = { outer: rect(xb + TA, z0, x1, z1), holes: [] };
  walls(P, 'red', wWest, H, H + 5.6);
  band(P, 'white', wWest, H + 2.6, H + 2.9, 0.12);
  band(P, 'white', wWest, H + 5.0, H + 5.6, 0.4);
  openings(P, rand, edgesOf(wWest.outer), { y: H + 0.9, h: 3.2, w: 2.0, bay: 4.7, point: 1, seg: 3, lit: 0.35, skip: (p) => Math.abs(p[0] - (xa - TA)) < 0.5 });
  parapet(P, 'red', 'white', wWest, H + 5.6, 0.9);
  roof(P, 'roofRed', wWest, H + 5.65, 0.3);
  parapet(P, 'red', 'white', wEast, H, 0.9);
  roof(P, 'roofRed', wEast, H + 0.05, 0.3);

  // the great hall between the towers: tall clerestory and a low hipped roof
  const hx0 = xa + TA - 0.4, hx1 = xb - TA + 0.4, hz = W - 2.2;
  const hall: Plan = { outer: rect(hx0, zc - hz, hx1, zc + hz), holes: [] };
  const HH = 24.0;
  walls(P, 'red', hall, H, HH);
  roof(P, 'roofRed', base, H + 0.05, 0.3); // terrace strips around the hall, under everything else
  for (const y of [H + 3.2, HH - 3.0]) band(P, 'white', hall, y, y + 0.3, 0.12);
  band(P, 'white', hall, HH - 0.6, HH, 0.4);
  openings(P, rand, edgesOf(hall.outer), { y: H + 3.9, h: 5.6, w: 2.2, bay: 4.4, point: 1, seg: 3, lit: 0.45, frame: 'white', fw: 0.25, minLen: 6 });
  {
    // hipped roof: four sloping faces up to a short ridge
    const rise = 3.4, inset = hz * 0.85;
    const a = [hx0 - 0.3, zc - hz - 0.3], b = [hx1 + 0.3, zc - hz - 0.3], c = [hx1 + 0.3, zc + hz + 0.3], d = [hx0 - 0.3, zc + hz + 0.3];
    const r0 = [hx0 + inset, zc], r1 = [hx1 - inset, zc];
    const v = (p: number[], y: number) => new THREE.Vector3(p[0], y, p[1]);
    const tris: THREE.Vector3[][] = [
      [v(a, HH), v(r0, HH + rise), v(b, HH)], [v(b, HH), v(r0, HH + rise), v(r1, HH + rise)],
      [v(c, HH), v(r1, HH + rise), v(d, HH)], [v(d, HH), v(r1, HH + rise), v(r0, HH + rise)],
      [v(b, HH), v(r1, HH + rise), v(c, HH)], [v(d, HH), v(r0, HH + rise), v(a, HH)],
    ];
    const pos: number[] = [];
    for (const t of tris) {
      // wind each face so it looks up and out
      const n = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0]));
      const ordered = n.y > 0 ? t : [t[0], t[2], t[1]];
      for (const p of ordered) pos.push(p.x, p.y, p.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    P.add('roofRed', g);
  }

  // the main entrances: a tall segmental arch at the middle of each long face
  for (const s of [1, -1]) {
    const z = zc + s * W, ang = s > 0 ? 0 : Math.PI;
    P.box('red', mid - 4.6, 0, z - s * 0.6, mid + 4.6, H + 1.6, z + s * 0.9);
    P.box('white', mid - 4.9, H + 1.1, z - s * 0.6, mid + 4.9, H + 1.7, z + s * 1.15);
    P.shape('white', archShape(7.0, 10.6, 1, 4), mid, 0.4, z + s * 0.95, ang);
    P.shape('windowLit', archShape(6.0, 10.0, 1, 4), mid, 0.4, z + s * 1.0, ang);
  }

  // four towers with striped Byzantine domes
  const domeBands: MatName[] = ['white', 'red', 'white', 'red', 'white', 'red'];
  for (const tx of [xa, xb]) for (const s of [1, -1]) {
    const tzc = zc + s * tz, top = 29.0;
    P.box('red', tx - TA, 0, tzc - TA, tx + TA, top, tzc + TA);
    for (const y of [3.4, F1 - 0.25, 10.6, H - 0.7, 17.6, 21.2, 24.8]) {
      P.box('white', tx - TA - 0.12, y, tzc - TA - 0.12, tx + TA + 0.12, y + 0.32, tzc + TA + 0.12);
    }
    P.box('white', tx - TA - 0.45, top - 0.6, tzc - TA - 0.45, tx + TA + 0.45, top + 0.2, tzc + TA + 0.45);
    const tp: Plan = { outer: rect(tx - TA, tzc - TA, tx + TA, tzc + TA), holes: [] };
    openings(P, rand, edgesOf(tp.outer), { y: H + 0.8, h: 2.4, w: 1.2, bay: 3.0, point: 1, seg: 3, lit: 0.4, margin: 0.8, skip: (p) => Math.abs(p[1] - tzc) < TA - 0.5 && Math.abs(p[0] - tx) < 1 && false });
    openings(P, rand, edgesOf(tp.outer), { y: 25.4, h: 2.6, w: 1.2, bay: 2.6, point: 1, seg: 3, lit: 0.4, margin: 0.6, frame: 'white', fw: 0.2 });
    // corner pinnacles
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const px = tx + sx * (TA - 0.1), pz = tzc + sz * (TA - 0.1);
      P.add('white', shaft(0.42, top + 0.2, top + 1.9, 6, px, pz));
      P.add('red', flat(new THREE.ConeGeometry(0.5, 1.1, 6, 1, true)).translate(px, top + 2.45, pz));
    }
    // octagonal drum and the striped dome
    const dr = TA - 0.7, d0 = top + 0.2, d1 = top + 2.8;
    P.add('red', shaft(dr, d0, d1, 8, tx, tzc));
    P.add('white', shaft(dr + 0.15, d1 - 0.35, d1 + 0.1, 8, tx, tzc));
    const ap = dr * Math.cos(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      P.shape('darkGlass', archShape(0.9, 1.6, 1, 3), tx + Math.sin(a) * (ap + 0.04), d0 + 0.45, tzc + Math.cos(a) * (ap + 0.04), a);
    }
    const prof = domeProf(dr + 0.1, 4.4, 'bulb');
    const fine: [number, number][] = [];
    for (let i = 0; i + 1 < prof.length; i++) {
      const [ra, ya] = prof[i], [rb, yb] = prof[i + 1];
      for (let k = 0; k < 2; k++) fine.push([ra + ((rb - ra) * k) / 2, ya + ((yb - ya) * k) / 2]);
    }
    fine.push(prof[prof.length - 1]);
    for (let i = 0; i + 1 < fine.length; i++) {
      const pts = [fine[i], fine[i + 1]].map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y));
      P.add(domeBands[i % domeBands.length], flat(new THREE.LatheGeometry(pts, 12, Math.PI / 12)).translate(tx, d1 + 0.1, tzc));
    }
    finial(P, 'gold', tx, d1 + 0.1 + 4.3, tzc, 1.5);
  }

  // cupolas on octagonal drums along the long sides of the wings
  for (const s of [1, -1]) {
    const z = zc + s * (W - 1.0);
    const spots = [x0 + 6, x0 + 0.5 * (xa - TA - x0) + 2, xb + TA + 0.5 * (x1 - xb - TA), x1 - 4];
    for (const x of spots) {
      const y = Math.abs(x - x0) < Math.abs(x - x1) ? H + 5.6 + 0.9 : H + 0.9;
      P.add('red', shaft(1.05, y - 0.9, y + 1.6, 8, x, z));
      P.add('white', shaft(1.25, y + 1.6, y + 1.9, 8, x, z, false));
      P.add('white', flat(new THREE.LatheGeometry(domeProf(1.2, 1.6, 'bulb').map(([r, h]) => new THREE.Vector2(Math.max(0.001, r), h)), 8, Math.PI / 8)).translate(x, y + 1.9, z));
      P.add('gold', new THREE.ConeGeometry(0.1, 0.7, 4, 1, true).translate(x, y + 3.75, z));
    }
  }
  // small domed kiosks on the hall roof corners
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    attic(P, rand, (sx > 0 ? hx1 : hx0) - 1.0, zc + sz * hz - 1.0, (sx > 0 ? hx1 : hx0) + 1.0, zc + sz * hz + 1.0, HH, HH + 1.6, { wall: 'white', roof: 'red', trim: 'white', lit: 0 });
  }

  finish(P, group, th);
  const dbg = triStats(group);
  return {
    group,
    notes: dbg + ' Footprint from OSM (way 23894473). Four domed towers, side cupolas on octagonal drums and the red brick '
      + 'with white dressings follow published descriptions; tower positions and wing heights follow Google 2.5D heights. '
      + 'Tower and dome heights, the hipped hall roof and the striped domes are illustrated.',
  };
}
