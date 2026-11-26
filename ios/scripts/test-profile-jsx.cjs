const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const esbuild = require(process.env.CLOUDCORD_ESBUILD || 'esbuild');
const source = fs.readFileSync('ios/runtime/src/lib/api/react/jsx.ts', 'utf8');
const patches = {};
let platform = "ios";
const context = vm.createContext({
    exports: {}, module: { exports: {} },
    require: name => name === '@lib/api/patcher' ? { after: (method, parent, callback) => { patches[method] = callback; return () => {}; } } : name === 'react-native' ? { Platform: { OS: platform } } : { findByPropsLazy: () => ({}) },
});
vm.runInContext(esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code, context);
const api = context.module.exports;
let seen = 0;
api.onJsxCreate('ProfileHeader', (component, element) => { seen++; return { ...element, matched: component }; });
api.patchJsx();
function ProfileHeader() {}
function shortened() {}
shortened.displayName = 'ProfileHeader';
const forwarded = { $$typeof: Symbol.for('react.forward_ref'), render: () => {}, displayName: 'ProfileHeader' };
for (const component of [ProfileHeader, shortened, { $$typeof: Symbol.for('react.memo'), type: shortened }, forwarded,
    { $$typeof: Symbol.for('react.memo'), type: forwarded }]) {
    const result = patches.jsx([component], { type: component, props: {} });
    assert.equal(typeof result.matched, 'function');
}
assert.equal(seen, 5);
const privateComponent = { $$typeof: Symbol.for('react.forward_ref'), render: () => {} };
const identityHook = (_component, element) => ({ ...element, matchedByIdentity: true });
api.onJsxCreate(privateComponent, identityHook, true);
assert.equal(patches.jsxs([privateComponent], { type: privateComponent, props: {} }).matchedByIdentity, true);
assert.equal(patches.jsxs([{ ...privateComponent }], { type: privateComponent, props: {} }), undefined);
api.deleteJsxCreate(privateComponent, identityHook, true);
assert.equal(patches.jsxs([privateComponent], { type: privateComponent, props: {} }), undefined);
assert.equal(patches.jsx(['RCTText'], { type: 'RCTText', props: {} }), undefined);
assert.equal(patches.jsx([{}], { type: {}, props: {} }), undefined);
function FrozenHeader() {}
const frozenProps = Object.freeze({ userId: '123', children: 'native' });
const frozenElement = Object.freeze({ type: FrozenHeader, props: frozenProps });
api.onJsxCreate('FrozenHeader', (_component, element) => { element.props.children = 'custom'; });
const cloned = patches.jsx([FrozenHeader], frozenElement);
assert.equal(cloned.props.children, 'custom', 'profile hooks can edit a presentation copy even when React freezes native props');
assert.equal(frozenProps.children, 'native');
assert.notEqual(cloned, frozenElement);
const visibility = (_component, element) => ({ ...element, finalChild: element.props.children });
api.onJsxCreate('FrozenHeader', visibility, true);
api.onJsxCreate('FrozenHeader', (_component, element) => { element.props.children = 'later hook'; });
assert.equal(patches.jsx([FrozenHeader], frozenElement).finalChild, 'later hook');
api.deleteJsxCreate('FrozenHeader', visibility, true);
assert.equal(patches.jsx([FrozenHeader], frozenElement).finalChild, undefined);
function BrokenHeader() {}
api.onJsxCreate('BrokenHeader', (_component, element) => { element.props.children = 'partial'; throw Error('hook failed'); });
api.onJsxCreate('BrokenHeader', (_component, element) => { element.props.after = 'working'; });
const recovered = patches.jsx([BrokenHeader], { type: BrokenHeader, props: { children: 'native' } });
assert.equal(recovered.props.children, 'native', 'a failed callback cannot publish partially modified props');
assert.equal(recovered.props.after, 'working', 'one failed callback does not block unrelated hooks');
function RemovedHeader() {}
let called = 0;
const registered = () => { called++; };
api.onJsxCreate('RemovedHeader', registered);
api.deleteJsxCreate('RemovedHeader', () => {});
patches.jsx([RemovedHeader], { type: RemovedHeader, props: {} });
assert.equal(called, 1, 'removing an unknown callback cannot remove the last registered hook');
api.deleteJsxCreate('RemovedHeader', registered);
patches.jsx([RemovedHeader], { type: RemovedHeader, props: {} });
assert.equal(called, 1);
const invalid = Object.freeze({ type: undefined, props: frozenProps });
assert.equal(patches.jsx([undefined], invalid).type, 'RCTView');
assert.equal(invalid.type, undefined);
console.log('PASS: named, displayName and memoized profile hooks match; unrelated elements are untouched.');

// Android overlay lists keep their original data, callbacks, and keys.
function FlatList() {}
function GifFavoritesGrid() {}
function MentionAutocompleteList() {}
function MasonryFlashList() {}
function SectionList() {}
function UnrelatedComponent() {}
const data = Object.freeze([{id: '1'}, {id: '2'}]);
const renderItem = () => null;
const props = Object.freeze({ data, renderItem, removeClippedSubviews: true });
const element = Object.freeze({ type: FlatList, key: 'list', props });
assert.equal(patches.jsx([FlatList], element), undefined, 'iOS is unchanged');
for (const component of [GifFavoritesGrid, MentionAutocompleteList]) {
    assert.equal(patches.jsx([component], { ...element, type: component }).props.removeClippedSubviews, false);
}
platform = 'android';
api.patchJsx();
for (const component of [FlatList, GifFavoritesGrid, MentionAutocompleteList, MasonryFlashList,
    { $$typeof: Symbol.for('react.memo'), type: FlatList }]) {
    const input = Object.freeze({ ...element, type: component });
    const fixed = patches.jsx([component], input);
    assert.equal(fixed.props.removeClippedSubviews, false);
    assert.equal(fixed.props.data, data);
    assert.equal(fixed.props.renderItem, renderItem);
    assert.equal(fixed.key, 'list');
    assert.equal(input.props.removeClippedSubviews, true);
}
const sections = [{ data }];
assert.equal(patches.jsxs([SectionList], {type: SectionList, props: {sections, renderItem}}).props.removeClippedSubviews, false);
assert.equal(patches.jsx([UnrelatedComponent], element), undefined);
assert.equal(patches.jsx([FlatList], {type: FlatList, props: {...props, data: Array(257)}}), undefined);
assert.equal(patches.jsx([FlatList], {type: FlatList, props: {...props, removeClippedSubviews: false}}), undefined);
assert.equal(patches.jsx([FlatList], {type: FlatList, props: {data}}), undefined);
console.log('PASS: bounded GIF and mention list clipping guard on iOS and Android.');
