const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const esbuild = require(process.env.CLOUDCORD_ESBUILD || require.resolve('esbuild', { paths: [require('node:path').resolve('desktop/client'), require('node:path').resolve('ios/runtime')] }));
const id = '1394648991223779328';
const other = '1169999011642605628';
const alternate = '123456789012345678';
const profileAppearance = require('./load-profile-appearance.cjs');
const compile = (source, loader = 'ts') => esbuild.transformSync(source, { loader, format: 'cjs' }).code;
const storage = new Map();
function desktop() {
    const ctx = vm.createContext({ module: { exports: {} }, exports: {}, require: name => name === '@utils/profileAppearance' ? profileAppearance : ({ localStorage: {
        getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)
    } }) });
    vm.runInContext(compile(fs.readFileSync('desktop/client/src/utils/realProfileView.ts', 'utf8')), ctx);
    return ctx.module.exports;
}
let saved = desktop();
assert.equal(saved.isRealProfileView(id, other), false);
saved.setRealProfileView(id, true, other);
assert.equal(saved.isRealProfileView(id, other), true);
assert.equal(saved.isRealProfileView(id, alternate), false);
assert.equal(saved.isRealProfileView(id, null), false);
saved = desktop();
assert.equal(saved.isRealProfileView(id, other), true, 'viewer choice survives reload');
saved.setRealProfileView(id, true, alternate);
saved.setRealProfileView(id, false, other);
assert.equal(saved.isRealProfileView(id, other), false);
assert.equal(saved.isRealProfileView(id, alternate), true);
saved.setRealProfileView('bad id', true, other);
assert.equal(saved.isRealProfileView('bad id', other), false);
storage.delete('CloudCord_realProfileUsersByAccount');
storage.set('CloudCord_realProfileUsers', JSON.stringify([id, other, id, 'invalid']));
saved = desktop();
assert.equal(saved.isRealProfileView(id, null), false, 'logout cannot adopt device-wide legacy choices');
assert.equal(saved.isRealProfileView(id, other), true, 'existing device choices transfer once to the first signed-in account');
assert.equal(saved.isRealProfileView(other, other), false);
assert.equal(desktop().isRealProfileView(id, alternate), false);

const workflow = fs.readFileSync('.github/workflows/cloudcord.yml', 'utf8');
const source = workflow.split("cat > src/core/ui/settings/pages/FakeProfile/index.tsx <<'TSX'")[1].split('\n          TSX')[0].replace(/^          /gm, '');
const helpers = source.slice(source.indexOf('function isRealProfileView('), source.indexOf('function refreshSharedProfiles('));
const profile = Object.freeze({ username: 'custom-name', bio: 'custom bio' });
const root = { fakeProfile: profile };
const hooks = new Map();
const badgeRefreshes = [];
const openedProfiles = [];
let hiddenSheets = 0;
let nativeProfileAvailable = true;
let intercept;
let lastSheet;
const mobile = vm.createContext({ ...profileAppearance, rootSettings: root, settings: {}, sharedProfiles: new Map([[id, profile]]),
    currentUserId: other, isCurrentUser: uid => uid === mobile.currentUserId, clearCache() {}, identityRefreshers: new Set(),
    reapplyBadgeDirectory: uid => badgeRefreshes.push(uid),
    safeStore: () => ({ emitChange() {} }), simpleSheets: { showSimpleActionSheet() {}, hideActionSheet() { hiddenSheets++; } },
    findByName: () => undefined, findByProps: () => nativeProfileAvailable ? {
        showUserProfileActionSheet: options => openedProfiles.push(options),
    } : undefined, setTimeout: fn => fn(),
    instead: (_method, _parent, fn) => { intercept = fn; },
    onJsxCreate: (name, fn) => hooks.set(name, fn), TableRow: 'row',
    createElement: (type, props) => ({ type, props }),
    cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }) });
vm.runInContext(compile(helpers), mobile);
mobile.connectRealProfileMenu();
assert.equal(mobile.getProfileOverride(id), profile);
const originGuild = '1517960356180529162';
const original = { key: 'UserProfileOverflow', userId: id, guildId: originGuild, options: [{ label: 'Block' }] };
intercept([original], sheet => { lastSheet = sheet; });
assert.equal(original.options.length, 1, 'native menu stays immutable');
assert.equal(lastSheet.options.at(-1).label, 'Show real profile');
const previousAccountAction = lastSheet.options.at(-1);
mobile.currentUserId = alternate;
previousAccountAction.onPress();
assert.equal(mobile.getProfileOverride(id), profile, 'a menu left open across account switching cannot mutate the new account');
mobile.currentUserId = other;
lastSheet.options.at(-1).onPress();
assert.equal(mobile.getProfileOverride(id), undefined);
mobile.currentUserId = alternate;
assert.equal(mobile.getProfileOverride(id), profile);
mobile.currentUserId = other;
assert.equal(mobile.getProfileOverride(id), undefined);
assert.equal(root.fakeProfile, profile, 'viewing real profiles cannot edit or publish the owner snapshot');
intercept([original], sheet => { lastSheet = sheet; });
assert.equal(lastSheet.options.at(-1).label, 'Show CloudCord profile');
lastSheet.options.at(-1).onPress();
assert.equal(mobile.getProfileOverride(id), profile, 'switching back restores the retained shared snapshot');
assert.deepEqual(badgeRefreshes, [id, id], 'changing the profile view also refreshes the native directory');
assert.equal(hiddenSheets, 2);
assert.deepEqual(JSON.parse(JSON.stringify(openedProfiles)), [{ userId: id, guildId: originGuild }, { userId: id, guildId: originGuild }]);
nativeProfileAvailable = false;
lastSheet.options.at(-1).onPress();
assert.equal(hiddenSheets, 2, 'a Discord build without an opener keeps the current sheet open');
assert.equal(mobile.getProfileOverride(id), undefined, 'the choice still applies without reopening');
lastSheet.options.at(-1).onPress();
const unrelated = { key: 'ChannelMenu', userId: id, options: [] };
intercept([unrelated], sheet => { lastSheet = sheet; });
assert.equal(lastSheet, unrelated, 'unrelated menus stay untouched');
const own = { key: 'UserProfileOverflow', userId: other, options: [] };
intercept([own], sheet => { lastSheet = sheet; });
assert.equal(lastSheet, own, 'own profile publishing settings stay separate');
for (const hook of hooks.values()) {
    const menu = { props: { userId: id, options: [] } };
    const modified = hook(null, menu);
    assert.equal(modified.props.options.length, 1);
    assert.equal(hook(null, modified), modified, 'menu option must not duplicate');
    assert.equal(menu.props.options.length, 0);
}
mobile.safeStore = () => ({ getUserProfile: () => ({ private: true }) });
// Private profiles keep the CloudCord identity; only their badges are limited to friends.
assert.equal(mobile.getProfileOverride(id), profile, 'private profiles still show the CloudCord identity');
assert.equal(mobile.getProfileOverride(id, true), profile, 'public CloudCord badges do not depend on Discord friendship/privacy');
root.cloudcordRealProfileUsersByAccount = { [other]: [id] };
assert.equal(mobile.getProfileOverride(id, true), undefined, 'real-profile viewer choice also hides public cosmetic badges');

const scheduled = [];
const catalogs = new Map();
const learned = [];
let cosmetic = true;
const directory = vm.createContext({
    setTimeout: work => scheduled.push(work),
    badgeSourceFor: uid => cosmetic && uid === id ? { replace: false } : undefined,
    nativeBadgesFor: () => [{ id: 'early_supporter' }],
    directoryBadgeId: () => 11,
    fakeDirectoryEntry: (entry, _src, owned) => owned.has(entry.badge_id) ? { ...entry, owned: true } : entry,
    isCurrentUser: uid => uid === other,
    currentUserId: other,
    learnBadgeInfo: entries => learned.push(...entries.map(entry => entry.badge_id)),
    findByStoreName: () => ({
        hasCatalogFor: uid => catalogs.has(uid),
        getBadges: uid => catalogs.get(uid),
        getBadgeById: badgeId => ({ badge_id: badgeId, owned: false }),
    }),
    FluxDispatcher: { dispatch: action => dispatchDirectory(action) },
});
vm.runInContext(compile(source.slice(source.indexOf('const nativeBadgeDirectories'), source.indexOf('let nativeBadgeHooksInstalled'))), directory);
function dispatchDirectory(action) {
    directory.rewriteBadgeDirectory(action);
    catalogs.set(action.userId, action.badges);
}
const directoryAction = uid => ({ type: 'BADGE_DIRECTORY_FETCH_SUCCESS', userId: uid, badges: [] });
dispatchDirectory(directoryAction(id));
assert.equal(catalogs.get(id)[0]?.owned, true, 'CloudCord badges can populate Discord’s native directory');
cosmetic = false;
directory.reapplyBadgeDirectory(id);
directory.reapplyBadgeDirectory(id);
assert.equal(scheduled.length, 1, 'several refreshes of the same profile coalesce');
scheduled.shift()();
assert.equal(catalogs.get(id).length, 0, 'real profile restores an originally empty native directory');
cosmetic = true;
directory.reapplyBadgeDirectory(id);
scheduled.shift()();
assert.equal(catalogs.get(id)[0]?.owned, true, 'switching back reapplies the cosmetic from the original snapshot');
assert.deepEqual(learned, [], 'local replays do not teach the directory synthetic badge labels');
directory.reapplyBadgeDirectory(id);
dispatchDirectory({ ...directoryAction(id), badges: [{ badge_id: 12, owned: true }] });
cosmetic = false;
scheduled.shift()();
assert.equal(JSON.stringify(catalogs.get(id)), '[{"badge_id":12,"owned":true}]', 'a replay after a new fetch uses the newest native data');

const profiles = vm.createContext({
    Date,
    badgeSourceFor: uid => cosmetic && uid === id ? { nitroMonths: 12, boostIndex: -1 } : undefined,
    isCurrentUser: uid => uid === other,
    discordBadgesFor: () => [{ id: 'premium_tenure_12_month_v2' }],
    nitroSinceFor: () => new Date('2025-01-01T00:00:00Z'),
    BOOST_MONTHS: [1],
    setOwnValue: (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true }),
});
vm.runInContext(compile(source.slice(source.indexOf('type NativeProfileBadges ='), source.indexOf('// The line under a badge'))), profiles);
cosmetic = true;
const rawProfile = { user: { id }, badges: [{ id: 'partner' }], premium_type: 0 };
profiles.rewriteFetchedProfile({ type: 'USER_PROFILE_FETCH_SUCCESS', userProfile: rawProfile });
assert.equal(rawProfile.badges[0].id, 'premium_tenure_12_month_v2');
assert.equal(rawProfile.premium_type, 2);
const realBoost = new Date('2020-03-01T00:00:00Z');
class DiscordProfile {
    getUserId() { return id; }
}
const cachedProfile = Object.freeze(Object.assign(new DiscordProfile(), {
    badges: rawProfile.badges, premiumSince: new Date(rawProfile.premium_since), premiumType: 2, premiumGuildSince: realBoost,
}));
const guild = { guildId: 'test-guild', badges: [{ id: 'guild-badge' }] };
const wrapper = { displayProfile: cachedProfile, guildMemberProfile: guild };
const real = profiles.restoreNativeProfileBadges(wrapper, id);
assert.equal(real.displayProfile.getUserId(), id, 'restoration preserves the Discord profile prototype');
assert.equal(real.displayProfile.badges[0].id, 'partner');
assert.equal(real.displayProfile.premiumSince, null);
assert.equal(real.displayProfile.premiumType, 0);
assert.equal(real.displayProfile.premiumGuildSince, realBoost, 'untouched boost data retains its original value');
assert.equal(real.guildMemberProfile, guild);
assert.equal(cachedProfile.badges[0].id, 'premium_tenure_12_month_v2', 'the cached Discord object is not edited on read');
assert.equal(profiles.restoreNativeProfileBadges(wrapper, id), real, 'repeat reads do not create new objects');
assert.equal(profiles.restoreNativeProfileBadges(wrapper, other), wrapper);
cosmetic = false;
const refreshedProfile = { user: { id }, badges: [{ id: 'new-native-badge' }] };
profiles.rewriteFetchedProfile({ type: 'USER_PROFILE_FETCH_SUCCESS', userProfile: refreshedProfile });
assert.equal(profiles.restoreNativeProfileBadges(refreshedProfile, id), refreshedProfile, 'a fresh native fetch already contains the correct badges');

const desktopSource = fs.readFileSync('desktop/client/src/sincordplugins/fakeProfile/index.tsx', 'utf8');
const badgeViewer = vm.createContext({ realGetUserProfile: () => ({ private: true }), storedData: {},
    activeUserId: () => other, isRealProfileView: () => false, localProfileFor: () => undefined, sharedProfiles: new Map([[id, profile]]), sharedViewedAt: new Map(), Date });
vm.runInContext(compile(desktopSource.slice(desktopSource.indexOf('function isPrivateProfile('), desktopSource.indexOf('const sharedProfileFetchedAt'))), badgeViewer);
assert.equal(badgeViewer.viewedSharedProfile(id), profile, 'private profiles still show the CloudCord identity');
assert.equal(badgeViewer.viewedSharedProfile(id, true), profile);
badgeViewer.isRealProfileView = () => true;
assert.equal(badgeViewer.viewedSharedProfile(id, true), undefined);
badgeViewer.isRealProfileView = () => false;
badgeViewer.storedData.hideOtherProfiles = true;
assert.equal(badgeViewer.viewedSharedProfile(id, true), undefined);
assert.match(source, /const data = getProfileOverride\(id, true\)/);
assert.match(desktopSource, /function badgesHiddenFor\(/);
console.log('PASS account-scoped real-profile choices, legacy migration, stale menu isolation and reversible native profile badges');
