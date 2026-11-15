/*
 * CloudCord Purge DMs
 * Copyright (c) 2026 xohus and CloudCord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Deletes the current user's own messages in one DM, newest to oldest, one at a time.
// Kept free of Discord imports so the paging and filtering can be tested on their own.

export interface PurgeRest {
    get(request: { url: string; query?: Record<string, any>; }): Promise<{ body: any; }>;
    del(request: { url: string; }): Promise<unknown>;
}
export interface PurgeSignal { cancelled: boolean; }
export interface PurgeOptions {
    rest: PurgeRest;
    channelId: string;
    authorId: string;
    signal?: PurgeSignal;
    /** Base gap between deletes in ms; a random 0–50% is added. */
    pace?: number;
    sleep?: (ms: number) => Promise<void>;
    onProgress?: (deleted: number, found: number) => void;
}
export interface PurgeResult { deleted: number; found: number; skipped: number; cancelled: boolean; }

// Normal messages, replies and app command messages; everything else is a system message.
const DELETABLE_TYPES = new Set([0, 19, 20, 23]);

export function isOwnDeletable(message: any, authorId: string) {
    return !!message && message.author?.id === authorId && DELETABLE_TYPES.has(Number(message.type ?? 0));
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function retryAfterMs(error: any) {
    const seconds = Number(error?.body?.retry_after ?? error?.retry_after ?? error?.headers?.["retry-after"]);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 5000;
}

/** Walks history with `before` paging and yields the user's own deletable messages, newest first. */
export async function* ownMessages(rest: PurgeRest, channelId: string, authorId: string, signal?: PurgeSignal, sleep = wait) {
    let before: string | undefined;
    while (!signal?.cancelled) {
        let page: any[];
        try {
            const response = await rest.get({ url: `/channels/${channelId}/messages`, query: { limit: 100, ...(before ? { before } : {}) } });
            page = Array.isArray(response?.body) ? response.body : [];
        } catch (error: any) {
            if (error?.status === 429) { await sleep(retryAfterMs(error)); continue; }
            throw error;
        }
        if (!page.length) return;
        for (const message of page) if (isOwnDeletable(message, authorId)) yield message;
        before = page[page.length - 1].id;
        if (page.length < 100) return;
    }
}

export async function purgeOwnMessages({ rest, channelId, authorId, signal, pace = 1000, sleep = wait, onProgress }: PurgeOptions): Promise<PurgeResult> {
    const result: PurgeResult = { deleted: 0, found: 0, skipped: 0, cancelled: false };
    for await (const message of ownMessages(rest, channelId, authorId, signal, sleep)) {
        if (signal?.cancelled) break;
        result.found++;
        onProgress?.(result.deleted, result.found);
        for (let attempt = 0; ; attempt++) {
            if (signal?.cancelled) break;
            try {
                await rest.del({ url: `/channels/${channelId}/messages/${message.id}` });
                result.deleted++;
                break;
            } catch (error: any) {
                if (error?.status === 429 && attempt < 5) { await sleep(retryAfterMs(error) * (attempt + 1)); continue; }
                result.skipped++; // already gone, too old for the API, or not allowed
                break;
            }
        }
        onProgress?.(result.deleted, result.found);
        if (pace > 0) await sleep(pace + Math.random() * pace * 0.5);
    }
    result.cancelled = !!signal?.cancelled;
    return result;
}
