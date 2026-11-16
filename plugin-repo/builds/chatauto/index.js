// Chat Auto — CloudCord userplugin.
// Watches a configured channel for the games bot's word-game images, reads them
// through OCR.space and answers as the user (tafkeek letters / fastest word).
// Same rules as the PC pipeline: only tafkeek + fastest games, RTL order,
// spaced multi-word answers, mode memory per channel, zero-guess gates.

const { api, metro, plugin: pluginApi } = bunny;
const { flux } = api;
const { findByStoreName } = metro;
const { common } = metro;
const { messageUtil, React, ReactNative, components } = common;
const RN = ReactNative;
const e = React.createElement;
const storage = pluginApi.createStorage();
const log = pluginApi.logger;

const DEFAULT_OCR_KEYS = [
    "K8508311493100988957", "K8303912305601488957", "K8186259044999588957",
    "K8577479258120688957", "K8910301043576188957", "K8482272248515588957",
].join(",");

// ---------- Arabic helpers ----------

const AR_DIACRITICS = /[ً-ْٰـ]/g;
const AR_LETTER = /[ء-ي]/;

function arNorm(s) {
    return String(s || "")
        .replace(AR_DIACRITICS, "")
        .replace(/[أإآٱ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .replace(/ء/g, "")
        .replace(/ا+$/, "ه")
        .replace(/\s+/g, "")
        .trim();
}

function hasArabic(s) { return /[\u0600-\u06FF]/.test(s || ""); }

const CHAT_STOP = new Set([
    "اسرع", "يكتب", "كتابه", "كتابة", "تفكيك", "فكك", "لديك", "ثانيه", "ثواني",
    "متبقي", "الوقت", "يلا", "جاوب", "اكتب", "الكلمه", "كلمه", "سريعه", "بسرعه",
    "الان", "فورا", "لعبة", "الالعاب", "اضغط", "ابدأ", "بدأ", "الجواب", "صح",
    "غلط", "نقاط", "جولة", "الجولة", "انت", "اللاعب", "مستني", "انتظر",
].map(arNorm));

const CHAT_ANSWER_BAD = new Set([
    "اسرع", "يكتب", "كتابه", "تفكيك", "فكك", "لديك", "ثانيه", "ثواني", "متبقي",
    "جاوب", "الكلمه", "كلمه", "سريعه", "بسرعه", "الجواب", "نقاط", "جولة",
].map(arNorm));

const COUNTDOWN_RE = /لديك|ثانيه|ثواني|متبقي|الوقت/;

function detectMode(normText) {
    if (/تفكيك|فكك/.test(normText)) return "tafkeek";
    if (/اسرع/.test(normText) && /يكتب/.test(normText)) return "fast";
    return null;
}

function isStopWord(w) { return CHAT_STOP.has(arNorm(w)); }
function isBadWord(w) { return CHAT_ANSWER_BAD.has(arNorm(w)); }

// ---------- OCR ----------

let ocrKeyIdx = 0;
function nextOcrKey() {
    const keys = String(storage.ocrKeys || "").split(/[,;\s]+/).filter(Boolean);
    if (!keys.length) return "";
    const k = keys[ocrKeyIdx % keys.length];
    ocrKeyIdx = (ocrKeyIdx + 1) % keys.length;
    return k;
}

async function ocrSpace(imageUrl, engine, key) {
    const fd = new FormData();
    fd.append("apikey", key);
    fd.append("url", imageUrl);
    fd.append("language", "auto");
    fd.append("isOverlayRequired", "true");
    fd.append("scale", "true");
    fd.append("OCREngine", engine);
    let ctrl = null, timer = null;
    try { ctrl = new AbortController(); timer = setTimeout(() => ctrl.abort(), 15000); } catch (_) { /* no abort */ }
    try {
        const opts = { method: "POST", body: fd };
        if (ctrl) opts.signal = ctrl.signal;
        const res = await fetch("https://api.ocr.space/parse/image", opts);
        return await res.json();
    } finally { if (timer) clearTimeout(timer); }
}

function lineToText(words) {
    const ws = (words || [])
        .filter(w => w && typeof w.WordText === "string" && w.WordText.trim())
        .slice()
        .sort((a, b) => (b.Left || 0) - (a.Left || 0));
    if (!ws.length) return { text: "", words: [] };
    const hs = ws.map(w => w.Height || 0).filter(h => h > 0);
    const lineH = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : 20;
    let out = ws[0].WordText.trim();
    const kept = [ws[0].WordText.trim()];
    for (let i = 1; i < ws.length; i++) {
        const prev = ws[i - 1], cur = ws[i];
        const gap = (prev.Left || 0) - ((cur.Left || 0) + (cur.Width || 0));
        const sep = gap > lineH * 0.12 ? " " : "";
        out += sep + cur.WordText.trim();
        kept.push(cur.WordText.trim());
    }
    return { text: out, words: kept };
}

function parseOcrResult(json) {
    const res = { mode: null, countdown: false, answer: null };
    const parsed = json && json.ParsedResults && json.ParsedResults[0];
    if (!parsed) return res;
    const lines = (parsed.TextOverlay && parsed.TextOverlay.Lines) || [];
    const rawLines = [];
    for (const line of lines) {
        const lt = lineToText(line.Words || []);
        const clean = lt.text.replace(/[‎‏‪-‮]/g, "").trim();
        if (!clean || !hasArabic(clean)) continue;
        rawLines.push({ text: clean, norm: arNorm(clean), minTop: line.MinTop || 0, words: lt.words });
    }
    if (!rawLines.length) return res;

    const joined = rawLines.map(l => l.norm).join(" ");
    res.mode = detectMode(joined);
    res.countdown = COUNTDOWN_RE.test(joined) || /\d+\s*(ثانيه|ثواني)/.test(joined);

    const candidates = [];
    for (const l of rawLines) {
        const content = l.words.filter(w => {
            const n = arNorm(w);
            return n.length >= 2 && AR_LETTER.test(w) && !isStopWord(w);
        });
        if (!content.length) continue;
        if (content.some(w => isBadWord(w))) continue;
        if (l.words.every(w => isStopWord(w) || !AR_LETTER.test(w))) continue;
        const disp = content.join(" ");
        const key = arNorm(disp);
        if (key.length < 2) continue;
        candidates.push({ key, disp, score: content.length * 10 - l.words.length, top: l.minTop });
    }
    if (candidates.length) {
        candidates.sort((a, b) => b.score - a.score || a.top - b.top);
        res.answer = { key: candidates[0].key, disp: candidates[0].disp };
    }
    return res;
}

// ---------- Pipeline ----------

const seenMessages = new Set();
const seenQueue = [];
function markSeen(id) {
    if (seenMessages.has(id)) return false;
    seenMessages.add(id); seenQueue.push(id);
    if (seenQueue.length > 500) { const old = seenQueue.shift(); if (old) seenMessages.delete(old); }
    return true;
}

function channelCfg(channelId) {
    const servers = (storage.cfg && storage.cfg.servers) || {};
    for (const gid in servers) {
        const cfg = servers[gid];
        if (cfg && cfg.channelId === channelId) return { guildId: gid, cfg };
    }
    return null;
}

function buildAnswer(r) {
    if (!r.answer || !r.mode) return null;
    if (r.mode === "tafkeek") {
        const letters = r.answer.disp.replace(/\s+/g, "").split("").filter(ch => AR_LETTER.test(ch));
        if (letters.length < 2) return null;
        return { content: letters.join(" "), mode: r.mode };
    }
    return { content: r.answer.disp, mode: r.mode };
}

function saveCfg() { storage.cfg = JSON.parse(JSON.stringify(storage.cfg || {})); }

function selectedChannelId() {
    try {
        const s = findByStoreName("SelectedChannelStore");
        return (s && s.getChannelId && s.getChannelId()) || null;
    } catch (_) { return null; }
}

// ---------- Native overlay + composer typing (file IPC) ----------
// The custom CloudCord bootstrap polls Documents/rain/chatauto-req.json and
// replies in chatauto-res.json / chatauto-state.json. On a stock IPA none of
// these files exist and every call below simply resolves null -> direct send.

const IPC_PREFIX = "rain/";
let ipcSeq = 0;

function ipcFs() { return (api && api.native && api.native.fs) || null; }

async function ipcWrite(name, obj) {
    const fs = ipcFs(); if (!fs) return false;
    try { await fs.writeFile(name, JSON.stringify(obj), { prefix: IPC_PREFIX }); return true; }
    catch (_) { return false; }
}

async function ipcRead(name) {
    const fs = ipcFs(); if (!fs) return null;
    try { return await fs.readFile(name, { prefix: IPC_PREFIX }); }
    catch (_) { return null; }
}

async function ipcRequest(op, fields, timeoutMs) {
    const fs = ipcFs(); if (!fs) return null;
    // String id = seq + timestamp: survives plugin reloads without matching
    // a stale chatauto-res.json left over from a previous app session.
    const id = (++ipcSeq) + "-" + Date.now();
    const wrote = await ipcWrite("chatauto-req.json", Object.assign({ id, op }, fields || {}));
    if (!wrote) return null;
    const deadline = Date.now() + (timeoutMs || 8000);
    while (Date.now() < deadline) {
        const txt = await ipcRead("chatauto-res.json");
        if (txt) {
            try {
                const r = JSON.parse(txt);
                if (r && r.id === id) return r;
            } catch (_) {}
        }
        await new Promise(res => setTimeout(res, 120));
    }
    return null;
}

function finishAnswer(r, channelId) {
    if (!r) return;
    if (r.mode) {
        if (!storage.cfg.channelModes) storage.cfg.channelModes = {};
        storage.cfg.channelModes[channelId] = r.mode;
        saveCfg();
    }
    let mode = r.mode;
    if (!mode && r.countdown) mode = (storage.cfg.channelModes || {})[channelId];
    if (!mode || (mode !== "fast" && mode !== "tafkeek")) return;
    const answer = buildAnswer({ ...r, mode });
    if (!answer) return;

    const sendIt = () => {
        try { messageUtil.sendMessage(channelId, { content: answer.content }); }
        catch (err) { log.warn("send failed", err); }
    };

    // Real-keyboard path: only when this channel is the one open on screen.
    // The native side types char-by-char into the composer through real
    // UITextInput events (keyboard stays up); we then send via the normal
    // message path and ask the native side to clear the draft.
    void (async () => {
        let typed = false;
        try {
            const hit = channelCfg(channelId);
            if (selectedChannelId() === channelId) {
                const res = await ipcRequest("type", {
                    text: answer.content,
                    speed: hit && hit.cfg.speed === "insane" ? "insane" : "normal",
                }, 12000);
                typed = !!(res && res.ok);
            }
        } catch (_) {}
        if (typed) {
            const ms = 220 + Math.min(500, answer.content.length * 35);
            setTimeout(() => {
                sendIt();
                void ipcRequest("clear", {}, 4000);
            }, ms);
        } else {
            setTimeout(() => sendIt(), 20 + Math.floor(Math.random() * 60));
        }
    })();
}

async function processImage(channelId, imageUrl, insane) {
    const jobs = [ocrSpace(imageUrl, "1", nextOcrKey()), ocrSpace(imageUrl, "2", nextOcrKey())];

    if (insane) {
        let settled = false;
        for (const j of jobs) {
            j.catch(() => null).then(json => {
                if (settled || !json) return;
                const r = parseOcrResult(json);
                const known = r.mode || (r.countdown && (storage.cfg.channelModes || {})[channelId]);
                if (r.answer && known) { settled = true; finishAnswer(r, channelId); }
            });
        }
        const all = await Promise.all(jobs.map(j => j.catch(() => null)));
        if (!settled) {
            for (const json of all) {
                if (!json) continue;
                const r = parseOcrResult(json);
                if (r.answer) { finishAnswer(r, channelId); break; }
            }
        }
        return;
    }

    const [a, b] = await Promise.all(jobs.map(j => j.catch(() => null)));
    const ra = a ? parseOcrResult(a) : null;
    const rb = b ? parseOcrResult(b) : null;
    if (ra && ra.answer && rb && rb.answer && ra.answer.key === rb.answer.key) {
        finishAnswer(ra, channelId);
        return;
    }
    const solo = [ra, rb].filter(r => r && r.answer && r.mode);
    if (solo.length === 1) finishAnswer(solo[0], channelId);
}

// ---------- Floating overlay state (native bootstrap writes chatauto-state.json) ----------

let overlayEnabled = true;
async function refreshOverlayState() {
    const txt = await ipcRead("chatauto-state.json");
    if (!txt) return;
    try {
        const s = JSON.parse(txt);
        if (s && typeof s.enabled === "boolean") overlayEnabled = s.enabled;
    } catch (_) {}
}

let overlayTimer = null;

// ---------- Plugin ----------

const plugin = definePlugin({
    manifest: {
        id: "chatauto",
        version: "1.0.0",
        type: "plugin",
        spec: 3,
        main: "",
        display: {
            name: "Chat Auto",
            description: "Auto-answers the Arabic word games in a chosen channel",
            authors: [{ name: "owner" }],
        },
    },
    start() {
        api.storage.awaitStorage(storage).then(() => {
            if (!storage.cfg) storage.cfg = { servers: {}, channelModes: {} };
            if (!storage.cfg.servers) storage.cfg.servers = {};
            if (!storage.cfg.channelModes) storage.cfg.channelModes = {};
            if (!storage.ocrKeys) storage.ocrKeys = DEFAULT_OCR_KEYS;
        }).catch(() => {});

        flux.intercept(payload => {
            try {
                if (payload.type !== "MESSAGE_CREATE") return undefined;
                const msg = payload.message || payload;
                const channelId = msg.channel_id || msg.channelId || payload.channelId;
                if (!channelId) return undefined;
                const hit = channelCfg(channelId);
                if (!hit || !hit.cfg.enabled || !hit.cfg.botId || !overlayEnabled) return undefined;
                const authorId = msg.author && msg.author.id;
                if (!authorId || authorId !== hit.cfg.botId) return undefined;
                if (!markSeen(String(msg.id))) return undefined;
                const attachments = msg.attachments || [];
                const img = attachments.find(a =>
                    (a.content_type || "").indexOf("image/") === 0 ||
                    /\.(png|jpe?g|webp|gif)(\?|$)/i.test(a.filename || a.url || "") ||
                    (a.width && a.height));
                if (!img) return undefined;
                const url = img.proxy_url || img.url;
                if (!url) return undefined;
                void processImage(channelId, url, hit.cfg.speed === "insane");
            } catch (_) { /* never break dispatch */ }
            return undefined;
        });

        void refreshOverlayState();
        overlayTimer = setInterval(() => { void refreshOverlayState(); }, 2000);
        // The native bootstrap shows the floating button by itself once the
        // window server is ready; nothing to request from JS.
        void ipcRequest("hello", {}, 1500);
    },
    stop() {
        if (overlayTimer) { clearInterval(overlayTimer); overlayTimer = null; }
    },
    SettingsComponent() { return ChatAutoSettings(); }
});

// ---------- Settings UI (English, createElement — no JSX in userplugins) ----------

function normList(v) {
    if (!v) return [];
    let arr;
    if (Array.isArray(v)) arr = v;
    else if (typeof v.toArray === "function") arr = v.toArray();
    else if (v._array) arr = v._array;
    else if (typeof v === "object") arr = Object.values(v);
    else return [];
    if (arr.length && Array.isArray(arr[0]) && arr[0].length === 2 && arr[0][1] && typeof arr[0][1] === "object") {
        arr = arr.map(pair => pair[1]);
    }
    return arr;
}

function guilds() {
    try {
        const store = findByStoreName("GuildStore");
        const raw = store && store.getGuilds ? store.getGuilds() : null;
        return normList(raw)
            .map(g => g && g.toJS ? g.toJS() : g)
            .filter(g => g && g.id && !g.unavailable)
            .sort((a, b) => (b.approximateMemberCount || b.memberCount || 0) - (a.approximateMemberCount || a.memberCount || 0));
    } catch (_) { return []; }
}

function textChannels(guildId) {
    try {
        const store = findByStoreName("ChannelStore");
        const raw = store && (store.getChannels ? store.getChannels(guildId) : null)
            || (store && store.getMutableGuildChannelsForGuild ? store.getMutableGuildChannelsForGuild(guildId) : null);
        return normList(raw)
            .map(c => c && c.toJS ? c.toJS() : c)
            .filter(c => c && c.id && (c.type === 0 || c.type === 5))
            .sort((a, b) => (a.position || 0) - (b.position || 0));
    } catch (_) { return []; }
}

function botMembers(guildId) {
    try {
        const store = findByStoreName("GuildMemberStore");
        const raw = store && store.getMembers ? store.getMembers(guildId) : null;
        return normList(raw)
            .map(m => m && m.toJS ? m.toJS() : m)
            .filter(m => m && m.user && m.user.bot === true && m.user.id)
            .map(m => m.user);
    } catch (_) { return []; }
}

const { Stack, TableRowGroup, TableRow, TableSwitchRow, TableRadioGroup, TableRadioRow, Text, TextInput, Card } = components;
const { View } = ReactNative;

function ChatAutoSettings() {
    const [, setTick] = React.useState(0);
    const [guildId, setGuildId] = React.useState("");
    const [showGuilds, setShowGuilds] = React.useState(true);
    const [showChannels, setShowChannels] = React.useState(false);
    const [showBots, setShowBots] = React.useState(false);

    React.useEffect(() => {
        const t = setInterval(() => setTick(v => v + 1), 2500);
        return () => clearInterval(t);
    }, []);

    const cfg = storage.cfg || { servers: {}, channelModes: {} };
    if (!cfg.servers) cfg.servers = {};
    const srv = guildId ? (cfg.servers[guildId] || {}) : {};
    const save = next => { storage.cfg = next; setTick(v => v + 1); };
    const patchSrv = p => {
        const servers = Object.assign({}, cfg.servers);
        servers[guildId] = Object.assign({}, servers[guildId], p);
        save(Object.assign({}, cfg, { servers }));
        // Keep the floating button in sync: turning the feature on here also
        // flips the native overlay switch (no-op on stock IPAs). Turning it
        // off stays per-server — the floating button is the global switch.
        if (p.enabled === true) void ipcRequest("setEnabled", { enabled: true }, 3000);
    };

    const guildList = guilds();
    const channelList = guildId ? textChannels(guildId) : [];
    const botList = guildId ? botMembers(guildId) : [];
    const selGuild = guildList.find(g => g.id === guildId);
    const selChannel = channelList.find(c => c.id === srv.channelId);
    const selBot = botList.find(b => b.id === srv.botId);

    const pad = { padding: 16 };

    if (!guildId || showGuilds) {
        return e(View, { style: pad },
            e(Stack, { spacing: 12 },
                e(Text, { variant: "text-md/semibold" }, "Chat Auto"),
                e(Text, { variant: "text-xs/medium", color: "text-muted" }, "Pick a server to configure auto-answering for the word games."),
                e(RN.ScrollView, { style: { maxHeight: 420 } },
                    e(Stack, { spacing: 8 },
                        guildList.length === 0 ? e(Text, { variant: "text-sm/medium", color: "text-muted" }, "No servers found.") : null,
                        ...guildList.map(g => e(RN.Pressable, { key: g.id, onPress: () => { setGuildId(g.id); setShowGuilds(false); setShowChannels(false); setShowBots(false); } },
                            e(Card, { style: { padding: 12 } },
                                e(Text, { variant: "text-sm/semibold" }, g.name || "Unknown Server"),
                                e(Text, { variant: "text-xs/medium", color: "text-muted" },
                                    String((g.approximateMemberCount || g.memberCount || 0)) + " members" + (cfg.servers[g.id] && cfg.servers[g.id].enabled ? "  •  ON" : ""))
                            )
                        ))
                    )
                )
            )
        );
    }

    return e(View, { style: pad },
        e(Stack, { spacing: 12 },
            e(RN.Pressable, { onPress: () => setShowGuilds(true) },
                e(Text, { variant: "text-sm/medium", color: "text-normal" }, "← Servers")
            ),
            e(Text, { variant: "text-md/semibold" }, selGuild ? selGuild.name : "Server"),

            e(TableRowGroup, { title: "Chat Channel" },
                e(TableRow, {
                    label: "Channel",
                    subLabel: selChannel ? "#" + selChannel.name : "Not set",
                    onPress: () => { setShowChannels(v => !v); setShowBots(false); }
                })
            ),
            showChannels ? e(RN.ScrollView, { style: { maxHeight: 240 } },
                e(Stack, { spacing: 6 },
                    ...channelList.map(c => e(RN.Pressable, { key: c.id, onPress: () => { patchSrv({ channelId: c.id }); setShowChannels(false); } },
                        e(Text, { variant: "text-sm/medium", color: srv.channelId === c.id ? "text-brand" : "text-normal" }, "#" + c.name)
                    )),
                    channelList.length === 0 ? e(Text, { variant: "text-xs/medium", color: "text-muted" }, "No text channels found.") : null
                )
            ) : null,

            e(TableRowGroup, { title: "Games Bot" },
                e(TableRow, {
                    label: "Bot",
                    subLabel: selBot ? "@" + (selBot.username || selBot.globalName || selBot.id) : (srv.botId || "Not set"),
                    onPress: () => { setShowBots(v => !v); setShowChannels(false); }
                })
            ),
            showBots ? e(RN.ScrollView, { style: { maxHeight: 240 } },
                e(Stack, { spacing: 6 },
                    ...botList.map(b => e(RN.Pressable, { key: b.id, onPress: () => { patchSrv({ botId: b.id }); setShowBots(false); } },
                        e(Text, { variant: "text-sm/medium", color: srv.botId === b.id ? "text-brand" : "text-normal" }, "@" + (b.username || b.globalName || b.id))
                    )),
                    botList.length === 0 ? e(Text, { variant: "text-xs/medium", color: "text-muted" }, "No bots found in the member list.") : null
                )
            ) : null,
            e(TextInput, { size: "md", label: "Or paste Bot ID", value: srv.botId || "", placeholder: "1234567890123456789",
                onChange: v => patchSrv({ botId: String(typeof v === "string" ? v : (v && v.nativeEvent && v.nativeEvent.text) || "").trim() }) }),

            e(TableRowGroup, { title: "Auto Answer" },
                e(TableSwitchRow, {
                    label: "Enabled",
                    subLabel: (srv.channelId && srv.botId) ? "Watches the channel and answers word games" : "Set channel and bot first",
                    value: !!(srv.enabled && srv.channelId && srv.botId),
                    onValueChange: v => patchSrv({ enabled: v })
                })
            ),

            e(Text, { variant: "text-sm/semibold" }, "Speed"),
            e(TableRadioGroup, {
                title: "Answer Speed",
                value: srv.speed === "insane" ? "insane" : "normal",
                onChange: v => patchSrv({ speed: v === "insane" ? "insane" : "normal" })
            },
                e(TableRadioRow, { label: "Normal", subLabel: "Verified answers", value: "normal" }),
                e(TableRadioRow, { label: "Insane", subLabel: "Fastest possible reply", value: "insane" })
            ),

            e(Card, { style: { padding: 12 } },
                e(Text, { variant: "text-xs/medium", color: "text-muted" },
                    "If a floating button is available it toggles answering on/off and stays hidden from screenshots.")
            ),

            e(TextInput, { size: "md", label: "OCR API Keys", value: storage.ocrKeys || "", placeholder: "key1,key2,...",
                onChange: v => { storage.ocrKeys = String(typeof v === "string" ? v : (v && v.nativeEvent && v.nativeEvent.text) || ""); setTick(x => x + 1); } })
        )
    );
}
