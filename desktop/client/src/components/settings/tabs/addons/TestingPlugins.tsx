import * as DataStore from "@api/DataStore";
import { copyToClipboard } from "@utils/clipboard";
import { cxCatalog } from "@utils/cxCatalog";
import { React, showToast } from "@webpack/common";

import { testingStorageKey } from "@utils/cxTesting";
import { TestingPluginsWeb } from "@utils/cxTesting/Review";
import { openSettingsTabModal } from "../BaseTab";
import { currentAssignment, useTestingPluginsAssignment } from "./testingAccess";

export default function TestingPlugins() {
    const assignment = useTestingPluginsAssignment();
    if (!assignment) return null;
    const key = testingStorageKey(assignment);
    const storage = { read: () => DataStore.get(key), write: records => DataStore.set(key, records) };
    let discord = "";
    try { discord = DiscordNative.app.getVersion(); } catch {}
    function openCxPort(name: string) {
        const source = cxCatalog.plugins.find(plugin => plugin.name === name)?.source;
        if (typeof source !== "string") {
            showToast("This CX port is unavailable in this build.");
            return;
        }
        function PluginReview() {
            const { CxSettings } = require("@sincordplugins/cxExtensions");
            return <CxSettings initialSource={source} />;
        }
        PluginReview.displayName = name;
        openSettingsTabModal(PluginReview);
    }
    return <TestingPluginsWeb key={assignment.userId} react={React} assignment={assignment} storage={storage}
        build={{ cloudcord: VERSION, discord }} authorized={() => currentAssignment()?.userId === assignment.userId} copy={copyToClipboard} openCxPort={openCxPort} />;
}
