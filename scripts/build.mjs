import { build } from 'esbuild';
await build({ entryPoints: ['src/cli.ts'], outfile: 'dist/cli.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22',
  external: ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', 'typebox', '@napi-rs/keyring'] });
