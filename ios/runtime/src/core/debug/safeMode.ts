import { getCurrentTheme, writeThemeToNative } from "@lib/addons/themes";
import { BundleUpdaterManager } from "@lib/api/native/modules";
import { settings } from "@lib/api/settings";
import { Alert } from "react-native";

export async function requestDiscordReload() {
    try {
        if (typeof BundleUpdaterManager?.reload === "function") {
            await BundleUpdaterManager.reload();
            return;
        }
    } catch {
        // The loader could not restart in place. Closing the app still applies saved settings.
    }
    Alert.alert("Restart Discord", "Fully close and reopen Discord to apply the change.");
}

export function isSafeMode() {
    return settings.safeMode?.enabled === true;
}

export async function toggleSafeMode({
    to = !isSafeMode(),
    reload = true
} = {}) {
    const enabled = (settings.safeMode ??= { enabled: to }).enabled = to;
    const currentColor = getCurrentTheme();
    await writeThemeToNative(enabled ? {} : currentColor?.data ?? {});
    if (reload) setTimeout(requestDiscordReload, 500);
}
