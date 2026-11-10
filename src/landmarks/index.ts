import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Landmark, SceneData } from '../data/types';
import { Kit, type LandmarkBuild } from './kit';
import { hasModel, loadBuilder } from './registry';

export interface LoadedLandmarks {
  kit: Kit;
  group: THREE.Group;
  built: { lm: Landmark; build: LandmarkBuild; object: THREE.Group }[];
  failed: string[];
  drawCallsSaved?: number;
  update(t: number, night: number): void;
}

/** Load every hand-modelled landmark that has a model file, in parallel, without blocking the map. */
export async function loadLandmarks(data: SceneData, parent: THREE.Object3D): Promise<LoadedLandmarks> {
  const kit = new Kit();
  const group = new THREE.Group();
  group.name = 'landmarks';
  parent.add(group);
  const out: LoadedLandmarks = {
    kit, group, built: [], failed: [],
    update(t, night) {
      kit.setNight(night);
      for (const b of out.built) b.build.animate?.(t, night);
    },
  };
  const wanted = data.landmarks.filter((l) => l.model && hasModel(l.key));
  await Promise.all(wanted.map(async (lm) => {
    try {
      const fn = await loadBuilder(lm.key);
      if (!fn) throw new Error('no build()');
      const build = fn(lm, kit);
      const holder = new THREE.Group();
      holder.name = `landmark:${lm.key}`;
      holder.position.set(lm.x, lm.ground, lm.z);
      holder.rotation.y = -kit.frame(lm).angle;
      holder.add(build.group);
      holder.traverse((o) => { o.matrixAutoUpdate = o === holder || o.matrixAutoUpdate; });
      group.add(holder);
      out.built.push({ lm, build, object: holder });
    } catch (e) {
      console.error(`landmark ${lm.key} failed`, e);
      out.failed.push(lm.key);
    }
  }));
  out.drawCallsSaved = mergeStatic(group);
  return out;
}

/**
 * Merge every static landmark mesh into one mesh per material (and shadow setting), in world
 * space. Only the lighthouse beam rotor turns, so it stays a separate object.
 */
function mergeStatic(group: THREE.Group): number {
  group.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[] }>();
  const done: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (p.name === 'beamRotor') return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.morphAttributes = {};
    g.applyMatrix4(m.matrixWorld);
    const key = `${m.material.uuid}:${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}`;
    if (!buckets.has(key)) buckets.set(key, { mat: m.material, cast: m.castShadow, receive: m.receiveShadow, geos: [] });
    buckets.get(key)!.geos.push(g);
    done.push(m);
  });
  const shared = new Set<THREE.BufferGeometry>();
  for (const m of done) { m.parent?.remove(m); shared.add(m.geometry); }
  shared.forEach((g) => g.dispose());
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.name = 'landmarks:merged';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return done.length - buckets.size;
}
