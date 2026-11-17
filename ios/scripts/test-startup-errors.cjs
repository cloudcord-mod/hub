const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../runtime/src/entry.ts'), 'utf8');
const start = source.indexOf('let recoveryStarted');
const end = source.indexOf('\nif (typeof window.__r');
const initialize = require(process.env.CLOUDCORD_ESBUILD || 'esbuild').transformSync(source.slice(start, end), { loader: 'ts' }).code;
(async () => {
    const main = fs.readFileSync(path.join(__dirname, '../runtime/src/index.ts'), 'utf8');
    const taskSource = main.slice(main.indexOf('async function runStartupTask'), main.indexOf('export default async'));
    const tasks = vm.createContext({ console: { log() {}, error() {} } });
    vm.runInContext(require(process.env.CLOUDCORD_ESBUILD || 'esbuild').transformSync(taskSource, { loader: 'ts' }).code, tasks);
    let resolvePending;
    let stopped = false;
    const pending = tasks.runStartupTask('pending', () => new Promise(resolve => { resolvePending = resolve; }));
    const results = await Promise.all([
        tasks.runStartupTask('sync failure', () => { throw new Error('missing native module'); }),
        tasks.runStartupTask('async failure', async () => { throw new Error('network unavailable'); }),
        tasks.runStartupTask('working', () => () => { stopped = true; }),
    ]);
    assert.equal(tasks.__CLOUDCORD_STARTUP_TASKS__['pending'].status, 'starting');
    assert.match(tasks.__CLOUDCORD_STARTUP_TASKS__['sync failure'].error, /missing native module/);
    assert.equal(tasks.__CLOUDCORD_STARTUP_TASKS__['async failure'].status, 'failed');
    assert.equal(tasks.__CLOUDCORD_STARTUP_TASKS__['working'].status, 'ready');
    results[2]();
    assert.equal(stopped, true);
    resolvePending();
    await pending;
    assert.equal(tasks.__CLOUDCORD_STARTUP_TASKS__['pending'].status, 'ready');
    console.log('startup tasks: independent sync and async failures, pending diagnosis, and retained cleanup');

    for (const phase of ['cache', 'runtime', 'success', 'pending']) {
        const messages = [];
        let started = false;
        const realm = vm.createContext({
            window: { modules: { 0: { isInitialized: true } } },
            __CLOUDCORD_BRIDGELESS__: true, version: 'test',
            console: { log: (...args) => messages.push(args), error: (...args) => messages.push(args) },
            // Force the error reporter itself to fail too.
            alert: () => { throw new Error('UI not available'); },
            require(name) {
                if (name === '@metro/internals/caches') return { async initMetroCache() {
                    if (phase === 'cache') throw new Error('cache failed');
                }};
                if (name === '.') return { async default() {
                    started = true;
                    if (phase === 'pending') return new Promise(() => {});
                    if (phase === 'runtime') throw new Error('runtime failed');
                }};
                throw new Error('native modules unavailable');
            }
        });
        vm.runInContext(initialize, realm);
        await Promise.race([
            realm.initializeCloudCord(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('optional startup blocked Discord launch')), 100))
        ]);
        assert.equal(started, phase !== 'cache');
        assert.equal(messages.length > 0, phase === 'cache' || phase === 'runtime');
    }
    console.log('startup errors handled; unresolved optional startup cannot block Discord launch');

    for (const update of ['success', 'offline', 'pending', 'unavailable']) {
        let checks = 0;
        const alerts = [];
        const timers = new Set();
        const realm = vm.createContext({
            window: { modules: {} }, __CLOUDCORD_BRIDGELESS__: true,
            version: 'test', console: { log() {}, error() {} }, alert(message) { alerts.push(message); },
            __CLOUDCORD_RUNTIME_REVISION__: '123456789abcdeadbeef',
            setTimeout(fn) { timers.add(fn); return fn; },
            clearTimeout(fn) { timers.delete(fn); },
            require(name) {
                if (name === '@metro/internals/caches') return { initMetroCache() {} };
                if (name === '.') throw new Error("Cannot read property 'default' of undefined");
                if (name === '@lib/api/native/modules') return {
                    BundleUpdaterManager: update === 'unavailable' ? undefined : {
                        checkForUpdates() {
                            checks++;
                            if (update === 'offline') throw new Error('offline');
                            if (update === 'pending') return new Promise(() => {});
                        },
                        reload() { assert.fail('Startup recovery must never reload the app'); }
                    }
                };
                throw new Error('Unexpected import: ' + name);
            }
        });
        vm.runInContext(initialize, realm);
        await realm.initializeCloudCord();
        await realm.initializeCloudCord();
        assert.equal(alerts.length, 2);
        assert.ok(alerts.every(message => message.includes('Runtime: 123456789abc')), 'Startup failures identify the running payload');
        await new Promise(setImmediate);
        assert.equal(checks, update === 'unavailable' ? 0 : 1, 'One recovery check despite repeated errors');
        if (update === 'pending') {
            assert.equal(realm.__CLOUDCORD_STARTUP_RECOVERY__.status, 'checking');
            for (const timer of timers) timer();
            await new Promise(setImmediate);
        }
        if (update !== 'unavailable') {
            assert.equal(realm.__CLOUDCORD_STARTUP_RECOVERY__.status, update === 'success' ? 'checked' : 'failed');
        }
        assert.equal(timers.size, 0, 'Recovery clears its timeout');
    }
    console.log('startup recovery: missing default export, one check, offline/timeout handling, no forced reload');
})().catch(error => { console.error(error); process.exitCode = 1; });
