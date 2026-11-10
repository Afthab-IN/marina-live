import * as THREE from 'three';
import type { Typed } from '../data/types';

// tree_attr per tree: kind (0 broadleaf, 1 palm, 2 columnar), mapped (1 = OSM), height dm, crown radius in 1/20 m
const BROAD = [0x4f7f3a, 0x5d8c3f, 0x6a9a47, 0x47723a, 0x76a24c];
const PALM = [0x5e8e3c, 0x6b9a44];
const COLUMN = [0x3d6a35, 0x46753b];

function crownBroad() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1, 0.82, 1).translate(0, 0, 0);
  return g;
}

function crownPalm() {
  // seven drooping fronds radiating from the top of the trunk
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const f = new THREE.ConeGeometry(0.22, 1.0, 3, 1, true);
    f.rotateZ(-Math.PI / 2 + 0.45);
    f.translate(0.5, -0.12, 0);
    f.rotateY((i / 7) * Math.PI * 2);
    fronds.push(f.toNonIndexed());
  }
  return merge(fronds);
}

function crownColumn() {
  const g = new THREE.CylinderGeometry(0.5, 1, 1, 6, 1, true);
  const top = new THREE.ConeGeometry(0.5, 0.35, 6, 1, true).translate(0, 0.675, 0);
  return merge([g.toNonIndexed(), top.toNonIndexed()]);
}

function merge(geos: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  for (const g of geos) pos.push(...(g.getAttribute('position').array as Float32Array));
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

export function buildTrees(a: Record<string, Typed>, quant: number, opts: { lite: boolean }) {
  const xz = a.tree_xz, attr = a.tree_attr, ys = a.tree_y;
  const total = ys.length;
  const keep: number[] = [];
  for (let i = 0; i < total; i++) {
    // phones draw every mapped tree but only half of the illustrated ones
    if (opts.lite && attr[4 * i + 1] === 0 && i % 2 === 1) continue;
    keep.push(i);
  }
  const byKind: number[][] = [[], [], []];
  for (const i of keep) byKind[Math.min(2, attr[4 * i])].push(i);

  const group = new THREE.Group();
  group.name = 'trees';
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b5644 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  // open-ended: the caps are never visible from above or below the crown
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 5, 1, true).translate(0, 0.5, 0);
  const crowns = [crownBroad(), crownPalm(), crownColumn()];
  const palettes = [BROAD, PALM, COLUMN].map((p) => p.map((h) => new THREE.Color(h)));
  const sourceColors = { mapped: new THREE.Color(0xf2d14b), illustrated: new THREE.Color(0x9aa39a) };
  const meshes: { crown: THREE.InstancedMesh; trunk: THREE.InstancedMesh; ids: number[]; colors: Float32Array; source: Float32Array }[] = [];

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 3; k++) {
    const ids = byKind[k];
    if (!ids.length) continue;
    const crown = new THREE.InstancedMesh(crowns[k], crownMat, ids.length);
    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, ids.length);
    crown.castShadow = trunk.castShadow = !opts.lite;
    crown.receiveShadow = true;
    trunk.receiveShadow = false;
    const colors = new Float32Array(ids.length * 3), source = new Float32Array(ids.length * 3);
    ids.forEach((i, j) => {
      const x = xz[2 * i] * quant, z = xz[2 * i + 1] * quant, y = ys[i] / 100;
      const h = attr[4 * i + 2] / 10, r = attr[4 * i + 3] / 20;
      const mapped = attr[4 * i + 1] === 1;
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      // trunk: up to where the crown starts
      const trunkH = k === 1 ? h * 0.92 : k === 2 ? h * 0.18 : h * 0.42;
      p.set(x, y, z);
      s.set(k === 1 ? 0.9 : 1.2, trunkH, k === 1 ? 0.9 : 1.2);
      m.compose(p, q, s);
      trunk.setMatrixAt(j, m);
      if (k === 0) { p.set(x, y + trunkH + r * 0.62, z); s.set(r, r, r); }
      else if (k === 1) { p.set(x, y + h * 0.92, z); s.set(r * 1.25, r * 1.1, r * 1.25); }
      else { p.set(x, y + trunkH + (h - trunkH) / 2, z); s.set(r, h - trunkH, r); }
      m.compose(p, q, s);
      crown.setMatrixAt(j, m);
      const pal = palettes[k];
      const c = pal[Math.floor(rnd() * pal.length)];
      const shade = 0.9 + rnd() * 0.2;
      colors.set([c.r * shade, c.g * shade, c.b * shade], j * 3);
      const sc = mapped ? sourceColors.mapped : sourceColors.illustrated;
      source.set([sc.r, sc.g, sc.b], j * 3);
    });
    crown.instanceColor = new THREE.InstancedBufferAttribute(colors.slice(), 3);
    crown.instanceMatrix.needsUpdate = trunk.instanceMatrix.needsUpdate = true;
    crown.computeBoundingSphere();
    trunk.computeBoundingSphere();
    group.add(trunk, crown);
    meshes.push({ crown, trunk, ids, colors, source });
  }
  let mapped = 0;
  for (const i of keep) mapped += attr[4 * i + 1];
  let detailed = true;
  return {
    group, drawn: keep.length, mapped, total,
    /** trunks and tree shadows only matter when zoomed in */
    update(metresPerPixel: number) {
      const want = metresPerPixel < 1.1;
      if (want === detailed) return;
      detailed = want;
      for (const t of meshes) { t.trunk.visible = want; t.crown.castShadow = want && !opts.lite; t.trunk.castShadow = want && !opts.lite; }
    },
    /** Sources view: mapped trees in gold, illustrated ones in grey */
    setSources(on: boolean) {
      for (const t of meshes) {
        (t.crown.instanceColor!.array as Float32Array).set(on ? t.source : t.colors);
        t.crown.instanceColor!.needsUpdate = true;
      }
    },
  };
}
