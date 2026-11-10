import * as THREE from 'three';
import { sunPosition, sunTimes } from './solar';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const C = (hex: number) => new THREE.Color(hex);
const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t);

const SUN_DAY = C(0xfff2de), SUN_GOLD = C(0xffc792), SUN_LOW = C(0xff9c62);
const SKY_DAY = C(0xdbe8f5), SKY_GOLD = C(0xe2d7cc), SKY_NIGHT = C(0x3b5384);
const GND_DAY = C(0xb8ab98), GND_NIGHT = C(0x1e2532);
const ZEN_DAY = C(0x5f97c9), HOR_DAY = C(0xc8dbe6), ZEN_GOLD = C(0x5a6f9c), HOR_GOLD = C(0xf0ae78);
const ZEN_NIGHT = C(0x060b18), HOR_NIGHT = C(0x15213a);
const MOON = C(0x9fb4d9);

export interface LightState {
  elevation: number; azimuth: number; label: string;
  sunDir: THREE.Vector3; sunColor: THREE.Color; sunIntensity: number;
  sky: THREE.Color; ground: THREE.Color; hemi: number;
  zenith: THREE.Color; horizon: THREE.Color;
  night: number; lit: number; exposure: number;
  moonDir: THREE.Vector3; moon: number; moonColor: THREE.Color;
}

/** Everything the scene needs for one moment: Chennai, given month (0..11.99) and IST hour. */
export function lightAt(month: number, hour: number): LightState {
  const { elevation: e, azimuth } = sunPosition(month, hour);
  const times = sunTimes(month);
  const az = THREE.MathUtils.degToRad(azimuth), el = THREE.MathUtils.degToRad(Math.max(e, 2));
  const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  const day = smooth(-3, 10, e);
  const gold = 1 - smooth(3, 24, e);
  const low = 1 - smooth(-1, 6, e);
  const night = 1 - smooth(-7, 2, e);
  const sunColor = mix(mix(SUN_DAY, SUN_GOLD, gold), SUN_LOW, low * 0.8);
  const sunIntensity = 3.0 * smooth(-1.5, 9, e);
  const sky = mix(mix(SKY_DAY, SKY_GOLD, gold * day), SKY_NIGHT, night);
  const ground = mix(GND_DAY, GND_NIGHT, night);
  const hemi = 1.15 - 0.72 * night;
  const zenith = mix(mix(ZEN_DAY, ZEN_GOLD, gold), ZEN_NIGHT, night);
  const horizon = mix(mix(HOR_DAY, HOR_GOLD, gold), HOR_NIGHT, night);
  // share of windows lit: rises through dusk, eases late at night and before dawn
  let lit = 0;
  if (hour > times.set - 0.4) lit = 0.45 * smooth(times.set - 0.4, times.set + 0.9, hour) - 0.15 * smooth(22, 23.5, hour);
  else if (hour < times.rise + 0.5) lit = 0.16 * (1 - smooth(times.rise - 0.3, times.rise + 0.5, hour));
  const exposure = 1.0 + 0.08 * gold * day + 0.35 * night;
  const moonDir = new THREE.Vector3(0.55, 0.62, 0.56).normalize();
  const label = e < -6 ? 'night' : e < 0.5 ? (hour < 12 ? 'dawn' : 'dusk') : e < 12 ? (hour < 12 ? 'morning light' : 'golden hour') : 'daylight';
  return { elevation: e, azimuth, label, sunDir, sunColor, sunIntensity, sky, ground, hemi, zenith, horizon,
    night, lit: Math.max(0, lit), exposure, moonDir, moon: 0.45 * night, moonColor: MOON.clone() };
}
