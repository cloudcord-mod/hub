import contracts from "./cxAdapterContracts.json";

type ModuleContract = { properties: string[]; types: Record<string, string>; };
const sharedContracts: Readonly<Record<string, ModuleContract>> = contracts;

/** Resolve through the platform host and check the methods the CX adapter uses. */
export function resolveCxModule<T>(properties: readonly string[], resolve: () => T): NonNullable<T> {
    const keys = [...new Set(properties)].sort();
    if (!keys.length) throw new Error("CX module adapter requires a method signature");
    const expected = sharedContracts[JSON.stringify(keys)];
    for (const key of keys) {
        const contract = expected ?? sharedContracts[JSON.stringify([key])];
        if (contract?.types[key] !== "function") throw new Error("CX has no shared module contract for " + key);
    }
    const module = resolve();
    for (const key of keys) {
        let value: unknown;
        try { value = (module as Record<string, unknown> | null | undefined)?.[key]; }
        catch { throw new Error("Discord's CX adapter could not resolve " + key); }
        if (typeof value !== "function") throw new Error("Discord's CX adapter is missing " + key);
    }
    return module as NonNullable<T>;
}

type UserLookup<T> = { getCurrentUser?: () => T; getUser?: (id: string) => T; };

/** Resolve the known UserStore when a CX feature needs a user. */
export function findCxUser<T>(resolve: () => UserLookup<T> | undefined, id?: string) {
    try {
        const store = resolveCxModule([id ? "getUser" : "getCurrentUser"], resolve);
        return id ? store.getUser?.(id) : store.getCurrentUser?.();
    } catch {
        return undefined;
    }
}

/** Both hosts supply their named ChannelStore because the generic export names differ. */
export function findCxChannel<T>(resolve: () => { getChannel?: (id: string) => T; } | undefined, id: string) {
    try {
        const store = resolve();
        return typeof store?.getChannel === "function" ? store.getChannel(id) : undefined;
    } catch {
        return undefined;
    }
}
