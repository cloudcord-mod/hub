const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");

const [sourceRoot, enginePath, outputFile] = process.argv.slice(2);
if (!sourceRoot || !enginePath || !outputFile) {
    console.error("Usage: node ios/scripts/test-cx-desktop-pack.cjs <CX pack checkout> <QuickJS package path> <report.json>");
    process.exit(1);
}

const loadRuntimeDependency = createRequire(path.resolve(__dirname, "../runtime/package.json"));
const { transformSync } = loadRuntimeDependency("esbuild");
const { getQuickJS } = require(path.resolve(enginePath));
const read = relative => fs.readFileSync(path.resolve(sourceRoot, relative), "utf8");
const packSource = read("examples/cx/catalog-gpl/dist/cloudcord-gpl-pack.json");
const pack = JSON.parse(packSource);

function loadModule(file) {
    const { code } = transformSync(read("core/src/renderer/" + file), { format: "cjs", loader: "js", sourcefile: file });
    return `(function (require) { const module = { exports: {} }; ${code}\nreturn module.exports; })`;
}

const bootstrap = `
globalThis.window = globalThis;
globalThis.document = {
    documentElement: {}, head: {}, addEventListener() {}, removeEventListener() {},
    createElement: () => ({ style: { transform: "", transition: "" } }),
};
globalThis.location = { href: "https://discord.invalid/channels/@me", origin: "https://discord.invalid" };
const react = {
    Component: class {}, PureComponent: class {}, Fragment: Symbol("fragment"),
    createElement: (type, props) => ({ type, props }),
    memo: fn => fn, forwardRef: fn => fn, createContext: value => ({ _currentValue: value }),
    isValidElement: value => Boolean(value?.type),
};
const logger = { logger: () => ({ warn() {}, error() {}, debug() {}, info() {} }) };
const webpack = ${loadModule("webpack.js")}(() => logger);
const cloudcord = window.CloudCord = {
    webpack, discord: { React: react, store() {} },
    settings: { getData: (_key, fallback) => fallback, setData() {} },
    menus: { Menu: { types: () => ({}) } },
};
const scripts = ${loadModule("scripts.js")}(name => name === "./webpack.js" ? webpack : logger);
const fixture = (operation, ...args) => JSON.parse(cxFixture(operation, JSON.stringify(args)));
globalThis.TextEncoder = class { encode(text = "") { return Uint8Array.from(fixture("encode", String(text))); } };
globalThis.TextDecoder = class { decode(value = []) { return fixture("decode", Array.from(value)); } };
globalThis.URL = class {
    constructor(value, base) { Object.assign(this, fixture("url", String(value), base === undefined ? undefined : String(base))); }
    toString() { return this.href; }
};
globalThis.crypto = Object.freeze({ randomUUID: () => fixture("uuid") });
globalThis.Intl = Object.fromEntries(["NumberFormat", "DateTimeFormat", "DisplayNames", "Collator", "RelativeTimeFormat", "ListFormat", "PluralRules"].map(name => [name, class {
    constructor(...args) {
        this.args = args.map(value => ({ value }));
        this.options = fixture("intl", name, this.args, "resolvedOptions", []);
    }
    resolvedOptions() { return this.options; }
    format(...args) { return fixture("intl", name, this.args, "format", args.map(value => value instanceof Date ? value.getTime() : value)); }
    of(...args) { return fixture("intl", name, this.args, "of", args); }
    compare(...args) { return fixture("intl", name, this.args, "compare", args); }
}]));
Intl.supportedValuesOf = key => fixture("intlValues", key);
new Function("cloudcord", "scripts", ${JSON.stringify(pack.setup)})(cloudcord, scripts);
`;

const intlConstructors = new Set(["NumberFormat", "DateTimeFormat", "DisplayNames", "Collator", "RelativeTimeFormat", "ListFormat", "PluralRules"]);
const intlMethods = new Set(["resolvedOptions", "format", "of", "compare"]);

// Only pure data operations cross out of the sandbox. URLs are parsed locally
// and the module scripts have no filesystem, Discord session or network API.
function runFixture(operation, data) {
    if (data.length > 64 * 1024) throw new Error("Fixture input is too large");
    const args = JSON.parse(data);
    switch (operation) {
        case "uuid": return randomUUID();
        case "encode": return [...new TextEncoder().encode(args[0])];
        case "decode": return new TextDecoder().decode(Uint8Array.from(args[0]));
        case "url": {
            const url = new URL(args[0], args[1] ?? undefined);
            return Object.fromEntries(["href", "origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash", "username", "password"].map(key => [key, url[key]]));
        }
        case "intlValues": return Intl.supportedValuesOf(args[0]);
        case "intl": {
            const [name, options, method, values] = args;
            if (!intlConstructors.has(name) || !intlMethods.has(method)) throw new Error("Unknown Intl fixture operation");
            const formatter = new Intl[name](...options.map(option => option.value));
            return Reflect.apply(formatter[method], formatter, values);
        }
        default: throw new Error("Unknown fixture operation");
    }
}

async function main() {
    const engine = await getQuickJS();
    const rows = [];
    for (const entry of pack.entries) {
        const code = pack.scripts[entry.id.replace(/^gpl\//, "")];
        if (typeof code !== "string") {
            rows.push({ id: entry.id, loaded: false, error: "Pack script is missing" });
            continue;
        }
        const runtime = engine.newRuntime();
        runtime.setMemoryLimit(64 * 1024 * 1024);
        runtime.setMaxStackSize(768 * 1024);
        const deadline = Date.now() + 250;
        runtime.setInterruptHandler(() => Date.now() > deadline);
        const context = runtime.newContext();
        try {
            const hook = context.newFunction("cxFixture", (operation, data) =>
                context.newString(JSON.stringify(runFixture(context.getString(operation), context.getString(data))) ?? "null"));
            context.setProp(context.global, "cxFixture", hook);
            hook.dispose();
            const checked = context.evalCode(`${bootstrap}
const rec = scripts.loadScript(${JSON.stringify(entry.id)}, ${JSON.stringify(code)}, { patches: false });
JSON.stringify({ loaded: !rec.error, error: rec.error?.message ?? "", stack: rec.error?.stack?.split("\\n").slice(0, 4).join("\\n"), warnings: [...rec.warnings], patches: rec.plugin?.patches?.length ?? 0 });`);
            const value = checked.error ?? checked.value;
            try {
                const returned = context.dump(value);
                rows.push(checked.error ? { id: entry.id, loaded: false, phase: "sandbox", error: returned.message ?? String(returned) }
                    : { id: entry.id, ...JSON.parse(returned) });
            } finally {
                value.dispose();
            }
        } finally {
            context.dispose();
            runtime.dispose();
        }
    }
    const summary = {
        checked: rows.length,
        loaded: rows.filter(row => row.loaded).length,
        loadedWithWarnings: rows.filter(row => row.loaded && row.warnings.length).length,
        failed: rows.filter(row => !row.loaded).length,
    };
    const report = {
        scope: "Module load in fresh WebAssembly runtimes using the desktop loader and compatibility setup. Discord features and startup hooks were not exercised.",
        packSha256: createHash("sha256").update(packSource).digest("hex"), summary, rows,
    };
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
