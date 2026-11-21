/*
 * CloudCord, a Discord client mod
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "@sincordplugins/fakeProfile/editor.css";

import { ExtrasPanel } from "@sincordplugins/fakeProfile/extras";

export function PreviewsTab() {
    return <div className="cpx-root cpx-page"><ExtrasPanel section="previews" /></div>;
}

export function AccountToolsTab() {
    return <div className="cpx-root cpx-page"><ExtrasPanel section="tools" /></div>;
}
