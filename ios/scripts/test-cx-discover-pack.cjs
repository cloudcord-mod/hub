const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { readExportSnapshot } = require("./cx-export-snapshot.cjs");

const [sourceRoot, enginePath, output] = process.argv.slice(2);
if (!sourceRoot || !enginePath || !output) throw new Error("Usage: test-cx-discover-pack.cjs <candidate checkout> <QuickJS package path> <report.json>");
const { newQuickJSWASMModule } = require(path.resolve(enginePath));
const packSource = fs.readFileSync(path.resolve(sourceRoot, "ios/dist/discover-cx/mobile-conversion-preview.json"), "utf8");
const pack = JSON.parse(packSource);

// Host calls run inside QuickJS with no Discord account, network, or filesystem.
// Registered callbacks and timers are tracked without being executed.
const bootstrap = `
globalThis.window = globalThis;
globalThis.console = { log() {}, info() {}, debug() {}, warn() {}, error() {} };
const requests = new Map();
const used = new Set();
const patches = new Set();
const timers = new Set();
const subscriptions = new Map();
let nextTimer = 0;
globalThis.setTimeout = globalThis.setInterval = () => {
    const timer = ++nextTimer;
    timers.add(timer);
    return timer;
};
globalThis.clearTimeout = globalThis.clearInterval = timer => { timers.delete(timer); };
const dispatcher = {
    subscribe(event, callback) {
        if (!subscriptions.has(event)) subscriptions.set(event, new Set());
        subscriptions.get(event).add(callback);
    },
    unsubscribe(event, callback) { subscriptions.get(event)?.delete(callback); },
    dispatch() {},
};
const patcher = Object.fromEntries(["before", "after", "instead"].map(kind => [kind, (key, target, callback) => {
    if (typeof key !== "string" || typeof callback !== "function" || typeof target?.[key] !== "function") {
        throw new Error("Cannot register " + kind + " patch for " + String(key));
    }
    const patch = { kind, key };
    patches.add(patch);
    return () => { patches.delete(patch); };
}]));
function stub(name) {
    return new Proxy(function () {}, {
        get(target, key) {
            if (key === Symbol.iterator) return function* () {};
            if (key === Symbol.toPrimitive) return () => "";
            if (key === "then" || key === "$$typeof") return undefined;
            if (name === "metro.common" && key === "FluxDispatcher") return dispatcher;
            if (typeof key !== "string" || Reflect.has(target, key)) return Reflect.get(target, key);
            const member = name + "." + key;
            used.add(member);
            return stub(member);
        },
        apply() { used.add(name); return stub(name + "()"); },
        construct() { return {}; },
    });
}
const metro = {
    common: stub("metro.common"),
    findByProps: (...keys) => {
        if (keys.length && keys.every(key => typeof key === "string")) requests.set(JSON.stringify(keys), keys);
        return stub("metro.findByProps()");
    },
};
const vendetta = new Proxy({ patcher, plugin: { storage: {} }, metro: new Proxy(metro, {
    get: (target, key) => key in target ? target[key] : stub("metro." + String(key)),
}) }, { get: (target, key) => key in target ? target[key] : stub(String(key)) });
globalThis.vendetta = vendetta;
globalThis.bunny = { metro, api: { patcher, flux: { intercept(callback) {
    dispatcher.subscribe("intercept", callback);
    return () => dispatcher.unsubscribe("intercept", callback);
} } } };
const module = { exports: {} };
const require = name => {
    if (name !== "@cloudcord/mobile-vendetta") throw new Error("Unexpected external module: " + name);
    return { adapt: (_metadata, factory) => factory(vendetta) };
};
`;

function lifecycleResult(context, runtime, renewDeadline) {
    function evaluate(source) {
        renewDeadline();
        const execution = context.evalCode(source);
        const value = execution.error ?? execution.value;
        try {
            const result = context.dump(value);
            if (execution.error) throw new Error(result.message ?? String(result));
            return result;
        } finally { value.dispose(); }
    }
    function drainJobs() {
        renewDeadline();
        const jobs = runtime.executePendingJobs(128);
        if (!jobs.error) return;
        try { throw new Error(context.dump(jobs.error).message ?? "Pending lifecycle job failed"); }
        finally { jobs.error.dispose(); }
    }
    try {
        evaluate(`
const candidate = module.exports?.default ?? module.exports;
const errors = [];
const traces = [];
let pending = 0;
function record(stage, failure) {
    errors.push(stage + ": " + String(failure?.message ?? failure));
    if (typeof failure?.stack === "string") traces.push({ stage, stack: failure.stack.split("\\n").slice(0, 6).join("\\n") });
}
function invokeLifecycle(stage, aliases) {
    try {
        const key = aliases.find(key => typeof candidate[key] === "function");
        if (!key) return;
        const result = candidate[key]();
        if (typeof result?.then !== "function") return;
        pending++;
        Promise.resolve(result).then(() => { pending--; }, failure => { pending--; record(stage, failure); });
    } catch (failure) { record(stage, failure); }
}
invokeLifecycle("start", ["onLoad", "start"]);
`);
        drainJobs();
        evaluate('invokeLifecycle("stop", ["onUnload", "stop"]);');
        drainJobs();
        const data = JSON.parse(evaluate(`JSON.stringify({ errors, traces, pending,
            retained: { patches: patches.size, timers: timers.size,
                subscriptions: [...subscriptions.values()].reduce((count, group) => count + group.size, 0) },
            requests: [...requests.values()] })`));
        const status = data.errors.length ? "Fail" : data.pending ? "Blocked"
            : Object.values(data.retained).some(Boolean) ? "Fail" : "Pass";
        return { status, ...data };
    } catch (error) {
        return { status: "Fail", errors: [error.message] };
    }
}

async function main() {
    let engine = await newQuickJSWASMModule();
    const observed = readExportSnapshot(path.resolve(sourceRoot, "ios/dist/cx-modules-android.txt"));
    const evidence = new Map();
    const rows = [];
    for (const { id } of pack.entries) {
        const script = pack.scripts[id];
        if (typeof script !== "string") { rows.push({ id, status: "Fail", error: "Preview source missing" }); continue; }
        const runtime = engine.newRuntime();
        runtime.setMemoryLimit(48 * 1024 * 1024);
        runtime.setMaxStackSize(768 * 1024);
        let until = Date.now() + 250;
        runtime.setInterruptHandler(() => Date.now() > until);
        const context = runtime.newContext();
        try {
            const check = context.evalCode(bootstrap + `
let error = "";
let factoryTrace;
let hooks = [];
let settingsDeclared = false;
try {
    new Function("require", "module", ${JSON.stringify(script)})(require, module);
    const candidate = module.exports?.default ?? module.exports;
    if (!candidate || typeof candidate !== "object") throw new Error("Preview did not export a plugin object");
    hooks = ["onLoad", "onUnload", "start", "stop"].filter(key => typeof candidate[key] === "function");
    settingsDeclared = Boolean(candidate.settings);
    if (!hooks.length && !settingsDeclared) throw new Error("Preview has no recognizable lifecycle or settings");
} catch (failure) {
    error = String(failure?.message ?? failure);
    if (typeof failure?.stack === "string") factoryTrace = failure.stack.split("\\n").slice(0, 6).join("\\n");
}
JSON.stringify({ error, factoryTrace, hooks, settingsDeclared, requests: [...requests.values()], fixtureApis: [...used].sort() });`);
            const value = check.error ?? check.value;
            try {
                const result = context.dump(value);
                if (check.error) { rows.push({ id, status: "Fail", error: result.message ?? String(result) }); continue; }
                const data = JSON.parse(result);
                const lifecycle = !data.error && data.hooks.length
                    ? lifecycleResult(context, runtime, () => { until = Date.now() + 250; })
                    : { status: "Blocked", errors: [data.error ? "Factory failed before startup" : "No executable lifecycle hooks"] };
                const requests = (lifecycle.requests ?? data.requests).map(keys => {
                    const key = JSON.stringify(keys);
                    if (!evidence.has(key)) evidence.set(key, observed?.(keys) ?? null);
                    return { keys, observedInAndroidSnapshot: evidence.get(key) };
                });
                delete lifecycle.requests;
                rows.push({ id, status: data.error ? "Fail" : "Pass", error: data.error, factoryTrace: data.factoryTrace,
                    hooks: data.hooks, settingsDeclared: data.settingsDeclared, requests, fixtureApis: data.fixtureApis, lifecycle });
            } finally { value.dispose(); }
        } finally {
            try { context.dispose(); runtime.dispose(); }
            catch (error) {
                const row = rows.at(-1);
                const failure = "QuickJS cleanup failed: " + (error.message ?? String(error)).split("\n")[0];
                if (row?.id === id) row.lifecycle = { ...row.lifecycle, status: "Blocked", errors: [...(row.lifecycle?.errors ?? []), failure] };
                else rows.push({ id, status: "Fail", error: failure });
                engine = await newQuickJSWASMModule();
            }
        }
    }
    const summary = { checked: rows.length, passed: rows.filter(row => row.status === "Pass").length,
        failed: rows.filter(row => row.status === "Fail").length, distinctFindByProps: evidence.size,
        observedAndroidSignatures: [...evidence.values()].filter(Boolean).length,
        lifecycle: Object.fromEntries(["Pass", "Fail", "Blocked"].map(status => [status,
            rows.filter(row => (row.lifecycle?.status ?? "Blocked") === status).length])) };
    const report = {
        scope: "Discover factories, startup, and cleanup in WebAssembly with inert Vendetta fixtures. Device behavior requires separate results.",
        packSha256: createHash("sha256").update(packSource).digest("hex"), summary, rows,
    };
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(summary));
    if (summary.failed || summary.lifecycle.Fail) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
