import * as THREE from 'three';
import type { Landmark, SceneData } from '../data/types';
import { Kit, type LandmarkBuild } from './kit';
import { hasModel, loadBuilder } from './registry';

export interface LoadedLandmarks {
  kit: Kit;
  group: THREE.Group;
  built: { lm: Landmark; build: LandmarkBuild; object: THREE.Group }[];
  failed: string[];
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
  return out;
}
