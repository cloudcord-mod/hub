/*
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findAll } from "@webpack";

interface SpringGlobals {
    skipAnimation?: boolean;
    assign: (options: { skipAnimation: boolean; }) => void;
}

const previousValues = new Map<SpringGlobals, boolean>();

export default definePlugin({
    name: "DisableSpringAnimations",
    description: "Turn off spring animations in Discord's interface.",
    tags: ["Appearance", "Accessibility"],
    authors: [EquicordDevs.seth],
    start() {
        const modules = findAll(module => module.Springs != null && typeof module.Globals?.assign === "function");
        for (const { Globals: globals } of modules) {
            if (previousValues.has(globals)) continue;
            const previous = globals.skipAnimation === true;
            globals.assign({ skipAnimation: true });
            previousValues.set(globals, previous);
        }
    },
    stop() {
        for (const [globals, skipAnimation] of previousValues) globals.assign({ skipAnimation });
        previousValues.clear();
    },
});
