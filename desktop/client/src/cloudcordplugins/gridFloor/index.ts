/*
 * MallCord, a vaporwave-inspired Discord client mod
 * Copyright (c) 2026 unfamiliardev
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

import managedStyle from "./style.css?managed";

export default definePlugin({
    name: "GridFloor",
    description: "Adds a scrolling retro grid at the bottom of the window.",
    authors: [{ name: "Sharp", id: 0n }],
    managedStyle,
});
