import * as DataStore from "@api/DataStore";
import { copyToClipboard } from "@utils/clipboard";
import { IS_WINDOWS } from "@utils/constants";
import { React, UserStore } from "@webpack/common";

import { getTestingAssignment, testingStorageKey, testingUserId, useTestingUserId } from "../../../../../../../config/cx-testing";
import { TestingPluginsWeb } from "../../../../../../../config/cx-testing-web";

const platform = IS_WINDOWS ? "windows" : "";
const currentAssignment = () => getTestingAssignment(testingUserId(UserStore), platform);

export function useTestingPluginsAssignment() {
    return getTestingAssignment(useTestingUserId(React, UserStore), platform);
}

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
