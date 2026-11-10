// Geometry builder: turns the packed world arrays into ready-to-upload vertex buffers,
// off the main thread so the loading screen stays smooth.
import earcut from 'earcut';
import { view } from '../data/load';
import type { ArrayInfo, SceneMeta, Typed } from '../data/types';
import { coastGrid, terrainGrid, type Grid } from '../world/sampler';

export interface MeshData {
  position: Float32Array; normal?: Float32Array; color?: Float32Array; uv?: Float32Array;
  info?: Uint8Array; height?: Float32Array; index: Uint32Array;
  bounds?: [number, number, number, number, number, number];
}
export interface BuildRequest { buffer: ArrayBuffer; arrays: Record<string, ArrayInfo>; meta: SceneMeta; chunk: number }
export interface BuildResult {
  terrain: MeshData; cover: MeshData; roads: MeshData; marks: MeshData; plinth: MeshData; buildings: MeshData[];
  stats: { buildings: number; buildingVerts: number; buildingTris: number; ms: number };
}

const srgb = (hex: number): [number, number, number] => {
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [f(((hex >> 16) & 255) / 255), f(((hex >> 8) & 255) / 255), f((hex & 255) / 255)];
};

const COVER_HEX: Record<string, number> = {
  land: 0xd6cebd, residential: 0xdcd2c2, commercial: 0xdfd1c4, industrial: 0xd2ced2, institution: 0xdbd3b9,
  railway: 0xc8beb1, construction: 0xcdbf9e, cemetery: 0xb7c6a3, green: 0xa6c27f, park: 0x8cb86a,
  parking: 0xc8c6c1, plaza: 0xd8d2c7, pitch: 0x6aa84f, track: 0xb3563c, platform: 0xc1bbb2,
  sand: 0xedd8a8, water: 0x6a9ea6,
};
// major, minor, service, path, raised footpath, rail ballast
const ROAD_HEX = [0x54575d, 0x6b6d71, 0x84858a, 0xb8b0a3, 0xc5bdb1, 0x8a7f73];
const ROAD_Y = [0.07, 0.065, 0.06, 0.05, 0.16, 0.045];

class Builder {
  pos: number[] = []; col: number[] = []; idx: number[] = [];
  vert(x: number, y: number, z: number, c: [number, number, number]) {
    this.pos.push(x, y, z); this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }
  out(): MeshData {
    return { position: new Float32Array(this.pos), color: new Float32Array(this.col), index: new Uint32Array(this.idx) };
  }
}

function polygons(a: Record<string, Typed>, prefix: string, q: number,
  fn: (flat: number[], holes: number[], p: number) => void) {
  const fr = a[`${prefix}_first_ring`], rs = a[`${prefix}_ring_start`], xz = a[`${prefix}_xz`];
  const n = fr.length - 1;
  for (let p = 0; p < n; p++) {
    const flat: number[] = [];
    const holes: number[] = [];
    for (let r = fr[p]; r < fr[p + 1]; r++) {
      if (r > fr[p]) holes.push(flat.length / 2);
      for (let v = rs[r]; v < rs[r + 1]; v++) flat.push(xz[2 * v] * q, xz[2 * v + 1] * q);
    }
    fn(flat, holes, p);
  }
}

function overlay(b: Builder, flat: number[], holes: number[], ter: Grid, dy: number, c: [number, number, number]) {
  const tri = earcut(flat, holes, 2);
  if (!tri.length) return;
  const base = b.pos.length / 3;
  for (let i = 0; i < flat.length; i += 2) b.vert(flat[i], ter.at(flat[i], flat[i + 1]) + dy, flat[i + 1], c);
  for (let i = 0; i < tri.length; i += 3) {
    // keep every triangle facing up (+y)
    const p0 = tri[i], p1 = tri[i + 1], p2 = tri[i + 2];
    const cross = (flat[2 * p1 + 1] - flat[2 * p0 + 1]) * (flat[2 * p2] - flat[2 * p0]) - (flat[2 * p1] - flat[2 * p0]) * (flat[2 * p2 + 1] - flat[2 * p0 + 1]);
    if (cross >= 0) b.idx.push(base + p0, base + p1, base + p2);
    else b.idx.push(base + p0, base + p2, base + p1);
  }
}

function buildTerrain(meta: SceneMeta, ter: Grid, coast: Grid): MeshData {
  const [x0, z0, x1, z1] = meta.frame_m;
  const step = 20;
  const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
  const land = srgb(COVER_HEX.land), seabed = srgb(0xb9a77e), deep = srgb(0x3f6f78);
  const b = new Builder();
  for (let j = 0; j < nz; j++) {
    const z = Math.min(z1, z0 + j * step);
    for (let i = 0; i < nx; i++) {
      const x = Math.min(x1, x0 + i * step);
      const d = coast.at(x, z);
      const t = Math.min(1, Math.max(0, d / 120));
      const c: [number, number, number] = d < 0 ? land : [seabed[0] + (deep[0] - seabed[0]) * t, seabed[1] + (deep[1] - seabed[1]) * t, seabed[2] + (deep[2] - seabed[2]) * t];
      b.vert(x, ter.at(x, z), z, c);
    }
  }
  // skip cells well out at sea: the opaque sea covers them
  const offshore = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    offshore[j * nx + i] = coast.at(Math.min(x1, x0 + i * step), Math.min(z1, z0 + j * step)) > 90 ? 1 : 0;
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, c = a + nx;
    if (offshore[a] && offshore[a + 1] && offshore[c] && offshore[c + 1]) continue;
    b.idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  return b.out();
}

function buildPlinth(meta: SceneMeta, ter: Grid, coast: Grid): MeshData {
  const [x0, z0, x1, z1] = meta.frame_m;
  const bottom = -22;
  const soilTop = srgb(0x5b4a3b), soilBot = srgb(0x231b15), seaTop = srgb(0x3b8aa1), seaBot = srgb(0x0e2a36);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const edges: [number, number, number, number, number, number][] = [
    [x0, z1, x1, z1, 0, 1], [x1, z1, x1, z0, 1, 0], [x1, z0, x0, z0, 0, -1], [x0, z0, x0, z1, -1, 0],
  ];
  for (const [ax, az, bx, bz, nx, nz] of edges) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(len / 20);
    const start = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const sea = coast.at(x, z) > 0;
      const top = sea ? 0 : ter.at(x, z);
      const ct = sea ? seaTop : soilTop, cb = sea ? seaBot : soilBot;
      pos.push(x, top, z, x, bottom, z);
      nor.push(nx, 0, nz, nx, 0, nz);
      col.push(...ct, ...cb);
    }
    for (let i = 0; i < n; i++) {
      const a = start + 2 * i;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), color: new Float32Array(col), index: new Uint32Array(idx) };
}

function buildMarks(a: Record<string, Typed>, q: number, ter: Grid): MeshData {
  const b = new Builder();
  const white = srgb(0xeeebe2);
  const quad = (cx: number, cz: number, ux: number, uz: number, hl: number, hw: number) => {
    // rectangle centred at (cx, cz), half-length hl along (ux, uz), half-width hw across
    const vx = -uz, vz = ux;
    const y = ter.at(cx, cz) + 0.09;
    const i0 = b.vert(cx - ux * hl - vx * hw, y, cz - uz * hl - vz * hw, white);
    const i1 = b.vert(cx + ux * hl - vx * hw, y, cz + uz * hl - vz * hw, white);
    const i2 = b.vert(cx + ux * hl + vx * hw, y, cz + uz * hl + vz * hw, white);
    const i3 = b.vert(cx - ux * hl + vx * hw, y, cz - uz * hl + vz * hw, white);
    b.idx.push(i0, i2, i1, i0, i3, i2);
  };
  const ms = a.mark_start, mxz = a.mark_xz;
  for (let l = 0; l < ms.length - 1; l++) {
    let carry = 0;
    for (let v = ms[l]; v < ms[l + 1] - 1; v++) {
      const ax = mxz[2 * v] * q, az = mxz[2 * v + 1] * q, bx = mxz[2 * v + 2] * q, bz = mxz[2 * v + 3] * q;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      // 3 m dashes with 5 m gaps, continuing across vertices
      for (let s = carry; s < len; s += 8) {
        const e = Math.min(len, s + 3);
        if (e - s > 0.6) quad(ax + ux * (s + e) / 2, az + uz * (s + e) / 2, ux, uz, (e - s) / 2, 0.08);
      }
      carry = ((carry - len) % 8 + 8) % 8;
    }
  }
  const xing = a.xing;
  for (let i = 0; i + 3 < xing.length; i += 4) {
    const x = xing[i] * q, z = xing[i + 1] * q, ang = (xing[i + 2] / 32767) * Math.PI, w = xing[i + 3] / 8;
    const ux = Math.cos(ang), uz = Math.sin(ang);
    // zebra: bars parallel to the road, spread across its width
    for (let s = -w / 2 + 0.6; s <= w / 2 - 0.5; s += 1.1) quad(x - uz * s, z + ux * s, ux, uz, 1.5, 0.27);
  }
  return b.out();
}

function buildBuildings(a: Record<string, Typed>, meta: SceneMeta, chunk: number) {
  const q = meta.quant;
  const fr = a.bld_first_ring, rs = a.bld_ring_start, xz = a.bld_xz;
  const H = a.bld_h, MH = a.bld_minh, B = a.bld_base, CLS = a.bld_cls, SEED = a.bld_seed, HS = a.bld_hsrc, FS = a.bld_fsrc;
  const n = fr.length - 1;
  const [fx0, fz0, fx1] = meta.frame_m;
  const ncx = Math.ceil((fx1 - fx0) / chunk);
  // pass 1: chunk per building and buffer sizes per chunk
  const chunkOf = new Int32Array(n);
  const vCount = new Map<number, number>(), iCount = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r0 = fr[i], v0 = rs[r0], v1 = rs[r0 + 1];
    let cx = 0, cz = 0;
    for (let v = v0; v < v1; v++) { cx += xz[2 * v]; cz += xz[2 * v + 1]; }
    cx = (cx / (v1 - v0)) * q; cz = (cz / (v1 - v0)) * q;
    const c = Math.floor((cx - fx0) / chunk) + ncx * Math.floor((cz - fz0) / chunk);
    chunkOf[i] = c;
    const nv = rs[fr[i + 1]] - rs[fr[i]];
    const holes = fr[i + 1] - fr[i] - 1;
    vCount.set(c, (vCount.get(c) ?? 0) + nv * 4 + nv);
    iCount.set(c, (iCount.get(c) ?? 0) + nv * 6 + (nv + 2 * holes - 2) * 3);
  }
  type Acc = { pos: Float32Array; nor: Float32Array; uv: Float32Array; info: Uint8Array; h: Float32Array; idx: Uint32Array; v: number; i: number;
    b: [number, number, number, number, number, number] };
  const acc = new Map<number, Acc>();
  for (const [c, nv] of vCount) {
    acc.set(c, { pos: new Float32Array(nv * 3), nor: new Float32Array(nv * 3), uv: new Float32Array(nv * 2), info: new Uint8Array(nv * 4),
      h: new Float32Array(nv), idx: new Uint32Array(iCount.get(c)!), v: 0, i: 0, b: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] });
  }
  let tris = 0;
  for (let i = 0; i < n; i++) {
    const A = acc.get(chunkOf[i])!;
    const h = H[i] / 10, minh = MH[i] / 10, base = B[i] / 100;
    const y0 = base + minh - (minh > 0 ? 0 : 0.4), y1 = base + h;
    const cls = CLS[i], seed = SEED[i], hs = HS[i], fs = FS[i];
    const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, vv: number, roof: number) => {
      const k = A.v++;
      A.pos[3 * k] = x; A.pos[3 * k + 1] = y; A.pos[3 * k + 2] = z;
      A.nor[3 * k] = nx; A.nor[3 * k + 1] = ny; A.nor[3 * k + 2] = nz;
      A.uv[2 * k] = u; A.uv[2 * k + 1] = vv;
      A.info[4 * k] = cls; A.info[4 * k + 1] = seed; A.info[4 * k + 2] = hs | (fs << 4); A.info[4 * k + 3] = roof;
      A.h[k] = h;
      const bb = A.b;
      if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (z < bb[2]) bb[2] = z;
      if (x > bb[3]) bb[3] = x; if (y > bb[4]) bb[4] = y; if (z > bb[5]) bb[5] = z;
      return k;
    };
    const flat: number[] = [], holes: number[] = [];
    for (let r = fr[i]; r < fr[i + 1]; r++) {
      if (r > fr[i]) holes.push(flat.length / 2);
      const v0 = rs[r], v1 = rs[r + 1];
      let u = 0;
      for (let v = v0; v < v1; v++) {
        const w = v + 1 < v1 ? v + 1 : v0;
        const ax = xz[2 * v] * q, az = xz[2 * v + 1] * q, bx = xz[2 * w] * q, bz = xz[2 * w + 1] * q;
        flat.push(ax, az);
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-6;
        const nx = dz / len, nz = -dx / len;
        const a0 = put(ax, y0, az, nx, 0, nz, u, y0 - base, 0);
        const b0 = put(bx, y0, bz, nx, 0, nz, u + len, y0 - base, 0);
        const b1 = put(bx, y1, bz, nx, 0, nz, u + len, h, 0);
        const a1 = put(ax, y1, az, nx, 0, nz, u, h, 0);
        A.idx[A.i++] = a0; A.idx[A.i++] = b1; A.idx[A.i++] = b0;
        A.idx[A.i++] = a0; A.idx[A.i++] = a1; A.idx[A.i++] = b1;
        u += len;
        tris += 2;
      }
    }
    const roofBase = A.v;
    for (let k = 0; k < flat.length; k += 2) put(flat[k], y1, flat[k + 1], 0, 1, 0, flat[k], flat[k + 1], 1);
    const tri = earcut(flat, holes, 2);
    for (let k = 0; k < tri.length; k += 3) {
      const p0 = tri[k], p1 = tri[k + 1], p2 = tri[k + 2];
      const cross = (flat[2 * p1 + 1] - flat[2 * p0 + 1]) * (flat[2 * p2] - flat[2 * p0]) - (flat[2 * p1] - flat[2 * p0]) * (flat[2 * p2 + 1] - flat[2 * p0 + 1]);
      A.idx[A.i++] = roofBase + p0;
      if (cross >= 0) { A.idx[A.i++] = roofBase + p1; A.idx[A.i++] = roofBase + p2; }
      else { A.idx[A.i++] = roofBase + p2; A.idx[A.i++] = roofBase + p1; }
      tris++;
    }
  }
  const out: MeshData[] = [];
  let verts = 0;
  for (const A of acc.values()) {
    verts += A.v;
    out.push({ position: A.pos.subarray(0, A.v * 3), normal: A.nor.subarray(0, A.v * 3), uv: A.uv.subarray(0, A.v * 2),
      info: A.info.subarray(0, A.v * 4), height: A.h.subarray(0, A.v), index: A.idx.slice(0, A.i), bounds: A.b });
  }
  return { meshes: out, verts, tris, n };
}

self.onmessage = (ev: MessageEvent<BuildRequest>) => {
  const t0 = performance.now();
  const { buffer, arrays, meta, chunk } = ev.data;
  const a: Record<string, Typed> = {};
  for (const k in arrays) a[k] = view(buffer, arrays[k]);
  const q = meta.quant;
  const ter = terrainGrid(meta.terrain, a.terrain_h);
  const coast = coastGrid(meta.coast, a.coast_sdf);

  const terrain = buildTerrain(meta, ter, coast);
  const cover = new Builder();
  const coverCls = a.cover_cls;
  polygons(a, 'cover', q, (flat, holes, p) => {
    const name = meta.cover_classes[coverCls[p]];
    overlay(cover, flat, holes, ter, 0.03, srgb(COVER_HEX[name] ?? 0xd0d0d0));
  });
  const roads = new Builder();
  const roadCls = a.road_cls;
  polygons(a, 'road', q, (flat, holes, p) => {
    const c = roadCls[p];
    overlay(roads, flat, holes, ter, ROAD_Y[c] ?? 0.06, srgb(ROAD_HEX[c] ?? 0x666666));
  });
  const marks = buildMarks(a, q, ter);
  const plinth = buildPlinth(meta, ter, coast);
  const bl = buildBuildings(a, meta, chunk);
  const result: BuildResult = {
    terrain, cover: cover.out(), roads: roads.out(), marks, plinth, buildings: bl.meshes,
    stats: { buildings: bl.n, buildingVerts: bl.verts, buildingTris: bl.tris, ms: Math.round(performance.now() - t0) },
  };
  const transfer: ArrayBuffer[] = [];
  const add = (m: MeshData) => { for (const v of Object.values(m)) if (ArrayBuffer.isView(v)) transfer.push((v as Typed).buffer as ArrayBuffer); };
  [result.terrain, result.cover, result.roads, result.marks, result.plinth, ...result.buildings].forEach(add);
  (self as unknown as Worker).postMessage(result, [...new Set(transfer)]);
};
