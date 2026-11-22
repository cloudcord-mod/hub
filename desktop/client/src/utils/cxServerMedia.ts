import { formatCxCreationTimestamp, isCxProfileUserId } from "./cxProfileMenu";

export type CxServerMenuEffect = "view-server-media" | "copy-server-media-links" | "copy-server-splash-links" | "copy-server-details" | "copy-server-created" | "view-group-dm-icon";

export function getCxServerMenuFields(effect: CxServerMenuEffect) {
    if (effect === "view-group-dm-icon") return [{ key: "icon", label: "View Group Icon", width: 512 }] as const;
    if (effect === "copy-server-details")
        return [{ key: "name", label: "Copy Server Name" }, { key: "description", label: "Copy Server Description" }] as const;
    if (effect === "copy-server-created") return [{ key: "created", label: "Copy Server Creation Timestamp" }] as const;
    if (effect === "copy-server-splash-links")
        return [{ key: "splash", label: "Copy Invite Splash Link" }, { key: "discoverySplash", label: "Copy Discovery Splash Link" }] as const;
    const view = effect === "view-server-media";
    return [
        { key: "icon", label: view ? "View Server Icon" : "Copy Server Icon Link", width: 512 },
        { key: "banner", label: view ? "View Server Banner" : "Copy Server Banner Link", width: 1024 },
    ] as const;
}

export function getCxGuildAssetUrl(path: "icons" | "banners" | "channel-icons" | "splashes" | "discovery-splashes", id: unknown, hash: unknown) {
    if (!isCxProfileUserId(id) || typeof hash !== "string" || !/^(?:a_)?[a-f0-9]{32}$/.test(hash)) return;
    if ((path === "splashes" || path === "discovery-splashes") && hash.startsWith("a_")) return;
    const format = hash.startsWith("a_") ? "gif" : "png";
    return "https://cdn.discordapp.com/" + path + "/" + id + "/" + hash + "." + format + "?size=4096";
}

export function getCxServerMenuValue(guild: {
    id?: unknown; name?: unknown; description?: unknown; icon?: unknown; banner?: unknown;
    splash?: unknown; discoverySplash?: unknown; discovery_splash?: unknown;
} | undefined, id: string, field: "name" | "description" | "icon" | "banner" | "splash" | "discoverySplash" | "created") {
    if (!guild || guild.id !== id || !isCxProfileUserId(id)) return;
    if (field === "created") return formatCxCreationTimestamp(id);
    if (field === "icon" || field === "banner")
        return getCxGuildAssetUrl(field === "icon" ? "icons" : "banners", id, guild[field]);
    if (field === "splash") return getCxGuildAssetUrl("splashes", id, guild.splash);
    if (field === "discoverySplash") return getCxGuildAssetUrl("discovery-splashes", id, guild.discoverySplash ?? guild.discovery_splash);
    const text = guild[field];
    return typeof text === "string" && text.trim() ? text : undefined;
}

export const cxRoleMenuLabels = {
    "copy-role-name": "Copy Role Name",
    "copy-role-color": "Copy Role Color",
    "copy-role-mention": "Copy Role Mention",
    "view-role-icon": "View Role Icon",
} as const;

export type CxRoleMenuEffect = keyof typeof cxRoleMenuLabels;

export function getCxRoleMenuValue(effect: CxRoleMenuEffect, id: string, role: {
    id?: unknown; name?: unknown; colorStrings?: { primaryColor?: unknown; }; colorString?: unknown; icon?: unknown;
} | undefined) {
    if (!role || role.id !== id || !isCxProfileUserId(id)) return;
    if (effect === "copy-role-name") return typeof role.name === "string" && role.name.trim() ? role.name : undefined;
    if (effect === "copy-role-mention") return "<@&" + id + ">";
    if (effect === "copy-role-color") {
        const color = role.colorStrings?.primaryColor ?? role.colorString;
        return typeof color === "string" && /^#[a-f0-9]{6}$/i.test(color) ? color : undefined;
    }
    if (typeof role.icon !== "string" || !/^(?:a_)?[a-f0-9]{32}$/i.test(role.icon)) return;
    const format = role.icon.startsWith("a_") ? "gif" : "png";
    return "https://cdn.discordapp.com/role-icons/" + id + "/" + role.icon + "." + format + "?size=256";
}
