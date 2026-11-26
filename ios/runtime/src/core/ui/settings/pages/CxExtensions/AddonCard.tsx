import AddonCard from "@core/ui/components/AddonCard";
import { parseCx } from "@lib/api/cx";
import { isFontSupported } from "@lib/api/native/loader";
import { wrapOnPress } from "@lib/ui/settings/patches/shared";
import { showToast } from "@lib/ui/toasts";
import { NavigationNative, React } from "@metro/common";
import { Button } from "@metro/common/components";
import { View } from "react-native";

import CxExtensions, { type CxAddonKind, type CxAddonRow, disableCxAddon } from ".";

function useAddonReview(kind: CxAddonKind, entry?: CxAddonRow) {
    const navigation = NavigationNative.useNavigation();
    const title = entry?.name ?? `Import ${kind}`;
    return React.useMemo(() => wrapOnPress(undefined, navigation, async () => ({
        default: () => <CxExtensions kind={kind} entry={entry} />,
    }), title, undefined, "push"), [navigation, title, kind, entry]);
}

export function AddonActions({ kind }: { kind: CxAddonKind; }) {
    const navigation = NavigationNative.useNavigation();
    const review = useAddonReview(kind);
    const isPlugin = kind === "plugin";
    const discoverLabel = isPlugin ? "Community Plugins" : "Discover themes";
    const discover = wrapOnPress(undefined, navigation, () => isPlugin
        ? import("@core/ui/settings/pages/PluginBrowser")
        : import("@core/ui/settings/pages/ThemeStore"), discoverLabel, undefined, "push");
    const openFonts = wrapOnPress(undefined, navigation, () => import("@core/ui/settings/pages/Fonts"), "Fonts", undefined, "push");

    return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 8 }}>
        <Button text={discoverLabel} variant="secondary" size="small" onPress={discover} />
        <Button text={isPlugin ? "Import plugin file" : "Import theme file"} variant="secondary" size="small" onPress={review} />
        {!isPlugin && isFontSupported() && <Button text="Fonts" variant="secondary" size="small" onPress={openFonts} />}
    </View>;
}

export function CxAddonCard({ kind, entry }: { kind: CxAddonKind; entry: CxAddonRow; }) {
    const review = useAddonReview(kind, entry);
    const palette = React.useMemo(() => {
        if (kind !== "theme") return [];
        try {
            const theme = parseCx(entry.source);
            if (theme.kind !== "theme") return [];
            return [...new Set([theme.sidebar, theme.background, theme.surface, theme.accent, theme.text])]
                .filter((color): color is string => Boolean(color));
        } catch {
            return [];
        }
    }, [kind, entry.source]);
    return <AddonCard headerLabel={entry.name} descriptionLabel={entry.description}
        preview={palette.length > 0 ? <View accessible accessibilityLabel={`Theme colors: ${palette.join(", ")}`}
            style={{ flexDirection: "row", height: 18, overflow: "hidden", borderRadius: 5 }}>
            {palette.map(color => <View key={color} style={{ flex: 1, backgroundColor: color }} />)}
        </View> : undefined}
        headerSublabel={entry.restoreFailed ? "Couldn’t start automatically" : entry.needsReview ? "Review update to enable" : undefined}
        toggleType={kind === "theme" ? "radio" : "switch"} toggleValue={() => entry.active}
        actions={[{
            icon: entry.active ? "SettingsIcon" : "CircleInformationIcon-primary",
            accessibilityLabel: entry.active ? `Configure ${entry.name}` : `Review ${entry.name}`,
            onPress: review,
        }]}
        onToggleChange={enabled => {
            if (enabled) return review();
            try { disableCxAddon(entry.id, entry.name); }
            catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
        }} />;
}
