// LIC Building, Anna Salai (completed 1959; India's tallest building when it opened).
// A modernist slab, 54 m to the roof structures: solid concrete end walls on the short sides and
// strip-glazed long faces (front to Anna Salai, local +z, and rear), a recessed glazed ground floor
// on columns, and the LIC name board on the roof.
import * as THREE from 'three';
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild } from '../kit';
import { Parts, rng } from './_towers';

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const group = new THREE.Group();
  group.name = 'lic_building';
  const P = new Parts(kit);
  const rand = rng(1959);

  // footprint (OSM way 1110170916 is a clean 49.1 x 19.8 m rectangle)
  const ring = kit.ringLocal(lm);
  let hx = (lm.length ?? 49.1) / 2, hz = (lm.width ?? 19.8) / 2;
  if (ring.length >= 4) {
    hx = Math.max(...ring.map((p) => Math.abs(p[0])));
    hz = Math.max(...ring.map((p) => Math.abs(p[1])));
  }

  const GF = 5.2;          // tall glazed ground floor
  const FH = 3.55;         // typical floor
  const NF = 12;           // floors above the ground floor (13 levels)
  const roofY = GF + NF * FH; // 47.8 m; top floor level 44 m as published
  const wallT = 1.5;       // solid end walls
  const gx = hx - wallT;   // half length of the glazed faces
  const gz = hz - 0.55;    // glass line, recessed behind the end walls

  // solid end walls (short sides), standing proud of the glass and above the roof as a frame
  for (const s of [-1, 1]) {
    P.box('offwhite', s * gx, 0, -hz, s * hx, roofY + 1.7, hz);
    // a narrow stair window strip down the middle of each end wall
    for (let k = 0; k < NF; k++) {
      const y = GF + k * FH + FH * 0.55;
      P.quad(rand() < 0.5 ? 'windowLit' : 'darkGlass', s * (hx + 0.04), y, 0, 1.1, 1.7, s * Math.PI / 2);
    }
    // two shallow vertical ribs that catch the light on the end walls
    for (const z of [-hz * 0.55, hz * 0.55]) P.box('white', s * hx, 1.2, z - 0.35, s * (hx + 0.25), roofY + 1.7, z + 0.35);
  }

  // glazed body and the strip-glass long faces
  P.box('darkGlass', -gx, GF, -gz, gx, roofY, gz);
  const bays = 30, bw = (2 * gx) / bays;
  for (const s of [-1, 1]) {
    const zf = s * gz; // glass plane
    // horizontal spandrel bands at every floor (and the roof parapet)
    for (let k = 0; k <= NF; k++) {
      const y = GF + k * FH;
      const top = k === NF ? roofY + 1.0 : y + 0.75;
      P.box('white', -gx, y - 0.4, zf, gx, top, zf + s * 0.32);
    }
    // vertical mullions (slim fins) across the glass
    for (let i = 1; i < bays; i++) {
      const x = -gx + i * bw;
      P.box('white', x - 0.07, GF, zf, x + 0.07, roofY, zf + s * 0.42);
    }
    // lit panes on some bays
    for (let k = 0; k < NF; k++) {
      const y0 = GF + k * FH + 0.75, y1 = GF + (k + 1) * FH - 0.4;
      for (let i = 0; i < bays; i++) {
        if (rand() > 0.42) continue;
        const x = -gx + (i + 0.5) * bw;
        P.quad('windowLit', x, (y0 + y1) / 2, zf + s * 0.06, bw - 0.18, y1 - y0, s > 0 ? 0 : Math.PI);
      }
    }
  }

  // ground floor: recessed glass lobby behind a row of columns, canopy at the entrance
  P.box('darkGlass', -gx, 0, -(hz - 2.4), gx, GF - 0.4, hz - 2.4);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const x = -gx + ((i + 0.5) * 2 * gx) / 8;
      P.box('offwhite', x - 0.4, 0, s * (hz - 1.3) - 0.4, x + 0.4, GF - 0.4, s * (hz - 1.3) + 0.4);
    }
    for (let i = 0; i < 16; i++) {
      if (rand() > 0.55) continue;
      const x = -gx + ((i + 0.5) * 2 * gx) / 16;
      P.quad('windowLit', x, 2.3, s * (hz - 2.4 + 0.05), (2 * gx) / 16 - 0.3, 3.6, s > 0 ? 0 : Math.PI);
    }
  }
  P.box('white', -7, GF - 1.0, hz - 2.4, 7, GF - 0.65, hz + 3.2);
  for (const x of [-6.4, 6.4]) P.box('offwhite', x - 0.15, 0, hz + 2.7, x + 0.15, GF - 1.0, hz + 3.0);
  P.box('concrete', -hx - 0.3, 0, -hz - 0.3, hx + 0.3, 0.35, hz + 0.3);

  // roof: slab, lift and tank penthouse, water tanks
  P.box('concrete', -gx, roofY - 0.05, -gz, gx, roofY + 0.2, gz);
  const ph = { x0: -12.5, x1: 12.5, z0: -5.5, z1: 4.5, y1: 54.0 };
  P.box('offwhite', ph.x0, roofY + 0.2, ph.z0, ph.x1, ph.y1, ph.z1);
  P.box('concrete', ph.x0 + 0.3, ph.y1, ph.z0 + 0.3, ph.x1 - 0.3, ph.y1 + 0.25, ph.z1 - 0.3);
  for (let i = 0; i < 6; i++) {
    const x = ph.x0 + 2.2 + i * 4.1;
    P.quad('darkGlass', x, roofY + 3.6, ph.z1 + 0.04, 1.6, 1.1, 0);
    P.quad('darkGlass', x, roofY + 3.6, ph.z0 - 0.04, 1.6, 1.1, Math.PI);
  }
  for (const x of [-18.5, 18.5]) {
    P.box('concrete', x - 2, roofY + 0.2, -3.5, x + 2, roofY + 2.4, 1.5);
    P.box('darkSteel', x - 2.2, roofY + 2.4, -3.7, x + 2.2, roofY + 2.6, 1.7);
  }

  // the LIC name board on the penthouse, lettered front and back
  const sb = { x0: -11, x1: 11, y0: ph.y1 + 0.9, y1: ph.y1 + 5.6, z: ph.z1 - 0.8 };
  for (const x of [-9.5, -3.2, 3.2, 9.5]) P.box('darkSteel', x - 0.12, ph.y1 + 0.25, sb.z - 0.5, x + 0.12, sb.y0, sb.z + 0.1);
  P.box('darkSteel', sb.x0, ph.y1 + 0.6, sb.z - 0.5, sb.x1, ph.y1 + 0.9, sb.z + 0.1);
  P.box('sign', sb.x0, sb.y0, sb.z - 0.35, sb.x1, sb.y1, sb.z);
  P.box('darkSteel', sb.x0 - 0.15, sb.y1, sb.z - 0.4, sb.x1 + 0.15, sb.y1 + 0.2, sb.z + 0.05);
  const letterH = 3.3, st = 0.75, ly0 = (sb.y0 + sb.y1) / 2 - letterH / 2, ly1 = ly0 + letterH;
  for (const face of [1, -1]) {
    const zb = face > 0 ? sb.z : sb.z - 0.35, zt = zb + face * 0.22;
    const X = (x: number) => face * x; // mirror on the back so the word reads from both sides
    const lx = -2.0;
    const bars: [number, number, number, number][] = [
      [lx, ly0, lx + st, ly1], [lx, ly0, lx + 2.3, ly0 + st],                     // L
      [lx + 3.1, ly0, lx + 3.1 + st, ly1],                                          // I
      [lx + 4.65, ly0, lx + 4.65 + st, ly1], [lx + 4.65, ly1 - st, lx + 6.95, ly1], // C
      [lx + 4.65, ly0, lx + 6.95, ly0 + st],
    ];
    for (const [x0, y0, x1, y1] of bars) P.box('seatBlue', X(x0), y0, zb, X(x1), y1, zt);
    // round emblem left of the letters
    const disc = new THREE.CircleGeometry(1.75, 18);
    if (face < 0) disc.rotateY(Math.PI);
    disc.translate(X(-5.6), (sb.y0 + sb.y1) / 2, zb + face * 0.05);
    P.add('gold', disc);
    const ring2 = new THREE.RingGeometry(1.75, 2.1, 18);
    if (face < 0) ring2.rotateY(Math.PI);
    ring2.translate(X(-5.6), (sb.y0 + sb.y1) / 2, zb + face * 0.06);
    P.add('seatBlue', ring2);
  }

  // aviation lights on the top corners of the end walls
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (hx - 0.6), z = sz * (hz - 0.6);
    P.box('aviationRed', x - 0.25, roofY + 1.7, z - 0.25, x + 0.25, roofY + 2.2, z + 0.25);
  }

  P.build(group);
  return {
    group,
    notes: '54 m to the penthouse roof and 13 levels as published; solid end walls and strip-glazed long faces from '
      + 'published descriptions. Bay count, colours and the rooftop name board layout are illustrated.',
  };
}
