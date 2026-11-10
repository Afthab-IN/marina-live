// Jawaharlal Nehru Stadium, Periamet: an oval single-tier bowl round an illustrated blue athletics
// track; the football pitch itself is left to the map's ground layer.
// Following the Google 2.5D height raster (2023): a cantilevered roof ring at about 27 to 30 m over
// the back of the stands all round, and a taller main-stand roof (about 40 to 45 m) on the east
// side. Floodlights: four corner masts; the two east ones sit on the 2.5D hot spots at about 50 m,
// the west pair mirrors them (illustrated).
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild, MatName } from '../kit';
import { type P2, type Station, type V3, Soup, floodlightTower, lerp, rake, rayToRing, smooth, sweep } from './_stadium';

const D2R = Math.PI / 180;
/** Inner opening (track plus field): half-length, half-width; semicircular ends. */
const A_IN = 91, B_IN = 58.5;
const HALF = A_IN - B_IN;
const BASE = -3;
const N_SEC = 40;
/** Football pitch (OSM way 1241304917) corners, world x, z: kept clear for the ground layer. */
const PITCH_W: [number, number][] = [[-830.4, -2655.91], [-828.96, -2550.31], [-761.68, -2551.25], [-763.11, -2656.85]];

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const T = kit.THREE;
  const group = new T.Group();
  group.name = 'nehru_stadium';
  const soup = new Soup();
  const beams = new Soup();
  const ring = kit.ringLocal(lm);
  // which long side faces world east (the main stand)
  const east = kit.toLocal(lm, lm.x + 100, lm.z);
  const sMain = east[1] < 0 ? -1 : 1;

  // ---------------------------------------------------------------- inner edge stations
  const LB = Math.PI * B_IN, LS = 2 * HALF, PERIM = 2 * LB + 2 * LS;
  const edge = (s: number) => {
    s = ((s % PERIM) + PERIM) % PERIM;
    let x: number, z: number, nx: number, nz: number;
    if (s < LB) { const t = -Math.PI / 2 + s / B_IN; nx = Math.cos(t); nz = Math.sin(t); x = HALF + B_IN * nx; z = B_IN * nz; }
    else if (s < LB + LS) { const u = s - LB; x = HALF - u; z = B_IN; nx = 0; nz = 1; }
    else if (s < 2 * LB + LS) { const t = Math.PI / 2 + (s - LB - LS) / B_IN; nx = Math.cos(t); nz = Math.sin(t); x = -HALF + B_IN * nx; z = B_IN * nz; }
    else { const u = s - 2 * LB - LS; x = -HALF + u; z = -B_IN; nx = 0; nz = -1; }
    const r = rayToRing(ring, x, z, nx, nz);
    return { x, z, nx, nz, depth: Number.isFinite(r) ? Math.max(18, r) : 34 } as Station;
  };
  /** 1 on the main (east) stand, fading out 45 to 65 deg round the bends */
  const mainW = (st: Station) => {
    const diff = Math.acos(Math.max(-1, Math.min(1, st.nz * sMain))) / D2R;
    return 1 - smooth(45, 65, diff);
  };

  const ss: number[] = [];
  const aisle: boolean[] = [];
  const secLen = PERIM / N_SEC;
  for (let k = 0; k < N_SEC; k++) {
    const s0 = k * secLen;
    ss.push(s0); aisle.push(true);
    for (let j = 0; j < 3; j++) { ss.push(s0 + 1.2 + ((secLen - 1.2) * j) / 3); aisle.push(false); }
  }
  const st = ss.map(edge);
  const W = st.map(mainW);

  // seat colours by section: blue bowl, yellow behind the goals, red in the middle of the main stand
  const secMat = (i: number): MatName => {
    const s = st[i];
    if (Math.abs(s.nx) > 0.85) return 'seatYellow';
    if (W[i] > 0.99 && Math.abs(s.x) < 26) return 'seatRed';
    return 'seatBlue';
  };

  // ---------------------------------------------------------------- bowl
  const L1 = 15, TAN = 0.6;
  const yL = 2.4 + (L1 - 1.6) * TAN;
  const profs: P2[][] = [];
  const mats: MatName[][] = [];
  st.forEach((s, i) => {
    const w = W[i], D = s.depth;
    const pts: P2[] = [[0, BASE]];
    const mm: MatName[] = [];
    const to = (p: P2, m: MatName) => { pts.push(p); mm.push(m); };
    const seat = aisle[i] ? 'concrete' : secMat(i);
    const top = lerp(20, 25.5, w);
    const roofBack = lerp(27, 45.5, w) - lerp(1.4, 2.2, w);
    to([0, 1.4], 'concrete');
    to([0, 2.4], 'sign'); // LED boards facing the track
    to([1.6, 2.4], 'concrete');
    for (const p of rake(1.6, 2.4, L1, yL, 7)) to(p, aisle[i] ? 'concrete' : 'seatBlue');
    to([L1 + 1.2, yL], 'concrete'); // cross aisle
    to([L1 + 1.2, yL + 3.4 * w], 'darkGlass'); // boxes on the main stand
    to([L1 + 1.2, yL + 4.1 * w], 'concrete');
    to([L1 + 2.2, yL + 4.1 * w], 'concrete');
    for (const p of rake(L1 + 2.2, yL + 4.1 * w, D - 2.6, top, 7)) to(p, seat);
    to([D - 1.0, top], 'concrete');
    // main stand: glazed back wall up to the high roof; elsewhere a parapet with an open back
    const clad = w * Math.max(0, roofBack - top - 1.2);
    to([D - 1.0, top + 1.2 + clad], w > 0.5 ? 'darkGlass' : 'concrete');
    to([D, top + 1.2 + clad], 'concrete');
    to([D, top + 1.2], w > 0.5 ? 'darkGlass' : 'concrete'); // curtain wall on the main stand's outside
    to([D, BASE], 'concrete');
    profs.push(pts);
    mats.push(mm);
  });
  sweep(soup, st, profs, (i, k) => mats[i][k], { loop: true });

  // ---------------------------------------------------------------- roof ring
  const roof: P2[][] = st.map((s, i) => {
    const w = W[i];
    const dF = 13.5, dB = s.depth + 0.8;
    const yF = lerp(30.5, 40, w), yB = lerp(27, 45.5, w), t = lerp(1.4, 2.2, w);
    return [[dF, yF - t], [dF, yF], [dB, yB], [dB, yB - t]];
  });
  sweep(soup, st, roof, (_i, k) => (k === 0 ? 'darkSteel' : 'white'), { loop: true, closed: true });
  const P = (s: Station, d: number, y: number): V3 => [s.x + s.nx * d, y, s.z + s.nz * d];
  st.forEach((s, i) => {
    if (!aisle[i]) return;
    const w = W[i], r = roof[i];
    // radial roof trusses on top, deeper over the main stand
    soup.beam('steel', P(s, r[1][0], r[1][1] + 0.4 + 0.4 * w), P(s, r[2][0], r[2][1] + 0.4 + 0.4 * w), 0.55, 0.8 + 0.8 * w);
    // columns at the back every other section
    if ((i / 4) % 2 === 0) {
      const p = P(s, s.depth + 0.4, 0);
      soup.post('concrete', p[0], p[2], BASE, r[3][1], 0.6, 0.5, 6);
    }
  });

  // ---------------------------------------------------------------- floodlight masts at the corners
  const corner = (cx: number, theta: number) => {
    const nx = Math.cos(theta), nz = Math.sin(theta);
    const x = cx + B_IN * nx, z = B_IN * nz;
    const r = rayToRing(ring, x, z, nx, nz);
    const D = Number.isFinite(r) ? r : 34;
    return { x: x + nx * (D + 3), z: z + nz * (D + 3) };
  };
  const towers = [corner(HALF, 50 * D2R), corner(HALF, -50 * D2R), corner(-HALF, 130 * D2R), corner(-HALF, 230 * D2R)];
  for (const tw of towers) {
    const aim: V3 = [tw.x * 0.42, 0, tw.z * 0.42];
    floodlightTower(soup, beams, {
      x: tw.x, z: tw.z, y0: BASE, h: 50, aim, headW: 12, headH: 7, rows: 4, cols: 8,
      rBase: 1.5, rTop: 0.8, beamR: 31, reach: 4, pole: 'steel', frame: 'darkSteel',
    });
  }
  // floodlit field glow (additive, only visible at night)
  {
    const c: V3 = [0, 0.3, 0];
    const n = 64;
    for (let k = 0; k < n; k++) {
      const a = edge((k / n) * PERIM), b = edge(((k + 1) / n) * PERIM);
      beams.triFacing('beam', c, [a.x - a.nx, 0.3, a.z - a.nz], [b.x - b.nx, 0.3, b.z - b.nz], [0, 1, 0]);
    }
  }

  // ---------------------------------------------------------------- athletics track (illustrated)
  // Standard 400 m, 8 lanes of 1.22 m, bend centres 42.195 m either side of the middle; blue since the
  // 2023 relay. Grass fills the D areas round the mapped pitch, which itself stays clear for the ground layer.
  const up: V3 = [0, 1, 0];
  const TR_HALF = 42.195, TR_IN = 36.5, LANE = 1.22, LANES = 8;
  const TR_OUT = TR_IN + LANE * LANES;
  const NB = 18;
  const oval = (r: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let k = 0; k <= NB; k++) { const t = -Math.PI / 2 + (Math.PI * k) / NB; pts.push([TR_HALF + r * Math.cos(t), r * Math.sin(t)]); }
    for (let k = 0; k <= NB; k++) { const t = Math.PI / 2 + (Math.PI * k) / NB; pts.push([-TR_HALF + r * Math.cos(t), r * Math.sin(t)]); }
    return pts;
  };
  const band = (m: MatName, r0: number, r1: number, y: number) => {
    const a = oval(r0), b = oval(r1);
    for (let k = 0; k < a.length; k++) {
      const k2 = (k + 1) % a.length;
      soup.quad(m, [a[k][0], y, a[k][1]], [a[k2][0], y, a[k2][1]], [b[k2][0], y, b[k2][1]], [b[k][0], y, b[k][1]], up);
    }
  };
  band('seatBlue', TR_IN, TR_OUT + 0.3, 0.08);
  for (let k = 0; k <= LANES; k++) band('white', TR_IN + k * LANE - 0.09, TR_IN + k * LANE + 0.09, 0.1);
  const flat = (m: MatName, outer: [number, number][], hole: [number, number][], y: number) => {
    const c = outer.map(([x, z]) => new T.Vector2(x, z)), h = hole.map(([x, z]) => new T.Vector2(x, z));
    const all = [...outer, ...hole];
    for (const [i, j, k] of T.ShapeUtils.triangulateShape(c, [h])) {
      soup.triFacing(m, [all[i][0], y, all[i][1]], [all[j][0], y, all[j][1]], [all[k][0], y, all[k][1]], up);
    }
  };
  const pitch = PITCH_W.map(([x, z]) => kit.toLocal(lm, x, z));
  flat('grass', oval(TR_IN), pitch, 0.06);
  // hard apron from lane 8 out to the stands
  const inner: [number, number][] = [];
  for (let k = 0; k < 72; k++) { const e = edge((k / 72) * PERIM); inner.push([e.x, e.z]); }
  flat('concrete', inner, oval(TR_OUT + 0.3).reverse(), 0.07);

  soup.build(kit, group);
  beams.build(kit, group, { cast: false, receive: false });
  return {
    group,
    notes: 'Bowl from the OSM outline with a 182 x 117 m opening; roof heights from Google 2.5D (2023); corner floodlight masts '
      + 'illustrated (east pair on 2.5D hot spots). The blue 8-lane track, grass D areas and apron are illustrated (OSM maps only the pitch).',
  };
}
