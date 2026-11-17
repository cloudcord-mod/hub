import { createFileBackend } from "@core/vendetta/storage";
import { testingStorageKey, useTestingReview, type TestingAssignment } from "@lib/api/cxTesting";
import { cxCatalog } from "@lib/api/cxCatalog";
import { writeFile } from "@lib/api/native/fs";
import { NativeClientInfoModule } from "@lib/api/native/modules";
import { currentTestingAssignment, useMobileTestingAssignment } from "@lib/api/pluginTesting";
import { wrapOnPress } from "@lib/ui/settings/patches/shared";
import { NavigationNative, React } from "@metro/common";
import { Button, Stack, Text, TextInput } from "@metro/common/components";
import { version } from "bunny-build-info";
import { ScrollView, View } from "react-native";

function TestingReview({ assignment }: { assignment: TestingAssignment; }) {
    const backend = React.useMemo(() => createFileBackend(testingStorageKey(assignment) + ".json"), [assignment.userId, assignment.platform]);
    const storage = { read: backend.get, write: backend.set };
    const authorized = () => currentTestingAssignment()?.userId === assignment.userId;
    let discord = "";
    try {
        const info = NativeClientInfoModule.getConstants();
        if (info.Version && info.Build) discord = String(info.Version) + " (" + String(info.Build) + ")";
        else if (info.Version || info.Build) discord = String(info.Version ?? info.Build);
    } catch {}
    const revision = (globalThis as any).__CLOUDCORD_RUNTIME_REVISION__;
    const cloudcord = typeof revision === "string" && revision ? version + " " + revision : version;
    const review = useTestingReview(React, assignment, storage, { cloudcord, discord }, authorized);
    const [exportMessage, setExportMessage] = React.useState("");
    const navigation = NavigationNative.useNavigation();
    const catalogName = review.entry?.catalogName;
    const portSource = catalogName && cxCatalog.plugins.find(entry => entry.name === catalogName)?.source;
    const openCxPort = React.useMemo(() => catalogName && portSource
        ? wrapOnPress(undefined, navigation, async () => require("@core/ui/settings/pages/CxExtensions"), catalogName, { initialSource: portSource }, "push")
        : undefined, [catalogName, navigation, portSource]);

    async function saveResults() {
        const text = review.export();
        if (!text) return;
        const filename = "cx-testing-" + assignment.platform + "-" + assignment.userId + ".csv";
        try {
            await writeFile(filename, text, { prefix: "" });
            setExportMessage("Saved " + filename + " in the app folder.");
        } catch {
            setExportMessage("Could not save the CSV.");
        }
    }

    const disabled = !review.ready || review.saving;
    const field = (label: string, value: string, onChange: (value: string) => void, maxLength: number) => (
        <Stack spacing={5}>
            <Text variant="text-sm/medium">{label}</Text>
            <TextInput size="lg" value={value} maxLength={maxLength} onChange={(input: any) => onChange(typeof input === "string" ? input : input?.nativeEvent?.text ?? "")} />
        </Stack>
    );
    return (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <Stack spacing={14}>
                <Text variant="text-md/medium">{assignment.label} · {review.completed} of {assignment.entries.length} reviewed</Text>
                {field("Search assigned plugins", review.search, review.searchFor, 120)}
                {field("CloudCord build", review.build.cloudcord, value => review.setBuild("cloudcord", value), 100)}
                {field("Discord build", review.build.discord, value => review.setBuild("discord", value), 100)}
                {review.entry ? (
                    <Stack spacing={10}>
                        <Text variant="heading-lg/semibold">{review.entry.name}</Text>
                        <Text variant="text-sm/normal">{review.entry.id} · {review.entry.group}</Text>
                        <Text variant="text-sm/medium">{review.review?.status ?? "Pending"} · {review.index + 1} of {review.count}</Text>
                        {openCxPort && <Button size="md" variant="secondary" text={"Review " + catalogName}
                            disabled={disabled} onPress={() => { if (authorized()) void openCxPort(); }} />}
                        {field("Exact error or blocker", review.error, review.setError, 3000)}
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                            <Button size="md" variant="primary" text="Approve" disabled={disabled} onPress={() => void review.save("Pass")} />
                            <Button size="md" variant="destructive" text="Disapprove" disabled={disabled} onPress={() => void review.save("Fail")} />
                            <Button size="md" variant="secondary" text="Blocked" disabled={disabled} onPress={() => void review.save("Blocked")} />
                        </View>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                            <Button size="md" variant="secondary" text="Previous" disabled={review.saving || review.index === 0} onPress={() => review.move(-1)} />
                            <Button size="md" variant="secondary" text="Next" disabled={review.saving || review.index + 1 >= review.count} onPress={() => review.move(1)} />
                        </View>
                    </Stack>
                ) : <Text variant="text-sm/normal">No assigned plugins match your search.</Text>}
                <Button size="md" variant="secondary" text="Save results as CSV" disabled={!review.completed || review.saving} onPress={() => void saveResults()} />
                {!!(review.message || !review.ready) && <Text variant="text-sm/medium">{review.message || "Loading results…"}</Text>}
                {!!exportMessage && <Text variant="text-sm/medium">{exportMessage}</Text>}
            </Stack>
        </ScrollView>
    );
}

export default function TestingPlugins() {
    const assignment = useMobileTestingAssignment();
    return assignment ? <TestingReview key={assignment.userId} assignment={assignment} /> : null;
}
