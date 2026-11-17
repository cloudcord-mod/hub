const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const [sourceRoot, enginePath, output] = process.argv.slice(2);
if (!sourceRoot || !enginePath || !output) throw new Error("Usage: test-cx-discover-pack.cjs <candidate checkout> <QuickJS package path> <report.json>");
const { getQuickJS } = require(path.resolve(enginePath));
const packSource = fs.readFileSync(path.resolve(sourceRoot, "ios/dist/discover-cx/mobile-conversion-preview.json"), "utf8");
const pack = JSON.parse(packSource);

function androidExports() {
    const file = path.resolve(sourceRoot, "ios/dist/cx-modules-android.txt");
    if (!fs.existsSync(file)) return;
    const modules = [];
    let groups;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const [kind, name] = line.split("\t", 3);
        if (kind === "module") { groups = new Map(); modules.push(groups); }
        if (kind !== "export" || !groups || !name) continue;
        const last = name.lastIndexOf(".");
        const parent = last < 0 ? "" : name.slice(0, last);
        if (!groups.has(parent)) groups.set(parent, new Set());
        groups.get(parent).add(name.slice(last + 1));
    }
    return modules.flatMap(groups => [...groups.values()]);
}

// Only the preview factory runs. All host APIs are inert and lifecycle hooks
// are recorded without being invoked, even when the preview exports an object.
const bootstrap = `
const requests = new Map();
const used = new Set();
function stub(name) {
    return new Proxy(function () {}, {
        get(target, key) {
            if (key === Symbol.iterator) return function* () {};
            if (key === Symbol.toPrimitive) return () => "";
            if (key === "then" || key === "$$typeof") return undefined;
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
const vendetta = new Proxy({ metro: new Proxy(metro, {
    get: (target, key) => key in target ? target[key] : stub("metro." + String(key)),
}) }, { get: (target, key) => key in target ? target[key] : stub(String(key)) });
const module = { exports: {} };
const require = name => {
    if (name !== "@cloudcord/mobile-vendetta") throw new Error("Unexpected external module: " + name);
    return { adapt: (_metadata, factory) => factory(vendetta) };
};
`;

async function main() {
    const engine = await getQuickJS();
    const groups = androidExports();
    const evidence = new Map();
    const rows = [];
    for (const { id } of pack.entries) {
        const script = pack.scripts[id];
        if (typeof script !== "string") { rows.push({ id, status: "Fail", error: "Preview source missing" }); continue; }
        const runtime = engine.newRuntime();
        runtime.setMemoryLimit(48 * 1024 * 1024);
        runtime.setMaxStackSize(768 * 1024);
        const until = Date.now() + 250;
        runtime.setInterruptHandler(() => Date.now() > until);
        const context = runtime.newContext();
        try {
            const check = context.evalCode(bootstrap + `
let error = "";
let hooks = [];
let settingsDeclared = false;
try {
    new Function("require", "module", ${JSON.stringify(script)})(require, module);
    const candidate = module.exports?.default ?? module.exports;
    if (!candidate || typeof candidate !== "object") throw new Error("Preview did not export a plugin object");
    hooks = ["onLoad", "onUnload", "start", "stop"].filter(key => typeof candidate[key] === "function");
    settingsDeclared = Boolean(candidate.settings);
    if (!hooks.length && !settingsDeclared) throw new Error("Preview has no recognizable lifecycle or settings");
} catch (failure) { error = String(failure?.message ?? failure); }
JSON.stringify({ error, hooks, settingsDeclared, requests: [...requests.values()], fixtureApis: [...used].sort() });`);
            const value = check.error ?? check.value;
            try {
                const result = context.dump(value);
                if (check.error) { rows.push({ id, status: "Fail", error: result.message ?? String(result) }); continue; }
                const data = JSON.parse(result);
                const requests = data.requests.map(keys => {
                    const key = JSON.stringify(keys);
                    if (!evidence.has(key)) evidence.set(key, groups?.some(group => keys.every(name => group.has(name))) ?? null);
                    return { keys, observedInAndroidSnapshot: evidence.get(key) };
                });
                rows.push({ id, status: data.error ? "Fail" : "Pass", error: data.error, hooks: data.hooks, settingsDeclared: data.settingsDeclared, requests, fixtureApis: data.fixtureApis });
            } finally { value.dispose(); }
        } finally { context.dispose(); runtime.dispose(); }
    }
    const summary = { checked: rows.length, passed: rows.filter(row => row.status === "Pass").length,
        failed: rows.filter(row => row.status === "Fail").length, distinctFindByProps: evidence.size,
        observedAndroidSignatures: [...evidence.values()].filter(Boolean).length };
    const report = {
        scope: "Discover preview factories executed in WebAssembly with inert Vendetta fixtures. Device activation remains unverified.",
        packSha256: createHash("sha256").update(packSource).digest("hex"), summary, rows,
    };
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(summary));
    if (summary.failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
