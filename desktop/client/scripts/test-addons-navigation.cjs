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
const tabs = ["Plugins", "Tweaks", "Themes", "CX Extensions", "Sync", "Extras"];
assert.deepEqual(labels(Addons()), tabs);
assert.equal(imported.length, 0);

for (const [name, path] of [
    ["CX Extensions", "@sincordplugins/cxExtensions"],
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
setNextAddonsTab("CX Extensions");
active = undefined;
assert.equal(Addons().props.children[0].props.children[0][3].props["aria-selected"], true);

visibility = { showPluginsTab: false, showThemesTab: false, showCloudSyncTab: false };
assert.deepEqual(labels(Addons()), ["Tweaks", "CX Extensions", "Extras"]);
tester = { label: "Desktop 2" };
const importsBeforeTesting = imported.length;
const testingTabs = Addons();
assert.deepEqual(labels(testingTabs), ["Tweaks", "CX Extensions", "Testing Plugins", "Extras"]);
testingTabs.props.children[0].props.children[0][2].props.onClick();
const testingPage = Addons().props.children[1].props.children[0];
assert.equal(imported.length, importsBeforeTesting);
assert.throws(() => testingPage.props.children[0].type(), /broken optional page/);
assert.equal(imported.at(-1), "./TestingPlugins");
tester = undefined;
assert(!labels(Addons()).includes("Testing Plugins"));
console.log("PASS Add-ons tabs, tester visibility and optional page isolation");
