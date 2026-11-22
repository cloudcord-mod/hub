import { awaitStorage, createMMKVBackend, createStorage, purgeStorage, wrapSync } from "@core/vendetta/storage";
import { Author } from "@lib/addons/types";
import { settings } from "@lib/api/settings";
import { pluginIdentityMetro, pluginIdentityPatcher } from "@lib/api/profileIdentity";
import { safeFetch } from "@lib/utils";
import { BUNNY_PROXY_PREFIX, VD_PROXY_PREFIX } from "@lib/utils/constants";
import { logger,LoggerClass } from "@lib/utils/logger";

type EvaledPlugin = {
    onLoad?(): void;
    onUnload(): void;
    settings: React.ComponentType<unknown>;
};

// See https://github.com/vendetta-mod/polymanifest
interface PluginManifest {
    name: string;
    description: string;
    authors: Author[];
    main: string;
    hash: string;
    // Vendor-specific field, contains our own data
    vendetta?: {
        icon?: string;
    };
}

export interface VendettaPlugin {
    id: string;
    manifest: PluginManifest;
    enabled: boolean;
    update: boolean;
    js: string;
}

const plugins = wrapSync(createStorage<Record<string, VendettaPlugin>>(createMMKVBackend("VENDETTA_PLUGINS")));
const pluginInstance: Record<string, EvaledPlugin> = {};
const pendingFetches = new Map<string, Promise<void>>();
const pendingInstalls = new Map<string, Promise<void>>();

function pluginMain(manifest: PluginManifest) {
    const value = manifest.main || "index.js";
    if (typeof value !== "string" || value.length > 256) return;
    const main = value.replace(/^\.\//, "");
    if (!/^(?:[\w.-]+\/)*[\w.-]+$/.test(main) || main.split("/").some(part => part === ".." || part === ".")) return;
    return main;
}

export const VdPluginManager = {
    plugins,
    async pluginFetch(url: string) {
        if (url.startsWith(VD_PROXY_PREFIX)) {
            url = url
                .replace("https://bunny-mod.github.io/plugins-proxy", BUNNY_PROXY_PREFIX)
                .replace(VD_PROXY_PREFIX, BUNNY_PROXY_PREFIX);
        }

        return await safeFetch(url, { cache: "no-store" });
    },

    fetchPlugin(id: string) {
        if (!id.endsWith("/")) id += "/";
        const pending = pendingFetches.get(id);
        if (pending) return pending;

        const fetch = async () => {
            const existingPlugin = plugins[id];
            let manifest: PluginManifest;
            try {
                manifest = await (await this.pluginFetch(id + "manifest.json")).json();
            } catch {
                throw new Error(`Failed to fetch manifest for ${id}`);
            }
            const main = manifest && pluginMain(manifest);
            if (!main || typeof manifest.name !== "string" || !manifest.name.trim()
                || typeof manifest.hash !== "string" || !manifest.hash.trim()) {
                throw new Error(`Invalid plugin manifest for ${id}`);
            }

            let js = existingPlugin?.js;
            if (!js || existingPlugin?.manifest?.hash !== manifest.hash || pluginMain(existingPlugin.manifest) !== main) {
                try {
                    js = await (await this.pluginFetch(id + main)).text();
                    if (!js.trim()) throw new Error("Empty plugin file");
                } catch {
                    throw new Error(`Failed to fetch JS for ${id}`);
                }
            }
            if (plugins[id] !== existingPlugin) throw new Error(`Plugin changed during download for ${id}`);

            plugins[id] = {
                id,
                manifest: {
                    ...manifest,
                    description: typeof manifest.description === "string" ? manifest.description : "",
                    authors: Array.isArray(manifest.authors) ? manifest.authors.filter(author => typeof author?.name === "string") : [],
                },
                enabled: existingPlugin?.enabled ?? false,
                update: existingPlugin?.update ?? true,
                js,
            };
        };
        const request = Promise.resolve().then(fetch).finally(() => pendingFetches.delete(id));
        pendingFetches.set(id, request);
        return request;
    },

    async installPlugin(id: string, enabled = true) {
        if (typeof id !== "string") throw new Error("Invalid plugin link");
        if (!id.endsWith("/")) id += "/";
        const pending = pendingInstalls.get(id);
        if (pending) return pending;
        if (id in plugins) throw new Error("Plugin already installed");
        const install = async () => {
            await this.fetchPlugin(id);
            if (enabled) await this.startPlugin(id);
        };
        const request = Promise.resolve().then(install).finally(() => pendingInstalls.delete(id));
        pendingInstalls.set(id, request);
        return request;
    },

    /**
     * @internal
     */
    async evalPlugin(plugin: VendettaPlugin) {
        const vendettaForPlugins = {
            ...window.vendetta,
            metro: pluginIdentityMetro(window.vendetta.metro),
            patcher: pluginIdentityPatcher(window.vendetta.patcher),
            plugin: {
                id: plugin.id,
                manifest: plugin.manifest,
                // Wrapping this with wrapSync is NOT an option.
                storage: await createStorage<Record<string, any>>(createMMKVBackend(plugin.id)),
            },
            logger: new LoggerClass(`CloudCord » ${plugin.manifest.name}`),
        };
        const pluginString = `vendetta=>{return ${plugin.js}}\n//# sourceURL=${plugin.id}`;

        const raw = (0, eval)(pluginString)(vendettaForPlugins);
        const ret = typeof raw === "function" ? raw() : raw;
        return ret?.default ?? ret ?? {};
    },

    async startPlugin(id: string) {
        if (!id.endsWith("/")) id += "/";
        const plugin = plugins[id];
        if (!plugin) throw new Error("Attempted to start non-existent plugin");

        try {
            if (!settings.safeMode?.enabled) {
                const pluginRet: EvaledPlugin = await this.evalPlugin(plugin);
                pluginInstance[id] = pluginRet;
                pluginRet.onLoad?.();
            }
            plugin.enabled = true;
        } catch (e) {
            logger.error(`Plugin ${plugin.id} errored whilst loading, and will be unloaded`, e);

            try {
                pluginInstance[plugin.id]?.onUnload?.();
            } catch (e2) {
                logger.error(`Plugin ${plugin.id} errored whilst unloading`, e2);
            }

            delete pluginInstance[id];
            plugin.enabled = false;
            throw e;
        }
    },

    stopPlugin(id: string, disable = true) {
        if (!id.endsWith("/")) id += "/";
        const plugin = plugins[id];
        const pluginRet = pluginInstance[id];
        if (!plugin) throw new Error("Attempted to stop non-existent plugin");

        if (!settings.safeMode?.enabled) {
            try {
                pluginRet?.onUnload?.();
            } catch (e) {
                logger.error(`Plugin ${plugin.id} errored whilst unloading`, e);
            }

            delete pluginInstance[id];
        }

        if (disable) plugin.enabled = false;
    },

    async removePlugin(id: string) {
        if (!id.endsWith("/")) id += "/";
        const plugin = plugins[id];
        if (plugin.enabled) this.stopPlugin(id);
        delete plugins[id];
        await purgeStorage(id);
    },

    /**
     * @internal
     */
    async initPlugins() {
        await awaitStorage(settings, plugins);
        const allIds = Object.keys(plugins);

        if (!settings.safeMode?.enabled) {
            for (const id of allIds) {
                const plugin = plugins[id];
                if (!plugin.enabled && !plugin.update) continue;
                void (async () => {
                    if (plugin.update) {
                        try { await this.fetchPlugin(id); }
                        catch (error) { logger.error(`Couldn't update plugin ${id}`, error); }
                    }
                    if (!settings.safeMode?.enabled && plugins[id]?.enabled) await this.startPlugin(id);
                })().catch(error => logger.error(`Couldn't start plugin ${id}`, error));
            }
        }

        return () => this.stopAllPlugins();
    },

    stopAllPlugins() {
        return Object.keys(pluginInstance).forEach(p => this.stopPlugin(p, false));
    },

    getSettings: (id: string) => pluginInstance[id]?.settings
};
