/*
 * CloudCord
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { PaintbrushIcon, PluginsIcon } from "@components/Icons";
import { classNameFactory } from "@utils/css";
import { IconProps } from "@utils/types";
import { React } from "@webpack/common";
import type { ComponentType } from "react";

import { wrapTab } from "../BaseTab";
import { PluginsPage, ThemesPage } from "./AddonPage";
import FontsPage from "./FontsPage";

const cl = classNameFactory("cc-addons-");

interface Page { name: string; Icon: ComponentType<IconProps>; Tab: ComponentType; show?(v: any): boolean; }

const PAGES: Page[] = [
    { name: "Plugins", Icon: PluginsIcon, Tab: PluginsPage, show: v => v.showPluginsTab !== false },
    { name: "Themes", Icon: PaintbrushIcon, Tab: ThemesPage, show: v => v.showThemesTab !== false },
    { name: "Fonts", Icon: PaintbrushIcon, Tab: FontsPage },
];

// Lets other pages (like Overview) open Add-ons on a specific tab.
let nextTab: string | null = null;
export const setNextAddonsTab = (name: string) => { nextTab = name; };

function Addons() {
    const visibility = (useSettings().plugins.Settings ?? {}) as any;
    const pages = PAGES.filter(p => p.show?.(visibility) ?? true);
    const [current, setCurrent] = React.useState(() => {
        const wanted = nextTab;
        nextTab = null;
        return pages.find(p => p.name === wanted)?.name ?? pages[0]?.name;
    });
    const active = pages.find(p => p.name === current) ?? pages[0];
    if (!active) return null;
    const Tab = active.Tab;

    return (
        <>
            <nav className={cl("seg")} role="tablist" aria-label="Add-ons">
                {pages.map(({ name, Icon }) => (
                    <button
                        key={name}
                        id={`cloudcord-addons-${name.toLowerCase()}`}
                        role="tab"
                        aria-selected={name === active.name}
                        aria-controls="cloudcord-addons-panel"
                        tabIndex={name === active.name ? 0 : -1}
                        className={cl("seg-item", { "seg-active": name === active.name })}
                        onClick={() => setCurrent(name)}
                        onKeyDown={event => {
                            const tabs = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("[role=tab]")];
                            const index = tabs.indexOf(event.currentTarget);
                            let next: HTMLButtonElement | undefined;
                            if (event.key === "ArrowLeft") next = tabs[(index + tabs.length - 1) % tabs.length];
                            if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
                            if (event.key === "Home") next = tabs[0];
                            if (event.key === "End") next = tabs.at(-1);
                            if (!next) return;
                            event.preventDefault();
                            next.focus();
                            next.click();
                        }}
                    >
                        <Icon width={16} height={16} className={cl("seg-icon")} />
                        <span>{name}</span>
                    </button>
                ))}
            </nav>
            <div id="cloudcord-addons-panel" role="tabpanel" aria-labelledby={`cloudcord-addons-${active.name.toLowerCase()}`}
                className={cl("page")} key={active.name}>
                <ErrorBoundary message={`Couldn't open ${active.name}. Try another tab, then come back.`}>
                    <Tab />
                </ErrorBoundary>
            </div>
        </>
    );
}

export default wrapTab(Addons, "Add-ons");
