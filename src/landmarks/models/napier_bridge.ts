// Napier Bridge over the Cooum river mouth: twin carriageways, each with six spans of bowstring
// arches on both edges (138 m between abutments). Painted as a black and white chessboard for the
// 2022 Chess Olympiad; no repaint has been reported since, so the pattern is kept (illustrated).
// The road deck (and the water under it) is drawn flat by the map's ground layer, so only the parts
// above the road are modelled: chequered parapets and arches, hangers, LED strips and lamp posts.
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild, MatName } from '../kit';
import { type V3, Soup, lerp } from './_stadium';

/** Road height over lm.ground along the bridge (local x from -80 to 80 every 10 m): the ground layer
 * drapes the deck on the terrain here. Set all to 0 if the terrain under the bridge is levelled. */
const DECK = [1.06, 0.9, 0.74, 0.59, 0.44, 0.31, 0.19, 0.08, 0, -0.07, -0.1, -0.12, -0.1, -0.07, 0, 0.09, 0.22];
const ROAD = 0.07;
const HALF_L = 77;
const SPAN0 = -69, SPANS = 6, SPAN = 23;
/** Carriageway edges across the bridge (local z): outer and inner edge of each deck. */
const EDGES = [-15.5, -2.8, 2.8, 15.5];
const RISE = 5.2;

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const T = kit.THREE;
  const group = new T.Group();
  group.name = lm.key;
  const s = new Soup();
  const yd = (x: number) => {
    const f = Math.min(DECK.length - 1.001, Math.max(0, (x + 80) / 10));
    const i = Math.floor(f);
    return lerp(DECK[i], DECK[i + 1], f - i) + ROAD;
  };
  const chess = (k: number): MatName => (k % 2 ? 'black' : 'white');

  for (const ez of EDGES) {
    const outer = Math.abs(ez) > 10;
    // parapet wall: chessboard blocks in two rows, offset like a board; LED rail on the outer parapets
    const n = 24;
    for (let k = 0; k < n; k++) {
      const x0 = -HALF_L + (2 * HALF_L * k) / n, x1 = -HALF_L + (2 * HALF_L * (k + 1)) / n;
      const y0 = yd((x0 + x1) / 2);
      s.beam(chess(k), [x0, y0 + 0.33, ez], [x1, y0 + 0.33, ez], 0.5, 0.66);
      s.beam(chess(k + 1), [x0, y0 + 0.99, ez], [x1, y0 + 0.99, ez], 0.5, 0.66);
      if (outer) s.quad('lamp', [x0, y0 + 1.33, ez - 0.12], [x1, y0 + 1.33, ez - 0.12], [x1, y0 + 1.33, ez + 0.12], [x0, y0 + 1.33, ez + 0.12], [0, 1, 0]);
    }
    // bowstring arches: chequered ribs with an LED strip on top, three hangers each
    for (let sp = 0; sp < SPANS; sp++) {
      const x0 = SPAN0 + sp * SPAN, x1 = x0 + SPAN;
      const segs = 7;
      const p = (t: number): V3 => {
        const x = lerp(x0, x1, t);
        return [x, yd(x) + 1.2 + RISE * 4 * t * (1 - t), ez];
      };
      for (let k = 0; k < segs; k++) {
        const a = p(k / segs), b = p((k + 1) / segs);
        s.beam(chess(k + sp), a, b, 0.8, 0.9);
        s.quad('lamp', [a[0], a[1] + 0.47, ez - 0.2], [b[0], b[1] + 0.47, ez - 0.2], [b[0], b[1] + 0.47, ez + 0.2], [a[0], a[1] + 0.47, ez + 0.2], [0, 1, 0]);
      }
      for (const t of [0.25, 0.5, 0.75]) {
        const a = p(t), y0 = yd(a[0]) + 1.3;
        s.quad('white', [a[0] - 0.15, y0, ez], [a[0] + 0.15, y0, ez], [a[0] + 0.15, a[1], ez], [a[0] - 0.15, a[1], ez], [0, 0, 1], true);
      }
    }
  }

  // lamp posts on the outer parapets at every pier, plus the ends
  for (const ez of [EDGES[0], EDGES[3]]) {
    const out = Math.sign(ez);
    for (let i = 0; i <= SPANS; i++) {
      const x = SPAN0 + i * SPAN;
      const y = yd(x);
      s.post('darkSteel', x, ez - out * 0.1, y + 1.2, y + 8.5, 0.16, 0.11, 6);
      s.beam('darkSteel', [x, y + 8.4, ez - out * 0.1], [x, y + 8.4, ez - out * 1.6], 0.14, 0.14);
      s.box('lamp', x, y + 8.15, ez - out * 1.7, 0.7, 0.35, 0.7);
    }
  }

  s.build(kit, group);
  return {
    group,
    notes: 'Twin decks with six bowstring spans per edge; chessboard paint from 2022 kept (no repaint reported); '
      + 'arch rise, LED strips and lamp posts illustrated. Parapets follow the draped road height.',
  };
}
