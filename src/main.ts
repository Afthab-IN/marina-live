import * as THREE from 'three';
import { loadScene, view } from './data/load';
import type { SceneData, Typed } from './data/types';
import { CameraRig, type View } from './scene/camera';
import { Sun } from './scene/sun';
import { buildingMaterial, decalMaterial, plinthMaterial, seaMaterial, shared, terrainMaterial } from './world/materials';
import { mesh } from './world/meshes';
import type { BuildRequest, BuildResult } from './worker/build';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const params = new URLSearchParams(location.search);
const lite = params.get('q') === 'lite' || (params.get('q') !== 'high' && (matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700));
const stage = $('#stage');
const statusEl = $('#status');
const loadingText = $('#loading-text');
const bar = $('#loading-bar');

function progress(f: number, text?: string) {
  bar.style.width = `${Math.round(4 + f * 96)}%`;
  if (text) loadingText.textContent = text;
}

function buildInWorker(scene: SceneData, buffer: ArrayBuffer): Promise<BuildResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker/build.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<BuildResult>) => { resolve(e.data); worker.terminate(); };
    worker.onerror = (e) => reject(new Error(`geometry worker failed: ${e.message}`));
    const copy = buffer.slice(0);
    const req: BuildRequest = { buffer: copy, arrays: scene.packs.world.arrays, meta: scene.meta, chunk: 800 };
    worker.postMessage(req, [copy]);
  });
}

async function main() {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    throw new Error('This model needs WebGL 2, which this browser or device does not offer.');
  }
  const dpr = Number(params.get('dpr')) || Math.min(devicePixelRatio, lite ? 1.5 : 2);
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'The Marina corridor in three dimensions. Drag to move, scroll or pinch to zoom.');
  stage.prepend(renderer.domElement);

  const { scene: data, buffer } = await loadScene((f) => progress(f * 0.6));
  const c = data.meta.counts;
  progress(0.62, `Raising ${c.buildings.toLocaleString()} buildings along the Marina…`);
  const arrays: Record<string, Typed> = {};
  for (const k in data.packs.world.arrays) arrays[k] = view(buffer, data.packs.world.arrays[k]);

  const t0 = performance.now();
  const built = await buildInWorker(data, buffer);
  progress(0.92, 'Filling the sea…');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c141a);
  const world = new THREE.Group();
  scene.add(world);

  world.add(mesh(built.terrain, terrainMaterial(), { order: -10, name: 'terrain' }));
  world.add(mesh(built.cover, decalMaterial(), { order: -9, name: 'cover' }));
  world.add(mesh(built.roads, decalMaterial(), { order: -8, name: 'roads' }));
  world.add(mesh(built.marks, decalMaterial(), { order: -7, name: 'marks' }));
  world.add(mesh(built.plinth, plinthMaterial(), { receive: false, name: 'plinth' }));
  const bmat = buildingMaterial();
  for (const b of built.buildings) world.add(mesh(b, bmat, { cast: true, receive: true, name: 'buildings' }));

  // sea: one plane over the frame; the coast distance field drives colour, foam and swell
  const ci = data.meta.coast;
  const coastTex = new THREE.DataTexture(arrays.coast_sdf as Uint8Array, ci.cols, ci.rows, THREE.RedFormat, THREE.UnsignedByteType);
  coastTex.magFilter = coastTex.minFilter = THREE.LinearFilter;
  coastTex.needsUpdate = true;
  const coastBox = new THREE.Vector4(ci.x0 - ci.step / 2, ci.z0 - ci.step / 2, ci.cols * ci.step, ci.rows * ci.step);
  const seaMat = seaMaterial(coastTex, coastBox, ci.scale);
  const [fx0, fz0, fx1, fz1] = data.meta.frame_m;
  const seaGeo = new THREE.PlaneGeometry(fx1 - fx0, fz1 - fz0, Math.ceil((fx1 - fx0) / 20), Math.ceil((fz1 - fz0) / 20));
  seaGeo.rotateX(-Math.PI / 2);
  seaGeo.translate((fx0 + fx1) / 2, 0, (fz0 + fz1) / 2);
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.name = 'sea';
  sea.renderOrder = 1;
  world.add(sea);

  const sun = new Sun(scene, lite ? 2048 : 4096);
  sun.setAngles(235, 48);
  seaMat.uniforms.uSunDir.value.copy(sun.dir);

  const rig = new CameraRig(renderer.domElement, data.meta.frame_m);
  const whole: View = { x: (fx0 + fx1) / 2, z: (fz0 + fz1) / 2, span: (fz1 - fz0) * 0.62, azimuth: 1.2 };
  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    rig.resize(w, h);
  };
  new ResizeObserver(resize).observe(stage);
  resize();
  const portrait: View = { ...whole, span: (fx1 - fx0) * 0.92, azimuth: 0.35 };
  rig.set(rig.aspect < 0.8 ? portrait : whole);
  if (matchMedia('(pointer: coarse)').matches) $('#hint').textContent = 'Drag to move · Pinch to zoom · Twist to turn';

  // places (more arrive with the landmarks in phase 3)
  const places = $('#places');
  const wholeBtn = document.createElement('button');
  wholeBtn.textContent = 'Whole corridor';
  wholeBtn.addEventListener('click', () => rig.flyTo(rig.aspect < 0.8 ? portrait : whole));
  places.append(wholeBtn);

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (k === 'q') rig.rotateBy(Math.PI / 2);
    if (k === 'e') rig.rotateBy(-Math.PI / 2);
    if (k === 'h') document.body.classList.toggle('bare');
  });

  // shadow fit: the four screen corners on the ground, plus the same points raised
  const ndc = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const fwd = new THREE.Vector3(), p = new THREE.Vector3();
  const shadowPoints = () => {
    const pts: THREE.Vector3[] = [];
    rig.cam.getWorldDirection(fwd);
    for (const [x, y] of ndc) {
      p.set(x, y, -1).unproject(rig.cam);
      const t = (5 - p.y) / fwd.y;
      const g = p.clone().addScaledVector(fwd, t);
      g.x = THREE.MathUtils.clamp(g.x, fx0 - 50, fx1 + 50);
      g.z = THREE.MathUtils.clamp(g.z, fz0 - 50, fz1 + 50);
      pts.push(g, g.clone().setY(90));
    }
    return pts;
  };

  let frames = 0, last = performance.now(), fpsT = last, fpsN = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    shared.uTime.value += dt;
    rig.update(dt);
    rig.cam.getWorldDirection(seaMat.uniforms.uViewDir.value).negate();
    sun.fit(shadowPoints());
    renderer.render(scene, rig.cam);
    fpsN++;
    if (now - fpsT > 2000) { (window as any).__fps = (fpsN * 1000) / (now - fpsT); fpsT = now; fpsN = 0; }
    if (++frames === 3) {
      statusEl.textContent = `${c.buildings.toLocaleString()} buildings · ${c.road_km} km of roads · ${c.rail_km} km of track`;
      document.body.classList.add('ready');
      (window as any).__ready = true;
      console.info(`built in ${Math.round(performance.now() - t0)} ms`, JSON.stringify(built.stats));
    }
  };
  renderer.setAnimationLoop(loop);

  (window as any).__app = { renderer, scene, rig, sun, data, arrays, built: built.stats, lite };
}

main().catch((err: Error) => {
  console.error(err);
  const msg = /WebGL|device/.test(err.message) ? err.message : 'The model could not load. Please refresh to try again.';
  loadingText.textContent = msg;
  statusEl.textContent = msg;
  (window as any).__ready = true;
});
