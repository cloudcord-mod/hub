import { initBotCordSwitcher } from "@core/ui/botcord/FloatingSwitcher";
import patchErrorBoundary from "@core/debug/patches/patchErrorBoundary";
import initFixes from "@core/fixes";
import { initFetchI18nStrings } from "@core/i18n";
import initSettings from "@core/ui/settings";
import { initVendettaObject } from "@core/vendetta/api";
import { VdPluginManager } from "@core/vendetta/plugins";
import { restoreSelectedFontFiles } from "@lib/addons/fonts";
import { initThemes } from "@lib/addons/themes";
import { initPlugins, updatePlugins } from "@lib/addons/plugins";
import { patchCommands } from "@lib/api/commands";
import { patchLogHook } from "@lib/api/debug";
import { initLegacyRuntimeRefresh } from "@lib/api/native/legacyRuntimeRefresh";
import { injectFluxInterceptor } from "@lib/api/flux";
import { patchJsx } from "@lib/api/react/jsx";
import { logger } from "@lib/utils/logger";
import { patchSettings } from "@ui/settings";
import { initDebugger } from "@lib/api/debug";

import * as lib from "./lib";

async function runStartupTask(name: string, start: () => unknown) {
    const tasks = (globalThis as any).__CLOUDCORD_STARTUP_TASKS__ ??= {};
    const task = tasks[name] = { status: "starting", error: "" };
    console.log(`CloudCord starting ${name}`);
    try {
        const cleanup = await start();
        task.status = "ready";
        console.log(`CloudCord started ${name}`);
        return typeof cleanup === "function" ? cleanup as () => unknown : undefined;
    } catch (error) {
        task.status = "failed";
        task.error = String(error instanceof Error ? error.message : error);
        console.error(`CloudCord ${name} startup failed`, error);
        return undefined;
    }
}

export default async () => {
    if ((globalThis as any).__CLOUDCORD_ORIGINAL_RAIN__) {
        const prefs = require("@lib/api/settings").settings;
        void require("@core/vendetta/storage").awaitStorage(prefs).then(() => {
            const updater = require("@lib/api/native/modules").BundleUpdaterManager;
            lib.unload.push(require("@lib/api/native/runtimeUpdates").startAutoUpdates(prefs, updater));
        }).catch((error: unknown) => console.warn("CloudCord update check failed", error));
    }
    // Updating an older loader must never hold settings registration hostage
    // to native storage or the reload bridge. Defer even synchronous failures.
    if (!(globalThis as any).__CLOUDCORD_BRIDGELESS__) {
        void Promise.resolve().then(() => initLegacyRuntimeRefresh()).catch(error => {
            console.warn("CloudCord legacy update check failed", error);
        });
    }

    // Load everything in parallel. The shared build workflow wraps core
    // settings separately and applies the version-specific fallbacks.
    await Promise.all([
        runStartupTask("themes", () => initThemes()),
        runStartupTask("events", () => injectFluxInterceptor()),
        patchSettings(),
        runStartupTask("logging", () => patchLogHook()),
        runStartupTask("commands", () => patchCommands()),
        runStartupTask("components", () => patchJsx()),
        runStartupTask("plugin API", () => initVendettaObject()),
        runStartupTask("translations", () => initFetchI18nStrings()),
        initSettings(),
        runStartupTask("account switcher", () => initBotCordSwitcher()),
        runStartupTask("compatibility fixes", () => initFixes()),
        runStartupTask("crash screen", () => patchErrorBoundary()),
        runStartupTask("plugin updates", () => updatePlugins()),
        runStartupTask("core plugins", () => initPlugins()),
        runStartupTask("installed plugins", () => VdPluginManager.initPlugins()),
    ]).then(
        u => u.forEach(f => f && lib.unload.push(f))
    );

    // Missing font files can be repaired without holding up settings or startup.
    void runStartupTask("font files", restoreSelectedFontFiles);

    // Keep the catalog and native appearance adapters off the startup path
    // until storage confirms the user chose to remember an appearance.
    let cancelled = false;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    lib.unload.push(() => {
        cancelled = true;
        if (restoreTimer !== undefined) clearTimeout(restoreTimer);
    });
    void Promise.resolve().then(async () => {
        const { settings } = require("@lib/api/settings") as typeof import("@lib/api/settings");
        const { awaitStorage } = require("@core/vendetta/storage") as typeof import("@core/vendetta/storage");
        await awaitStorage(settings);
        if (cancelled || settings.safeMode?.enabled || !settings.cxRememberedAppearance?.length) return;
        restoreTimer = setTimeout(() => {
            restoreTimer = undefined;
            if (cancelled || settings.safeMode?.enabled) return;
            void runStartupTask("CX appearance", () =>
                require("@core/ui/settings/pages/CxExtensions").restoreRememberedCxAppearance()).then(cleanup => {
                if (!cleanup) return;
                if (cancelled) cleanup();
                else lib.unload.push(cleanup);
            }).catch(error => console.warn("CloudCord could not clean up CX appearance", error));
        }, 0);
    }).catch(error => console.warn("CloudCord could not restore CX appearance", error));

    initDebugger()

    // Assign window object
    window.bunny = lib;

    // We good :)
    // Discord's Logger may suppress info output in production. Emit the same
    // completion point to the native console for launch verification.
    console.log("CloudCord is ready!");
    logger.log("CloudCord is ready!");

};
