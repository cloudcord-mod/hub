import queues from "./cx-testing-queues.json";
import catalogLinks from "./cx-testing-catalog-links.json";

type Platform = "windows" | "ios" | "android";
export type TestingStatus = "Pass" | "Fail" | "Blocked";
type Entry = { id: string; name: string; group: string; catalogName?: string; };
export type TestingAssignment = { userId: string; platform: Platform; label: string; entries: Entry[]; };
type Build = { cloudcord: string; discord: string; };
type Result = Build & { status: TestingStatus; error: string; };
type Results = Record<string, Result>;
type Storage = { read: () => unknown | Promise<unknown>; write: (records: Results) => unknown | Promise<unknown>; };
type Hooks = {
    useState<T>(initial: T): [T, (value: T | ((previous: T) => T)) => void];
    useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void;
    useRef<T>(initial: T): { current: T; };
};

type UserStore = {
    getCurrentUser?: () => { id?: string; } | null | undefined;
    addChangeListener?: (listener: () => void) => void;
    removeChangeListener?: (listener: () => void) => void;
};

export function testingUserId(store: UserStore | undefined) {
    try { return store?.getCurrentUser?.()?.id; }
    catch { return undefined; }
}

export function useTestingUserId(react: Hooks, store: UserStore | undefined) {
    const [userId, setUserId] = react.useState(testingUserId(store));
    react.useEffect(() => {
        const read = () => setUserId(testingUserId(store));
        read();
        try {
            store?.addChangeListener?.(read);
            return () => { try { store?.removeChangeListener?.(read); } catch {} };
        } catch { return undefined; }
    }, [store]);
    return userId;
}

const testers = new Map<string, { platform: Platform; label: string; queue: number; }>([
    ["1429837711602094201", { platform: "windows", label: "Desktop 1", queue: 0 }],
    ["463515440606609419", { platform: "windows", label: "Desktop 2", queue: 1 }],
    ["1569533258461614171", { platform: "ios", label: "Mobile 1", queue: 0 }],
    ["1539587971840483359", { platform: "android", label: "Mobile 2", queue: 1 }],
    ["1205417504718192680", { platform: "ios", label: "Mobile 3", queue: 2 }],
    ["801526290623627315", { platform: "ios", label: "iOS shared plugin retests", queue: -1 }],
]);
const links: Readonly<Partial<Record<string, string>>> = catalogLinks;
const entries = queues.map(queue => queue.map(([id, name, group]) => ({ id, name, group, catalogName: links[id] })));
const sharedGroup = "Shared declarative CX";
const mobileOrder = [sharedGroup, "Discover CX preview", "Desktop CX pack"];
const mobileQueues = entries.map(queue => [...queue].sort((a, b) => mobileOrder.indexOf(a.group) - mobileOrder.indexOf(b.group)));
const retests = entries.flat().filter(entry => entry.group === sharedGroup).sort((a, b) => a.name.localeCompare(b.name));

export function getTestingAssignment(userId: string | undefined, platform: string): TestingAssignment | undefined {
    if (!userId) return;
    const tester = testers.get(userId);
    if (tester?.platform !== platform) return;
    return {
        userId,
        platform: tester.platform,
        label: tester.label,
        entries: tester.queue < 0 ? retests : (platform === "windows" ? entries : mobileQueues)[tester.queue],
    };
}

export function testingStorageKey(assignment: TestingAssignment) {
    return "cloudcord.cx.testing.v1." + assignment.userId + "." + assignment.platform;
}

function loadResults(value: unknown, assignment: TestingAssignment) {
    const records: Results = {};
    if (!value || typeof value !== "object") return records;
    for (const { id } of assignment.entries) {
        const result = (value as Partial<Results>)[id];
        if (!result || !["Pass", "Fail", "Blocked"].includes(result.status)) continue;
        if (typeof result.cloudcord !== "string" || typeof result.discord !== "string" || typeof result.error !== "string") continue;
        records[id] = result;
    }
    return records;
}

export function exportTestingResults(assignment: TestingAssignment, records: Results) {
    const csv = (fields: string[]) => fields.map(value => {
        const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) ? "'" + value : value;
        return '"' + safe.replaceAll('"', '""') + '"';
    }).join(",");
    return [
        csv(["Plugin ID", "Plugin", "Platform", "Status", "CloudCord build", "Discord build", "Exact error or blocker"]),
        ...assignment.entries.flatMap(({ id, name }) => {
            const result = records[id];
            return result ? [csv([id, name, assignment.platform, result.status, result.cloudcord, result.discord, result.error])] : [];
        }),
    ].join("\r\n");
}

export function useTestingReview(react: Hooks, assignment: TestingAssignment, storage: Storage, initialBuild: Build, authorized: () => boolean) {
    const [records, setRecords] = react.useState<Results | undefined>(undefined);
    const [search, setSearch] = react.useState("");
    const [position, setPosition] = react.useState(0);
    const [build, setBuild] = react.useState(initialBuild);
    const [draft, setDraft] = react.useState<{ id: string; error: string; } | undefined>(undefined);
    const [message, setMessage] = react.useState("");
    const [saving, setSaving] = react.useState(false);
    const pending = react.useRef(false);
    const storageRef = react.useRef(storage);
    storageRef.current = storage;
    react.useEffect(() => {
        let closed = false;
        Promise.resolve().then(() => storageRef.current.read()).then(value => {
            if (!closed) setRecords(loadResults(value, assignment));
        }, () => { if (!closed) setMessage("Could not load saved tests."); });
        return () => { closed = true; };
    }, [assignment.userId, assignment.platform]);

    const query = search.trim().toLowerCase();
    const filtered = assignment.entries.filter(entry => !query || entry.name.toLowerCase().includes(query) || entry.id.includes(query));
    const index = Math.min(position, Math.max(0, filtered.length - 1));
    const entry = filtered[index];
    const review = entry ? records?.[entry.id] : undefined;
    const error = draft && draft.id === entry?.id ? draft.error : review?.error ?? "";

    async function save(status: TestingStatus) {
        if (!entry || !records || pending.current || !authorized()) return;
        const cloudcord = build.cloudcord.trim();
        const discord = build.discord.trim();
        if (!cloudcord || !discord) { setMessage("Enter both build numbers."); return; }
        if (status !== "Pass" && !error.trim()) { setMessage("Enter the exact error or blocker."); return; }
        const next = { ...records, [entry.id]: { status, cloudcord, discord, error: status === "Pass" ? "" : error } };
        pending.current = true;
        setSaving(true);
        try {
            await storageRef.current.write(next);
            setRecords(next);
            setDraft(undefined);
            setMessage("Saved " + status + ".");
        } catch {
            setMessage("Could not save this result.");
        } finally {
            pending.current = false;
            setSaving(false);
        }
    }

    return {
        entry, review, error, message, saving, ready: records !== undefined, search, build,
        completed: Object.keys(records ?? {}).length, count: filtered.length, index,
        searchFor(value: string) { setSearch(value); setPosition(0); setDraft(undefined); setMessage(""); },
        move(step: number) { setPosition(Math.max(0, Math.min(index + step, filtered.length - 1))); setDraft(undefined); setMessage(""); },
        setBuild(field: keyof Build, value: string) { setBuild(previous => ({ ...previous, [field]: value })); },
        setError(value: string) { if (entry) setDraft({ id: entry.id, error: value }); },
        save,
        export() { return records && authorized() ? exportTestingResults(assignment, records) : undefined; },
    };
}
