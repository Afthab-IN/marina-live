import type { BuildFn } from './kit';

// One module per landmark key: src/landmarks/models/<key>.ts exporting build().
// Files starting with "_" are shared helpers and are never loaded directly.
const loaders = import.meta.glob('./models/*.ts');

export function hasModel(key: string): boolean {
  return `./models/${key}.ts` in loaders;
}

export async function loadBuilder(key: string): Promise<BuildFn | null> {
  const load = loaders[`./models/${key}.ts`];
  if (!load) return null;
  // a flaky connection can drop one chunk: retry twice (browsers no longer cache failed module fetches)
  for (let attempt = 0; ; attempt++) {
    try {
      const mod = (await load()) as { build?: BuildFn };
      return mod.build ?? null;
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1) ** 2));
    }
  }
}
