/*
 * CloudCord
 * Copyright (c) 2026 xohus and CloudCord
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Plugins and Themes pages laid out like BetterDiscord's addon list (title and count with search,
 * then a controls row, then the cards). Written for CloudCord.
 */

import "./store.css";
import "../../CloudCordAddonCards.css";

import { isPluginEnabled, plugins } from "@api/PluginManager";
import { Settings, useSettings } from "@api/Settings";
import { FolderIcon, SearchIcon } from "@components/Icons";
import { AddonCard } from "@components/settings/AddonCard";
import { openSettingsTabModal } from "@components/settings/tabs/BaseTab";
import { getThemeInfo, stripBOM, type UserThemeHeader } from "@utils/themes/bd";
import type { CxAddonKind, CxAddonRow } from "@sincordplugins/cxExtensions";
import { SettingsTab } from "@components/settings/tabs/BaseTab";
import { classNameFactory } from "@utils/css";
import { promptToRestart } from "@utils/promptToRestart";
import type { PluginNative } from "@utils/types";
import { showToast, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { PluginCard } from "../plugins/PluginCard";
import ThemesTab from "../../../ThemeSettings/ThemesTab";

const cl = classNameFactory("cc-store-");
const cxAddons = () => require("@sincordplugins/cxExtensions") as typeof import("@sincordplugins/cxExtensions");

function reviewAddon(kind: CxAddonKind, entry?: CxAddonRow) {
    const { CxSettings } = cxAddons();
    const Review = () => <CxSettings kind={kind} entry={entry} />;
    Review.displayName = entry?.name ?? `Import ${kind}`;
    openSettingsTabModal(Review);
}

function toggleCxAddon(kind: CxAddonKind, entry: CxAddonRow, on: boolean) {
    if (on) return reviewAddon(kind, entry);
    void cxAddons().disableCxAddon(entry.id).catch(error => showToast({
        text: error instanceof Error ? error.message : String(error), variant: "critical",
    }));
}

type Sort = "name" | "enabled";

const ListIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /></svg>
);
const GridIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>
);
const OffIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
);

export function AddonHeader({ title, count, query, setQuery }: { title: string; count: number; query: string; setQuery(q: string): void; }) {
    return (
        <div className={cl("header")}>
            <h2 className={cl("title")}>{title}<span className={cl("count")}>{count}</span></h2>
            <label className={cl("search")}>
                <SearchIcon width={16} height={16} />
                <input value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder={`Search ${count} ${title.toLowerCase()}...`} />
            </label>
        </div>
    );
}

/** The plugins people can turn on and off; shared by Home and the Plugins page so the counts match. */
export const listablePlugins = () =>
    Object.values(plugins).filter(p => !p.hidden && !p.required && !(p.name.endsWith("API") && !p.settings?.def));

export function useAddonCounts() {
    const settings = useSettings(["enabledThemes", "enabledThemeLinks", "plugins.*"]);
    const pluginRows = cxAddons().useCxAddonRows("plugin", "");
    const themeRows = cxAddons().useCxAddonRows("theme", "");
    const catalogNames = new Map(pluginRows.map(row => [row.name.toLowerCase(), row.active]));
    for (const plugin of listablePlugins()) {
        const name = plugin.name.toLowerCase();
        catalogNames.set(name, Boolean(catalogNames.get(name) || isPluginEnabled(plugin.name)));
    }
    return {
        plugins: catalogNames.size,
        activePlugins: [...catalogNames.values()].filter(Boolean).length,
        activeThemes: (settings.enabledThemes?.length ?? 0) + (settings.enabledThemeLinks?.length ?? 0) + themeRows.filter(row => row.active).length,
    };
}

function EnabledOnly({ value, onChange }: { value: boolean; onChange(enabled: boolean): void; }) {
    return <button type="button" className={cl("mode", { "mode-on": value })} aria-pressed={value}
        onClick={() => onChange(!value)}>Enabled only</button>;
}

// Render cards in pages as you scroll, so opening Plugins stays fast.
const PAGE = 48;

function LoadMore({ onVisible }: { onVisible(): void; }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const io = new IntersectionObserver(e => { if (e[0].isIntersecting) onVisible(); }, { rootMargin: "600px" });
        if (ref.current) io.observe(ref.current);
        return () => io.disconnect();
    });
    return <div ref={ref} className={cl("more")} />;
}

export function PluginsPage() {
    useSettings(["plugins.*"]);
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<Sort>("name");
    const [grid, setGrid] = useState(false);
    const [enabledOnly, setEnabledOnly] = useState(false);
    const [, force] = useState(0);
    const [limit, setLimit] = useState(PAGE);
    useEffect(() => setLimit(PAGE), [query, sort, enabledOnly]);

    const visible = useMemo(listablePlugins, []);
    const cxRows = cxAddons().useCxAddonRows("plugin", query);
    const allCxRows = cxAddons().useCxAddonRows("plugin", "");
    const cxByName = new Map(allCxRows.map(entry => [entry.name.toLowerCase(), entry]));
    const nativeByName = new Map(visible.map(plugin => [plugin.name.toLowerCase(), plugin]));

    const q = query.trim().toLowerCase();
    const shownNative = visible.filter(p => (!cxByName.get(p.name.toLowerCase())?.active || isPluginEnabled(p.name))
        && (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags?.some(t => t.toLowerCase().includes(q))));
    const shownNames = new Set(shownNative.map(plugin => plugin.name.toLowerCase()));
    const shown = [
        ...shownNative.map(plugin => ({ name: plugin.name, active: isPluginEnabled(plugin.name), plugin, extension: undefined })),
        ...cxRows.filter(entry => {
            const name = entry.name.toLowerCase();
            const native = nativeByName.get(name);
            return entry.active || (!shownNames.has(name) && (!native || !isPluginEnabled(native.name)));
        }).map(extension => ({ name: extension.name, active: extension.active, plugin: undefined, extension })),
    ].filter(row => !enabledOnly || row.active)
        .sort((a, b) => (sort === "enabled" ? Number(b.active) - Number(a.active) : 0) || a.name.localeCompare(b.name));

    const onRestartNeeded = () => promptToRestart("reload", { subtitle: "Reload Discord to finish turning this plugin on or off." });

    const disableAll = () => {
        let changed = false;
        for (const p of visible) if (Settings.plugins[p.name]?.enabled) { Settings.plugins[p.name].enabled = false; changed = true; }
        for (const entry of allCxRows) if (entry.active) toggleCxAddon("plugin", entry, false);
        force(n => n + 1);
        if (changed) promptToRestart("reload", { subtitle: "Reload Discord to turn all plugins off." });
    };

    return (
        <SettingsTab>
            <AddonHeader title="Plugins" count={shown.length} query={query} setQuery={setQuery} />
            <div className={cl("controls")}>
                <div className={cl("basic")}>
                    {!IS_WEB && (
                        <button className={cl("icon-btn")} title="Open settings folder" onClick={() => VencordNative.settings.openFolder()}><FolderIcon width={20} height={20} /></button>
                    )}
                    <button className={cl("icon-btn")} title="Disable all" onClick={disableAll}><OffIcon /></button>
                    <button className={cl("mode")} onClick={() => reviewAddon("plugin")}>Import plugin</button>
                </div>
                <div className={cl("advanced")}>
                    <EnabledOnly value={enabledOnly} onChange={setEnabledOnly} />
                    <label className={cl("select")}>
                        Sort by:
                        <select value={sort} onChange={e => setSort(e.currentTarget.value as Sort)}>
                            <option value="name">Name</option>
                            <option value="enabled">Enabled first</option>
                        </select>
                    </label>
                    <div className={cl("views")}>
                        <button className={cl("view", { "view-on": !grid })} title="List view" onClick={() => setGrid(false)}><ListIcon /></button>
                        <button className={cl("view", { "view-on": grid })} title="Grid view" onClick={() => setGrid(true)}><GridIcon /></button>
                    </div>
                </div>
            </div>

            {shown.length === 0
                ? <div className={cl("empty")}>{enabledOnly && !q ? "No plugins are enabled." : `No plugins match “${query}”.`}</div>
                : (
                    <div className={cl("list", { grid })}>
                        {shown.slice(0, limit).map(({ plugin, extension }) => {
                            if (plugin) {
                                const alternate = cxByName.get(plugin.name.toLowerCase());
                                return <PluginCard key={plugin.name} plugin={plugin} disabled={false} onRestartNeeded={onRestartNeeded}
                                    footer={alternate && !alternate.active && !isPluginEnabled(plugin.name)
                                        && <button className={cl("mode")} onClick={() => reviewAddon("plugin", alternate)}>Catalog version</button>} />;
                            }
                            return <AddonCard key={extension.id} name={extension.name} description={extension.description}
                                enabled={extension.active} setEnabled={on => toggleCxAddon("plugin", extension, on)}
                                infoButton={extension.active && <button className={cl("mode")} onClick={() => reviewAddon("plugin", extension)}>Options</button>} />;
                        })}
                    </div>
                )}
            {shown.length > limit && <LoadMore onVisible={() => setLimit(l => l + PAGE)} />}
        </SettingsTab>
    );
}

const RefreshIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
);
const LinkIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
);

interface StoreTheme {
    id: number;
    name: string;
    description: string;
    version: string;
    author: { display_name: string; };
    downloads: number;
    likes: string;
    tags: string[];
    file_name: string;
    thumbnail_url: string | null;
    latest_source_url: string;
}

const Native = VencordNative.pluginHelpers.CloudCordStore as PluginNative<typeof import("../../../../cloudcordplugins/cloudcordStore/native")>;

let storeCache: StoreTheme[] | null = null;
async function fetchStore() {
    if (storeCache) return storeCache;
    return storeCache = JSON.parse(await Native.fetchThemeStore()) as StoreTheme[];
}

const linkName = (url: string) => decodeURIComponent(url.split("/").pop() ?? url).replace(/\.theme\.css$|\.css$/i, "");

/**
 * Most BetterDiscord themes @import their real stylesheet (plus images and fonts) from the
 * author's site, which Discord's CSP blocks. Ask the user to allow those sites, once per site,
 * using the existing CSP prompt. The change applies after Discord restarts.
 */
async function allowThemeSources(fileName: string) {
    const css = await VencordNative.themes.getThemeData(fileName);
    if (!css) return;
    const origins = new Set<string>();
    for (const m of css.matchAll(/(?:@import\s+(?:url\()?|url\()\s*["']?(https:\/\/[^"')\s;]+)/gi)) {
        try { origins.add(new URL(m[1]).origin); } catch { }
    }
    const directives = ["style-src", "img-src", "font-src"];
    const needed: string[] = [];
    for (const origin of origins) {
        if (!await VencordNative.csp.isDomainAllowed(origin, directives)) needed.push(origin);
    }
    if (!needed.length) return;
    let ok = false;
    for (const origin of needed) {
        if (await VencordNative.csp.requestAddOverride(origin, directives, "Themes") === "ok") ok = true;
    }
    if (ok) {
        showToast({ text: "Restart Discord to finish loading this theme", variant: "success" } as any);
    }
}

interface Row {
    key: string;
    name: string;
    author?: string;
    description?: string;
    version?: string;
    on: boolean;
    set(on: boolean): void;
    remove?(): void;
    options?(): void;
}

export function ThemesPage() {
    const settings = useSettings(["enabledThemes", "themeLinks", "enabledThemeLinks"]);
    const [mode, setMode] = useState<"installed" | "browse">("installed");
    const [themes, setThemes] = useState<UserThemeHeader[] | null>(null);
    const [store, setStore] = useState<StoreTheme[] | null>(storeCache);
    const [storeError, setStoreError] = useState("");
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<Sort>("name");
    const [grid, setGrid] = useState(false);
    const [enabledOnly, setEnabledOnly] = useState(false);
    const [limit, setLimit] = useState(PAGE);
    const cxRows = cxAddons().useCxAddonRows("theme", query);
    useEffect(() => setLimit(PAGE), [query, sort, enabledOnly]);

    const refresh = () => VencordNative.themes.getThemesList().then(list => setThemes(list.map(t => getThemeInfo(stripBOM(t.content), t.fileName))));
    useEffect(() => { refresh(); fetchStore().then(setStore, () => { }); }, []);
    useEffect(() => {
        if (mode === "browse" && !store) fetchStore().then(setStore, e => setStoreError(String(e?.message ?? e)));
    }, [mode]);

    const isOn = (f: string) => settings.enabledThemes.includes(f);
    const setOn = (f: string, on: boolean) => {
        settings.enabledThemes = on ? [...new Set([...settings.enabledThemes, f])] : settings.enabledThemes.filter(x => x !== f);
        if (on) void allowThemeSources(f);
    };
    const linkOn = (url: string) => settings.enabledThemeLinks.includes(url);
    const setLinkOn = (url: string, on: boolean) => {
        settings.enabledThemeLinks = on ? [...new Set([...settings.enabledThemeLinks, url])] : settings.enabledThemeLinks.filter(x => x !== url);
    };
    const [busy, setBusy] = useState<string | null>(null);
    const installedFiles = new Set((themes ?? []).map(t => t.fileName));
    const install = async (t: StoreTheme) => {
        setBusy(t.file_name);
        try {
            await Native.installTheme(t.latest_source_url, t.file_name);
            await refresh();
            setOn(t.file_name, true);
        } catch (e) {
            showToast({ text: "Couldn't install " + t.name, variant: "critical" } as any);
        } finally { setBusy(null); }
    };
    const uninstall = async (fileName: string) => {
        setOn(fileName, false);
        await Native.uninstallTheme(fileName);
        await refresh();
    };
    const removeLink = (url: string) => {
        settings.themeLinks = settings.themeLinks.filter(x => x !== url);
        setLinkOn(url, false);
    };

    const q = query.trim().toLowerCase();
    const match = (...v: (string | undefined)[]) => !q || v.some(x => x?.toLowerCase().includes(q));
    const byFile = new Map((store ?? []).map(t => [t.file_name, t]));

    const installed: Row[] = [
        ...(themes ?? []).map(t => ({
            key: t.fileName, name: t.name, author: t.author, description: t.description, version: t.version,
            on: isOn(t.fileName), set: (on: boolean) => setOn(t.fileName, on),
            remove: byFile.has(t.fileName) ? () => uninstall(t.fileName) : undefined
        })),
        ...settings.themeLinks.map(url => ({
            key: url, name: linkName(url), author: undefined, version: undefined, description: url,
            on: linkOn(url), set: (on: boolean) => setLinkOn(url, on), remove: () => removeLink(url)
        })),
    ].filter(r => match(r.name, r.author, r.description));
    installed.push(...cxRows.map(entry => ({
        key: "cx:" + entry.name, name: entry.name, description: entry.description, on: entry.active,
        set: on => toggleCxAddon("theme", entry, on), options: entry.active ? () => reviewAddon("theme", entry) : undefined,
    })));
    const visibleInstalled = enabledOnly ? installed.filter(row => row.on) : installed;
    visibleInstalled
        .sort((a, b) => sort === "enabled" ? Number(b.on) - Number(a.on) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));

    const browse = (store ?? [])
        .filter(t => match(t.name, t.author.display_name, t.description, ...t.tags))
        .sort((a, b) => sort === "enabled" ? b.downloads - a.downloads : a.name.localeCompare(b.name));

    const count = mode === "installed" ? visibleInstalled.length : browse.length;

    return (
        <SettingsTab>
            <AddonHeader title="Themes" count={count} query={query} setQuery={setQuery} />
            <div className={cl("controls")}>
                <div className={cl("basic")}>
                    <div className={cl("modes")}>
                        <button className={cl("mode", { "mode-on": mode === "installed" })} onClick={() => setMode("installed")}>Installed</button>
                        <button className={cl("mode", { "mode-on": mode === "browse" })} onClick={() => setMode("browse")}>Browse</button>
                    </div>
                    {!IS_WEB && (
                        <button className={cl("icon-btn")} title="Open themes folder" onClick={() => VencordNative.themes.openFolder()}><FolderIcon width={20} height={20} /></button>
                    )}
                    <button className={cl("icon-btn")} title="Reload themes" onClick={refresh}><RefreshIcon /></button>
                    <button className={cl("icon-btn")} title="Theme links and advanced options" onClick={() => openSettingsTabModal(ThemesTab)}><LinkIcon /></button>
                    <button className={cl("mode")} onClick={() => reviewAddon("theme")}>Import theme</button>
                </div>
                <div className={cl("advanced")}>
                    {mode === "installed" && <EnabledOnly value={enabledOnly} onChange={setEnabledOnly} />}
                    <label className={cl("select")}>
                        Sort by:
                        <select value={sort} onChange={e => setSort(e.currentTarget.value as Sort)}>
                            <option value="name">Name</option>
                            <option value="enabled">{mode === "browse" ? "Most downloaded" : "Enabled first"}</option>
                        </select>
                    </label>
                    <div className={cl("views")}>
                        <button className={cl("view", { "view-on": !grid })} title="List view" onClick={() => setGrid(false)}><ListIcon /></button>
                        <button className={cl("view", { "view-on": grid })} title="Grid view" onClick={() => setGrid(true)}><GridIcon /></button>
                    </div>
                </div>
            </div>

            {mode === "installed" && (visibleInstalled.length === 0
                ? (
                    <div className={cl("empty")}>
                        {q
                            ? <>No themes match “{query}”.</>
                            : enabledOnly ? "No themes are enabled." : <>No themes yet. Open <b>Browse</b> to install one, or put <code>.theme.css</code> files in your themes folder.</>}
                    </div>
                )
                : (
                    <div className={cl("list", { grid })}>
                        {visibleInstalled.slice(0, limit).map(r => (
                            <AddonCard
                                key={r.key}
                                name={r.name}
                                author={r.author}
                                description={r.description}
                                enabled={r.on}
                                setEnabled={r.set}
                                infoButton={r.options && <button className={cl("mode")} onClick={r.options}>Options</button>}
                                footer={(r.version || r.remove) && (
                                    <div className={cl("card-foot")}>
                                        <span className={cl("version")}>{r.version ? "v" + r.version : ""}</span>
                                        {r.remove && <button className={cl("remove")} onClick={r.remove}>Remove</button>}
                                    </div>
                                )}
                            />
                        ))}
                    </div>
                ))}
            {mode === "installed" && visibleInstalled.length > limit && <LoadMore onVisible={() => setLimit(l => l + PAGE)} />}

            {mode === "browse" && (storeError
                ? <div className={cl("empty")}>Couldn't load the theme store: {storeError}</div>
                : !store
                    ? <div className={cl("empty")}>Loading themes…</div>
                    : (
                        <div className={cl("store", { "store-list": !grid })}>
                            {browse.map(t => {
                                const have = installedFiles.has(t.file_name);
                                return (
                                    <div key={t.id} className={cl("store-card")}>
                                        <div className={cl("thumb")}>
                                            {t.thumbnail_url && <img src={"https://betterdiscord.app" + t.thumbnail_url} alt="" loading="lazy" />}
                                        </div>
                                        <div className={cl("store-body")}>
                                            <div className={cl("store-name")}>{t.name}<span className={cl("version")}>v{t.version}</span></div>
                                            <div className={cl("store-author")}>by {t.author.display_name}</div>
                                            <div className={cl("store-desc")}>{t.description}</div>
                                            <div className={cl("store-foot")}>
                                                <span className={cl("store-stats")}>{t.downloads.toLocaleString()} downloads · {t.likes} likes</span>
                                                <button
                                                    className={cl("install", { installed: have })}
                                                    disabled={busy === t.file_name}
                                                    onClick={() => have ? uninstall(t.file_name) : install(t)}
                                                >
                                                    {busy === t.file_name ? "Installing…" : have ? "Remove" : "Install"}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
        </SettingsTab>
    );
}
