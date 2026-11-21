import { localStorage } from "@utils/localStorage";
import { isProfileViewUserId, normalizeProfileViewUsers } from "@utils/profileAppearance";

const KEY = "CloudCord_realProfileUsersByAccount";
const LEGACY_KEY = "CloudCord_realProfileUsers";
const accounts = new Map<string, Set<string>>();
let legacy: string[] = [];

function read(key: string): unknown {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch { return null; }
}

const stored = read(KEY);
if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [id, choices] of Object.entries(stored)) {
        if (isProfileViewUserId(id)) accounts.set(id, new Set(normalizeProfileViewUsers(choices)));
    }
} else legacy = normalizeProfileViewUsers(read(LEGACY_KEY));

function save() {
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...accounts].map(([id, choices]) => [id, [...choices]])))); }
    catch { /* Session preferences also work when local storage is unavailable. */ }
}

function choicesFor(viewerId: string) {
    if (legacy.length) {
        accounts.set(viewerId, new Set(legacy.filter(id => id !== viewerId)));
        legacy = [];
        save();
    }
    return accounts.get(viewerId);
}

export function isRealProfileView(userId: string, viewerId: string | null | undefined): boolean {
    return isProfileViewUserId(viewerId) && viewerId !== userId && choicesFor(viewerId)?.has(userId) === true;
}

export function setRealProfileView(userId: string, enabled: boolean, viewerId: string | null | undefined) {
    if (!isProfileViewUserId(userId) || !isProfileViewUserId(viewerId) || userId === viewerId) return;
    const users = choicesFor(viewerId) ?? new Set<string>();
    if (enabled) users.add(userId); else users.delete(userId);
    if (users.size) accounts.set(viewerId, users); else accounts.delete(viewerId);
    save();
}
