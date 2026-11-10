// Shared helpers for the heritage blocks (High Court, Ripon Building, Chepauk Palace, Presidency College,
// Senate House, PWD building). Never loaded as a landmark.
//
// Everything works on a "plan": the footprint ring plus courtyards in the build frame (metres, x/z on the
// ground). Walls, bands, parapets and roofs are built as thin custom strips (2 triangles per edge per face)
// instead of boxes, so footprints with 40 to 60 corners stay well inside the triangle budget.
import * as THREE from 'three';
import type { MatName } from '../kit';
import { Parts, type V2, area, archShape, faceAngle, flat, offsetConvex, outward } from './_towers';

export type Rand = () => number;

/** A footprint in the build frame: outer ring plus courtyards. */
export interface Plan { outer: V2[]; holes: V2[][] }

/** Dominant wall direction of one or more rings (radians, within 45 degrees of +x). */
export function gridAngle(rings: V2[][]): number {
  let c = 0, s = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const l = Math.hypot(dx, dz), t = Math.atan2(dz, dx);
      c += l * Math.cos(4 * t); s += l * Math.sin(4 * t);
    }
  }
  return Math.atan2(s, c) / 4;
}

/** A point in a frame whose +x runs along angle th (use with a group rotated by -th to get back). */
export function rotPt(p: V2, th: number): V2 {
  const c = Math.cos(th), s = Math.sin(th);
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
}
export function rotPts(pts: V2[], th: number): V2[] { return pts.map((p) => rotPt(p, th)); }

/** Drop repeated points and nearly straight corners (OSM rings often carry both). */
export function clean(ring: V2[], minLen = 0.4): V2[] {
  let r = ring.slice();
  if (r.length > 1 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 1e-6) r.pop();
  for (let pass = 0; pass < 3; pass++) {
    const out: V2[] = [];
    for (let i = 0; i < r.length; i++) {
      const p0 = out.length ? out[out.length - 1] : r[(i - 1 + r.length) % r.length];
      const p1 = r[i], p2 = r[(i + 1) % r.length];
      const ax = p1[0] - p0[0], az = p1[1] - p0[1], bx = p2[0] - p1[0], bz = p2[1] - p1[1];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < minLen) continue;
      const cross = (ax * bz - az * bx) / (la * lb || 1);
      if (Math.abs(cross) < 0.035 && ax * bx + az * bz > 0) continue; // under 2 degrees: straight on
      out.push(p1);
    }
    r = out;
  }
  return r;
}

/** One wall of a plan: ends, length, unit tangent, outward unit normal (away from the building), facade angle. */
export interface Edge { a: V2; b: V2; len: number; t: V2; n: V2; ang: number; hole: boolean }

export function edgesOf(ring: V2[], hole = false): Edge[] {
  const s = Math.sign(area(ring)) || 1;
  const out: Edge[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) continue;
    const n = outward(a, b, hole ? -s : s);
    out.push({ a, b, len, t: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n, ang: faceAngle(n), hole });
  }
  return out;
}
export function planEdges(p: Plan): Edge[] {
  return [...edgesOf(p.outer), ...p.holes.flatMap((h) => edgesOf(h, true))];
}
/** Point at distance s along an edge, pushed out by d. */
export function along(e: Edge, s: number, d = 0): V2 {
  return [e.a[0] + e.t[0] * s + e.n[0] * d, e.a[1] + e.t[1] * s + e.n[1] * d];
}

/** Move a ring away from the building by d (outer rings grow, courtyards shrink). */
export function grow(ring: V2[], d: number, hole = false): V2[] { return offsetConvex(ring, hole ? -d : d); }

/** Convex corners of a ring (both walls at least minEdge long) with the outward diagonal. */
export function corners(ring: V2[], minEdge = 2): { p: V2; d: V2 }[] {
  const s = Math.sign(area(ring)) || 1;
  const out: { p: V2; d: V2 }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p0 = ring[(i - 1 + ring.length) % ring.length], p1 = ring[i], p2 = ring[(i + 1) % ring.length];
    const ax = p1[0] - p0[0], az = p1[1] - p0[1], bx = p2[0] - p1[0], bz = p2[1] - p1[1];
    if (Math.hypot(ax, az) < minEdge || Math.hypot(bx, bz) < minEdge) continue;
    if ((ax * bz - az * bx) * s <= 0) continue;
    const na = outward(p0, p1, s), nb = outward(p1, p2, s);
    const l = Math.hypot(na[0] + nb[0], na[1] + nb[1]) || 1;
    out.push({ p: p1, d: [(na[0] + nb[0]) / l, (na[1] + nb[1]) / l] });
  }
  return out;
}

/** Point in polygon (even-odd). */
export function inside(p: V2, poly: V2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export function inPlan(p: V2, plan: Plan): boolean {
  return inside(p, plan.outer) && !plan.holes.some((h) => inside(p, h));
}
/** Axis-aligned rectangle as a ring. */
export function rect(x0: number, z0: number, x1: number, z1: number): V2[] {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

// ------------------------------------------------------------------------------------------ strips

/** Raw triangle soup with flat normals; faces are wound to face the requested side. */
export class Soup {
  private p: number[] = [];
  tri(a: number[], b: number[], c: number[]) { this.p.push(...a, ...b, ...c); }
  /** Vertical quad on a-b from y0 to y1 facing the horizontal normal n. */
  vquad(a: V2, b: V2, y0: number, y1: number, n: V2) {
    const a0 = [a[0], y0, a[1]], b0 = [b[0], y0, b[1]], b1 = [b[0], y1, b[1]], a1 = [a[0], y1, a[1]];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    if (-dz * n[0] + dx * n[1] >= 0) { this.tri(a0, b0, b1); this.tri(a0, b1, a1); }
    else { this.tri(a0, b1, b0); this.tri(a0, a1, b1); }
  }
  /** Horizontal triangle at height y facing up (+1) or down (-1). */
  htri(p: V2, q: V2, r: V2, y: number, up = 1) {
    const ux = q[0] - p[0], uz = q[1] - p[1], vx = r[0] - p[0], vz = r[1] - p[1];
    const A = [p[0], y, p[1]], B = [q[0], y, q[1]], C = [r[0], y, r[1]];
    if ((uz * vx - ux * vz) * up > 0) this.tri(A, B, C); else this.tri(A, C, B);
  }
  hquad(p0: V2, p1: V2, p2: V2, p3: V2, y: number, up = 1) { this.htri(p0, p1, p2, y, up); this.htri(p0, p2, p3, y, up); }
  get empty() { return this.p.length === 0; }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.computeVertexNormals();
    return g;
  }
}

function each(plan: Plan, fn: (ring: V2[], hole: boolean) => void) {
  fn(plan.outer, false);
  for (const h of plan.holes) fn(h, true);
}

/** Walls of a plan from y0 to y1, pushed out by d (outer faces out, courtyard faces in). */
export function walls(P: Parts, mat: MatName, plan: Plan, y0: number, y1: number, d = 0) {
  const S = new Soup();
  each(plan, (ring, hole) => {
    const r = d ? grow(ring, d, hole) : ring;
    for (const e of edgesOf(r, hole)) S.vquad(e.a, e.b, y0, y1, e.n);
  });
  P.add(mat, S.geo());
}

/** Flat roof (terrace) over a plan at height y; inset shrinks it inside a parapet. */
export function roof(P: Parts, mat: MatName, plan: Plan, y: number, inset = 0) {
  const o = inset ? grow(plan.outer, -inset) : plan.outer;
  const sh = new THREE.Shape(o.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of plan.holes) {
    const hh = inset ? grow(h, -inset, true) : h;
    sh.holes.push(new THREE.Path(hh.map(([x, z]) => new THREE.Vector2(x, -z))));
  }
  const g = new THREE.ShapeGeometry(sh, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  P.add(mat, g);
}

/** A band standing out d from the walls between y0 and y1, with its top (and optionally its underside). */
export function band(P: Parts, mat: MatName, plan: Plan, y0: number, y1: number, d: number, under = false) {
  const S = new Soup();
  each(plan, (ring, hole) => {
    const o = grow(ring, d, hole);
    for (const e of edgesOf(o, hole)) S.vquad(e.a, e.b, y0, y1, e.n);
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      S.hquad(ring[i], ring[j], o[j], o[i], y1, 1);
      if (under) S.hquad(ring[i], ring[j], o[j], o[i], y0, -1);
    }
  });
  P.add(mat, S.geo());
}

/** Parapet standing on the wall head at y: outer face, inner face t inside and a coping lip on top. */
export function parapet(P: Parts, mat: MatName, cop: MatName, plan: Plan, y: number, h: number, t = 0.4) {
  const S = new Soup(), C = new Soup();
  const ch = 0.2;
  each(plan, (ring, hole) => {
    const out = grow(ring, 0.04, hole), inn = grow(ring, -t, hole);
    const co = grow(ring, 0.16, hole), ci = grow(ring, -t - 0.06, hole);
    for (const e of edgesOf(out, hole)) S.vquad(e.a, e.b, y, y + h, e.n);
    for (const e of edgesOf(inn, hole)) S.vquad(e.a, e.b, y, y + h, [-e.n[0], -e.n[1]]);
    for (const e of edgesOf(co, hole)) C.vquad(e.a, e.b, y + h, y + h + ch, e.n);
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      C.hquad(ci[i], ci[j], co[j], co[i], y + h + ch, 1);
    }
  });
  P.add(mat, S.geo());
  P.add(cop, C.geo());
}

/** A simple block: walls, roof terrace, optional parapet. Returns the plan for further detail. */
export function block(P: Parts, plan: Plan, o: { h: number; wall: MatName; roof: MatName; par?: number; parMat?: MatName; cop?: MatName; y0?: number }) {
  const y0 = o.y0 ?? 0;
  walls(P, o.wall, plan, y0, o.h);
  if (o.par) {
    parapet(P, o.parMat ?? o.wall, o.cop ?? 'white', plan, o.h, o.par);
    roof(P, o.roof, plan, o.h + 0.05, 0.3);
  } else roof(P, o.roof, plan, o.h);
  return plan;
}

// --------------------------------------------------------------------------------------- openings

export interface OpenOpts {
  y: number; h: number; w: number; bay: number;
  /** 0 = flat-headed, 1 = round, > 1 pointed */
  point?: number; seg?: number;
  lit?: number; dark?: MatName;
  /** surround material and width */
  frame?: MatName; fw?: number;
  minLen?: number;
  /** distance in front of the wall plane */
  out?: number;
  skip?: (p: V2, e: Edge) => boolean;
  /** only edges facing within this many degrees of the given angle */
  facing?: { ang: number; tol: number };
  /** keep this far from both ends of each edge */
  margin?: number;
}

/** Window or arcade openings along every edge, one per bay per call (call once per storey). */
export function openings(P: Parts, rand: Rand, es: Edge[], o: OpenOpts): number {
  const point = o.point ?? 0, seg = o.seg ?? 2, out = o.out ?? 0.06, fw = o.fw ?? 0.3, margin = o.margin ?? 0.6;
  const geo = point ? new THREE.ShapeGeometry(archShape(o.w, o.h, point, seg), 1) : new THREE.PlaneGeometry(o.w, o.h).translate(0, o.h / 2, 0);
  const fgeo = o.frame
    ? (point ? new THREE.ShapeGeometry(archShape(o.w + 2 * fw, o.h + fw, point, seg), 1) : new THREE.PlaneGeometry(o.w + 2 * fw, o.h + fw).translate(0, (o.h + fw) / 2, 0))
    : null;
  let n = 0;
  for (const e of es) {
    if (o.facing) {
      let da = Math.abs(e.ang - o.facing.ang) % (Math.PI * 2);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da > (o.facing.tol * Math.PI) / 180) continue;
    }
    const usable = e.len - 2 * margin;
    if (usable < (o.minLen ?? o.w + 0.8)) continue;
    const k = Math.max(1, Math.round(usable / o.bay));
    for (let i = 0; i < k; i++) {
      const s = margin + ((i + 0.5) * usable) / k;
      const p = along(e, s, out);
      if (o.skip?.(p, e)) continue;
      const mat: MatName = rand() < (o.lit ?? 0) ? 'windowLit' : (o.dark ?? 'darkGlass');
      P.add(mat, geo.clone().rotateY(e.ang).translate(p[0], o.y, p[1]));
      if (fgeo) {
        const q = along(e, s, out * 0.5);
        P.add(o.frame!, fgeo.clone().rotateY(e.ang).translate(q[0], o.y - fw * 0.5, q[1]));
      }
      n++;
    }
  }
  geo.dispose();
  fgeo?.dispose();
  return n;
}

/** Vertical strips (pilasters) at bay lines along edges: cheap coloured quads just proud of the wall. */
export function pilasters(P: Parts, mat: MatName, es: Edge[], o: { y0: number; y1: number; w: number; bay: number; margin?: number; minLen?: number; out?: number; ends?: boolean; skip?: (p: V2) => boolean }) {
  const margin = o.margin ?? 0.6, out = o.out ?? 0.09;
  for (const e of es) {
    const usable = e.len - 2 * margin;
    if (usable < (o.minLen ?? 3)) continue;
    const k = Math.max(1, Math.round(usable / o.bay));
    for (let i = o.ends ? 0 : 1; i <= (o.ends ? k : k - 1); i++) {
      const p = along(e, margin + (i * usable) / k, out);
      if (o.skip?.(p)) continue;
      P.quad(mat, p[0], (o.y0 + o.y1) / 2, p[1], o.w, o.y1 - o.y0, e.ang);
    }
  }
}

// ------------------------------------------------------------------------------- domes and towers

export type DomeKind = 'round' | 'onion' | 'bulb' | 'cone' | 'flat';

/** Profile (radius, height) of a dome of base radius r and height h. */
export function domeProf(r: number, h: number, kind: DomeKind = 'round', steps = 5): [number, number][] {
  const out: [number, number][] = [];
  if (kind === 'round' || kind === 'flat') {
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * (Math.PI / 2);
      out.push([r * Math.cos(a), h * Math.sin(a)]);
    }
  } else if (kind === 'onion') {
    // swelling bulb that draws in to a point (Indo-Saracenic)
    const k: [number, number][] = [[1.0, 0], [1.16, 0.2], [1.1, 0.42], [0.8, 0.64], [0.42, 0.83], [0.1, 0.96], [0, 1]];
    for (const [a, b] of k) out.push([r * a, h * b]);
  } else if (kind === 'bulb') {
    const k: [number, number][] = [[1.0, 0], [1.08, 0.25], [0.95, 0.55], [0.55, 0.82], [0, 1]];
    for (const [a, b] of k) out.push([r * a, h * b]);
  } else {
    out.push([r, 0], [0, h]);
  }
  return out;
}

/** Flat-shaded lathe from (radius, height) pairs, base at y = 0. */
export function lathe(prof: [number, number][], seg: number, phase = Math.PI / seg): THREE.BufferGeometry {
  return flat(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), seg, phase));
}

export function dome(P: Parts, mat: MatName, x: number, y: number, z: number, r: number, h: number, kind: DomeKind = 'round', seg = 12, steps = 5) {
  P.add(mat, lathe(domeProf(r, h, kind, steps), seg).translate(x, y, z));
}

/** Small finial: a ball and a spike. */
export function finial(P: Parts, mat: MatName, x: number, y: number, z: number, s = 1) {
  P.add(mat, flat(new THREE.OctahedronGeometry(0.28 * s, 0)).translate(x, y + 0.25 * s, z));
  P.add(mat, new THREE.ConeGeometry(0.1 * s, 1.0 * s, 4, 1, true).translate(x, y + 0.5 * s + 0.5 * s, z));
}

/** Ring of a polygonal cylinder (open), for shafts, drums and bands. */
export function shaft(r: number, y0: number, y1: number, sides: number, x = 0, z = 0, open = true): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, sides, 1, open, Math.PI / sides);
  g.translate(x, (y0 + y1) / 2, z);
  return flat(g);
}

export interface MinaretOpts {
  r: number; y0: number; y1: number; sides?: number;
  body: MatName; trim?: MatName; bands?: number[];
  dome: MatName; domeH?: number; kind?: DomeKind; tip?: MatName;
}
/** Octagonal minaret or corner turret with bands, an open collar, a dome and a spike. Returns the top height. */
export function minaret(P: Parts, x: number, z: number, o: MinaretOpts): number {
  const sides = o.sides ?? 8, trim = o.trim ?? 'white';
  P.add(o.body, shaft(o.r, o.y0, o.y1, sides, x, z));
  for (const y of o.bands ?? []) P.add(trim, shaft(o.r + 0.1, y, y + 0.35, sides, x, z));
  P.add(trim, shaft(o.r + 0.24, o.y1, o.y1 + 0.3, sides, x, z));
  const dh = o.domeH ?? o.r * 1.9;
  P.add(o.dome, lathe(domeProf(o.r + 0.14, dh, o.kind ?? 'bulb'), sides).translate(x, o.y1 + 0.3, z));
  const top = o.y1 + 0.3 + dh;
  if (o.tip) {
    const sh = 0.45 + o.r * 0.45;
    P.add(o.tip, new THREE.ConeGeometry(0.08 + o.r * 0.05, sh, 4, 1, true).translate(x, top - 0.08 + sh / 2, z));
  }
  return top;
}

/** Open pavilion (chhatri): four posts, a slab and a small dome. */
export function chhatri(P: Parts, x: number, z: number, y: number, a: number, h: number, post: MatName, domeMat: MatName, tip?: MatName) {
  const p = Math.max(0.18, a * 0.16);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    P.box(post, x + sx * (a - p) - p, y, z + sz * (a - p) - p, x + sx * (a - p) + p, y + h, z + sz * (a - p) + p);
  }
  P.box(post, x - a - 0.15, y + h, z - a - 0.15, x + a + 0.15, y + h + 0.3, z + a + 0.15);
  P.add(domeMat, lathe(domeProf(a * 0.95, a * 1.5, 'bulb'), 8).translate(x, y + h + 0.3, z));
  if (tip) P.add(tip, new THREE.ConeGeometry(0.1, 0.8, 4, 1, true).translate(x, y + h + 0.3 + a * 1.5 + 0.32, z));
}

/** A raised clerestory or attic block (rectangle x0..x1, z0..z1) from y0 to y1, with a band of windows on the long sides. */
export function attic(P: Parts, rand: Rand, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number,
  o: { wall: MatName; roof: MatName; trim: MatName; lit?: number; bay?: number; win?: number }) {
  const plan: Plan = { outer: rect(x0, z0, x1, z1), holes: [] };
  walls(P, o.wall, plan, y0, y1);
  band(P, o.trim, plan, y1 - 0.35, y1, 0.18);
  roof(P, o.roof, plan, y1);
  const wh = Math.min(1.6, (y1 - y0) * 0.55);
  openings(P, rand, edgesOf(plan.outer), { y: y0 + (y1 - y0 - 0.35 - wh) / 2, h: wh, w: o.win ?? 1.2, bay: o.bay ?? 3.2, lit: o.lit ?? 0.4, minLen: 4 });
}

/** A clock face (dial, rim and hands showing ten past ten) on a wall facing ang. */
export function clock(P: Parts, x: number, y: number, z: number, ang: number, r: number) {
  const nx = Math.sin(ang), nz = Math.cos(ang);
  P.add('black', new THREE.RingGeometry(r, r + 0.16, 20).rotateY(ang).translate(x + nx * 0.06, y, z + nz * 0.06));
  P.add('clockFace', new THREE.CircleGeometry(r, 20).rotateY(ang).translate(x + nx * 0.06, y, z + nz * 0.06));
  for (const [len, w, th] of [[r * 0.55, 0.14, (10 + 10 / 60) / 12], [r * 0.85, 0.09, 10 / 60]] as const) {
    const g = new THREE.BoxGeometry(w, len, 0.05).translate(0, len / 2 - 0.08, 0);
    g.rotateZ(-th * Math.PI * 2);
    g.rotateY(ang);
    g.translate(x + nx * 0.12, y, z + nz * 0.12);
    P.add('black', g);
  }
}

/** Build all buckets into a child group rotated back from the wall frame (angle th) to the model frame. */
export function finish(P: Parts, group: THREE.Group, th: number) {
  const inner = new THREE.Group();
  inner.name = 'plan';
  inner.rotation.y = -th;
  P.build(inner);
  group.add(inner);
}

/** Triangles per material (for checking the budget). */
export function triStats(root: THREE.Object3D): string {
  const out: string[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    out.push(`${m.name}:${Math.round((g.index ? g.index.count : g.getAttribute('position').count) / 3)}`);
  });
  return out.join(' ');
}
