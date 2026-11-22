// Adapted from CloudCord's existing GPL-3.0-or-later command plugins.
// GoogleThat by Samwich and KrystalSkull.
const searchEngines = new Map([
    ["Google", "https://www.google.com/search?q="],
    ["Bing", "https://www.bing.com/search?q="],
    ["Yahoo", "https://search.yahoo.com/search?p="],
    ["DuckDuckGo", "https://duckduckgo.com/?q="],
    ["Baidu", "https://www.baidu.com/s?wd="],
    ["Yandex", "https://yandex.com/search/?text="],
    ["Ecosia", "https://www.ecosia.org/search?q="],
    ["Ask", "https://www.ask.com/web?q="],
    ["AOL", "https://search.aol.com/aol/search?q="],
    ["LetMeGoogleThatForYou", "https://letmegooglethat.com/?q="],
]);

export function chooseOne<T>(items: readonly T[]): T | undefined {
    return items[Math.floor(Math.random() * items.length)];
}

const morseCodes = new Map(Object.entries({
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.",
    G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
    M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.",
    S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
    Y: "-.--", Z: "--..", 0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-",
    5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.", " ": "/",
}));
const morseLetters = new Map([...morseCodes].map(([letter, code]) => [code, letter]));
const normalizations = ["NFC", "NFD", "NFKC", "NFKD"];
const ansiForegrounds = ["gray", "red", "green", "yellow", "blue", "pink", "cyan", "white"];
const ansiBackgrounds = ["navy", "orange", "slate", "teal", "gray", "indigo", "silver", "white"];
const codeFence = "```";
const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function randomInteger(low: number, high: number) {
    const range = high - low + 1;
    if (Number.isSafeInteger(range) && range > 0) return low + Math.floor(Math.random() * range);
}

function hexChannels(input: string) {
    let hex = input.trim().replace(/^#/, "");
    if (/^[\da-f]{3}$/i.test(hex)) hex = [...hex].map(digit => digit.repeat(2)).join("");
    if (/^[\da-f]{6}$/i.test(hex)) return hex.match(/../g)!.map(value => Number.parseInt(value, 16));
}

function hexColor(channels: number[]) {
    return "#" + channels.map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("");
}

function mixChannels(from: number[], to: number[], weight: number) {
    return from.map((channel, index) => channel + (to[index] - channel) * weight);
}

function relativeLuminance(channels: number[]) {
    const [red, green, blue] = channels.map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: number, b: number) {
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function utcMidnight(input: string) {
    const date = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const instant = new Date(date + "T00:00:00Z");
    if (Number.isFinite(instant.getTime()) && instant.toISOString().startsWith(date + "T")) return instant.getTime();
}

function integerText(input: string) {
    const text = input.trim();
    if (!/^[+-]?\d+$/.test(text)) return;
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : undefined;
}

const dayMilliseconds = 86_400_000;
const durationUnits = new Map([["d", 86_400], ["h", 3_600], ["m", 60], ["s", 1]]);

function durationSeconds(input: string) {
    const text = input.trim();
    if (!/^(?:\d{1,10}[dhms] *){1,4}$/i.test(text)) return;
    const seen = new Set<string>();
    let seconds = 0;
    for (const [, digits, unit] of text.toLowerCase().matchAll(/(\d+)([dhms])/g)) {
        if (seen.has(unit)) return;
        seen.add(unit);
        seconds += Number(digits) * durationUnits.get(unit)!;
    }
    return seconds;
}

function readableDuration(seconds: number) {
    return [...durationUnits].map(([unit, size]) => {
        const part = Math.floor(seconds / size);
        seconds %= size;
        return part ? part + unit : "";
    }).filter(Boolean).join(" ") || "0s";
}

function isoUnixMilliseconds(input: string) {
    const parsed = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(input.trim());
    if (!parsed) return;
    const [, date, hours, mins, secs, fraction = "", direction, offsetHours = "0", offsetMinutes = "0"] = parsed;
    const midnight = utcMidnight(date);
    if (midnight === undefined || Number(hours) > 23 || Number(mins) > 59 || Number(secs) > 59 || Number(offsetHours) > 23 || Number(offsetMinutes) > 59) return;
    const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * (direction === "-" ? -1 : 1);
    return midnight + ((Number(hours) * 60 + Number(mins) - offset) * 60 + Number(secs)) * 1000 + Number(fraction.padEnd(3, "0"));
}

function jsonTokens(text: string) {
    try { JSON.parse(text); }
    catch { return; }
    return text.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? [];
}

function endOfJsonValue(tokens: string[], start: number) {
    if (tokens[start] !== "{" && tokens[start] !== "[") return start + 1;
    let depth = 1;
    let end = start + 1;
    for (; depth > 0; end++) {
        const token = tokens[end];
        if (token === "{" || token === "[") depth++;
        if (token === "}" || token === "]") depth--;
    }
    return end;
}

function fileSizeUnits(base: number, labels: string[]) {
    return new Map(labels.map((label, exponent) => [label, base ** exponent]));
}

const decimalFileUnits = fileSizeUnits(1000, ["B", "kB", "MB", "GB", "TB", "PB"]);
const binaryFileUnits = fileSizeUnits(1024, ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]);
const displayNumber = (value: number) => String(Number(value.toPrecision(12)));

function fileSizeBytes(text: string) {
    const match = /^(\d+(?:\.\d+)?)\s*(B|kB|KB|MB|GB|TB|PB|KiB|MiB|GiB|TiB|PiB)$/.exec(text.trim());
    if (!match) return;
    const unit = match[2] === "KB" ? "kB" : match[2];
    const bytes = Number(match[1]) * (decimalFileUnits.get(unit) ?? binaryFileUnits.get(unit)!);
    if (Number.isFinite(bytes) && bytes <= Number.MAX_SAFE_INTEGER) return bytes;
}

function planningRows(text: string) {
    return text.split(/\r\n|\r|\n/).map(row => row.trim()).filter(Boolean);
}

function planningBlock(text: string) {
    const result = text.replace(/`(?=``)/g, "`\u200b");
    return result.length <= 3800 ? codeFence + "\n" + result + "\n" + codeFence : "The result is too long for one reply.";
}

function discordId(value: string) {
    return /^[1-9]\d{16,19}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
}

function markdownTable(rows: string[][]) {
    const columns = rows[0]?.length ?? 0;
    if (columns < 2 || columns > 16 || rows.length > 64 || rows.some(row => row.length !== columns)) return;
    const row = (cells: string[]) => "| " + cells.map(cell => cell.trim().replace(/[\\|]/g, "\\$&")
        .replace(/\r\n|\r|\n/g, "<br>").replace(/`(?=``)/g, "`\u200b")).join(" | ") + " |";
    const output = [row(rows[0]), row(Array.from({ length: columns }, () => "---")), ...rows.slice(1).map(row)].join("\n");
    return output.length <= 3900 ? codeFence + "markdown\n" + output + "\n" + codeFence : "The table is too long for one reply.";
}

function csvRows(input: string) {
    const rows: string[][] = [];
    const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n|\r|\n|$)/y;
    let cells: string[] = [];
    while (field.lastIndex <= input.length) {
        const match = field.exec(input);
        if (!match) return [];
        const [, quoted, plain, separator] = match;
        cells.push(quoted === undefined ? plain : quoted.replaceAll('""', '"'));
        if (separator === ",") continue;
        rows.push(cells);
        if (!separator || field.lastIndex === input.length) break;
        cells = [];
    }
    return rows;
}

function parsePublicHttpUrl(text: string) {
    if (!/^https?:\/\//i.test(text) || text.length > 3000 || /[\s\\]/.test(text)) return;
    try {
        const url = new URL(text);
        if (!url.username && !url.password) return url;
    } catch { /* Invalid URL. */ }
}

export const cxCommandFunctions = {
    snowflakeTimestamp(input: string) {
        const text = input.trim();
        if (!/^\d{17,20}$/.test(text)) return;
        const snowflake = BigInt(text);
        if (snowflake > 0xffffffffffffffffn || text[0] === "0") return;
        const timestamp = Math.floor((Number(snowflake >> 22n) + 1_420_070_400_000) / 1000);
        return `Created <t:${timestamp}:F> (<t:${timestamp}:R>).`;
    },
    sortLines: (text: string) => text.split(/\r\n|\r|\n/).sort((a, b) => {
        const left = a.toLowerCase();
        const right = b.toLowerCase();
        return left < right ? -1 : left > right ? 1 : 0;
    }).join("\n"),
    trimLines: (text: string) => text.split(/\r\n|\r|\n/).map(line => line.trim()).join("\n"),
    markdownOutline(text: string) {
        const headings: string[] = [];
        let fence = "";
        for (const line of text.split(/\r\n|\r|\n/)) {
            const marker = /^[ ]{0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
            if (fence) {
                if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = "";
                continue;
            }
            if (marker) {
                fence = marker[1];
                continue;
            }
            const heading = /^[ ]{0,3}(#{1,6})\s+(\S.*)$/.exec(line);
            if (heading) {
                const title = heading[2].replace(/\s+#+\s*$/, "").trimEnd();
                headings.push("  ".repeat(heading[1].length - 1) + "- " + title);
            }
        }
        return headings.length ? planningBlock(headings.join("\n")) : "No Markdown headings found.";
    },
    quoteDraft(text: string) {
        if (!text.trim()) return;
        return planningBlock(text.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).map(line => line ? "> " + line : ">").join("\n"));
    },
    removeBlankLines: (text: string) => text.split(/\r\n|\r|\n/).filter(line => line.trim()).join("\n"),
    reverseLineOrder: (text: string) => text.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).reverse().join("\n"),
    joinLines(text: string, separator: string) {
        if (separator.length > 32) return;
        const output = text.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).join(separator);
        if (output.length <= 4000) return output;
    },
    wrapText(text: string, width: string) {
        const limit = Number(width);
        if (!Number.isInteger(limit) || limit < 8 || limit > 120) return;
        const output = text.split(/\r\n|\r|\n/).map(paragraph => {
            const lines: string[] = [];
            let current = "";
            let length = 0;
            for (const word of paragraph.trim().split(/\s+/)) {
                const size = Array.from(word).length;
                if (length && length + 1 + size > limit) {
                    lines.push(current);
                    current = "";
                    length = 0;
                }
                current += (length ? " " : "") + word;
                length += (length ? 1 : 0) + size;
            }
            lines.push(current);
            return lines.join("\n");
        }).join("\n");
        if (output.length <= 4000) return output;
    },
    linesToCsv: (text: string) => {
        const fields = text.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/);
        return fields.map(field => `"${field.replaceAll('"', '""')}"`).join(",");
    },
    numberLines: (text: string) => {
        const lines = text.split(/\r\n|\r|\n/);
        if (lines.at(-1) === "") lines.pop();
        return lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
    },
    slugifyText: (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, ""),
    unicodeInfo(text: string) {
        const points = Array.from(text, character => "U+" + character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"));
        if (!points.length || points.length > 128) return;
        return `${points.length} Unicode code points · ${text.length} UTF-16 code units\n\`${points.join(" ")}\``;
    },
    encodeUrlComponent(text: string) {
        try {
            const encoded = encodeURIComponent(text);
            return encoded.length <= 3900 ? encoded : "Encoded text is too long for one reply.";
        } catch {
            return "This text contains invalid Unicode.";
        }
    },
    decodeUrlComponent(text: string) {
        try { return decodeURIComponent(text); }
        catch { return "This text contains an invalid URL escape."; }
    },
    escapeMarkdown(text: string) {
        const escaped = text.replace(/[\\`*_{}\[\]()#+\-.!|>~]/g, "\\$&");
        return escaped.length <= 3900 ? escaped : "Escaped text is too long for one reply.";
    },
    checkJson(text: string) {
        try { JSON.parse(text); return "Valid JSON."; }
        catch { return "Invalid JSON."; }
    },
    formatJson(text: string) {
        // Keep the original number tokens, duplicate keys and property order.
        const tokens = jsonTokens(text);
        if (!tokens) return "Invalid JSON.";
        let depth = 0;
        let result = "";
        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index];
            const previous = tokens[index - 1];
            const closes = token === "}" || token === "]";
            if (closes) depth--;
            const empty = closes && (previous === "{" || previous === "[");
            if (!empty && (closes || previous === "{" || previous === "[" || previous === ",")) {
                result += "\n" + "  ".repeat(depth);
            }
            result += token.startsWith('"') ? token.replaceAll("`", "\\u0060") : token;
            if (token === ":") result += " ";
            if (token === "{" || token === "[") depth++;
            if (result.length > 3900) return "Formatted JSON is too long for one reply.";
        }
        return codeFence + "json\n" + result + "\n" + codeFence;
    },
    compactJson(text: string) {
        const tokens = jsonTokens(text);
        if (!tokens) return "Invalid JSON.";
        const result = tokens.join("").replaceAll("`", "\\u0060");
        return result.length <= 3900 ? codeFence + "json\n" + result + "\n" + codeFence : "Compacted JSON is too long for one reply.";
    },
    jsonKeys(text: string) {
        try {
            const value = JSON.parse(text);
            if (!value || Array.isArray(value) || typeof value !== "object") return "Enter a JSON object.";
            const keys = JSON.stringify(Object.keys(value), null, 2).replaceAll("`", "\\u0060");
            return keys.length <= 3900 ? codeFence + "json\n" + keys + "\n" + codeFence : "The key list is too long for one reply.";
        } catch { return "Invalid JSON."; }
    },
    jsonPointer(text: string, path: string) {
        const tokens = jsonTokens(text);
        if (!tokens) return "Invalid JSON.";
        if (path && (!path.startsWith("/") || /~(?![01])/.test(path))) return "Use a JSON pointer such as /items/0. Escape / as ~1 and ~ as ~0.";
        let start = 0;
        for (const part of path ? path.slice(1).split("/") : []) {
            const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
            const container = tokens[start];
            let match: number | undefined;
            if (container === "{" || container === "[") {
                const end = endOfJsonValue(tokens, start) - 1;
                let position = start + 1;
                for (let index = 0; position < end; index++) {
                    const name = container === "{" ? JSON.parse(tokens[position]) : String(index);
                    const valuePosition = container === "{" ? position + 2 : position;
                    if (name === key) match = valuePosition;
                    position = endOfJsonValue(tokens, valuePosition) + 1;
                }
            }
            if (match === undefined) return "That JSON pointer does not exist.";
            start = match;
        }
        const value = tokens.slice(start, endOfJsonValue(tokens, start)).join("").replaceAll("`", "\\u0060");
        return value.length <= 3900 ? codeFence + "json\n" + value + "\n" + codeFence : "The selected value is too long for one reply.";
    },
    duplicateLines(text: string) {
        const counts = new Map<string, number>();
        for (const line of text.split(/\r\n|\r|\n/)) {
            if (line.trim()) counts.set(line, (counts.get(line) ?? 0) + 1);
        }
        const results = [...counts].filter(([, count]) => count > 1).map(([line, count]) => count + " × " + line)
            .join("\n").replace(/`(?=``)/g, "`\u200b");
        if (!results) return "No duplicate nonempty lines.";
        return results.length <= 3900 ? codeFence + "\n" + results + "\n" + codeFence : "The duplicate list is too long for one reply.";
    },
    summarizeNumbers(text: string) {
        const tokens = text.trim().split(/\s*,\s*|\s+/);
        if (tokens.length > 128 || tokens.some(token => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))) return;
        const values = tokens.map(Number).sort((left, right) => left - right);
        if (values.some(value => Math.abs(value) > Number.MAX_SAFE_INTEGER)) return;
        const count = values.length;
        const middle = Math.floor(count / 2);
        const sum = values.reduce((total, value) => total + value, 0);
        const median = count % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
        return [
            "Count " + count, "Sum " + displayNumber(sum), "Mean " + displayNumber(sum / count),
            "Median " + displayNumber(median), "Min " + displayNumber(values[0]), "Max " + displayNumber(values[count - 1]),
        ].join(" · ");
    },
    convertFileSize(text: string) {
        const bytes = fileSizeBytes(text);
        if (bytes === undefined) return;
        const format = (units: Map<string, number>) => {
            const [unit, divisor] = [...units].reverse().find(([, scale]) => scale <= bytes) ?? ["B", 1];
            return displayNumber(bytes / divisor) + " " + unit;
        };
        return [String(bytes) + " B", format(decimalFileUnits), format(binaryFileUnits)]
            .filter((entry, index, values) => values.indexOf(entry) === index).join(" · ");
    },
    extractDiscordMentions(text: string) {
        const mentions = new Map<string, string>();
        for (const [, prefix, id] of text.matchAll(/<(@!|@&|@|#)([1-9]\d{14,21})>/g)) {
            const kind = prefix === "@&" ? "Role" : prefix === "#" ? "Channel" : "User";
            mentions.set(kind + id, kind + " `" + id + "`");
        }
        if (!mentions.size) return "No Discord user, role, or channel mentions found.";
        const output = [...mentions.values()].join("\n");
        return output.length <= 3900 ? output : "The mention list is too long for one reply.";
    },
    percentChange(before: string, after: string) {
        const values = [before.trim(), after.trim()];
        if (values.some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))) return;
        const [original, updated] = values.map(Number);
        if (!Number.isFinite(original) || !Number.isFinite(updated)) return;
        if (!original) return "Percentage change from zero is undefined.";
        const change = (updated - original) / Math.abs(original) * 100;
        if (!Number.isFinite(change)) return;
        return (change > 0 ? "+" : "") + displayNumber(change) + "%";
    },
    commonLines(first: string, second: string) {
        const otherLines = new Set(second.split(/\r\n|\r|\n/));
        const common = [...new Set(first.split(/\r\n|\r|\n/).filter(line => line && otherLines.has(line)))];
        if (!common.length) return "No matching nonempty lines.";
        const result = common.join("\n").replace(/`(?=``)/g, "`\u200b");
        return result.length <= 3900 ? codeFence + "\n" + result + "\n" + codeFence : "Matching lines are too long for one reply.";
    },
    compareLines(before: string, after: string) {
        const lines = (value: string) => value ? value.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/) : [];
        const previous = lines(before);
        const current = lines(after);
        const unmatched = (source: string[], other: string[]) => {
            const counts = new Map<string, number>();
            for (const line of other) counts.set(line, (counts.get(line) ?? 0) + 1);
            return source.filter(line => {
                const count = counts.get(line) ?? 0;
                if (!count) return true;
                counts.set(line, count - 1);
                return false;
            });
        };
        const removed = unmatched(previous, current);
        const added = unmatched(current, previous);
        if (!removed.length && !added.length) return "Both inputs contain the same lines, ignoring order.";
        const changes = [...removed.map(line => "- " + line), ...added.map(line => "+ " + line)]
            .join("\n").replaceAll(codeFence, "`\u200b``");
        return changes.length <= 3900 ? codeFence + "diff\n" + changes + "\n" + codeFence : "Line changes are too long for one reply.";
    },
    orderedLineDiff(before: string, after: string) {
        const lines = (value: string) => value ? value.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/) : [];
        const left = lines(before);
        const right = lines(after);
        if (left.length > 160 || right.length > 160) return "Use up to 160 lines per input.";
        const columns = right.length + 1;
        const matches = new Uint16Array((left.length + 1) * columns);
        for (let i = left.length - 1; i >= 0; i--) {
            for (let j = right.length - 1; j >= 0; j--) {
                const slot = i * columns + j;
                matches[slot] = left[i] === right[j] ? 1 + matches[slot + columns + 1]
                    : Math.max(matches[slot + 1], matches[slot + columns]);
            }
        }
        if (left.length === right.length && matches[0] === left.length) return "Both inputs match in order.";
        const output: string[] = [];
        let i = 0;
        let j = 0;
        while (i < left.length || j < right.length) {
            if (i < left.length && j < right.length && left[i] === right[j]) {
                output.push("  " + left[i++]);
                j++;
            } else if (i < left.length && (j === right.length || matches[(i + 1) * columns + j] >= matches[i * columns + j + 1])) {
                output.push("- " + left[i++]);
            } else {
                output.push("+ " + right[j++]);
            }
        }
        const text = output.join("\n").replaceAll(codeFence, "`\u200b``");
        return text.length <= 3900 ? codeFence + "diff\n" + text + "\n" + codeFence : "The diff is too long for one reply.";
    },
    wordFrequency(text: string) {
        const counts = new Map<string, number>();
        for (const word of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? []) {
            counts.set(word, (counts.get(word) ?? 0) + 1);
        }
        return [...counts].sort(([, left], [, right]) => right - left).slice(0, 10).map(([word, count]) =>
            (word.length > 80 ? word.slice(0, 80) + "…" : word) + " — " + count).join("\n") || "No words found.";
    },
    hexToRgb(input: string) {
        const channels = hexChannels(input);
        if (channels) return `\`rgb(${channels.join(", ")})\``;
    },
    colorContrast(foreground: string, background: string) {
        const text = hexChannels(foreground), surface = hexChannels(background);
        if (!text || !surface) return;
        const ratio = contrast(relativeLuminance(text), relativeLuminance(surface));
        return `Contrast ≈ ${ratio.toFixed(2)}:1\nWCAG AA normal text ${ratio >= 4.5 ? "passes" : "fails"}\nWCAG AA large text ${ratio >= 3 ? "passes" : "fails"}`;
    },
    colorMix(first: string, second: string, percent: string) {
        const from = hexChannels(first), to = hexChannels(second);
        const weight = integerText(percent);
        if (!from || !to || weight === undefined || weight < 0 || weight > 100) return;
        return `\`${hexColor(mixChannels(from, to, weight / 100))}\``;
    },
    improveContrast(foreground: string, background: string, target: string) {
        const ink = hexChannels(foreground), surface = hexChannels(background);
        const threshold = target === "aa" ? 4.5 : target === "aaa" ? 7 : target === "large" ? 3 : undefined;
        if (!ink || !surface || threshold === undefined) return;
        const surfaceLuminance = relativeLuminance(surface);
        for (let step = 0; step <= 255; step++) {
            const candidates = [[0, 0, 0], [255, 255, 255]].map(end => {
                const channels = mixChannels(ink, end, step / 255).map(Math.round);
                return { color: hexColor(channels), ratio: contrast(relativeLuminance(channels), surfaceLuminance) };
            });
            const best = candidates[0].ratio >= candidates[1].ratio ? candidates[0] : candidates[1];
            if (best.ratio >= threshold) return best.color + " · " + best.ratio.toFixed(2) + ":1";
        }
        return "Neither black nor white can reach this contrast ratio against the background.";
    },
    opacityContrast(foreground: string, background: string, opacity: string) {
        const ink = hexChannels(foreground), surface = hexChannels(background);
        const percent = integerText(opacity);
        if (!ink || !surface || percent === undefined || percent < 0 || percent > 100) return;
        const blended = mixChannels(surface, ink, percent / 100).map(Math.round);
        const ratio = contrast(relativeLuminance(blended), relativeLuminance(surface));
        return "Blended color " + hexColor(blended) + " · " + ratio.toFixed(2) + ":1";
    },
    readableInk(background: string) {
        const surface = hexChannels(background);
        if (!surface) return;
        const luminance = relativeLuminance(surface);
        return ([[0, "#000000"], [1, "#ffffff"]] as const).map(([ink, hex]) => [contrast(luminance, ink), hex] as const)
            .sort(([a], [b]) => b - a).map(([ratio, hex]) => `\`${hex}\` · ${ratio.toFixed(2)}:1`).join("\n");
    },
    themeStarter(name: string, background: string, accent: string) {
        const title = name.trim();
        const surface = hexChannels(background), brand = hexChannels(accent);
        if (!title || title.length > 64 || /[\u0000-\u001f\u007f]/.test(title) || !surface || !brand) return;
        const luminance = relativeLuminance(surface);
        const dark = contrast(luminance, 1) >= contrast(luminance, 0);
        const ink = dark ? [255, 255, 255] : [0, 0, 0];
        return planningBlock([
            `theme ${JSON.stringify(title).replaceAll("`", "\\u0060")}:`,
            "  mode: " + (dark ? "dark" : "light"),
            "  background: " + hexColor(surface),
            "  surface: " + hexColor(mixChannels(surface, ink, 0.08)),
            "  sidebar: " + hexColor(mixChannels(surface, ink, 0.04)),
            "  text: " + hexColor(ink),
            "  accent: " + hexColor(brand),
        ].join("\n"));
    },
    rgbToHex(input: string) {
        const text = input.trim();
        const channels = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(text)
            ?? /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(text);
        if (!channels) return;
        const values = channels.slice(1).map(Number);
        if (values.some(value => value > 255)) return;
        return "`#" + values.map(value => value.toString(16).padStart(2, "0")).join("") + "`";
    },
    hslToHex(input: string) {
        const text = input.trim().replace(/^hsl\((.*)\)$/i, "$1").trim();
        const parts = text.includes(",") ? text.split(",").map(part => part.trim()) : text.split(/\s+/);
        const match = /^([+-]?\d+(?:\.\d+)?)(?:deg)? (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/i.exec(parts.join(" "));
        if (!match) return;
        const [angle, saturation, lightness] = match.slice(1).map(Number);
        if (!Number.isFinite(angle) || saturation > 100 || lightness > 100) return;
        const hue = (angle % 360 + 360) % 360;
        const light = lightness / 100;
        const amplitude = saturation / 100 * Math.min(light, 1 - light);
        const component = (offset: number) => {
            const sector = (offset + hue / 30) % 12;
            const value = light - amplitude * Math.max(-1, Math.min(sector - 3, 9 - sector, 1));
            return Math.round(255 * value).toString(16).padStart(2, "0");
        };
        return "`#" + [0, 8, 4].map(component).join("") + "`";
    },
    daysBetween(start: string, end: string) {
        const first = utcMidnight(start), last = utcMidnight(end);
        if (first === undefined || last === undefined) return;
        const days = (last - first) / dayMilliseconds;
        return `${days} ${Math.abs(days) === 1 ? "day" : "days"}`;
    },
    offsetDate(input: string, dayOffset: string) {
        const start = utcMidnight(input), days = integerText(dayOffset);
        if (start === undefined || days === undefined) return;
        const date = new Date(start + days * dayMilliseconds);
        if (Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 0 && date.getUTCFullYear() <= 9999)
            return `\`${date.toISOString().slice(0, 10)}\``;
    },
    isoWeek(input: string) {
        const start = utcMidnight(input);
        if (start === undefined) return;
        const thursday = new Date(start);
        const weekday = thursday.getUTCDay() || 7;
        thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
        const year = thursday.getUTCFullYear();
        const firstDay = new Date(thursday);
        firstDay.setUTCMonth(0, 1);
        const week = Math.floor((thursday.getTime() - firstDay.getTime()) / (7 * dayMilliseconds)) + 1;
        const yearLabel = (year < 0 ? "-" : "") + String(Math.abs(year)).padStart(4, "0");
        return yearLabel + "-W" + String(week).padStart(2, "0") + "-" + weekday;
    },
    unixToIso(input: string, unit: string) {
        const value = integerText(input);
        if (value === undefined || (unit !== "seconds" && unit !== "milliseconds")) return;
        const instant = new Date(unit === "seconds" ? value * 1000 : value);
        if (Number.isFinite(instant.getTime())) return `\`${instant.toISOString()}\``;
    },
    isoToUnix(input: string) {
        const ms = isoUnixMilliseconds(input);
        if (ms !== undefined) return `Seconds \`${ms / 1000}\`\nMilliseconds \`${ms}\``;
    },
    convertDuration(input: string) {
        const seconds = durationSeconds(input);
        if (seconds === undefined) return;
        const days = Math.floor(seconds / 86_400);
        const hours = Math.floor(seconds % 86_400 / 3_600);
        const minutes = Math.floor(seconds % 3_600 / 60);
        return `${days}d ${hours}h ${minutes}m ${seconds % 60}s · ${seconds} seconds`;
    },
    playbackDuration(input: string, rate: string) {
        const duration = durationSeconds(input);
        const speed = Number(rate);
        if (!duration || !/^\d+(?:\.\d{1,2})?$/.test(rate) || speed < 0.25 || speed > 4) return;
        return "Playback time: " + readableDuration(Math.round(duration / speed)) + " at " + speed + "×";
    },
    timestampDifference(start: string, end: string) {
        const from = isoUnixMilliseconds(start), to = isoUnixMilliseconds(end);
        if (from === undefined || to === undefined) return;
        const difference = to - from;
        if (!difference) return "The timestamps are the same instant.";
        const seconds = Math.abs(difference) / 1000;
        const remainder = Math.abs(difference) % 1000;
        const duration = seconds < 1 ? "" : readableDuration(Math.floor(seconds));
        return [duration, remainder ? remainder + "ms" : ""].filter(Boolean).join(" ") + (difference > 0 ? " later" : " earlier");
    },
    shiftTimestamp(input: string, offset: string) {
        const instant = isoUnixMilliseconds(input);
        const duration = durationSeconds(offset.trim().replace(/^[+-]/, ""));
        if (instant === undefined || duration === undefined) return;
        const result = new Date(instant + duration * 1000 * (offset.trim().startsWith("-") ? -1 : 1));
        if (Number.isFinite(result.getTime())) return result.toISOString();
    },
    mediaTimecode(input: string) {
        const seconds = durationSeconds(input);
        if (seconds === undefined) return;
        return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
            .map(part => String(part).padStart(2, "0")).join(":");
    },
    transferDuration(size: string, rate: string) {
        const bytes = fileSizeBytes(size);
        const megabits = Number(rate);
        if (bytes === undefined || !/^\d+(?:\.\d+)?$/.test(rate) || !Number.isFinite(megabits) || megabits <= 0) return;
        const seconds = Math.ceil(bytes * 8 / 1_000_000 / megabits);
        if (Number.isSafeInteger(seconds)) return "Estimated transfer time: " + readableDuration(seconds);
    },
    countdownTimestamp(input: string) {
        const duration = durationSeconds(input);
        if (!duration) return;
        const timestamp = Math.ceil(Date.now() / 1000) + duration;
        if (timestamp <= 8_640_000_000_000) return `<t:${timestamp}:R> · \`<t:${timestamp}:R>\``;
    },
    meetingTimestamp(input: string) {
        const ms = isoUnixMilliseconds(input);
        if (ms === undefined) return;
        const timestamp = Math.floor(ms / 1000);
        return `<t:${timestamp}:F> (<t:${timestamp}:R>)\nCopy \`<t:${timestamp}:F>\``;
    },
    timestampStyles(input: string) {
        const ms = isoUnixMilliseconds(input);
        if (ms === undefined || ms < 0) return;
        const seconds = Math.floor(ms / 1000);
        return [["t", "Short time"], ["T", "Time with seconds"], ["d", "Short date"],
            ["D", "Long date"], ["f", "Date and time"], ["F", "Full date and time"], ["R", "Relative"]]
            .map(([style, label]) => {
                const markup = `<t:${seconds}:${style}>`;
                return `${label} · ${markup} · \`${markup}\``;
            }).join("\n");
    },
    recurringTimestamps(start: string, interval: string, count: string) {
        const ms = isoUnixMilliseconds(start);
        const step = durationSeconds(interval), occurrences = integerText(count);
        if (ms === undefined || ms < 0 || !step || occurrences === undefined || occurrences < 2 || occurrences > 20) return;
        const seconds = Math.floor(ms / 1000);
        if (seconds + step * (occurrences - 1) > 253402300799) return;
        const times = Array.from({ length: occurrences }, (_, index) => `<t:${seconds + index * step}:F>`);
        return times.map((timestamp, index) => `${index + 1}. ${timestamp} · \`${timestamp}\``).join("\n");
    },
    eventWindow(start: string, end: string) {
        const from = isoUnixMilliseconds(start), to = isoUnixMilliseconds(end);
        if (from === undefined || to === undefined || to <= from) return;
        const seconds = Math.floor((to - from) / 1000);
        const duration = seconds < 1 ? "<1s" : Math.floor(seconds / 3600) + "h " + Math.floor(seconds % 3600 / 60) + "m " + seconds % 60 + "s";
        return "Start <t:" + Math.floor(from / 1000) + ":F>\nEnd <t:" + Math.floor(to / 1000) + ":F>\nDuration " + duration;
    },
    voteTally(input: string) {
        if (input.length > 12000) return;
        const votes = planningRows(input);
        if (!votes.length || votes.length > 500 || votes.some(vote => vote.length > 100)) return;
        const choices = new Map<string, { label: string; count: number; }>();
        for (const label of votes) {
            const key = label.normalize("NFC").toLowerCase();
            const existing = choices.get(key);
            if (existing) existing.count++;
            else choices.set(key, { label, count: 1 });
        }
        if (choices.size > 30) return;
        const rows = [...choices.values()].sort((a, b) => b.count - a.count);
        return planningBlock(rows.map(({ label, count }) => count + " · " + label).join("\n") + "\n\nTotal votes: " + votes.length);
    },
    redactEmails(input: string) {
        if (!input.trim() || input.length > 3600) return;
        const addresses = /[a-z0-9.!#$%&'*+\/=?^_{}|~-]+@[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+/gi;
        const redacted = input.replace(addresses, "[email removed]");
        return redacted === input ? "No email addresses found." : planningBlock(redacted);
    },
    cleanDiscordInvite(input: string) {
        const value = input.trim().replace(/^<([^<>]+)>$/, "$1");
        const invite = /^(?:https?:\/\/)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([a-z0-9-]{2,40})\/?(?:[?#][^\s<>]{0,1000})?$/i.exec(value);
        if (!invite) return;
        return "<https://discord.gg/" + invite[1] + ">";
    },
    customEmojiMarkup(name: string, id: string, kind: string) {
        const label = name.trim(), snowflake = id.trim();
        if (!/^[a-z0-9_]{2,32}$/i.test(label) || !discordId(snowflake) || (kind !== "static" && kind !== "animated")) return;
        return planningBlock("<" + (kind === "animated" ? "a" : "") + ":" + label + ":" + snowflake + ">");
    },
    pollDraft(question: string, options: string) {
        const title = question.trim();
        const choices = planningRows(options);
        const distinct = new Set(choices.map(value => value.normalize("NFC").toLowerCase()));
        if (!title || title.length > 160 || /[\r\n]/.test(title) || choices.length < 2 || choices.length > 10
            || distinct.size !== choices.length || choices.some(choice => choice.length > 150)) return;
        return planningBlock(title + "\n\n" + choices.map((choice, index) => (index + 1) + ". " + choice).join("\n"));
    },
    agendaDraft(title: string, items: string) {
        const heading = title.trim();
        const rows = planningRows(items);
        if (!heading || heading.length > 120 || /[\r\n]/.test(heading) || !rows.length || rows.length > 30) return;
        let total = 0;
        const agenda: string[] = [];
        for (const row of rows) {
            const match = /^(\d{1,3})\s*\|\s*(.+)$/.exec(row);
            if (!match || Number(match[1]) < 1 || match[2].length > 150) return;
            agenda.push(total + " min · " + match[2] + " (" + Number(match[1]) + " min)");
            total += Number(match[1]);
        }
        return planningBlock(heading + "\n\n" + agenda.join("\n") + "\n\nTotal: " + total + " min");
    },
    decisionDraft(topic: string, decision: string, actions: string) {
        const title = topic.trim();
        const body = decision.trim();
        const tasks = planningRows(actions);
        if (!title || title.length > 120 || /[\r\n]/.test(title) || !body || body.length > 1500
            || tasks.length > 15 || tasks.some(task => task.length > 120)) return;
        const next = tasks.length ? "\n\nNext actions\n" + tasks.map(task => "- [ ] " + task).join("\n") : "";
        return planningBlock(title + "\n\nDecision\n" + body + next);
    },
    pickNames(text: string, count: string) {
        const rows = planningRows(text);
        const number = integerText(count);
        const remaining = new Map<string, string>();
        if (rows.length > 150 || rows.some(row => row.length > 100)) return;
        for (const name of rows) {
            const key = name.normalize("NFC").toLowerCase();
            if (!remaining.has(key)) remaining.set(key, name);
        }
        if (number === undefined || number < 1 || number > 20 || number > remaining.size) return;
        const names = [...remaining.values()];
        for (let i = 0; i < number; i++) {
            const next = randomInteger(i, names.length - 1)!;
            [names[i], names[next]] = [names[next], names[i]];
        }
        return planningBlock(names.slice(0, number).join("\n"));
    },
    splitPoints(total: string, people: string) {
        const points = integerText(total), count = integerText(people);
        if (points === undefined || points < 0 || count === undefined || count < 1 || count > 10000) return;
        const per = Math.floor(points / count);
        const remainder = points % count;
        if (!remainder) return count + " × " + per + " points";
        return remainder + " × " + (per + 1) + " points\n" + (count - remainder) + " × " + per + " points";
    },
    buildMessageLink(server: string, channel: string, message: string) {
        const scope = server.trim(), channelId = channel.trim(), messageId = message.trim();
        if ((scope !== "@me" && !discordId(scope)) || !discordId(channelId) || (messageId && !discordId(messageId))) return;
        return `<https://discord.com/channels/${scope}/${channelId}${messageId ? "/" + messageId : ""}>`;
    },
    balanceGroups(text: string, count: string) {
        const rows = planningRows(text);
        const groups = integerText(count);
        if (groups === undefined || groups < 2 || groups > 20 || rows.length < groups || rows.length > 100) return;
        const lists: string[][] = Array.from({ length: groups }, (_, index) => [`Group ${index + 1}`]);
        rows.forEach((row, index) => lists[index % groups].push("- " + row));
        return planningBlock(lists.map(group => group.join("\n")).join("\n\n"));
    },
    testResultSummary(text: string) {
        const rows = planningRows(text);
        if (!rows.length || rows.length > 150) return;
        const counts = { pass: 0, fail: 0, blocked: 0, unclassified: 0 };
        for (const row of rows) {
            const match = /^(pass|fail|blocked)(?:\s|:|$)/i.exec(row);
            const status = match ? match[1].toLowerCase() as "pass" | "fail" | "blocked" : "unclassified";
            counts[status]++;
        }
        return `Passed ${counts.pass} · Failed ${counts.fail} · Blocked ${counts.blocked} · Unclassified ${counts.unclassified} · Total ${rows.length}`;
    },
    totalTime(text: string) {
        const rows = planningRows(text);
        if (!rows.length || rows.length > 100) return;
        let total = 0;
        for (const [index, row] of rows.entries()) {
            const duration = durationSeconds(row);
            if (duration === undefined) return `Line ${index + 1} needs a duration such as 2h 30m.`;
            total += duration;
        }
        if (!Number.isSafeInteger(total)) return "The total is too large.";
        const hours = Math.floor(total / 3600);
        return `${hours}h ${Math.floor(total % 3600 / 60)}m ${total % 60}s · ${total} seconds across ${rows.length} entries`;
    },
    messageBudget(text: string, limit: string) {
        const cap = integerText(limit);
        if (cap !== 2000 && cap !== 4000) return;
        const difference = cap - text.length;
        return `${text.length}/${cap} UTF-16 units · ${Math.abs(difference)} ${difference < 0 ? "over" : "remaining"}`;
    },
    discordLinkDetails(input: string) {
        const text = input.trim().replace(/^<([^<>]+)>$/, "$1");
        const match = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(@me|\d{17,20})\/(\d{17,20})(?:\/(\d{17,20}))?\/?$/i.exec(text);
        if (!match) return;
        const [, guild, channel, message] = match;
        const direct = guild.toLowerCase() === "@me";
        const ids = [direct ? undefined : guild, channel, message];
        if (ids.some(id => id && !discordId(id))) return;
        return [direct ? "Direct message" : `Server \`${guild}\``, `Channel \`${channel}\``,
            ...(message ? [`Message \`${message}\``] : [])].join("\n");
    },
    convertNumberBase(input: string, from: string, to: string) {
        const match = /^([+-]?)([0-9a-z]{1,256})$/i.exec(input.trim());
        const source = integerText(from), destination = integerText(to);
        if (!match || source === undefined || destination === undefined || source < 2 || source > 36 || destination < 2 || destination > 36) return;
        const base = BigInt(source);
        let value = 0n;
        for (const character of match[2]) {
            const digit = Number.parseInt(character, 36);
            if (digit >= source) return;
            value = value * base + BigInt(digit);
        }
        return `\`${(match[1] === "-" ? -value : value).toString(destination).toUpperCase()}\``;
    },
    aspectRatio(width: string, height: string) {
        const w = integerText(width), h = integerText(height);
        if (w === undefined || h === undefined || w < 1 || h < 1) return;
        let a = w, b = h;
        while (b) [a, b] = [b, a % b];
        return `\`${w / a}:${h / a}\` · ${w} × ${h} px`;
    },
    resizeDimensions(width: string, height: string, target: string, axis: string) {
        const w = integerText(width), h = integerText(height), size = integerText(target);
        if (w === undefined || h === undefined || size === undefined || [w, h, size].some(value => value < 1 || value > 100000)
            || (axis !== "width" && axis !== "height")) return;
        const other = Math.max(1, Math.round(size * (axis === "width" ? h / w : w / h)));
        if (other > 100000) return;
        return (axis === "width" ? [size, other] : [other, size]).join(" × ") + " px";
    },
    fitImage(source: string, box: string, mode: string) {
        const dimensions = /^\s*(\d{1,6})\s*[x×]\s*(\d{1,6})\s*$/i;
        const image = dimensions.exec(source), target = dimensions.exec(box);
        if (!image || !target || (mode !== "contain" && mode !== "cover")) return;
        const [w, h, targetW, targetH] = [...image.slice(1), ...target.slice(1)].map(Number);
        if ([w, h, targetW, targetH].some(value => value < 1 || value > 100000)) return;
        const contain = mode === "contain";
        const useWidth = contain ? targetW * h <= targetH * w : targetW * h >= targetH * w;
        const round = contain ? Math.floor : Math.ceil;
        const scaledW = useWidth ? targetW : Math.max(1, round(w * targetH / h));
        const scaledH = useWidth ? Math.max(1, round(h * targetW / w)) : targetH;
        const action = contain ? "Padding" : "Crop";
        return "Resize to " + scaledW + " × " + scaledH + " px\n" + action + ": "
            + Math.abs(targetW - scaledW) + " px horizontally, " + Math.abs(targetH - scaledH) + " px vertically";
    },
    bitrateBudget(size: string, duration: string) {
        const bytes = fileSizeBytes(size);
        const seconds = durationSeconds(duration);
        if (!bytes || !seconds) return;
        const bitsPerSecond = Math.floor(bytes * 8 / seconds);
        if (!bitsPerSecond) return "This file size allows less than 1 bit per second.";
        return "Maximum average: " + displayNumber(bitsPerSecond / 1000) + " kbps (video, audio, and container combined)";
    },
    transferEta(size: string, megabits: string) {
        const bytes = fileSizeBytes(size);
        const value = megabits.trim();
        if (bytes === undefined || !/^\d+(?:\.\d+)?$/.test(value)) return;
        const speed = Number(value);
        if (!Number.isFinite(speed) || speed < 0.001 || speed > 1_000_000) return;
        const seconds = Math.ceil(bytes * 8 / (speed * 1_000_000));
        const hours = Math.floor(seconds / 3600);
        return `About ${hours}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s at ${displayNumber(speed)} Mbps`;
    },
    utf8Size(text: string) {
        let bytes = 0;
        for (const character of text) {
            const code = character.codePointAt(0)!;
            bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
        }
        return `${bytes} UTF-8 ${bytes === 1 ? "byte" : "bytes"}`;
    },
    inspectUrl(input: string) {
        const text = input.trim();
        const url = parsePublicHttpUrl(text);
        if (!url) return;
        const count = url.search.slice(1).split("&").filter(Boolean).length;
        return `Scheme \`${url.protocol.slice(0, -1)}\`\nHost \`${url.host.replaceAll("`", "%60")}\`\nQuery parameters ${count}\nFragment ${url.hash ? "present" : "absent"}`;
    },
    stripTracking(input: string) {
        const text = input.trim();
        if (!parsePublicHttpUrl(text)) return;
        const match = /^([^?#]+)\?([^#]*)(#.*)?$/.exec(text);
        if (!match) return "No known tracking parameters found.";
        const fields = match[2].split("&");
        const kept = fields.filter(field => {
            try {
                const name = decodeURIComponent(field.split("=", 1)[0]).toLowerCase();
                return !/^(?:utm_(?:source|medium|campaign|term|content|id|source_platform|creative_format|marketing_tactic)|fbclid|gclid|dclid|msclkid)$/.test(name);
            } catch { return true; }
        });
        if (fields.length === kept.length) return "No known tracking parameters found.";
        const query = kept.some(Boolean) ? "?" + kept.join("&") : "";
        const result = match[1] + query + (match[3] ?? "");
        return codeFence + "\n" + result.replace(/`(?=``)/g, "`\u200b") + "\n" + codeFence;
    },
    encodeBase64(text: string) {
        let encoded: string;
        try { encoded = encodeURIComponent(text); }
        catch { return "This text contains invalid Unicode."; }
        const bytes = encoded.replace(/%([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
        if (Math.ceil(bytes.length / 3) * 4 > 3900) return "Encoded text is too long for one reply.";
        let output = "";
        for (let index = 0; index < bytes.length; index += 3) {
            const a = bytes.charCodeAt(index);
            const b = bytes.charCodeAt(index + 1) || 0;
            const c = bytes.charCodeAt(index + 2) || 0;
            output += base64Alphabet[a >> 2] + base64Alphabet[(a & 3) << 4 | b >> 4]
                + (index + 1 < bytes.length ? base64Alphabet[(b & 15) << 2 | c >> 6] : "=")
                + (index + 2 < bytes.length ? base64Alphabet[c & 63] : "=");
        }
        return codeFence + "\n" + output + "\n" + codeFence;
    },
    tsvToMarkdown(input: string) {
        return markdownTable(input.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).map(row => row.split("\t")));
    },
    csvToMarkdown(input: string) {
        return markdownTable(csvRows(input));
    },
    csvColumn(input: string, column: string) {
        const position = integerText(column);
        if (position === undefined || position < 1 || position > 64 || input.length > 12000) return;
        const rows = csvRows(input);
        if (!rows.length || rows.length > 150 || rows.some(row => row[position - 1] === undefined)) return;
        return planningBlock(rows.map(row => '"' + row[position - 1].replaceAll('"', '""') + '"').join("\n"));
    },
    markdownChecklist(input: string) {
        const lines = input.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean);
        if (!lines.length) return;
        const checklist = lines.map(line => /^- \[[ xX]\]\s/.test(line)
            ? line : "- [ ] " + line.replace(/^[-*+]\s+/, "")).join("\n").replace(/`(?=``)/g, "`\u200b");
        return checklist.length <= 3900 ? codeFence + "markdown\n" + checklist + "\n" + codeFence : "The checklist is too long for one reply.";
    },
    checklistProgress(input: string) {
        const items = [...input.matchAll(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+\[([ xX])\](?:[ \t]+|$)/gm)];
        if (!items.length) return "No Markdown checklist items found.";
        const completed = items.filter(([, state]) => state !== " ").length;
        return `${completed} of ${items.length} complete · ${Math.round(100 * completed / items.length)}% · ${items.length - completed} remaining`;
    },
    discordTimestamp(seconds: string, format: string) {
        const input = seconds.trim();
        if (!/^-?\d+$/.test(input) || !/^[tTdDfFR]$/.test(format)) return;
        const timestamp = Number(input);
        if (Number.isSafeInteger(timestamp) && Math.abs(timestamp) <= 8_640_000_000_000) {
            return `\`<t:${timestamp}:${format}>\``;
        }
    },
    discordLocalTimestamp(date: string, time: string, format: string) {
        const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
        const clock = /^(\d{2}):(\d{2})$/.exec(time.trim());
        if (!day || !clock || !/^[tTdDfFR]$/.test(format)) return;
        const [year, month, dayOfMonth] = day.slice(1).map(Number);
        const [hour, minute] = clock.slice(1).map(Number);
        const instant = new Date(0);
        instant.setFullYear(year, month - 1, dayOfMonth);
        instant.setHours(hour, minute, 0, 0);
        if (instant.getFullYear() !== year || instant.getMonth() !== month - 1 || instant.getDate() !== dayOfMonth
            || instant.getHours() !== hour || instant.getMinutes() !== minute) return;
        return `\`<t:${instant.getTime() / 1000}:${format}>\``;
    },
    colorText(text: string, color: string, background: string, style: string) {
        const foregroundIndex = ansiForegrounds.indexOf(color);
        const backgroundIndex = ansiBackgrounds.indexOf(background);
        if (foregroundIndex < 0 || background && backgroundIndex < 0 || style && style !== "bold" && style !== "underline") return;
        const codes = [style === "bold" ? 1 : style === "underline" ? 4 : 0, 30 + foregroundIndex];
        if (background) codes.push(40 + backgroundIndex);
        const safeText = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
        if (!safeText.trim()) return;
        const prefix = `\u001b[${codes.join(";")}m`;
        const lines = safeText.replace(/`(?=``)/g, "`\u200b").split(/\r\n|\r|\n/).map(line => prefix + line + "\u001b[0m");
        const output = "```ansi\n" + lines.join("\n") + "\n```";
        if (output.length <= 4000) return output;
    },
    searchLink(input: string, engine: string, hyperlink: string, hideEmbed: string) {
        if (!input.trim()) return;
        try {
            const encoded = encodeURIComponent(input).replaceAll("(", "%28").replaceAll(")", "%29");
            const url = (searchEngines.get(engine) ?? searchEngines.get("Google")!) + encoded;
            const destination = hideEmbed === "true" ? "<" + url + ">" : url;
            return hyperlink === "true" ? "[" + input.replace(/[\\[\]]/g, "\\$&") + "](" + destination + ")" : destination;
        } catch {
            return;
        }
    },
    // ShipCalc by rootpoi, kraethis, and ewlle.
    ship(a: string, b: string) {
        const pair = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort().join("💕");
        let hash = 0;
        for (let i = 0; i < pair.length; i++) hash = (hash * 31 + pair.charCodeAt(i)) >>> 0;
        const score = hash % 101;
        const heart = score > 80 ? "💞" : score > 50 ? "💖" : score > 25 ? "💗" : "💔";
        return `${heart} **${a}** + **${b}** = **${score}%**`;
    },
    choose: (choices: string) => chooseOne(choices.split(",").map(choice => choice.trim()).filter(Boolean)),
    roll(sides: string) {
        const result = randomInteger(1, sides ? Number(sides) : 6);
        if (result !== undefined) return `You rolled a ${result}`;
    },
    randomNumber(minimum: string, maximum: string) {
        const min = Number(minimum);
        const max = Number(maximum);
        const number = randomInteger(Math.min(min, max), Math.max(min, max));
        if (number !== undefined) return String(number);
    },
    wordCount(text: string) {
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        return `${words} word${words === 1 ? "" : "s"}, ${text.length} character${text.length === 1 ? "" : "s"}`;
    },
    countLines: (text: string) => String(text.split(/\r\n|\r|\n/).length),
    uniqueLines: (text: string) => [...new Set(text.split(/\r\n|\r|\n/))].join("\n"),
    rot13: (text: string) => text.replace(/[a-z]/gi, letter => {
        const base = letter <= "Z" ? 65 : 97;
        return String.fromCharCode(base + (letter.charCodeAt(0) - base + 13) % 26);
    }),
    transform(text: string, style: string, repeat: string, reverse: string, normalize: string) {
        if (style === "upper") text = text.toUpperCase();
        if (style === "lower") text = text.toLowerCase();
        if (style === "locale-upper") text = text.toLocaleUpperCase();
        if (style === "locale-lower") text = text.toLocaleLowerCase();
        if (normalizations.includes(normalize)) text = text.normalize(normalize);
        if ((style === "reverse") !== (reverse === "true")) text = [...text].reverse().join("");
        const count = repeat ? Number(repeat) : 1;
        if (count > 0 && count <= 4000 && text.length * count <= 4000) return text.repeat(count);
    },
    ask(question: string) {
        return question + " - " + chooseOne(["Yes", "No", "Maybe", "Ask again later", "Definitely not", "It is certain"]);
    },
    currentTime() { return "> **Current Time**: " + new Date().toLocaleString(); },
    mock(text: string) {
        return text.split("").map((char, i) => i % 2 ? char.toUpperCase() : char.toLowerCase()).join("");
    },
    morse(text: string) {
        if (!/^[.\-/ ]+$/.test(text)) return [...text.toUpperCase()].map(char => morseCodes.get(char) ?? "").join(" ");
        const decoded = text.split(" ").map(code => morseLetters.get(code) ?? "").join("").toLowerCase();
        return decoded.charAt(0).toUpperCase() + decoded.slice(1);
    },
};
