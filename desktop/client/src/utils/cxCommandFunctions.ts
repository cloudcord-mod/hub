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

function decimalNumber(text: string) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return;
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
}

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
    filterLines(text: string, contains: string) {
        if (!contains.trim()) return;
        const query = contains.toLowerCase();
        const lines = text.split(/\r\n|\r|\n/).filter(line => line.toLowerCase().includes(query));
        return lines.length ? planningBlock(lines.join("\n")) : "No matching lines.";
    },
    extractLineRange(text: string, first: string, last: string) {
        const start = integerText(first), end = integerText(last);
        const lines = text.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/);
        if (start === undefined || end === undefined || start < 1 || end < start || end > lines.length) return;
        return planningBlock(lines.slice(start - 1, end).join("\n"));
    },
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
    unicodeFromPoints(text: string) {
        const tokens = text.trim().split(/\s+/);
        if (tokens.length > 128 || tokens.some(token => !/^U\+[0-9a-f]{1,6}$/i.test(token))) return;
        const points = tokens.map(token => parseInt(token.slice(2), 16));
        if (points.some(point => point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))) return;
        return planningBlock(String.fromCodePoint(...points));
    },
    normalizeUnicode(text: string, form: string) {
        if (!text || !/^(?:NFC|NFD|NFKC|NFKD)$/.test(form)) return;
        return planningBlock(text.normalize(form));
    },
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
    escapeRegex(text: string) {
        if (!text) return;
        return planningBlock(text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
            .replace(/\r/g, "\\r").replace(/\n/g, "\\n"));
    },
    truncateText(text: string, limit: string) {
        const length = integerText(limit);
        if (!text || length === undefined || length < 1 || length > 2000) return;
        const points = Array.from(text);
        return planningBlock(points.length > length ? points.slice(0, length - 1).join("") + "…" : text);
    },
    findLongLines(text: string, limit: string) {
        const length = integerText(limit);
        if (!text || length === undefined || length < 1) return;
        const lines = text.split(/\r\n|\r|\n/).flatMap((line, index) => {
            const size = Array.from(line).length;
            return size > length ? ["Line " + (index + 1) + " · " + size + " code points"] : [];
        });
        if (!lines.length) return "No lines exceed the limit.";
        return lines.slice(0, 50).join("\n") + (lines.length > 50 ? "\n" + (lines.length - 50) + " more" : "");
    },
    countTextMatches(text: string, phrase: string) {
        if (!text || !phrase) return;
        let count = 0;
        let offset = 0;
        while ((offset = text.indexOf(phrase, offset)) !== -1) {
            count++;
            offset += phrase.length;
        }
        return count + (count === 1 ? " exact match" : " exact matches");
    },
    escapeMarkdown(text: string) {
        const escaped = text.replace(/[\\`*_{}\[\]()#+\-.!|>~]/g, "\\$&");
        return escaped.length <= 3900 ? escaped : "Escaped text is too long for one reply.";
    },
    formatSpoiler(text: string) {
        if (!text.trim()) return;
        const escaped = text.replace(/[\\|]/g, "\\$&");
        return planningBlock(escaped.split(/\r\n|\r|\n/).map(line => line.trim() ? "||" + line + "||" : line).join("\n"));
    },
    formatMarkdownList(text: string, mode: string) {
        if (mode !== "bullet" && mode !== "numbered") return;
        const lines = text.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean);
        if (!lines.length) return;
        return planningBlock(lines.map((line, index) => (mode === "bullet" ? "- " : (index + 1) + ". ") + line).join("\n"));
    },
    showInvisibleCharacters(text: string) {
        if (!text) return;
        const labels: Record<string, string> = { " ": "·", "\t": "[TAB]", "\u00a0": "[NBSP]", "\u200b": "[ZWSP]", "\u200d": "[ZWJ]", "\uFEFF": "[BOM]" };
        return planningBlock(text.replace(/[ \t\u00a0\u200b\u200d\uFEFF]|\r\n|\r|\n/g, character =>
            labels[character] ?? (character === "\r\n" ? "[CRLF]\n" : character === "\n" ? "[LF]\n" : "[CR]\n")));
    },
    expandTabs(text: string, width: string) {
        const size = integerText(width);
        if (!text || size === undefined || size < 1 || size > 16) return;
        const lines = text.split(/\r\n|\r|\n/).map(line => {
            let column = 0;
            return Array.from(line, character => {
                const advance = character === "\t" ? size - column % size : 1;
                column += advance;
                return character === "\t" ? " ".repeat(advance) : character;
            }).join("");
        });
        return planningBlock(lines.join("\n"));
    },
    escapeHtml(text: string) {
        if (!text) return;
        const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
        return planningBlock(text.replace(/[&<>"']/g, character => entities[character]));
    },
    indentLines(text: string, spaces: string) {
        const width = integerText(spaces);
        if (!text || width === undefined || width < 1 || width > 16) return;
        const indent = " ".repeat(width);
        return planningBlock(text.split(/\r\n|\r|\n/).map(line => line ? indent + line : line).join("\n"));
    },
    formatCodeBlock(text: string, language: string) {
        const syntax = language.trim();
        if (!text.trim() || !/^[a-z0-9_+-]{1,24}$/i.test(syntax)) return;
        const code = text.replace(/`(?=``)/g, "`\u200b");
        if (code.length <= 3800) return codeFence + syntax + "\n" + code + "\n" + codeFence;
        return "The result is too long for one reply.";
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
        const original = decimalNumber(before.trim());
        const updated = decimalNumber(after.trim());
        if (original === undefined || updated === undefined) return;
        if (!original) return "Percentage change from zero is undefined.";
        const change = (updated - original) / Math.abs(original) * 100;
        if (!Number.isFinite(change)) return;
        return (change > 0 ? "+" : "") + displayNumber(change) + "%";
    },
    scaleRecipe(original: string, servings: string, ingredients: string) {
        const from = decimalNumber(original.trim());
        const to = decimalNumber(servings.trim());
        if (from === undefined || to === undefined || from <= 0 || to <= 0) return;
        const rows = ingredients.trim().split(/\r\n|\r|\n/);
        if (rows.length > 40) return;
        const scaled: string[] = [];
        for (const row of rows) {
            const [amountText, name, extra] = row.split("|").map(part => part.trim());
            if (!amountText || !name || extra !== undefined) return;
            const amount = decimalNumber(amountText);
            if (amount === undefined || amount <= 0) return;
            const quantity = amount * (to / from);
            if (!Number.isFinite(quantity) || quantity <= 0) return;
            scaled.push(displayNumber(quantity) + " " + name);
        }
        const result = scaled.join("\n").replace(/`(?=``)/g, "`\u200b");
        return result.length <= 3900 ? codeFence + "\n" + result + "\n" + codeFence : "Scaled ingredients are too long for one reply.";
    },
    displayPixelDensity(width: string, height: string, diagonal: string) {
        const columns = integerText(width);
        const rows = integerText(height);
        const inches = decimalNumber(diagonal.trim());
        if (columns === undefined || columns < 1 || rows === undefined || rows < 1 || inches === undefined || inches <= 0) return;
        const density = Math.hypot(columns, rows) / inches;
        if (Number.isFinite(density)) return displayNumber(density) + " pixels per inch";
    },
    splitBillEvenly(total: string, people: string) {
        const amount = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(total.trim());
        const count = integerText(people);
        if (!amount || count === undefined || count < 1 || count > 1000) return;
        const cents = Number(amount[1]) * 100 + Number((amount[2] ?? "").padEnd(2, "0"));
        const share = Math.floor(cents / count);
        const remainder = cents % count;
        const format = (value: number) => (value / 100).toFixed(2);
        return remainder
            ? `${remainder} pay ${format(share + 1)} each, ${count - remainder} pay ${format(share)} each.`
            : `${format(share)} each for ${count} ${count === 1 ? "person" : "people"}.`;
    },
    whitespaceReport(text: string) {
        if (!text) return;
        const lines = text.split(/\r\n|\r|\n/);
        const tabs = (text.match(/\t/g) ?? []).length;
        const nonbreaking = (text.match(/\u00a0/g) ?? []).length;
        const trailing = lines.filter(line => /[ \t]+$/.test(line)).length;
        const empty = lines.filter(line => !line.trim()).length;
        return `${lines.length} lines · ${empty} blank · ${trailing} with trailing spaces or tabs · ${tabs} tabs · ${nonbreaking} nonbreaking spaces`;
    },
    reduceFraction(numerator: string, denominator: string) {
        const top = integerText(numerator), bottom = integerText(denominator);
        if (top === undefined || bottom === undefined || !bottom) return;
        let a = Math.abs(top), b = Math.abs(bottom);
        while (b) [a, b] = [b, a % b];
        const sign = bottom < 0 ? -1 : 1;
        return `${sign * top / a}/${Math.abs(bottom) / a}`;
    },
    primeFactors(text: string) {
        const value = integerText(text);
        if (value === undefined || value < 2 || value > 1000000000) return;
        const factors: number[] = [];
        let remaining = value;
        for (let divisor = 2; divisor * divisor <= remaining; divisor++) {
            while (remaining % divisor === 0) {
                factors.push(divisor);
                remaining /= divisor;
            }
        }
        if (remaining > 1) factors.push(remaining);
        return `${value} = ${factors.join(" × ")}`;
    },
    baseConverter(input: string, from: string, to: string) {
        const source = integerText(from), target = integerText(to);
        if (source === undefined || source < 2 || source > 36 || target === undefined || target < 2 || target > 36) return;
        const text = input.trim().toLowerCase();
        if (!/^-?[0-9a-z]{1,96}$/.test(text)) return;
        const negative = text.startsWith("-");
        let value = 0n;
        for (const digit of negative ? text.slice(1) : text) {
            const index = "0123456789abcdefghijklmnopqrstuvwxyz".indexOf(digit);
            if (index >= source) return;
            value = value * BigInt(source) + BigInt(index);
        }
        return (negative ? -value : value).toString(target).toUpperCase();
    },
    audioPitchRatio(frequency: string, semitones: string) {
        const hz = decimalNumber(frequency.trim()), shift = decimalNumber(semitones.trim());
        if (hz === undefined || hz <= 0 || shift === undefined || Math.abs(shift) > 48) return;
        const ratio = 2 ** (shift / 12), changed = hz * ratio;
        if (Number.isFinite(changed) && changed > 0) return `${displayNumber(changed)} Hz · ratio ${displayNumber(ratio)}×`;
    },
    mapScaleDistance(centimeters: string, scale: string) {
        const distance = decimalNumber(centimeters.trim()), denominator = integerText(scale);
        if (distance === undefined || distance < 0 || denominator === undefined || denominator < 1) return;
        const meters = distance * (denominator / 100);
        if (Number.isFinite(meters)) return `${displayNumber(meters)} m · ${displayNumber(meters / 1000)} km`;
    },
    htmlEscapeDraft(text: string) {
        if (!text) return;
        return planningBlock(text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;").replaceAll("'", "&#39;"));
    },
    hexByteFormat(text: string, width: string) {
        const columns = integerText(width), data = text.replace(/\s/g, "").toUpperCase();
        if (columns === undefined || columns < 1 || columns > 32 || !/^(?:[0-9A-F]{2}){1,1024}$/.test(data)) return;
        const bytes = data.match(/../g)!;
        const rows: string[] = [];
        for (let i = 0; i < bytes.length; i += columns) {
            rows.push(i.toString(16).toUpperCase().padStart(4, "0") + "  " + bytes.slice(i, i + columns).join(" "));
        }
        return planningBlock(rows.join("\n"));
    },
    dateDayLabel(text: string) {
        const instant = utcMidnight(text);
        if (instant === undefined) return;
        const date = new Date(instant);
        const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        return names[date.getUTCDay()] + " · " + date.toISOString().slice(0, 10);
    },
    percentagePoints(before: string, after: string) {
        const from = decimalNumber(before.trim().replace(/%$/, "")), to = decimalNumber(after.trim().replace(/%$/, ""));
        if (from === undefined || to === undefined || from < 0 || from > 100 || to < 0 || to > 100) return;
        const delta = to - from;
        return `${delta > 0 ? "+" : ""}${displayNumber(delta)} percentage points`;
    },
    monthCalendar(text: string) {
        const month = text.trim();
        if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) return;
        const first = new Date(month + "-01T00:00:00Z");
        const next = new Date(first);
        next.setUTCMonth(next.getUTCMonth() + 1);
        const days = (next.getTime() - first.getTime()) / dayMilliseconds;
        const offset = (first.getUTCDay() + 6) % 7;
        const lines = [month, "Mo Tu We Th Fr Sa Su"];
        for (let index = -offset; index < days; index += 7) {
            lines.push(Array.from({ length: 7 }, (_, day) => {
                const value = index + day + 1;
                return value > 0 && value <= days ? String(value).padStart(2, " ") : "  ";
            }).join(" ").trimEnd());
        }
        return planningBlock(lines.join("\n"));
    },
    pageRangeCount(text: string) {
        const parts = text.trim().split(/[,\s]+/);
        if (parts.length > 128) return;
        const ranges: { start: number; end: number; }[] = [];
        for (const part of parts) {
            const match = /^(\d{1,6})(?:-(\d{1,6}))?$/.exec(part);
            if (!match) return;
            const start = Number(match[1]), end = Number(match[2] ?? match[1]);
            if (!start || end < start) return;
            ranges.push({ start, end });
        }
        ranges.sort((a, b) => a.start - b.start);
        let count = 0, last = 0;
        for (const { start, end } of ranges) {
            count += Math.max(0, end - Math.max(start - 1, last));
            last = Math.max(last, end);
        }
        return count + (count === 1 ? " distinct page" : " distinct pages");
    },
    bitmapMemory(width: string, height: string, channels: string) {
        const columns = integerText(width), rows = integerText(height), channelCount = integerText(channels);
        if (columns === undefined || columns < 1 || rows === undefined || rows < 1
            || channelCount === undefined || channelCount < 1 || channelCount > 4) return;
        const bytes = columns * rows * channelCount;
        if (Number.isSafeInteger(bytes)) return `${bytes} bytes · ${displayNumber(bytes / 1048576)} MiB uncompressed`;
    },
    typographyScale(base: string, ratio: string, steps: string) {
        const size = decimalNumber(base.trim()), multiplier = decimalNumber(ratio.trim()), count = integerText(steps);
        if (size === undefined || size <= 0 || size > 1000 || multiplier === undefined || multiplier < 1
            || multiplier > 3 || count === undefined || count < 1 || count > 12) return;
        return Array.from({ length: count }, (_, index) => Number((size * multiplier ** index).toFixed(2)) + " px").join(" · ");
    },
    safeAreaInset(width: string, height: string, inset: string) {
        const columns = integerText(width), rows = integerText(height), margin = integerText(inset);
        if (columns === undefined || rows === undefined || margin === undefined || margin < 0
            || columns <= 2 * margin || rows <= 2 * margin) return;
        return `${columns - margin * 2} × ${rows - margin * 2} px usable · begins at (${margin}, ${margin})`;
    },
    teamRotation(names: string, shift: string) {
        const roster = planningRows(names), amount = integerText(shift);
        if (roster.length < 2 || roster.length > 80 || amount === undefined) return;
        const offset = (amount % roster.length + roster.length) % roster.length;
        const ordered = [...roster.slice(offset), ...roster.slice(0, offset)];
        return planningBlock(ordered.map((name, index) => `${index + 1}. ${name}`).join("\n"));
    },
    jsonArrayFilter(json: string, key: string, filter: string) {
        try {
            const rows: unknown = JSON.parse(json);
            const value: unknown = JSON.parse(filter);
            if (!Array.isArray(rows) || !key || (value !== null && typeof value === "object")) return;
            const matches = rows.filter(row => row !== null && typeof row === "object" && !Array.isArray(row)
                && Object.prototype.hasOwnProperty.call(row, key) && row[key] === value);
            return planningBlock(JSON.stringify(matches, null, 2));
        } catch { return; }
    },
    csvToJson(text: string) {
        const [header, ...rows] = csvRows(text);
        if (!header || header.some(key => !key.trim()) || new Set(header).size !== header.length
            || rows.some(row => row.length !== header.length)) return;
        return planningBlock(JSON.stringify(rows.map(row => Object.fromEntries(header.map((key, i) => [key, row[i]]))), null, 2));
    },
    calendarQuarter(text: string) {
        const instant = utcMidnight(text);
        if (instant === undefined) return;
        const date = new Date(instant);
        const year = date.toISOString().slice(0, 4);
        const quarter = Math.floor(date.getUTCMonth() / 3);
        const start = String(quarter * 3 + 1).padStart(2, "0") + "-01";
        const end = ["03-31", "06-30", "09-30", "12-31"][quarter];
        return `Q${quarter + 1} ${year} · ${year}-${start} to ${year}-${end}`;
    },
    weightedAverage(text: string) {
        const rows = text.trim().split(/\r\n|\r|\n/);
        if (rows.length > 128) return;
        let weightedTotal = 0;
        let totalWeight = 0;
        for (const row of rows) {
            const [valueText, weightText, extra] = row.split("|").map(part => part.trim());
            if (!valueText || !weightText || extra !== undefined) return;
            const value = decimalNumber(valueText);
            const weight = decimalNumber(weightText);
            if (value === undefined || weight === undefined || weight < 0) return;
            weightedTotal += value * weight;
            totalWeight += weight;
        }
        if (totalWeight <= 0 || !Number.isFinite(totalWeight) || !Number.isFinite(weightedTotal)) return;
        const average = weightedTotal / totalWeight;
        if (Number.isFinite(average)) return "Weighted average: " + displayNumber(average);
    },
    unitPriceComparison(first: string, second: string) {
        const unitPrice = (offer: string) => {
            const [priceText, quantityText, extra] = offer.split("/").map(part => part.trim());
            if (!priceText || !quantityText || extra !== undefined) return;
            const price = decimalNumber(priceText);
            const quantity = decimalNumber(quantityText);
            if (price === undefined || price < 0 || quantity === undefined || quantity <= 0) return;
            const rate = price / quantity;
            return Number.isFinite(rate) ? rate : undefined;
        };
        const a = unitPrice(first);
        const b = unitPrice(second);
        if (a === undefined || b === undefined) return;
        const firstPrice = displayNumber(a);
        const secondPrice = displayNumber(b);
        const verdict = firstPrice === secondPrice ? "Same price per unit" : a < b ? "First offer is cheaper" : "Second offer is cheaper";
        return firstPrice + " vs " + secondPrice + " per unit. " + verdict + ".";
    },
    pairLines(labels: string, values: string) {
        const lines = (text: string) => text.trim().split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean);
        const left = lines(labels);
        const right = lines(values);
        if (!left.length || left.length !== right.length) return;
        const result = left.map((label, index) => label + ": " + right[index]).join("\n").replace(/`(?=``)/g, "`\u200b");
        return result.length <= 3900 ? codeFence + "\n" + result + "\n" + codeFence : "Paired lines are too long for one reply.";
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
    weekdayCount(start: string, end: string) {
        const first = utcMidnight(start), last = utcMidnight(end);
        if (first === undefined || last === undefined || last < first) return;
        const days = (last - first) / dayMilliseconds + 1;
        let weekdays = Math.floor(days / 7) * 5;
        const weekday = new Date(first).getUTCDay();
        for (let offset = 0; offset < days % 7; offset++) {
            const day = (weekday + offset) % 7;
            if (day > 0 && day < 6) weekdays++;
        }
        return `${weekdays} weekdays · ${days - weekdays} weekend days (inclusive)`;
    },
    eventOverlap(first: string, second: string) {
        const parseRange = (text: string) => {
            const parts = text.split("|").map(part => part.trim());
            if (parts.length !== 2) return;
            const start = isoUnixMilliseconds(parts[0]), end = isoUnixMilliseconds(parts[1]);
            if (start !== undefined && end !== undefined && end > start) return { start, end };
        };
        const left = parseRange(first), right = parseRange(second);
        if (!left || !right) return;
        const start = Math.max(left.start, right.start), end = Math.min(left.end, right.end);
        if (end <= start) return "The events do not overlap.";
        const seconds = (end - start) / 1000;
        const duration = Number.isInteger(seconds) ? readableDuration(seconds) : displayNumber(seconds) + "s";
        return `Overlap: ${duration} · <t:${Math.floor(start / 1000)}:F> to <t:${Math.floor(end / 1000)}:F>`;
    },
    roundRobinCount(teams: string, meetings: string) {
        const count = integerText(teams), rounds = integerText(meetings);
        if (count === undefined || count < 2 || count > 1000 || rounds === undefined || rounds < 1 || rounds > 20) return;
        return `${count * (count - 1) / 2 * rounds} total matches · ${(count - 1) * rounds} per team`;
    },
    packingCapacity(items: string, capacity: string) {
        const count = integerText(items), perContainer = integerText(capacity);
        if (count === undefined || count < 0 || perContainer === undefined || perContainer < 1) return;
        const full = Math.floor(count / perContainer), remaining = count % perContainer;
        return `${full + (remaining ? 1 : 0)} containers · ${full} full · ${remaining} remaining items`;
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
    runningPace(distance: string, duration: string) {
        const kilometers = Number(distance);
        const seconds = durationSeconds(duration);
        if (!/^\d+(?:\.\d+)?$/.test(distance) || !Number.isFinite(kilometers) || kilometers <= 0 || !seconds) return;
        const pace = Math.round(seconds / kilometers);
        if (!Number.isSafeInteger(pace) || pace < 1) return;
        return Math.floor(pace / 60) + ":" + String(pace % 60).padStart(2, "0") + " per km";
    },
    calendarDayDifference(start: string, end: string) {
        const first = utcMidnight(start.trim()), last = utcMidnight(end.trim());
        if (first === undefined || last === undefined) return;
        const days = (last - first) / dayMilliseconds;
        if (!days) return "The dates are the same day.";
        return Math.abs(days) + (Math.abs(days) === 1 ? " day " : " days ") + (days > 0 ? "later" : "earlier");
    },
    workSessionBudget(focus: string, breaks: string, sessions: string) {
        const work = durationSeconds(focus), rest = durationSeconds(breaks);
        const count = integerText(sessions);
        if (!work || rest === undefined || count === undefined || count < 1 || count > 100) return;
        const focusTime = work * count;
        const breakTime = rest * (count - 1);
        return "Total " + readableDuration(focusTime + breakTime) + " · Focus " + readableDuration(focusTime)
            + " · Breaks between sessions " + readableDuration(breakTime);
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
    inspectDiscordTimestamp(input: string) {
        const match = /^<t:(-?\d{1,13})(?::([tTdDfFR]))?>$/.exec(input.trim());
        if (!match) return;
        const seconds = Number(match[1]);
        const date = new Date(seconds * 1000);
        if (!Number.isFinite(date.getTime())) return;
        return "UTC " + date.toISOString() + " · Unix seconds " + seconds + " · Format " + (match[2] ?? "f");
    },
    timestampAtOffset(input: string, offset: string) {
        const instant = isoUnixMilliseconds(input);
        const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim());
        if (instant === undefined || !match) return;
        const hours = Number(match[2]), minutes = Number(match[3]);
        if (hours > 23 || minutes > 59) return;
        const displacement = (hours * 60 + minutes) * 60000 * (match[1] === "-" ? -1 : 1);
        return new Date(instant + displacement).toISOString().replace(/Z$/, match[0]);
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
    imagePrintSize(width: string, height: string, ppi: string) {
        const columns = integerText(width), rows = integerText(height), density = integerText(ppi);
        if (!columns || !rows || !density || columns < 1 || rows < 1 || density < 1) return;
        const dimensions = (factor: number) => [columns, rows].map(pixels =>
            String(Number((pixels / density * factor).toPrecision(6)))).join(" × ");
        return dimensions(1) + " in · " + dimensions(2.54) + " cm";
    },
    videoFramePosition(index: string, fps: string) {
        const frame = integerText(index), rate = Number(fps);
        if (frame === undefined || frame < 0 || !/^\d{1,4}(?:\.\d{1,3})?$/.test(fps) || rate < 1 || rate > 1000) return;
        const milliseconds = Math.round(frame / rate * 1000);
        if (!Number.isSafeInteger(milliseconds)) return;
        const seconds = Math.floor(milliseconds / 1000);
        const clock = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
            .map(part => String(part).padStart(2, "0")).join(":");
        return clock + "." + String(milliseconds % 1000).padStart(3, "0");
    },
    imagePixelCount(width: string, height: string) {
        const columns = integerText(width), rows = integerText(height);
        if (columns === undefined || rows === undefined || columns < 1 || rows < 1 || columns > 1_000_000 || rows > 1_000_000) return;
        const count = columns * rows;
        return count + " pixels · " + count / 1_000_000 + " MP";
    },
    tempoLoopLength(bpm: string, bars: string, beats: string) {
        const tempo = decimalNumber(bpm.trim()), measureCount = integerText(bars), beatsPerMeasure = integerText(beats);
        if (tempo === undefined || tempo < 20 || tempo > 400 || measureCount === undefined
            || measureCount < 1 || measureCount > 10000 || beatsPerMeasure === undefined || beatsPerMeasure < 1 || beatsPerMeasure > 32) return;
        const totalBeats = measureCount * beatsPerMeasure;
        return `${totalBeats} beats · ${displayNumber(totalBeats * 60 / tempo)} seconds`;
    },
    imageMegapixels(width: string, height: string) {
        const columns = integerText(width), rows = integerText(height);
        if (columns === undefined || rows === undefined || columns < 1 || rows < 1) return;
        const pixels = columns * rows;
        if (Number.isSafeInteger(pixels)) return `${pixels} pixels · ${displayNumber(pixels / 1000000)} MP`;
    },
    compressionBudget(original: string, target: string) {
        const size = fileSizeBytes(original), limit = fileSizeBytes(target);
        if (size === undefined || limit === undefined || limit <= 0 || limit >= size) return;
        return `Remove ${size - limit} bytes (${displayNumber((size - limit) * 100 / size)}%) · keep at most ${displayNumber(limit * 100 / size)}%`;
    },
    audioSampleCount(rate: string, duration: string) {
        const sampleRate = integerText(rate), seconds = durationSeconds(duration);
        if (sampleRate === undefined || sampleRate < 1 || sampleRate > 768000 || !seconds) return;
        const samples = sampleRate * seconds;
        if (Number.isSafeInteger(samples)) return samples + " samples per channel";
    },
    playlistDuration(text: string) {
        const tracks = planningRows(text);
        if (!tracks.length || tracks.length > 200) return;
        let total = 0;
        for (const track of tracks) {
            const match = /^(?:(\d{1,4}):)?(\d{1,4}):([0-5]\d)$/.exec(track);
            if (!match || (match[1] && !/^[0-5]\d$/.test(match[2]))) return;
            total += Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        }
        return tracks.length + (tracks.length === 1 ? " track · " : " tracks · ") + readableDuration(total);
    },
    pcmAudioSize(rate: string, bits: string, channels: string, duration: string) {
        const sampleRate = integerText(rate), bitDepth = integerText(bits), channelCount = integerText(channels);
        const seconds = durationSeconds(duration);
        if (sampleRate === undefined || sampleRate < 1 || sampleRate > 768_000 || bitDepth === undefined
            || ![8, 16, 24, 32].includes(bitDepth) || channelCount === undefined || channelCount < 1 || channelCount > 32 || !seconds) return;
        const bytes = sampleRate * (bitDepth / 8) * channelCount * seconds;
        if (Number.isSafeInteger(bytes)) return "PCM payload: " + bytes + " bytes · " + bytes / 1_000_000 + " MB";
    },
    videoSizeEstimate(rate: string, duration: string) {
        const kbps = Number(rate);
        const seconds = durationSeconds(duration);
        if (!/^\d{1,8}(?:\.\d{1,3})?$/.test(rate) || kbps <= 0 || !seconds) return;
        const megabytes = kbps * seconds / 8000;
        return "Estimated payload: " + Number(megabytes.toPrecision(8)) + " MB";
    },
    videoFrameCount(fps: string, duration: string) {
        const rate = Number(fps);
        const seconds = durationSeconds(duration);
        if (!/^\d{1,4}(?:\.\d{1,3})?$/.test(fps) || rate < 1 || rate > 1000 || !seconds) return;
        const frames = Math.round(rate * seconds);
        if (Number.isSafeInteger(frames)) return "Estimated frames: " + frames;
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
    csvToTsv(input: string) {
        if (input.length > 12000) return;
        const rows = csvRows(input);
        const columns = rows[0]?.length;
        if (!columns || rows.some(row => row.length !== columns || row.some(field => /[\t\r\n]/.test(field)))) return;
        return planningBlock(rows.map(row => row.join("\t")).join("\n"));
    },
    tsvToCsv(input: string) {
        if (!input.trim() || input.length > 12000) return;
        const rows = input.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).map(row => row.split("\t"));
        const columns = rows[0].length;
        if (rows.some(row => row.length !== columns)) return;
        return planningBlock(rows.map(row => row.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(",")).join("\n"));
    },
    compareCsvCells(before: string, after: string) {
        if (before.length > 12000 || after.length > 12000) return;
        const left = csvRows(before), right = csvRows(after);
        const columns = left[0]?.length;
        if (!columns || columns > 32 || left.length > 64 || left.length !== right.length
            || left.some(row => row.length !== columns) || right.some(row => row.length !== columns)) return;
        const locations = left.flatMap((row, y) => row.flatMap((cell, x) => cell !== right[y][x] ? [`R${y + 1}C${x + 1}`] : []));
        if (!locations.length) return "No CSV cells changed.";
        const listed = locations.slice(0, 100).join(", ");
        return locations.length + (locations.length === 1 ? " changed cell · " : " changed cells · ") + listed
            + (locations.length > 100 ? " (first 100 shown)" : "");
    },
    surroundLines(text: string, prefix: string, suffix: string) {
        if (!text || !(prefix || suffix) || /[\r\n]/.test(prefix + suffix) || prefix.length + suffix.length > 64) return;
        return planningBlock(text.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).map(line => prefix + line + suffix).join("\n"));
    },
    transposeCsv(input: string) {
        if (input.length > 12000) return;
        const rows = csvRows(input);
        const columns = rows[0]?.length ?? 0;
        if (!columns || columns > 32 || rows.length > 64 || rows.some(row => row.length !== columns)) return;
        const transposed = rows[0].map((_, column) =>
            rows.map(row => '"' + row[column].replaceAll('"', '""') + '"').join(","));
        return planningBlock(transposed.join("\n"));
    },
    csvShape(text: string) {
        const rows = csvRows(text);
        if (!rows.length) return;
        const expected = rows[0].length;
        const mismatched = rows.flatMap((row, index) => row.length === expected ? [] : [index + 1]);
        return `${rows.length} rows · ${expected} columns in the first row`
            + (mismatched.length ? ` · Different width in ${mismatched.length} rows (first: ${mismatched[0]})` : " · All rows have the same width");
    },
    jsonValueShape(text: string) {
        try {
            const value: unknown = JSON.parse(text);
            const kind = (item: unknown) => item === null ? "null" : Array.isArray(item) ? "array" : typeof item;
            const type = kind(value);
            if (Array.isArray(value)) return `Array · ${value.length} entries · ${[...new Set(value.map(kind))].join(", ") || "empty"}`;
            if (value !== null && typeof value === "object") return `Object · ${Object.keys(value).length} top-level keys`;
            return "JSON type: " + type;
        } catch { return; }
    },
    lineLengthReport(text: string, limit: string) {
        const maximum = integerText(limit);
        if (!text.trim() || maximum === undefined || maximum < 1 || maximum > 4000) return;
        const lines = text.split(/\r\n|\r|\n/);
        const over = lines.flatMap((line, index) => {
            const length = Array.from(line).length;
            return length > maximum ? [`Line ${index + 1}: ${length}`] : [];
        });
        return over.length
            ? `${over.length} lines exceed ${maximum} characters\n${over.slice(0, 20).join("\n")}`
            : `All ${lines.length} lines fit within ${maximum} characters.`;
    },
    romanNumerals(text: string) {
        const symbols = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
            [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const;
        const format = (value: number) => {
            let output = "";
            for (const [amount, symbol] of symbols) {
                const count = Math.floor(value / amount);
                output += symbol.repeat(count);
                value %= amount;
            }
            return output;
        };
        const integer = integerText(text);
        if (integer !== undefined) return integer >= 1 && integer <= 3999 ? format(integer) : undefined;
        const roman = text.trim().toUpperCase();
        if (!/^[MDCLXVI]{1,15}$/.test(roman)) return;
        let value = 0, position = 0;
        for (const [amount, symbol] of symbols) {
            while (roman.startsWith(symbol, position)) {
                value += amount;
                position += symbol.length;
            }
        }
        if (position === roman.length && value <= 3999 && format(value) === roman) return String(value);
    },
    hexTextDecode(text: string) {
        const hex = text.replace(/\s/g, "");
        if (!/^(?:[0-9a-f]{2}){1,1900}$/i.test(hex)) return;
        try {
            const decoded = decodeURIComponent(hex.replace(/../g, "%$&"));
            return planningBlock(decoded.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, char =>
                "\\x" + char.charCodeAt(0).toString(16).padStart(2, "0")));
        } catch { return; }
    },
    gridCellSize(width: string, columns: string, gap: string) {
        const canvas = decimalNumber(width.trim()), count = integerText(columns), spacing = decimalNumber(gap.trim());
        if (canvas === undefined || canvas <= 0 || count === undefined || count < 1 || count > 1000 || spacing === undefined || spacing < 0) return;
        const available = canvas - (count - 1) * spacing;
        if (available <= 0 || !Number.isFinite(available)) return;
        return `${displayNumber(available / count)} px per column · ${displayNumber(available)} px usable width`;
    },
    arithmeticSequence(start: string, step: string, count: string) {
        const first = decimalNumber(start.trim()), delta = decimalNumber(step.trim()), length = integerText(count);
        if (first === undefined || delta === undefined || length === undefined || length < 1 || length > 50) return;
        const values = Array.from({ length }, (_, index) => first + index * delta);
        if (values.every(Number.isFinite)) return values.map(displayNumber).join(", ");
    },
    csvRowFilter(input: string, column: string, value: string) {
        const position = integerText(column);
        if (position === undefined || position < 1 || position > 64) return;
        const [header, ...rows] = csvRows(input);
        if (!header || header[position - 1] === undefined || rows.some(row => row.length !== header.length)) return;
        const matches = rows.filter(row => row[position - 1] === value);
        if (!matches.length) return "No matching rows.";
        return planningBlock([header, ...matches].map(row => row.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(",")).join("\n"));
    },
    csvColumnFrequency(input: string, column: string) {
        const position = integerText(column);
        if (position === undefined || position < 1 || position > 64 || input.length > 12000) return;
        const [header, ...rows] = csvRows(input);
        if (!header || !rows.length || rows.length > 150 || header[position - 1] === undefined
            || rows.some(row => row.length !== header.length)) return;
        const counts = new Map<string, number>();
        for (const row of rows) {
            const value = row[position - 1];
            counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20);
        return planningBlock(top.map(([value, count]) => count + " × " + JSON.stringify(value)).join("\n"));
    },
    checkIsbn(text: string) {
        const isbn = text.toUpperCase().replace(/[\s-]/g, "");
        if (/^\d{9}[\dX]$/.test(isbn)) {
            const sum = Array.from(isbn, (digit, index) => (digit === "X" ? 10 : Number(digit)) * (10 - index))
                .reduce((total, value) => total + value, 0);
            return sum % 11 === 0 ? "Valid ISBN-10 checksum." : "Invalid ISBN-10 checksum.";
        }
        if (/^97[89]\d{10}$/.test(isbn)) {
            const sum = Array.from(isbn, (digit, index) => Number(digit) * (index % 2 ? 3 : 1))
                .reduce((total, value) => total + value, 0);
            return sum % 10 === 0 ? "Valid ISBN-13 checksum." : "Invalid ISBN-13 checksum.";
        }
    },
    releaseNotesOutline(added: string, fixed: string, changed: string) {
        const sections = [["Added", added], ["Fixed", fixed], ["Changed", changed]].flatMap(([heading, text]) => {
            const lines = planningRows(text);
            return lines.length ? ["## " + heading + "\n" + lines.map(line => "- " + line.replace(/^[-*+]\s+/, "")).join("\n")] : [];
        });
        if (sections.length) return planningBlock(sections.join("\n\n"));
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
    readingTime(text: string, rate: string) {
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        const speed = integerText(rate);
        if (!words || speed === undefined || speed < 50 || speed > 1000) return;
        return `${words} words · about ${readableDuration(Math.ceil(words * 60 / speed))} at ${speed} words/min`;
    },
    openChecklistItems(text: string) {
        const rows = text.split(/\r\n|\r|\n/);
        const pattern = /^[ \t]*(?:[-*+]|\d+\.)[ \t]+\[([ xX])\][ \t]+(.+)$/;
        const items = rows.flatMap(row => {
            const match = pattern.exec(row);
            return match ? [match] : [];
        });
        if (!items.length) return;
        const open = items.filter(([, state]) => state === " ").map(([, , item]) => "- [ ] " + item.trim());
        return open.length ? planningBlock(open.join("\n")) : "All checklist items are complete.";
    },
    altTextDraft(subject: string, context: string, visible: string) {
        const description = subject.trim().replace(/\s+/g, " ");
        if (!description) return;
        const details = [description, context.trim().replace(/\s+/g, " "),
            visible.trim() && "Visible text: " + visible.trim().replace(/\s+/g, " ")].filter(Boolean);
        const draft = details.map(line => /[.!?]$/.test(line) ? line : line + ".").join(" ");
        if (draft.length <= 500) return planningBlock(draft);
    },
    linesToSpoilers(text: string) {
        const rows = text.trim().split(/\r\n|\r|\n/);
        if (!rows.some(row => row.trim())) return;
        const result = rows.map(row => row.trim() ? "||" + row.replaceAll("|", "\\|") + "||" : "").join("\n");
        if (result.length <= 3900) return planningBlock(result);
    },
    quoteWithAttribution(text: string, author: string) {
        const source = author.trim();
        if (!source || source.length > 160 || /[\r\n]/.test(source) || !text.trim()) return;
        const quote = text.trim().split(/\r\n|\r|\n/).map(line => "> " + line).join("\n");
        return planningBlock(quote + "\n\n— " + source);
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
