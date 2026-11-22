import { Button } from "@components/Button";
import { applyGoogleFont, getGoogleFont, googleFonts, loadGoogleFont } from "@utils/googleFonts";
import { React } from "@webpack/common";

const pageSize = 20;

export default function FontsPage() {
    const [query, setQuery] = React.useState("");
    const [page, setPage] = React.useState(0);
    const [selected, setSelected] = React.useState(getGoogleFont);
    const [samples, setSamples] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const results = React.useMemo(() => {
        const term = query.trim().toLowerCase();
        return googleFonts.filter(([name]) => name.toLowerCase().includes(term));
    }, [query]);
    const visible = React.useMemo(() => results.slice(page * pageSize, (page + 1) * pageSize), [results, page]);

    React.useEffect(() => {
        if (!samples) return;
        for (const [name, url] of visible) void loadGoogleFont(name, url).catch(() => {});
    }, [samples, visible]);

    async function choose(name: string) {
        setBusy(true);
        setError("");
        try {
            await applyGoogleFont(name);
            setSelected(getGoogleFont());
        } catch {
            setError("Couldn't load the font. Try again.");
        } finally {
            setBusy(false);
        }
    }

    return <div style={{ display: "grid", gap: 12 }}>
        <label>Search {googleFonts.length} Google Fonts <input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
        <label><input type="checkbox" checked={samples} onChange={event => setSamples(event.target.checked)} /> Show names in their own font</label>
        {selected && <div>{selected} <Button size="small" disabled={busy} onClick={() => choose("")}>Reset to Discord font</Button></div>}
        {error && <div role="alert">{error}</div>}
        {visible.map(([name]) => <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={samples ? { fontFamily: `${JSON.stringify(name)}, sans-serif` } : undefined}>{name}</span>
            <Button size="small" disabled={busy || selected === name} onClick={() => choose(name)}>{selected === name ? "In use" : "Use font"}</Button>
        </div>)}
        {results.length === 0 && <p>No fonts match your search.</p>}
        {results.length > pageSize && <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>{page + 1} / {Math.ceil(results.length / pageSize)}</span>
            <Button size="small" disabled={(page + 1) * pageSize >= results.length} onClick={() => setPage(page + 1)}>Next</Button>
        </div>}
    </div>;
}
