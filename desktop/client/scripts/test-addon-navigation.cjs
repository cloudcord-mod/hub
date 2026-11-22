const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const desktop = fs.readFileSync('src/plugins/_core/settings.tsx', 'utf8');
assert.match(desktop, /diagnostics=\{diagnosticsMode === true\}/);
const layoutSource = desktop.slice(desktop.indexOf('    buildLayout(originalLayoutBuilder:'), desktop.indexOf('    addControlsToDeveloperPage(layout:'));
const layoutState = { showCloudCordSection: true, showSectionHeading: true, showFakeProfileTab: true, settingsLocation: 'top' };
let assignedTester = false;
const layoutContext = vm.createContext({ settings: { store: layoutState }, LayoutTypes: { SECTION: 1 }, isTruthy: Boolean,
    VencordTab: 'overview', BotCordTab: 'bot', FakeProfileTab: 'profile', AddonsTab: 'addons', CloudCordDiagnosticsTab: 'diagnostics',
    TweaksTab: 'tweaks', ToolsTab: 'tools', CloudSyncTab: 'sync', TestingPluginsTab: 'testing',
    currentAssignment: () => assignedTester, InfoIcon: 'icon', RobotIcon: 'icon', UserIcon: 'icon', PluginsIcon: 'icon',
    MainSettingsIcon: 'icon', PaintbrushIcon: 'icon', EyeIcon: 'icon', CloudIcon: 'icon' });
vm.runInContext(esbuild.transformSync(`globalThis.builder = { ${layoutSource} };`, { loader: 'ts' }).code, layoutContext);
layoutContext.builder.buildEntry = options => options;
layoutContext.builder.addControlsToDeveloperPage = () => {};
for (const enabled of [undefined, false, true, false]) {
    layoutState.diagnosticsMode = enabled;
    layoutState.showCloudSyncTab = assignedTester = enabled === true;
    const layout = layoutContext.builder.buildLayout({ key: '$Root', buildLayout: () => [{ key: 'user_section' }] });
    const entries = layout.find(node => node.key === 'cloudcord_section').buildLayout();
    assert.deepEqual(Array.from(entries, node => node.key),
        ['cloudcord_main', 'cloudcord_fake_profile', 'cloudcord_cloud_sync', 'cloudcord_tools']);
    assert.ok(entries.some(node => node.key === 'cloudcord_cloud_sync' && node.Component === 'addons'));
    assert.equal(entries.filter(node => node.key === 'cloudcord_tools' && node.Component === 'tools').length, 1);
    assert.ok(!entries.some(node => ['cloudcord_previews', 'cloudcord_account_tools'].includes(node.key)));
}
const mobile = fs.readFileSync('../../ios/runtime/src/core/ui/settings/index.ts', 'utf8');
const mobileTools = fs.readFileSync('../../ios/runtime/src/core/ui/settings/pages/Tools/index.tsx', 'utf8');
assert.match(mobileTools, /visible: preferences\.cloudcordDiagnosticsEnabled === true/);
assert.match(mobileTools, /findAssetId\("CloudIcon"\)/);
assert.doesNotMatch(mobileTools, /PupuIcon/);
const mobileState = {}, sections = [];
const mobileContext = vm.createContext({ settings: mobileState, PupuIcon: 'icon', Strings: { THEMES: 'Themes', FONTS: 'Fonts' }, version: 'test',
    findAssetId: () => 1, isThemeSupported: () => true, isFontSupported: () => true, useProxy: value => value, registerSection: section => sections.push(section) });
const mobileSource = mobile.replace(/^import .*;\r?\n/gm, '').replace('export { PupuIcon };', '').replace('export default function initSettings', 'function initSettings');
vm.runInContext(esbuild.transformSync(mobileSource, { loader: 'ts' }).code, mobileContext);
mobileContext.initSettings();
const mobileRows = sections.find(section => section.name === 'CloudCord').items;
assert.deepEqual(Array.from(mobileRows.filter(row => !row.nativeSection), row => row.key),
    ['CLOUDCORD', 'BUNNY_PLUGINS', 'CLOUDCORD_TOOLS']);
const workflow = fs.readFileSync('../../.github/workflows/cloudcord.yml', 'utf8');
assert.match(workflow, /items\.append\(fake_profile_item\)/);
assert.doesNotMatch(workflow, /items\.append\((?:store_cloud|botcord|diagnostics)_item\)/);
const toolsRow = mobileRows.find(row => row.key === 'CLOUDCORD_TOOLS');
assert.equal(toolsRow.usePredicate(), true);
mobileState.cloudcordSectionHidden = true;
assert.equal(toolsRow.usePredicate(), false);
console.log('PASS desktop and mobile settings placement and conditional entries');
