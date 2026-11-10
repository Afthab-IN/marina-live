// Madras High Court, Block-A main building (designed by J. W. Brassington, completed by Henry Irwin,
// inaugurated 12 July 1892). Indo-Saracenic in red: two tall storeys of pointed-arch verandas with white
// string courses, octagonal minarets with bulbous domes on the corners of the courtroom ranges, a domed
// drum over the eastern block and, at the crossing of the plan, the tower that carried the city's third
// lighthouse from 1894 until the 1970s (light about 175 ft above sea level).
//
// OSM maps that light as the "Lantern Room" (man_made=tower, way 1188619719) at the centre of this
// footprint, so the tower stands there. The separate "Old Lighthouse" (way 1188619718) is the
// free-standing 1844 Doric column about 33 m outside Block-A; it does not rise from this building and is
// not part of this model.
//
// The OSM ring (way 369960494) is a cross of courtroom ranges whose walls run about 32 degrees off the
// landmark frame, so the model is built in a wall-aligned frame and rotated back.
import * as THREE from 'three';
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild } from '../kit';
import { Parts, archShape, rng, type V2 } from './_towers';
import {
  type Plan, attic, band, chhatri, clean, corners, dome, finial, finish, gridAngle, inPlan, minaret, openings,
  parapet, planEdges, roof, rotPt, rotPts, shaft, triStats, walls,
} from './_heritage';

const LANTERN: V2 = [1043.2, -2837.2];   // OSM way 1188619719, the 1894 light (world x, z)
const EAST_DOME: V2 = [979.0, -2857.0];  // centre of the eastern courtroom block (world x, z)

// raised courtroom roofs, in metres from the tower with +x towards the eastern dome (x0, z0, x1, z1)
const ATTICS: [number, number, number, number][] = [
  [-45, -8, -21, 8],      // western range
  [15, -5.5, 45, 8.5],    // eastern corridor
  [-23, 41.5, 27, 52],    // northern range
  [-23, -51.5, 27, -41],  // southern range
  [-10, 17.5, 10, 33],    // northern link
  [-11, -32.5, 6, -21],   // southern link
];

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const group = new THREE.Group();
  group.name = 'high_court';
  const P = new Parts(kit);
  const rand = rng(1892);

  let ring = clean(kit.ringLocal(lm));
  if (ring.length < 3) ring = [[-60, -25], [60, -25], [60, 25], [-60, 25]];
  const th = gridAngle([ring]);
  const plan: Plan = { outer: rotPts(ring, th), holes: [] };
  const toPlan = (w: V2): V2 => rotPt(kit.toLocal(lm, w[0], w[1]), th);
  const [tx, tz] = toPlan(LANTERN);
  const [ex, ez] = toPlan(EAST_DOME);
  const sg = ex >= tx ? 1 : -1; // keeps the attic layout right if the frame ever flips

  const H = 14.2;  // wall head
  const F1 = 6.6;  // first floor string course

  // ranges: red walls, stone plinth, white bands, parapet and red-oxide terraces
  walls(P, 'red', plan, 0, H);
  band(P, 'stone', plan, 0, 0.9, 0.3);
  band(P, 'white', plan, F1 - 0.25, F1 + 0.3, 0.28);
  band(P, 'white', plan, H - 0.75, H, 0.42);
  parapet(P, 'red', 'white', plan, H, 1.1);
  roof(P, 'terracotta', plan, H + 0.05, 0.3);

  // verandas: pointed arches on both storeys, white heads on the ground floor arcade
  const es = planEdges(plan);
  openings(P, rand, es, { y: 1.2, h: 4.4, w: 2.2, bay: 4.6, point: 1.35, lit: 0.3, frame: 'white', fw: 0.28 });
  openings(P, rand, es, { y: F1 + 1.0, h: 4.0, w: 1.9, bay: 4.6, point: 1.35, lit: 0.35 });

  // raised courtroom roofs with clerestory lights
  for (const [a, b, c, d] of ATTICS) {
    const xa = tx + Math.min(sg * a, sg * c), xb = tx + Math.max(sg * a, sg * c);
    const za = tz + Math.min(sg * b, sg * d), zb = tz + Math.max(sg * b, sg * d);
    const pts: V2[] = [[xa, za], [xb, za], [xb, zb], [xa, zb]];
    if (!pts.every((p) => inPlan(p, plan))) continue;
    attic(P, rand, xa, za, xb, zb, H + 0.05, H + 3.1, { wall: 'red', roof: 'roofRed', trim: 'white', lit: 0.45, bay: 3.4 });
  }

  // minarets on the convex corners of the ranges (rising from the ground, engaged in the corner)
  const near = (x: number, z: number, cx: number, cz: number, r: number) => Math.hypot(x - cx, z - cz) < r;
  let nMin = 0;
  for (const c of corners(plan.outer, 6)) {
    const x = c.p[0] - c.d[0] * 0.55, z = c.p[1] - c.d[1] * 0.55;
    if (near(x, z, ex, ez, 9) || near(x, z, tx, tz, 9)) continue;
    minaret(P, x, z, { r: 1.25, y0: 0, y1: H + 3.4, sides: 8, body: 'red', bands: [H - 0.6], dome: 'roofRed', domeH: 2.7, kind: 'bulb', tip: 'gold' });
    nMin++;
  }

  // eastern block: octagonal drum with arched lights and a bulbous dome, four chhatris on the diagonals
  {
    const DR = 6.2, d0 = H + 0.1, d1 = H + 4.8;
    P.add('red', shaft(DR, d0, d1, 8, ex, ez, false));
    P.add('white', shaft(DR + 0.15, d1 - 0.45, d1 + 0.15, 8, ex, ez));
    const ap = DR * Math.cos(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4, nx = Math.sin(a), nz = Math.cos(a);
      P.shape(rand() < 0.5 ? 'windowLit' : 'darkGlass', archShape(1.5, 2.9, 1.35, 2), ex + nx * (ap + 0.05), d0 + 0.9, ez + nz * (ap + 0.05), a);
    }
    dome(P, 'roofRed', ex, d1 + 0.15, ez, DR - 0.2, 7.2, 'onion', 14);
    finial(P, 'gold', ex, d1 + 0.15 + 7.0, ez, 2.2);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      chhatri(P, ex + sx * 9.6, ez + sz * 9.6, H + 0.1, 1.3, 2.6, 'white', 'roofRed', 'gold');
    }
  }

  // the lighthouse tower at the crossing: square stage, octagonal shaft, gallery, light room and dome
  {
    const A = 6.0, b1 = 22.5;
    P.box('red', tx - A, 0, tz - A, tx + A, b1, tz + A);
    P.box('white', tx - A - 0.3, H - 0.75, tz - A - 0.3, tx + A + 0.3, H, tz + A + 0.3);
    P.box('white', tx - A - 0.35, b1 - 0.6, tz - A - 0.35, tx + A + 0.35, b1 + 0.25, tz + A + 0.35);
    P.box('terracotta', tx - A + 0.2, b1 + 0.25, tz - A + 0.2, tx + A - 0.2, b1 + 0.3, tz + A - 0.2);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      minaret(P, tx + sx * (A - 0.4), tz + sz * (A - 0.4), { r: 0.8, y0: H, y1: b1 + 3.0, sides: 8, body: 'red', bands: [b1 - 0.5], dome: 'roofRed', domeH: 1.9, kind: 'bulb', tip: 'gold' });
    }
    // paired arched windows on each face of the square stage, above the roofs
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2, nx = Math.sin(a), nz = Math.cos(a), ux = Math.cos(a), uz = -Math.sin(a);
      for (const o of [-1.9, 1.9]) {
        const x = tx + nx * (A + 0.05) + ux * o, z = tz + nz * (A + 0.05) + uz * o;
        P.shape('white', archShape(1.9, 4.4, 1.35, 2), x, H + 1.5, z, a);
        P.shape(rand() < 0.5 ? 'windowLit' : 'darkGlass', archShape(1.35, 4.0, 1.35, 2), x + nx * 0.04, H + 1.7, z + nz * 0.04, a);
      }
    }
    // octagonal shaft with white bands and a ring of tall arched openings
    const R1 = 4.3, s0 = b1 + 0.25, s1 = 34.6;
    P.add('red', shaft(R1, s0, s1, 8, tx, tz));
    P.add('white', shaft(R1 + 0.12, 27.4, 27.8, 8, tx, tz));
    P.add('white', shaft(R1 + 0.15, s1 - 0.5, s1, 8, tx, tz));
    const ap1 = R1 * Math.cos(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4, nx = Math.sin(a), nz = Math.cos(a);
      P.shape('white', archShape(1.6, 4.4, 1.35, 2), tx + nx * (ap1 + 0.04), 28.6, tz + nz * (ap1 + 0.04), a);
      P.shape(rand() < 0.4 ? 'windowLit' : 'darkGlass', archShape(1.15, 4.0, 1.35, 2), tx + nx * (ap1 + 0.08), 28.8, tz + nz * (ap1 + 0.08), a);
    }
    // gallery deck with a white balustrade (OSM maps the light room about 9.8 m across)
    P.add('white', shaft(4.9, s1, s1 + 0.45, 8, tx, tz, false));
    P.add('white', shaft(4.75, s1 + 0.45, s1 + 1.35, 8, tx, tz));
    // light room: dark glazing on every face
    const R2 = 3.3, l0 = s1 + 0.45, l1 = s1 + 4.6;
    P.add('red', shaft(R2, l0, l1, 8, tx, tz));
    const ap2 = R2 * Math.cos(Math.PI / 8), pw = 2 * R2 * Math.sin(Math.PI / 8) * 0.72;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      P.quad('darkGlass', tx + Math.sin(a) * (ap2 + 0.05), l0 + 2.2, tz + Math.cos(a) * (ap2 + 0.05), pw, 2.8, a);
    }
    P.add('white', shaft(R2 + 0.4, l1, l1 + 0.5, 8, tx, tz, false));
    const domeH = 6.4;
    dome(P, 'roofRed', tx, l1 + 0.5, tz, R2 + 0.15, domeH, 'onion', 14);
    finial(P, 'gold', tx, l1 + 0.5 + domeH - 0.2, tz, 2.6);
  }

  finish(P, group, th);
  const dbg = `[${nMin} minarets] ` + triStats(group);
  return {
    group,
    notes: dbg + ' Block-A footprint from OSM (way 369960494). The 1894 lighthouse tower stands where OSM maps its "Lantern Room" '
      + '(way 1188619719) and tops out about 48 m above ground (light about 175 ft above sea level as published). The "Old '
      + 'Lighthouse" way 1188619718 is the free-standing 1844 Doric column outside Block-A and is not modelled here. Bay '
      + 'rhythm, the raised courtroom roofs, the eastern drum dome, minaret count and the red with white trim scheme are illustrated.',
  };
}
