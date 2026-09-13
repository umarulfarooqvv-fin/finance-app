import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RECIPES, recipe } from '@/lib/shortcuts';

/* ===========================================================================
   The Shortcut recipes, checked against the routes they describe.

   These are instructions somebody follows once, on a phone, and then trusts
   for months. When they drift the failure is silent and confusing: the field
   is accepted, ignored, and the entry lands with the wrong date.

   That already happened. The income panel documented a `ts` field while the
   spending endpoint never read one, because the two pages wrote their own
   prose. The recipes are one definition now, and these assert they still match
   the source they claim to describe.
   =========================================================================== */

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../src/app/api/${path}`, import.meta.url)), 'utf8');

const entryRoute = source('entry/route.ts');
const captureRoute = source('capture/route.ts');

test('every field a recipe documents is actually read by its route', () => {
  const routeFor: Record<string, string> = {
    '/api/entry': entryRoute,
    '/api/capture': captureRoute,
  };

  for (const r of RECIPES) {
    const src = routeFor[r.path];
    assert.ok(src, `no source for ${r.path}`);
    for (const f of r.fields) {
      // The photo's "field" is the request body itself, not a named key.
      if (f.name === 'the photo') continue;
      assert.ok(
        src!.includes(`'${f.name}'`) || src!.includes(`"${f.name}"`),
        `${r.slug}: the page documents "${f.name}" but ${r.path} never reads it`,
      );
    }
  }
});

test('a spend and income both accept an explicit timestamp', () => {
  // The drift that prompted these tests: income took `ts`, spending did not,
  // and the photo inbox depends on a late entry carrying the real date.
  for (const slug of ['spend', 'income'] as const) {
    assert.ok(
      recipe(slug).fields.some((f) => f.name === 'ts' && !f.required),
      `${slug} should document an optional ts`,
    );
  }
  assert.match(entryRoute, /body\['ts'\]/, 'the route must read ts');
});

test('the token is named as a header and never printed anywhere', () => {
  const module = readFileSync(fileURLToPath(new URL('../src/lib/shortcuts.ts', import.meta.url)), 'utf8');
  const page = readFileSync(fileURLToPath(new URL('../src/app/shortcuts/page.tsx', import.meta.url)), 'utf8');
  const component = readFileSync(
    fileURLToPath(new URL('../src/components/shortcut-recipe.tsx', import.meta.url)),
    'utf8',
  );

  // Nothing may reach for the value — only name the variable in prose.
  for (const [name, src] of [['lib', module], ['page', page], ['component', component]] as const) {
    assert.ok(
      !/process\.env\.INGEST_TOKEN|process\.env\['INGEST_TOKEN'\]/.test(src),
      `${name} must not read the token; it would ship to the browser`,
    );
  }
  assert.match(component, /x-token/, 'the header still has to be named');
});

test('every recipe is buildable: steps, a URL and at least one field', () => {
  for (const r of RECIPES) {
    assert.ok(r.steps.length >= 3, `${r.slug} needs enough steps to follow`);
    assert.match(r.path, /^\/api\//);
    assert.ok(r.fields.length > 0, `${r.slug} has no fields`);
    assert.ok(r.why.length > 10, `${r.slug} should say what it is for`);
    // A JSON recipe must show a body; the photo recipe must not claim one.
    if (r.contentType === 'application/json') assert.ok(r.example, `${r.slug} needs an example body`);
    else assert.equal(r.example, undefined, `${r.slug} sends a file, not a body to copy`);
  }
});

test('the example bodies are valid JSON and use the documented fields', () => {
  for (const r of RECIPES) {
    if (!r.example) continue;
    const parsed = JSON.parse(r.example) as Record<string, unknown>;
    const known = new Set(r.fields.map((f) => f.name));
    for (const key of Object.keys(parsed)) {
      assert.ok(known.has(key), `${r.slug}: the example sends "${key}", which is not documented`);
    }
    for (const f of r.fields) {
      if (f.required) assert.ok(f.name in parsed, `${r.slug}: the example omits the required "${f.name}"`);
    }
  }
});

test('income is distinguished from a spend by the type field alone', () => {
  const income = recipe('income');
  assert.ok(income.fields.some((f) => f.name === 'type' && f.required));
  assert.match(income.example ?? '', /"type"\s*:\s*"income"/);
  // And a spend must NOT send it, or every entry would be income.
  assert.ok(!(recipe('spend').example ?? '').includes('"type"'));
});
