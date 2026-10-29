import { build } from 'esbuild';
await build({ entryPoints: ['server/main.js'], bundle: true, format: 'esm', platform: 'node', target: 'node22', outfile: 'dist-vps/server.mjs' });
