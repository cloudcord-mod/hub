import { ScrollView } from "react-native";
import { NavigationNative, React } from "@metro/common";
import { Stack, TableRow, TableRowGroup } from "@metro/common/components";
import { isFontSupported, isThemeSupported } from "@lib/api/native/loader";
import { findAssetId } from "@lib/api/assets";
import { wrapOnPress } from "@lib/ui/settings/patches/shared";

function icon(...names: string[]) {
    for (const name of names) {
        try { const id = findAssetId(name); if (id) return <TableRow.Icon source={id} />; } catch {}
    }
    return undefined;
}

export default function Addons() {
    const navigation = NavigationNative.useNavigation();
    const open = React.useMemo(() => {
        const actions = new Map<string, () => Promise<void>>();
        return (title: string, load: () => any) => {
            if (!actions.has(title)) actions.set(title, wrapOnPress(undefined, navigation, async () => load(), title, undefined, "push"));
            return actions.get(title)!();
        };
    }, [navigation]);
    const hasThemes = isThemeSupported();
    return <ScrollView contentContainerStyle={{ paddingBottom: 38 }}>
        <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
            <TableRowGroup title="Add-ons">
                <TableRow arrow label="Plugins" subLabel="Manage and configure your plugins" icon={icon("PuzzlePieceIcon", "AppsIcon", "SettingsIcon")} onPress={() => open("Plugins", () => require("@core/ui/settings/pages/Plugins"))} />
                {hasThemes && <TableRow arrow label="Themes" subLabel="Manage your Discord themes" icon={icon("PaintPaletteIcon", "ThemeIcon", "SettingsIcon")} onPress={() => open("Themes", () => require("@core/ui/settings/pages/Themes"))} />}
                {!hasThemes && isFontSupported() && <TableRow arrow label="Fonts" subLabel="Choose and manage fonts" icon={icon("LettersIcon", "TextIcon")} onPress={() => open("Fonts", () => require("@core/ui/settings/pages/Fonts"))} />}
            </TableRowGroup>
        </Stack>
    </ScrollView>;
}
