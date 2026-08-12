import { app } from "../../scripts/app.js";

const NODE_TYPE = "JindouyunNumberSlider";
const DEFAULT_COLOR = "#FF6A00";
const DEFAULT_STEP = 0.05;
const HIDDEN_WIDGETS = ["滑块名称", "当前值", "最小值", "最大值", "步进值", "滑块颜色"];

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function finiteNumber(value, fallback) {
    if (value == null || (typeof value === "string" && value.trim() === "")) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function decimalPlaces(value) {
    const text = String(value ?? "").toLowerCase();
    if (text.includes("e-")) return Math.max(0, Number(text.split("e-")[1]) || 0);
    return Math.max(0, (text.split(".")[1] || "").length);
}

function normalizeSliderConfig(value, minimum, maximum, step) {
    let low = finiteNumber(minimum, 0);
    let high = finiteNumber(maximum, 1);
    if (high < low) [low, high] = [high, low];
    let stepValue = Math.abs(finiteNumber(step, 0.05));
    if (!stepValue) stepValue = 0.05;
    const current = Math.max(low, Math.min(high, finiteNumber(value, low)));
    const count = Math.round((current - low) / stepValue);
    const places = Math.min(12, Math.max(
        decimalPlaces(low),
        decimalPlaces(high),
        decimalPlaces(stepValue),
    ));
    const snapped = Math.max(low, Math.min(high, low + count * stepValue));
    const clean = Number(snapped.toFixed(places));
    return {value: clean, minimum: low, maximum: high, step: stepValue};
}

function normalizeHexColor(value) {
    const match = String(value || "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return DEFAULT_COLOR;
    let digits = match[1].toUpperCase();
    if (digits.length === 3) digits = [...digits].map((character) => character.repeat(2)).join("");
    return `#${digits}`;
}

function setWidgetValue(widget, value, node) {
    if (!widget) return;
    widget.value = value;
    widget.callback?.(value, app.canvas, node, widget);
    app.graph?.setDirtyCanvas?.(true, true);
}

function hideNativeWidgets(node) {
    for (const name of HIDDEN_WIDGETS) {
        const widget = findWidget(node, name);
        if (!widget || widget.__jindouyunNumberSliderHidden) continue;
        widget.__jindouyunNumberSliderHidden = true;
        widget.hidden = true;
        widget.draw = function() {};
        widget.mouse = function() { return false; };
        widget.computeSize = function() { return [0, 0]; };
    }
}

function makeNumberInput(title) {
    const input = document.createElement("input");
    input.type = "number";
    input.title = title;
    Object.assign(input.style, {
        width: "100%",
        minWidth: "0",
        height: "28px",
        boxSizing: "border-box",
        border: "1px solid #525A66",
        borderRadius: "4px",
        background: "#181C22",
        color: "#FFFFFF",
        padding: "0 7px",
        fontSize: "12px",
        textAlign: "center",
    });
    return input;
}

function makeField(labelText, input) {
    const shell = document.createElement("label");
    Object.assign(shell.style, {
        display: "grid",
        gridTemplateRows: "15px 28px",
        gap: "2px",
        minWidth: "0",
    });
    const label = document.createElement("span");
    label.textContent = labelText;
    Object.assign(label.style, {fontSize: "11px", color: "#AEB6C2", textAlign: "center"});
    shell.append(label, input);
    return shell;
}

function installCallback(widget, callback) {
    if (!widget || widget.__jindouyunNumberSliderCallback) return;
    widget.__jindouyunNumberSliderCallback = true;
    const original = widget.callback;
    widget.callback = function() {
        const result = original?.apply(this, arguments);
        callback();
        return result;
    };
}

function addNumberSlider(node) {
    if (node.__jindouyunNumberSliderAdded || !node.addDOMWidget) return;
    node.__jindouyunNumberSliderAdded = true;
    hideNativeWidgets(node);

    const nameWidget = findWidget(node, "滑块名称");
    const valueWidget = findWidget(node, "当前值");
    const minimumWidget = findWidget(node, "最小值");
    const maximumWidget = findWidget(node, "最大值");
    const stepWidget = findWidget(node, "步进值");
    const colorWidget = findWidget(node, "滑块颜色");

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
        display: "flex",
        flexDirection: "column",
        gap: "7px",
        width: "100%",
        height: "216px",
        padding: "7px 8px",
        boxSizing: "border-box",
        overflow: "hidden",
        "--jindouyun-slider-color": DEFAULT_COLOR,
    });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "滑块名称";
    Object.assign(nameInput.style, {
        width: "100%",
        height: "30px",
        boxSizing: "border-box",
        border: "1px solid #525A66",
        borderRadius: "4px",
        background: "#181C22",
        color: "#FFFFFF",
        padding: "0 9px",
        fontSize: "13px",
        fontWeight: "600",
        textAlign: "center",
    });

    const valueRow = document.createElement("div");
    Object.assign(valueRow.style, {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 76px",
        gap: "8px",
        alignItems: "center",
        height: "34px",
    });
    const slider = document.createElement("input");
    slider.type = "range";
    slider.title = "按设置的步进值拖动";
    Object.assign(slider.style, {
        width: "100%",
        height: "24px",
        margin: "0",
        cursor: "pointer",
        accentColor: "var(--jindouyun-slider-color)",
    });
    const currentInput = makeNumberInput("当前输出值");
    Object.assign(currentInput.style, {height: "32px", fontSize: "14px", fontWeight: "700"});
    valueRow.append(slider, currentInput);

    const rangeRow = document.createElement("div");
    Object.assign(rangeRow.style, {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: "6px",
    });
    const minimumInput = makeNumberInput("滑块最小值");
    const maximumInput = makeNumberInput("滑块最大值");
    const stepInput = makeNumberInput("拖动时每一步的数值");
    rangeRow.append(
        makeField("最小值", minimumInput),
        makeField("最大值", maximumInput),
        makeField("步进", stepInput),
    );

    const colorRow = document.createElement("div");
    Object.assign(colorRow.style, {
        display: "grid",
        gridTemplateColumns: "54px 42px minmax(0, 1fr)",
        gap: "7px",
        alignItems: "center",
        height: "34px",
    });
    const colorLabel = document.createElement("span");
    colorLabel.textContent = "滑块颜色";
    Object.assign(colorLabel.style, {fontSize: "11px", color: "#AEB6C2", textAlign: "center"});
    const colorPicker = document.createElement("input");
    colorPicker.type = "color";
    colorPicker.title = "打开色盘选择滑块颜色";
    Object.assign(colorPicker.style, {
        width: "42px",
        height: "30px",
        padding: "2px",
        border: "1px solid #59616D",
        borderRadius: "50%",
        background: "#20252C",
        cursor: "pointer",
    });
    const colorText = document.createElement("input");
    colorText.type = "text";
    colorText.maxLength = 7;
    Object.assign(colorText.style, {
        width: "100%",
        height: "30px",
        minWidth: "0",
        boxSizing: "border-box",
        border: "1px solid #525A66",
        borderRadius: "4px",
        background: "#181C22",
        color: "#FFFFFF",
        padding: "0 8px",
        fontSize: "12px",
        textAlign: "center",
    });
    colorRow.append(colorLabel, colorPicker, colorText);
    wrapper.append(nameInput, valueRow, rangeRow, colorRow);

    let syncing = false;

    function render({writeWidgets = false} = {}) {
        if (syncing) return;
        syncing = true;
        const config = normalizeSliderConfig(
            valueWidget?.value,
            minimumWidget?.value,
            maximumWidget?.value,
            stepWidget?.value,
        );
        const color = normalizeHexColor(colorWidget?.value);
        nameInput.value = String(nameWidget?.value ?? "数值滑块");
        slider.min = String(config.minimum);
        slider.max = String(config.maximum);
        slider.step = String(config.step);
        slider.value = String(config.value);
        currentInput.min = String(config.minimum);
        currentInput.max = String(config.maximum);
        currentInput.step = String(config.step);
        currentInput.value = String(config.value);
        minimumInput.value = String(config.minimum);
        maximumInput.value = String(config.maximum);
        stepInput.value = String(config.step);
        colorPicker.value = color;
        colorText.value = color;
        wrapper.style.setProperty("--jindouyun-slider-color", color);
        if (writeWidgets) {
            setWidgetValue(valueWidget, config.value, node);
            setWidgetValue(minimumWidget, config.minimum, node);
            setWidgetValue(maximumWidget, config.maximum, node);
            setWidgetValue(stepWidget, config.step, node);
            setWidgetValue(colorWidget, color, node);
        }
        syncing = false;
        app.graph?.setDirtyCanvas?.(true, true);
    }

    function setCurrent(value) {
        const config = normalizeSliderConfig(
            value,
            minimumWidget?.value,
            maximumWidget?.value,
            stepWidget?.value,
        );
        setWidgetValue(valueWidget, config.value, node);
        render();
    }

    function setColor(value) {
        setWidgetValue(colorWidget, normalizeHexColor(value), node);
        render();
    }

    nameInput.addEventListener("input", () => setWidgetValue(nameWidget, nameInput.value, node));
    slider.addEventListener("input", () => setCurrent(slider.value));
    currentInput.addEventListener("input", () => {
        if (currentInput.value.trim() !== "") setCurrent(currentInput.value);
    });
    currentInput.addEventListener("change", () => render({writeWidgets: true}));
    for (const [input, widget] of [
        [minimumInput, minimumWidget],
        [maximumInput, maximumWidget],
        [stepInput, stepWidget],
    ]) {
        input.addEventListener("change", () => {
            if (input.value.trim() !== "") setWidgetValue(widget, Number(input.value), node);
            render({writeWidgets: true});
        });
    }
    colorPicker.addEventListener("input", () => setColor(colorPicker.value));
    colorText.addEventListener("change", () => setColor(colorText.value));

    for (const widget of [nameWidget, valueWidget, minimumWidget, maximumWidget, stepWidget, colorWidget]) {
        installCallback(widget, render);
    }

    const domWidget = node.addDOMWidget("数值滑块", "jindouyun_number_slider", wrapper, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 216,
        getMaxHeight: () => 216,
    });
    domWidget.computeSize = () => [Math.max(252, Number(node.size?.[0] || 280) - 28), 216];
    render({writeWidgets: true});
    node.setSize?.([Math.max(node.size?.[0] || 280, 280), Math.max(node.size?.[1] || 80, 282)]);
}

app.registerExtension({
    name: "comfyui-jindouyun-design.number-slider",

    nodeCreated(node) {
        if ((node.comfyClass || node.type) === NODE_TYPE) addNumberSlider(node);
    },

    loadedGraphNode(node) {
        if ((node.comfyClass || node.type) === NODE_TYPE) addNumberSlider(node);
    },

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function() {
            originalOnAdded?.apply(this, arguments);
            addNumberSlider(this);
        };
    },
});
