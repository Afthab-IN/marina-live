import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// separable 9-tap blur whose radius grows away from a horizontal focus band (tilt-shift)
const FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec2 uDir;
uniform float uFocus;
uniform float uFinal;
varying vec2 vUv;
void main() {
  float band = smoothstep(0.07, 0.42, abs(vUv.y - uFocus));
  float r = band * 2.2;
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
  vec2 o1 = uDir * uTexel * r * 1.385, o2 = uDir * uTexel * r * 3.231;
  c += (texture2D(tSrc, vUv + o1).rgb + texture2D(tSrc, vUv - o1).rgb) * 0.316;
  c += (texture2D(tSrc, vUv + o2).rgb + texture2D(tSrc, vUv - o2).rgb) * 0.070;
  if (uFinal > 0.5) {
    // miniature look: a touch more saturation and contrast, soft vignette
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, 1.2);
    c = (c - 0.5) * 1.05 + 0.5;
    float v = distance(vUv, vec2(0.5));
    c *= 1.0 - 0.28 * smoothstep(0.42, 0.85, v);
  }
  gl_FragColor = vec4(max(c, 0.0), 1.0);
  if (uFinal > 0.5) {
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
}`;

export class Lens {
  enabled = false;
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(samples: number) {
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
    this.a = new THREE.WebGLRenderTarget(1, 1, { ...opts, samples });
    this.b = new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: false });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2(1, 0) },
        uFocus: { value: 0.46 }, uFinal: { value: 0 } },
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geo, this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(w: number, h: number, dpr: number) {
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    this.a.setSize(W, H);
    this.b.setSize(W, H);
    this.mat.uniforms.uTexel.value.set(1 / W, 1 / H);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.enabled) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    const u = this.mat.uniforms;
    renderer.setRenderTarget(this.a);
    renderer.render(scene, camera);
    u.tSrc.value = this.a.texture; u.uDir.value.set(1, 0); u.uFinal.value = 0;
    renderer.setRenderTarget(this.b);
    renderer.render(this.scene, this.cam);
    u.tSrc.value = this.b.texture; u.uDir.value.set(0, 1); u.uFinal.value = 1;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }
}
