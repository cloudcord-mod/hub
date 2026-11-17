import { useTestingReview } from "./index";

/** Web renderer shared by the Windows desktop builds. */
export function TestingPluginsWeb({ react, assignment, storage, build, authorized, copy, openCxPort = undefined }) {
    const review = useTestingReview(react, assignment, storage, build, authorized);
    const [exportMessage, setExportMessage] = react.useState("");
    const input = {
        width: "100%", padding: "8px 10px", boxSizing: "border-box", borderRadius: 6,
        background: "var(--background-secondary)", color: "var(--text-normal)",
        border: "1px solid var(--background-modifier-accent)",
    };
    const button = (label, action, disabled = false, accent) => (
        <button type="button" disabled={disabled} onClick={action} style={{
            padding: "8px 14px", borderRadius: 6, fontWeight: 600,
            cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
            background: accent ?? "var(--background-secondary)", color: accent ? "#fff" : "var(--text-normal)",
        }}>{label}</button>
    );
    async function copyResults() {
        const text = review.export();
        if (!text) return;
        try { await copy(text); setExportMessage("Results copied as CSV."); }
        catch { setExportMessage("Could not copy results."); }
    }
    const disabled = !review.ready || review.saving;
    return (
        <section style={{ display: "grid", gap: 14, maxWidth: 680, margin: "0 auto", color: "var(--text-normal)" }}>
            <h2>Testing Plugins</h2>
            <p>{assignment.label} · {review.completed} of {assignment.entries.length} reviewed</p>
            <label>Search assigned plugins
                <input style={input} type="search" value={review.search} onChange={event => review.searchFor(event.target.value)} />
            </label>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
                <label>CloudCord build
                    <input style={input} maxLength={100} value={review.build.cloudcord} onChange={event => review.setBuild("cloudcord", event.target.value)} />
                </label>
                <label>Discord build
                    <input style={input} maxLength={100} value={review.build.discord} onChange={event => review.setBuild("discord", event.target.value)} />
                </label>
            </div>
            {review.entry ? (
                <div style={{ display: "grid", gap: 12, padding: 16, borderRadius: 10, background: "var(--background-secondary-alt, var(--background-tertiary))" }}>
                    <div>
                        <h3>{review.entry.name}</h3>
                        <p>{review.entry.id} · {review.entry.group}</p>
                        <p>{review.review?.status ?? "Pending"} · {review.index + 1} of {review.count}</p>
                    </div>
                    {review.entry.catalogName && openCxPort && <div>
                        {button("Review " + review.entry.catalogName, () => {
                            if (authorized()) openCxPort(review.entry.catalogName);
                        }, disabled)}
                    </div>}
                    <label>Exact error or blocker
                        <textarea rows={3} style={input} maxLength={3000} value={review.error} onChange={event => review.setError(event.target.value)} />
                    </label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {button("Approve", () => void review.save("Pass"), disabled, "#28764a")}
                        {button("Disapprove", () => void review.save("Fail"), disabled, "#aa3d44")}
                        {button("Blocked", () => void review.save("Blocked"), disabled)}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        {button("Previous", () => review.move(-1), review.saving || review.index === 0)}
                        {button("Next", () => review.move(1), review.saving || review.index + 1 >= review.count)}
                    </div>
                </div>
            ) : <p>No assigned plugins match your search.</p>}
            <div>{button("Copy results as CSV", () => void copyResults(), !review.completed || review.saving)}</div>
            <div role="status">{review.message || (!review.ready ? "Loading results…" : "")} {exportMessage}</div>
        </section>
    );
}
