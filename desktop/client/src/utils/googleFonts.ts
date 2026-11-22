import catalog from "../../../../ios/runtime/src/lib/addons/fonts/googleFonts.json";

export const googleFonts = Object.entries(catalog);
const preference = "cloudcord.googleFont";
const faces = new Map<string, Promise<void>>();
let selectionRevision = 0;

export function getGoogleFont() {
    try { return localStorage.getItem(preference) ?? ""; }
    catch { return ""; }
}

export function loadGoogleFont(name: string, url: string) {
    const existing = faces.get(name);
    if (existing) return existing;
    const promise = new FontFace(name, `url("${url}")`).load().then(face => {
        document.fonts.add(face);
    }).catch(error => {
        faces.delete(name);
        throw error;
    });
    faces.set(name, promise);
    return promise;
}

export async function applyGoogleFont(name: string, persist = true) {
    const revision = ++selectionRevision;
    const url = Object.hasOwn(catalog, name) ? (catalog as Record<string, string>)[name] : undefined;
    if (url) await loadGoogleFont(name, url);
    if (revision !== selectionRevision) return;
    const style = document.documentElement.style;
    for (const property of ["--font-primary", "--font-display", "--font-headline"]) {
        if (url) style.setProperty(property, `${JSON.stringify(name)}, "gg sans", sans-serif`, "important");
        else style.removeProperty(property);
    }
    if (persist) {
        if (url) localStorage.setItem(preference, name);
        else localStorage.removeItem(preference);
    }
}
