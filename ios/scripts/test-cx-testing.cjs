const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const moduleBox = { exports: {} };
const { outputFiles: [bundle] } = buildSync({
    entryPoints: [path.join(__dirname, "../../config/cx-testing.ts")],
    bundle: true, format: "cjs", write: false,
});
vm.runInNewContext(bundle.text, { module: moduleBox });
const { getTestingAssignment, testingStorageKey, useTestingReview } = moduleBox.exports;
const expected = [
    ["1429837711602094201", "windows", 238],
    ["463515440606609419", "windows", 237],
    ["1569533258461614171", "ios", 238],
    ["1539587971840483359", "android", 237],
    ["1205417504718192680", "ios", 237],
    ["801526290623627315", "ios", 37],
];
for (const [userId, platform, count] of expected) {
    assert.equal(getTestingAssignment(userId, platform).entries.length, count);
    assert.equal(getTestingAssignment(userId, platform === "ios" ? "android" : "ios"), undefined);
}
assert.equal(getTestingAssignment("999999999999999999", "windows"), undefined);
assert.equal(getTestingAssignment(undefined, "ios"), undefined);
const assignment = getTestingAssignment("801526290623627315", "ios");
assert(assignment.entries.every(entry => entry.group === "Shared declarative CX"));
assert.notEqual(testingStorageKey(assignment), testingStorageKey(getTestingAssignment("1569533258461614171", "ios")));

let position = 0;
const slots = [];
const react = {
    useState(init) {
        const i = position++;
        if (!Object.hasOwn(slots, i)) slots[i] = init;
        return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
    },
    useRef(init) {
        const i = position++;
        return slots[i] ??= { current: init };
    },
    useEffect(effect) {
        const i = position++;
        if (!slots[i]) slots[i] = effect();
    },
};
let stored = {}, allowed = true;
const storage = { read: () => stored, write: value => { stored = value; } };
const render = () => {
    position = 0;
    return useTestingReview(react, assignment, storage, { cloudcord: "test", discord: "352017" }, () => allowed);
};

(async () => {
    render();
    await new Promise(setImmediate);
    let review = render();
    assert.equal(review.ready, true);
    await review.save("Fail");
    assert.equal(render().message, "Enter the exact error or blocker.");
    assert.equal(Object.keys(stored).length, 0);
    const current = review.entry.id;
    render().setError("=TypeError\nsecond line");
    await render().save("Fail");
    assert.equal(stored[current].status, "Fail");
    assert.equal(stored[current].error, "=TypeError\nsecond line");
    assert.match(render().export(), /"'=TypeError\nsecond line"/);
    render().move(1);
    await render().save("Pass");
    assert.equal(render().completed, 2);
    render().move(1);
    allowed = false;
    await render().save("Pass");
    assert.equal(render().export(), undefined);
    assert.equal(Object.keys(stored).length, 2);
    console.log("PASS tester access, assigned platforms, results, and CSV export");
})().catch(error => { console.error(error); process.exitCode = 1; });
