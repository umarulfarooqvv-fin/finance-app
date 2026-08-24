/* Lets maintenance scripts import the app's own modules by their `@/` alias.

   The point is not convenience: a script that re-implements the timestamp
   parser or the classifier will drift from the one the app uses, and the first
   sign of that drift will be a sync that mis-matches rows. Sharing the real
   modules makes divergence impossible. */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/* App imports are extensionless because the bundler resolves them. Node does
   not, so the extension is restored here — including for the transitive
   imports inside the modules being loaded. */
function withExtension(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return base;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const target = withExtension(resolvePath(root, 'src', specifier.slice(2)));
    return next(pathToFileURL(target).href, context);
  }
  return next(specifier, context);
}
