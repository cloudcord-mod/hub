const fs = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "../../..");
const catalogPath = path.join(root, "desktop/client/src/utils/cxCatalog.ts");
const desktopPluginTarget = 700;
const mobilePluginTarget = 500;

function loadCxRuntime() {
    const interpreter = { exports: {} };
    const { outputFiles } = buildSync({
        entryPoints: [path.join(root, "desktop/client/src/utils/cx.ts")],
        nodePaths: [path.resolve(require.resolve("moment/package.json"), "../..")],
        bundle: true, write: false, format: "cjs",
    });
    vm.runInNewContext(outputFiles[0].text, { module: interpreter });
    return interpreter.exports;
}

function loadCxParser() {
    return loadCxRuntime().parseCx;
}

function pluginBody(source) {
    return source.split(/\r?\n/).slice(1).filter(line => line.trim()).join("\n");
}

function pluginPlatforms(plugin, { cxAppearanceTargets, cxNativeEffects }) {
    if (plugin.kind !== "plugin") return { desktopOnly: false, mobileOnly: false, linuxOnly: false };
    const targets = [...plugin.hiddenTargets, ...plugin.styledTargets].map(target => cxAppearanceTargets[target]);
    const effects = plugin.nativeEffects.map(effect => cxNativeEffects[effect]);
    const rules = [...targets, ...effects];
    return {
        desktopOnly: rules.some(rule => rule?.desktopOnly),
        mobileOnly: rules.some(rule => rule?.mobileOnly),
        linuxOnly: effects.some(effect => effect?.linuxOnly),
    };
}

function buildCatalog(additions = new Map()) {
    const runtime = loadCxRuntime();
    const { parseCx, reviewCx, getCxCatalogCategories, canRememberCxExtension, isPrivateCxCommand } = runtime;
    const names = new Set();
    const commands = new Set();
    const groups = {};
    const pluginFiles = new Set();
    const pluginBodies = new Map();
    const imports = [];
    for (const [kind, target, original] of [
        ["plugin", Infinity, "examples/cx/pilot/character-counter.cx"],
        ["theme", 100, "examples/cx/midnight.cx"],
    ]) {
        const folder = `examples/cx/catalog/${kind}s`;
        const filenames = fs.readdirSync(path.join(root, folder)).filter(name => name.endsWith(".cx"));
        if (kind === "plugin") for (const name of filenames) pluginFiles.add(name.toLowerCase());
        if (kind === "plugin") for (const name of additions.keys()) {
            if (!/^[a-z][a-z0-9-]*\.cx$/.test(name) || filenames.some(existing => existing.toLowerCase() === name))
                throw new Error("Invalid or existing CX filename: " + name);
            filenames.push(name);
        }
        const files = [original, ...filenames.sort().map(name => folder + "/" + name)];
        if (files.length > target) throw new Error(`CX ${kind} catalog exceeds ${target} entries`);
        groups[kind + "s"] = files.map(file => {
            const extra = kind === "plugin" && file !== original ? additions.get(path.basename(file)) : undefined;
            const document = extra ?? fs.readFileSync(path.join(root, file), "utf8");
            const parsed = parseCx(document);
            const { kind: actualKind, name, commands: declaredCommands } = parsed;
            if (actualKind !== kind) throw new Error(`Unexpected CX kind in ${file}`);
            const normalized = name.trim().toLowerCase();
            if (names.has(normalized)) throw new Error(`Duplicate CX name in ${file}: ${name}`);
            names.add(normalized);
            for (const { name: command } of declaredCommands ?? []) {
                if (commands.has(command)) throw new Error(`Duplicate CX command in ${file}: /${command}`);
                commands.add(command);
            }
            if (kind === "plugin") {
                const body = pluginBody(document);
                const equivalent = pluginBodies.get(body);
                if (equivalent) throw new Error(`Duplicate CX plugin behavior in ${file}: ${name} matches ${equivalent}`);
                pluginBodies.set(body, name);
            }
            // Stable imports keep unrelated entries out of each migration diff.
            const stem = path.basename(file, ".cx");
            if (!/^[a-z0-9][a-z0-9-]*$/.test(stem)) throw new Error("Invalid CX filename: " + file);
            const binding = kind + (file === original ? "_base_" : "_catalog_") + stem.replaceAll("-", "_");
            imports.push(`import ${binding} from "${"../../../../" + file}";`);
            const { desktopOnly, mobileOnly, linuxOnly } = pluginPlatforms(parsed, runtime);
            if (mobileOnly && desktopOnly) throw new Error(`Conflicting platform requirements in ${file}`);
            const review = parsed.kind === "plugin" ? reviewCx(document) : undefined;
            const specific = review?.effects.slice(parsed.permissions?.length ?? 0) ?? [];
            const commandNames = declaredCommands?.map(command => command.name) ?? [];
            const description = parsed.kind === "theme"
                ? [parsed.mode && (parsed.mode[0].toUpperCase() + parsed.mode.slice(1) + " theme"), parsed.wallpaper && "Wallpaper"].filter(Boolean).join(" · ")
                : (specific[0] ?? (commandNames.length ? commandNames.slice(0, 3).map(command => "/" + command).join(" · ") : review?.effects[0] ?? "")).slice(0, 160);
            const keywords = [...new Set([...specific.slice(1), ...(review?.appearanceOptions ?? []).map(option => option.label)])].join(" ").slice(0, 520);
            const appearanceRevision = !desktopOnly && canRememberCxExtension(parsed)
                ? createHash("sha256").update(document.replaceAll("\r\n", "\n")).digest("hex") : undefined;
            const privateCommands = parsed.kind === "plugin" && isPrivateCxCommand(parsed.permissions);
            return { name, binding, description, keywords, desktopOnly, mobileOnly, linuxOnly, commandNames, categories: getCxCatalogCategories(parsed), appearanceRevision, privateCommands };
        });
    }
    const desktopPlugins = groups.plugins.filter(entry => !entry.mobileOnly).length;
    const nonLinuxDesktopPlugins = groups.plugins.filter(entry => !entry.mobileOnly && !entry.linuxOnly).length;
    const mobilePlugins = groups.plugins.filter(entry => !entry.desktopOnly).length;
    if (desktopPlugins > desktopPluginTarget) throw new Error(`CX desktop catalog exceeds ${desktopPluginTarget} entries`);
    const source = [
        "// Generated by scripts/sync-cx-catalog.cjs from the shared .cx files.",
        ...imports,
        "",
        'import type { CxCatalogCategory } from "./cx";',
        "",
        "type CatalogEntry = { name: string; source: string; description?: string; keywords?: string; desktopOnly?: boolean; mobileOnly?: boolean; linuxOnly?: boolean; commands?: readonly string[]; categories: readonly CxCatalogCategory[]; appearanceRevision?: string; privateCommands?: boolean; };",
        "",
        "export const cxCatalog: { plugins: CatalogEntry[]; themes: CatalogEntry[]; } = {",
        ...Object.entries(groups).flatMap(([kind, entries]) => [
            `    ${kind}: [`,
            ...entries.map(({ name, binding, description, keywords, desktopOnly, mobileOnly, linuxOnly, commandNames, categories, appearanceRevision, privateCommands }) => {
                const data = { description: description || undefined, keywords: keywords || undefined,
                    desktopOnly: desktopOnly || undefined, mobileOnly: mobileOnly || undefined, linuxOnly: linuxOnly || undefined, commands: commandNames.length ? commandNames : undefined,
                    categories, appearanceRevision, privateCommands: privateCommands || undefined };
                const fields = Object.entries(data).filter(([, value]) => value !== undefined)
                    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
                return `        { name: ${JSON.stringify(name)}, source: ${[binding, ...fields].join(", ")} },`;
            }),
            "    ],",
        ]),
        "};",
        "",
    ].join("\n");
    return { source, desktopEntries: groups.plugins, plugins: groups.plugins.length, desktopPlugins, nonLinuxDesktopPlugins, mobilePlugins, themes: groups.themes.length, names, commands, pluginFiles, pluginBodies };
}

async function desktopReleaseCounts(source) {
    const { globPlugins } = await import("./build/common.mjs");
    const counts = {};
    const originalDirectory = process.cwd();
    try {
        process.chdir(path.join(root, "desktop/client"));
        for (const [label, kind] of [["desktop", "discordDesktop"], ["browser", "web"]]) {
            const names = new Set();
            const add = name => names.add(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
            for (const entry of source) {
                if (!entry.mobileOnly && !entry.linuxOnly) add(entry.name);
            }
            let load;
            globPlugins(kind, add).setup({
                onResolve() {},
                onLoad(_options, handler) { load = handler; },
            });
            await load();
            counts[label] = names.size;
        }
    } finally {
        process.chdir(originalDirectory);
    }
    return counts;
}

async function main() {
    const catalog = buildCatalog();
    const { source, desktopPlugins, nonLinuxDesktopPlugins, mobilePlugins, themes } = catalog;
    const mode = process.argv[2];
    if (mode === "--release") {
        const counts = await desktopReleaseCounts(catalog.desktopEntries);
        console.log(`Combined plugins: ${counts.desktop} desktop, ${counts.browser} browser`);
        if (Math.min(counts.desktop, counts.browser) < desktopPluginTarget || themes !== 100) {
            throw new Error(`Release requires ${desktopPluginTarget} distinct plugins per desktop build and 100 themes.`);
        }
        if (mobilePlugins < mobilePluginTarget) {
            throw new Error(`Complete mobile CX release requires at least ${mobilePluginTarget} plugins. Found ${mobilePlugins}.`);
        }
    }
    if (mode === "--check" || mode === "--release") {
        if (fs.readFileSync(catalogPath, "utf8").replaceAll("\r\n", "\n") !== source) {
            throw new Error("Generated CX catalog is stale. Run node scripts/sync-cx-catalog.cjs.");
        }
    } else if (!mode) fs.writeFileSync(catalogPath, source);
    else throw new Error("Use --check, --release, or no flag to regenerate");
    console.log(`CX catalog has ${desktopPlugins} desktop plugins (${nonLinuxDesktopPlugins} outside Linux), ${mobilePlugins}/${mobilePluginTarget} mobile plugins and ${themes}/100 themes`);
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { buildCatalog, catalogPath, desktopPluginTarget, loadCxParser, loadCxRuntime, pluginBody, pluginPlatforms };
