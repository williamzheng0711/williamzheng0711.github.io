import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Website deployment configuration only; map compilation lives in JourneySphere.
const website = fileURLToPath(new URL('../', import.meta.url));
const source = process.env.JOURNEY_SPHERE_SOURCE || resolve(website, '../journey-sphere');
execFileSync(process.execPath, [
  resolve(source, 'scripts/export-static.mjs'),
  '--record', resolve(website, 'data/journeysphere-visits.json'),
  '--out', resolve(website, 'packages/journey-sphere'),
  '--fallback-data-url', 'https://cdn.jsdelivr.net/gh/williamzheng0711/journey-sphere@3b7fcbbded7a35b2574c6b74e8628f4ca330131e/data/',
], { stdio: 'inherit' });
