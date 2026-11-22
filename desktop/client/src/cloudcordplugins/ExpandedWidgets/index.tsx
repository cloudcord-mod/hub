/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * Source: https://github.com/ImHisako/Illegalcord/tree/8b33a1d5a07798429fe79865e02aac8c8e1d326b/src/illegalcordplugins/expandedWidgets
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "ExpandedWidgets",
    description: "Enables setting multiple of the same tags for a game in your profile",
    tags: ["Chat", "Appearance"],
    authors: [
        { name: "sadie", id: 0n }
    ],
    patches: [
        {
            find: "BETTER_THAN_YOU]:{",
            replacement: {
                match: /(type:)"radio"/,
                replace: "$1\"checkbox\""
            }
        }
    ]
});
