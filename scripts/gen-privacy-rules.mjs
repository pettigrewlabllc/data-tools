// Embeds packages/core/src/privacy/rules.yml as a module, so the same rule file loads in the browser and in Node.
// A test fails if the module drifts from the file. Run: npm run privacy:rules
import { readFileSync, writeFileSync } from 'node:fs';
const src = new URL('../packages/core/src/privacy/rules.yml', import.meta.url);
const out = new URL('../packages/core/src/privacy/rules.data.ts', import.meta.url);
const text = readFileSync(src, 'utf8');
writeFileSync(out, `// Generated from rules.yml by scripts/gen-privacy-rules.mjs. Do not edit.\nexport const RULES_YAML: string = ${JSON.stringify(text)};\n`);
console.log('wrote rules.data.ts');
