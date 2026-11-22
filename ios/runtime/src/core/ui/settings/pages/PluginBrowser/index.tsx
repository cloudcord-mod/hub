import { VdPluginManager } from "@core/vendetta/plugins";
import { useProxy } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { dismissAlert, openAlert } from "@lib/ui/alerts";
import { AlertActionButton } from "@lib/ui/components/wrappers";
import { showToast } from "@lib/ui/toasts";
import safeFetch from "@lib/utils/safeFetch";
import { clipboard, React } from "@metro/common";
import { AlertActions, AlertModal, Button, Card, FlashList, Stack, Text } from "@metro/common/components";
import Search from "@ui/components/Search";
import { View } from "react-native";

const pluginIndex = "https://raw.githubusercontent.com/Purple-EyeZ/Plugins-List/refs/heads/main/src/plugins-data.json";

interface PluginData {
    name: string;
    description: string;
    authors: string[];
    installUrl: string;
    sourceUrl?: string;
    status?: string;
    warningMessage?: string;
}

function pluginDirectory(value: unknown) {
    if (typeof value !== "string" || value.length > 2048 || /[\s\\]/.test(value) || !/^https:\/\//i.test(value)) return;
    try {
        const url = new URL(value);
        if (url.username || url.password || url.search || url.hash) return;
        url.pathname = url.pathname.replace(/\/+$/, "") + "/";
        return url.href;
    } catch { /* Invalid catalog entry. */ }
}

function parsePluginIndex(value: unknown): PluginData[] {
    const rows = Array.isArray(value) ? value
        : (value as { OFFICIAL_PLUGINS?: unknown; } | null)?.OFFICIAL_PLUGINS;
    if (!Array.isArray(rows)) throw new Error("The plugin catalog returned an invalid list.");

    const results = new Map<string, PluginData>();
    for (const row of rows) {
        const installUrl = pluginDirectory(row?.installUrl);
        if (!installUrl || results.has(installUrl) || typeof row?.name !== "string" || !row.name.trim()) continue;
        results.set(installUrl, {
            name: row.name.trim(),
            description: typeof row.description === "string" ? row.description : "",
            authors: Array.isArray(row.authors) ? row.authors.filter((author: unknown) => typeof author === "string") : [],
            installUrl,
            sourceUrl: typeof row.sourceUrl === "string" && /^https:\/\/[^ \t\r\n]+$/i.test(row.sourceUrl) ? row.sourceUrl : undefined,
            status: typeof row.status === "string" ? row.status.trim().toLowerCase() : undefined,
            warningMessage: typeof row.warningMessage === "string" ? row.warningMessage.trim() : undefined,
        });
    }
    return [...results.values()];
}

function PluginCard({ addon, installed, busy, change }: {
    addon: PluginData;
    installed: boolean;
    busy: boolean;
    change(addon: PluginData, remove: boolean): Promise<void>;
}) {
    const confirm = () => {
        if (installed || (addon.status === "working" && !addon.warningMessage)) {
            void change(addon, installed);
            return;
        }
        const key = "plugin-catalog-install";
        openAlert(key, <AlertModal title={"Install " + addon.name + "?"}
            content={addon.warningMessage || "The catalog reports this plugin as untested or potentially incompatible."}
            actions={<AlertActions>
                <AlertActionButton text="Install" variant="primary" onPress={() => {
                    dismissAlert(key);
                    void change(addon, false);
                }} />
                <AlertActionButton text="Cancel" variant="secondary" onPress={() => dismissAlert(key)} />
            </AlertActions>} />);
    };
    const copy = async (url: string) => {
        try {
            await clipboard.setString(url);
            showToast("Link copied", findAssetId("CheckIcon"));
        } catch {
            showToast("Couldn't copy the link", findAssetId("CircleXIcon-primary"));
        }
    };
    const status = addon.status === "working" ? "Reported working" : addon.status === "warning" ? "May have issues"
        : addon.status === "broken" ? "Reported broken" : "Status unknown";
    return <Card>
        <Stack spacing={8}>
            <Text variant="heading-md/semibold">{addon.name}</Text>
            <Text variant="text-sm/medium" color="text-muted">
                {[addon.authors.join(", "), status, installed ? "Installed" : ""].filter(Boolean).join(" · ")}
            </Text>
            {!!addon.description && <Text variant="text-md/medium">{addon.description}</Text>}
            {!!addon.warningMessage && <Text variant="text-sm/medium" color="text-muted">{addon.warningMessage}</Text>}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Button size="sm" text={installed ? "Uninstall" : "Install"} variant={installed ? "destructive" : "primary"}
                    loading={busy} disabled={busy} onPress={confirm} />
                <Button size="sm" text="Copy plugin link" variant="secondary" onPress={() => void copy(addon.installUrl)} />
                {!!addon.sourceUrl && <Button size="sm" text="Copy source link" variant="secondary" onPress={() => void copy(addon.sourceUrl!)} />}
            </View>
        </Stack>
    </Card>;
}

export default function BrowserPage() {
    const library = useProxy(VdPluginManager.plugins);
    const [plugins, setPlugins] = React.useState<PluginData[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState("");
    const [search, setSearch] = React.useState("");
    const [workingOnly, setWorkingOnly] = React.useState(true);
    const [installedOnly, setInstalledOnly] = React.useState(false);
    const [alphabetical, setAlphabetical] = React.useState(false);
    const [busyIds, setBusyIds] = React.useState<Set<string>>(() => new Set());
    const actions = React.useRef(new Set<string>());
    const refreshing = React.useRef(false);

    const refresh = async () => {
        if (refreshing.current) return;
        refreshing.current = true;
        setLoading(true);
        setError("");
        try { setPlugins(parsePluginIndex(await (await safeFetch(pluginIndex)).json())); }
        catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally {
            refreshing.current = false;
            setLoading(false);
        }
    };
    React.useEffect(() => { void refresh(); }, []);

    async function change(addon: PluginData, remove: boolean) {
        const id = addon.installUrl;
        if (actions.current.has(id)) return;
        actions.current.add(id);
        setBusyIds(new Set(actions.current));
        try {
            if (remove) await VdPluginManager.removePlugin(id);
            else await VdPluginManager.installPlugin(id);
            showToast((remove ? "Uninstalled " : "Installed ") + addon.name, findAssetId("CheckIcon"));
        } catch (failure) {
            showToast(failure instanceof Error ? failure.message : String(failure), findAssetId("CircleXIcon-primary"));
        } finally {
            actions.current.delete(id);
            setBusyIds(new Set(actions.current));
        }
    }

    const query = search.trim().toLowerCase();
    const shown = plugins.filter(addon =>
        (!workingOnly || addon.status === "working" || Boolean(library[addon.installUrl]))
        && (!installedOnly || Boolean(library[addon.installUrl]))
        && (!query || [addon.name, addon.description, ...addon.authors].some(value => value.toLowerCase().includes(query))));
    if (alphabetical) shown.sort((a, b) => a.name.localeCompare(b.name));
    else shown.reverse();

    return <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
            <Search placeholder="Search plugins or authors" isRound onChangeText={setSearch} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Button size="sm" text="Working only" variant={workingOnly ? "primary" : "secondary"} onPress={() => setWorkingOnly(value => !value)} />
                <Button size="sm" text="Installed only" variant={installedOnly ? "primary" : "secondary"} onPress={() => setInstalledOnly(value => !value)} />
                <Button size="sm" text="Sort A–Z" variant={alphabetical ? "primary" : "secondary"} onPress={() => setAlphabetical(value => !value)} />
            </View>
            {!loading && <Text variant="text-sm/medium" color="text-muted">
                {shown.length} of {plugins.length} · Status reported by the catalog
            </Text>}
            <Text variant="text-sm/medium" color="text-muted">Third-party plugins run code in your client. Install plugins from authors you trust.</Text>
            {!!error && <View style={{ gap: 6 }}>
                <Text variant="text-sm/medium" color="text-muted">{error}</Text>
                <Button size="sm" text="Try again" variant="secondary" onPress={() => void refresh()} />
            </View>}
        </View>
        <FlashList
            data={shown}
            extraData={busyIds}
            refreshing={loading}
            onRefresh={() => void refresh()}
            estimatedItemSize={168}
            keyExtractor={(addon: PluginData) => addon.installUrl}
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 48 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={!error && <Text variant="text-md/medium" color="text-muted" style={{ padding: 24, textAlign: "center" }}>
                {loading ? "Loading plugins…" : "No plugins match these filters."}
            </Text>}
            renderItem={({ item }: { item: PluginData; }) =>
                <PluginCard addon={item} installed={Boolean(library[item.installUrl])} busy={busyIds.has(item.installUrl)} change={change} />}
        />
    </View>;
}
