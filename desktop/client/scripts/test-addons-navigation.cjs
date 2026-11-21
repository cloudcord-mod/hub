const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const esbuild = require("esbuild");
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
    disabled: { name: "Disabled", description: "Off" },
    hidden: { name: "Hidden", description: "Internal", required: true },
};
const catalog = {
    plugin: [
        { id: "plugin:Shared", name: "Shared", description: "Catalog version", active: true },
        { id: "plugin:Local", name: "Local", description: "Off", active: false },
    ],
    theme: [{ id: "theme", name: "Palette", active: true }],
};
const countMocks = {
    "@api/PluginManager": { plugins: nativePlugins, isPluginEnabled: name => name === "Shared" },
    "@api/Settings": { useSettings: () => ({ enabledThemes: ["a.css"], enabledThemeLinks: ["file"] }) },
    "@sincordplugins/cxExtensions": { useCxAddonRows: kind => catalog[kind] },
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
const toggle = beforeFiltering.find(node => node.type?.name === "EnabledOnly");
toggle.props.onChange(true);
assert.ok(!renderList().some(node => node.props.name === "Local" || node.props.plugin?.name === "Disabled"));
assert.ok(renderList().some(node => node.props.name === "Shared" || node.props.plugin?.name === "Shared"));
console.log("PASS Add-ons tabs, keyboard navigation, visibility and CX list filtering");
