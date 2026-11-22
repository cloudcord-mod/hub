/*
 * CloudCord
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Add-ons > Discover themes: one list of community themes, a color preview for each,
 * and one tap to install and use. Works with Vendetta / Bunny / Kettu / Raincord themes.
 */

import { getCurrentTheme, installTheme, removeTheme, selectTheme, themes } from "@lib/addons/themes";
import { findAssetId } from "@lib/api/assets";
import safeFetch from "@lib/utils/safeFetch";
import { React } from "@metro/common";
import { Button, Card, FlashList, Stack, Text } from "@metro/common/components";
import Search from "@ui/components/Search";
import { showToast } from "@ui/toasts";
import { View } from "react-native";

const CLOUDCORD_INDEX = "https://raw.githubusercontent.com/cloudcord-mod/hub/main/themes/mobile/index.json";
const MARKETPLACE = "https://raw.githubusercontent.com/kmmiio99o/theme-marketplace/refs/heads/main/themes.json";

interface StoreTheme {
    url: string;
    name: string;
    description: string;
    authors: string[];
    source: string;
    hasBackground?: boolean;
    preview?: { background: string; surface: string; accent: string; text: string; };
}

function asTheme(entry: Record<string, unknown> | null, marketplace: boolean): StoreTheme | null {
    const url = marketplace ? entry?.installUrl : entry?.id;
    if (!entry || typeof url !== "string" || !/^https:\/\//i.test(url) || typeof entry.name !== "string" || !entry.name.trim()) return null;
    const colors = entry.preview as StoreTheme["preview"];
    const validPreview = colors && [colors.background, colors.surface, colors.accent, colors.text]
        .every(color => typeof color === "string" && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color));
    return {
        url,
        name: entry.name,
        description: typeof entry.description === "string" ? entry.description : "",
        authors: Array.isArray(entry.authors) ? entry.authors.filter(author => typeof author === "string") : [],
        source: marketplace ? "Marketplace" : typeof entry.source === "string" ? entry.source : "CloudCord",
        hasBackground: entry.hasBackground === true,
        preview: validPreview ? colors : undefined,
    };
}

async function loadThemes(): Promise<StoreTheme[]> {
    const [index, market] = await Promise.allSettled([
        safeFetch(CLOUDCORD_INDEX, { cache: "no-store" }).then(r => r.json()),
        safeFetch(MARKETPLACE, { cache: "no-store" }).then(r => r.json()),
    ]);

    const list: StoreTheme[] = [];
    if (index.status === "fulfilled" && Array.isArray(index.value?.themes)) {
        for (const t of index.value.themes) {
            const theme = asTheme(t, false);
            if (theme) list.push(theme);
        }
    }
    if (market.status === "fulfilled" && Array.isArray(market.value)) {
        for (const t of market.value) {
            const theme = asTheme(t, true);
            if (theme) list.push(theme);
        }
    }
    if (!list.length) throw new Error("Couldn't load the theme store. Check your connection and try again.");

    // Same theme listed twice: keep the first.
    const seen = new Set<string>();
    return list.filter(t => !seen.has(t.url) && seen.add(t.url));
}

function Swatches({ preview }: { preview?: StoreTheme["preview"]; }) {
    if (!preview) return null;
    const colors = [preview.background, preview.surface, preview.accent, preview.text];
    return (
        <View style={{ flexDirection: "row", gap: 6 }}>
            {colors.map((c, i) => <View key={i} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" }} />)}
        </View>
    );
}

type ThemeAction = "use" | "reset" | "remove";
type ThemeChange = { url: string; action: ThemeAction; };

function ThemeRow({ theme, busy, change }: {
    theme: StoreTheme;
    busy: ThemeChange | null;
    change(theme: StoreTheme, action: ThemeAction): void;
}) {
    const installed = Boolean(themes[theme.url]);
    const active = getCurrentTheme()?.id === theme.url;

    const currentAction = busy?.url === theme.url ? busy.action : undefined;

    return (
        <Card style={{ borderRadius: 22 }}>
            <Stack spacing={8}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                        <Text variant="heading-md/semibold" numberOfLines={1}>{theme.name}</Text>
                        <Text variant="text-sm/medium" color="text-muted" numberOfLines={1}>
                            {theme.authors.length ? `by ${theme.authors.join(", ")}` : theme.source}
                            {theme.hasBackground ? " · background" : ""}
                            {active ? " · in use" : installed ? " · installed" : ""}
                        </Text>
                    </View>
                    <Swatches preview={theme.preview} />
                </View>
                {!!theme.description && <Text variant="text-sm/normal" numberOfLines={2}>{theme.description}</Text>}
                <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                        <Button
                            size="md"
                            variant={active ? "secondary" : "primary"}
                            text={currentAction === "use" || currentAction === "reset" ? "Applying…" : active ? "Use default" : installed ? "Use" : "Install and use"}
                            disabled={busy !== null}
                            onPress={() => change(theme, active ? "reset" : "use")}
                        />
                    </View>
                    {installed && (
                        <View style={{ flex: 1 }}>
                            <Button size="md" variant="destructive" text={currentAction === "remove" ? "Removing…" : "Remove"} disabled={busy !== null} onPress={() => change(theme, "remove")} />
                        </View>
                    )}
                </View>
            </Stack>
        </Card>
    );
}

export default function ThemeStore() {
    const [list, setList] = React.useState<StoreTheme[] | null>(null);
    const [error, setError] = React.useState("");
    const [query, setQuery] = React.useState("");
    const [attempt, setAttempt] = React.useState(0);
    const [installedOnly, setInstalledOnly] = React.useState(false);
    const [backgroundOnly, setBackgroundOnly] = React.useState(false);
    const [alphabetical, setAlphabetical] = React.useState(false);
    const [busy, setBusy] = React.useState<ThemeChange | null>(null);
    const changingTheme = React.useRef(false);

    React.useEffect(() => {
        let current = true;
        void loadThemes().then(
            entries => { if (current) setList(entries); },
            error => { if (current) setError(error instanceof Error ? error.message : String(error)); },
        );
        return () => { current = false; };
    }, [attempt]);

    async function change(theme: StoreTheme, action: ThemeAction) {
        if (changingTheme.current) return;
        changingTheme.current = true;
        setBusy({ url: theme.url, action });
        try {
            if (action === "remove") {
                if (!themes[theme.url]) return;
                await removeTheme(theme.url);
            } else if (action === "reset") {
                if (getCurrentTheme()?.id !== theme.url) return;
                await selectTheme(null);
            } else {
                if (!themes[theme.url]) await installTheme(theme.url);
                await selectTheme(themes[theme.url]);
            }
            const message = action === "remove" ? `Removed ${theme.name}` : action === "reset" ? "Restored the default theme" : `Now using ${theme.name}`;
            showToast(message, findAssetId("CheckIcon"));
        } catch (e) {
            showToast(e instanceof Error ? e.message : String(e), findAssetId("CircleXIcon-primary"));
        } finally {
            changingTheme.current = false;
            setBusy(null);
        }
    }

    const q = query.trim().toLowerCase();
    const shown = (list ?? []).filter(t => (!installedOnly || Boolean(themes[t.url])) && (!backgroundOnly || t.hasBackground)
        && (!q || [t.name, t.description, t.source, ...t.authors].some(value => value.toLowerCase().includes(q))));
    if (alphabetical) shown.sort((a, b) => a.name.localeCompare(b.name));

    return (
        <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 }}>
                <Search placeholder="Search themes or authors" onChangeText={setQuery} />
                {!!list && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    <Button size="sm" variant={installedOnly ? "primary" : "secondary"} text="Installed only" onPress={() => setInstalledOnly(value => !value)} />
                    <Button size="sm" variant={backgroundOnly ? "primary" : "secondary"} text="With backgrounds" onPress={() => setBackgroundOnly(value => !value)} />
                    <Button size="sm" variant={alphabetical ? "primary" : "secondary"} text="Sort A–Z" onPress={() => setAlphabetical(value => !value)} />
                </View>}
            </View>
            {error
                ? <View style={{ alignItems: "center", gap: 8, padding: 24 }}>
                    <Text variant="text-md/medium" color="text-muted" style={{ textAlign: "center" }}>{error}</Text>
                    <Button size="md" variant="secondary" text="Try again" onPress={() => { setError(""); setAttempt(value => value + 1); }} />
                </View>
                : !list
                    ? <Text variant="text-md/medium" color="text-muted" style={{ textAlign: "center", padding: 24 }}>Loading themes…</Text>
                    : (
                        <FlashList
                            data={shown}
                            extraData={busy}
                            estimatedItemSize={150}
                            keyExtractor={(t: StoreTheme) => t.url}
                            contentContainerStyle={{ padding: 12, paddingBottom: 48 }}
                            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                            ListEmptyComponent={<Text variant="text-md/medium" color="text-muted" style={{ textAlign: "center", padding: 24 }}>{q || installedOnly || backgroundOnly ? "No themes match these filters." : "No themes available."}</Text>}
                            renderItem={({ item }: { item: StoreTheme; }) => <ThemeRow theme={item} busy={busy} change={change} />}
                        />
                    )}
        </View>
    );
}
