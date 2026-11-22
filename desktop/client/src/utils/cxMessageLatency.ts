/*
 * MessageLatency by arHSM
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

type FillValue = ("status-danger" | "status-warning" | "status-positive" | "text-muted");
export type CxLatencyFill = [FillValue, FillValue, FillValue];
type DiffKey = keyof Diff;

interface Diff {
    days: number,
    hours: number,
    minutes: number,
    seconds: number;
    milliseconds: number;
}

const DISCORD_KT_DELAY = 1471228928;

function stringDelta(delta: number, showMillis: boolean) {
    const diff: Diff = {
        days: Math.floor(delta / (60 * 60 * 24 * 1000)),
        hours: Math.floor((delta / (60 * 60 * 1000)) % 24),
        minutes: Math.floor((delta / (60 * 1000)) % 60),
        seconds: Math.floor(delta / 1000 % 60),
        milliseconds: Math.floor(delta % 1000)
    };

    const str = (k: DiffKey) => diff[k] > 0 ? `${diff[k]} ${diff[k] > 1 ? k : k.substring(0, k.length - 1)}` : null;
    const keys = Object.keys(diff) as DiffKey[];

    const ts = keys.reduce((prev, k) => {
        const s = str(k);

        return prev + (
            s != null
                ? (prev !== ""
                    ? (showMillis ? k === "milliseconds" : k === "seconds")
                        ? " and "
                        : " "
                    : "") + s
                : ""
        );
    }, "");

    return ts || "0 seconds";
}

export type CxMessageLatencyOptions = { latency: number; detectDiscordKotlin: boolean; showMillis: boolean; ignoreSelf: boolean; };

function snowflakeTime(value: unknown) {
    if (typeof value !== "string" || !/^[1-9]\d{16,19}$/.test(value)) return;
    const number = BigInt(value);
    if (number <= 0xffffffffffffffffn) return Number(number >> 22n);
}

export function getCxMessageLatency(message: {
    id?: unknown; nonce?: unknown; author?: { id?: unknown; bot?: boolean; };
}, options: CxMessageLatencyOptions, account?: string) {
    const { latency, detectDiscordKotlin, showMillis, ignoreSelf } = options;
    const { id, nonce, author } = message;
    if (!author || author.bot || ignoreSelf && account !== undefined && author.id === account) return null;
    const sent = snowflakeTime(id), started = snowflakeTime(nonce);
    if (sent === undefined || started === undefined) return null;

    let isDiscordKotlin = false;
    let delta = sent - started;
    if (!Number.isFinite(delta)) return null;
    if (!showMillis) {
        delta = Math.round(delta / 1000) * 1000;
    }

    // Old Discord Android clients have a delay of around 17 days
    // This is a workaround for that
    if (-delta >= DISCORD_KT_DELAY - 86400000) {
        // One day of padding for good measure
        isDiscordKotlin = detectDiscordKotlin;
        delta += DISCORD_KT_DELAY;
    }

    // Thanks dziurwa (I hate you)
    // This is when the user's clock is ahead
    // Can't do anything if the clock is behind
    const abs = Math.abs(delta);
    const ahead = abs !== delta;
    const latencyMillis = latency * 1000;

    const displayDelay = abs >= latencyMillis ? stringDelta(abs, showMillis) : null;

    // Also thanks dziurwa
    // 2 minutes
    const TROLL_LIMIT = 2 * 60 * 1000;

    const fill: CxLatencyFill = isDiscordKotlin
        ? ["status-positive", "status-positive", "text-muted"]
        : delta >= TROLL_LIMIT || ahead
            ? ["text-muted", "text-muted", "text-muted"]
            : delta >= (latencyMillis * 2)
                ? ["status-danger", "text-muted", "text-muted"]
                : ["status-warning", "status-warning", "text-muted"];

    return (abs >= latencyMillis || isDiscordKotlin) ? { delta: displayDelay, ahead, fill, isDiscordKotlin } : null;
}
