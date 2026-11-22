export const cxProfileMenuActions = {
    "user-url": { label: "Copy User URL", scope: "none", format: (id: string) => "<https://discord.com/users/" + id + ">" },
    "user-mention": { label: "Copy User Mention", scope: "none", format: (id: string) => "<@" + id + ">" },
    "account-created": { label: "Copy Account Creation Timestamp", scope: "none", format: (id: string) => {
        if (!isCxProfileUserId(id) || id.startsWith("0")) return;
        const snowflake = BigInt(id);
        if (snowflake > 0xffffffffffffffffn) return;
        return "<t:" + Math.floor((Number(snowflake >> 22n) + 1_420_070_400_000) / 1000) + ":F>";
    } },
    "username": { label: "Copy Username", scope: "identity" },
    "display-name": { label: "Copy Display Name", scope: "identity" },
    "profile-bio": { label: "Copy Bio", scope: "user", unavailable: "No profile bio found." },
    "server-profile-bio": { label: "Copy Server Bio", scope: "server" },
    "profile-pronouns": { label: "Copy Pronouns", scope: "user", unavailable: "No profile pronouns found." },
    "server-nickname": { label: "Copy Server Nickname", scope: "server" },
    "server-avatar-link": { label: "Copy Server Avatar Link", scope: "server" },
    "server-banner-link": { label: "Copy Server Profile Banner Link", scope: "server" },
    "server-joined": { label: "Copy Server Join Timestamp", scope: "server" },
    "profile-colors": { label: "Copy Profile Colors", scope: "user", unavailable: "No profile colors found." },
    "server-profile-colors": { label: "Copy Server Profile Colors", scope: "server" },
} as const;

export type CxProfileMenuAction = keyof typeof cxProfileMenuActions;

export function isCxProfileUserId(id: unknown): id is string {
    return typeof id === "string" && /^\d{17,20}$/.test(id);
}

export function getCxProfileMedia(id: string, user: { avatar?: unknown; discriminator?: string; username?: string; }, banner: unknown) {
    if (!isCxProfileUserId(id)) return [];
    const name = user.username?.replace(/[^\w.-]+/g, "_").slice(0, 64) || id;
    const assets: { kind: "Avatar" | "Banner"; url: string; filename: string; animated: boolean; }[] = [];
    if (!user.avatar) {
        const legacy = user.discriminator && /^[0-9]{4}$/.test(user.discriminator) && Number(user.discriminator);
        const index = legacy ? legacy % 5 : Number((BigInt(id) >> 22n) % 6n);
        assets.push({ kind: "Avatar", url: "https://cdn.discordapp.com/embed/avatars/" + index + ".png", filename: "avatar_" + name + ".png", animated: false });
    }
    for (const [kind, path, hash] of [["Avatar", "avatars", user.avatar], ["Banner", "banners", banner]] as const) {
        if (typeof hash !== "string" || !/^(?:a_)?[0-9a-f]{32}$/.test(hash)) continue;
        const animated = hash.startsWith("a_");
        const extension = animated ? "gif" : "png";
        assets.push({
            kind, animated, filename: kind.toLowerCase() + "_" + name + "." + extension,
            url: "https://cdn.discordapp.com/" + path + "/" + id + "/" + hash + "." + extension + "?size=4096",
        });
    }
    return assets;
}

type Profile = { themeColors?: unknown; bio?: unknown; pronouns?: unknown; banner?: unknown; };
type ProfileStore = {
    getUserProfile?: (id: string) => Profile | null | undefined;
    getGuildMemberProfile?: (id: string, guildId: string) => Profile | null | undefined;
};
type UserStore = { getUser?: (id: string) => { username?: unknown; globalName?: unknown; } | null | undefined; };
type MemberStore = {
    getMember?: (guildId: string, id: string) => { nick?: unknown; avatar?: unknown; joinedAt?: unknown; joined_at?: unknown; } | null | undefined;
};

function nonBlankText(value: unknown) {
    return typeof value === "string" && value.trim() ? value : undefined;
}

export function getCxProfileMenuCopy(action: CxProfileMenuAction, id: string, profiles?: ProfileStore, guildId?: string, users?: UserStore, members?: MemberStore) {
    const entry = cxProfileMenuActions[action];
    if (entry.scope === "none") return entry.format(id);
    if (entry.scope === "server" && !guildId) return;
    try {
        if (entry.scope === "identity") {
            const user = users?.getUser?.(id);
            return nonBlankText(action === "username" ? user?.username : user?.globalName);
        }
        if (action === "server-nickname" && guildId) {
            return nonBlankText(members?.getMember?.(guildId, id)?.nick);
        }
        if (action === "server-joined") {
            if (!isCxProfileUserId(guildId) || !isCxProfileUserId(id)) return;
            const member = members?.getMember?.(guildId, id);
            const joined = member?.joinedAt ?? member?.joined_at;
            if (typeof joined !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(joined)) return;
            const timestamp = Date.parse(joined);
            if (Number.isFinite(timestamp) && timestamp > 0) return "<t:" + Math.floor(timestamp / 1000) + ":F>";
            return;
        }
        if (action === "server-avatar-link" || action === "server-banner-link") {
            if (!isCxProfileUserId(guildId) || !isCxProfileUserId(id)) return;
            const avatar = action === "server-avatar-link";
            const hash = avatar ? members?.getMember?.(guildId, id)?.avatar : profiles?.getGuildMemberProfile?.(id, guildId)?.banner;
            if (typeof hash !== "string" || !/^(?:a_)?[0-9a-f]{32}$/.test(hash)) return;
            const format = hash.startsWith("a_") ? "webp?size=4096&animated=true" : "png?size=4096";
            return "https://cdn.discordapp.com/guilds/" + guildId + "/users/" + id + (avatar ? "/avatars/" : "/banners/") + hash + "." + format;
        }
        const profile = entry.scope === "server"
            ? profiles?.getGuildMemberProfile?.(id, guildId!) : profiles?.getUserProfile?.(id);
        if (action === "profile-bio" || action === "server-profile-bio") return nonBlankText(profile?.bio);
        if (action === "profile-pronouns") return nonBlankText(profile?.pronouns);
        const colors = profile?.themeColors;
        if (!Array.isArray(colors) || colors.length < 2) return;
        const hex = colors.slice(0, 2).map(color =>
            Number.isInteger(color) && color >= 0 && color <= 0xffffff ? "#" + color.toString(16).padStart(6, "0") : undefined
        );
        if (hex[0] && hex[1]) return "Primary-color " + hex[0] + ", Secondary-Color " + hex[1];
    } catch { /* The requested profile is not available locally. */ }
}
