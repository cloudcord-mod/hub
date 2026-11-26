const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const source = fs.readFileSync('ios/runtime/src/lib/ui/toasts.ts', 'utf8');
const platform = { OS: 'android' };
const systemCalls = [], alerts = [];
const system = { SHORT: 0, show: (...args) => systemCalls.push(args) };
const deps = {
    '@core/i18n': { Strings: { COPIED_TO_CLIPBOARD: 'Copied' } },
    'react-native': { Platform: platform, ToastAndroid: system, Alert: { alert: (...args) => alerts.push(args) } }
};
const context = vm.createContext({ module: { exports: {} }, require: name => {
    assert(name in deps, `Unexpected dependency ${name}`);
    return deps[name];
} });
vm.runInContext(esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code, context);
const { showToast } = context.module.exports;
showToast('Copied gift link.');
showToast.showCopyToClipboard();
assert.deepEqual(systemCalls, [['Copied gift link.', 0], ['Copied', 0]]);
system.show = () => { throw Error('Native toast unavailable'); };
showToast('Saved');
assert.deepEqual(alerts, [['CloudCord', 'Saved']]);
platform.OS = 'ios';
showToast('Saved on iOS', 42);
assert.deepEqual(alerts, [['CloudCord', 'Saved'], ['CloudCord', 'Saved on iOS']]);
assert(fs.readFileSync('.github/workflows/cloudcord.yml', 'utf8').includes('cp "../ios/runtime/src/lib/ui/toasts.ts" "src/lib/ui/toasts.ts"'));
console.log('PASS mobile feedback bypasses Discord’s toast container on both platforms');
