function candidateLines(value) {
    return String(value || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
}

export function normalizeDroppedFilePath(value) {
    const text = String(value || "").trim().replace(/^"|"$/g, "");
    if (!text) return "";

    if (/^file:\/\//i.test(text)) {
        try {
            const url = new URL(text);
            if (url.protocol !== "file:") return "";
            let pathname = decodeURIComponent(url.pathname || "");
            if (url.hostname && url.hostname.toLowerCase() !== "localhost") {
                return `\\\\${url.hostname}${pathname.replaceAll("/", "\\")}`;
            }
            if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
            const windowsPath = pathname.replaceAll("/", "\\");
            return /^[A-Za-z]:\\/.test(windowsPath) ? windowsPath : "";
        } catch (_) {
            return "";
        }
    }

    if (/^[A-Za-z]:[\\/]/.test(text)) return text.replaceAll("/", "\\");
    if (/^\\\\[^\\]+\\[^\\]+/.test(text)) return text;
    return "";
}

export function droppedSourcePath(event, file) {
    for (const directValue of [file?.path, file?.mozFullPath, file?.webkitRelativePath]) {
        const directPath = normalizeDroppedFilePath(directValue);
        if (directPath) return directPath;
    }

    const transfer = event?.dataTransfer;
    if (typeof transfer?.getData !== "function") return "";
    for (const type of ["text/uri-list", "text/x-moz-url", "text/plain"]) {
        let value = "";
        try {
            value = transfer.getData(type);
        } catch (_) {
            continue;
        }
        for (const line of candidateLines(value)) {
            const path = normalizeDroppedFilePath(line);
            if (path) return path;
        }
    }
    return "";
}
