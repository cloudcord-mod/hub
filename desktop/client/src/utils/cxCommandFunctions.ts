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

function randomInteger(low: number, high: number) {
    const range = high - low + 1;
    if (Number.isSafeInteger(range) && range > 0) return low + Math.floor(Math.random() * range);
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
    wordFrequency(text: string) {
        const counts = new Map<string, number>();
        for (const word of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? []) {
            counts.set(word, (counts.get(word) ?? 0) + 1);
        }
        return [...counts].sort(([, left], [, right]) => right - left).slice(0, 10).map(([word, count]) =>
            (word.length > 80 ? word.slice(0, 80) + "…" : word) + " — " + count).join("\n") || "No words found.";
    },
    hexToRgb(input: string) {
        let hex = input.trim().replace(/^#/, "");
        if (/^[\da-f]{3}$/i.test(hex)) hex = [...hex].map(digit => digit.repeat(2)).join("");
        if (!/^[\da-f]{6}$/i.test(hex)) return;
        const channels = hex.match(/../g)!.map(value => Number.parseInt(value, 16));
        return `\`rgb(${channels.join(", ")})\``;
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
        const dates = [start, end].map(value => value.trim());
        if (!dates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date))) return;
        const midnights = dates.map(date => new Date(date + "T00:00:00Z"));
        if (!midnights.every((date, index) => Number.isFinite(date.getTime()) && date.toISOString().startsWith(dates[index] + "T"))) return;
        const days = (midnights[1].getTime() - midnights[0].getTime()) / 86_400_000;
        return `${days} ${Math.abs(days) === 1 ? "day" : "days"}`;
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
