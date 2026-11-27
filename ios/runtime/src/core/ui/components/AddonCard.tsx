import { findAssetId } from "@lib/api/assets";
import { lazyDestructure } from "@lib/utils/lazy";
import { FormRadio, FormSwitch, IconButton, LegacyFormRow, Text } from "@metro/common/components";
import { findByProps } from "@metro/wrappers";
import { semanticColors } from "@ui/color";
import { createStyles, TextStyleSheet } from "@ui/styles";
import { TouchableOpacity, View } from "react-native";

const { hideActionSheet } = lazyDestructure(() => findByProps("openLazy", "hideActionSheet"));
const { showSimpleActionSheet } = lazyDestructure(() => findByProps("showSimpleActionSheet"));

const useStyles = createStyles({
    card: {
        backgroundColor: semanticColors?.CARD_SECONDARY_BG,
        borderRadius: 16,
        overflow: "hidden",
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12
    },
    headerLeading: {
        flex: 1,
        minWidth: 0,
        flexDirection: "column",
        justifyContent: "center",
        gap: 2
    },
    headerLabel: {
        ...TextStyleSheet["heading-lg/semibold"],
        color: semanticColors.MOBILE_TEXT_HEADING_PRIMARY,
    },
    headerSubtitle: {
        ...TextStyleSheet["text-sm/medium"],
        color: semanticColors.TEXT_MUTED,
    },
    descriptionLabel: {
        ...TextStyleSheet["text-md/medium"],
        color: semanticColors.TEXT_NORMAL,
    },
    footer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 8
    }
});

interface Action {
    icon: string;
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
    actions?: Action[];
    overflowTitle?: string;
    overflowActions?: OverflowAction[];
}

export default function AddonCard(props: CardProps) {
    const styles = useStyles();
    const hasFooter = !!props.overflowActions?.length || !!props.actions?.length;

    return (
        <View style={styles.card}>
            <View style={styles.headerRow}>
                <View style={styles.headerLeading}>
                    <Text style={styles.headerLabel} numberOfLines={2}>{props.headerLabel}</Text>
                    {!!props.headerSublabel && (
                        <Text style={styles.headerSubtitle} numberOfLines={1}>{props.headerSublabel}</Text>
                    )}
                </View>
                {props.toggleType && (props.toggleType === "switch" ?
                    <FormSwitch
                        value={props.toggleValue()}
                        onValueChange={props.onToggleChange}
                    />
                    :
                    <TouchableOpacity
                        accessibilityRole="radio"
                        accessibilityLabel={props.headerLabel}
                        accessibilityState={{ selected: props.toggleValue() }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => {
                            props.onToggleChange?.(!props.toggleValue());
                        }}
                    >
                        <FormRadio selected={props.toggleValue()} />
                    </TouchableOpacity>
                )}
            </View>
            {!!props.descriptionLabel && (
                <Text style={styles.descriptionLabel} numberOfLines={4}>
                    {props.descriptionLabel}
                </Text>
            )}
            {hasFooter && (
                <View style={styles.footer}>
                    {props.overflowActions?.length ? (
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
                        />
                    ) : null}
                    {props.actions?.map(({ icon, onPress, disabled }, index) => (
                        <IconButton
                            key={`${icon}-${index}`}
                            onPress={onPress}
                            disabled={disabled}
                            size="sm"
                            variant="secondary"
                            icon={findAssetId(icon)}
                        />
                    ))}
                </View>
            )}
        </View>
    );
}
