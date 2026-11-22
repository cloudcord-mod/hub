import { useProxy } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { useMobileTestingAssignment } from "@lib/api/pluginTesting";
import { settings } from "@lib/api/settings";
import { wrapOnPress } from "@lib/ui/settings/patches/shared";
import { NavigationNative, React } from "@metro/common";
import { Stack, TableRow, TableRowGroup } from "@metro/common/components";
import { ScrollView } from "react-native";

export default function Tools() {
    const preferences = useProxy(settings);
    const hidden = preferences.cloudcordHiddenTabs ?? [];
    const assigned = useMobileTestingAssignment();
    const navigation = NavigationNative.useNavigation();
    const actions = React.useMemo(() => ({
        previews: wrapOnPress(undefined, navigation, async () => ({
            default: (await import("@core/ui/settings/pages/FakeProfile")).PreviewsPage,
        }), "Previews", undefined, "push"),
        account: wrapOnPress(undefined, navigation, async () => ({
            default: (await import("@core/ui/settings/pages/FakeProfile")).AccountToolsPage,
        }), "Account Tools", undefined, "push"),
        sync: wrapOnPress(undefined, navigation, () => import("@core/ui/settings/pages/StoreCloud"), "CloudSync", undefined, "push"),
        bot: wrapOnPress(undefined, navigation, () => import("@core/ui/settings/pages/BotCord"), "Botcord", undefined, "push"),
        testing: wrapOnPress(undefined, navigation, () => import("@core/ui/settings/pages/TestingPlugins"), "Testing Plugins", undefined, "push"),
        diagnostics: wrapOnPress(undefined, navigation, () => import("@core/ui/settings/pages/Diagnostics"), "Diagnostics", undefined, "push"),
    }), [navigation]);
    const tools = [
        { key: "CLOUDCORD_PREVIEWS", label: "Previews", description: "Preview profile and visual changes", icon: "ImageIcon", action: actions.previews },
        { key: "CLOUDCORD_ACCOUNT_TOOLS", label: "Account Tools", description: "Manage account options", icon: "UserIcon", action: actions.account },
        { key: "STORE_CLOUD", label: "CloudSync", description: "Manage cloud sync", icon: "CloudIcon", action: actions.sync },
        { key: "BOTCORD", label: "Botcord", description: "Open Botcord tools", icon: "RobotIcon", action: actions.bot },
        { key: "CLOUDCORD_TESTING_PLUGINS", label: "Testing Plugins", description: "Review assigned plugins", icon: "PuzzlePieceIcon", action: actions.testing, visible: Boolean(assigned) },
        { key: "CLOUDCORD_DIAGNOSTICS", label: "Diagnostics", description: "View runtime diagnostics", icon: "WrenchIcon", action: actions.diagnostics, visible: preferences.cloudcordDiagnosticsEnabled === true },
    ];
    const order = new Map((preferences.cloudcordTabOrder ?? []).map((key, index) => [key, index]));
    const visible = tools.filter(item => item.visible !== false && !hidden.includes(item.key))
        .sort((a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity));
    return <ScrollView contentContainerStyle={{ paddingBottom: 38 }}>
        <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
            <TableRowGroup title="Tools">
                {visible.map(item => {
                    const icon = findAssetId(item.icon) || findAssetId("SettingsIcon");
                    return <TableRow key={item.key} arrow label={item.label} subLabel={item.description}
                        icon={icon ? <TableRow.Icon source={icon} /> : undefined} onPress={item.action} />;
                })}
            </TableRowGroup>
        </Stack>
    </ScrollView>;
}
