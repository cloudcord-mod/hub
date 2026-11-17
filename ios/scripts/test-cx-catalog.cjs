// Runs the production CX settings adapters and optional isolated pack checks.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const { execFile, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const queues = require("../../desktop/client/src/utils/cxTesting/cx-testing-queues.json");

const root = path.resolve(__dirname, "../..");
const sourceFiles = {
    "Desktop CX pack": "examples/cx/catalog-gpl/dist/cloudcord-gpl-pack.json",
    "Shared declarative CX": "ios/dist/cloudcord-mobile-cx.json",
    "Discover CX preview": "ios/dist/discover-cx/mobile-conversion-preview.json",
};
const platforms = ["desktop", "mobile"];
const reviewedConvertedPorts = new Map([
    ["gpl/decode-base64", {
        file: "decode-base64.cx",
        scriptSha256: "5d7ad58849f433f36086043bbbeaf88fa934c6f301837dae945fb888c58606b8",
    }],
    ["discover-52", {
        file: "hide-blocked-and-ignored-messages.cx",
        scriptSha256: "342a4b875291785ae731695f0fbd9f6596d3a3a12cfd57fc74a8182520099fff",
    }],
    // This preview's source was reviewed for the same pin confirmation behavior.
    ["discover-79", {
        file: "bypass-pin-prompt.cx",
        scriptSha256: "03957dc90487598cc40e3252005b9f9a797b595514433c44cc7c4a09bf00278a",
    }],
]);
const formatError = error => String(error.message ?? error);
const hash = source => createHash("sha256").update(source.replace(/\r\n/g, "\n").trim()).digest("hex");
const result = (status, reason = "") => ({ status, reason });
const blocked = reason => result("Blocked", reason);

function checkoutVersion(folder) {
    const commit = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: folder, encoding: "utf8" });
    const changes = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: folder, encoding: "utf8" });
    return {
        commit: commit.status === 0 ? commit.stdout.trim() : null,
        modified: changes.status === 0 ? changes.stdout.trim().length > 0 : null,
    };
}

function readPack(sourceRoot, group) {
    const file = path.join(sourceRoot, sourceFiles[group]);
    try {
        const source = fs.readFileSync(file, "utf8");
        const { entries, scripts, styles, patches } = JSON.parse(source);
        if (!Array.isArray(entries)) throw new Error("Missing entries array");
        const byId = new Map();
        for (const entry of entries) {
            if (typeof entry?.id !== "string" || typeof entry.source !== "string" || byId.has(entry.id)) {
                throw new Error("Invalid or duplicate plugin source");
            }
            byId.set(entry.id, entry);
        }
        return { entries: byId, scripts, styles, patches, sha256: createHash("sha256").update(source).digest("hex") };
    } catch (error) {
        return { error: error.code === "ENOENT" ? "Source file missing: " + sourceFiles[group] : formatError(error) };
    }
}

function runAdapterTests() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cloudcord-cx-tests-"));
    const output = path.join(temp, "results.json");
    try {
        const deps = [process.env.NODE_PATH, path.join(root, "desktop/client/node_modules"), path.join(root, "ios/runtime/node_modules")];
        const run = spawnSync(process.execPath, [path.join(__dirname, "test-cx.cjs"), "--catalog-results", output], {
            cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 2 ** 22,
            env: { ...process.env, NODE_PATH: deps.filter(Boolean).join(path.delimiter) },
        });
        const rows = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : [];
        return {
            rows, status: run.status === 0 ? "Pass" : "Fail",
            output: [run.stdout?.trim(), run.stderr?.trim(), run.error?.message].filter(Boolean).join("\n"),
        };
    } finally {
        if (fs.existsSync(output)) fs.unlinkSync(output);
        fs.rmdirSync(temp);
    }
}

async function runPackTest(script, sourceRoot, enginePath) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cloudcord-cx-pack-"));
    const file = path.join(temp, "result.json");
    try {
        await new Promise((resolve, reject) => {
            execFile(process.execPath, [path.join(__dirname, script), sourceRoot, enginePath, file], { timeout: 120_000 }, (error, _stdout, stderr) => {
                // Exit 1 can be a valid report containing failing plugins.
                if (error && (error.code !== 1 || !fs.existsSync(file))) reject(new Error(script + ": " + (stderr.trim() || error.message)));
                else resolve();
            });
        });
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } finally {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.rmdirSync(temp);
    }
}

function matchEvidence(evidence, pack, label) {
    if (typeof evidence.packSha256 !== "string" || evidence.packSha256 !== pack.sha256) {
        throw new Error("The " + label + " report was produced from a different candidate pack");
    }
    const rows = new Map();
    for (const row of evidence.rows) {
        if (!pack.entries.has(row?.id) || rows.has(row.id)) throw new Error("Unexpected or duplicate " + label + " result");
        rows.set(row.id, row);
    }
    return rows;
}

function checkCandidate(id, entry, pack, parse) {
    if (!entry) return blocked(pack.error ?? "Plugin source missing from pack");
    if (!parse) return blocked("Pack parser is missing from the source checkout");
    try {
        const program = parse(entry.source);
        if (program.errors.length) throw new Error(program.errors.map(error => error.message).join("; "));
        const scriptId = id.replace(/^gpl\//, "");
        const script = pack.scripts?.[scriptId];
        if (entry.script || id.startsWith("discover-")) {
            if (typeof script !== "string" || !script.trim()) throw new Error("Referenced script missing: " + scriptId);
            new vm.Script("(function(require,module,exports,cloudcord){\n" + script + "\n})", { filename: id + ".js" });
        }
        return result("Pass");
    } catch (error) {
        return result("Fail", formatError(error));
    }
}

function adapterResult(row, reason = "Adapter test did not produce a result") {
    return row ? { ...result(row.status, row.errors.join("; ")), settingsSwitches: row.settingsSwitches,
        testedSwitches: row.testedSwitches, commandInputs: row.commandInputs } : blocked(reason);
}

function equivalentPluginKey(source, parseCx) {
    const plugin = parseCx(source);
    if (plugin.kind !== "plugin") return;
    const commands = plugin.commands.map(command => {
        const legacy = command.text && !command.inputs.length;
        const explicit = !command.text && command.inputs.length === 1 && command.inputs[0].name === "message"
            && command.inputs[0].type === "text" && command.inputs[0].required;
        if (!legacy && !explicit) return command;
        const input = legacy ? "text" : "message";
        const slot = new RegExp("\\$\\{(" + input + "|[a-zA-Z]+\\(" + input + "\\))\\}", "g");
        const rename = text => text.replace(slot, (_match, value) => "${" + value.replace(new RegExp("\\b" + input + "(?=\\)?$)"), "message") + "}");
        // Only normalize literal and simple single-input send templates. The
        // rest of the AST, including settings and permissions, must match.
        if (!command.actions.every(action => action.kind === "send" && !action.choices && action.fallback === undefined
            && !action.message.replace(slot, "").includes("${"))) return command;
        return {
            ...command, text: false, inputs: [{ name: "message", type: "text", required: true }],
            actions: command.actions.map(action => ({ ...action, message: rename(action.message) })),
        };
    });
    return JSON.stringify({ ...plugin, commands, optionalHides: [...plugin.optionalHides] });
}

function originalDesktopPortResolver(sourceRoot, pack, rows) {
    if (!pack.entries) return () => undefined;
    const { inspectPlugin } = require("../../desktop/client/scripts/cx-bulk-plugins.cjs");
    const { parseCx, cxAppearanceTargets, cxNativeEffects } = require("../../desktop/client/scripts/sync-cx-catalog.cjs").loadCxRuntime();
    const testedHashes = new Set(rows.map(row => row.sourceHash));
    const testedPrograms = new Map();
    const folder = path.join(root, "examples/cx/catalog/plugins");
    for (const filename of fs.readdirSync(folder).filter(name => name.endsWith(".cx"))) {
        const source = fs.readFileSync(path.join(folder, filename), "utf8");
        const sourceHash = hash(source);
        if (testedHashes.has(sourceHash)) testedPrograms.set(equivalentPluginKey(source, parseCx), sourceHash);
    }

    return (entry, name) => {
        const original = entry?.source.match(/^\/\/ Converted from .+ \(desktop\/client\/src\/([\w-]+\/[\w-]+(?:\.[\w-]+)*)\)\. GPL-3\.0-or-later\.$/m)?.[1];
        if (!original) return;
        const directory = "desktop/client/src/" + original;
        const sourceLocation = path.join(sourceRoot, directory);
        const rootEntry = fs.lstatSync(sourceLocation, { throwIfNoEntry: false });
        const sourceFile = rootEntry?.isDirectory()
            ? ["/index.tsx", "/index.ts"].map(ext => directory + ext).find(file => fs.lstatSync(path.join(sourceRoot, file), { throwIfNoEntry: false })?.isFile())
            : rootEntry?.isFile() && /\.tsx?$/.test(directory) ? directory : undefined;
        if (!sourceFile) return;
        const filename = path.join(sourceRoot, sourceFile);
        const converted = inspectPlugin(sourceFile, fs.readFileSync(filename, "utf8"), "desktop", cxAppearanceTargets, cxNativeEffects, companion => {
            if (!/^(?:\.\/)?[\w.-]+\.(?:css|tsx?)$/.test(companion)) return;
            const location = path.join(path.dirname(filename), companion);
            if (fs.lstatSync(location, { throwIfNoEntry: false })?.isFile()) return fs.readFileSync(location, "utf8");
        });
        if (converted?.name !== name || !converted.cx) return;
        const convertedHash = hash(converted.cx);
        const sourceHash = testedHashes.has(convertedHash) ? convertedHash : testedPrograms.get(equivalentPluginKey(converted.cx, parseCx));
        if (sourceHash) return { sourceFile, sourceHash };
    };
}

function stylesheetForPackEntry(entry, pack, name) {
    if (!entry) return;
    const slug = entry.id.slice(4);
    const css = pack.styles?.[slug];
    if (typeof css !== "string" || !css.trim() || pack.patches?.[slug]?.length) return;
    const body = entry.source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("//")).slice(1);
    const expectedBody = ["needs appearance.style", "style " + slug];
    if (entry.script) {
        expectedBody.push("needs scripts.run", "use " + slug);
        // The converter adds this stub when the original plugin has no patches.
        const emptyPatchScript = `module.exports = {
    name: ${JSON.stringify(name)},
    patches: [].map(patch => ({
        find: typeof patch.find === "string" ? patch.find : new RegExp(patch.find.regex, patch.find.flags),
        all: patch.all,
        replacement: patch.replacements.map(r => ({ match: new RegExp(r.match, r.flags), replace: r.replace })),
    })),
};`;
        if (!entry.declarativeScript || pack.scripts?.[slug]?.replace(/\r\n/g, "\n").trim() !== emptyPatchScript) return;
    }
    if (body.join("\n") === expectedBody.join("\n")) return css.trim();
}

function csvField(value) {
    const text = String(value ?? "");
    const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
}

function writeReport(output, report) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    const header = ["Plugin ID", "Plugin", "Source group", "Tested implementation", "Syntax", "Syntax detail", "Runtime parser", "Runtime parser detail", "Desktop adapter", "Desktop detail", "Mobile adapter", "Mobile detail",
        "Desktop settings switches", "Mobile settings switches", "Command inputs", "Checked at", "Adapter source commit", "Adapter source modified", "Candidate pack SHA-256"];
    if (report.desktopModuleLoad) header.push("Desktop module load", "Module load error", "Module load warnings", "Desktop pack declared settings");
    if (report.desktopLifecycle) header.push("Desktop lifecycle (fixture)", "Desktop lifecycle detail", "Missed fixture lookups (Windows/Android export names)");
    if (report.discoverFactory) header.push("Discover fixture load", "Discover fixture error", "Android lookup signatures observed", "Discover declares settings");
    if (report.discoverLifecycle) header.push("Discover lifecycle (fixture)", "Discover lifecycle detail");
    const rows = [...report.candidates, ...report.additionalSharedPlugins].map(entry => [
        entry.id, entry.name, entry.group, entry.implementation, entry.syntax.status, entry.syntax.reason,
        entry.parser?.status, entry.parser?.reason,
        entry.desktop.status, entry.desktop.reason, entry.mobile.status, entry.mobile.reason,
        entry.desktop.settingsSwitches?.join("; "), entry.mobile.settingsSwitches?.join("; "),
        (entry.desktop.commandInputs ?? entry.mobile.commandInputs)?.join("; "),
        report.checkedAt, report.sources.adapters.commit, report.sources.adapters.modified,
        report.sources.packs[entry.group],
        ...(report.desktopModuleLoad ? [entry.moduleLoad?.status, entry.moduleLoad?.error, entry.moduleLoad?.warnings.join("; "), entry.moduleLoad?.settingsFields?.join("; ")] : []),
        ...(report.desktopLifecycle ? [entry.desktopLifecycle?.status, entry.desktopLifecycle?.reason,
            entry.moduleLoad?.missingLookups?.map(({ phase, keys, observedInWindowsSnapshot, observedInAndroidSnapshot }) =>
                phase + ": " + keys.join(" + ") + " [" + [observedInWindowsSnapshot, observedInAndroidSnapshot].map(observed =>
                    observed == null ? "unknown" : observed ? "yes" : "no").join("/") + "]").join("; "),
        ] : []),
        ...(report.discoverFactory ? [entry.discoverFactory?.status, entry.discoverFactory?.error, entry.discoverFactory?.androidMatches, entry.discoverFactory?.settingsDeclared] : []),
        ...(report.discoverLifecycle ? [entry.discoverLifecycle?.status, entry.discoverLifecycle?.reason] : []),
    ]);
    fs.writeFileSync(output.replace(/\.json$/i, ".csv"), [header, ...rows].map(row => row.map(csvField).join(",")).join("\r\n") + "\r\n");
}

function groupBatchErrors(candidates) {
    const groups = new Map();
    for (const entry of candidates) {
        for (const check of ["syntax", "parser", "desktop", "mobile", "moduleLoad", "desktopLifecycle", "discoverFactory", "discoverLifecycle"]) {
            const outcome = entry[check];
            if (outcome?.status !== "Fail") continue;
            const issues = outcome.issues ?? [outcome.error ?? outcome.reason ?? "Unknown error"];
            for (const message of new Set(issues)) {
                const key = JSON.stringify([check, message]);
                const group = groups.get(key) ?? { check, message, plugins: [] };
                group.plugins.push(entry.id);
                groups.set(key, group);
            }
        }
    }
    return [...groups.values()].map(group => ({ ...group, count: group.plugins.length }))
        .sort((a, b) => b.count - a.count || a.check.localeCompare(b.check) || a.message.localeCompare(b.message));
}

async function main(args) {
    let sourceRoot = root;
    let output = path.join(root, "ios/dist/cx-test-results.json");
    let desktopLoadFile, discoverLoadFile, enginePath, testingLinks;
    for (let i = 0; i < args.length; i += 2) {
        const flag = args[i], value = args[i + 1];
        if (!value || value.startsWith("--") || !["--sources", "--output", "--desktop-load", "--discover-load", "--engine", "--testing-links"].includes(flag)) {
            throw new Error("Usage: test-cx-catalog.cjs [--sources <candidate checkout>] [--engine <QuickJS package path>] [--desktop-load <report.json>] [--discover-load <report.json>] [--output <report.json>] [--testing-links <catalog links.json>]");
        }
        if (flag === "--sources") sourceRoot = path.resolve(value);
        else if (flag === "--output") output = path.resolve(value);
        else if (flag === "--desktop-load") desktopLoadFile = path.resolve(value);
        else if (flag === "--discover-load") discoverLoadFile = path.resolve(value);
        else if (flag === "--testing-links") testingLinks = path.resolve(value);
        else enginePath = path.resolve(value);
    }
    if (!/\.json$/i.test(output)) throw new Error("The report filename must end in .json");
    if (testingLinks && (!/\.json$/i.test(testingLinks) || testingLinks === output)) throw new Error("Testing links require a separate JSON file");

    const packs = Object.fromEntries(Object.keys(sourceFiles).map(group => [group, readPack(sourceRoot, group)]));
    const packParser = path.join(sourceRoot, "core/src/cx/parse.js");
    const parse = fs.existsSync(packParser) ? (await import(pathToFileURL(packParser).href)).parse : undefined;
    const packTests = Promise.all([
        desktopLoadFile ? JSON.parse(fs.readFileSync(desktopLoadFile, "utf8"))
            : enginePath && runPackTest("test-cx-desktop-pack.cjs", sourceRoot, enginePath),
        discoverLoadFile ? JSON.parse(fs.readFileSync(discoverLoadFile, "utf8"))
            : enginePath && runPackTest("test-cx-discover-pack.cjs", sourceRoot, enginePath),
    ]);
    const { rows, ...adapterSuite } = runAdapterTests();
    const [desktopEvidence, discoverEvidence] = await packTests;
    const adapters = new Map(rows.map(row => [row.platform + ":" + row.sourceHash, row]));
    const styles = new Map(rows.filter(row => row.appearanceCss).map(row => [row.platform + ":" + row.appearanceCss.trim(), row]));
    const originalDesktopPort = originalDesktopPortResolver(sourceRoot, packs["Desktop CX pack"], rows);
    const parseRuntime = require("../../desktop/client/scripts/sync-cx-catalog.cjs").loadCxRuntime().parseCx;
    const matched = new Set();
    const candidates = queues.flat().map(([id, name, group, portableFile]) => {
        const pack = packs[group];
        const entry = pack.entries?.get(id);
        const review = reviewedConvertedPorts.get(id);
        const script = pack.scripts?.[id.replace(/^gpl\//, "")];
        const reviewed = review && typeof script === "string" && createHash("sha256").update(script).digest("hex") === review.scriptSha256;
        if (reviewed) portableFile = review.file;
        if (portableFile && /^[a-z0-9-]+\.cx$/.test(portableFile)) {
            const file = path.join(root, "examples/cx/catalog/plugins", portableFile);
            const sourceHash = fs.existsSync(file) && hash(fs.readFileSync(file, "utf8"));
            const found = platforms.map(platform => adapters.get(platform + ":" + sourceHash));
            if (found.some(Boolean)) {
                matched.add(sourceHash);
                return { id, name, group, implementation: (reviewed ? "Reviewed converted port: " : "Declared shared port: ") + portableFile,
                    catalogName: (found[0] ?? found[1]).name,
                    syntax: checkCandidate(id, entry, pack, parse), desktop: adapterResult(found[0]), mobile: adapterResult(found[1]) };
            }
        }
        if (group === "Shared declarative CX") {
            const sourceHash = entry && hash(entry.source);
            const found = platforms.map(platform => adapters.get(platform + ":" + sourceHash));
            if (found.some(Boolean)) matched.add(sourceHash);
            const reason = !entry ? pack.error ?? "Plugin source missing from pack"
                : "No adapter result matches this exact CX source";
            return { id, name, group, implementation: found.some(Boolean) ? "Exact shared CX source" : undefined,
                catalogName: (found[0] ?? found[1])?.name,
                syntax: found.some(Boolean) ? result("Pass") : checkCandidate(id, entry, pack, parse),
                desktop: adapterResult(found[0], reason), mobile: adapterResult(found[1], reason) };
        }
        if (group === "Desktop CX pack") {
            const css = stylesheetForPackEntry(entry, pack, name);
            const found = css && platforms.map(platform => styles.get(platform + ":" + css));
            const shared = found && (found[0] ?? found[1]);
            if (shared) {
                matched.add(shared.sourceHash);
                return { id, name, group, implementation: "Shared style port: " + shared.name,
                    catalogName: shared.name,
                    syntax: checkCandidate(id, entry, pack, parse),
                    desktop: adapterResult(found[0]), mobile: adapterResult(found[1]) };
            }
            const original = originalDesktopPort(entry, name);
            const matches = original && platforms.map(platform => adapters.get(platform + ":" + original.sourceHash));
            const port = matches && (matches[0] ?? matches[1]);
            if (port) {
                matched.add(original.sourceHash);
                return { id, name, group, implementation: "Converter-backed shared port: " + port.name, implementationSource: original.sourceFile,
                    catalogName: port.name,
                    syntax: checkCandidate(id, entry, pack, parse), desktop: adapterResult(matches[0]), mobile: adapterResult(matches[1]) };
            }
        }
        const desktop = group === "Discover CX preview" ? "The preview needs a Vendetta-compatible host"
            : "The desktop pack needs a separate Discord integration test";
        const mobile = group === "Discover CX preview" ? "The preview needs a mobile Vendetta adapter"
            : "The desktop pack needs a native mobile port";
        return { id, name, group, syntax: checkCandidate(id, entry, pack, parse), desktop: blocked(desktop), mobile: blocked(mobile) };
    });

    for (const candidate of candidates) {
        const source = packs[candidate.group].entries?.get(candidate.id)?.source;
        if (!source) {
            candidate.parser = blocked("Converted source is missing");
            continue;
        }
        try {
            parseRuntime(source);
            candidate.parser = result("Pass");
        } catch (error) {
            candidate.parser = result("Fail", formatError(error));
        }
    }

    let desktopModuleLoad, desktopLifecycle;
    if (desktopEvidence) {
        const loaded = matchEvidence(desktopEvidence, packs["Desktop CX pack"], "desktop module load");
        const counts = { Pass: 0, Fail: 0, Blocked: 0 };
        const lifecycleCounts = desktopEvidence.summary?.lifecycle && { Pass: 0, Fail: 0, Blocked: 0 };
        for (const entry of candidates.filter(candidate => candidate.group === "Desktop CX pack")) {
            const row = loaded.get(entry.id);
            if (row && typeof row.loaded !== "boolean") throw new Error("Invalid desktop module status: " + entry.id);
            const status = row ? row.loaded ? "Pass" : "Fail" : "Blocked";
            counts[status]++;
            entry.moduleLoad = { status, error: row?.error ?? (row ? "" : "Missing module load result"), warnings: row?.warnings ?? [],
                settingsFields: row?.settingsFields, missingLookups: row?.missingLookups, lookupError: row?.lookupError };
            if (lifecycleCounts) {
                const lifecycle = row?.lifecycle;
                const lifecycleStatus = lifecycle?.status ?? "Blocked";
                if (!Object.hasOwn(lifecycleCounts, lifecycleStatus)) throw new Error("Invalid desktop lifecycle status: " + entry.id);
                lifecycleCounts[lifecycleStatus]++;
                const details = lifecycle ? [
                    ...lifecycle.errors,
                    lifecycle.started && "Still marked started after cleanup",
                    lifecycle.unsettledResources && lifecycle.unsettledResources + " intervals or subscriptions retained",
                    ...Object.entries(lifecycle.retained ?? {}).filter(([, count]) => count).map(([kind, count]) => count + " " + kind + " retained"),
                    lifecycle.unfinished && lifecycle.unfinished + " pending lifecycle promises",
                ].filter(Boolean) : [row?.error || "No lifecycle result"];
                entry.desktopLifecycle = { ...result(lifecycleStatus, details.join("; ")), issues: details, traces: lifecycle?.traces };
            }
        }
        desktopModuleLoad = { scope: "Isolated desktop module loading without startup hooks or Discord patches", counts };
        if (lifecycleCounts) desktopLifecycle = {
            scope: "Isolated desktop startup and cleanup with inert Discord APIs and timer callbacks",
            counts: lifecycleCounts,
        };
    }

    let discoverFactory, discoverLifecycle;
    if (discoverEvidence) {
        const loaded = matchEvidence(discoverEvidence, packs["Discover CX preview"], "Discover factory load");
        const counts = { Pass: 0, Fail: 0, Blocked: 0 };
        const lifecycleCounts = discoverEvidence.summary.lifecycle && { Pass: 0, Fail: 0, Blocked: 0 };
        for (const entry of candidates.filter(candidate => candidate.group === "Discover CX preview")) {
            const row = loaded.get(entry.id);
            if (row && row.status !== "Pass" && row.status !== "Fail") throw new Error("Invalid Discover factory status: " + entry.id);
            const status = row?.status ?? "Blocked";
            counts[status]++;
            const requests = row?.requests ?? [];
            const androidMatches = requests.length ? requests.filter(request => request.observedInAndroidSnapshot === true).length + "/" + requests.length : "";
            entry.discoverFactory = { status, error: row?.error ?? "Missing Discover factory result", androidMatches, requests,
                settingsDeclared: row?.settingsDeclared, trace: row?.factoryTrace };
            if (lifecycleCounts) {
                const lifecycle = row?.lifecycle;
                const lifecycleStatus = lifecycle?.status ?? "Blocked";
                if (!Object.hasOwn(lifecycleCounts, lifecycleStatus)) throw new Error("Invalid Discover lifecycle status: " + entry.id);
                lifecycleCounts[lifecycleStatus]++;
                const errors = lifecycle ? [...lifecycle.errors,
                    ...Object.entries(lifecycle.retained ?? {}).filter(([, count]) => count)
                        .map(([kind, count]) => count + " " + kind + " retained"),
                    lifecycle.pending && lifecycle.pending + " pending lifecycle promises",
                ].filter(Boolean) : [row?.error || "No lifecycle result"];
                entry.discoverLifecycle = { ...result(lifecycleStatus, errors.join("; ")), issues: errors, traces: lifecycle?.traces };
            }
        }
        discoverFactory = { scope: "Isolated Discover factories with inert Vendetta fixtures", counts,
            distinctFindByProps: discoverEvidence.summary.distinctFindByProps,
            observedAndroidSignatures: discoverEvidence.summary.observedAndroidSignatures };
        if (lifecycleCounts) discoverLifecycle = { scope: "Discover startup and cleanup with inert Vendetta APIs", counts: lifecycleCounts };
    }

    const additional = new Map();
    for (const row of rows) {
        if (matched.has(row.sourceHash)) continue;
        const entry = additional.get(row.sourceHash) ?? {
            id: "shared/" + row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            name: row.name, group: "Bundled shared catalog", implementation: "Bundled CX source", syntax: result("Pass"),
            desktop: blocked("No desktop adapter result"), mobile: blocked("No mobile adapter result"),
        };
        entry[row.platform] = adapterResult(row);
        additional.set(row.sourceHash, entry);
    }
    const totals = Object.fromEntries(["syntax", "parser", ...platforms].map(check => {
        const counts = { Pass: 0, Fail: 0, Blocked: 0 };
        for (const entry of candidates) counts[entry[check].status]++;
        return [check, counts];
    }));
    const report = {
        scope: "Syntax and fixture-based adapter activation and cleanup. Device behavior requires separate results.",
        checkedAt: new Date().toISOString(),
        sources: {
            adapters: checkoutVersion(root),
            candidates: checkoutVersion(sourceRoot),
            packs: Object.fromEntries(Object.entries(packs).map(([group, pack]) => [group, pack.sha256 ?? null])),
        },
        candidateCount: candidates.length, totals, adapterSuite, desktopModuleLoad, desktopLifecycle, discoverFactory, discoverLifecycle,
        errorGroups: groupBatchErrors([...candidates, ...additional.values()]),
        candidates, additionalSharedPlugins: [...additional.values()],
        configuration: {
            shared: Object.fromEntries(platforms.map(platform => {
                const platformRows = rows.filter(row => row.platform === platform);
                return [platform, { pluginsWithSwitches: platformRows.filter(row => row.settingsSwitches?.length).length,
                    testedSwitches: platformRows.reduce((total, row) => total + (row.testedSwitches ?? 0), 0),
                    pluginsWithCommandInputs: platformRows.filter(row => row.commandInputs?.length).length }];
            })),
            desktopPackEntriesDeclaringSettings: desktopEvidence?.rows.filter(row => row.settingsFields?.length).length,
            discoverPreviewsDeclaringSettings: discoverEvidence?.rows.filter(row => row.settingsDeclared === true).length,
        },
    };
    writeReport(output, report);
    if (testingLinks) {
        const bundled = [...additional.values()].map(entry => ({ ...entry, catalogName: entry.name }));
        const linked = [...candidates, ...bundled].filter(entry => entry.catalogName && entry.syntax.status === "Pass"
            && platforms.every(platform => entry[platform].status === "Pass"));
        if (adapterSuite.status !== "Pass" || !linked.length) throw new Error("Run the shared adapter suite successfully before updating tester links");
        const links = Object.fromEntries(linked.sort((a, b) => a.id.localeCompare(b.id)).map(({ id, catalogName }) => [id, catalogName]));
        if (Object.keys(links).length !== linked.length) throw new Error("Duplicate tester plugin IDs");
        fs.writeFileSync(testingLinks, JSON.stringify(links, null, 2) + "\n");
        console.log("Wrote " + linked.length + " tester links.");
    }
    console.log(JSON.stringify({ candidateCount: candidates.length, totals, desktopModuleLoad, desktopLifecycle, discoverFactory, discoverLifecycle,
        frequentErrors: report.errorGroups.slice(0, 8).map(({ check, message, count }) => ({ check, message, count })),
        configuration: report.configuration, additionalSharedPlugins: additional.size, report: output }, null, 2));
    if (adapterSuite.status === "Fail" || Object.values(totals).some(counts => counts.Fail) ||
        desktopModuleLoad?.counts.Fail || desktopLifecycle?.counts.Fail || discoverFactory?.counts.Fail || discoverLifecycle?.counts.Fail) process.exitCode = 1;
}

main(process.argv.slice(2)).catch(error => { console.error(formatError(error)); process.exitCode = 1; });
