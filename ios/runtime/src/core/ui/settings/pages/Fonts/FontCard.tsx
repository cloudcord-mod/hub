import { Strings } from "@core/i18n";
import { CardWrapper } from "@core/ui/components/AddonCard";
import { showConfirmationAlert } from "@core/vendetta/alerts";
import { useProxy } from "@core/vendetta/storage";
import { FontDefinition, fonts, saveFont, selectFont } from "@lib/addons/fonts";
import { findAssetId } from "@lib/api/assets";
import { isFontSupported } from "@lib/api/native/loader";
import { BundleUpdaterManager } from "@lib/api/native/modules";
import { lazyDestructure } from "@lib/utils/lazy";
import { findByProps } from "@metro";
import { NavigationNative, tokens } from "@metro/common";
import { Button, Card, IconButton, Stack, Text } from "@metro/common/components";
import { useState } from "react";
import { Alert, View } from "react-native";

import FontEditor from "./FontEditor";

const { useToken } = lazyDestructure(() => findByProps("useToken"));

export default function FontCard({ item: font }: CardWrapper<FontDefinition>) {
    useProxy(fonts);

    const navigation = NavigationNative.useNavigation();
    const [busy, setBusy] = useState(false);
    const canApply = isFontSupported();
    const installed = Boolean(fonts[font.name]);
    const selected = fonts.__selected === font.name;

    return (
        <Card>
            <Stack spacing={16}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                    <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 120 }}>
                        <Text variant="heading-md/semibold">
                            {font.name}
                        </Text>
                        {font.description ? <Text color="text-muted" variant="text-sm/medium">{font.description}</Text> : null}
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
                                disabled={!canApply || !installed || selected || busy}
                                icon={findAssetId("WrenchIcon")}
                            />
                            <Button
                                size="sm"
                                variant={selected ? "secondary" : "primary"}
                                disabled={!canApply || busy}
                                text={!canApply ? "Requires loader update" : busy ? "Loading…" : selected ? "Unapply" : "Use"}
                                onPress={async () => {
                                    setBusy(true);
                                    try {
                                        if (!fonts[font.name]) await saveFont(font);
                                        await selectFont(selected ? null : font.name);
                                    } catch {
                                        Alert.alert("Couldn't apply font", "Check your connection and try again.");
                                        return;
                                    } finally {
                                        setBusy(false);
                                    }
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
        </Card>
    );
}
