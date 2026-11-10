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
  const mod = (await load()) as { build?: BuildFn };
  return mod.build ?? null;
}
