/*
 * CloudCord Purge DMs
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Channel } from "@vencord/discord-types";
import { Devs } from "@utils/constants";
import { purgeOwnMessages, PurgeSignal } from "@utils/purgeDm";
import definePlugin from "@utils/types";
import { Alerts, ChannelStore, Menu, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

const DM = 1;
let running: { channelId: string; signal: PurgeSignal; bar: HTMLElement; } | null = null;

function nameOf(channel: Channel) {
    const user = UserStore.getUser(channel.recipients?.[0]);
    return (user as any)?.globalName || user?.username || "this user";
}

function progressBar(name: string, cancel: () => void) {
    const bar = document.createElement("div");
    bar.className = "cc-purge-bar";
    bar.innerHTML = '<span class="cc-purge-text"></span><button type="button" class="cc-purge-cancel">Cancel</button>';
    bar.querySelector("button")!.addEventListener("click", cancel);
    document.body.appendChild(bar);
    const text = bar.querySelector<HTMLElement>(".cc-purge-text")!;
    return { bar, update: (deleted: number, found: number) => { text.textContent = `Purging your messages with ${name}: ${deleted} deleted, ${found} found`; } };
}

function stopRunning() {
    if (!running) return;
    running.signal.cancelled = true;
    running.bar.remove();
    running = null;
}

async function purge(channel: Channel) {
    const me = UserStore.getCurrentUser()?.id;
    // Only one-to-one DMs: never servers or group chats.
    if (!me || channel.type !== DM || channel.guild_id) return;
    if (running) return showToast("A purge is already running.", Toasts.Type.FAILURE);
    const name = nameOf(channel);
    const signal: PurgeSignal = { cancelled: false };
    const { bar, update } = progressBar(name, () => { signal.cancelled = true; });
    running = { channelId: channel.id, signal, bar };
    update(0, 0);
    try {
        const result = await purgeOwnMessages({ rest: RestAPI as any, channelId: channel.id, authorId: me, signal, pace: 1000, onProgress: update });
        const skipped = result.skipped ? `, ${result.skipped} couldn't be deleted` : "";
        showToast(`${result.cancelled ? "Purge cancelled" : "Purge finished"}: ${result.deleted} deleted${skipped}.`, result.cancelled ? Toasts.Type.MESSAGE : Toasts.Type.SUCCESS);
    } catch {
        showToast("Purge stopped: Discord didn't return the message history.", Toasts.Type.FAILURE);
    } finally {
        if (running?.signal === signal) { bar.remove(); running = null; }
    }
}

function confirmPurge(channel: Channel) {
    Alerts.show({
        title: "Purge my messages",
        body: `Delete every message you sent in your DM with ${nameOf(channel)}? Their messages stay. This can't be undone, and it runs slowly (about one message a second) to avoid rate limits.`,
        confirmText: "Delete my messages",
        cancelText: "Cancel",
        confirmColor: "red",
        onConfirm: () => void purge(channel),
    });
}

const item = (channel: Channel) => (
    <Menu.MenuGroup>
        <Menu.MenuItem id="cc-purge-dm" label={running?.channelId === channel.id ? "Stop purging my messages" : "Purge my messages"} color="danger"
            action={() => running?.channelId === channel.id ? stopRunning() : confirmPurge(channel)} />
    </Menu.MenuGroup>
);

const ChannelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (channel?.type === DM && !channel.guild_id) children.push(item(channel));
};
const UserContext: NavContextMenuPatchCallback = (children, { user }: { user?: { id: string; }; }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id) return;
    const dmId = ChannelStore.getDMFromUserId(user.id);
    const channel = dmId ? ChannelStore.getChannel(dmId) : null;
    if (channel?.type === DM) children.push(item(channel));
};

export default definePlugin({
    name: "PurgeDMs",
    description: "Adds \"Purge my messages\" to a DM's and a user's right-click menu: deletes every message you sent in that DM, one by one. Warning: bulk deleting is automation that Discord can flag on your account. Use at your own risk.",
    authors: [Devs.Xohus],
    tags: ["Utility", "Chat"],
    searchTerms: ["delete", "purge", "clear", "dm", "messages"],
    contextMenus: {
        "channel-context": ChannelContext,
        "user-context": UserContext,
    },
    start() {
        window.addEventListener("beforeunload", stopRunning);
    },
    stop() {
        window.removeEventListener("beforeunload", stopRunning);
        stopRunning();
    },
});
