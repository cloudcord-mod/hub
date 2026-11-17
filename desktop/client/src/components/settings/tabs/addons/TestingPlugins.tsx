import * as DataStore from "@api/DataStore";
import { copyToClipboard } from "@utils/clipboard";
import { React } from "@webpack/common";

import { testingStorageKey } from "@utils/cxTesting";
import { TestingPluginsWeb } from "@utils/cxTesting/Review";
import { currentAssignment, useTestingPluginsAssignment } from "./testingAccess";

export default function TestingPlugins() {
    const assignment = useTestingPluginsAssignment();
    if (!assignment) return null;
    const key = testingStorageKey(assignment);
    const storage = { read: () => DataStore.get(key), write: records => DataStore.set(key, records) };
    let discord = "";
    try { discord = DiscordNative.app.getVersion(); } catch {}
    return <TestingPluginsWeb key={assignment.userId} react={React} assignment={assignment} storage={storage}
        build={{ cloudcord: VERSION, discord }} authorized={() => currentAssignment()?.userId === assignment.userId} copy={copyToClipboard} />;
}
