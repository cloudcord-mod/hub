import { Strings } from "@core/i18n";
import { Alert, Platform, ToastAndroid } from "react-native";

export const showToast = (content: string, _asset?: number) => {
    // Keep CloudCord feedback independent of Discord's toast container.
    if (Platform.OS === "android") {
        try {
            if (typeof ToastAndroid?.show === "function") {
                ToastAndroid.show(content, ToastAndroid.SHORT);
                return;
            }
        } catch { /* Fall back if the system toast is unavailable. */ }
    }
    Alert.alert("CloudCord", content);
};

showToast.showCopyToClipboard = (message = Strings.COPIED_TO_CLIPBOARD) => {
    showToast(message);
};
