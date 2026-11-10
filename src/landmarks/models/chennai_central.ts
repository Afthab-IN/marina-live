// Chennai Central (Puratchi Thalaivar Dr. M.G. Ramachandran Central): the 1873 heritage station
// building by George Harding, remodelled by Robert Fellowes Chisholm (completed 1900) who added the
// central clock tower (four faces, 136 ft / 41.5 m) and the Kerala ("Travancore") style caps on the
// main towers. Gothic and Romanesque revival, painted brick red with white trim.
// OSM does not map this block, so the 190 x 28 m footprint and the facade rhythm are illustrated:
// clock tower in the middle, twin capped towers either side of it, long two-storey arcaded wings
// and a capped tower pavilion at each end (five caps in all). Front (Poonamallee High Road) is +z.
import * as THREE from 'three';
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild, MatName } from '../kit';
import { Parts, archShape, pinnacle, rng, squareCap } from './_towers';

const FRONT = 0, BACK = Math.PI, RIGHT = Math.PI / 2, LEFT = -Math.PI / 2;

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const group = new THREE.Group();
  group.name = 'chennai_central';
  const P = new Parts(kit);
  const rand = rng(1873);
  const T = THREE;

  const HX = (lm.length ?? 190) / 2, HZ = (lm.width ?? 28) / 2;
  const lit = (p: number): MatName => (rand() < p ? 'windowLit' : 'darkGlass');

  /** A window opening with a white surround on a wall face (x, z on the face, facing ang). */
  const arch = (x: number, y: number, z: number, ang: number, w: number, h: number, point: number, open: MatName, frame = 0.32) => {
    const nx = Math.sin(ang), nz = Math.cos(ang);
    P.shape('white', archShape(w + 2 * frame, h + frame, point, 5), x + nx * 0.05, y - frame * 0.5, z + nz * 0.05, ang);
    P.shape(open, archShape(w, h, point, 5), x + nx * 0.1, y, z + nz * 0.1, ang);
  };
  /** Paired lancets under one white round-headed surround (Romanesque bifora). */
  const bifora = (x: number, y: number, z: number, ang: number, w: number, h: number, p: number) => {
    const nx = Math.sin(ang), nz = Math.cos(ang);
    const tx = Math.cos(ang), tz = -Math.sin(ang); // along the face
    P.shape('white', archShape(w, h, 1, 6), x + nx * 0.05, y, z + nz * 0.05, ang);
    const lw = w * 0.34, lh = h * 0.8;
    for (const s of [-1, 1]) {
      const ox = s * w * 0.24;
      P.shape(lit(p), archShape(lw, lh, 1.3, 4), x + tx * ox + nx * 0.1, y + h * 0.07, z + tz * ox + nz * 0.1, ang);
    }
  };
  /** Horizontal white band wrapping a box from y0 to y1, standing out by d. */
  const band = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, d: number, mat: MatName = 'white') =>
    P.box(mat, x0 - d, y0, z0 - d, x1 + d, y1, z1 + d);
  /** Parapet ring with white coping around the roof of a block, plus the roof slab. */
  const parapet = (x0: number, z0: number, x1: number, z1: number, y: number, h = 1.0) => {
    const t = 0.45;
    P.box('terracotta', x0 + t, y - 0.2, z0 + t, x1 - t, y + 0.08, z1 - t); // red-oxide terrace
    P.box('red', x0, y, z1 - t, x1, y + h, z1);
    P.box('red', x0, y, z0, x1, y + h, z0 + t);
    P.box('red', x0, y, z0 + t, x0 + t, y + h, z1 - t);
    P.box('red', x1 - t, y, z0 + t, x1, y + h, z1 - t);
    P.box('white', x0 - 0.1, y + h, z0 - 0.1, x1 + 0.1, y + h + 0.22, z0 + t + 0.1);
    P.box('white', x0 - 0.1, y + h, z1 - t - 0.1, x1 + 0.1, y + h + 0.22, z1 + 0.1);
    P.box('white', x0 - 0.1, y + h, z0 + t + 0.1, x0 + t + 0.1, y + h + 0.22, z1 - t - 0.1);
    P.box('white', x1 - t - 0.1, y + h, z0 + t + 0.1, x1 + 0.1, y + h + 0.22, z1 - t - 0.1);
  };
  /** Square tower: shaft, white bands, cornice and a Travancore cap with a gold finial. */
  const tower = (cx: number, cz: number, a: number, top: number, bands: number[], capH: number, finial: number) => {
    P.box('red', cx - a, 0, cz - a, cx + a, top, cz + a);
    for (const y of bands) band(cx - a, cz - a, cx + a, cz + a, y, y + 0.5, 0.32); // wraps the piers (a + 0.15)
    band(cx - a, cz - a, cx + a, cz + a, top, top + 0.55, 0.45);
    // corner piers that run up the shaft
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = cx + sx * (a - 0.35), pz = cz + sz * (a - 0.35);
      P.box('red', px - 0.5, 0, pz - 0.5, px + 0.5, top, pz + 0.5);
    }
    P.add('roofRed', squareCap(a + 0.25, capH, 1.45, 0.25).translate(cx, top + 0.55, cz));
    const fy = top + 0.55 + capH;
    P.add('gold', new T.SphereGeometry(0.32, 8, 6).translate(cx, fy + 0.15, cz));
    P.add('gold', new T.ConeGeometry(0.12, finial, 6).translate(cx, fy + 0.3 + finial / 2, cz));
  };

  const Y1 = 7.1;    // first floor string course
  const Y2 = 13.9;   // wing cornice
  const WING_H = 14.6;
  const ZR = -3.5;   // back wall of the wings' two-storey front range
  const REAR_H = 8.4; // concourse range behind it

  // wings (two storeys, arcaded)
  const CX = 24, EX = HX - 13; // central block half width, start of the end pavilions
  const bays = 11, bw = (EX - CX) / bays;
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? CX : -EX, x1 = s > 0 ? EX : -CX;
    // two-storey front range, single-storey concourse range behind it
    P.box('red', x0, 0, ZR, x1, WING_H, HZ);
    P.box('red', x0, 0, -HZ, x1, REAR_H, ZR);
    P.box('stone', x0, 0, -HZ - 0.2, x1, 0.6, HZ + 0.25);
    band(x0, -HZ, x1, HZ, Y1, Y1 + 0.5, 0.3);
    band(x0, ZR, x1, HZ, Y2, WING_H, 0.45);
    band(x0, -HZ, x1, ZR, REAR_H - 0.5, REAR_H, 0.35);
    parapet(x0, ZR, x1, HZ, WING_H);
    parapet(x0, -HZ, x1, ZR + 0.45, REAR_H, 0.8);
    for (let i = 0; i <= bays; i++) {
      const x = x0 + i * bw;
      // pilasters and pinnacles on the front
      P.box('red', x - 0.4, 0.6, HZ, x + 0.4, Y2, HZ + 0.35);
      if (i > 0 && i < bays) {
        const pn = pinnacle(x, HZ - 0.2, 0.4, WING_H, WING_H + 2.0, 1.1);
        P.add('red', pn.shaft).add('white', pn.top);
      }
      if (i === bays) continue;
      const xc = x + bw / 2;
      // front: ground floor arcade and first floor paired windows
      arch(xc, 0.6, HZ, FRONT, 3.1, 5.4, 1.3, 'windowLit');
      bifora(xc, 8.3, HZ, FRONT, 3.3, 4.6, 0.5);
      // back (platform side): concourse windows and the first floor above the concourse roof
      P.quad(lit(0.5), xc, 3.6, -HZ - 0.05, 1.9, 3.6, BACK);
      P.quad(lit(0.4), xc, 11.2, ZR - 0.05, 1.9, 3.0, BACK);
    }
  }

  // central block
  const CZ = HZ + 1.2, CH = 18.5;
  P.box('red', -CX, 0, -HZ, CX, CH, CZ);
  P.box('stone', -CX, 0, -HZ - 0.2, CX, 0.6, CZ + 0.25);
  band(-CX, -HZ, CX, CZ, Y1, Y1 + 0.5, 0.3);
  band(-CX, -HZ, CX, CZ, Y2, Y2 + 0.5, 0.3);
  band(-CX, -HZ, CX, CZ, CH - 0.6, CH, 0.45);
  parapet(-CX, -HZ, CX, CZ, CH);
  for (const s of [-1, 1]) {
    for (const xc of [7.9, 13.0]) {
      const x = s * xc;
      arch(x, 0.6, CZ, FRONT, 3.3, 5.8, 1.3, 'windowLit');
      bifora(x, 8.3, CZ, FRONT, 3.4, 4.6, 0.55);
      for (const o of [-0.95, 0, 0.95]) P.shape(lit(0.5), archShape(0.7, 2.1, 1, 3), x + o, 15.0, CZ + 0.08, FRONT);
    }
    for (let i = 0; i < 8; i++) {
      const x = s * (3 + i * 2.6);
      P.quad(lit(0.5), x, 3.6, -HZ - 0.05, 1.6, 3.6, BACK);
      P.quad(lit(0.4), x, 10.4, -HZ - 0.05, 1.6, 3.0, BACK);
      P.quad(lit(0.3), x, 16.0, -HZ - 0.05, 1.2, 1.8, BACK);
    }
    // pinnacles at the corners of the central block
    for (const z of [CZ - 0.25, -HZ + 0.25]) {
      const pn = pinnacle(s * (CX - 0.25), z, 0.45, CH, CH + 2.4, 1.3);
      P.add('red', pn.shaft).add('white', pn.top);
    }
  }

  // twin towers beside the clock tower
  const FA = 3.4, FCZ = CZ + 0.5 - FA;
  for (const s of [-1, 1]) {
    const cx = s * 19.6;
    tower(cx, FCZ, FA, 24.4, [Y1, Y2, CH - 0.5], 5.2, 0.9);
    for (const [ang, fx, fz] of [[FRONT, 0, FA], [s > 0 ? RIGHT : LEFT, s * FA, 0], [BACK, 0, -FA]] as const) {
      const x = cx + fx, z = FCZ + fz;
      arch(x, 19.4, z, ang, 1.5, 3.6, 1.35, lit(0.6), 0.25);
      if (ang === FRONT) {
        arch(x, 0.6, z, ang, 2.6, 5.6, 1.3, 'windowLit');
        arch(x, 8.6, z, ang, 1.4, 3.8, 1.3, lit(0.5), 0.25);
        arch(x, 14.8, z, ang, 1.1, 2.6, 1.3, lit(0.5), 0.22);
      }
    }
  }

  // end pavilions with their towers
  const EH = 17.5, EZ = HZ + 0.8;
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? EX : -HX, x1 = s > 0 ? HX : -EX;
    P.box('red', x0, 0, -HZ, x1, EH, EZ);
    P.box('stone', x0 - 0.2, 0, -HZ - 0.2, x1 + 0.2, 0.6, EZ + 0.25);
    band(x0, -HZ, x1, EZ, Y1, Y1 + 0.5, 0.3);
    band(x0, -HZ, x1, EZ, Y2, Y2 + 0.5, 0.3);
    band(x0, -HZ, x1, EZ, EH - 0.6, EH, 0.45);
    parapet(x0, -HZ, x1, EZ, EH);
    const ea = 4.3, ecx = s * (HX - 6.5), ecz = EZ + 0.4 - ea;
    tower(ecx, ecz, ea, 23.2, [Y1, Y2, EH - 0.5], 5.0, 0.8);
    // tower front: big arch, windows, belfry openings on three sides
    arch(ecx, 0.6, ecz + ea, FRONT, 3.0, 5.8, 1.3, 'windowLit');
    arch(ecx, 8.4, ecz + ea, FRONT, 1.6, 4.0, 1.3, lit(0.5), 0.25);
    for (const [ang, fx, fz] of [[FRONT, 0, ea], [s > 0 ? RIGHT : LEFT, s * ea, 0], [BACK, 0, -ea]] as const) {
      const x = ecx + fx, z = ecz + fz;
      for (const o of [-0.95, 0.95]) {
        const ox = ang === FRONT || ang === BACK ? o : 0, oz = ang === FRONT || ang === BACK ? 0 : o;
        arch(x + ox, 18.4, z + oz, ang, 1.1, 3.3, 1.35, lit(0.5), 0.22);
      }
    }
    // pavilion end face: two windows per floor
    const xe = s * HX;
    for (const z of [-8, -2, 4]) {
      arch(xe, 1.0, z, s > 0 ? RIGHT : LEFT, 2.0, 4.6, 1.3, lit(0.5), 0.28);
      arch(xe, 8.6, z, s > 0 ? RIGHT : LEFT, 1.7, 4.0, 1.3, lit(0.45), 0.28);
    }
    // the strips of pavilion front either side of its tower
    for (const xs of [s * (EX + 1.0), s * (HX - 1.0)]) {
      arch(xs, 0.6, EZ, FRONT, 1.3, 4.6, 1.3, 'windowLit', 0.22);
      arch(xs, 8.4, EZ, FRONT, 1.2, 3.8, 1.3, lit(0.5), 0.22);
    }
    for (const x of [s * (HX - 3), s * (HX - 10)]) {
      P.quad(lit(0.5), x, 3.6, -HZ - 0.05, 1.6, 3.6, BACK);
      P.quad(lit(0.4), x, 10.4, -HZ - 0.05, 1.6, 3.0, BACK);
    }
    for (const x of [s * (HX - 0.25), s * (EX + 0.25)]) for (const z of [EZ - 0.25, -HZ + 0.25]) {
      const pn = pinnacle(x, z, 0.45, EH, EH + 2.2, 1.2);
      P.add('red', pn.shaft).add('white', pn.top);
    }
  }

  // the clock tower (136 ft)
  const KA = 4.3, KCZ = CZ + 1.0 - KA, KTOP = 29.4;
  P.box('red', -KA, 0, KCZ - KA, KA, KTOP, KCZ + KA);
  for (const y of [Y1, Y2, CH - 0.5, 24.6]) band(-KA, KCZ - KA, KA, KCZ + KA, y, y + 0.5, 0.36); // wraps the piers (KA + 0.2)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = sx * (KA - 0.4), pz = KCZ + sz * (KA - 0.4);
    P.box('red', px - 0.6, 0, pz - 0.6, px + 0.6, KTOP, pz + 0.6);
  }
  // main entrance and the openings up the shaft
  arch(0, 0, KCZ + KA, FRONT, 4.4, 8.0, 1.3, 'windowLit', 0.45);
  bifora(0, 9.0, KCZ + KA + 0.05, FRONT, 3.6, 4.4, 0.6);
  for (const [ang, fx, fz] of [[FRONT, 0, KA], [RIGHT, KA, 0], [LEFT, -KA, 0], [BACK, 0, -KA]] as const) {
    const x = fx, z = KCZ + fz;
    const tx = Math.cos(ang), tz = -Math.sin(ang);
    for (const o of [-1.2, 1.2]) arch(x + tx * o, 19.6, z + tz * o, ang, 1.3, 4.4, 1.35, lit(0.4), 0.25);
    if (ang !== FRONT) arch(x, 9.4, z, ang, 1.6, 3.6, 1.3, lit(0.5), 0.25);
  }
  // clock stage: slightly wider block with a clock on each face
  const SA = KA + 0.35, S0 = KTOP, S1 = KTOP + 4.6;
  P.box('red', -SA, S0, KCZ - SA, SA, S1, KCZ + SA);
  band(-SA, KCZ - SA, SA, KCZ + SA, S0, S0 + 0.45, 0.15);
  band(-SA, KCZ - SA, SA, KCZ + SA, S1, S1 + 0.6, 0.45);
  const cy = (S0 + S1) / 2 + 0.15;
  const hands = (ang: number, x: number, z: number) => {
    for (const [len, w, th] of [[1.15, 0.22, (10 + 10 / 60) / 12], [1.6, 0.14, 10 / 60]] as const) {
      const g = new T.BoxGeometry(w, len, 0.06).translate(0, len / 2 - 0.15, 0);
      g.rotateZ(-th * Math.PI * 2);
      g.rotateY(ang);
      g.translate(x, cy, z);
      P.add('black', g);
    }
  };
  for (const [ang, fx, fz] of [[FRONT, 0, SA], [RIGHT, SA, 0], [LEFT, -SA, 0], [BACK, 0, -SA]] as const) {
    const nx = Math.sin(ang), nz = Math.cos(ang);
    const x = fx, z = KCZ + fz;
    P.quad('white', x + nx * 0.06, cy, z + nz * 0.06, 4.3, 4.3, ang);
    const ring = new T.RingGeometry(1.8, 2.0, 24).rotateY(ang).translate(x + nx * 0.1, cy, z + nz * 0.1);
    P.add('black', ring);
    P.add('clockFace', new T.CircleGeometry(1.8, 24).rotateY(ang).translate(x + nx * 0.1, cy, z + nz * 0.1));
    hands(ang, x + nx * 0.16, z + nz * 0.16);
  }
  // corner pinnacles around the cap and the cap itself (top of the finial at 136 ft)
  const capY = S1 + 0.6, capH = 41.45 - 1.35 - capY;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pn = pinnacle(sx * (SA - 0.1), KCZ + sz * (SA - 0.1), 0.6, capY, capY + 1.9, 1.5);
    P.add('red', pn.shaft).add('white', pn.top);
  }
  P.add('roofRed', squareCap(SA - 0.55, capH, 1.5, 0.3).translate(0, capY, KCZ));
  P.add('gold', new T.SphereGeometry(0.38, 8, 6).translate(0, capY + capH + 0.2, KCZ));
  P.add('gold', new T.ConeGeometry(0.13, 0.95, 6).translate(0, capY + capH + 0.4 + 0.475, KCZ));

  P.build(group);
  return {
    group,
    notes: 'Illustrated footprint (190 x 28 m). Clock tower 136 ft with four faces as published; five capped towers. '
      + 'Bay rhythm, twin and end tower heights, the red-oxide terraces and cap colour are illustrated.',
  };
}
