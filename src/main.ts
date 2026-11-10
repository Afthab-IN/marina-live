import * as THREE from 'three';
import { loadScene, view } from './data/load';
import type { SceneData, Typed } from './data/types';
import { CameraRig, type View } from './scene/camera';
import { Sun } from './scene/sun';
import { buildingMaterial, decalMaterial, plinthMaterial, seaMaterial, shared, terrainMaterial } from './world/materials';
import { mesh } from './world/meshes';
import { buildLamps } from './world/lamps';
import { backdrop } from './sky/background';
import { lightAt } from './sky/lighting';
import { lightPanel, type TimeState } from './ui/lightPanel';
import { loadLandmarks, type LoadedLandmarks } from './landmarks';
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
  const sky = backdrop();
  scene.add(sky.mesh);
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
  const moon = new THREE.DirectionalLight(0x9fb4d9, 0);
  moon.position.set(0.55, 0.62, 0.56).multiplyScalar(1000);
  scene.add(moon);
  const lamps = buildLamps(arrays, data.meta.quant);
  world.add(lamps.group);

  // time of day and season: Chennai, IST; URL ?t=hour&m=month
  const now = new Date(Date.now() + (5.5 * 60 + new Date().getTimezoneOffset()) * 60000);
  const time: TimeState = {
    hour: Number(params.get('t') ?? 15.5),
    month: Number(params.get('m') ?? now.getMonth() + (now.getDate() - 1) / 30.5),
  };
  let light = lightAt(time.month, time.hour);
  const applyTime = () => {
    light = lightAt(time.month, time.hour);
    sun.dir.copy(light.sunDir);
    sun.light.color.copy(light.sunColor);
    sun.light.intensity = light.sunIntensity;
    // keep the light's shadow flag (toggling it recompiles every shader); just stop redrawing the map at night
    renderer.shadowMap.autoUpdate = light.sunIntensity > 0.05;
    sun.fill.color.copy(light.sky);
    sun.fill.groundColor.copy(light.ground);
    sun.fill.intensity = light.hemi;
    moon.color.copy(light.moonColor);
    moon.intensity = light.moon;
    sky.mat.uniforms.uTop.value.copy(light.zenith);
    sky.mat.uniforms.uBottom.value.copy(light.horizon);
    renderer.toneMappingExposure = 1.05 * light.exposure;
    shared.uNight.value = light.night;
    shared.uLit.value = light.lit;
    const daylit = light.sunIntensity > 0.05;
    seaMat.uniforms.uSunDir.value.copy(daylit ? light.sunDir : light.moonDir);
    seaMat.uniforms.uSunColor.value.copy(daylit ? light.sunColor : light.moonColor).multiplyScalar(daylit ? 1 : 0.5);
    seaMat.uniforms.uAmbient.value.copy(light.sky).multiplyScalar(light.hemi * 0.8);
    panel.show(light);
  };
  const panel = lightPanel($('#light'), time, applyTime);

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

  // camera shortcuts: the whole corridor, then the landmarks in the brief's order
  const places = $('#places');
  const addPlace = (label: string, go: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', go);
    places.append(b);
  };
  addPlace('Whole corridor', () => rig.flyTo(rig.aspect < 0.8 ? portrait : whole));
  const ORDER = ['chepauk_stadium', 'lighthouse', 'lic_building', 'chennai_central', 'nehru_stadium', 'marina_beach', 'fort_st_george'];
  for (const key of ORDER) {
    const lm = data.landmarks.find((l) => l.key === key && l.camera);
    if (!lm) continue;
    const span = (lm.span ?? 400) * (rig.aspect < 0.8 ? 0.7 : 1);
    addPlace(lm.title, () => rig.flyTo({ x: lm.x, z: lm.z, span }));
  }

  // hand-modelled landmarks arrive after the map is on screen
  let landmarks: LoadedLandmarks | null = null;
  loadLandmarks(data, world).then((l) => {
    landmarks = l;
    (window as any).__app.landmarks = l;
    console.info(`landmarks: ${l.built.length} built${l.failed.length ? `, failed: ${l.failed.join(', ')}` : ''}`);
  });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (k === 'q') rig.rotateBy(Math.PI / 2);
    if (k === 'e') rig.rotateBy(-Math.PI / 2);
    if (k === 'h') document.body.classList.toggle('bare');
    if (k === 'n') { time.hour = light.night > 0.5 ? 15.5 : panel.quick('night'); applyTime(); }
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
    landmarks?.update(shared.uTime.value, shared.uNight.value);
    lamps.update(shared.uNight.value, rig.metresPerPixel());
    rig.cam.getWorldDirection(seaMat.uniforms.uViewDir.value).negate();
    if (renderer.shadowMap.autoUpdate) sun.fit(shadowPoints());
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
  applyTime();
  renderer.setAnimationLoop(loop);

  (window as any).__app = { renderer, scene, rig, sun, data, arrays, built: built.stats, lite, time, applyTime, lamps, get light() { return light; } };
}

main().catch((err: Error) => {
  console.error(err);
  const msg = /WebGL|device/.test(err.message) ? err.message : 'The model could not load. Please refresh to try again.';
  loadingText.textContent = msg;
  statusEl.textContent = msg;
  (window as any).__ready = true;
});
