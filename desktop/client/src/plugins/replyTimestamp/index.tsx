/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import ReplyTimestamp from "./ReplyTimestamp";

export default definePlugin({
    name: "ReplyTimestamp",
    description: "Shows a timestamp on replied-message previews",
    tags: ["Chat", "Appearance"],
    authors: [Devs.Kyuuhachi],

    patches: [
        {
            // Same find as in ValidReply
            find: "#{intl::REPLY_QUOTE_MESSAGE_NOT_LOADED}",
            replacement: {
                match: /\.onClickReply,.+?}\),(?=\i,\i,\i\])/,
                replace: "$&$self.ReplyTimestamp(arguments[0]),"
            }
        }
    ],

    ReplyTimestamp,
});
