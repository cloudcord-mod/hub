/* SPDX-License-Identifier: GPL-3.0-or-later */

import { isCxProfileUserId } from "./cxProfileMenu";

export type CxVoiceShareOptions = { camera: boolean; includeSelf: boolean; cooldownSeconds: number; };
type Media = "stream" | "camera";
type VoiceState = { userId?: unknown; channelId?: unknown; selfStream?: unknown; selfVideo?: unknown; };
type Payload = { voiceStates?: readonly VoiceState[]; streamKey?: string; };
type Event = "VOICE_STATE_UPDATES" | "VOICE_CHANNEL_SELECT" | "STREAM_CREATE" | "STREAM_DELETE" | "LOGOUT";
type Context = {
    account(): string | undefined;
    channel(): string | undefined;
    states(channel: string): unknown;
    notify(user: string, kind: Media): void;
    enabled?(): boolean;
    dispatcher: {
        subscribe(event: Event, handler: (payload: Payload) => void): void;
        unsubscribe(event: Event, handler: (payload: Payload) => void): void;
    };
};

export function bindCxVoiceShareAlerts(context: Context, options: CxVoiceShareOptions) {
    const users = new Map<string, { stream?: boolean; camera?: boolean; alerted?: Partial<Record<Media, number>>; }>();
    const cleanups: (() => void)[] = [];
    let account: string | undefined, channel: string | undefined;
    let active = true;

    function reset() {
        account = channel = undefined;
        users.clear();
    }
    function record(user: string, kind: Media, status: boolean, announce: boolean) {
        let state = users.get(user);
        if (!state) {
            if (users.size === 512) users.delete(users.keys().next().value!);
            users.set(user, state = {});
        }
        const wasOn = state[kind];
        state[kind] = status;
        if (!announce || !status || wasOn === true) return;
        const now = Date.now(), last = state.alerted?.[kind];
        if (last !== undefined && now - last < options.cooldownSeconds * 1000) return;
        (state.alerted ??= {})[kind] = now;
        try { context.notify(user, kind); } catch { /* Local notifications are optional. */ }
    }
    function updateState(state: VoiceState, announce: boolean) {
        if (!isCxProfileUserId(state?.userId) || !options.includeSelf && state.userId === account) return;
        if (state.channelId !== channel) {
            if (state.channelId !== undefined) users.delete(state.userId);
            return;
        }
        if (typeof state.selfStream === "boolean") record(state.userId, "stream", state.selfStream, announce);
        if (options.camera && typeof state.selfVideo === "boolean") record(state.userId, "camera", state.selfVideo, announce);
    }
    function sync() {
        const me = context.account(), current = context.channel();
        if (!active || context.enabled?.() === false || !isCxProfileUserId(me) || !isCxProfileUserId(current)) {
            reset();
            return false;
        }
        if (account === me && channel === current) return true;
        reset();
        account = me;
        channel = current;
        const initial = context.states(current);
        if (initial && typeof initial === "object") {
            for (const state of Object.values(initial)) updateState(state, false);
        }
        return false;
    }
    function update(payload: Payload) {
        const unchanged = sync();
        if (!channel || !Array.isArray(payload?.voiceStates)) return;
        for (const state of payload.voiceStates) updateState(state, unchanged);
    }
    function stream(payload: Payload, status: boolean) {
        if (!sync() || typeof payload?.streamKey !== "string" || payload.streamKey.length > 80) return;
        const parsed = /^(?:guild:\d{15,22}:|call:)(\d{15,22}):(\d{15,22})$/.exec(payload.streamKey);
        if (!parsed || parsed[1] !== channel || !options.includeSelf && parsed[2] === account) return;
        record(parsed[2], "stream", status, true);
    }
    function stop() {
        active = false;
        reset();
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    }
    try {
        for (const [event, handler] of [
            ["VOICE_STATE_UPDATES", update], ["VOICE_CHANNEL_SELECT", sync], ["LOGOUT", reset],
            ["STREAM_CREATE", payload => stream(payload, true)], ["STREAM_DELETE", payload => stream(payload, false)],
        ] satisfies [Event, (payload: Payload) => void][]) {
            context.dispatcher.subscribe(event, handler);
            cleanups.push(() => context.dispatcher.unsubscribe(event, handler));
        }
        sync();
        return stop;
    } catch (error) { stop(); throw error; }
}
