import { useProxy } from "@core/vendetta/storage";
import { settings } from "@lib/api/settings";
import { wrapOnPress } from "@lib/ui/settings/patches/shared";
import { NavigationNative, React } from "@metro/common";
import { Stack, TableRow, TableRowGroup } from "@metro/common/components";
import { ScrollView } from "react-native";

export default function Tools() {
    const hidden = useProxy(settings).cloudcordHiddenTabs ?? [];
    const navigation = NavigationNative.useNavigation();
    const actions = React.useMemo(() => ({
        previews: wrapOnPress(undefined, navigation, async () => ({
            default: (await import("@core/ui/settings/pages/FakeProfile")).PreviewsPage,
        }), "Previews", undefined, "push"),
        account: wrapOnPress(undefined, navigation, async () => ({
            default: (await import("@core/ui/settings/pages/FakeProfile")).AccountToolsPage,
        }), "Account Tools", undefined, "push"),
    }), [navigation]);
    return <ScrollView contentContainerStyle={{ paddingBottom: 38 }}>
        <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }}>
            <TableRowGroup title="Tools">
                {!hidden.includes("CLOUDCORD_PREVIEWS") && <TableRow arrow label="Previews"
                    onPress={actions.previews} />}
                {!hidden.includes("CLOUDCORD_ACCOUNT_TOOLS") && <TableRow arrow label="Account Tools"
                    onPress={actions.account} />}
            </TableRowGroup>
        </Stack>
    </ScrollView>;
}
