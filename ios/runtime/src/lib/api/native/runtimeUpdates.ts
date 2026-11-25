const URL = "https://getcloudcord.com/api/proxy/raw/dist/cc.js";
const MANIFEST_URL = "https://getcloudcord.com/api/proxy/raw/dist/runtime-manifest.json";
const REVISION = /^[a-f0-9]{40}$/;

async function readResponse<T>(url: string, readBody: (response: Response) => Promise<T>, deadline: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const abort = typeof AbortController === "function" ? new AbortController() : undefined;
    try {
        return await Promise.race([
            (async () => {
                const response = await fetch(url, { headers: { "X-CC-Client": "1" }, cache: "no-store", signal: abort?.signal });
                if (!response.ok) throw new Error("runtime download failed (" + response.status + ")");
                return readBody(response);
            })(),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    reject(new Error("download timed out"));
                    abort?.abort();
                }, deadline);
            })
        ]);
    } finally {
        if (timeout !== undefined) clearTimeout(timeout);
    }
}
export async function fetchRuntimeUpdate(updater: any) {
    if (typeof updater?.checkForUpdates === "function") return updater.checkForUpdates();
    if (typeof updater?.download === "function") return updater.download();
    throw new Error("This loader cannot fetch from settings. Use Refetch Bundle in the recovery menu.");
}

export function startAutoUpdates(prefs: any, updater: any) {
    let stopped = false, checking = false;
    const check = async () => {
        if (stopped || checking || prefs.cloudcordAutoUpdate === false) return;
        checking = true;
        prefs.cloudcordUpdateStatus = "Checking for updates…";
        try {
            const updated = await fetchRuntimeUpdate(updater);
            if (!stopped) prefs.cloudcordUpdateStatus = updated === false
                ? "CloudCord is up to date."
                : "Latest runtime saved. Reopen Discord to apply it.";
        } catch (error: any) {
            if (!stopped) prefs.cloudcordUpdateStatus = "Update failed: " + (error?.message || "connection unavailable") + ". Retrying automatically.";
        } finally { checking = false; }
    };
    void check();
    const retry = setTimeout(() => void check(), 45000);
    const interval = setInterval(() => void check(), 5 * 60 * 1000);
    return () => { stopped = true; clearTimeout(retry); clearInterval(interval); };
}
export function createRainUpdater(files: any) {
    let pending: Promise<void> | undefined;
    let checking: Promise<boolean> | undefined;
    let savedRevision: string | undefined;
    const download = (url = URL + "?t=" + Date.now()) => pending ??= (async () => {
        const code = await readResponse(url, response => response.text(), 90000);
        if (code.length < 10000 || !code.includes("CloudCord")) throw new Error("invalid runtime response");
        if (typeof files?.writeFile !== "function") throw new Error("runtime file writer unavailable");
        const path = await files.writeFile("documents", "rain/bundle.js", code, "utf8");
        if (path && typeof files.readFile === "function" && await files.readFile(path, "utf8") !== code) throw new Error("saved runtime did not match download");
    })().finally(() => { pending = undefined; });
    const checkForUpdates = () => checking ??= (async () => {
        const manifest = await readResponse(MANIFEST_URL, response => response.json(), 15000);
        if (manifest?.schema !== 1 || typeof manifest.version !== "string" || !REVISION.test(manifest.version) || typeof manifest.url !== "string") {
            throw new Error("invalid runtime manifest");
        }
        if (manifest.version === (globalThis as any).__CLOUDCORD_RUNTIME_REVISION__) return false;
        if (manifest.version === savedRevision) return true;

        const raw = manifest.url.match(/^https:\/\/raw\.githubusercontent\.com\/xohus\/cloudcord\/([a-f0-9]{40})\/dist\/cc\.js$/);
        const proxy = manifest.url.startsWith(URL + "?ref=") ? manifest.url.slice(URL.length + 5) : undefined;
        const payloadRevision = raw?.[1] ?? proxy;
        if (!payloadRevision || !REVISION.test(payloadRevision)) throw new Error("invalid runtime payload URL");
        // A manual recovery download may already be writing this same cache file.
        if (pending) await pending;
        await download(URL + "?ref=" + payloadRevision);
        savedRevision = manifest.version;
        return true;
    })().finally(() => { checking = undefined; });
    return {
        download, checkForUpdates,
        reload: async () => {
            await download();
            const bridge = (globalThis as any).__RAIN_BRIDGE_CALL_SYNC__;
            if (typeof bridge !== "function") throw new Error("Rain reload bridge unavailable");
            const result = bridge({ rain: { method: "updater.reload", args: [] } });
            if (result?.error) throw new Error(result.error);
        }
    };
}
