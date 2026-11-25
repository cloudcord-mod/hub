const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const esbuild = require(process.env.CLOUDCORD_ESBUILD || "esbuild");
const moduleObject = { exports: {} }, timers = [];
const running = "a".repeat(40), next = "b".repeat(40), payload = "c".repeat(40);
let saved, calls = 0, manifestVersion = running, writes = 0;
const payloadUrls = [];
const context = { module: moduleObject, exports: moduleObject.exports, Date, Promise,
    setTimeout: fn => { timers.push(fn); return fn; }, clearTimeout() {},
    setInterval: fn => { timers.push(fn); return fn; }, clearInterval() {},
    __CLOUDCORD_RUNTIME_REVISION__: running,
    fetch: async url => {
        if (url.includes("runtime-manifest.json?t=")) {
            return { ok: true, json: async () => ({
                schema: 1, version: manifestVersion,
                url: `https://getcloudcord.com/api/proxy/raw/dist/cc.js?ref=${payload}`
            }) };
        }
        calls++;
        payloadUrls.push(url);
        return { ok: true, text: async () => "CloudCord" + " ".repeat(11000) };
    }
};
vm.runInNewContext(esbuild.transformSync(fs.readFileSync("ios/runtime/src/lib/api/native/runtimeUpdates.ts", "utf8"), { loader: "ts", format: "cjs" }).code, context);
(async () => {
    const api = moduleObject.exports;
    const updater = api.createRainUpdater({ writeFile: async (dir, path, code) => {
        assert.equal(dir, "documents"); assert.equal(path, "rain/bundle.js"); writes++; saved = code; return "/documents/rain/bundle.js";
    }, readFile: async () => saved });
    await Promise.all([updater.download(), updater.download()]);
    assert.equal(calls, 1);
    assert.equal(await updater.checkForUpdates(), false);
    assert.equal(calls, 1, "a current build checks the manifest only");
    manifestVersion = next;
    assert.deepEqual(await Promise.all([updater.checkForUpdates(), updater.checkForUpdates()]), [true, true]);
    assert.match(payloadUrls.at(-1), new RegExp(`[?]ref=${payload}$`));
    assert.equal(await updater.checkForUpdates(), true, "a saved update still needs a restart");
    assert.equal(calls, 2, "an already saved revision is not downloaded again");
    assert.equal(writes, 2);
    context.__CLOUDCORD_RUNTIME_REVISION__ = next;
    assert.equal(await updater.checkForUpdates(), false);
    let checks = 0;
    const prefs = {};
    const stop = api.startAutoUpdates(prefs, { checkForUpdates: async () => { if (++checks === 1) throw Error("offline"); } });
    await new Promise(setImmediate);
    assert.match(prefs.cloudcordUpdateStatus, /offline/);
    timers.at(-1)();
    await new Promise(setImmediate);
    assert.equal(checks, 2);
    assert.match(prefs.cloudcordUpdateStatus, /Latest runtime saved/);
    prefs.cloudcordAutoUpdate = false;
    timers.at(-1)();
    await new Promise(setImmediate);
    assert.equal(checks, 2);
    stop();
    const legacyPrefs = {};
    const legacyUpdater = { checks: 0, async download() { this.checks++; } };
    const stopLegacy = api.startAutoUpdates(legacyPrefs, legacyUpdater);
    await new Promise(setImmediate);
    assert.equal(legacyUpdater.checks, 1);
    assert.match(legacyPrefs.cloudcordUpdateStatus, /Latest runtime saved/);
    stopLegacy();
    await assert.rejects(api.fetchRuntimeUpdate(undefined), /Refetch Bundle/);
    console.log("auto-update checks passed: deduplicated download, correct Rain cache, readback, retries, opt-out");
})().catch(error => { console.error(error); process.exitCode = 1; });
