#!/usr/bin/env node
/* ===========================================================================
   Generate src/types/database.ts from the LIVE schema.

   PostgREST publishes an OpenAPI description of the database it is serving, so
   the types below are derived from what the database actually is right now,
   not from what db/schema.sql says it should be. That distinction matters:
   a schema file drifts, a live introspection cannot.

     npm run gen:types

   The Supabase CLI equivalent (`supabase gen types typescript --project-id`)
   produces a richer file including views and function signatures, but needs a
   CLI login. This needs only the credentials the app already has.
   =========================================================================== */

import { writeFileSync } from 'node:fs';

const URL_ = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
if (!URL_ || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  console.error('Run with:  node --env-file=.env.local scripts/gen-db-types.mjs');
  process.exit(1);
}

const res = await fetch(`${URL_}/rest/v1/`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  cache: 'no-store',
});
if (!res.ok) {
  console.error(`Could not read the schema: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const spec = await res.json();

/** PostgREST format -> TypeScript. Unknown formats stay `unknown` rather than
    silently becoming `any`, so a new column type is a visible compile error. */
function tsType(prop) {
  const f = String(prop.format ?? '');
  if (/^(text|character varying|character|uuid|name)/.test(f)) return 'string';
  if (/^(integer|bigint|smallint|numeric|real|double precision)/.test(f)) return 'number';
  if (/^bool/.test(f)) return 'boolean';
  if (/^(json|jsonb)/.test(f)) return 'Json';
  if (/^timestamp|^date|^time/.test(f)) return 'string';
  return 'unknown';
}

const tables = Object.entries(spec.definitions ?? {}).sort(([a], [b]) => a.localeCompare(b));

const lines = [
  '/* AUTO-GENERATED — do not edit by hand.',
  ' *',
  ' * Produced by scripts/gen-db-types.mjs from the live PostgREST schema.',
  ' * Regenerate with:  npm run gen:types',
  ` * Generated: ${new Date().toISOString().slice(0, 10)}`,
  ' */',
  '',
  'export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];',
  '',
  'export type Database = {',
  '  public: {',
  '    Tables: {',
];

for (const [name, def] of tables) {
  const props = Object.entries(def.properties ?? {});
  const required = new Set(def.required ?? []);

  const row = props.map(([col, p]) => {
    const t = tsType(p);
    const nullable = !required.has(col);
    const pk = /Primary Key/i.test(String(p.description ?? '')) ? ' // primary key' : '';
    return `          ${col}: ${t}${nullable ? ' | null' : ''};${pk}`;
  });

  // Insert: a column is optional when it is nullable, has a default, or is a
  // database-generated key. PostgREST lists every primary key as `required`,
  // which is right for a text id the application supplies (transactions.id)
  // and wrong for an identity column the database fills in (events.id) — so
  // integer primary keys are treated as generated.
  const ins = props.map(([col, p]) => {
    const t = tsType(p);
    const nullable = !required.has(col);
    const hasDefault = p.default !== undefined;
    const isPk = /Primary Key/i.test(String(p.description ?? ''));
    const generatedKey = isPk && t === 'number';
    const optional = nullable || hasDefault || generatedKey;
    return `          ${col}${optional ? '?' : ''}: ${t}${nullable ? ' | null' : ''};`;
  });

  const upd = props.map(([col, p]) => `          ${col}?: ${tsType(p)}${required.has(col) ? '' : ' | null'};`);

  lines.push(
    `      ${name}: {`,
    '        Row: {',
    ...row,
    '        };',
    '        Insert: {',
    ...ins,
    '        };',
    '        Update: {',
    ...upd,
    '        };',
    '      };',
  );
}

lines.push('    };', '  };', '};', '');

// Convenience aliases the app actually uses.
lines.push('/** Row shapes, by table. */');
lines.push("export type Tables<T extends keyof Database['public']['Tables']> =");
lines.push("  Database['public']['Tables'][T]['Row'];");
lines.push("export type TablesInsert<T extends keyof Database['public']['Tables']> =");
lines.push("  Database['public']['Tables'][T]['Insert'];");
lines.push("export type TablesUpdate<T extends keyof Database['public']['Tables']> =");
lines.push("  Database['public']['Tables'][T]['Update'];");
lines.push('');

writeFileSync('src/types/database.ts', lines.join('\n'));
console.log(`Wrote src/types/database.ts — ${tables.length} tables: ${tables.map(([n]) => n).join(', ')}`);
