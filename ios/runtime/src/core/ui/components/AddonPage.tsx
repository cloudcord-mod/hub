import { CardWrapper } from "@core/ui/components/AddonCard";
import { findAssetId } from "@lib/api/assets";
import { settings } from "@lib/api/settings";
import { dismissAlert, openAlert } from "@lib/ui/alerts";
import { showSheet } from "@lib/ui/sheets";
import isValidHttpUrl from "@lib/utils/isValidHttpUrl";
import { lazyDestructure, proxyLazy } from "@lib/utils/lazy";
import { findByProps } from "@metro";
import { clipboard, NavigationNative } from "@metro/common";
import { AlertActionButton, AlertModal, Button, FlashList, IconButton, Stack, Text, TextInput, useSafeAreaInsets } from "@metro/common/components";
import { ErrorBoundary, Search } from "@ui/components";
import { isNotNil } from "es-toolkit";
import fuzzysort from "fuzzysort";
import { ComponentType, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Image, ScrollView, View } from "react-native";

const { showSimpleActionSheet, hideActionSheet } = lazyDestructure(() => findByProps("showSimpleActionSheet"));

type SearchKeywords<T> = Array<string | ((obj: T & {}) => string)>;

interface AddonPageProps<T extends object, I = any> {
    title: string;
    items: I[];
    searchKeywords: SearchKeywords<T>;
    searchCommands?: (items: readonly T[], query: string) => readonly T[];
    getItemKey?: (item: T) => string;
    sortOptions?: Record<string, (a: T, b: T) => number>;
    filterOptions?: Record<string, (item: T) => boolean>;
    defaultFilter?: (item: T) => boolean;
    resolveItem?: (value: I) => T | undefined;
    isEnabled?: (item: T) => boolean;
    showPluginSummary?: boolean;
    safeModeHint?: {
        message?: string;
        footer?: ReactNode;
    };
    installAction?: {
        label?: string;
        // Ignored when onPress is defined!
        fetchFn?: (url: string) => Promise<void>;
        onPress?: () => void;
    };

    OptionsActionSheetComponent?: ComponentType<any>;

    CardComponent: ComponentType<CardWrapper<T>>;
    ListHeaderComponent?: ComponentType<any>;
    ListFooterComponent?: ComponentType<any>;
}

function InputAlert(props: { label: string, fetchFn: (url: string) => Promise<void>; }) {
    const [value, setValue] = useState("");
    const [error, setError] = useState("");
    const [isFetching, setIsFetching] = useState(false);

    function onConfirmWrapper() {
        setIsFetching(true);

        props.fetchFn(value)
            .then(() => dismissAlert("AddonInputAlert"))
            .catch((e: unknown) => e instanceof Error ? setError(e.message) : String(e))
            .finally(() => setIsFetching(false));
    }

    return <AlertModal
        title={props.label}
        content="Type in the source URL you want to install from:"
        extraContent={
            <Stack style={{ marginTop: -12 }}>
                <TextInput
                    autoFocus={true}
                    isClearable={true}
                    value={value}
                    onChange={(v: string) => {
                        setValue(v);
                        if (error) setError("");
                    }}
                    returnKeyType="done"
                    onSubmitEditing={onConfirmWrapper}
                    state={error ? "error" : undefined}
                    errorMessage={error || undefined}
                />
                <ScrollView
                    horizontal={true}
                    showsHorizontalScrollIndicator={false}
                    style={{ gap: 8 }}
                >
                    <Button
                        size="sm"
                        variant="tertiary"
                        text="Import from clipboard"
                        icon={findAssetId("ClipboardListIcon")}
                        onPress={() => clipboard.getString().then((str: string) => setValue(str))}
                    />
                </ScrollView>
            </Stack>
        }
        actions={
            <Stack>
                {/* Manual button as we don't want alert to immediately dismiss when we tap on it */}
                <Button
                    loading={isFetching}
                    text="Install"
                    variant="primary"
                    disabled={!value || !isValidHttpUrl(value)}
                    onPress={onConfirmWrapper}
                />
                <AlertActionButton
                    disabled={isFetching}
                    text="Cancel"
                    variant="secondary"
                />
            </Stack>
        }
    />;
}

export default function AddonPage<T extends object>({ CardComponent, ...props }: AddonPageProps<T>) {
    const [search, setSearch] = useState("");
    const query = search.trim();
    const [status, setStatus] = useState<"All" | "Enabled" | "Disabled">("All");
    const [sort, setSort] = useState<string>();
    const sortFn = sort ? props.sortOptions?.[sort] : undefined;
    const defaultSortLabel = query ? "Relevance" : "Default order";
    const activeSortLabel = sort ?? defaultSortLabel;
    const [filter, setFilter] = useState("");
    const { bottom: bottomInset } = useSafeAreaInsets();
    const navigation = NavigationNative.useNavigation();
    const commandSearch = query.startsWith("/") && props.searchCommands;
    const matchesFilter = props.filterOptions?.[filter] ?? (commandSearch ? undefined : props.defaultFilter);

    useEffect(() => {
        if (props.OptionsActionSheetComponent) {
            navigation.setOptions({
                headerRight: () => <IconButton
                    size="sm"
                    variant="secondary"
                    icon={findAssetId("MoreHorizontalIcon")}
                    onPress={() => showSheet("AddonMoreSheet", props.OptionsActionSheetComponent!)}
                />
            });
        }
    }, [navigation]);

    const catalog = useMemo(() => {
        const values = props.resolveItem ? props.items.map(props.resolveItem) : props.items;
        return values.filter(item => isNotNil(item) && typeof item === "object");
    }, [props.items, props.resolveItem]);
    const items = catalog.filter(item => (!matchesFilter || matchesFilter(item))
        && (status === "All" || !props.isEnabled || props.isEnabled(item) === (status === "Enabled")));

    const results = useMemo(() => {
        const matches = commandSearch
            ? commandSearch(items, query).map(obj => ({ obj }))
            : query
                ? fuzzysort.go(query, items, { keys: props.searchKeywords })
                : items.map(obj => ({ obj }));
        return sortFn ? Array.from(matches).sort((a, b) => sortFn(a.obj, b.obj)) : matches;
    }, [items, props.searchKeywords, sortFn, query, commandSearch]);

    const getItemKey = props.getItemKey;
    const keyExtractor = useCallback(({ obj }: { obj: T }, index: number) =>
        getItemKey?.(obj) ?? String(index), [getItemKey]);
    const renderItem = useCallback(({ item }: { item: Fuzzysort.KeysResult<T> }) =>
        <CardComponent item={item.obj} result={item} />, [CardComponent]);

    const onInstallPress = useCallback(() => {
        if (!props.installAction) return () => { };
        const { label, onPress, fetchFn } = props.installAction;
        if (fetchFn) {
            openAlert("AddonInputAlert", <InputAlert label={label ?? "Install"} fetchFn={fetchFn} />);
        } else {
            onPress?.();
        }
    }, []);

    if (results.length === 0 && !query && status === "All" && !filter && !props.ListHeaderComponent && !props.items.length) {
        return <View style={{ gap: 32, flexGrow: 1, justifyContent: "center", alignItems: "center" }}>
            <View style={{ gap: 8, alignItems: "center" }}>
                <Image source={findAssetId("empty_quick_switcher")!} />
                <Text variant="text-lg/semibold" color="text-default">
                    No {props.title.toLowerCase()} installed
                </Text>
            </View>
            <Button
                size="lg"
                icon={findAssetId("DownloadIcon")}
                text={props.installAction?.label ?? "Install"}
                onPress={onInstallPress}
            />
        </View>;
    }

    const headerElement = (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 10 }}>
            {settings.safeMode?.enabled && <View style={{ marginBottom: 10 }}>
                <Text variant="text-sm/medium" color="text-muted">
                    {props.safeModeHint?.message}
                </Text>
                {props.safeModeHint?.footer}
            </View>}
            <View style={{ flexDirection: "row", gap: 8 }}>
                <Search style={{ flex: 1, minWidth: 0 }} isRound={!!props.sortOptions} onChangeText={v => setSearch(v)} />
                {props.sortOptions && <IconButton
                    icon={findAssetId("ArrowsUpDownIcon")}
                    variant="tertiary"
                    accessibilityLabel={`Sort add-ons, current order: ${activeSortLabel}`}
                    onPress={() => showSimpleActionSheet({
                        key: "AddonListSortOptions",
                        header: {
                            title: `Sort add-ons · ${activeSortLabel}`,
                            onClose: () => hideActionSheet("AddonListSortOptions"),
                        },
                        options: [
                            { label: defaultSortLabel, onPress: () => setSort(undefined) },
                            ...Object.keys(props.sortOptions!).map(name => ({
                                label: name,
                                onPress: () => setSort(name),
                            })),
                        ],
                    })}
                />}
            </View>
            {props.showPluginSummary && props.isEnabled && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Button size="sm" variant="secondary" text={catalog.length + " available"} onPress={() => { setStatus("All"); setFilter(""); }} />
                <Button size="sm" variant="secondary" text={catalog.filter(props.isEnabled).length + " enabled"} onPress={() => { setStatus("Enabled"); setFilter(""); }} />
            </View>}
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                {props.isEnabled && (["All", "Enabled", "Disabled"] as const).map(option => (
                    <Button key={option} text={option} size="sm" variant={status === option ? "primary" : "secondary"} onPress={() => setStatus(option)} />
                ))}
                {props.installAction && <Button text={props.installAction.label ?? "Install"} icon={findAssetId("PlusLargeIcon")}
                    size="sm" variant="tertiary" onPress={onInstallPress} />}
            </View>
            {props.filterOptions && <ScrollView horizontal showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
                {["", ...Object.keys(props.filterOptions)].map(name => (
                    <Button key={name || "default"} size="sm" text={name || "Default"}
                        variant={filter === name ? "primary" : "secondary"} onPress={() => setFilter(name)} />
                ))}
            </ScrollView>}
            <Text variant="text-sm/medium" color="text-muted">
                {results.length} shown{props.isEnabled ? ` · ${catalog.filter(props.isEnabled).length} enabled` : ""}
            </Text>
        </View>
    );

    return (
        <ErrorBoundary>
            <View style={{ flex: 1, alignSelf: "center", width: "100%", maxWidth: 840 }}>
            {headerElement}
            <FlashList
                data={results}
                extraData={search}
                keyExtractor={getItemKey ? keyExtractor : undefined}
                keyboardShouldPersistTaps="handled"
                estimatedItemSize={136}
                ListHeaderComponent={props.ListHeaderComponent}
                ListEmptyComponent={() => <View style={{ gap: 12, padding: 12, alignItems: "center" }}>
                    <Image source={findAssetId("devices_not_found")!} />
                    <Text variant="text-lg/semibold" color="text-default">
                        {filter ? "No plugins match these filters." : "No add-ons match this view."}
                    </Text>
                    {(filter || status !== "All") && <Button variant="secondary" size="sm" text="Clear filters" onPress={() => {
                        setFilter("");
                        setStatus("All");
                    }} />}
                </View>}
                contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: bottomInset + 16 }}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListFooterComponent={props.ListFooterComponent}
                renderItem={renderItem}
            />
            </View>
        </ErrorBoundary>
    );
}
