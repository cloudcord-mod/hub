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
    if (name === "@utils/profileAppearance") return {
        ACTIVITY_TYPES: [],
        serverTagCustomIcon: icon => icon,
        serverTagIconURL: () => "",
        streamURL: () => undefined,
    };
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
        { module, exports: module.exports, require: requireMock }, { filename: file });
    return module.exports;
}

function flatten(value) {
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (!value?.props) return [];
    if (typeof value.type === "function") return flatten(value.type(value.props));
    return [value, ...flatten(value.props.children)];
}

const { PreviewCard } = load("ios/runtime/src/core/ui/settings/components/ProfileStudio.tsx");
const mobileProfile = { name: "Preview User", username: "preview", tagText: "CLOD", tagIcon: "https://cdn.example/tag.png",
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
console.log("PASS Profile Studio preview modes, server-tag icons, nameplate rendering and theme contrast");
