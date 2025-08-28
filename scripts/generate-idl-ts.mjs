#!/usr/bin/env node
// generate-idl-ts.mjs
// Usage: node scripts/generate-idl-ts.mjs <input-idl.json> <out-file.ts> [--address=<BASE58_ADDRESS>]

import fs from 'fs/promises';
import path from 'path';

function toCamel(s) {
  return s.split('.').map(part => part.replace(/_([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())).join('.');
}

const KEYS_TO_CONVERT = new Set(['name','path','account','relations','generic']);

function recursivelyConvert(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(recursivelyConvert);
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null) { out[k] = v; continue; }
    if (KEYS_TO_CONVERT.has(k)) {
      if (typeof v === 'string') {
        out[k] = toCamel(v);
        continue;
      }
      if (Array.isArray(v)) {
        out[k] = v.map(x => typeof x === 'string' ? toCamel(x) : recursivelyConvert(x));
        continue;
      }
    }
    // otherwise, recurse
    out[k] = recursivelyConvert(v);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.error('Usage: node scripts/generate-idl-ts.mjs <input-idl.json> <out-file.ts> [--address=<BASE58_ADDRESS>]');
    process.exit(2);
  }
  const inPath = argv[0];
  const outPath = argv[1];
  const addressArg = argv.find(a => a.startsWith('--address='));
  const addr = addressArg ? addressArg.split('=')[1] : undefined;

  const raw = await fs.readFile(inPath, 'utf8');
  const idl = JSON.parse(raw);

  // Convert certain name/path keys to camelCase to match JS conventions
  const camel = recursivelyConvert(idl);

  if (addr) {
    camel.address = addr;
  }

  // Emit TypeScript file that exports the IDL as a const and a type alias
  const outDir = path.dirname(outPath);
  await fs.mkdir(outDir, { recursive: true });

  const content = `/** THIS FILE IS GENERATED — do not edit by hand. Run scripts/generate-idl-ts.mjs */\n\nexport const IDL = ${JSON.stringify(camel, null, 2)} as const;\n\nexport type ProgramIdl = typeof IDL;\n`;

  await fs.writeFile(outPath, content, 'utf8');
  console.log('Wrote', outPath);
}

main().catch(err => { console.error(err); process.exit(1); });
