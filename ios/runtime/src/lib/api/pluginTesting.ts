import { getTestingAssignment, testingUserId, useTestingUserId } from "@lib/api/cxTesting";
import { React } from "@metro/common";
import { findByStoreNameLazy } from "@metro/wrappers";
import { Platform } from "react-native";

const UserStore = findByStoreNameLazy("UserStore");

export function currentTestingAssignment() {
    return getTestingAssignment(testingUserId(UserStore), Platform.OS);
}

export function useMobileTestingAssignment() {
    const userId = useTestingUserId(React, UserStore);
    return getTestingAssignment(userId, Platform.OS);
}
