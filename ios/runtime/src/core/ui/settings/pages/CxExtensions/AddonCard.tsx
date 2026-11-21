import AddonCard from "@core/ui/components/AddonCard";
import { settings } from "@lib/api/settings";
import { showToast } from "@lib/ui/toasts";
import { NavigationNative } from "@metro/common";
import { Button } from "@metro/common/components";

import CxExtensions, { type CxAddonKind, type CxAddonRow, disableCxAddon } from ".";

function useAddonReview(kind: CxAddonKind, entry?: CxAddonRow) {
    const navigation = NavigationNative.useNavigation();
    return () => navigation.push("PUPU_CUSTOM_PAGE", {
        title: entry?.name ?? `Import ${kind}`,
        render: () => <CxExtensions kind={kind} entry={entry} />,
    });
}

export function ImportCxAddonButton({ kind }: { kind: CxAddonKind; }) {
    const review = useAddonReview(kind);
    return <Button text={`Import ${kind} file`} variant="secondary" size="small" onPress={review} />;
}

export function CxAddonCard({ kind, entry }: { kind: CxAddonKind; entry: CxAddonRow; }) {
    const review = useAddonReview(kind, entry);
    return <AddonCard headerLabel={entry.name} descriptionLabel={entry.description}
        toggleType={kind === "theme" ? "radio" : "switch"} toggleValue={() => entry.active}
        actions={entry.active ? [{ icon: "SettingsIcon", onPress: review }] : undefined}
        onToggleChange={enabled => {
            if (enabled) {
                if (settings.safeMode?.enabled) return showToast("Add-ons are paused in Safe Mode.");
                return review();
            }
            try { disableCxAddon(entry.id, entry.name); }
            catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
        }} />;
}
