// Fort St George: the mapped ramparts (20 OSM rampart and bastion outlines in lm.walls) extruded as
// battered masonry walls with grassed walkways, a parapet round each top and merlons on the faces that
// look out over the moat. The moat (ground layer) and the buildings inside (generic) are not modelled
// here, except the flagstaff in front of the Secretariat's east front, facing the sea: a 150 ft (46 m)
// mast, teak from 1688 until it was replaced in 1994, flying the national flag.
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild } from '../kit';
import { type V3, Soup } from './_stadium';

const H = 8.5;          // rampart height
const BATTER = 1.6;     // inset of the top edge (battered faces)
const BASE = -3;        // walls run down into the moat / below uneven ground
const PAR_H = 1.2, PAR_T = 0.9;
const MERLON_STEP = 7.5;
/** Flagstaff, world x, z: about 14 m east of the Secretariat's central east bay (OSM way 23893614). */
const FLAG_W: [number, number] = [936, -1964];
const MAST_H = 46;

type XZ = [number, number];

/** Inset a closed polygon (counter-clockwise, interior on the left) by d with mitred, clamped corners. */
function inset(p: XZ[], d: number): XZ[] {
  const n = p.length;
  const out: XZ[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n];
    const e1x = b[0] - a[0], e1z = b[1] - a[1], e2x = c[0] - b[0], e2z = c[1] - b[1];
    const l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1;
    const n1x = -e1z / l1, n1z = e1x / l1, n2x = -e2z / l2, n2z = e2x / l2;
    const k = 1 + n1x * n2x + n1z * n2z;
    let mx = n1x + n2x, mz = n1z + n2z;
    const s = k > 0.25 ? d / k : (d * 2.5) / Math.max(1e-6, Math.hypot(mx, mz));
    mx *= s; mz *= s;
    out.push([b[0] + mx, b[1] + mz]);
  }
  return out;
}

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const T = kit.THREE;
  const group = new T.Group();
  group.name = lm.key;
  const s = new Soup();
  const ringL = kit.ringLocal(lm);
  // fort centre, to tell outward faces (merlons) from inner ones
  let cx = 0, cz = 0;
  for (const [x, z] of ringL) { cx += x; cz += z; }
  cx /= Math.max(1, ringL.length); cz /= Math.max(1, ringL.length);

  for (const w of lm.walls ?? []) {
    let p = kit.lineLocal(lm, w.pts) as XZ[];
    if (p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.5) p = p.slice(0, -1);
    if (p.length < 3) continue;
    // make it counter-clockwise in (x, z) so the interior is on the left of each edge
    let area = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) p = p.reverse();
    const q = inset(p, BATTER);
    const n = p.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = p[j][0] - p[i][0], ez = p[j][1] - p[i][1];
      const l = Math.hypot(ex, ez) || 1;
      const ox = ez / l, oz = -ex / l; // outward normal
      // footing (vertical, below ground) and the battered face
      s.quad('stone', [p[i][0], BASE, p[i][1]], [p[j][0], BASE, p[j][1]], [p[j][0], 0, p[j][1]], [p[i][0], 0, p[i][1]], [ox, 0, oz]);
      s.quad('stone', [p[i][0], 0, p[i][1]], [p[j][0], 0, p[j][1]], [q[j][0], H, q[j][1]], [q[i][0], H, q[i][1]], [ox, 0.2, oz]);
      // parapet along the top edge
      const a: V3 = [q[i][0] - ox * PAR_T / 2, H + PAR_H / 2, q[i][1] - oz * PAR_T / 2];
      const b: V3 = [q[j][0] - ox * PAR_T / 2, H + PAR_H / 2, q[j][1] - oz * PAR_T / 2];
      const ql = Math.hypot(q[j][0] - q[i][0], q[j][1] - q[i][1]);
      if (ql > 1) s.beam('stone', a, b, PAR_T, PAR_H);
      // merlons on faces that look away from the fort
      const mx = (p[i][0] + p[j][0]) / 2 - cx, mz = (p[i][1] + p[j][1]) / 2 - cz;
      if (ox * mx + oz * mz > 0 && ql > MERLON_STEP) {
        const m = Math.floor(ql / MERLON_STEP);
        for (let k = 0; k < m; k++) {
          const t = (k + 0.5) / m;
          const x = q[i][0] + (q[j][0] - q[i][0]) * t - ox * PAR_T / 2, z = q[i][1] + (q[j][1] - q[i][1]) * t - oz * PAR_T / 2;
          s.box('stone', x, H + PAR_H + 0.45, z, 2.6, 0.9, PAR_T, -Math.atan2(q[j][1] - q[i][1], q[j][0] - q[i][0]));
        }
      }
    }
    // grassed walkway on top
    const contour = q.map(([x, z]) => new T.Vector2(x, z));
    for (const [i, j, k] of T.ShapeUtils.triangulateShape(contour, [])) {
      s.triFacing('grass', [q[i][0], H, q[i][1]], [q[j][0], H, q[j][1]], [q[k][0], H, q[k][1]], [0, 1, 0]);
    }
  }

  // ---------------------------------------------------------------- flagstaff
  const [fx, fz] = kit.toLocal(lm, FLAG_W[0], FLAG_W[1]);
  s.box('stone', fx, 0.4, fz, 7, 1.6, 7);
  s.box('stone', fx, 1.6, fz, 4.6, 0.8, 4.6);
  s.box('offwhite', fx, 2.5, fz, 2.4, 1.0, 2.4);
  s.post('white', fx, fz, 3, MAST_H, 0.42, 0.16, 8);
  s.post('gold', fx, fz, MAST_H, MAST_H + 0.6, 0.3, 0.3, 6);
  // yard arm, as on the original ship's mast
  s.beam('white', [fx, MAST_H - 9, fz - 3.2], [fx, MAST_H - 9, fz + 3.2], 0.18, 0.18);
  // the tricolour, 6.3 x 4.2 m, flying to the north-west in the sea breeze, with a gentle wave
  const fly = kit.toLocal(lm, FLAG_W[0] - 50, FLAG_W[1] - 50);
  const dx0 = fly[0] - fx, dz0 = fly[1] - fz;
  const dl = Math.hypot(dx0, dz0) || 1;
  const ux = dx0 / dl, uz = dz0 / dl;
  const FL = 6.3, FH = 4.2, top = MAST_H - 0.6, segs = 8;
  const stripes = ['ochre', 'white', 'green'] as const;
  for (let k = 0; k < segs; k++) {
    const t0 = k / segs, t1 = (k + 1) / segs;
    const wv = (t: number) => Math.sin(t * Math.PI * 2.2) * 0.45 * t;
    for (let b = 0; b < 3; b++) {
      const y0 = top - (FH * b) / 3, y1 = top - (FH * (b + 1)) / 3;
      const P = (t: number, y: number): V3 => [fx + ux * (0.3 + FL * t) - uz * wv(t), y, fz + uz * (0.3 + FL * t) + ux * wv(t)];
      s.quad(stripes[b], P(t0, y0), P(t1, y0), P(t1, y1), P(t0, y1), [-uz, 0, ux], true);
    }
  }
  // Ashoka Chakra hint in the middle of the white band
  {
    const t = 0.5, y = top - FH / 2;
    const c: V3 = [fx + ux * (0.3 + FL * t) - uz * (Math.sin(t * Math.PI * 2.2) * 0.45 * t + 0.03), y, fz + uz * (0.3 + FL * t) + ux * (Math.sin(t * Math.PI * 2.2) * 0.45 * t + 0.03)];
    const r = 0.55;
    const pts: V3[] = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; pts.push([c[0] + ux * Math.cos(a) * r, y + Math.sin(a) * r, c[2] + uz * Math.cos(a) * r]); }
    for (let k = 0; k < 8; k++) s.triFacing('seatBlue', c, pts[k], pts[(k + 1) % 8], [-uz, 0, ux], true);
  }

  s.build(kit, group);
  return {
    group,
    notes: 'Ramparts extruded from the 20 mapped outlines (height 8.5 m, batter, merlons illustrated); '
      + 'flagstaff 46 m (150 ft) east of the Secretariat, flag illustrated.',
  };
}
