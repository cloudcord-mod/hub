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
    const cloudIcon = findAssetId("CloudIcon") || findAssetId("CloudArrowUpIcon");
    const groups = [
        { title: "Customize", items: [
            { key: "CLOUDCORD_PREVIEWS", label: "Previews", action: actions.previews },
        ] },
        { title: "Accounts and data", items: [
            { key: "CLOUDCORD_ACCOUNT_TOOLS", label: "Account Tools", action: actions.account },
            { key: "STORE_CLOUD", label: "CloudSync", action: actions.sync, icon: cloudIcon },
            { key: "BOTCORD", label: "Botcord", action: actions.bot },
        ] },
        { title: "Testing and support", items: [
            { key: "CLOUDCORD_TESTING_PLUGINS", label: "Testing Plugins", action: actions.testing, visible: Boolean(assigned) },
            { key: "CLOUDCORD_DIAGNOSTICS", label: "Diagnostics", action: actions.diagnostics, visible: preferences.cloudcordDiagnosticsEnabled === true },
        ] },
    ];
    const order = new Map((preferences.cloudcordTabOrder ?? []).map((key, index) => [key, index]));
    return <ScrollView contentContainerStyle={{ paddingBottom: 38 }}>
        <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
            {groups.map(({ title, items }) => {
                const visible = items.filter(item => item.visible !== false && !hidden.includes(item.key))
                    .sort((a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity));
                return !!visible.length && <TableRowGroup key={title} title={title}>
                    {visible.map(item => <TableRow key={item.key} arrow label={item.label}
                        icon={item.icon ? <TableRow.Icon source={item.icon} /> : undefined} onPress={item.action} />)}
                </TableRowGroup>;
            })}
        </Stack>
    </ScrollView>;
}
