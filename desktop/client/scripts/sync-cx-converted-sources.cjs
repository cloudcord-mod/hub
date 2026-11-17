const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "../../..");
const [sourceRoot, reportFile] = process.argv.slice(2);
if (!sourceRoot || !reportFile) throw new Error("Provide the converted pack checkout and its batch report");
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
if (report.adapterSuite?.status !== "Pass") throw new Error("The shared adapter checks must pass");
const sourceFiles = {
    "Desktop CX pack": "examples/cx/catalog-gpl/dist/cloudcord-gpl-pack.json",
    "Shared declarative CX": "ios/dist/cloudcord-mobile-cx.json",
    "Discover CX preview": "ios/dist/discover-cx/mobile-conversion-preview.json",
};
const packs = new Map();
for (const [group, file] of Object.entries(sourceFiles)) {
    const text = fs.readFileSync(path.resolve(sourceRoot, file), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== report.sources?.packs[group])
        throw new Error("Candidate pack changed since testing: " + group);
    packs.set(group, new Map(JSON.parse(text).entries.map(entry => [entry.id, entry.source])));
}
const normalize = source => source.replace(/^\uFEFF/, "").split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith("//")).join("\n").trim();
const catalog = new Map();
const folder = path.join(root, "examples/cx/catalog/plugins");
const files = [path.join(root, "examples/cx/pilot/character-counter.cx"),
    ...fs.readdirSync(folder).filter(file => file.endsWith(".cx")).map(file => path.join(folder, file))];
for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const header = /^plugin (".+"):$/.exec(source.split(/\r?\n/)[0]);
    if (!header) throw new Error("Invalid shared plugin: " + file);
    catalog.set(JSON.parse(header[1]), normalize(source));
}
const aliases = new Map();
for (const entry of report.candidates) {
    if (entry.desktop?.status !== "Pass" || entry.mobile?.status !== "Pass" || !entry.catalogName) continue;
    const original = packs.get(entry.group)?.get(entry.id);
    const target = catalog.get(entry.catalogName);
    if (!original || !target) throw new Error("Missing reviewed source: " + entry.id);
    const source = normalize(original);
    if (source === target) continue;
    if (aliases.has(source) && aliases.get(source) !== target) throw new Error("Conflicting converted source: " + entry.id);
    aliases.set(source, target);
}
const output = path.join(root, "desktop/client/src/utils/cxConvertedSources.json");
fs.writeFileSync(output, JSON.stringify(Object.fromEntries([...aliases].sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");
console.log("Linked " + aliases.size + " converted CX sources to reviewed shared implementations");
