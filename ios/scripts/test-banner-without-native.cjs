const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), esbuild = require('esbuild');
const workflow = fs.readFileSync('.github/workflows/cloudcord.yml', 'utf8');
const start = workflow.indexOf('              addAfterPatch("getBanner", bannerComposer');
const end = workflow.indexOf('\n              });', start) + '\n              });'.length;
assert(start >= 0 && end > start);
let patch;
const context = { bannerComposer: {}, preview: { enabled: true }, mediaUri: () => 'file:///local-banner.gif',
    isCurrentUser: id => id === 'own', getProfileOverride: id => id === 'shared' ? { banner: 'https://example.com/shared.png' } : undefined,
    addAfterPatch: (_name, _target, handler) => patch = handler };
vm.runInNewContext(esbuild.transformSync(workflow.slice(start, end), { loader: 'ts' }).code, context);
const own = patch([{ userId: 'own' }], null);
assert.equal(own.bannerSrc, 'file:///local-banner.gif');
assert.equal(own.source.uri, 'file:///local-banner.gif');
const native = Object.freeze({ bannerSrc: 'original', color: '#123456' });
assert.equal(patch([{ displayProfile: { userId: 'own' } }], native).color, native.color);
assert.equal(native.bannerSrc, 'original');
assert.equal(patch([{ userId: 'shared' }], undefined).bannerSrc, 'https://example.com/shared.png');
assert.equal(patch([{ userId: 'unshared' }], null), undefined);
context.preview.enabled = false;
assert.equal(patch([{ userId: 'own' }], null), undefined);
assert.equal(patch([{}], null), undefined);

const hooks = new Map();
const mediaStart = workflow.indexOf('          function connectMediaRenderer()');
const mediaEnd = workflow.indexOf('          const identityRefreshers', mediaStart);
Object.assign(context, {
    diagnostics: { patches: 0 },
    renderedUserId: props => props.user?.id || props.displayProfile?.userId,
    isRealProfileView: id => id === 'real',
    requestSharedProfile() {},
    applyAvatarDecoration() {},
    cloneObject: user => user,
    cloneSharedUser: user => user,
    copyProfilePresentation: (profile, fields) => ({ ...profile, ...fields }),
    onJsxCreate: (name, callback) => hooks.set(name, callback),
});
vm.runInNewContext(esbuild.transformSync(workflow.slice(mediaStart, mediaEnd), { loader: 'tsx' }).code + '\nconnectMediaRenderer();', context);
context.preview.enabled = true;
const nativeProfile = Object.freeze({ userId: 'own', getBannerURL: () => null });
const bannerElement = { props: { displayProfile: nativeProfile } };
hooks.get('UserProfileBanner')(null, bannerElement);
assert.equal(bannerElement.props.displayProfile.getBannerURL(), 'file:///local-banner.gif');
assert.equal(nativeProfile.getBannerURL(), null);
const avatarElement = { props: { user: { id: 'own' } } };
hooks.get('HeaderAvatar')(null, avatarElement);
assert.equal(avatarElement.props.pendingAvatarSrc, 'file:///local-banner.gif');
avatarElement.props.pendingAvatarSrc = 'file:///user-edit.png';
hooks.get('HeaderAvatar')(null, avatarElement);
assert.equal(avatarElement.props.pendingAvatarSrc, 'file:///user-edit.png');
console.log('PASS local/shared banners without native banners, native metadata, privacy and immutable input');
