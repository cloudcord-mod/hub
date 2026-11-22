/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * Source: https://github.com/ImHisako/Illegalcord/tree/8b33a1d5a07798429fe79865e02aac8c8e1d326b/src/plugins/mutedServersActivityBadge
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "MutedServersActivityBadge",
    description: "Keeps the servers activity badge visible even when server is muted.",
    authors: [{ name: "NiNoX", id: 123435354958200833n }],
    tags: ["Servers", "Appearance", "Activity", "Voice"],

    patches: [
        {
            find: '"GuildMediaStateStore"',
            replacement: {
                match: /=\i\.\i\.isMuted\(\i\)/,
                replace: "=false"
            }
        }
    ]
});
