import { ScrollView } from "react-native";
import { NavigationNative, React } from "@metro/common";
import { Card, Stack, TableRow } from "@metro/common/components";
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
        <Stack style={{ width: "100%", maxWidth: 720, alignSelf: "center", paddingVertical: 20, paddingHorizontal: 16 }} spacing={12}>
            <Card><TableRow arrow label="Plugins" subLabel="Find, enable, and configure plugins" icon={icon("PuzzlePieceIcon", "AppsIcon", "SettingsIcon")} onPress={() => open("Plugins", () => require("@core/ui/settings/pages/Plugins"))} /></Card>
            {hasThemes && <Card><TableRow arrow label="Themes" subLabel="Change colors and chat backgrounds" icon={icon("PaintPaletteIcon", "ThemeIcon", "SettingsIcon")} onPress={() => open("Themes", () => require("@core/ui/settings/pages/Themes"))} /></Card>}
            <Card><TableRow arrow label="Fonts" subLabel={isFontSupported() ? "Browse and apply fonts" : "Browse fonts · applying requires a compatible loader"} icon={icon("LettersIcon", "TextIcon")} onPress={() => open("Fonts", () => require("@core/ui/settings/pages/Fonts"))} /></Card>
        </Stack>
    </ScrollView>;
}
