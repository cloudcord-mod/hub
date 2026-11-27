import { Strings } from "@core/i18n";
import { CardWrapper } from "@core/ui/components/AddonCard";
import { showConfirmationAlert } from "@core/vendetta/alerts";
import { useProxy } from "@core/vendetta/storage";
import { FontDefinition, fonts, selectFont } from "@lib/addons/fonts";
import { findAssetId } from "@lib/api/assets";
import { BundleUpdaterManager } from "@lib/api/native/modules";
import { lazyDestructure } from "@lib/utils/lazy";
import { findByProps } from "@metro";
import { NavigationNative, tokens } from "@metro/common";
import { Button, IconButton, Stack, Text } from "@metro/common/components";
import { semanticColors } from "@ui/color";
import { View } from "react-native";

import FontEditor from "./FontEditor";

const { useToken } = lazyDestructure(() => findByProps("useToken"));

export default function FontCard({ item: font }: CardWrapper<FontDefinition>) {
    useProxy(fonts);

    const navigation = NavigationNative.useNavigation();
    const selected = fonts.__selected === font.name;

    return (
        <View
            style={{
                backgroundColor: semanticColors.CARD_SECONDARY_BG,
                borderRadius: 16,
                overflow: "hidden",
                paddingHorizontal: 16,
                paddingVertical: 14,
            }}
        >
            <Stack spacing={12}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ flexShrink: 1 }}>
                        <Text variant="heading-lg/semibold" numberOfLines={2}>
                            {font.name}
                        </Text>
                    </View>
                    <View style={{ marginLeft: "auto" }}>
                        <Stack spacing={12} direction="horizontal">
                            <IconButton
                                onPress={() => {
                                    navigation.push("BUNNY_CUSTOM_PAGE", {
                                        title: "Edit Font",
                                        render: () => <FontEditor name={font.name} />
                                    });
                                }}
                                size="sm"
                                variant="secondary"
                                disabled={selected}
                                icon={findAssetId("WrenchIcon")}
                            />
                            <Button
                                size="sm"
                                variant={selected ? "secondary" : "primary"}
                                text={selected ? "Unapply" : "Apply"}
                                onPress={async () => {
                                    await selectFont(selected ? null : font.name);
                                    showConfirmationAlert({
                                        title: Strings.HOLD_UP,
                                        content: "Reload Discord to apply changes?",
                                        confirmText: Strings.RELOAD,
                                        cancelText: Strings.CANCEL,
                                        confirmColor: "red",
                                        onConfirm: BundleUpdaterManager.reload
                                    });
                                }}
                            />
                        </Stack>
                    </View>
                </View>
            </Stack>
        </View>
    );
}
