import * as THREE from 'three';

/** Full-screen gradient behind the model, coloured by the time of day. */
export function backdrop() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
varying vec2 vUv;
void main() {
  vec3 c = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
  float v = distance(vUv, vec2(0.5, 0.55));
  c *= 1.0 - 0.35 * smoothstep(0.35, 0.95, v);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
    depthTest: false,
    depthWrite: false,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -100;
  m.name = 'backdrop';
  return { mesh: m, mat };
}
