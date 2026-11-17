import { IS_WINDOWS } from "@utils/constants";
import { React, UserStore } from "@webpack/common";

import { getTestingAssignment, testingUserId, useTestingUserId } from "@utils/cxTesting";

const platform = IS_WINDOWS ? "windows" : "";
export const currentAssignment = () => getTestingAssignment(testingUserId(UserStore), platform);

export function useTestingPluginsAssignment() {
    return getTestingAssignment(useTestingUserId(React, UserStore), platform);
}
