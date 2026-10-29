import { build } from 'esbuild';
await build({ entryPoints: ['_worker.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/_worker.js' });
