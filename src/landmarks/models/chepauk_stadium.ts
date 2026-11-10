// MA Chidambaram Stadium, Chepauk: a ring of separate stand blocks around a circular field.
// Block layout and heights follow the OSM outline (notches = gaps between blocks) and the
// Google 2.5D height raster (2023): taller roofed stands on the west and north, lower ones on
// the east, the 2023 Kalaignar Karunanidhi stand with the Anna Pavilion in the south.
// Roofs: the quad-cone PTFE membrane canopies of the 2011 rebuild (four cones per stand).
// Floodlights: six high-mast towers in the gaps between stands (count and positions illustrated).
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild, MatName } from '../kit';
import { type P2, type Station, type V3, Soup, coneMembrane, floodlightTower, lerp, rake, rayToRing, sweep } from './_stadium';

const D2R = Math.PI / 180;
/** Field (inner ring of OSM relation 60961): world centre and radius. */
const FIELD_W: [number, number] = [34.2, -89.8];
const R_F = 75.9;
/** Infield turf height (the map flattens the terrain inside the stadium outline). */
const FY = 0.06;
const BASE = -2.5;
/** Angles below are measured from the field centre in the frame the model was laid out in (frame angle
 * -153.46 deg). The offset keeps every block on the same world bearing if the frame angle changes. */
const A_REF = -153.461 * D2R;
const PITCH_REF = 232.2; // towards the pavilion (south, 11 deg east of south)

interface Block {
  name: string; a0: number; a1: number;
  /** measured top height (2.5D), metres */
  h: number;
  boxes: boolean;
  upper: MatName;
  pavilion?: boolean;
}
const BLOCKS: Block[] = [
  { name: 'A', a0: 355, a1: 377, h: 27, boxes: true, upper: 'seatYellow' },
  { name: 'B', a0: 26.5, a1: 51, h: 23.5, boxes: true, upper: 'seatBlue' },
  { name: 'C', a0: 55.5, a1: 78.5, h: 26, boxes: true, upper: 'seatYellow' },
  { name: 'D', a0: 84, a1: 107, h: 28.5, boxes: true, upper: 'seatYellow' },
  { name: 'E', a0: 112, a1: 140.5, h: 20, boxes: false, upper: 'seatBlue' },
  { name: 'F', a0: 146, a1: 169.5, h: 21, boxes: false, upper: 'seatYellow' },
  { name: 'G', a0: 175, a1: 197, h: 23, boxes: false, upper: 'seatBlue' },
  { name: 'H1', a0: 205, a1: 264, h: 21, boxes: true, upper: 'seatBlue', pavilion: true },
  { name: 'H2', a0: 267, a1: 290, h: 26, boxes: true, upper: 'seatYellow' },
  { name: 'I', a0: 299, a1: 321.5, h: 28, boxes: true, upper: 'seatYellow' },
  { name: 'J', a0: 325.5, a1: 349.5, h: 22, boxes: true, upper: 'seatBlue' },
];
/** Floodlight masts stand in these gaps: roughly +-30, +-90 and +-150 deg off the pitch axis. */
const TOWERS = [21.7, 81.2, 143.2, 201, 265.5, 323.5];

const TAN_LOWER = Math.tan(26 * D2R);

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const T = kit.THREE;
  const group = new T.Group();
  group.name = 'chepauk_stadium';
  const soup = new Soup();
  const beams = new Soup();
  const ring = kit.ringLocal(lm);
  const [fx, fz] = kit.toLocal(lm, FIELD_W[0], FIELD_W[1]);
  const off = A_REF - kit.frame(lm).angle;
  const ang = (deg: number) => deg * D2R + off;
  const depthAt = (phi: number) => {
    const r = rayToRing(ring, fx, fz, Math.cos(phi), Math.sin(phi));
    return Number.isFinite(r) ? Math.max(14, r - R_F) : 30;
  };
  const station = (phi: number): Station => ({
    x: fx + R_F * Math.cos(phi), z: fz + R_F * Math.sin(phi), nx: Math.cos(phi), nz: Math.sin(phi), depth: depthAt(phi),
  });
  const P = (phi: number, r: number, y: number): V3 => [fx + r * Math.cos(phi), y, fz + r * Math.sin(phi)];

  // lower-tier depth per block (constant inside a block so the box line is a clean circle)
  const meanDepth = (b: Block) => {
    let s = 0;
    for (let i = 0; i <= 8; i++) s += depthAt(ang(lerp(b.a0, b.a1, i / 8)));
    return s / 9;
  };
  const L1 = BLOCKS.map((b) => Math.min(16.5, Math.max(9.5, 0.4 * meanDepth(b))));
  const yLower = (l1: number) => FY + 1.3 + (l1 - 1.4) * TAN_LOWER;

  // ---------------------------------------------------------------- stand blocks
  const NL = 7, NU = 7;
  const lowerPart = (pts: P2[], mats: MatName[], l1: number) => {
    const to = (p: P2, m: MatName) => { pts.push(p); mats.push(m); };
    to([0, FY + 0.3], 'concrete');
    to([0, FY + 1.3], 'sign'); // LED boards round the field
    to([1.4, FY + 1.3], 'concrete');
    for (const p of rake(1.4, FY + 1.3, l1, yLower(l1), NL)) to(p, 'seatYellow');
  };
  const blockProfile = (b: Block, l1: number, D: number, phiDeg: number) => {
    const pts: P2[] = [[0, BASE]];
    const mats: MatName[] = [];
    const to = (p: P2, m: MatName) => { pts.push(p); mats.push(m); };
    lowerPart(pts, mats, l1);
    const yl = yLower(l1);
    const hr = roofH(b, phiDeg);
    const top = hr - 2.8;
    // pavilion: a taller two-storey glass front in the middle of the Kalaignar stand
    const pav = b.pavilion ? Math.max(0, 1 - Math.abs(phiDeg - PITCH_REF) / 9) : 0;
    const glassH = b.boxes ? 3.2 + 3.4 * Math.min(1, pav * 2) : 0;
    to([l1 + 1.2, yl], 'concrete');
    to([l1 + 1.2, yl + 0.8], 'sign'); // LED ribbon on the tier fascia
    to([l1 + 1.2, yl + 0.8 + glassH], 'darkGlass'); // hospitality boxes
    to([l1 + 1.2, yl + 0.8 + glassH + (b.boxes ? 0.8 : 0)], 'concrete');
    const y2 = yl + 0.8 + glassH + (b.boxes ? 0.8 : 0);
    const Dr = b.pavilion ? Math.min(D, 33) : D;
    const rear = Math.min(5, Math.max(1.2, Dr - 34));
    to([l1 + 2.4, y2], 'concrete');
    for (const p of rake(l1 + 2.4, y2, Dr - rear, Math.max(top, y2 + 2), NU)) to(p, b.upper);
    const yt = Math.max(top, y2 + 2);
    to([Dr - 0.4, yt], 'concrete');
    to([Dr - 0.4, yt + 1.2], 'concrete');
    to([Dr, yt + 1.2], 'concrete');
    // the pavilion's lower back annex fills the OSM bulge behind the Kalaignar stand
    const annexH = FY + 8.5;
    to([Dr, D > Dr + 0.5 ? annexH : yt + 1.2], 'concrete');
    to([D, D > Dr + 0.5 ? annexH : yt + 1.2], 'concrete');
    to([D, BASE], 'concrete');
    return { pts, mats };
  };
  const roofH = (b: Block, phiDeg: number) => {
    if (!b.pavilion) return b.h - 2;
    // Kalaignar stand rises from the east end towards the west end (2.5D: 15 to 21 m)
    return lerp(16, 20, (phiDeg - b.a0) / (b.a1 - b.a0));
  };

  /** Station angles for a block: seat sections split by narrow radial aisles. */
  const blockStations = (b: Block, l1: number) => {
    const span = b.a1 - b.a0;
    const rMid = R_F + l1;
    const nSec = Math.max(2, Math.round((rMid * span * D2R) / 11));
    const aisle = (1.3 / rMid) / D2R;
    const degs: number[] = [];
    const isAisle: boolean[] = [];
    for (let s = 0; s < nSec; s++) {
      const s0 = b.a0 + (span * s) / nSec, s1 = b.a0 + (span * (s + 1)) / nSec;
      let start = s0;
      if (s > 0) { degs.push(s0); isAisle.push(true); start = s0 + aisle; }
      const n = Math.max(1, Math.ceil((s1 - start) / 2.5));
      for (let k = 0; k < n; k++) { degs.push(start + ((s1 - start) * k) / n); isAisle.push(false); }
    }
    degs.push(b.a1); isAisle.push(false);
    return { degs, isAisle };
  };

  const seatMats = new Set<MatName>(['seatYellow', 'seatBlue']);
  BLOCKS.forEach((b, bi) => {
    const l1 = L1[bi];
    const { degs, isAisle } = blockStations(b, l1);
    const st = degs.map((d) => station(ang(d)));
    const profs = st.map((s, i) => blockProfile(b, l1, s.depth, degs[i]));
    sweep(soup, st, profs.map((p) => p.pts), (i, k) => {
      const m = profs[i].mats[k];
      return isAisle[i] && seatMats.has(m) ? 'concrete' : m;
    }, { caps: 'concrete' });

    if (b.pavilion) {
      pavilionRoof(b, l1, degs);
    } else {
      coneRoof(b, l1);
    }
  });

  // ---------------------------------------------------------------- lower bowl in the gaps
  for (let bi = 0; bi < BLOCKS.length; bi++) {
    const b = BLOCKS[bi], nb = BLOCKS[(bi + 1) % BLOCKS.length];
    const g0 = b.a1, g1 = nb.a0 + (nb.a0 < b.a1 - 180 ? 360 : 0);
    const n = Math.max(2, Math.ceil((g1 - g0) / 2));
    const st: Station[] = [];
    const profs: P2[][] = [];
    for (let i = 0; i <= n; i++) {
      const d = lerp(g0, g1, i / n);
      const s = station(ang(d));
      st.push(s);
      const l1 = lerp(L1[bi], L1[(bi + 1) % BLOCKS.length], i / n);
      const pts: P2[] = [[0, BASE]];
      const mats: MatName[] = [];
      lowerPart(pts, mats, l1);
      pts.push([l1 + 1.2, yLower(l1)], [l1 + 1.2, BASE]);
      profs.push(pts);
    }
    const mats: MatName[] = ['concrete', 'sign', 'concrete', ...Array(NL * 2).fill('seatYellow'), 'concrete', 'concrete'];
    sweep(soup, st, profs, (_i, k) => mats[k]);
  }

  // ---------------------------------------------------------------- cone roofs
  function coneRoof(b: Block, l1: number) {
    const hr = b.h - 2;
    const rise = b.h > 24 ? 6.5 : 5.5;
    const rF = R_F + l1 + 1.0;
    const rB = (deg: number) => R_F + depthAt(ang(deg)) + 0.8;
    const n = 4;
    const edges: number[] = [];
    for (let c = 0; c <= n; c++) edges.push(lerp(b.a0, b.a1, c / n));
    for (let c = 0; c < n; c++) {
      const pa = edges[c], pb = edges[c + 1];
      const perim: V3[] = [];
      for (let k = 0; k < 4; k++) { const d = lerp(pa, pb, k / 4); perim.push(P(ang(d), rF, hr)); }
      for (let k = 0; k < 4; k++) perim.push(P(ang(pb), lerp(rF, rB(pb), k / 4), hr));
      for (let k = 0; k < 4; k++) { const d = lerp(pb, pa, k / 4); perim.push(P(ang(d), rB(d), hr)); }
      for (let k = 0; k < 4; k++) perim.push(P(ang(pa), lerp(rB(pa), rF, k / 4), hr));
      const mid = (pa + pb) / 2;
      const apex = P(ang(mid), lerp(rF, rB(mid), 0.5), hr + rise);
      coneMembrane(soup, 'membrane', perim, apex);
      // flying mast through the apex ring
      soup.post('steel', apex[0], apex[2], hr - 1.5, apex[1] + 3.2, 0.32, 0.22, 6);
    }
    // steel frame: rafters on the valley lines, front and back edge beams
    for (const e of edges) soup.beam('steel', P(ang(e), rF, hr), P(ang(e), rB(e), hr), 0.55, 0.7);
    const steps = 12;
    for (let k = 0; k < steps; k++) {
      const d0 = lerp(b.a0, b.a1, k / steps), d1 = lerp(b.a0, b.a1, (k + 1) / steps);
      soup.beam('steel', P(ang(d0), rF, hr), P(ang(d1), rF, hr), 0.7, 0.9);
      soup.beam('steel', P(ang(d0), rB(d0), hr), P(ang(d1), rB(d1), hr), 0.5, 0.6);
    }
  }

  // ---------------------------------------------------------------- pavilion roof
  function pavilionRoof(b: Block, l1: number, degs: number[]) {
    const st: Station[] = [];
    const profs: P2[][] = [];
    const n = Math.ceil((b.a1 - b.a0) / 1.2);
    const waves = 6;
    for (let i = 0; i <= n; i++) {
      const d = lerp(b.a0, b.a1, i / n);
      const s = station(ang(d));
      st.push(s);
      const hr = roofH(b, d);
      const t = (d - b.a0) / (b.a1 - b.a0);
      const wave = 1.3 * Math.sin(t * waves * Math.PI * 2 - Math.PI / 2) + 2.2 * Math.exp(-(((d - PITCH_REF) / 7) ** 2));
      const dF = l1 + 0.2, dB = Math.min(s.depth, 33) + 0.8;
      profs.push([[dF, hr + 1.6 + wave - 0.9], [dF, hr + 1.6 + wave], [dB, hr + 0.2 + wave * 0.35], [dB, hr + 0.2 + wave * 0.35 - 0.9]]);
    }
    sweep(soup, st, profs, () => 'membrane', { closed: true, caps: 'membrane' });
    // radial ribs on top, one per wave crest and trough
    for (let w = 0; w <= waves * 2; w++) {
      const i = Math.round((n * w) / (waves * 2));
      const s = st[i], p = profs[i];
      const a: V3 = [s.x + s.nx * p[1][0], p[1][1] + 0.35, s.z + s.nz * p[1][0]];
      const c: V3 = [s.x + s.nx * p[2][0], p[2][1] + 0.35, s.z + s.nz * p[2][0]];
      soup.beam('steel', a, c, 0.5, 0.7);
    }
    // a slim mast at each end of the pavilion roof
    for (const d of [degs[0] + 1, degs[degs.length - 1] - 1]) {
      const s = station(ang(d));
      const r = R_F + Math.min(s.depth, 33) + 0.3;
      const p = P(ang(d), r, 0);
      soup.post('steel', p[0], p[2], 0, roofH(b, d) + 4, 0.45, 0.35, 6);
    }
  }

  // ---------------------------------------------------------------- infield
  const pu = ang(PITCH_REF);
  const ux = Math.cos(pu), uz = Math.sin(pu), vx = -uz, vz = ux;
  const F = (u: number, v: number, y: number): V3 => [fx + ux * u + vx * v, y, fz + uz * u + vz * v];
  const up: V3 = [0, 1, 0];
  const bandW = 7.2;
  const nb = Math.ceil((2 * R_F) / bandW);
  for (let j = 0; j < nb; j++) {
    const v0 = -R_F + j * bandW, v1 = Math.min(R_F, v0 + bandW);
    const side: V3[] = [], other: V3[] = [];
    for (let k = 0; k <= 3; k++) {
      const v = lerp(v0, v1, k / 3);
      const u = Math.sqrt(Math.max(0, R_F * R_F - v * v));
      side.push(F(u, v, FY));
      other.push(F(-u, v, FY));
    }
    const m: MatName = j % 2 ? 'grass' : 'pitch';
    for (let k = 0; k < 3; k++) soup.quad(m, side[k], side[k + 1], other[k + 1], other[k], up);
  }
  const rect = (m: MatName, u0: number, u1: number, v0: number, v1: number, y: number) =>
    soup.quad(m, F(u0, v0, y), F(u1, v0, y), F(u1, v1, y), F(u0, v1, y), up);
  rect('pitch', -15, 15, -12, 12, FY + 0.03); // the square
  rect('sand', -11.5, 11.5, -1.8, 1.8, FY + 0.06); // the pitch strip
  rect('white', -10.4, -9.9, -1.8, 1.8, FY + 0.08); // popping creases
  rect('white', 9.9, 10.4, -1.8, 1.8, FY + 0.08);
  // 30-yard circle: two semicircles round the stumps joined by straights
  const ringLine = (pts: [number, number][], w: number, y: number) => {
    for (let i = 0; i < pts.length; i++) {
      const [u0, v0] = pts[i], [u1, v1] = pts[(i + 1) % pts.length];
      const du = u1 - u0, dv = v1 - v0, l = Math.hypot(du, dv) || 1;
      const nu = (-dv / l) * w * 0.5, nv = (du / l) * w * 0.5;
      soup.quad('white', F(u0 - nu, v0 - nv, y), F(u1 - nu, v1 - nv, y), F(u1 + nu, v1 + nv, y), F(u0 + nu, v0 + nv, y), up);
    }
  };
  const yard: [number, number][] = [];
  for (let k = 0; k <= 16; k++) { const t = -Math.PI / 2 + (Math.PI * k) / 16; yard.push([10.06 + 27.43 * Math.cos(t), 27.43 * Math.sin(t)]); }
  for (let k = 0; k <= 16; k++) { const t = Math.PI / 2 + (Math.PI * k) / 16; yard.push([-10.06 + 27.43 * Math.cos(t), 27.43 * Math.sin(t)]); }
  ringLine(yard, 0.5, FY + 0.05);
  const rope: [number, number][] = [];
  for (let k = 0; k < 72; k++) { const t = (k / 72) * Math.PI * 2; rope.push([(R_F - 5.5) * Math.cos(t), (R_F - 5.5) * Math.sin(t)]); }
  ringLine(rope, 0.8, FY + 0.05);
  // sight screens behind the bowler's arm at both ends
  for (const sgn of [1, -1]) {
    const g = new T.BoxGeometry(0.8, 6, 18).translate(sgn * (R_F - 3.2), FY + 3, 0);
    const m = new T.Matrix4().makeBasis(new T.Vector3(ux, 0, uz), new T.Vector3(0, 1, 0), new T.Vector3(vx, 0, vz)).setPosition(fx, 0, fz);
    soup.add('white', g, m);
    g.dispose();
  }

  // ---------------------------------------------------------------- floodlights
  for (const tdeg of TOWERS) {
    // gap neighbours decide how deep the lower bowl is here
    let l1 = 12;
    for (let bi = 0; bi < BLOCKS.length; bi++) {
      const b = BLOCKS[bi], nb2 = BLOCKS[(bi + 1) % BLOCKS.length];
      const g1 = nb2.a0 + (nb2.a0 < b.a1 - 180 ? 360 : 0);
      const t = (((tdeg - b.a1) % 360) + 360) % 360;
      if (t <= g1 - b.a1) l1 = (L1[bi] + L1[(bi + 1) % BLOCKS.length]) / 2;
    }
    const phi = ang(tdeg);
    const r = Math.min(R_F + l1 + 5, R_F + depthAt(phi) - 1);
    const base = P(phi, r, 0);
    // each mast lights the part of the field nearest to it; the glow disc fills the middle
    const aim = P(phi, R_F * 0.45, FY);
    floodlightTower(soup, beams, {
      x: base[0], z: base[2], y0: 0, h: 50, aim, headW: 11, headH: 6.5, rows: 4, cols: 7,
      rBase: 1.25, rTop: 0.7, beamR: 24, reach: 1.6, pole: 'steel', frame: 'darkSteel',
    });
  }
  // the floodlit turf: an additive glow over the field that only shows at night
  {
    const n = 48;
    const c: V3 = [fx, FY + 0.25, fz];
    for (let k = 0; k < n; k++) {
      const t0 = (k / n) * Math.PI * 2, t1 = ((k + 1) / n) * Math.PI * 2;
      beams.triFacing('beam', c, [fx + (R_F - 1) * Math.cos(t0), FY + 0.25, fz + (R_F - 1) * Math.sin(t0)],
        [fx + (R_F - 1) * Math.cos(t1), FY + 0.25, fz + (R_F - 1) * Math.sin(t1)], up);
    }
  }

  soup.build(kit, group);
  beams.build(kit, group, { cast: false, receive: false });
  return {
    group,
    notes: 'Blocks, gaps and heights from the OSM outline and Google 2.5D (2023); cone roofs per the 2011 PTFE canopies; '
      + 'six floodlight masts in the gaps are illustrated (tower count not confirmed).',
  };
}
