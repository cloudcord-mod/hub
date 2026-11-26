const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), esbuild = require('esbuild');
const compile = file => esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'tsx', format: 'cjs' }).code;
const React = { memo: fn => fn, useMemo: fn => fn(), createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
const alerts = [], navigations = [];
const history = [{ name: 'PUPU_CUSTOM_PAGE', params: { title: 'Add-ons' } }];
const navigation = {
    navigate: (name, params) => { navigations.push([name, params]); const previous = history.findLast(entry => entry.name === name); if (previous) previous.params = params; else history.push({ name, params }); },
    push: (name, params) => { navigations.push([name, params]); history.push({ name, params }); },
    isFocused: () => true
};
const common = { React, NavigationNative: { useNavigation: () => navigation }, ReactNative: { Alert: { alert: (...args) => alerts.push(args) } } };
const shared = { module: { exports: {} }, React, require: name => name === '@metro/common' ? common : name === '@lib/utils/asyncTimeout' ? { withTimeout: p => p } : name === '@metro/wrappers' ? { findByPropsLazy: () => ({}) } : {} };
vm.runInNewContext(compile('ios/runtime/src/lib/ui/settings/patches/shared.tsx'), shared);
let fail = true, imports = 0;
const Plugin = () => null;
const page = { module: { exports: {} }, React, require: name => {
    if (name === '@metro/common') return common;
    if (name === '@metro/common/components') return { Stack: 'Stack', TableRow: Object.assign(() => null, { Icon: 'Icon' }), TableRowGroup: 'Group' };
    if (name === 'react-native') return { ScrollView: 'ScrollView' };
    if (name === '@lib/api/native/loader') return { isThemeSupported: () => false, isFontSupported: () => false };
    if (name === '@lib/api/assets') return { findAssetId: () => 1 };
    if (name === '@lib/ui/settings/patches/shared') return shared.module.exports;
    if (name === '@core/ui/settings/pages/Plugins') { imports++; if (fail) throw Error('plugin page unavailable'); return { default: Plugin }; }
    return {};
} };
vm.runInNewContext(compile('ios/runtime/src/core/ui/settings/pages/Addons/index.tsx'), page);
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children || []).flat(Infinity).flatMap(walk)];
(async () => {
    const rows = walk(page.module.exports.default());
    const installed = rows.find(n => n.props?.label === 'Plugins');
    assert(installed, 'Plugins row must exist');
    assert.equal(rows.some(n => n.props?.label === 'CX Extensions'), false);
    await installed.props.onPress();
    assert.equal(navigations.length, 0, 'a failed import must not navigate into a crashing screen');
    assert.equal(alerts.length, 1, 'load failure offers the existing error/retry alert');
    fail = false;
    const before = imports;
    await Promise.all([installed.props.onPress(), installed.props.onPress()]);
    assert.equal(imports - before, 1, 'repeated taps share the in-flight page load');
    assert.equal(navigations.length, 1);
    assert.equal(navigations[0][0], 'PUPU_CUSTOM_PAGE');
    assert.equal(navigations[0][1].render().type, Plugin);
    assert.equal(history.length, 2, 'a nested add-on page must push a separate screen, not replace the Add-ons screen');
    history.pop();
    assert.equal(history[0].params.title, 'Add-ons', 'Back must return to the original Add-ons screen');
    const lazy = { module: { exports: {} }, __DEV__: false };
    vm.runInNewContext(compile('ios/runtime/src/lib/utils/lazy.ts'), lazy);
    let lookups = 0;
    const browser = { module: { exports: {} }, React, require: name => name === '@metro/common' ? common : name === '@lib/utils/lazy' ? lazy.module.exports : name === '@metro' ? { findByProps: () => { lookups++; return undefined; } } : {} };
    vm.runInNewContext(compile('ios/runtime/src/core/ui/settings/pages/PluginBrowser/index.tsx'), browser);
    assert.equal(typeof browser.module.exports.default, 'function');
    assert.equal(lookups, 0, 'loading the marketplace must not eagerly resolve an unavailable action-sheet module');

    let cursor = 0;
    const state = [];
    const addonList = { module: { exports: {} }, React, require(name) {
        if (name === 'react') return {
            useCallback: fn => fn, useEffect() {}, useMemo: fn => fn(),
            useState(initial) {
                const index = cursor++;
                if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
                return [state[index], value => { state[index] = value; }];
            },
        };
        if (name === '@metro/common') return common;
        if (name === '@lib/api/settings') return { settings: {} };
        if (name === '@lib/api/assets') return { findAssetId: () => 1 };
        if (name === '@lib/utils/lazy') return { lazyDestructure: () => ({}) };
        if (name === '@metro/common/components') return { FlashList: 'FlashList', Button: 'Button', useSafeAreaInsets: () => ({ bottom: 0 }) };
        if (name === 'es-toolkit') return { isNotNil: value => value != null };
        if (name === 'fuzzysort') return { go: (query, items) => items.filter(item => item.name.includes(query)).map(obj => ({ obj })) };
        return {};
    } };
    vm.runInNewContext(compile('ios/runtime/src/core/ui/components/AddonPage.tsx'), addonList);
    const items = [{ name: 'first', enabled: true }, { name: 'second', enabled: false }];
    const renderPage = () => {
        cursor = 0;
        return walk(addonList.module.exports.default({ title: 'Plugins', items, isEnabled: item => item.enabled, searchKeywords: ['name'] }));
    };
    const renderList = () => renderPage().find(node => node.type === 'FlashList');
    const filter = status => renderPage().find(node => node.type === 'Button' && node.props.text === status);
    assert.equal(renderList().props.data.length, 2);
    filter('Enabled').props.onPress();
    assert.deepEqual(renderList().props.data.map(item => item.obj.name), ['first']);
    items[0].enabled = false;
    assert.equal(renderList().props.data.length, 0, 'the list stays open when the last enabled plugin is turned off');
    filter('Disabled').props.onPress();
    assert.equal(renderList().props.data.length, 2);
    filter('All').props.onPress();
    assert.equal(renderList().props.data.length, 2);
    let themeCursor = 0;
    let effectKey;
    let cleanup;
    let fetchFails = true;
    let releaseInstall;
    let installs = 0;
    const themeState = [];
    const wallpaper = "https://example.com/wallpaper.json";
    const monochrome = "https://example.com/mono.json";
    const library = {};
    let active = null;
    const storeReact = {
        ...React,
        useState(initial) {
            const index = themeCursor++;
            if (!(index in themeState)) themeState[index] = initial;
            return [themeState[index], value => { themeState[index] = typeof value === "function" ? value(themeState[index]) : value; }];
        },
        useRef(value) {
            const [ref] = this.useState({ current: value });
            return ref;
        },
        useEffect(effect, [key]) {
            if (key === effectKey) return;
            cleanup?.();
            effectKey = key;
            cleanup = effect();
        },
    };
    const store = { module: { exports: {} }, React: storeReact, require(name) {
        if (name === "@metro/common") return { React: storeReact };
        if (name === "@metro/common/components") return { Button: "Button", FlashList: "FlashList", Text: "Text" };
        if (name === "@lib/api/assets") return { findAssetId: () => 1 };
        if (name === "@ui/toasts") return { showToast() {} };
        if (name === "@lib/utils/safeFetch") return async url => {
            if (fetchFails) throw new Error("Offline");
            return { json: async () => url.includes("kmmiio99o")
                ? [{ installUrl: monochrome, name: "Monochrome" }]
                : { themes: [{ id: wallpaper, name: "Wallpaper", hasBackground: true, authors: ["Alice", 42] }, null] } };
        };
        if (name === "@lib/addons/themes") return {
            themes: library, getCurrentTheme: () => active,
            installTheme: async url => { installs++; await new Promise(resolve => { releaseInstall = resolve; }); library[url] = { id: url }; },
            selectTheme: theme => { active = theme; },
            removeTheme: url => { delete library[url]; },
        };
        return {};
    } };
    vm.runInNewContext(compile('ios/runtime/src/core/ui/settings/pages/ThemeStore/index.tsx'), store);
    const renderStore = () => { themeCursor = 0; return walk(store.module.exports.default()); };
    const button = label => renderStore().find(node => node.type === "Button" && node.props.text === label);
    const themeList = () => renderStore().find(node => node.type === "FlashList").props;
    const settle = () => new Promise(resolve => setImmediate(resolve));
    renderStore();
    await settle();
    fetchFails = false;
    button("Try again").props.onPress();
    renderStore();
    await settle();
    assert.equal(themeList().data.length, 2);
    button("With backgrounds").props.onPress();
    assert.deepEqual(Array.from(themeList().data, theme => theme.name), ["Wallpaper"]);
    button("Installed only").props.onPress();
    assert.equal(themeList().data.length, 0);
    button("Installed only").props.onPress();
    const row = themeList().renderItem({ item: themeList().data[0] }).props;
    const installing = row.change(row.theme, "use");
    await row.change(row.theme, "use");
    assert.equal(installs, 1, "duplicate taps must share one theme install");
    releaseInstall();
    await installing;
    assert.equal(active.id, wallpaper);
    button("Installed only").props.onPress();
    assert.equal(themeList().data.length, 1);
    await row.change(row.theme, "reset");
    assert.equal(active, null);
    assert.equal(themeList().data.length, 1, "restoring Discord's default must preserve the installed theme");
    const browserFile = 'ios/runtime/src/core/ui/settings/pages/PluginBrowser/index.tsx';
    vm.runInNewContext(compile(browserFile) + "\nmodule.exports.parsePluginIndex = parsePluginIndex;", { ...browser, URL });
    const normalizeIndex = browser.module.exports.parsePluginIndex;
    const sample = normalizeIndex({ OFFICIAL_PLUGINS: [
        { name: "One", installUrl: "https://example.org/one", status: " Working ", authors: ["Author", false] },
        { name: "Duplicate", installUrl: "https://example.org/one/" },
        { name: "Invalid", installUrl: "https://example.org/two?other=1" },
        null,
    ] });
    assert.equal(sample.length, 1, "duplicate catalog URLs must give one install card");
    assert.equal(sample[0].installUrl, "https://example.org/one/");
    assert.equal(sample[0].status, "working");
    assert.deepEqual(Array.from(sample[0].authors), ["Author"]);
    assert.throws(() => normalizeIndex({ error: true }), /invalid list/);

    const updates = [];
    let manifest = { name: "Plugin", hash: "old", main: "./index.js", authors: [] };
    let download;
    const pluginContext = { module: { exports: {} }, require(name) {
        if (name === "@core/vendetta/storage") return {
            awaitStorage: async () => {}, createMMKVBackend() {}, createStorage: () => ({}),
            purgeStorage: async () => {}, wrapSync: value => value,
        };
        if (name === "@lib/api/settings") return { settings: {} };
        if (name === "@lib/utils/logger") return { logger: { error: (...args) => updates.push(args) } };
        if (name === "@lib/utils/constants") return { VD_PROXY_PREFIX: "legacy:", BUNNY_PROXY_PREFIX: "modern:" };
        return {};
    } };
    vm.runInNewContext(compile('ios/runtime/src/core/vendetta/plugins.ts'), pluginContext);
    const manager = pluginContext.module.exports.VdPluginManager;
    const source = "https://example.org/plugin/";
    const requests = [];
    manager.pluginFetch = async url => {
        requests.push(url);
        return url.endsWith("manifest.json") ? { json: async () => manifest } : { text: download };
    };
    download = async () => "({ old: true })";
    await Promise.all([manager.installPlugin(source.slice(0, -1), false), manager.installPlugin(source, false)]);
    assert.deepEqual(requests, [source + "manifest.json", source + "index.js"]);
    const original = manager.plugins[source];

    manifest = { ...manifest, hash: "new", main: "dist/index.js" };
    download = async () => { throw Error("offline"); };
    await assert.rejects(manager.fetchPlugin(source), /Failed to fetch JS/);
    assert.equal(manager.plugins[source], original, "a failed update must preserve the previous hash and source");
    download = async () => "({ new: true })";
    await manager.fetchPlugin(source);
    assert.equal(manager.plugins[source].manifest.hash, "new");
    assert.equal(manager.plugins[source].js, "({ new: true })");

    manifest = { ...manifest, main: "../index.js" };
    await assert.rejects(manager.fetchPlugin(source), /Invalid plugin manifest/);
    assert.equal(manager.plugins[source].manifest.main, "dist/index.js");

    let finishDownload;
    manifest = { ...manifest, main: "index.js", hash: "latest" };
    download = () => new Promise(resolve => { finishDownload = resolve; });
    const inflight = manager.fetchPlugin(source);
    await new Promise(resolve => setImmediate(resolve));
    await manager.removePlugin(source);
    finishDownload("({ latest: true })");
    await assert.rejects(inflight, /changed during download/);
    assert.equal(manager.plugins[source], undefined, "an update must not restore a removed plugin");

    manager.plugins[source] = { ...original, enabled: false, update: true };
    download = async () => { throw Error("offline"); };
    await manager.initPlugins();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(updates.length, 1);
    assert.equal(manager.plugins[source].manifest.hash, "old");
    console.log('PASS add-on routing, catalog normalization, duplicate installs and failed update recovery');
})().catch(error => { console.error(error); process.exitCode = 1; });
