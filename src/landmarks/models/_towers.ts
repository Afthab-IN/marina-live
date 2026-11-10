// Shared helpers for the hand-modelled towers (lighthouse, LIC, Central). Never loaded as a landmark.
import * as THREE from 'three';
import type { Kit, MatName } from '../kit';

export type V2 = [number, number];

/** Collects geometry per material; build() merges every bucket into one shadow-casting mesh. */
export class Parts {
  private buckets = new Map<MatName, THREE.BufferGeometry[]>();
  constructor(readonly kit: Kit) {}

  add(mat: MatName, ...geos: THREE.BufferGeometry[]): this {
    let b = this.buckets.get(mat);
    if (!b) { b = []; this.buckets.set(mat, b); }
    b.push(...geos);
    return this;
  }

  /** Axis-aligned box between two corners. */
  box(mat: MatName, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return this.add(mat, g);
  }

  /** Box mirrored across x = 0 (adds both copies). */
  boxMX(mat: MatName, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    this.box(mat, x0, y0, z0, x1, y1, z1);
    return this.box(mat, -x1, y0, z0, -x0, y1, z1);
  }

  /** A box of length len between two ground points, rotated to follow them. */
  beam(mat: MatName, a: V2, b: V2, y0: number, y1: number, thick: number): this {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const g = new THREE.BoxGeometry(len, y1 - y0, thick);
    g.rotateY(Math.atan2(-dz, dx));
    g.translate((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2);
    return this.add(mat, g);
  }

  /** Flat quad of size w x h centred at (x, y, z), facing the horizontal angle ang (0 = +z, PI/2 = +x). */
  quad(mat: MatName, x: number, y: number, z: number, w: number, h: number, ang: number): this {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY(ang);
    g.translate(x, y, z);
    return this.add(mat, g);
  }

  /** A flat 2D shape (drawn in its own x/y plane, base at y = 0) stood up at (x, y, z) facing ang. */
  shape(mat: MatName, s: THREE.Shape, x: number, y: number, z: number, ang: number, seg = 6): this {
    const g = new THREE.ShapeGeometry(s, seg);
    g.rotateY(ang);
    g.translate(x, y, z);
    return this.add(mat, g);
  }

  count(): number { return this.buckets.size; }

  build(parent: THREE.Object3D): Record<string, THREE.Mesh> {
    const out: Record<string, THREE.Mesh> = {};
    for (const [mat, geos] of this.buckets) {
      const m = this.kit.mesh(this.kit.merge(geos), mat);
      parent.add(m);
      out[mat] = m;
    }
    this.buckets.clear();
    return out;
  }
}

/** Seeded PRNG (mulberry32) so lit-window patterns are stable between reloads. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vertical prism from a ground polygon (x, z pairs), from y0 to y1. Flat shaded. */
export function prism(pts: V2[], y0: number, y1: number): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** Signed area of a ground polygon; > 0 means counter-clockwise in (x, z). */
export function area(pts: V2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/** Outward unit normal of edge p -> q for a polygon with orientation sign s (sign of area). */
export function outward(p: V2, q: V2, s: number): V2 {
  const dx = q[0] - p[0], dz = q[1] - p[1];
  const l = Math.hypot(dx, dz) || 1;
  return s > 0 ? [dz / l, -dx / l] : [-dz / l, dx / l];
}

/** Offset a convex polygon outwards by d (negative shrinks it). */
export function offsetConvex(pts: V2[], d: number): V2[] {
  const s = Math.sign(area(pts)) || 1;
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const na = outward(p0, p1, s), nb = outward(p1, p2, s);
    // intersect the two offset edges through p1: direction of the bisector scaled to keep distance d
    const bx = na[0] + nb[0], bz = na[1] + nb[1];
    const dot = na[0] * nb[0] + na[1] * nb[1];
    const k = d / (1 + dot);
    out.push([p1[0] + bx * k, p1[1] + bz * k]);
  }
  return out;
}

/** Cut every corner of a polygon by c metres along both edges. */
export function chamfer(pts: V2[], c: number): V2[] {
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    out.push([p[0] + ((a[0] - p[0]) / la) * c, p[1] + ((a[1] - p[1]) / la) * c]);
    out.push([p[0] + ((b[0] - p[0]) / lb) * c, p[1] + ((b[1] - p[1]) / lb) * c]);
  }
  return out;
}

/** Facade angle for quads/shapes facing the outward normal n. */
export function faceAngle(n: V2): number {
  return Math.atan2(n[0], n[1]);
}

/**
 * Arch outline of width w and total height h (base at y = 0). point = 1 gives a round arch,
 * larger values a pointed (Gothic) arch whose arcs have radius point * w / 2.
 */
export function archShape(w: number, h: number, point = 1, seg = 5): THREE.Shape {
  const a = w / 2, R = a * Math.max(1, point);
  const rise = Math.sqrt(R * R - (R - a) * (R - a));
  const s = Math.max(0, h - rise);
  const sh = new THREE.Shape();
  sh.moveTo(-a, 0);
  sh.lineTo(a, 0);
  sh.lineTo(a, s);
  const cR = a - R, angR = Math.acos(-cR / R);
  for (let i = 1; i <= seg; i++) { const t = (angR * i) / seg; sh.lineTo(cR + R * Math.cos(t), s + R * Math.sin(t)); }
  const cL = R - a, angL = Math.acos(-cL / R);
  for (let i = 1; i <= seg; i++) { const t = angL + ((Math.PI - angL) * i) / seg; sh.lineTo(cL + R * Math.cos(t), s + R * Math.sin(t)); }
  sh.closePath();
  return sh;
}

/** Make a geometry flat shaded (one normal per triangle). */
export function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.deleteAttribute('normal');
  n.computeVertexNormals();
  return n;
}

/**
 * Square-plan tower cap: a four-sided lathe with a concave ("Travancore") flare.
 * a = half width at the eaves, h = height to the apex, flare 1 = straight pyramid, > 1 concave.
 * The base sits at y = 0, centred on the axis.
 */
export function squareCap(a: number, h: number, flare = 1.6, lip = 0.3, steps = 6): THREE.BufferGeometry {
  const R = (a + lip) * Math.SQRT2, r0 = a * Math.SQRT2;
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.001, 0), new THREE.Vector2(R, 0), new THREE.Vector2(R, 0.18)];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new THREE.Vector2(Math.max(0.001, r0 * Math.pow(1 - t, flare)), 0.18 + t * (h - 0.18)));
  }
  return flat(new THREE.LatheGeometry(pts, 4, Math.PI / 4));
}

/** Square pinnacle: shaft of half width a from y0 to y1 plus a pointed four-sided top of height ht. */
export function pinnacle(x: number, z: number, a: number, y0: number, y1: number, ht: number): { shaft: THREE.BufferGeometry; top: THREE.BufferGeometry } {
  const shaft = new THREE.BoxGeometry(2 * a, y1 - y0, 2 * a).translate(x, (y0 + y1) / 2, z);
  const top = new THREE.ConeGeometry(a * 1.2 * Math.SQRT2, ht, 4, 1);
  top.rotateY(Math.PI / 4);
  top.translate(x, y1 + ht / 2, z);
  return { shaft, top: flat(top) };
}

/** Open cylinder band (for window ribbons on round buildings). */
export function ribbon(cx: number, cz: number, r: number, y0: number, y1: number, seg: number, t0 = 0, tl = Math.PI * 2): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg, 1, true, t0, tl);
  g.translate(cx, (y0 + y1) / 2, cz);
  return g;
}
