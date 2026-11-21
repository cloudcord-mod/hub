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
assert(page.includes('<NameStylePreview />'));
assert(page.includes('findByProps("AVERAGE_FONT_WIDTH_RATIO")'));
console.log('PASS: message names/styles update for own and synced users without mutating message records; removal restores originals; native preview wired.');
