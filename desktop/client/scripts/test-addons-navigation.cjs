const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const esbuild = require("esbuild");
let active, visibility = {}, tester;
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
    "./TweaksPage": { tweakPlugins: () => [], TweaksPage: "Tweaks" },
    "./testingAccess": { useTestingPluginsAssignment: () => tester },
};
const realm = { module: moduleObject, exports: moduleObject.exports, require(name) {
    if (name in mocks) return mocks[name];
    imported.push(name);
    throw new Error("broken optional page");
} };
vm.runInNewContext(esbuild.transformSync(fs.readFileSync("src/components/settings/tabs/addons/index.tsx", "utf8"), { loader: "tsx", format: "cjs" }).code, realm);
const { default: Addons, setNextAddonsTab } = moduleObject.exports;

const labels = tree => Array.from(tree.props.children[0].props.children[0], button => button.props.children[1].props.children[0]);
const tabs = ["Plugins", "Tweaks", "Themes", "Sync", "Extras"];
assert.deepEqual(labels(Addons()), tabs);
assert.equal(imported.length, 0);

for (const [name, path] of [
    ["Sync", "../sync/CloudTab"],
    ["Extras", "../extras"],
]) {
    const importsBefore = imported.length;
    const buttons = Addons().props.children[0].props.children[0];
    buttons[tabs.indexOf(name)].props.onClick();
    const tree = Addons();
    assert.equal(imported.length, importsBefore, "Selecting a tab does not eagerly import its page");
    assert.deepEqual(labels(tree), tabs, "Navigation stays outside the page boundary");
    const boundary = tree.props.children[1].props.children[0];
    assert.equal(boundary.type, "Boundary");
    assert.throws(() => boundary.props.children[0].type(), /broken optional page/);
    assert.equal(imported.at(-1), path);
}
setNextAddonsTab("Themes");
active = undefined;
assert.equal(Addons().props.children[0].props.children[0][2].props["aria-selected"], true);

visibility = { showPluginsTab: false, showThemesTab: false, showCloudSyncTab: false };
assert.deepEqual(labels(Addons()), ["Tweaks", "Extras"]);
tester = { label: "Desktop 2" };
const importsBeforeTesting = imported.length;
const testingTabs = Addons();
assert.deepEqual(labels(testingTabs), ["Tweaks", "Testing Plugins", "Extras"]);
testingTabs.props.children[0].props.children[0][1].props.onClick();
const testingPage = Addons().props.children[1].props.children[0];
assert.equal(imported.length, importsBeforeTesting);
assert.throws(() => testingPage.props.children[0].type(), /broken optional page/);
assert.equal(imported.at(-1), "./TestingPlugins");
tester = undefined;
assert(!labels(Addons()).includes("Testing Plugins"));

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
console.log("PASS Add-ons tabs, tester visibility and optional page isolation");
