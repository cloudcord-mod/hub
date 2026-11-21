const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const esbuild = require('esbuild');
const workflow = fs.readFileSync('.github/workflows/cloudcord.yml', 'utf8');
const source = workflow.split("cat > src/core/ui/settings/pages/FakeProfile/index.tsx <<'TSX'")[1].split('\n          TSX')[0].replace(/^          /gm, '');
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const compile = code => esbuild.transformSync(code, { loader: 'tsx' }).code;
let canceled = 0;
const original = { enabled: true, bio: 'Account A', selectedBadges: { staff: true } };
const account = vm.createContext({ rootSettings: { fakeProfile: original, fakeProfileLocalOnly: true, fakeProfileShare: { id: 'legacy', editToken: 'test-only' } },
    ...require('./load-profile-appearance.cjs'),
    preview: original, configReady: true, currentUserId: null, realCurrentUser: null,
    defaultPreview: () => ({ enabled: false, selectedBadges: {} }), publishTimer: 1, clearTimeout: () => canceled++,
    suppressOwnPullUntil: 1, mediaSelections: new Map(), userCache: new WeakMap(), profileCache: new WeakMap(),
    bindSavedPreview: () => { account.preview = account.rootSettings.fakeProfile; account.configReady = true; } });
vm.runInContext(compile(block('function ownedTemplateBackup(', 'function mediaClearPending(')), account);
account.adoptProfileAccount({ id: 'a' });
assert.equal(account.rootSettings.fakeProfileOwnerId, 'a');
assert.equal(account.rootSettings.fakeProfileShare.ownerId, 'a');
account.adoptProfileAccount({ id: 'b' });
assert.equal(account.preview.enabled, false, 'a new account never inherits another account cosmetic profile');
assert.equal(account.rootSettings.fakeProfileLocalOnly, false, 'a new account may pull its own shared profile, without inheriting account A device-only mode');
assert.equal(account.rootSettings.fakeProfileAccounts.a.profile.bio, 'Account A');
assert.equal(canceled, 1, 'queued uploads are canceled on account changes');
account.rootSettings.fakeProfile = account.preview = { enabled: true, bio: 'Account B' };
account.rootSettings.fakeProfileLocalOnly = false;
account.adoptProfileAccount({ id: 'a' });
assert.equal(account.preview.bio, 'Account A');
assert.equal(account.rootSettings.fakeProfileLocalOnly, true, 'device-only mode stays attached to its account');
account.adoptProfileAccount(null);
assert.equal(account.currentUserId, null, 'logout clears the publish identity');
assert.equal(account.preview.enabled, false);
account.adoptProfileAccount({ id: 'b' });
assert.equal(account.preview.bio, 'Account B', 'account settings restore across logout and login');
assert.equal(account.rootSettings.fakeProfileLocalOnly, false);
const legacyViewer = '123456789012345678';
const mutedProfile = '223456789012345678';
const alternateViewer = '323456789012345678';
const legacyLook = { id: 'legacy', data: { bio: 'legacy saved look' } };
account.rootSettings.cloudcordRealProfileUsers = [mutedProfile, legacyViewer, mutedProfile, 'invalid'];
account.rootSettings.fakeProfileSaved = [legacyLook];
account.adoptProfileAccount({ id: legacyViewer });
assert.deepEqual(Array.from(account.rootSettings.cloudcordRealProfileUsersByAccount[legacyViewer]), [mutedProfile]);
assert.equal(account.rootSettings.fakeProfileSaved[legacyViewer][0], legacyLook);
account.rootSettings.fakeProfile = account.preview = { enabled: true, bio: 'temporary preview' };
account.rootSettings.fakeProfilePreviewOwner = legacyViewer;
account.rootSettings.fakeProfilePreviewBackup = { enabled: true, bio: 'saved profile' };
account.adoptProfileAccount({ id: alternateViewer });
assert.equal(account.rootSettings.fakeProfileAccounts[legacyViewer].profile.bio, 'saved profile');
assert.equal(account.rootSettings.fakeProfilePreviewBackup, undefined);
assert.equal(Object.keys(account.rootSettings.cloudcordRealProfileUsersByAccount).length, 1, 'legacy device choices are adopted once');
assert(source.includes('editorOwner.current !== currentUserId'), 'stale editors cannot edit another account');
(async () => {
    vm.runInContext(compile(block('async function publishShare(', 'function savedSnapshot(')), account);
    assert.equal(account.readSavedProfiles(alternateViewer).length, 0);
    account.writeSavedProfiles(alternateViewer, [{ id: 'alternate', data: { bio: 'alternate saved look' } }]);
    assert.equal(account.readSavedProfiles(legacyViewer)[0].id, 'legacy');
    let finishShare;
    account.ownSharedProfile = () => new Promise(resolve => { finishShare = resolve; });
    account.shareRequest = () => { throw new Error('An account switch must stop an unsent share request'); };
    const openingShare = account.publishShare(alternateViewer, account.readSavedProfiles(alternateViewer)[0], 'unlisted');
    account.adoptProfileAccount({ id: legacyViewer });
    finishShare({ bio: 'alternate saved look' });
    await assert.rejects(openingShare, /Discord account changed/);
    assert.equal(account.preview.bio, 'saved profile');
    let finishFirst, writes = [];
    let now = Date.now(), retryCallback, retryDelay;
    class TestDate extends Date { static now() { return now; } }
    const shared = vm.createContext({ rootSettings: { fakeProfileShare: { id: 'old-a', editToken: 'test-a', ownerId: 'a' } },
        preview: { enabled: true, bio: 'first' }, currentUserId: 'a', Date: TestDate, JSON, publishTimer: null,
        setTimeout: (callback, delay) => { retryCallback = callback; retryDelay = delay; return 1; }, clearTimeout() {},
        customSocialValidationErrors: () => [], ownSharedProfile: async () => ({ bio: shared.preview.bio }),
        SHARED_PROFILE_API: 'https://example.test', diagnostics: {},
        fetch: async (url, options) => {
            if (!options?.method) return { ok: false, status: 404 };
            writes.push({ url, ...options });
            if (writes.length === 1) await new Promise(resolve => { finishFirst = resolve; });
            return { ok: true, json: async () => ({ id: `profile-${shared.currentUserId}`, editToken: `test-${shared.currentUserId}` }) };
        } });
    shared.fetchProfileResponse = (...args) => shared.fetch(...args);
    vm.runInContext(compile(block('async function publishSharedProfile(', 'function queueSharedPublish(')), shared);
    assert.equal(shared.profileSyncLabel(), 'Waiting to sync');
    const first = shared.publishSharedProfile();
    for (let i = 0; i < 20 && !finishFirst; i++) await Promise.resolve();
    assert(finishFirst);
    assert.equal(shared.profileSyncLabel(), 'Syncing…');
    shared.preview = { enabled: true, bio: 'latest' };
    const second = shared.publishSharedProfile();
    assert.equal(writes.length, 1, 'overlapping saves are serialized');
    finishFirst(); await Promise.all([first, second]);
    assert.equal(shared.profileSyncLabel(), 'Synced');
    assert.equal(writes.length, 2);
    assert.equal(JSON.parse(writes[1].body).profile.bio, 'latest', 'the queued save uses the newest edit');
    assert.equal(shared.rootSettings.fakeProfileShare, undefined, 'legacy credentials migrate once');
    assert.equal(shared.rootSettings.fakeProfileShares.a.id, 'old-a');
    shared.currentUserId = 'b'; shared.preview = { enabled: true, bio: 'B' };
    assert.equal(shared.profileSyncLabel(), 'Waiting to sync', 'one account does not inherit another account’s confirmation');
    await shared.publishSharedProfile();
    assert.equal(writes[2].method, 'POST');
    assert.equal(writes[2].headers.Authorization, undefined, 'account B cannot use account A edit token');
    assert.equal(shared.rootSettings.fakeProfileShares.a.id, 'old-a');
    assert.equal(shared.rootSettings.fakeProfileShares.b.ownerId, 'b');
    let attempts = 0;
    shared.fetch = async (_url, options) => {
        if (!options?.method) return { ok: false, status: 404 };
        attempts++;
        return attempts === 1 ? { ok: false, status: 401 } : { ok: true, json: async () => ({ id: 'renewed-b', editToken: 'renewed-test-b' }) };
    };
    await shared.publishSharedProfile();
    assert.equal(attempts, 2, 'credential renewal retries directly without deadlocking the serialized publisher');
    assert.equal(shared.rootSettings.fakeProfileShares.b.id, 'renewed-b');
    assert.equal(shared.rootSettings.fakeProfileShares.a.id, 'old-a');
    attempts = 0;
    shared.fetch = async (_url, options) => {
        if (!options?.method) return { ok: false, status: 404 };
        attempts++; return { ok: false, status: 409 };
    };
    await assert.rejects(shared.publishSharedProfile(), /changed/);
    assert.equal(attempts, 2, 'conflict retries are bounded');
    shared.fetchProfileResponse = async () => { throw Error('request timed out'); };
    await assert.rejects(shared.publishSharedProfile(), /timed out/);
    assert.equal(shared.profileSyncLabel(), 'Sync failed');
    shared.fetchProfileResponse = (...args) => shared.fetch(...args);
    attempts = 0;
    shared.fetch = async (_url, options) => {
        if (!options?.method) return { ok: false, status: 404 };
        attempts++;
        return { ok: false, status: 429, headers: new Map([['retry-after', 'invalid']]) };
    };
    assert.equal(await shared.publishSharedProfile(), false, 'a rate-limited save is not confirmed');
    assert.equal(shared.profileSyncLabel(), 'Retry scheduled');
    assert.equal(retryDelay, 10_000);
    assert.equal(await shared.publishSharedProfile(), false);
    assert.equal(attempts, 1, 'manual sync respects the server cooldown');
    shared.fetch = async (_url, options) => options?.method
        ? { ok: true, json: async () => ({}) } : { ok: false, status: 404 };
    now += retryDelay;
    retryCallback();
    while (shared.publishSharedProfile.pending) await shared.publishSharedProfile.pending;
    assert.equal(shared.profileSyncLabel(), 'Synced');
    shared.rootSettings.fakeProfileLocalOnly = true;
    assert.equal(shared.profileSyncLabel(), 'This device');
    assert.equal(await shared.publishSharedProfile(), false);
    console.log('PASS mobile account/profile/privacy isolation, logout, legacy migration, serialized saves and bounded credential/conflict recovery');
})().catch(error => { console.error(error); process.exitCode = 1; });
