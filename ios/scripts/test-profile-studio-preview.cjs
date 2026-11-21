const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { transformSync } = require(process.env.CLOUDCORD_ESBUILD || "esbuild");

const jsx = (type, props) => ({ type, props });
let layout;
let theme;
const react = { useState: initial => [layout ?? initial, value => { layout = value; }] };
const requireMock = name => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (name === "react") return react;
    if (name === "@webpack/common") return { React: react };
    if (name === "@utils/profileAppearance") return profileAppearance;
    if (name === "@metro") return { findByStoreName: () => ({ theme }) };
    if (name === "@lib/api/assets") return { findAssetId: () => undefined };
    if (name === "@metro/common/components") return { Text: "Text" };
    if (name === "react-native") return { Image: "Image", Pressable: "Pressable", View: "View" };
    throw new Error("Unexpected preview dependency " + name);
};

function load(file) {
    const module = { exports: {} };
    const source = fs.readFileSync(file, "utf8");
    vm.runInNewContext(transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code,
        { module, exports: module.exports, require: requireMock, URL }, { filename: file });
    return module.exports;
}

function flatten(value) {
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (!value?.props) return [];
    if (typeof value.type === "function") return flatten(value.type(value.props));
    return [value, ...flatten(value.props.children)];
}

const { PreviewCard } = load("ios/runtime/src/core/ui/settings/components/ProfileStudio.tsx");
const profileAppearance = load("desktop/client/src/utils/profileAppearance.ts");
const mobileProfile = { name: "Preview User", username: "preview", tagText: "CLOD", tagIcon: "https://getcloudcord.com/tag.png",
    nameplate: "https://cdn.example/nameplate.png", bio: "My bio", badges: ["https://cdn.example/badge.png"] };
const mobileRender = profile => flatten(PreviewCard(profile));
const media = nodes => nodes.filter(node => node.type === "Image").map(node => node.props.source.uri);
const mobileInitial = mobileRender(mobileProfile);
assert.deepEqual(media(mobileInitial), [mobileProfile.nameplate, mobileProfile.tagIcon, ...mobileProfile.badges]);
const selectTab = (nodes, label) => nodes.find(node => node.type === "Pressable" && node.props.children.props.children === label);
selectTab(mobileInitial, "Popout").props.onPress();
theme = "light";
const mobilePopout = mobileRender(mobileProfile);
assert.equal(selectTab(mobilePopout, "Popout").props.accessibilityState.selected, true);
assert.deepEqual(media(mobilePopout), [...mobileProfile.badges, mobileProfile.nameplate, mobileProfile.tagIcon]);
const badgeIcons = Array.from({ length: 12 }, (_, i) => `https://cdn.example/badge-${i}.png`);
assert.deepEqual(media(mobileRender({ ...mobileProfile, badges: badgeIcons })).slice(0, badgeIcons.length), badgeIcons);
assert.equal(mobilePopout.find(node => node.props.children === mobileProfile.name).props.style.color, "#060607");
theme = "dark";
assert.equal(mobileRender(mobileProfile).find(node => node.props.children === mobileProfile.name).props.style.color, "#F2F3F5");
selectTab(mobilePopout, "Chat").props.onPress();
assert.deepEqual(media(mobileRender(mobileProfile)), [mobileProfile.tagIcon]);
assert.deepEqual(media(mobileRender({ name: "No cosmetics", username: "plain" })), []);

const { ProfilePreview } = load("desktop/client/src/sincordplugins/fakeProfile/editorUi.tsx");
layout = "chat";
const desktop = flatten(ProfilePreview({
    data: { globalName: mobileProfile.name, serverTag: { tag: mobileProfile.tagText, icon: mobileProfile.tagIcon } },
    fallbackName: "Fallback", fallbackUsername: "fallback", fallbackAvatar: "https://cdn.example/avatar.png",
}));
const heading = desktop.find(node => node.props.className === "cpx-chat-preview-heading");
assert.equal(flatten(heading).find(node => node.type === "strong").props.children, mobileProfile.name);
assert.equal(flatten(heading).find(node => node.type === "img").props.src, mobileProfile.tagIcon);
const id = "123456789012345678";
const hash = "a_" + "1".repeat(32);
const nativeProfile = { banner: hash, theme_colors: [0, 0x123456], accent_color: 0xabcdef, bio: "Native bio", pronouns: "they/them" };
const nativeBanner = `https://cdn.discordapp.com/banners/${id}/${hash}.gif?size=512`;
const fallbackSurface = { ...profileAppearance.nativeProfilePreviewSurface(id, nativeProfile), presenceStatus: "idle" };
assert.equal(fallbackSurface.banner, nativeBanner);
assert.equal(fallbackSurface.primary, "#000000");
assert.equal(fallbackSurface.accent, "#123456");
assert.equal(fallbackSurface.bannerColor, "#abcdef");
assert.equal(profileAppearance.nativeProfilePreviewSurface(id, { banner: "https://example.com/draft.png" }).banner, undefined);

layout = "profile";
const previewDesktop = data => flatten(ProfilePreview({ data, fallbackName: "Native", fallbackUsername: "native", fallbackAvatar: "avatar", fallbackSurface }));
const bannerStyle = nodes => nodes.find(node => /^(cpx-card|cpx-dc)-banner$/.test(node.props.className)).props.style;
const frameColor = nodes => nodes.find(node => node.props.className === "cpx-card ").props.style["--cpx-accent"];
assert.equal(bannerStyle(previewDesktop({})).backgroundImage, `url("${nativeBanner}")`);
assert.equal(frameColor(previewDesktop({ nitro: false, accentColor: 0xffffff })), "#000000");
assert.equal(frameColor(previewDesktop({ nitro: true, accentColor: 0xffffff })), "#ffffff");
assert.ok(previewDesktop({}).some(node => node.props["aria-label"] === "Status: idle"));
assert.equal(previewDesktop({}).find(node => node.props.className === "cpx-card-bio").props.children, nativeProfile.bio);
assert.equal(previewDesktop({ pronouns: "she/her" }).find(node => node.props.className === "cpx-card-username").props.children.at(-1), " · she/her");
layout = "popout";
const desktopBadgeRows = badgeIcons.map((icon, index) => ({ icon, id: String(index), label: "Badge " + index }));
const desktopPopout = flatten(ProfilePreview({
    data: {}, fallbackName: "Native", fallbackUsername: "native", fallbackAvatar: "avatar", fallbackSurface, badges: desktopBadgeRows,
}));
assert.deepEqual(flatten(desktopPopout.find(node => node.props.className === "cpx-dc-badges")).filter(node => node.type === "img")
    .map(node => node.props.src), badgeIcons);
assert.equal(bannerStyle(previewDesktop({ banner: "https://example.com/draft.png" })).backgroundImage, 'url("https://example.com/draft.png")');
assert.equal(previewDesktop({ bio: "Draft bio" }).find(node => node.props.className === "cpx-dc-bio").props.children, "Draft bio");
assert.ok(previewDesktop({}).some(node => node.props.children === nativeProfile.pronouns));

const workflow = fs.readFileSync(".github/workflows/cloudcord.yml", "utf8");
const page = workflow.split("cat > src/core/ui/settings/pages/FakeProfile/index.tsx <<'TSX'")[1].split("\n          TSX")[0];
const mobileSource = page.slice(page.indexOf("function studioPreviewAppearance("), page.indexOf("function SavedProfiles("));
const mobileAppearance = vm.runInNewContext(transformSync(mobileSource + "\nstudioPreviewAppearance;", { loader: "ts" }).code,
    { ...profileAppearance, readNativeProfile: userId => userId === id ? nativeProfile : undefined,
        readNativePresence: userId => userId === id ? "dnd" : undefined });
assert.match(page, /<K\.PreviewCard \{\.\.\.appearance\}/);
assert.match(page, /<S\.DiscordProfileCard \{\.\.\.appearance\}/);
const account = { id, username: "real", getAvatarURL: () => "avatar" };
const nativeLook = mobileAppearance({}, account);
assert.equal(nativeLook.banner, nativeBanner);
assert.equal(nativeLook.name, "real");
assert.equal(nativeLook.primary, "#000000");
assert.equal(nativeLook.bio, nativeProfile.bio);
assert.equal(nativeLook.pronouns, nativeProfile.pronouns);
assert.equal(nativeLook.status, "dnd");
assert.equal(mobileAppearance({ presenceStatus: "idle" }, account).status, "idle");
assert.equal(profileAppearance.profilePreviewStatus({ presenceStatus: "online" }, "offline"), "invisible");
assert.equal(profileAppearance.profilePreviewStatus({ customActivity: { type: 1, url: "https://www.twitch.tv/cloudcord" } }, "idle"), "streaming");
const serverTag = { tag: "CLOD", guildId: id, badge: "a".repeat(32), icon: mobileProfile.tagIcon };
assert.equal(mobileAppearance({ serverTag }, account).tagIcon, mobileProfile.tagIcon);
assert.equal(mobileAppearance({ serverTag: { ...serverTag, icon: "https://untrusted.example/tag.png" } }, account).tagIcon,
    profileAppearance.serverTagIconURL(serverTag));
assert.equal(mobileAppearance({ bio: "", pronouns: "" }, account).bio, "");
assert.equal(mobileAppearance({ bio: "", pronouns: "" }, account).pronouns, "");
const mobileDraft = mobileAppearance({ profileColorsEnabled: true, accentColor: "#987654", bannerMedia: { uri: "draft" } }, account);
assert.equal(mobileDraft.primary, "#987654");
assert.equal(mobileDraft.bannerColor, "#987654");
layout = "Popout";
assert.ok(media(mobileRender(nativeLook)).includes(nativeBanner));
assert.ok(mobileRender(nativeLook).some(node => node.props.accessibilityLabel === "Status: dnd"));
assert.ok(media(mobileRender(mobileDraft)).includes("draft"));
layout = "Profile";
const twoToneDraft = mobileAppearance({ profileColorsEnabled: true, primaryColor: "#234567", accentColor: "#765432" }, account);
assert.equal(twoToneDraft.bannerColor, "#765432");
const fullPreview = mobileRender(twoToneDraft);
assert.ok(fullPreview.some(node => node.props.style?.backgroundColor === "#234567" && node.props.style?.padding === 3));
assert.ok(fullPreview.some(node => node.props.style?.backgroundColor === "#765432" && node.props.style?.height === "55%"));
const staffIcon = "https://cdn.example/staff.png";
const nativeIcon = "a".repeat(32);
const savedBadgeCode = page.slice(page.indexOf("const nativeBadgeRows ="), page.indexOf("function appendPublishedBadges("));
const previewBadges = vm.runInNewContext(transformSync(savedBadgeCode + "\nstudioBadgeIcons;", { loader: "ts" }).code, {
    currentUserId: id, CLOUDCORD_BADGE_ICON: staffIcon,
    safeStore: () => ({ getUserProfile: accountId => accountId === id ? { badges: [{ id: "native", icon: nativeIcon }] } : undefined }),
    cloudCordStaffBadge: accountId => accountId === id ? { id: "cloudcord-official-owner", label: "CloudCord Owner" } : null,
    publishedBadges: [{ id: "custom", name: "Custom", userId: id, icon: "custom-icon" }, { id: "other", userId: "other", icon: "other-icon" }],
    draftBadgeRows: data => data.nitroEnabled ? [{ id: "nitro", iconSrc: "nitro-icon" }] : [],
    shouldReplaceLocalBadges: data => Boolean(data.replaceBadges),
    badgeLayoutKey: badge => badge.id,
    applyBadgeLayout: (rows, { badgeOrder }) => [...rows].sort((a, b) => badgeOrder.indexOf(a.id) - badgeOrder.indexOf(b.id)),
    defaultBadgeOrder: () => [],
});
assert.deepEqual(Array.from(previewBadges({ nitroEnabled: true, hiddenBadgeIds: ["cloudcord-custom-custom"] }, id)),
    [staffIcon, "nitro-icon", "https://cdn.discordapp.com/badge-icons/" + nativeIcon + ".png"]);
assert.deepEqual(Array.from(previewBadges({ nitroEnabled: true, replaceBadges: true, badgeOrder: ["nitro", "cloudcord-official-owner", "cloudcord-custom-custom"] }, id)),
    ["nitro-icon", staffIcon, "custom-icon"]);
assert.deepEqual(Array.from(previewBadges({}, "other")), ["other-icon"]);
const staffPreview = { ...mobileProfile, badges: [staffIcon], officialBadgeIcon: staffIcon };
theme = "dark";
assert.equal(mobileRender(staffPreview).find(node => node.props.source?.uri === staffIcon).props.style.tintColor, "#ffffff");
theme = "light";
layout = "Popout";
assert.equal(mobileRender(staffPreview).find(node => node.props.source?.uri === staffIcon).props.style.tintColor, "#000000");
assert.match(page, /studioBadgeIcons\(data, ownerId \?\? ""\)/);
assert.match(page, /badges=\{studioBadgeIcons\(preview\)\}/);

const desktopEditor = fs.readFileSync("desktop/client/src/sincordplugins/fakeProfile/index.tsx", "utf8");
const savedPanelSource = desktopEditor.slice(desktopEditor.indexOf("function SavedProfilesPanel("),
    desktopEditor.indexOf("// ---- Copy someone's profile:"));
let canSave = false;
let savedRows;
let lookName = "Main";
const savedMessages = [];
const savedPanel = vm.runInNewContext(transformSync(savedPanelSource + "\nSavedProfilesPanel;", { loader: "tsx" }).code, {
    React: {
        createElement: (type, props, ...children) => jsx(type, { ...props, children: children.flat() }),
        useState: initial => typeof initial === "function" ? [initial(), rows => { savedRows = rows; }]
            : [initial === "" ? lookName : initial, value => { if (initial === "") lookName = value; }],
    },
    Section: "Section", readSavedProfiles: () => [], writeSavedProfiles: () => canSave, savedSnapshot: data => data,
    showToast: message => savedMessages.push(message), Toasts: { Type: { SUCCESS: "success" } },
});
const pressSave = () => flatten(savedPanel({ current: {}, userId: id })).find(node => node.type === "button").props.onClick();
pressSave();
assert.equal(savedRows, undefined);
assert.equal(savedMessages.length, 0);
assert.equal(lookName, "Main");
canSave = true;
pressSave();
assert.equal(savedRows[0].name, "Main");
assert.equal(lookName, "");
assert.equal(savedMessages.length, 1);

async function testMobilePreviewOpening() {
    const handoff = page.slice(page.indexOf("const openPreview = async"), page.indexOf("const K = require", page.indexOf("const openPreview = async")));
    const toasts = [];
    const nativeOpens = [];
    let livePreviewOpened = false;
    let refreshes = 0;
    const context = {
        currentUserId: id, realCurrentUser: account,
        isProfileViewUserId: profileAppearance.isProfileViewUserId,
        nativeProfileOpener: () => options => nativeOpens.push(options.userId),
        refreshPreview: () => { refreshes++; },
        setShowPreview: value => { livePreviewOpened = value; },
        showToast: text => toasts.push(text),
    };
    const openPreview = vm.runInNewContext(transformSync(handoff + "\nopenPreview;", { loader: "ts" }).code, context);
    await openPreview();
    assert.deepEqual(nativeOpens, [id]);
    assert.equal(refreshes, 1);
    assert.equal(livePreviewOpened, false);
    context.nativeProfileOpener = () => undefined;
    await openPreview();
    assert.equal(livePreviewOpened, true);
    assert.match(toasts.pop(), /Showing the live preview/);
    livePreviewOpened = false;
    context.nativeProfileOpener = () => () => Promise.reject(new Error("sheet failed"));
    await openPreview();
    assert.equal(livePreviewOpened, true);
    livePreviewOpened = false;
    const stale = openPreview();
    context.currentUserId = "123456789012345679";
    await stale;
    assert.equal(livePreviewOpened, false, "a failure on the previous account must not change this account's preview");
}

testMobilePreviewOpening().then(() => {
    console.log("PASS Profile Studio modes, native profile fields, preview fallback, two-tone previews and saved-look wiring");
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
