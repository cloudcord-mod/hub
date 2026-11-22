/* SPDX-License-Identifier: GPL-3.0-or-later */

import { formatCxCreationTimestamp } from "./cxProfileMenu";

export type CxChannelLabel = { id?: string; name?: string; type?: number; guild_id?: string | null; topic?: string | null; };

export function getCxChannelTopicCopy(channel: CxChannelLabel) {
    if (!channel.id || !/^\d{17,20}$/.test(channel.id) || !channel.guild_id || typeof channel.topic !== "string" || !channel.topic.trim()) return;
    return { label: "Copy Channel Topic", name: channel.topic };
}

export type CxChannelCopyEffect = "copy-channel-name" | "copy-channel-topic" | "copy-channel-created";

export function getCxChannelCopy(effect: CxChannelCopyEffect, channel: Parameters<typeof getCxChannelNameCopy>[0], username: (id: string) => string | undefined) {
    if (effect === "copy-channel-name") return getCxChannelNameCopy(channel, username);
    if (effect === "copy-channel-topic") return getCxChannelTopicCopy(channel);
    if (!channel.guild_id) return;
    const name = formatCxCreationTimestamp(channel.id);
    if (name) return { label: "Copy Channel Creation Timestamp", name };
}

export function getCxChannelNameCopy(channel: CxChannelLabel & { recipients?: readonly string[]; }, username: (id: string) => string | undefined) {
    if (typeof channel.id !== "string" || !/^\d{17,20}$/.test(channel.id)) return;
    const label = channel.type === 4 ? "Copy Category Name" : "Copy Channel Name";
    const recipient = channel.recipients?.[0];
    const name = channel.name || (channel.type === 1 ? (recipient && username(recipient)) || "Direct Message"
        : channel.type === 3 ? "Group DM" : channel.id);
    return { label, name };
}

export function getCxChannelNoteLabel(id: string, channel: Parameters<typeof getCxChannelNameCopy>[0] | undefined,
    username: (id: string) => string | undefined, guildName: (id: string) => string | undefined) {
    if (!channel) return "Unavailable channel · " + id;
    const name = getCxChannelNameCopy(channel, username)?.name ?? id;
    const server = channel.guild_id && guildName(channel.guild_id);
    return server ? server + " · " + name : name;
}

// CleanChannelName by AutumnVN (GPL-3.0-or-later).
const smallCaps = Object.fromEntries([..."ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ"].map((letter, index) => [letter, "abcdefghijklmnopqrstuvwxyz"[index]]));

export function cleanChannelName(name: string, type: number) {
    return name.normalize("NFKC")
        .replace(/[ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ]/g, letter => smallCaps[letter])
        .replace(/[^ -~]?\p{Extended_Pictographic}[^ -~]?/ug, "")
        .replace(/-?[^\p{Letter} -~]-?/ug, [2, 4].includes(type) ? " " : "-")
        .replace(/(^-|-$)/g, "")
        .replace(/-+/g, "-") || name;
}

// Reimplements the default BetterChatNames behavior described by Break.
// https://betterdiscord.app/plugins/BetterChatNames
const conventionalCase = new Map(["a", "and", "at", "for", "of", "or", "the", "to", "FAQ", "GitHub", "VC"]
    .map(word => [word.toLowerCase(), word]));

export function formatCxChannelName(label: string, channel: CxChannelLabel, modes: { clean: number; titles: number; dashless?: number; }) {
    if (typeof channel.type !== "number" || !channel.name || !label) return label;
    const cleaned = modes.clean ? cleanChannelName(label, channel.type) : label;
    if (!channel.guild_id) return cleaned;
    if (!modes.titles) return modes.dashless && channel.type === 0 ? cleaned.replace(/-/g, " ") : cleaned;
    return cleaned.replace(/[-_]+/g, " ").trim().replace(/\p{L}[\p{L}\p{M}\d]*(?:['’][\p{L}\p{M}\d]+)*/gu,
        (word, index) => {
            const conventional = conventionalCase.get(word.toLowerCase());
            if (conventional && (index > 0 || conventional !== conventional.toLowerCase())) return conventional;
            return word.replace(/^\p{L}/u, letter => letter.toUpperCase());
        }) || cleaned;
}
