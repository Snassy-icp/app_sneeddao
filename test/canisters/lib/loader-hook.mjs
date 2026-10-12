// Resolve the Vite aliases (`external/`, `declarations/`) used by frontend
// modules when they run under node, relative to this repository.
const ROOT = new URL('../../../src/', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('external/')) return next(ROOT + specifier, context);
  if (specifier.startsWith('declarations/')) return next(ROOT + specifier, context);
  return next(specifier, context);
}
