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

function randomInteger(low: number, high: number) {
    const range = high - low + 1;
    if (Number.isSafeInteger(range) && range > 0) return low + Math.floor(Math.random() * range);
}

function hexChannels(input: string) {
    let hex = input.trim().replace(/^#/, "");
    if (/^[\da-f]{3}$/i.test(hex)) hex = [...hex].map(digit => digit.repeat(2)).join("");
    if (/^[\da-f]{6}$/i.test(hex)) return hex.match(/../g)!.map(value => Number.parseInt(value, 16));
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
        const colors = [hexChannels(foreground), hexChannels(background)];
        const luminances = colors.map(channels => channels?.map(channel => {
            const rgb = channel / 255;
            return rgb <= 0.04045 ? rgb / 12.92 : ((rgb + 0.055) / 1.055) ** 2.4;
        }));
        const [text, surface] = luminances;
        if (!text || !surface) return;
        const relativeLuminance = ([red, green, blue]: number[]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        const a = relativeLuminance(text), b = relativeLuminance(surface);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        return `Contrast ≈ ${ratio.toFixed(2)}:1\nWCAG AA normal text ${ratio >= 4.5 ? "passes" : "fails"}\nWCAG AA large text ${ratio >= 3 ? "passes" : "fails"}`;
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
    discordLinkDetails(input: string) {
        const text = input.trim().replace(/^<([^<>]+)>$/, "$1");
        const match = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(@me|\d{17,20})\/(\d{17,20})(?:\/(\d{17,20}))?\/?$/i.exec(text);
        if (!match) return;
        const [, guild, channel, message] = match;
        const direct = guild.toLowerCase() === "@me";
        const ids = [direct ? undefined : guild, channel, message];
        if (ids.some(id => id && (id.startsWith("0") || BigInt(id) > 0xffffffffffffffffn))) return;
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
        if (!/^https?:\/\//i.test(text) || text.length > 3000 || /[\s\\]/.test(text)) return;
        try {
            const url = new URL(text);
            if (url.username || url.password) return;
            const count = url.search.slice(1).split("&").filter(Boolean).length;
            return `Scheme \`${url.protocol.slice(0, -1)}\`\nHost \`${url.host.replaceAll("`", "%60")}\`\nQuery parameters ${count}\nFragment ${url.hash ? "present" : "absent"}`;
        } catch { /* Invalid URL. */ }
    },
    tsvToMarkdown(input: string) {
        return markdownTable(input.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).map(row => row.split("\t")));
    },
    csvToMarkdown(input: string) {
        return markdownTable(csvRows(input));
    },
    markdownChecklist(input: string) {
        const lines = input.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean);
        if (!lines.length) return;
        const checklist = lines.map(line => /^- \[[ xX]\]\s/.test(line)
            ? line : "- [ ] " + line.replace(/^[-*+]\s+/, "")).join("\n").replace(/`(?=``)/g, "`\u200b");
        return checklist.length <= 3900 ? codeFence + "markdown\n" + checklist + "\n" + codeFence : "The checklist is too long for one reply.";
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
