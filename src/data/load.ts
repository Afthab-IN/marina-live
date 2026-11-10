import type { ArrayInfo, SceneData, Typed } from './types';

const CTORS = {
  i8: Int8Array, u8: Uint8Array, i16: Int16Array, u16: Uint16Array,
  i32: Int32Array, u32: Uint32Array, f32: Float32Array,
} as const;

/** A typed view of one array inside the unpacked world buffer (no copy). */
export function view(buffer: ArrayBuffer, info: ArrayInfo): Typed {
  return new CTORS[info.type](buffer, info.offset, info.length);
}

async function gunzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  // Some hosts decompress .pack files on the way; only gunzip real gzip data.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.slice().buffer;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function fetchWithProgress(url: URL, expected: number, onProgress: (f: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url.pathname} could not be loaded (${res.status})`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(Math.min(1, got / expected));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function loadScene(onProgress: (f: number) => void): Promise<{ scene: SceneData; buffer: ArrayBuffer }> {
  const base = new URL('data/', document.baseURI);
  const res = await fetch(new URL('scene.json', base), { cache: 'no-cache' });
  if (!res.ok) throw new Error('scene.json could not be loaded');
  const scene = (await res.json()) as SceneData;
  const pack = scene.packs.world;
  const bytes = await fetchWithProgress(new URL(`${pack.file}?v=${scene.built}-${pack.bytes}`, base), pack.bytes, onProgress);
  const buffer = await gunzip(bytes);
  if (buffer.byteLength !== pack.raw) throw new Error(`world.pack is ${buffer.byteLength} bytes, expected ${pack.raw}`);
  return { scene, buffer };
}
