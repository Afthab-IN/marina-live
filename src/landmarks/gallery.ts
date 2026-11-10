// Dev-only gallery: renders one landmark model on its OSM footprint so it can be checked in isolation.
// landmarks.html?key=lighthouse&az=45&view=iso|side|top&night=0|1&t=3&zoom=1
import * as THREE from 'three';
import type { SceneData } from '../data/types';
import { Kit } from './kit';
import { loadBuilder } from './registry';

const p = new URLSearchParams(location.search);
const key = p.get('key') ?? 'lighthouse';
const night = Number(p.get('night') ?? 0);
const azDeg = Number(p.get('az') ?? 35);
const view = p.get('view') ?? 'iso';
const t = Number(p.get('t') ?? 3);
const zoom = Number(p.get('zoom') ?? 1);
const statsEl = document.getElementById('stats')!;

function triangles(root: THREE.Object3D) {
  let tris = 0, meshes = 0, instances = 0;
  const mats = new Set<string>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    const n = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
    const k = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    instances += k > 1 ? k : 0;
    tris += n * k;
    const mm = Array.isArray(m.material) ? m.material : [m.material];
    mm.forEach((x) => mats.add(x.name || x.type + ':' + (x as THREE.MeshLambertMaterial).color?.getHexString?.()));
  });
  return { tris: Math.round(tris), meshes, instances, materials: mats.size };
}

async function main() {
  const data = (await (await fetch('data/scene.json')).json()) as SceneData;
  const lm = data.landmarks.find((l) => l.key === key);
  if (!lm) throw new Error(`no landmark "${key}" in scene.json`);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(night ? 0x0a1220 : 0xbcd0dc);
  const kit = new Kit();
  const build = await loadBuilder(key);
  if (!build) throw new Error(`src/landmarks/models/${key}.ts has no build()`);
  const res = build(lm, kit);
  scene.add(res.group);
  kit.setNight(night);
  res.animate?.(t, night);

  const box = new THREE.Box3().setFromObject(res.group);
  const size = box.getSize(new THREE.Vector3());
  const ring = kit.ringLocal(lm);
  let ext = Math.max(size.x, size.z, 20);
  for (const [x, z] of ring) ext = Math.max(ext, Math.abs(x) * 2, Math.abs(z) * 2);
  if (ring.length) {
    const pts = ring.map(([x, z]) => new THREE.Vector3(x, 0.12, z));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff2050 }));
    scene.add(line);
  }
  if (lm.front) {
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.3, 0), ext * 0.6, 0x2080ff);
    scene.add(arrow);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ext * 3, ext * 3).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xcfc8b8 }));
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(new THREE.HemisphereLight(0xdce8f4, 0xb8ab98, night ? 0.12 : 1.15));
  if (!night) {
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(-ext, ext * 1.2, ext * 0.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -ext * 1.5; sc.right = sc.top = ext * 1.5; sc.near = 1; sc.far = ext * 6;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
  }

  const aspect = innerWidth / innerHeight;
  const half = (Math.max(ext, size.y * 1.3) * 0.62) / zoom;
  const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.5, ext * 20);
  const polar = view === 'top' ? 0.001 : view === 'side' ? Math.PI / 2 - 0.03 : Math.acos(1 / Math.sqrt(3));
  const az = THREE.MathUtils.degToRad(azDeg);
  const r = ext * 5;
  const target = new THREE.Vector3(0, view === 'side' ? size.y / 2 : size.y * 0.2, 0);
  cam.position.set(target.x + Math.sin(az) * Math.sin(polar) * r, target.y + Math.cos(polar) * r, target.z + Math.cos(az) * Math.sin(polar) * r);
  cam.lookAt(target);
  renderer.render(scene, cam);
  renderer.render(scene, cam);

  const st = { key, ...triangles(res.group), size: size.toArray().map((v) => +v.toFixed(1)), top: +box.max.y.toFixed(1),
    footprint: lm.length ? [lm.length, lm.width] : null, notes: res.notes ?? '' };
  statsEl.textContent = `${key}  ${st.tris.toLocaleString()} tris  ${st.meshes} meshes  ${st.materials} materials\nsize ${st.size.join(' x ')} m  top ${st.top} m  footprint ${st.footprint?.join(' x ') ?? 'n/a'}`;
  (window as any).__stats = st;
  (window as any).__ready = true;
}

main().catch((e: Error) => {
  statsEl.textContent = `ERROR: ${e.message}`;
  console.error(e);
  (window as any).__stats = { error: e.message };
  (window as any).__ready = true;
});
