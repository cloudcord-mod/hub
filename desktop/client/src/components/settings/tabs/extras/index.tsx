/*
 * CloudCord, a Discord client mod
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "@sincordplugins/fakeProfile/editor.css";

import { CloudIcon } from "@components/Icons";
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
    const groups: { title: string; tools: { id: Tool; label: string; visible?: boolean; }[]; }[] = [
        { title: "Customize", tools: [{ id: "tweaks", label: "Tweaks" }, { id: "previews", label: "Previews" }] },
        { title: "Accounts and data", tools: [{ id: "account", label: "Account Tools" }, { id: "sync", label: "CloudSync", visible: sync }, { id: "bot", label: "Botcord", visible: bot }] },
        { title: "Testing and support", tools: [{ id: "testing", label: "Testing Plugins", visible: testing }, { id: "diagnostics", label: "Diagnostics", visible: diagnostics }] },
    ];
    const section = groups.some(group => group.tools.some(tool => tool.id === selected && tool.visible !== false)) ? selected : "tweaks";
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
    return <div className="cpx-root cpx-page">
        <div className="cpx-inline cpx-tools-groups">
            {groups.map(({ title, tools }) => {
                const visible = tools.filter(tool => tool.visible !== false);
                return !!visible.length && <div key={title} role="group" aria-label={title} className="cpx-tools-group">
                    <span>{title}</span>
                    <div className="cpx-inline">
                        {visible.map(({ id, label }) => <button key={id} type="button"
                            className={`cpx-btn ${section === id ? "cpx-btn-primary" : "cpx-btn-ghost"}`}
                            aria-pressed={section === id} onClick={() => setSelected(id)}>
                            {id === "sync" && <CloudIcon width={16} height={16} />}{label}
                        </button>)}
                    </div>
                </div>;
            })}
        </div>
        <React.Fragment key={section}>{content}</React.Fragment>
    </div>;
}
