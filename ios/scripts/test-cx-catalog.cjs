// Runs the production CX settings adapters against fixtures and checks the
// separate candidate packs without executing their JavaScript.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const queues = require("../../desktop/client/src/utils/cxTesting/cx-testing-queues.json");

const root = path.resolve(__dirname, "../..");
const sourceFiles = {
    "Desktop CX pack": "examples/cx/catalog-gpl/dist/cloudcord-gpl-pack.json",
    "Shared declarative CX": "ios/dist/cloudcord-mobile-cx.json",
    "Discover CX preview": "ios/dist/discover-cx/mobile-conversion-preview.json",
};
const platforms = ["desktop", "mobile"];
const formatError = error => String(error.message ?? error);
const hash = source => createHash("sha256").update(source.replace(/\r\n/g, "\n").trim()).digest("hex");
const result = (status, reason = "") => ({ status, reason });
const blocked = reason => result("Blocked", reason);

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
    return row ? result(row.status, row.errors.join("; ")) : blocked(reason);
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
    const header = ["Plugin ID", "Plugin", "Source group", "Tested implementation", "Syntax", "Syntax detail", "Desktop adapter", "Desktop detail", "Mobile adapter", "Mobile detail"];
    if (report.desktopModuleLoad) header.push("Desktop module load", "Module load error", "Module load warnings");
    const rows = [...report.candidates, ...report.additionalSharedPlugins].map(entry => [
        entry.id, entry.name, entry.group, entry.implementation, entry.syntax.status, entry.syntax.reason,
        entry.desktop.status, entry.desktop.reason, entry.mobile.status, entry.mobile.reason,
        ...(report.desktopModuleLoad ? [entry.moduleLoad?.status, entry.moduleLoad?.error, entry.moduleLoad?.warnings.join("; ")] : []),
    ]);
    fs.writeFileSync(output.replace(/\.json$/i, ".csv"), [header, ...rows].map(row => row.map(csvField).join(",")).join("\r\n") + "\r\n");
}

async function main(args) {
    let sourceRoot = root;
    let output = path.join(root, "ios/dist/cx-test-results.json");
    let desktopLoadFile;
    for (let i = 0; i < args.length; i += 2) {
        const flag = args[i], value = args[i + 1];
        if (!value || value.startsWith("--") || !["--sources", "--output", "--desktop-load"].includes(flag)) {
            throw new Error("Usage: node ios/scripts/test-cx-catalog.cjs [--sources <candidate checkout>] [--desktop-load <isolated load report.json>] [--output <report.json>]");
        }
        if (flag === "--sources") sourceRoot = path.resolve(value);
        else if (flag === "--output") output = path.resolve(value);
        else desktopLoadFile = path.resolve(value);
    }
    if (!/\.json$/i.test(output)) throw new Error("The report filename must end in .json");

    const packs = Object.fromEntries(Object.keys(sourceFiles).map(group => [group, readPack(sourceRoot, group)]));
    const packParser = path.join(sourceRoot, "core/src/cx/parse.js");
    const parse = fs.existsSync(packParser) ? (await import(pathToFileURL(packParser).href)).parse : undefined;
    const { rows, ...adapterSuite } = runAdapterTests();
    const adapters = new Map(rows.map(row => [row.platform + ":" + row.sourceHash, row]));
    const styles = new Map(rows.filter(row => row.appearanceCss).map(row => [row.platform + ":" + row.appearanceCss.trim(), row]));
    const matched = new Set();
    const candidates = queues.flat().map(([id, name, group, portableFile]) => {
        const pack = packs[group];
        const entry = pack.entries?.get(id);
        if (portableFile && /^[a-z0-9-]+\.cx$/.test(portableFile)) {
            const file = path.join(root, "examples/cx/catalog/plugins", portableFile);
            const sourceHash = fs.existsSync(file) && hash(fs.readFileSync(file, "utf8"));
            const found = platforms.map(platform => adapters.get(platform + ":" + sourceHash));
            if (found.some(Boolean)) {
                matched.add(sourceHash);
                return { id, name, group, implementation: "Declared shared port: " + portableFile,
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
                    syntax: checkCandidate(id, entry, pack, parse),
                    desktop: adapterResult(found[0]), mobile: adapterResult(found[1]) };
            }
        }
        const desktop = group === "Discover CX preview" ? "The preview needs a Vendetta-compatible host"
            : "The desktop pack needs a separate Discord integration test";
        const mobile = group === "Discover CX preview" ? "The preview needs a mobile Vendetta adapter"
            : "The desktop pack needs a native mobile port";
        return { id, name, group, syntax: checkCandidate(id, entry, pack, parse), desktop: blocked(desktop), mobile: blocked(mobile) };
    });

    let desktopModuleLoad;
    if (desktopLoadFile) {
        const evidence = JSON.parse(fs.readFileSync(desktopLoadFile, "utf8"));
        const desktopPack = packs["Desktop CX pack"];
        if (typeof evidence.packSha256 !== "string" || evidence.packSha256 !== desktopPack.sha256) {
            throw new Error("The module load report was produced from a different desktop pack");
        }
        const loaded = new Map();
        for (const row of evidence.rows) {
            if (!desktopPack.entries.has(row?.id) || loaded.has(row.id) || typeof row.loaded !== "boolean") {
                throw new Error("Unexpected or duplicate module load result");
            }
            loaded.set(row.id, row);
        }
        const counts = { Pass: 0, Fail: 0, Blocked: 0 };
        for (const entry of candidates.filter(candidate => candidate.group === "Desktop CX pack")) {
            const row = loaded.get(entry.id);
            const status = row ? row.loaded ? "Pass" : "Fail" : "Blocked";
            counts[status]++;
            entry.moduleLoad = { status, error: row?.error ?? (row ? "" : "Missing module load result"), warnings: row?.warnings ?? [] };
        }
        desktopModuleLoad = { scope: "Isolated desktop module loading without startup hooks or Discord patches", counts };
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
    const totals = Object.fromEntries(["syntax", ...platforms].map(check => {
        const counts = { Pass: 0, Fail: 0, Blocked: 0 };
        for (const entry of candidates) counts[entry[check].status]++;
        return [check, counts];
    }));
    const report = {
        scope: "Syntax and fixture-based adapter activation and cleanup. Device behavior requires separate results.",
        candidateCount: candidates.length, totals, adapterSuite, desktopModuleLoad,
        candidates, additionalSharedPlugins: [...additional.values()],
    };
    writeReport(output, report);
    console.log(JSON.stringify({ candidateCount: candidates.length, totals, desktopModuleLoad, additionalSharedPlugins: additional.size, report: output }, null, 2));
    if (adapterSuite.status === "Fail" || Object.values(totals).some(counts => counts.Fail) || desktopModuleLoad?.counts.Fail) process.exitCode = 1;
}

main(process.argv.slice(2)).catch(error => { console.error(formatError(error)); process.exitCode = 1; });
