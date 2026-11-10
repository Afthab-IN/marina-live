import * as THREE from 'three';

/** Uniforms shared by every custom shader (time, night, sources view). */
export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uSources: { value: 0 },
  /** share of windows lit (0 by day, about 0.45 in the evening) */
  uLit: { value: 0 },
};

const GLSL_HASH = /* glsl */ `
float mhash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
float mhash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const FACADE = /* glsl */ `
${GLSL_HASH}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
bool isCls(float c, float k) { return abs(c - k) < 0.5; }
vec3 facadeColor(float cls, float seed) {
  float h = mhash(seed + 0.37);
  vec3 c;
  if (h < 0.30) c = vec3(0.93, 0.92, 0.88);
  else if (h < 0.45) c = vec3(0.94, 0.88, 0.74);
  else if (h < 0.56) c = vec3(0.96, 0.87, 0.61);
  else if (h < 0.65) c = vec3(0.79, 0.88, 0.80);
  else if (h < 0.74) c = vec3(0.77, 0.85, 0.91);
  else if (h < 0.82) c = vec3(0.94, 0.80, 0.77);
  else if (h < 0.91) c = vec3(0.87, 0.81, 0.71);
  else c = vec3(0.81, 0.80, 0.78);
  if (isCls(cls, 3.0) && h > 0.45) c = vec3(0.62, 0.69, 0.75);
  if (isCls(cls, 4.0)) c = vec3(0.75, 0.75, 0.73);
  if (isCls(cls, 8.0)) c = h > 0.5 ? vec3(0.93, 0.89, 0.81) : vec3(0.78, 0.43, 0.34);
  if (isCls(cls, 11.0)) c = vec3(0.71, 0.67, 0.61);
  return lin(c);
}
vec3 roofColor(float cls, float seed, vec2 p) {
  float h = mhash(seed + 2.9);
  vec3 c = vec3(0.80, 0.79, 0.76) * (0.92 + 0.12 * h);
  if ((isCls(cls, 1.0) || isCls(cls, 8.0)) && h > 0.72) c = vec3(0.71, 0.38, 0.28);
  if (isCls(cls, 4.0) || isCls(cls, 7.0)) c = vec3(0.66, 0.69, 0.71);
  if (isCls(cls, 11.0)) c = vec3(0.60, 0.64, 0.66);
  float grain = mhash2(floor(p * 1.5)) * 0.06;
  return lin(c) * (0.97 + grain);
}
vec3 sourceColor(float hs) {
  if (hs < 0.5) return lin(vec3(0.66, 0.63, 0.59));   // estimated
  if (hs < 1.5) return lin(vec3(0.70, 0.16, 0.16));   // OSM height tag
  if (hs < 2.5) return lin(vec3(0.86, 0.42, 0.22));   // OSM levels
  if (hs < 3.5) return lin(vec3(0.24, 0.46, 0.74));   // Google 2.5D
  return lin(vec3(0.50, 0.33, 0.66));                 // Overture
}
`;

export function buildingMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aFac;
attribute vec4 aInfo;
attribute float aH;
varying vec2 vFac;
varying vec4 vInfo;
varying float vH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFac = aFac; vInfo = aInfo; vH = aH;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight;
uniform float uSources;
uniform float uLit;
varying vec2 vFac;
varying vec4 vInfo;
varying float vH;
${FACADE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float cls = vInfo.x, seed = vInfo.y, roof = vInfo.w;
  float hs = mod(vInfo.z, 16.0);
  vec3 col;
  if (roof > 0.5) {
    col = roofColor(cls, seed, vFac);
  } else {
    float u = vFac.x, v = vFac.y;
    float floorH = 3.1;
    float spacing = mix(2.3, 3.6, mhash(seed + 9.1));
    vec2 cell = vec2(u / spacing, v / floorH);
    vec2 f = fract(cell);
    float tall = step(4.5, vH);
    float top = step(vH - 0.7, v);
    float ground = 1.0 - step(0.5, v);
    float win = step(0.24, f.x) * step(f.x, 0.76) * step(0.34, f.y) * step(f.y, 0.80);
    win *= (1.0 - top) * tall * step(1.0, cell.y);
    float shop = (isCls(cls, 3.0) || isCls(cls, 0.0)) ? (1.0 - step(1.0, cell.y)) * step(0.55, v) * step(v, 2.6) * step(0.1, f.x) * step(f.x, 0.9) : 0.0;
    float fw = max(fwidth(u), fwidth(v));
    float detail = 1.0 - smoothstep(0.22, 0.75, fw);
    col = facadeColor(cls, seed);
    col *= mix(1.0, 0.80, ground);
    col *= mix(1.0, 1.05, top);
    vec3 glass = lin(vec3(0.33, 0.39, 0.44)) * (0.75 + 0.5 * mhash2(floor(cell)));
    col = mix(col, glass, clamp(win + shop * 0.9, 0.0, 1.0) * 0.9 * detail);
    col = mix(col, col * 0.84, (1.0 - detail) * tall);
    // night: a share of windows lit, warm in homes and cooler in offices; shops glow at street level
    if (uNight > 0.01) {
      float office = isCls(cls, 3.0) || isCls(cls, 5.0) ? 1.0 : 0.0;
      float pick = mhash2(floor(cell) + vec2(seed * 7.13, seed * 3.7));
      float share = uLit * (0.7 + 0.6 * mhash(seed + 5.5)) * (1.0 + 0.4 * office);
      float isLit = step(pick, share) * win;
      vec3 warm = vec3(1.0, 0.68, 0.34), cool = vec3(0.78, 0.86, 1.0);
      vec3 lampC = mix(warm, cool, office * step(0.35, mhash(seed + floor(cell.y) * 1.7)));
      // far away the windows are sub-pixel: light whole bays of random floors instead, so the
      // city reads as speckled lit floors rather than a flat glow
      float far = 1.0 - detail;
      vec2 bay = floor(vec2(u / (spacing * 3.0), v / floorH));
      float bayLit = step(mhash2(bay + vec2(seed * 1.31, seed * 0.77)), share * 0.8) * step(1.0, bay.y) * (1.0 - top);
      totalEmissiveRadiance += uNight * (lampC * (1.5 * isLit * detail + 0.42 * bayLit * far * tall)
                               + warm * shop * 1.1 * step(0.3, uLit) * detail);
    }
  }
  if (uSources > 0.5) col = sourceColor(hs) * (roof > 0.5 ? 1.0 : 0.82);
  diffuseColor.rgb = col;
}`);
  };
  m.customProgramCacheKey = () => 'building-v3';
  return m;
}

/** Ground decals: drawn in a fixed order after the terrain, without depth, so they never z-fight. */
export function decalMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, depthTest: false, depthWrite: false });
}

export function terrainMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

export function plinthMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

/** The sea: gentle swell from the south-east, foam rolling onto the beach, sun glint. */
export function seaMaterial(coast: THREE.DataTexture, coastBox: THREE.Vector4, coastScale: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uCoast: { value: coast },
      uCoastBox: { value: coastBox },
      uCoastScale: { value: coastScale },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.88) },
      uAmbient: { value: new THREE.Color(0.55, 0.62, 0.7) },
      uViewDir: { value: new THREE.Vector3(0, 1, 0) },
      uCamPos: { value: new THREE.Vector3() },
      uPersp: { value: 0 },
    },
    vertexShader: /* glsl */ `
uniform float uTime;
uniform sampler2D uCoast;
uniform vec4 uCoastBox;
uniform float uCoastScale;
varying vec3 vW;
varying float vDist;
float coastDist(vec2 p) {
  vec2 uv = (p - uCoastBox.xy) / uCoastBox.zw;
  return (texture2D(uCoast, uv).r * 255.0 - 128.0) * uCoastScale;
}
void main() {
  vec3 p = position;
  float d = coastDist(p.xz);
  vDist = d;
  float amp = smoothstep(4.0, 90.0, d);
  // three long swells from the south-east, travelling towards the beach (west)
  p.y += amp * (0.22 * sin(dot(p.xz, vec2(-0.045, 0.012)) + uTime * 0.8)
              + 0.12 * sin(dot(p.xz, vec2(-0.07, -0.03)) + uTime * 1.1)
              + 0.06 * sin(dot(p.xz, vec2(-0.12, 0.08)) + uTime * 1.7));
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uViewDir;
uniform vec3 uCamPos;
uniform float uPersp;
varying vec3 vW;
varying float vDist;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float d = vDist;
  if (d < -1.0) discard;
  vec2 p = vW.xz;
  // ripples for the normal
  float t = uTime;
  vec2 g = vec2(0.0);
  g += vec2(-0.045, 0.012) * 0.22 * cos(dot(p, vec2(-0.045, 0.012)) + t * 0.8);
  g += vec2(-0.07, -0.03) * 0.12 * cos(dot(p, vec2(-0.07, -0.03)) + t * 1.1);
  g += vec2(0.31, 0.17) * 0.02 * cos(dot(p, vec2(0.31, 0.17)) - t * 2.3);
  g += vec2(-0.21, 0.37) * 0.015 * cos(dot(p, vec2(-0.21, 0.37)) + t * 2.9);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  float depth = clamp(d / 260.0, 0.0, 1.0);
  vec3 shallow = vec3(0.16, 0.52, 0.55), mid = vec3(0.07, 0.33, 0.45), deep = vec3(0.04, 0.20, 0.33);
  vec3 col = mix(shallow, mid, smoothstep(0.0, 0.35, depth));
  col = mix(col, deep, smoothstep(0.35, 1.0, depth));
  float diff = max(dot(n, uSunDir), 0.0);
  col *= uAmbient * 0.75 + uSunColor * diff * 0.55;
  // foam: breaking lines rolling in, then the swash at the waterline
  float wob = n2(p * 0.05 + vec2(0.0, t * 0.05)) * 2.0;
  float phase = d * 0.16 + t * 0.85 + wob;
  float crest = smoothstep(0.90, 1.0, sin(phase));
  float zone = 1.0 - smoothstep(8.0, 70.0, d);
  float swash = 1.0 - smoothstep(0.0, 7.0 + 2.0 * sin(t * 0.7 + p.y * 0.02), d);
  float foam = clamp(crest * zone * (0.55 + 0.45 * n2(p * 0.3)) + swash * 0.85, 0.0, 1.0);
  col = mix(col, vec3(0.92, 0.94, 0.93) * (uAmbient * 0.6 + uSunColor * 0.5), foam);
  // sun glint
  // orthographic rays are all parallel; the orbit camera needs the per-pixel view vector
  vec3 v = uPersp > 0.5 ? normalize(uCamPos - vW) : uViewDir;
  vec3 h = normalize(v + uSunDir);
  float spec = pow(max(dot(n, h), 0.0), 120.0) * (1.0 - foam);
  col += uSunColor * spec * 1.4 * (1.0 - uNight * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}
