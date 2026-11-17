// Lists source requirements and matches whole export objects across platforms.
// Reading a dump never executes Discord functions or authorizes plugin actions.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const [inventoryFile, desktopFile, mobileFile, outputFile, contractsFile] = process.argv.slice(2);
if (!inventoryFile || !desktopFile || !mobileFile || !outputFile)
    throw new Error("Provide inventory.json, Windows.txt, Android.txt and output.json, optionally contracts.json");
if (path.extname(outputFile).toLowerCase() !== ".json") throw new Error("The adapter report must end in .json");
const inputPaths = new Set([inventoryFile, desktopFile, mobileFile].map(file => path.resolve(file).toLowerCase()));
if (inputPaths.has(path.resolve(outputFile).toLowerCase()) || contractsFile && (
    inputPaths.has(path.resolve(contractsFile).toLowerCase()) || path.resolve(contractsFile).toLowerCase() === path.resolve(outputFile).toLowerCase()))
    throw new Error("Reports and generated contracts require their own output files");
const read = file => fs.readFileSync(file, "utf8");
const inventoryText = read(inventoryFile);
const inventory = JSON.parse(inventoryText);
const inputs = { inventory: inventoryText, desktop: read(desktopFile), mobile: read(mobileFile) };
if (!Array.isArray(inventory.entries) || inventory.entries.length !== inventory.totals.entries)
    throw new Error("Incomplete plugin inventory");

function snapshot(text, platform) {
    if (!text.startsWith("# CloudCord module inventory: " + platform + "\n")
        && !text.startsWith("# CloudCord module inventory: " + platform + "\r\n")) throw new Error("Wrong module dump for " + platform);
    const groups = new Map();
    let moduleId;
    for (const line of text.split(/\r?\n/)) {
        const [type, value, kind] = line.split("\t");
        if (type === "module") moduleId = kind === "loaded" ? value : undefined;
        if (type !== "export" || moduleId === undefined || !value) continue;
        const dot = value.lastIndexOf(".");
        const parent = dot < 0 ? "" : value.slice(0, dot);
        const key = value.slice(dot + 1);
        const id = JSON.stringify([moduleId, parent]);
        if (!groups.has(id)) groups.set(id, { moduleId, parent, properties: new Map() });
        groups.get(id).properties.set(key, kind);
    }
    if (!groups.size) throw new Error("The module dump has no loaded export groups");
    const index = new Map();
    for (const group of groups.values()) for (const key of group.properties.keys()) {
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(group);
    }
    return { groups: [...groups.values()], index };
}
const snapshots = { desktop: snapshot(inputs.desktop, "desktop-webpack"), mobile: snapshot(inputs.mobile, "mobile-metro") };
const requests = new Map();
const wrappers = new Map();
const dynamic = [];
const signature = keys => JSON.stringify([...new Set(keys)].sort());
function request(keys, plugin, reference) {
    if (!keys.length || keys.some(key => typeof key !== "string" || !key)) return;
    const id = signature(keys);
    if (!requests.has(id)) requests.set(id, { id, properties: JSON.parse(id), plugins: new Set(), references: new Set() });
    const entry = requests.get(id);
    entry.plugins.add(plugin);
    entry.references.add(reference);
}
for (const plugin of inventory.entries) {
    for (const module of plugin.modules) {
        if (!wrappers.has(module)) wrappers.set(module, new Set());
        wrappers.get(module).add(plugin.id);
    }
    for (const reference of plugin.accesses) {
        const lookup = /\.findByProps(?:Lazy)?\((.*)\)$/.exec(reference);
        if (lookup) {
            try { request(JSON.parse("[" + lookup[1] + "]"), plugin.id, reference); }
            catch { dynamic.push({ plugin: plugin.id, reference }); }
        }
        const member = /^(?:require:@webpack\/common\.|(?:vendetta|bunny)\.metro\.common\.)([\w$]+)\.([\w$]+)$/.exec(reference);
        if (member) request([member[2]], plugin.id, reference);
        if (/\.findBy(?:StoreName|Name|DisplayName|FilePath)(?:Lazy)?\(/.test(reference))
            dynamic.push({ plugin: plugin.id, reference, reason: "Needs its named store, component or file adapter" });
    }
    for (const reference of plugin.dynamic) dynamic.push({ plugin: plugin.id, reference, reason: "Computed lookup needs runtime evidence" });
}

function matches(dump, keys) {
    return [...(dump.index.get(keys[0]) ?? [])].filter(group => keys.every(key => group.properties.has(key)));
}
const evidence = (groups, keys) => ({ count: groups.length, candidates: groups.slice(0, 8).map(group => ({
    moduleId: group.moduleId, parent: group.parent,
    types: Object.fromEntries(keys.map(key => [key, group.properties.get(key)])),
})) });
function nearest(dump, keys) {
    const groups = new Set(keys.flatMap(key => [...(dump.index.get(key) ?? [])]));
    return [...groups].map(group => ({ moduleId: group.moduleId, parent: group.parent,
        matched: keys.filter(key => group.properties.has(key)), missing: keys.filter(key => !group.properties.has(key)),
    })).sort((a, b) => b.matched.length - a.matched.length || a.missing.length - b.missing.length).slice(0, 3);
}
const contracts = {};
const rows = [...requests.values()].map(entry => {
    const found = Object.fromEntries(Object.entries(snapshots).map(([platform, dump]) => [platform, matches(dump, entry.properties)]));
    const common = entry.properties.every(key => found.desktop.length && found.mobile.length
        && found.desktop.every(group => group.properties.get(key) === found.desktop[0].properties.get(key))
        && found.mobile.every(group => group.properties.get(key) === found.desktop[0].properties.get(key)));
    const sensitive = entry.properties.some(key => /token|password|secret|credential|authorization|login/i.test(key));
    const generic = entry.properties.some(key => ["call", "apply", "bind", "constructor", "prototype", "__proto__", "then"].includes(key));
    const exact = common && !sensitive && !generic && found.desktop.length === 1 && found.mobile.length === 1
        && entry.properties.every(key => found.desktop[0].properties.get(key) === "function");
    if (exact) contracts[entry.id] = { properties: entry.properties, types: Object.fromEntries(entry.properties.map(key => [key, "function"])) };
    return { ...entry, plugins: [...entry.plugins].sort(), references: [...entry.references].sort(),
        status: sensitive ? "Restricted" : generic ? "Wrapper member" : exact ? "Same methods on both" : common ? "Ambiguous exports" : "Platform adapter needed",
        desktop: evidence(found.desktop, entry.properties), mobile: evidence(found.mobile, entry.properties),
        ...(!found.desktop.length ? { nearestDesktop: nearest(snapshots.desktop, entry.properties) } : {}),
        ...(!found.mobile.length ? { nearestMobile: nearest(snapshots.mobile, entry.properties) } : {}),
    };
}).sort((a, b) => b.plugins.length - a.plugins.length || a.id.localeCompare(b.id));
const report = {
    scope: "Static plugin requirements and export shape comparison. Function arguments and behavior require adapter tests.",
    checkedAt: new Date().toISOString(),
    inputHashes: Object.fromEntries(Object.entries(inputs).map(([name, text]) => [name, createHash("sha256").update(text).digest("hex")])),
    pluginCount: inventory.totals.entries,
    plugins: inventory.entries,
    counts: { moduleWrappers: wrappers.size, propertyContracts: rows.length, commonMethodContracts: Object.keys(contracts).length, unresolvedReferences: dynamic.length },
    modules: [...wrappers].map(([name, ids]) => ({ name, plugins: [...ids].sort() })).sort((a, b) => b.plugins.length - a.plugins.length),
    contracts: rows, unresolved: dynamic,
};
fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n");
const lines = [report.scope, "", `Plugins ${report.pluginCount}`, ...Object.entries(report.counts).map(([key, value]) => key + " " + value), "", "MODULE WRAPPERS"];
for (const module of report.modules) lines.push(module.name + " — " + module.plugins.length + " plugins", "  " + module.plugins.join(", "));
lines.push("", "PROPERTY CONTRACTS");
for (const row of rows) lines.push(row.id + " — " + row.status, "  " + row.plugins.join(", "),
    "  desktop " + row.desktop.count + ", mobile " + row.mobile.count,
    ...row.references.map(reference => "  " + reference),
    ...Object.entries({ desktop: row.nearestDesktop, mobile: row.nearestMobile }).flatMap(([platform, nearest]) => (nearest ?? [])
        .map(hit => "  nearest " + platform + " " + hit.moduleId + "/" + hit.parent + ", missing " + hit.missing.join(", "))));
lines.push("", "UNRESOLVED REFERENCES");
for (const row of dynamic) lines.push(row.plugin + " — " + row.reference + (row.reason ? " — " + row.reason : ""));
lines.push("", "ALL PLUGIN REFERENCES");
for (const plugin of inventory.entries) lines.push(plugin.id,
    ...plugin.modules.map(module => "  module " + module),
    ...plugin.permissions.map(permission => "  permission " + permission),
    ...plugin.features.map(feature => "  feature " + feature),
    ...plugin.accesses.map(reference => "  API " + reference),
    ...plugin.dynamic.map(reference => "  dynamic " + reference));
fs.writeFileSync(outputFile.replace(/\.json$/i, ".txt"), lines.join("\n") + "\n");
if (contractsFile) fs.writeFileSync(contractsFile, JSON.stringify(contracts, null, 2) + "\n");
console.log(JSON.stringify({ ...report.counts, plugins: report.pluginCount, output: path.resolve(outputFile) }));
