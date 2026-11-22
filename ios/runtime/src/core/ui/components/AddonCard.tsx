import { findAssetId } from "@lib/api/assets";
import { lazyDestructure } from "@lib/utils/lazy";
import { Card, FormRadio, FormSwitch, IconButton, LegacyFormRow, Stack, Text } from "@metro/common/components";
import { findByProps } from "@metro/wrappers";
import { semanticColors } from "@ui/color";
import { createStyles, TextStyleSheet } from "@ui/styles";
import type { ReactNode } from "react";
import { TouchableOpacity, View } from "react-native";

const { hideActionSheet } = lazyDestructure(() => findByProps("openLazy", "hideActionSheet"));
const { showSimpleActionSheet } = lazyDestructure(() => findByProps("showSimpleActionSheet"));

const useStyles = createStyles({
    headerLeading: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    headerTrailing: {
        flexDirection: "row",
        flexShrink: 0,
        gap: 8,
        alignItems: "center"
    },
    headerLabel: {
        ...TextStyleSheet["heading-md/semibold"],
        color: semanticColors.MOBILE_TEXT_HEADING_PRIMARY,
    },
    headerSubtitle: {
        ...TextStyleSheet["text-sm/medium"],
        color: semanticColors.TEXT_MUTED,
    },
    actions: {
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: 5
    },
});

interface Action {
    icon: string;
    accessibilityLabel?: string;
    disabled?: boolean;
    onPress: () => void;
}

interface OverflowAction extends Action {
    label: string;
    isDestructive?: boolean;
}

export interface CardWrapper<T> {
    item: T;
    result: Fuzzysort.KeysResult<T>;
}

interface CardProps {
    index?: number;
    headerLabel: string;
    headerSublabel?: string;
    headerIcon?: string;
    toggleType?: "switch" | "radio";
    toggleValue: () => boolean;
    onToggleChange?: (v: boolean) => void;
    descriptionLabel?: string;
    preview?: ReactNode;
    actions?: Action[];
    overflowTitle?: string;
    overflowActions?: OverflowAction[];
}

export default function AddonCard(props: CardProps) {
    const styles = useStyles();

    return (
        <Card>
            <Stack spacing={6}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={styles.headerLeading}>
                        <Text style={styles.headerLabel}>{props.headerLabel}</Text>
                        {props.headerSublabel && (
                            <Text style={styles.headerSubtitle}>{props.headerSublabel}</Text>
                        )}
                    </View>
                    <View style={styles.headerTrailing}>
                        <View style={styles.actions}>
                            {props.overflowActions &&
                                <IconButton
                                    onPress={() => showSimpleActionSheet({
                                        key: "CardOverflow",
                                        header: {
                                            title: props.overflowTitle,
                                            icon: props.headerIcon && <LegacyFormRow.Icon style={{ marginRight: 8 }} source={findAssetId(props.headerIcon)} />,
                                            onClose: () => hideActionSheet(),
                                        },
                                        options: props.overflowActions?.map(i => ({
                                            ...i,
                                            icon: findAssetId(i.icon)
                                        })),
                                    })}
                                    size="sm"
                                    variant="secondary"
                                    icon={findAssetId("CircleInformationIcon-primary")}
                                />}
                            {props.actions?.map(({ icon, onPress, disabled, accessibilityLabel }, index) => (
                                <IconButton
                                    key={icon + index}
                                    onPress={onPress}
                                    disabled={disabled}
                                    accessibilityLabel={accessibilityLabel}
                                    size="sm"
                                    variant="secondary"
                                    icon={findAssetId(icon)}
                                />
                            ))}
                        </View>
                        {props.toggleType && (props.toggleType === "switch" ?
                            <FormSwitch
                                value={props.toggleValue()}
                                accessibilityLabel={props.headerLabel}
                                onValueChange={props.onToggleChange}
                            />
                            :
                            <TouchableOpacity accessibilityRole="radio" accessibilityLabel={props.headerLabel}
                                accessibilityState={{ checked: props.toggleValue() }} onPress={() => {
                                props.onToggleChange?.(!props.toggleValue());
                            }}>
                                <FormRadio selected={props.toggleValue()} />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
                {props.preview}
                {props.descriptionLabel && <Text variant="text-sm/medium" color="text-muted">
                    {props.descriptionLabel}
                </Text>}
            </Stack>
        </Card >
    );
}
