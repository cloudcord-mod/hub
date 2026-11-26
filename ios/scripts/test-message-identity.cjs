const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const workflow = fs.readFileSync('.github/workflows/cloudcord.yml', 'utf8');
const page = workflow.split("cat > src/core/ui/settings/pages/FakeProfile/index.tsx <<'TSX'")[1].split('\n          TSX')[0].replace(/^          /gm, '');
let profile = { username: 'custom_user', globalName: 'Custom Name', displayNameStyles: { fontId: 2, effectId: 1, colors: [0] } };
let requested;
const context = vm.createContext({ ...require('./load-profile-appearance.cjs'), isCurrentUser: id => id === 'own', preview: { enabled: true, username: 'own_custom', displayName: 'Own Custom Name' }, ownSharedProfile: async () => { throw new Error('Rendering must not upload media'); },
    getProfileOverride: () => profile, requestSharedProfile: id => { requested = id; }, cloneSharedUser: (user, data) => ({ ...user, username: data.username }),
    cloneObject: user => ({ ...user, username: 'own_custom' }) });
vm.runInContext(esbuild.transformSync(page.slice(page.indexOf('function decorateMessageAuthor('), page.indexOf('function ensurePatches(')), { loader: 'ts' }).code, context);
const user = Object.freeze({ id: 'foreign', username: 'real' });
const author = Object.create({ get nick() { return 'Real Name'; }, label() { return this.internalLabel; } });
Object.defineProperties(author, {
    user: { value: user, enumerable: true }, colorString: { value: '#ff0000', enumerable: true }, internalLabel: { value: 'native' },
});
Object.freeze(author);
const result = context.decorateMessageAuthor(author, []);
assert.equal(result.nick, 'Custom Name');
assert.equal(result.user.username, 'custom_user');
assert.equal(result.displayNameStyles.colors[0], 0);
assert.equal(result.colorString, author.colorString);
assert.equal(result.label(), 'native');
assert.equal(author.user.username, 'real');
assert.equal(requested, 'foreign');
assert.equal(context.decorateMessageAuthor({ nick: 'Real' }, [{ author: user }]).nick, 'Custom Name');
assert.equal(context.decorateMessageAuthor({ user: { id: 'own' }, nick: 'Real' }, []).nick, 'Own Custom Name');
assert.equal(context.decorateMessageAuthor({ user: { id: 'own' }, nick: 'Real' }, []).user.username, 'own_custom');
const unrelated = Object.freeze({ id: 'other', username: 'other_real' });
assert.equal(context.decorateMessageAuthor({ user, author: unrelated, nick: 'Real' }, []).author, unrelated);
profile = null;
assert.equal(context.decorateMessageAuthor(author, []), author);
assert.equal(context.decorateMessageAuthor(null, []), null);
const memberId = '123456789012345678';
const outsideId = '234567890123456789';
const guildId = '345678901234567890';
const channelId = '456789012345678901';
const member = Object.freeze({ id: memberId, username: 'native' });
const probes = [];
const roleRows = Object.freeze([{ id: 'native-role' }]);
const showMember = row => row.id === memberId;
function queryUsers(options) {
    assert.equal(this, searches);
    if (options.allowSnowflake) {
        probes.push(options);
        if (options.query !== memberId || options.filter?.(member) === false) return [];
        return [{ record: member, score: 10 }];
    }
    return options.query === 'native' && options.filter?.(member) !== false ? [{ record: member, score: 10 }] : [];
}
const searches = {
    queryChannelUsers: queryUsers,
    queryGuildUsers: queryUsers,
    queryMentionResults(options) {
        if (options.fail) throw new Error('native error');
        const users = this.queryChannelUsers(options).map(({ record }) => Object.freeze({ user: record, nick: 'Native Nick' }));
        return { users: Object.freeze(users), roles: roleRows };
    },
    queryGuildMentionResults(options) {
        return { users: this.queryGuildUsers(options), roles: roleRows };
    },
};
const aliases = new Map([[outsideId, { username: 'custom', globalName: 'Outside' }],
    [memberId, { username: 'custom_user', globalName: 'Cústom Member' }]]);
Object.assign(context, {
    currentUserId: null, settings: {}, sharedProfiles: aliases, getProfileOverride: id => aliases.get(id),
    addPatch(method, host, handler) {
        const original = host[method].bind(host);
        host[method] = (...args) => handler(args, original);
    },
});
context.installMentionAliases(searches);
const resultOnAlias = searches.queryMentionResults({ channelId, query: 'custom', filter: showMember });
assert.equal(resultOnAlias.users.length, 1);
assert.equal(resultOnAlias.users[0].user, member);
assert.equal(resultOnAlias.users[0].nick, 'Cústom Member');
assert.equal(resultOnAlias.roles, roleRows);
assert.equal(probes.length, 2, 'the native resolver still checks each eligible alias candidate');
assert.ok(probes.every(options => options.request === false && options.channelId === channelId && options.filter === showMember));
assert.equal(searches.queryMentionResults({ channelId, query: 'custom', filter: () => false }).users.length, 0);
assert.equal(searches.queryGuildMentionResults({ guildId, query: 'custom' }).users[0].record, member);
const existingCount = probes.length;
assert.equal(searches.queryMentionResults({ channelId, query: 'native' }).users[0].user, member);
assert.equal(searches.queryMentionResults({ channelId, query: 'c' }).users.length, 0);
assert.throws(() => searches.queryMentionResults({ channelId, query: 'custom', fail: true }), /native error/);
assert.equal(searches.queryChannelUsers({ channelId, query: 'custom' }).length, 0);
assert.equal(probes.length, existingCount, 'short and non-mention searches avoid extra work');
for (let index = 0; index < 5; index++) aliases.set('56789012345678901' + index, { username: 'bounded' });
assert.equal(searches.queryMentionResults({ channelId, query: 'bounded' }).users.length, 0);
assert.equal(probes.length - existingCount, 3, 'alias searches probe at most three cached users');
assert(page.includes('<NameStylePreview />'));
assert(page.includes('findByProps("AVERAGE_FONT_WIDTH_RATIO")'));
const avatarStart = page.indexOf('    const dmAvatarRenderers');
const avatarEnd = page.indexOf('\n    });', avatarStart) + '\n    });'.length;
let avatarHook;
const fakeUri = 'https://example.test/avatar.png';
const nativeAvatar = Object.freeze({ props: Object.freeze({ user: member, status: 'online' }) });
Object.assign(context, {
    onJsxCreate(name, callback) { assert.equal(name, 'MessagesItemChannelAvatar'); avatarHook = callback; },
    useReducer: () => [0, () => {}], useEffect() {}, identityRefreshers: new Set(),
    isValidElement: value => value === nativeAvatar, isCurrentUser: () => false,
    isRealProfileView: () => false, requestSharedProfile() {},
    cloneElement: (value, props) => ({ ...value, props: { ...value.props, ...props } }),
    getProfileOverride: id => id === member.id ? { avatar: fakeUri } : undefined,
});
vm.runInContext(esbuild.transformSync(page.slice(avatarStart, avatarEnd), { loader: 'ts' }).code, context);
const nativeRenderer = () => nativeAvatar;
const row = avatarHook(nativeRenderer, { type: nativeRenderer });
assert.equal(avatarHook(nativeRenderer, {}).type, row.type);
assert.equal(row.type({ channel: { type: 1 } }).props.source.uri, fakeUri);
assert.equal(row.type({ channel: { type: 1 } }).props.status, 'online');
assert.equal(row.type({ channel: { type: 3 } }), nativeAvatar);
context.getProfileOverride = () => undefined;
assert.equal(row.type({ channel: { type: 1 } }), nativeAvatar);
console.log('PASS: DM avatars use the synced image source and restore Discord’s avatar when removed.');
