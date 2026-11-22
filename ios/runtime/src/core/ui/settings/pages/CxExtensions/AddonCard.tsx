import AddonCard from "@core/ui/components/AddonCard";
import { isFontSupported } from "@lib/api/native/loader";
import { settings } from "@lib/api/settings";
import { wrapOnPress } from "@lib/ui/settings/patches/shared";
import { showToast } from "@lib/ui/toasts";
import { NavigationNative } from "@metro/common";
import { Button } from "@metro/common/components";
import { View } from "react-native";

import CxExtensions, { type CxAddonKind, type CxAddonRow, disableCxAddon } from ".";

function useAddonReview(kind: CxAddonKind, entry?: CxAddonRow) {
    const navigation = NavigationNative.useNavigation();
    const title = entry?.name ?? `Import ${kind}`;
    return wrapOnPress(undefined, navigation, async () => ({
        default: () => <CxExtensions kind={kind} entry={entry} />,
    }), title, undefined, "push");
}

export function AddonActions({ kind }: { kind: CxAddonKind; }) {
    const navigation = NavigationNative.useNavigation();
    const review = useAddonReview(kind);
    const isPlugin = kind === "plugin";
    const discoverLabel = isPlugin ? "Discover plugins" : "Discover themes";
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
    return <AddonCard headerLabel={entry.name} descriptionLabel={entry.description}
        headerSublabel={entry.restoreFailed ? "Couldn’t start automatically" : entry.needsReview ? "Review update to enable" : undefined}
        toggleType={kind === "theme" ? "radio" : "switch"} toggleValue={() => entry.active}
        actions={entry.active || entry.needsReview ? [{ icon: "SettingsIcon", onPress: review }] : undefined}
        onToggleChange={enabled => {
            if (enabled) {
                if (settings.safeMode?.enabled) return showToast("Add-ons are paused in Safe Mode.");
                return review();
            }
            try { disableCxAddon(entry.id, entry.name); }
            catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
        }} />;
}
