export function featuredPreviewRects(x, y, width, height, count, gap = 6) {
    const safeCount = Math.max(0, Math.min(4, Math.floor(Number(count) || 0)));
    const safeWidth = Math.max(0, Number(width) || 0);
    const safeHeight = Math.max(0, Number(height) || 0);
    if (!safeCount || !safeWidth || !safeHeight) return [];
    if (safeCount === 1) return [{x, y, width: safeWidth, height: safeHeight, featured: true}];

    const safeGap = Math.max(0, Number(gap) || 0);
    const sideWidth = Math.min(Math.max(76, safeWidth * 0.28), safeWidth * 0.38);
    const mainWidth = Math.max(1, safeWidth - sideWidth - safeGap);
    const thumbHeight = Math.max(1, (safeHeight - safeGap * 2) / 3);
    const rects = [{x, y, width: mainWidth, height: safeHeight, featured: true}];
    for (let index = 1; index < safeCount; index += 1) {
        rects.push({
            x: x + mainWidth + safeGap,
            y: y + (index - 1) * (thumbHeight + safeGap),
            width: sideWidth,
            height: thumbHeight,
            featured: false,
        });
    }
    return rects;
}

export function containImageRect(imageWidth, imageHeight, rect, padding = 4) {
    const innerWidth = Math.max(1, rect.width - padding * 2);
    const innerHeight = Math.max(1, rect.height - padding * 2);
    const width = Math.max(1, Number(imageWidth) || 1);
    const height = Math.max(1, Number(imageHeight) || 1);
    const scale = Math.min(innerWidth / width, innerHeight / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    return {
        x: rect.x + (rect.width - drawWidth) / 2,
        y: rect.y + (rect.height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
    };
}

export function pointInRect(x, y, rect) {
    if (!rect) return false;
    return x >= rect.x
        && x <= rect.x + rect.width
        && y >= rect.y
        && y <= rect.y + rect.height;
}

export function interpolateRect(from, to, progress) {
    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    const eased = t * t * (3 - 2 * t);
    return {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        width: from.width + (to.width - from.width) * eased,
        height: from.height + (to.height - from.height) * eased,
    };
}
