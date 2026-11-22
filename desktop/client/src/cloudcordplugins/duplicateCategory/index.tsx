/*
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Switch } from "@components/Switch";
import definePlugin from "@utils/types";
import type { Channel, RenderModalProps } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { ChannelStore, Constants, Menu, Modal, openModal, PermissionsBits, PermissionStore, RestAPI, showToast, TextInput, useRef, useState } from "@webpack/common";

function canDuplicate(channel?: Channel) {
    return channel?.type === ChannelType.GUILD_CATEGORY && !!channel.guild_id
        && PermissionStore.can(PermissionsBits.MANAGE_CHANNELS, channel);
}

const DuplicateCategoryModal = ErrorBoundary.wrap(({ category, ...modal }: RenderModalProps & { category: Channel; }) => {
    const [name, setName] = useState(category.name);
    const [copyPermissions, setCopyPermissions] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();
    const inFlight = useRef(false);

    async function createCategory() {
        const nextName = name.trim();
        if (inFlight.current || !nextName || nextName.length > 100) return;
        const source = ChannelStore.getChannel(category.id);
        if (!source || source.guild_id !== category.guild_id || !canDuplicate(source)) {
            setError("The category is unavailable or you no longer have permission to manage it.");
            return;
        }
        inFlight.current = true;
        setSaving(true);
        setError(undefined);
        try {
            await RestAPI.post({
                url: Constants.Endpoints.GUILD_CHANNELS(source.guild_id),
                body: {
                    name: nextName,
                    type: ChannelType.GUILD_CATEGORY,
                    permission_overwrites: copyPermissions ? Object.values(source.permissionOverwrites ?? {}).map(({ id, type, allow, deny }) => ({
                        id, type, allow: String(allow), deny: String(deny),
                    })) : [],
                },
            });
        } catch {
            setError("Discord couldn't create the category. Check your permissions and the server's channel limit.");
            setSaving(false);
            inFlight.current = false;
            return;
        }
        modal.onClose();
        showToast({ text: "Category created", variant: "success" });
    }

    return (
        <Modal
            {...modal}
            title="Duplicate Category"
            size="md"
            notice={error ? { message: error, type: "critical" } : undefined}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modal.onClose, disabled: saving },
                { text: "Create Category", variant: "primary", onClick: createCategory, loading: saving, disabled: saving || !name.trim() },
            ]}
        >
            <form onSubmit={event => { event.preventDefault(); void createCategory(); }}>
                <Flex flexDirection="column" gap={12}>
                    <label htmlFor="cc-duplicate-category-name">Category name</label>
                    <TextInput id="cc-duplicate-category-name" value={name} onChange={setName} maxLength={100} disabled={saving} />
                    <Flex alignItems="center">
                        <span id="cc-duplicate-category-permissions">Copy category permissions</span>
                        <Switch aria-labelledby="cc-duplicate-category-permissions" checked={copyPermissions} onChange={setCopyPermissions} disabled={saving} />
                    </Flex>
                    <span>The new category starts empty.</span>
                </Flex>
            </form>
        </Modal>
    );
}, { noop: false });

const patchCategoryMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel || !canDuplicate(channel)) return;
    const editIds = ["edit-channel", "edit-category"];
    const group = findGroupChildrenByChildId(editIds, children);
    if (!group || group.some(item => item?.props?.id === "cc-duplicate-category")) return;
    const index = group.findIndex(item => editIds.includes(item?.props?.id));
    group.splice(index + 1, 0, <Menu.MenuItem key="cc-duplicate-category" id="cc-duplicate-category" label="Duplicate Category"
        action={() => openModal(props => <DuplicateCategoryModal {...props} category={channel} />)}
    />);
};

export default definePlugin({
    name: "DuplicateCategory",
    description: "Duplicate a server category and optionally copy its permissions.",
    tags: ["Utility"],
    authors: [{ name: "lethied", id: 892246841016590386n }],
    contextMenus: {
        "channel-context": patchCategoryMenu,
        "channel-category-context": patchCategoryMenu,
    },
});
