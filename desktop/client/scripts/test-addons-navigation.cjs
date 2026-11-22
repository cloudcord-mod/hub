const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const esbuild = require("esbuild");
const { loadCxRuntime } = require("./sync-cx-catalog.cjs");
let active, visibility = {};
const imported = [];
const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
        active ??= initial();
        return [active, value => { active = value; }];
    },
};
const moduleObject = { exports: {} };
const mocks = {
    "./styles.css": {},
    "@webpack/common": { React },
    "@api/Settings": { useSettings: () => ({ plugins: { Settings: visibility } }) },
    "@utils/css": { classNameFactory: prefix => suffix => prefix + suffix },
    "../BaseTab": { wrapTab: page => page },
    "@components/Icons": Object.fromEntries(["CloudIcon", "PaintbrushIcon", "PluginIcon", "PluginsIcon"].map(name => [name, name])),
    "@components/ErrorBoundary": { __esModule: true, default: "Boundary" },
    "./AddonPage": { listablePlugins: () => [], PluginsPage: "Plugins", ThemesPage: "Themes" },
};
const realm = { module: moduleObject, exports: moduleObject.exports, require(name) {
    if (name in mocks) return mocks[name];
    imported.push(name);
    throw new Error("broken optional page");
} };
vm.runInNewContext(esbuild.transformSync(fs.readFileSync("src/components/settings/tabs/addons/index.tsx", "utf8"), { loader: "tsx", format: "cjs" }).code, realm);
const { default: Addons, setNextAddonsTab } = moduleObject.exports;

const tabs = tree => tree?.props.children[0].props.children[0] ?? [];
const labels = tree => Array.from(tabs(tree), button => button.props.children[1].props.children[0]);
assert.deepEqual(labels(Addons()), ["Plugins", "Themes"]);
assert.equal(imported.length, 0);
assert.equal(Addons().props.children[1].props.children[0].type, "Boundary");

const tabButtons = tabs(Addons());
const focused = [];
const controls = Array.from(tabButtons, ({ props }, index) => ({
    focus: () => focused.push(index),
    click: props.onClick,
}));
const tablist = { querySelectorAll: () => controls };
for (const button of controls) button.parentElement = tablist;
let prevented = false;
tabButtons[0].props.onKeyDown({
    key: "ArrowRight",
    currentTarget: controls[0],
    preventDefault: () => { prevented = true; },
});
assert.equal(prevented, true);
assert.deepEqual(focused, [1]);
assert.equal(tabs(Addons())[1].props["aria-selected"], true);
assert.equal(Addons().props.children[1].props["aria-labelledby"], "cloudcord-addons-themes");

setNextAddonsTab("Themes");
active = undefined;
assert.equal(tabs(Addons())[1].props["aria-selected"], true);
visibility = { showThemesTab: false };
assert.deepEqual(labels(Addons()), ["Plugins"]);
assert.equal(tabs(Addons())[0].props["aria-selected"], true);
visibility = { showPluginsTab: false, showThemesTab: false };
assert.equal(Addons(), null);
assert.equal(imported.length, 0);

const countModule = { exports: {} };
let cursor = 0;
const states = [];
const commonHooks = {
    useEffect() {}, useMemo: fn => fn(),
    useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = value; }];
    },
};
const nativePlugins = {
    same: { name: "Shared", description: "Native version" },
    disabled: { name: "Disabled", description: "Off", tags: ["Local media", "History"] },
    hidden: { name: "Hidden", description: "Internal", required: true },
};
const catalog = {
    plugin: [
        { id: "plugin:Shared", name: "Shared", description: "Catalog version", active: true },
        { id: "plugin:Local", name: "Local", description: "Off", commands: ["off"], active: false, privateCommands: true },
        { id: "plugin:Disabled", name: "Disabled", description: "Changed after approval", commands: ["turnoff"], active: false, needsReview: true },
    ],
    theme: [{ id: "theme", name: "Palette", active: true }],
};
const cxSearch = loadCxRuntime();
const countMocks = {
    "@api/PluginManager": { plugins: nativePlugins, isPluginEnabled: name => name === "Shared" },
    "@api/Settings": { useSettings: () => ({ enabledThemes: ["a.css"], enabledThemeLinks: ["file"] }) },
    "@sincordplugins/cxExtensions": { useCxAddonRows: (kind, query) => {
        assert.equal(query, "");
        return catalog[kind];
    } },
    "@utils/cx": cxSearch,
    "@utils/css": mocks["@utils/css"],
    "@webpack/common": commonHooks,
    "@components/settings/AddonCard": { AddonCard: "CatalogCard" },
    "../plugins/PluginCard": { PluginCard: "NativeCard" },
};
const addonSource = fs.readFileSync("src/components/settings/tabs/addons/AddonPage.tsx", "utf8");
vm.runInNewContext(esbuild.transformSync(addonSource, { loader: "tsx", format: "cjs" }).code, {
    module: countModule, React, IS_WEB: true, VencordNative: { pluginHelpers: {} },
    require: name => countMocks[name] ?? {},
});
const { useAddonCounts, PluginsPage } = countModule.exports;
assert.deepEqual({ ...useAddonCounts() }, { plugins: 3, activePlugins: 1, activeThemes: 3 });
const walk = tree => Array.isArray(tree) ? tree.flatMap(walk) : tree?.props ? [tree, ...walk(tree.props.children)] : [];
const renderList = () => { cursor = 0; return walk(PluginsPage()); };
const beforeFiltering = renderList();
assert.ok(beforeFiltering.some(node => node.type === "CatalogCard" && node.props.name === "Local"));
const selectFilter = value => renderList().find(node => node.props["aria-label"] === "Filter plugins").props.onChange({ currentTarget: { value } });
const shownCards = () => renderList().filter(node => node.type === "CatalogCard" || node.type === "NativeCard");
selectFilter("private");
assert.deepEqual(shownCards().map(node => node.props.name), ["Local"]);
selectFilter("review");
assert.deepEqual(shownCards().map(node => node.props.name), ["Disabled"]);
assert.match(shownCards()[0].props.infoButton.props.children.join(""), /Review update/);
selectFilter("all");
const toggle = beforeFiltering.find(node => node.type?.name === "EnabledOnly");
toggle.props.onChange(true);
assert.ok(!renderList().some(node => node.props.name === "Local" || node.props.plugin?.name === "Disabled"));
assert.ok(renderList().some(node => node.props.name === "Shared" || node.props.plugin?.name === "Shared"));
toggle.props.onChange(false);
beforeFiltering.find(node => node.type?.name === "AddonHeader").props.setQuery("/off");
assert.deepEqual(shownCards().map(node => node.props.name), ["Local", "Disabled"]);
beforeFiltering.find(node => node.type?.name === "AddonHeader").props.setQuery("history média");
assert.deepEqual(shownCards().map(node => node.props.plugin?.name), ["Disabled"]);
beforeFiltering.find(node => node.type?.name === "AddonHeader").props.setQuery("local");
assert.deepEqual(shownCards().map(node => node.props.name ?? node.props.plugin?.name), ["Local", "Disabled"]);
catalog.plugin[0].active = false;
catalog.plugin[0].commands = ["shared-command"];
beforeFiltering.find(node => node.type?.name === "AddonHeader").props.setQuery("/shared-command");
assert.deepEqual(shownCards().map(node => node.props.name), ["Shared"], "an enabled native plugin cannot hide a CX command result");
beforeFiltering.find(node => node.type?.name === "AddonHeader").props.setQuery("  missing plugin  ");
assert.deepEqual(shownCards(), []);
assert.ok(renderList().some(node => node.props.children.includes("No plugins match “missing plugin”.")));

const mobileModule = { exports: {} };
let filterSheet;
const mobileMocks = {
    react: { ...commonHooks, useCallback: callback => callback },
    "react-native": { View: "View", Image: "Image" },
    "@lib/api/settings": { settings: {} },
    "@lib/api/assets": { findAssetId: () => 1 },
    "@lib/utils/lazy": { lazyDestructure: factory => factory() },
    "@metro": { findByProps: () => ({ showSimpleActionSheet: args => { filterSheet = args; } }) },
    "@metro/common": { NavigationNative: { useNavigation: () => ({}) } },
    "@metro/common/components": {
        FlashList: "FlashList", Text: "Text", Button: "Button", TableSwitchRow: "Switch", useSafeAreaInsets: () => ({ bottom: 0 }),
    },
    "@ui/components": { ErrorBoundary: "Boundary", Search: "Search" },
    "es-toolkit": { isNotNil: value => value != null },
    fuzzysort: { go: (_, rows) => rows.map(obj => ({ obj })) },
};
vm.runInNewContext(esbuild.transformSync(fs.readFileSync("../../ios/runtime/src/core/ui/components/AddonPage.tsx", "utf8"),
    { loader: "tsx", format: "cjs" }).code, {
    module: mobileModule, React, require: name => mobileMocks[name] ?? {},
});
states.length = 0;
const MobileAddonPage = mobileModule.exports.default;
const mobileItems = [{ name: "Native" }, { name: "Command", privateCommands: true, alternate: true }, { name: "Changed", needsReview: true }];
const mobileList = () => {
    cursor = 0;
    return walk(MobileAddonPage({
        CardComponent: "Card", title: "Plugins", items: mobileItems, searchKeywords: ["name"],
        getItemKey: row => row.name,
        searchCommands: (rows, query) => rows.filter(row => "/" + row.name.toLowerCase() === query),
        filterOptions: { "Private commands": row => row.privateCommands, "Needs review": row => row.needsReview },
        defaultFilter: row => !row.alternate,
    })).find(node => node.type === "FlashList");
};
const mobileRows = () => Array.from(mobileList().props.data, entry => entry.obj.name);
const selectMobileFilter = label => {
    const header = mobileList().props.ListHeaderComponent;
    walk(header).find(node => node.type === "Button").props.onPress();
    filterSheet.options.find(option => option.label === label).onPress();
};
assert.deepEqual(mobileRows(), ["Native", "Changed"]);
assert.equal(mobileList().props.keyExtractor(mobileList().props.data[1]), "Changed");
assert.equal(mobileList().props.keyboardShouldPersistTaps, "handled");
const searchMobile = value => walk(mobileList().props.ListHeaderComponent)
    .find(node => node.type === "Search").props.onChangeText(value);
searchMobile("  /changed  ");
assert.deepEqual(mobileRows(), ["Changed"], "slash search uses the command matcher");
selectMobileFilter("Private commands");
assert.deepEqual(mobileRows(), [], "slash search respects the selected filter");
walk(mobileList().props.ListEmptyComponent()).find(node => node.props.text === "Clear filters").props.onPress();
assert.deepEqual(mobileRows(), ["Changed"], "clear filters keeps the current search");
searchMobile("/command");
assert.deepEqual(mobileRows(), ["Command"], "command search includes alternate plugins");
selectMobileFilter("Needs review");
assert.deepEqual(mobileRows(), [], "alternate command results still respect explicit filters");
selectMobileFilter("Private commands");
searchMobile("");
assert.deepEqual(mobileRows(), ["Command"]);
selectMobileFilter("Needs review");
assert.deepEqual(mobileRows(), ["Changed"]);
mobileItems.length = 0;
assert.deepEqual(mobileRows(), [], "an empty filter must leave the filter controls available");
selectMobileFilter("All plugins");
assert.equal(filterSheet.header.title, "Filter plugins");
console.log("PASS desktop and mobile Add-ons navigation, private command filtering and review visibility");
