import * as THREE from 'three';
import type { Typed } from '../data/types';

/** Street lamps: instanced posts and heads, plus warm light pools on the road at night. */
export function buildLamps(a: Record<string, Typed>, quant: number) {
  const xz = a.lamp_xz, attr = a.lamp_attr, ys = a.lamp_y;
  const n = ys.length;
  const group = new THREE.Group();
  group.name = 'lamps';

  const pole = new THREE.CylinderGeometry(0.08, 0.12, 8, 5).translate(0, 4, 0);
  const arm = new THREE.BoxGeometry(1.7, 0.08, 0.08).translate(0.85, 7.9, 0);
  const postGeo = mergeSimple([pole, arm]);
  const headGeo = new THREE.BoxGeometry(0.7, 0.2, 0.34).translate(1.6, 7.78, 0);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x8d9196 });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xd9d4c4, emissive: 0xffc06a, emissiveIntensity: 0 });
  const posts = new THREE.InstancedMesh(postGeo, postMat, n);
  const heads = new THREE.InstancedMesh(headGeo, headMat, n);
  posts.castShadow = true;
  posts.receiveShadow = heads.receiveShadow = false;

  const poolMat = new THREE.ShaderMaterial({
    uniforms: { uNight: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
uniform float uNight;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, d)) ;
  a = a * a * uNight * 0.8;
  gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * a, a);
}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const poolGeo = new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, n);
  pools.renderOrder = 2;
  pools.frustumCulled = false;

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let mapped = 0;
  for (let i = 0; i < n; i++) {
    const x = xz[2 * i] * quant, z = xz[2 * i + 1] * quant, y = ys[i] / 100;
    const ang = (attr[2 * i] / 255) * Math.PI * 2;
    mapped += attr[2 * i + 1];
    q.setFromAxisAngle(up, -ang);
    p.set(x, y, z);
    m.compose(p, q, s);
    posts.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    p.set(x + Math.cos(ang) * 3.2, y + 0.25, z + Math.sin(ang) * 3.2);
    m.compose(p, new THREE.Quaternion(), s);
    pools.setMatrixAt(i, m);
  }
  for (const im of [posts, heads, pools]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  // Sources view: mapped lamps in gold, illustrated ones in grey
  const white = new THREE.Color(1, 1, 1), gold = new THREE.Color(0xf2d14b), grey = new THREE.Color(0x8c918c);
  const setHeadColors = (sources: boolean) => {
    for (let i = 0; i < n; i++) heads.setColorAt(i, !sources ? white : attr[2 * i + 1] ? gold : grey);
    heads.instanceColor!.needsUpdate = true;
  };
  setHeadColors(false);
  let sourcesOn = false;
  group.add(posts, heads, pools);
  return {
    group, count: n, mapped,
    setSources(on: boolean) { sourcesOn = on; setHeadColors(on); },
    update(night: number, metresPerPixel: number) {
      headMat.emissiveIntensity = night * 2.2;
      poolMat.uniforms.uNight.value = night;
      pools.visible = night > 0.02;
      // posts are sub-pixel when zoomed far out; skip drawing them there
      posts.visible = metresPerPixel < 1.4;
      heads.visible = metresPerPixel < 1.4 || night > 0.05 || sourcesOn;
      if (sourcesOn) heads.scale.setScalar(1);
    },
  };
}

function mergeSimple(geos: THREE.BufferGeometry[]) {
  const pos: number[] = [], nor: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.getAttribute('position').array as Float32Array));
    nor.push(...(ng.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
