import * as THREE from 'three';
import type { SceneData } from '../data/types';
import type { Grid } from '../world/sampler';
import { hasModel } from '../landmarks/registry';

interface Label {
  el: HTMLElement; p: THREE.Vector3; pri: number; maxMpp: number; minMpp: number;
  w: number; h: number; on: boolean;
}

// how high above the ground each landmark label sits (metres)
const LIFT: Record<string, number> = {
  lighthouse: 56, lic_building: 62, chennai_central: 52, chepauk_stadium: 42, nehru_stadium: 40,
  fort_st_george: 26, marina_beach: 4, high_court: 40, ripon_building: 46, napier_bridge: 14,
};

export function buildLabels(root: HTMLElement, data: SceneData, ter: Grid) {
  const labels: Label[] = [];
  const add = (cls: string, text: string, ta: string, x: number, z: number, lift: number, pri: number, maxMpp: number, minMpp = 0) => {
    if (!text) return;
    const el = document.createElement('div');
    el.className = `label ${cls}`;
    const main = document.createElement('span');
    main.textContent = text;
    el.append(main);
    if (ta && ta !== text) {
      const t = document.createElement('span');
      t.className = 'ta';
      t.lang = 'ta';
      t.textContent = ta;
      el.append(t);
    }
    root.append(el);
    labels.push({ el, p: new THREE.Vector3(x, ter.at(x, z) + lift, z), pri, maxMpp, minMpp, w: 0, h: 0, on: false });
  };
  for (const l of data.landmarks) {
    // stations get their own label; modelled landmarks are labelled once their model exists
    if (l.key === 'chepauk_station' || (l.model && !hasModel(l.key))) continue;
    const major = l.camera;
    add('landmark', l.title, l.name_ta, l.x, l.z, LIFT[l.key] ?? 22, major ? 100 : 80, major ? 99 : 1.1);
  }
  for (const p of data.labels.places) add('place', p.n, p.ta, p.x, p.z, 30, 60, 4, 0.35);
  for (const s of data.labels.stations) add('station', s.n, s.ta, s.x, s.z, 14, 50, 1.6);
  for (const w of data.labels.water) add(w.sea ? 'water sea' : 'water', w.n, w.ta, w.x, w.z, 2, w.sea ? 70 : 45, w.sea ? 99 : 2.5);
  for (const r of data.labels.roads) add('road', r.n, r.ta, r.x, r.z, 3, 30 + Math.min(15, (r.len ?? 0) / 400), 1.9);
  for (const p of data.labels.parks) add('park', p.n, p.ta, p.x, p.z, 4, 25 + Math.min(10, (p.a ?? 0) / 20000), 1.0);
  labels.sort((a, b) => b.pri - a.pri);

  let visible = true, measured = false, frame = 0;
  const v = new THREE.Vector3();
  const lastView = new THREE.Matrix4(), lastProj = new THREE.Matrix4();
  const rects: number[] = [];

  return {
    count: labels.length,
    all: labels,
    setVisible(on: boolean) { visible = on; root.style.display = on ? '' : 'none'; },
    update(cam: THREE.Camera, width: number, height: number, mpp: number, force = false) {
      if (!visible) return;
      frame++;
      const moved = !cam.matrixWorldInverse.equals(lastView) || !cam.projectionMatrix.equals(lastProj);
      if (!moved && !force && frame % 30 !== 0) return;
      lastView.copy(cam.matrixWorldInverse);
      lastProj.copy(cam.projectionMatrix);
      if (!measured) {
        for (const l of labels) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
        measured = true;
      }
      rects.length = 0;
      for (const l of labels) {
        let show = mpp <= l.maxMpp && mpp >= l.minMpp;
        let sx = 0, sy = 0;
        if (show) {
          v.copy(l.p).project(cam);
          sx = (v.x * 0.5 + 0.5) * width;
          sy = (-v.y * 0.5 + 0.5) * height;
          show = v.z < 1 && sx > -40 && sx < width + 40 && sy > -20 && sy < height + 20;
        }
        if (show) {
          const x0 = sx - l.w / 2 - 4, x1 = sx + l.w / 2 + 4, y0 = sy - l.h - 2, y1 = sy + 2;
          for (let i = 0; i < rects.length; i += 4) {
            if (x0 < rects[i + 2] && x1 > rects[i] && y0 < rects[i + 3] && y1 > rects[i + 1]) { show = false; break; }
          }
          if (show) rects.push(x0, y0, x1, y1);
        }
        if (show) l.el.style.transform = `translate(${(sx - l.w / 2).toFixed(1)}px, ${(sy - l.h).toFixed(1)}px)`;
        if (show !== l.on) { l.on = show; l.el.classList.toggle('on', show); }
      }
    },
  };
}
