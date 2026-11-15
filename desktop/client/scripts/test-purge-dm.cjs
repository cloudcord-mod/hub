const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const esbuild = require('esbuild');
const context = { module: { exports: {} }, setTimeout, Promise, Symbol, Math, Number, Set, Array };
vm.runInNewContext(esbuild.transformSync(fs.readFileSync('src/utils/purgeDm.ts', 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2020' }).code, context);
const { purgeOwnMessages } = context.module.exports;

const ME = '1', THEM = '2', CH = '900';
// 230 messages, newest first; every third is mine, a few of mine are system messages.
const history = Array.from({ length: 230 }, (_, i) => ({ id: String(10000 - i), author: { id: i % 3 === 0 ? ME : THEM }, type: i === 30 ? 7 : i === 60 ? 3 : 0 }));
const gets = [], deletes = [], sleeps = [];
let limited = false;
const rest = {
    get: async ({ url, query }) => {
        assert.equal(url, `/channels/${CH}/messages`);
        gets.push(query.before ?? null);
        const start = query.before ? history.findIndex(m => m.id === query.before) + 1 : 0;
        return { body: history.slice(start, start + query.limit) };
    },
    del: async ({ url }) => {
        const id = url.split('/').pop();
        if (id === '9997' && !limited) { limited = true; throw { status: 429, body: { retry_after: 2 } }; }
        if (id === '9994') throw { status: 403, body: { code: 50013 } };
        deletes.push(id);
    },
};
(async () => {
    const progress = [];
    const result = await purgeOwnMessages({ rest, channelId: CH, authorId: ME, pace: 10, sleep: async ms => { sleeps.push(ms); }, onProgress: (d, f) => progress.push([d, f]) });
    assert.deepEqual(gets, [null, '9901', '9801'], 'pages with before = oldest id of the previous page, stops on a short page');
    const mine = history.filter((m, i) => i % 3 === 0 && m.type === 0).map(m => m.id);
    assert.equal(result.found, mine.length, 'only my normal messages, system messages skipped');
    assert.ok(deletes.every(id => history.find(m => m.id === id).author.id === ME), 'never deletes the other person\'s messages');
    assert.deepEqual(deletes, mine.filter(id => id !== '9994'), 'newest to oldest, 429 retried, 403 skipped');
    assert.equal(result.deleted, mine.length - 1); assert.equal(result.skipped, 1);
    assert.ok(sleeps.includes(2000), 'waits retry_after on 429');
    assert.ok(sleeps.filter(ms => ms !== 2000).every(ms => ms >= 10 && ms <= 15), 'pace with up to 50% jitter');
    assert.deepEqual(progress[progress.length - 1], [result.deleted, result.found]);

    const signal = { cancelled: false };
    let count = 0;
    const cancelled = await purgeOwnMessages({ rest: { ...rest, del: async () => { if (++count === 3) signal.cancelled = true; } }, channelId: CH, authorId: ME, signal, pace: 0 });
    assert.equal(cancelled.cancelled, true); assert.equal(cancelled.deleted, 3, 'stops right after cancel');
    console.log('PASS purge DM: paging, own-message filter, system messages, rate limits, skips, pacing and cancel');
})().catch(error => { console.error(error); process.exitCode = 1; });
