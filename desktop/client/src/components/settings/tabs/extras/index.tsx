/*
 * CloudCord, a Discord client mod
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "@sincordplugins/fakeProfile/editor.css";
import "../addons/styles.css";

import { CloudIcon, CogWheel, IDIcon, ImageIcon, InfoIcon, NotesIcon, PluginIcon } from "@components/Icons";
import { ExtrasPanel } from "@sincordplugins/fakeProfile/extras";
import { React } from "@webpack/common";

type Tool = "previews" | "account" | "tweaks" | "bot" | "sync" | "testing" | "diagnostics";
let nextTool: Tool | undefined;

export function setNextTool(tool: Tool) {
    nextTool = tool;
}

export function ToolsTab({ bot, sync, testing, diagnostics }: { bot: boolean; sync: boolean; testing: boolean; diagnostics: boolean; }) {
    const [selected, setSelected] = React.useState<Tool>(() => {
        const tool = nextTool ?? "tweaks";
        nextTool = undefined;
        return tool;
    });
    const tools = [
        { id: "tweaks", label: "Tweaks", Icon: CogWheel },
        { id: "previews", label: "Previews", Icon: ImageIcon },
        { id: "account", label: "Account Tools", Icon: IDIcon },
        { id: "sync", label: "CloudSync", Icon: CloudIcon, visible: sync },
        { id: "bot", label: "Botcord", Icon: PluginIcon, visible: bot },
        { id: "testing", label: "Testing Plugins", Icon: NotesIcon, visible: testing },
        { id: "diagnostics", label: "Diagnostics", Icon: InfoIcon, visible: diagnostics },
    ].filter(tool => tool.visible !== false) as { id: Tool; label: string; Icon: typeof CloudIcon; }[];
    const section = tools.some(tool => tool.id === selected) ? selected : "tweaks";
    let content: React.ReactNode;
    switch (section) {
        case "previews": content = <ExtrasPanel section="previews" />; break;
        case "account": content = <ExtrasPanel section="tools" />; break;
        case "bot": {
            const { BotCordTab: Page } = require("@components/settings");
            content = <Page />;
            break;
        }
        case "sync": {
            const Page = require("@components/settings/tabs/sync/CloudTab").default;
            content = <Page />;
            break;
        }
        case "testing": {
            const Page = require("@components/settings/tabs/addons/TestingPlugins").default;
            content = <Page />;
            break;
        }
        case "diagnostics": {
            const { CloudCordDiagnosticsTab: Page } = require("@components/settings");
            content = <Page />;
            break;
        }
        default: {
            const { TweaksPage: Page } = require("@components/settings/tabs/addons/TweaksPage");
            content = <Page />;
        }
    }
    return <>
        <nav className="cc-addons-seg" role="tablist" aria-label="Tools">
            {tools.map(({ id, label, Icon }, index) => <button key={id} id={`cloudcord-tool-${id}`}
                type="button" role="tab" aria-selected={section === id} aria-controls="cloudcord-tools-panel"
                tabIndex={section === id ? 0 : -1}
                className={`cc-addons-seg-item${section === id ? " cc-addons-seg-active" : ""}`}
                onClick={() => setSelected(id)}
                onKeyDown={event => {
                    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                    const next = event.key === "Home" ? 0 : event.key === "End" ? tools.length - 1
                        : direction ? (index + direction + tools.length) % tools.length : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    setSelected(tools[next].id);
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
                }}>
                <Icon width={16} height={16} className="cc-addons-seg-icon" />{label}
            </button>)}
        </nav>
        <div id="cloudcord-tools-panel" key={section} role="tabpanel"
            aria-labelledby={`cloudcord-tool-${section}`} className="cpx-root cpx-page cc-addons-page">
            {content}
        </div>
    </>;
}
