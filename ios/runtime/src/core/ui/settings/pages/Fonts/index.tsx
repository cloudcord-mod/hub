import { Strings } from "@core/i18n";
import AddonPage from "@core/ui/components/AddonPage";
import FontEditor from "@core/ui/settings/pages/Fonts/FontEditor";
import { useProxy } from "@core/vendetta/storage";
import { FontDefinition, fonts } from "@lib/addons/fonts";
import googleFonts from "@lib/addons/fonts/googleFonts.json";
import { isFontSupported } from "@lib/api/native/loader";
import { settings } from "@lib/api/settings";
import { NavigationNative } from "@metro/common";
import { Button } from "@metro/common/components";
import { useState } from "react";

import FontCard from "./FontCard";

const googleCatalog: FontDefinition[] = Object.entries(googleFonts).map(([name, url]) => ({
    spec: 1,
    name,
    description: "Google Fonts",
    main: Object.fromEntries(["Normal", "Medium", "Semibold", "Bold", "Extrabold"].map(weight => [`ggsans-${weight}`, url])),
}));

export default function Fonts() {
    useProxy(settings);
    useProxy(fonts);

    const [discover, setDiscover] = useState(!isFontSupported());
    const installed = Object.values(fonts).filter(font => typeof font === "object" && font?.spec === 1);
    const navigation = NavigationNative.useNavigation();

    return (
        <AddonPage<FontDefinition>
            title={Strings.FONTS}
            searchKeywords={["name", "description"]}
            sortOptions={{
                "Name (A-Z)": (a, b) => a.name.localeCompare(b.name),
                "Name (Z-A)": (a, b) => b.name.localeCompare(a.name)
            }}
            items={discover ? googleCatalog.map(font => fonts[font.name] ?? font) : installed}
            getItemKey={font => font.name}
            ListHeaderComponent={() => <Button size="sm" variant="secondary"
                text={discover ? "Show installed fonts" : `Browse ${googleCatalog.length} Google Fonts`}
                onPress={() => setDiscover(value => !value)} />}
            safeModeHint={{ message: Strings.SAFE_MODE_NOTICE_FONTS }}
            CardComponent={FontCard}
            installAction={isFontSupported() ? {
                label: "Install a font",
                onPress: () => {
                    navigation.push("BUNNY_CUSTOM_PAGE", {
                        title: "Import Font",
                        render: () => <FontEditor />
                    });
                }
            } : undefined}
        />
    );
}
