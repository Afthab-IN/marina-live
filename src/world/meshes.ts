import * as THREE from 'three';
import type { MeshData } from '../worker/build';

export function geometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  if (d.normal) g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3, d.normal instanceof Int8Array));
  if (d.color) g.setAttribute('color', new THREE.BufferAttribute(d.color, 3));
  if (d.uv) g.setAttribute('aFac', new THREE.BufferAttribute(d.uv, 2));
  if (d.info) g.setAttribute('aInfo', new THREE.BufferAttribute(d.info, 4));
  if (d.height) g.setAttribute('aH', new THREE.BufferAttribute(d.height, 1));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  if (!d.normal) g.computeVertexNormals();
  if (d.bounds) {
    const [a, b, c, e, f, h] = d.bounds;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(a, b, c), new THREE.Vector3(e, f, h));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  } else {
    g.computeBoundingSphere();
  }
  return g;
}

export function mesh(d: MeshData, mat: THREE.Material, opts: { order?: number; cast?: boolean; receive?: boolean; name?: string } = {}) {
  const m = new THREE.Mesh(geometry(d), mat);
  m.renderOrder = opts.order ?? 0;
  m.castShadow = opts.cast ?? false;
  m.receiveShadow = opts.receive ?? true;
  m.name = opts.name ?? '';
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}
