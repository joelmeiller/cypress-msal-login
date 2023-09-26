import * as esbuild from 'esbuild'
import { replace } from 'esbuild-plugin-replace'

await esbuild.build({
  entryPoints: ['src/index.ts'],
  external: ['cypress'],
  bundle: true,
  loader: { '.ts': 'ts' },
  outfile: 'lib/index.js',
  platform: 'node',
  // plugins: [
  //   replace({
  //     '@azure/common': 'client/azure/msal-common',
  //   }),
  // ],
})
