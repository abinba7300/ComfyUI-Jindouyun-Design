function clampUnit(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return 0;
    }
    return Math.max(0, Math.min(1, number));
}

function byteToHex(value) {
    return Math.round(value * 255).toString(16).padStart(2, "0").toUpperCase();
}

export function hueSliderColorAt(position) {
    const hue = clampUnit(position) * 6;
    const section = Math.floor(hue) % 6;
    const fraction = hue - Math.floor(hue);
    const rising = fraction;
    const falling = 1 - fraction;
    const colors = [
        [1, rising, 0],
        [falling, 1, 0],
        [0, 1, rising],
        [0, falling, 1],
        [rising, 0, 1],
        [1, 0, falling],
    ];
    const [red, green, blue] = colors[section];
    return `#${byteToHex(red)}${byteToHex(green)}${byteToHex(blue)}`;
}

export function hueSliderPositionForColor(color, fallback = 0.5) {
    const match = String(color || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) {
        return clampUnit(fallback);
    }
    const value = Number.parseInt(match[1], 16);
    const red = ((value >> 16) & 0xff) / 255;
    const green = ((value >> 8) & 0xff) / 255;
    const blue = (value & 0xff) / 255;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const range = maximum - minimum;
    if (range <= 1e-9) {
        return clampUnit(fallback);
    }
    let hue;
    if (maximum === red) {
        hue = ((green - blue) / range) % 6;
    } else if (maximum === green) {
        hue = (blue - red) / range + 2;
    } else {
        hue = (red - green) / range + 4;
    }
    return ((hue * 60 + 360) % 360) / 360;
}
