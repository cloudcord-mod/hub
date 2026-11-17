// Static inventory only. Never loads or executes plugin code.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("../../desktop/client/node_modules/typescript");

const root = path.resolve(process.argv[2] ?? path.join(__dirname, "../.."));
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const desktop = read("examples/cx/catalog-gpl/dist/cloudcord-gpl-pack.json");
const mobile = read("ios/dist/cloudcord-mobile-cx.json");
const discover = read("ios/dist/discover-cx/mobile-conversion-preview.json");
const globals = new Set([
    "vendetta", "bunny", "cloudcord", "DiscordNative", "VencordNative", "ReactNative",
    "window", "document", "navigator", "globalThis", "fetch", "WebSocket",
    "localStorage", "sessionStorage", "XMLHttpRequest", "Notification",
]);

function scan(code) {
    const tree = ts.createSourceFile("plugin.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const modules = new Set(), accesses = new Set(), dynamic = new Set();
    const aliases = new Map();
    function visit(node, action) {
        action(node);
        ts.forEachChild(node, child => visit(child, action));
    }
    function address(node) {
        if (!node) return;
        if (ts.isIdentifier(node)) return aliases.get(node.text) ?? (globals.has(node.text) ? node.text : undefined);
        if (ts.isParenthesizedExpression(node)) return address(node.expression);
        if (ts.isPropertyAccessExpression(node)) {
            const base = address(node.expression);
            if (base) return `${base}.${node.name.text}`;
        }
        if (ts.isElementAccessExpression(node)) {
            const base = address(node.expression);
            if (base) return ts.isStringLiteralLike(node.argumentExpression)
                ? `${base}.${node.argumentExpression.text}` : `${base}.[computed]`;
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
            const arg = node.arguments[0];
            if (arg && ts.isStringLiteralLike(arg)) return `require:${arg.text}`;
        }
    }
    function bind(binding, base) {
        if (ts.isIdentifier(binding)) aliases.set(binding.text, base);
        if (ts.isObjectBindingPattern(binding)) for (const item of binding.elements) {
            if (item.dotDotDotToken) { dynamic.add(`${base}.[rest]`); continue; }
            const key = item.propertyName ?? item.name;
            if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
                const target = `${base}.${key.text}`;
                accesses.add(target);
                bind(item.name, target);
            }
        }
    }
    visit(tree, node => {
        if (ts.isVariableDeclaration(node)) {
            const base = address(node.initializer);
            if (base) bind(node.name, base);
        }
        if (ts.isCallExpression(node)) {
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
                const arg = node.arguments[0];
                if (arg && ts.isStringLiteralLike(arg)) modules.add(arg.text);
                else dynamic.add("dynamic module specifier");
            }
            const target = address(node.expression);
            if (target && /\.(?:findByProps|findByName|findByStoreName|findByDisplayName|findByFilePath)(?:Lazy)?$/.test(target)) {
                const args = node.arguments;
                if (args.length && args.every(ts.isStringLiteralLike)) {
                    accesses.add(`${target}(${args.map(arg => JSON.stringify(arg.text)).join(", ")})`);
                } else dynamic.add(`${target}(dynamic)`);
            }
        }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const target = address(node);
            if (target) (target.includes(".[computed]") ? dynamic : accesses).add(target);
        }
    });
    return {
        modules: [...modules].sort(),
        accesses: [...accesses].sort(),
        dynamic: [...dynamic].sort(),
    };
}

const inventory = [];
for (const [set, pack] of [["desktop-gpl", desktop], ["shared-declarative", mobile], ["discover-preview", discover]]) {
    for (const entry of pack.entries) {
        const id = entry.id.replace(/^gpl\//, "");
        const permissions = [...entry.source.matchAll(/^\s+needs ([\w.-]+)\s*$/gm)].map(match => match[1]);
        const features = [...entry.source.matchAll(/^  use ([\w-]+)\s*$/gm)].map(match => match[1])
            .filter(feature => feature !== id);
        const info = pack.scripts?.[id] ? scan(pack.scripts[id]) : {
            modules: [], accesses: [], dynamic: [],
        };
        inventory.push({ id: entry.id, set, permissions, features, ...info });
    }
}
const frequency = key => {
    const counts = new Map();
    for (const entry of inventory) for (const value of new Set(entry[key])) counts.set(value, (counts.get(value) ?? 0) + 1);
    return Object.fromEntries([...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)));
};
const result = {
    method: "Static AST over packaged scripts and CX capability declarations. Computed or indirect API calls require runtime tracing.",
    totals: { entries: inventory.length, entriesWithDynamicReferences: inventory.filter(entry => entry.dynamic.length).length },
    modules: frequency("modules"),
    accesses: frequency("accesses"),
    permissions: frequency("permissions"),
    features: frequency("features"),
    entries: inventory,
};
const output = path.resolve(process.argv[3] ?? path.join(root, "ios/dist/cx-api-inventory.json"));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ ...result.totals, modules: Object.keys(result.modules).length, accesses: Object.keys(result.accesses).length, permissions: Object.keys(result.permissions).length, output }));
