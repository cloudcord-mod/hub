/*
 * CloudCord, a Discord client mod
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "@sincordplugins/fakeProfile/editor.css";

import { ExtrasPanel } from "@sincordplugins/fakeProfile/extras";
import { React } from "@webpack/common";

export function ToolsTab() {
    const [section, setSection] = React.useState<"previews" | "tools">("previews");
    return <div className="cpx-root cpx-page">
        <div className="cpx-inline cpx-preview-modes" role="group" aria-label="Tools section">
            <button type="button" className={`cpx-btn ${section === "previews" ? "cpx-btn-primary" : "cpx-btn-ghost"}`}
                aria-pressed={section === "previews"} onClick={() => setSection("previews")}>Previews</button>
            <button type="button" className={`cpx-btn ${section === "tools" ? "cpx-btn-primary" : "cpx-btn-ghost"}`}
                aria-pressed={section === "tools"} onClick={() => setSection("tools")}>Account Tools</button>
        </div>
        <ExtrasPanel key={section} section={section} />
    </div>;
}
