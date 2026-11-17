const fs = require("node:fs");

function readExportSnapshot(file) {
    if (!fs.existsSync(file)) return;
    const index = new Map();
    let groups;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const [kind, path] = line.split("\t", 3);
        if (kind === "module") groups = new Map();
        if (kind !== "export" || !groups || !path) continue;
        const separator = path.lastIndexOf(".");
        const parent = separator < 0 ? "" : path.slice(0, separator);
        if (!groups.has(parent)) groups.set(parent, new Set());
        const group = groups.get(parent);
        const key = path.slice(separator + 1);
        group.add(key);
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(group);
    }
    return keys => Array.from(index.get(keys[0]) ?? []).some(group => keys.every(key => group.has(key)));
}

module.exports = { readExportSnapshot };
