import { CardWrapper } from "@core/ui/components/AddonCard";
import { findAssetId } from "@lib/api/assets";
import { settings } from "@lib/api/settings";
import { dismissAlert, openAlert } from "@lib/ui/alerts";
import { showSheet } from "@lib/ui/sheets";
import isValidHttpUrl from "@lib/utils/isValidHttpUrl";
import { lazyDestructure, proxyLazy } from "@lib/utils/lazy";
import { findByProps } from "@metro";
import { clipboard, NavigationNative } from "@metro/common";
import { AlertActionButton, AlertModal, Button, FlashList, FloatingActionButton, IconButton, Stack, TableSwitchRow, Text, TextInput, useSafeAreaInsets } from "@metro/common/components";
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
    const [enabledOnly, setEnabledOnly] = useState(false);
    const [sortFn, setSortFn] = useState<((a: T, b: T) => number) | null>(() => null);
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

    const items = useMemo(() => {
        const values = props.resolveItem ? props.items.map(props.resolveItem) : props.items;
        return values.filter(item => isNotNil(item) && typeof item === "object"
            && (!matchesFilter || matchesFilter(item))
            && (!enabledOnly || !props.isEnabled || props.isEnabled(item)));
    }, [props.items, props.resolveItem, props.isEnabled, enabledOnly, matchesFilter]);

    const results = useMemo(() => {
        const matches = commandSearch
            ? commandSearch(items, query).map(obj => ({ obj }))
            : query
                ? fuzzysort.go(query, items, { keys: props.searchKeywords })
                : items.map(obj => ({ obj }));
        return sortFn ? Array.from(matches).sort((a, b) => sortFn(a.obj, b.obj)) : matches;
    }, [items, props.searchKeywords, sortFn, query, commandSearch]);

    const onInstallPress = useCallback(() => {
        if (!props.installAction) return () => { };
        const { label, onPress, fetchFn } = props.installAction;
        if (fetchFn) {
            openAlert("AddonInputAlert", <InputAlert label={label ?? "Install"} fetchFn={fetchFn} />);
        } else {
            onPress?.();
        }
    }, []);

    if (results.length === 0 && !query && !enabledOnly && !filter && !props.ListHeaderComponent) {
        return <View style={{ gap: 32, flexGrow: 1, justifyContent: "center", alignItems: "center" }}>
            <View style={{ gap: 8, alignItems: "center" }}>
                <Image source={findAssetId("empty_quick_switcher")!} />
                <Text variant="text-lg/semibold" color="text-default">
                    Oops! Nothing to see here… yet!
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
        <View style={{ paddingBottom: 8 }}>
            {settings.safeMode?.enabled && <View style={{ marginBottom: 10 }}>
                <Text variant="text-sm/medium" color="text-muted">
                    {props.safeModeHint?.message}
                </Text>
                {props.safeModeHint?.footer}
            </View>}
            <View style={{ flexDirection: "row", gap: 8 }}>
                <Search style={{ flexGrow: 1 }} isRound={!!props.sortOptions} onChangeText={v => setSearch(v)} />
                {props.sortOptions && <IconButton
                    icon={findAssetId("ArrowsUpDownIcon")}
                    variant="tertiary"
                    disabled={!!query}
                    onPress={() => showSimpleActionSheet({
                        key: "AddonListSortOptions",
                        header: {
                            title: "Sort Options",
                            onClose: () => hideActionSheet("AddonListSortOptions"),
                        },
                        options: Object.entries(props.sortOptions!).map(([name, fn]) => ({
                            label: name,
                            onPress: () => setSortFn(() => fn)
                        }))
                    })}
                />}
            </View>
            {props.isEnabled && <TableSwitchRow label="Enabled only" value={enabledOnly} onValueChange={setEnabledOnly} />}
            {props.filterOptions && <Button variant="secondary" size="sm" text={filter || "All plugins"}
                onPress={() => showSimpleActionSheet({
                    key: "AddonListFilters",
                    header: { title: "Filter plugins", onClose: () => hideActionSheet("AddonListFilters") },
                    options: ["", ...Object.keys(props.filterOptions!)].map(name => ({
                        label: name || "All plugins",
                        onPress: () => setFilter(name),
                    })),
                })} />}
            {props.ListHeaderComponent && <props.ListHeaderComponent />}
        </View>
    );

    return (
        <ErrorBoundary>
            <FlashList
                data={results}
                extraData={search}
                keyExtractor={props.getItemKey ? ({ obj }: { obj: T; }) => props.getItemKey!(obj) : undefined}
                keyboardShouldPersistTaps="handled"
                estimatedItemSize={136}
                ListHeaderComponent={headerElement}
                ListEmptyComponent={() => <View style={{ gap: 12, padding: 12, alignItems: "center" }}>
                    <Image source={findAssetId("devices_not_found")!} />
                    <Text variant="text-lg/semibold" color="text-default">
                        {filter ? "No plugins match these filters." : enabledOnly && !query ? "No add-ons are enabled." : "No add-ons found."}
                    </Text>
                    {(filter || enabledOnly) && <Button variant="secondary" size="sm" text="Clear filters" onPress={() => {
                        setFilter("");
                        setEnabledOnly(false);
                    }} />}
                </View>}
                contentContainerStyle={{ padding: 8, paddingHorizontal: 12, paddingBottom: 90 }}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                ListFooterComponent={props.ListFooterComponent}
                renderItem={({ item }: any) => <CardComponent item={item.obj} result={item} />}
            />
            {props.installAction && <FloatingActionButton
                positionBottom={bottomInset + 8}
                icon={findAssetId("PlusLargeIcon")}
                onPress={onInstallPress}
            />}
        </ErrorBoundary>
    );
}
