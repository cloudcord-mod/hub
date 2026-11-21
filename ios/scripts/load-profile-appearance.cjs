const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const esbuild = require(process.env.CLOUDCORD_ESBUILD || require.resolve('esbuild', {
    paths: [__dirname, path.resolve(__dirname, '../../desktop/client')],
}));
const context = { module: { exports: {} }, URL };
vm.runInNewContext(esbuild.transformSync(fs.readFileSync('desktop/client/src/utils/profileAppearance.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, context);
module.exports = context.module.exports;
