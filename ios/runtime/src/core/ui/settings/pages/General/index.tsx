import { isSafeMode, requestDiscordReload, toggleSafeMode } from "@core/debug/safeMode";
import { Strings } from "@core/i18n";
import { PupuIcon } from "@core/ui/settings";
import About from "@core/ui/settings/pages/General/About";
import { useProxy } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { copyCcpReport } from "@lib/api/ccpReport";
import { getDebugInfo } from "@lib/api/debug";
import { BundleUpdaterManager } from "@lib/api/native/modules";
import { fetchRuntimeUpdate } from "@lib/api/native/runtimeUpdates";
import { settings } from "@lib/api/settings";
import { openAlert } from "@lib/ui/alerts";
import { GITHUB } from "@lib/utils/constants";
import { showToast } from "@lib/ui/toasts";
import { NavigationNative } from "@metro/common";
import { AlertActionButton, AlertActions, AlertModal, Stack, TableRow, TableRowGroup, TableSwitchRow } from "@metro/common/components";
import { Linking, Platform, ScrollView } from "react-native";

export default function General() {
    useProxy(settings);

    const debugInfo = getDebugInfo();
    const navigation = NavigationNative.useNavigation();
    const canFetchRuntime = typeof BundleUpdaterManager?.checkForUpdates === "function"
        || typeof BundleUpdaterManager?.download === "function";
    const recoveryInstructions = Platform.OS === "android"
        ? "Hold Volume Up in Discord, then choose Use stable runtime. This is available on current CloudCord Manager installs."
        : "Shake the device in Discord, then choose Refetch Bundle in the recovery menu.";

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
                <TableRowGroup title={Strings.INFO}>
                    <TableRow
                        label={Strings.PUPU}
                        icon={<TableRow.Icon source={{ uri: PupuIcon }} />}
                        trailing={<TableRow.TrailingText text={debugInfo.bunny.version} />}
                    />
                    <TableRow
                        label={"Discord"}
                        icon={<TableRow.Icon source={findAssetId("Discord")!} />}
                        trailing={<TableRow.TrailingText text={`${debugInfo.discord.version} (${debugInfo.discord.build})`} />}
                    />
                    <TableRow
                        arrow
                        label={Strings.ABOUT}
                        icon={<TableRow.Icon source={findAssetId("CircleInformationIcon-primary")!} />}
                        onPress={() => navigation.push("PUPU_CUSTOM_PAGE", {
                            title: Strings.ABOUT,
                            render: () => <About />,
                        })}
                    />
                </TableRowGroup>
                <TableRowGroup title={Strings.LINKS}>
                    <TableRow
                        arrow={true}
                        label={Strings.DISCORD_SERVER}
                        icon={<TableRow.Icon source={findAssetId("Discord")!} />}
                        onPress={() => Linking.openURL("https://discord.gg/EBEZJ84zBT")}
                    />
                    <TableRow
                        arrow={true}
                        label="Website"
                        icon={<TableRow.Icon source={findAssetId("GlobeIcon") || findAssetId("CircleInformationIcon-primary")} />}
                        onPress={() => Linking.openURL("https://getcloudcord.com")}
                    />
                    <TableRow
                        arrow={true}
                        label={Strings.GITHUB}
                        icon={<TableRow.Icon source={findAssetId("img_account_sync_github_white")!} />}
                        onPress={() => Linking.openURL(GITHUB)}
                    />
                </TableRowGroup>
                <TableRowGroup title={Strings.ACTIONS}>
                    {canFetchRuntime && (globalThis as any).__CLOUDCORD_ORIGINAL_RAIN__ && <TableSwitchRow
                        label="Auto-update"
                        subLabel="Check every five minutes. Saved updates apply after Discord restarts."
                        value={(settings as any).cloudcordAutoUpdate !== false}
                        onValueChange={(value: boolean) => (settings as any).cloudcordAutoUpdate = value}
                    />}
                    {canFetchRuntime && <TableRow label="Update status" subLabel={(settings as any).cloudcordUpdateStatus || "No update check yet"} />}
                    <TableRow label="Loaded runtime" subLabel={String((globalThis as any).__CLOUDCORD_RUNTIME_REVISION__ ?? "Unknown").slice(0, 12)} />
                    {canFetchRuntime ? <TableRow label="Fetch Runtime" subLabel="Download the latest runtime. Reopen Discord to apply it." onPress={async () => {
                        (settings as any).cloudcordUpdateStatus = "Checking for updates…";
                        try {
                            const updated = await fetchRuntimeUpdate(BundleUpdaterManager);
                            (settings as any).cloudcordUpdateStatus = updated === false
                                ? "CloudCord is up to date."
                                : "Latest runtime saved. Reopen Discord to apply it.";
                        } catch (error) {
                            const message = error instanceof Error ? error.message : "Runtime download failed";
                            (settings as any).cloudcordUpdateStatus = message;
                            showToast(message);
                        }
                    }} /> : <TableRow label="Update through recovery" subLabel={recoveryInstructions} />}
                    <TableRow label="Copy CCP runtime report" subLabel="Loaded Discord functions and read-only checks"
                        icon={<TableRow.Icon source={findAssetId("CopyIcon") || findAssetId("WrenchIcon")} />}
                        onPress={async () => {
                            try {
                                await copyCcpReport();
                                showToast("CCP runtime report copied");
                            } catch {
                                showToast("Could not copy the CCP runtime report");
                            }
                        }} />
                    {settings.cloudcordDiagnosticsEnabled === true && <TableRow arrow label="Diagnostics" subLabel="Runtime status and troubleshooting"
                        onPress={() => navigation.push("PUPU_CUSTOM_PAGE", { title: "Diagnostics", render: () => {
                            const Diagnostics = require("@core/ui/settings/pages/Diagnostics").default;
                            return <Diagnostics />;
                        } })} />}
                    <TableSwitchRow
                        label="Capture diagnostic events"
                        subLabel="Keep troubleshooting details while you use CloudCord"
                        icon={<TableRow.Icon source={findAssetId("WrenchIcon")!} />}
                        value={settings.cloudcordDiagnosticsEnabled === true}
                        onValueChange={(value: boolean) => settings.cloudcordDiagnosticsEnabled = value}
                    />
                    <TableRow
                        label={(globalThis as any).__CLOUDCORD_ORIGINAL_RAIN__ ? "Update runtime & restart" : Strings.RELOAD_DISCORD}
                        icon={<TableRow.Icon source={findAssetId("RetryIcon")!} />}
                        onPress={requestDiscordReload}
                    />
                    <TableSwitchRow
                        label={"Safe Mode"}
                        subLabel={"Load CloudCord without loading add-ons"}
                        icon={<TableRow.Icon source={findAssetId("ShieldIcon")!} />}
                        value={isSafeMode()}
                        onValueChange={(to: boolean) => {
                            toggleSafeMode({ to, reload: false });
                            openAlert(
                                "bunny-reload-safe-mode",
                                <AlertModal
                                    title="Reload now?"
                                    content={!to ? "All add-ons will load normally." : "All add-ons will be temporarily disabled upon reload."}
                                    actions={<AlertActions>
                                        <AlertActionButton
                                            text="Reload Now"
                                            variant="destructive"
                                            onPress={requestDiscordReload}
                                        />
                                        <AlertActionButton text="Later" variant="secondary" />
                                    </AlertActions>}
                                />
                            );
                        }}
                    />
                </TableRowGroup>
                <TableRowGroup title={Strings.MISCELLANEOUS}>
                    <TableSwitchRow
                        label="Hide CloudCord in settings"
                        subLabel="moves the controls into discord's developer options after a reload"
                        icon={<TableRow.Icon source={findAssetId("SettingsIcon") || findAssetId("WrenchIcon")} />}
                        value={settings.cloudcordSectionHidden ?? false}
                        onValueChange={(value: boolean) => settings.cloudcordSectionHidden = value}
                    />
                    <TableSwitchRow
                        label={Strings.SETTINGS_ACTIVATE_DISCORD_EXPERIMENTS}
                        subLabel={Strings.SETTINGS_ACTIVATE_DISCORD_EXPERIMENTS_DESC}
                        icon={<TableRow.Icon source={findAssetId("WrenchIcon")!} />}
                        value={settings.enableDiscordDeveloperSettings}
                        onValueChange={(v: boolean) => {
                            settings.enableDiscordDeveloperSettings = v;
                        }}
                    />
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
}
