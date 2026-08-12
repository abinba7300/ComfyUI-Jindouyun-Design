import os
import random
import secrets
import sys
from decimal import Decimal
from pathlib import Path
from typing import Iterable, List, Optional, Sequence


SUPPORTED_LORA_EXTENSIONS = {".safetensors", ".ckpt", ".pt", ".pth"}


def extract_trigger_word(lora_name: str) -> str:
    stem = Path(str(lora_name)).stem.strip()
    if not stem:
        return ""

    hyphen_at = stem.find("-")
    if hyphen_at > 0:
        return stem[:hyphen_at].strip()

    underscore_at = stem.find("_")
    if underscore_at > 0:
        return stem[:underscore_at].strip()

    return stem


def scan_lora_files(folder: Path, recursive: bool = False, filename_filter: str = "") -> List[Path]:
    root = Path(folder).expanduser()
    if not root.exists():
        raise FileNotFoundError(f"LoRA folder does not exist: {root}")
    if not root.is_dir():
        raise NotADirectoryError(f"LoRA folder is not a directory: {root}")

    pattern = "**/*" if recursive else "*"
    filter_text = str(filename_filter or "").strip().casefold()
    files = []
    for path in root.glob(pattern):
        if not path.is_file():
            continue
        if path.suffix.casefold() not in SUPPORTED_LORA_EXTENSIONS:
            continue
        try:
            if path.stat().st_size <= 0:
                continue
        except OSError:
            continue
        if filter_text and filter_text not in path.name.casefold():
            continue
        files.append(path)

    return sorted(files, key=lambda item: str(item).casefold())


def select_lora(loras: Sequence[Path], seed: int) -> Path:
    if not loras:
        raise ValueError("No LoRA files available to select.")
    return random.Random(int(seed)).choice(list(loras))


def resolve_effective_seed(seed: int) -> int:
    if int(seed) == 0:
        return secrets.randbelow(0xFFFFFFFFFFFFFFFF) + 1
    return int(seed)


def trigger_for_lora(lora_path: Path) -> str:
    return extract_trigger_word(Path(lora_path).name)


def lora_output_name(lora_path: Path) -> str:
    return Path(lora_path).stem


def random_range_value(
    min_value: float,
    max_value: float,
    seed: int,
    salt: str,
    step: Optional[float] = None,
) -> float:
    low = float(min_value)
    high = float(max_value)
    if high < low:
        low, high = high, low
    if low == high:
        return low

    rng = random.Random(f"{int(seed)}:{salt}")
    if step is None:
        value = rng.uniform(low, high)
        return round(value, 2)

    step_decimal = abs(Decimal(str(step)))
    if step_decimal == 0:
        step_decimal = Decimal("0.01")
    low_decimal = Decimal(str(low))
    high_decimal = Decimal(str(high))
    step_count = int((high_decimal - low_decimal) // step_decimal)
    value = low_decimal + step_decimal * rng.randrange(step_count + 1)
    return round(float(value), 2)


def format_decimal_value(value: float) -> str:
    return f"{float(value):.2f}"


def build_lora_summary(lora_name: str, lora_strength: float, repaint_value: float) -> str:
    return f"{lora_name}_{format_decimal_value(lora_strength)}_{format_decimal_value(repaint_value)}"


def validate_lora_file(lora_path: Path) -> None:
    path = Path(lora_path)
    if not path.exists():
        raise FileNotFoundError(f"LoRA file does not exist: {path}")
    if not path.is_file():
        raise ValueError(f"LoRA path is not a file: {path}")
    if path.stat().st_size <= 0:
        raise ValueError(
            f"LoRA file is empty (0 bytes): {path}. Please delete it or download it again."
        )


def _is_valid_nunchaku_support_module(module) -> bool:
    if module is None:
        return False
    wrapper_type = getattr(module, "ComfyFluxWrapper", None)
    return (
        isinstance(wrapper_type, type)
        and callable(getattr(module, "copy_with_ctx", None))
        and callable(getattr(module, "to_diffusers", None))
    )


def _get_nunchaku_flux_lora_support():
    try:
        import nodes

        loader_class = nodes.NODE_CLASS_MAPPINGS.get("NunchakuFluxLoraLoader")
        if loader_class is not None:
            module = sys.modules.get(getattr(loader_class, "__module__", ""))
            if _is_valid_nunchaku_support_module(module):
                return module
    except Exception:
        pass

    for module in list(sys.modules.values()):
        if _is_valid_nunchaku_support_module(module):
            return module

    raise ImportError("Nunchaku FLUX LoRA support is not loaded. Please install and enable ComfyUI-nunchaku.")


def apply_nunchaku_flux_lora(model, lora_path: Path, lora_strength: float):
    if abs(float(lora_strength)) < 1e-5:
        return model

    support = _get_nunchaku_flux_lora_support()
    model_wrapper = model.model.diffusion_model
    if not isinstance(model_wrapper, support.ComfyFluxWrapper):
        raise TypeError("Nunchaku LoRA requires a model loaded by Nunchaku FLUX DiT Loader.")

    lora_path_text = os.path.abspath(str(lora_path))
    ret_model_wrapper, ret_model = support.copy_with_ctx(model_wrapper)
    ret_model_wrapper.loras = [*model_wrapper.loras, (lora_path_text, float(lora_strength))]

    sd = support.to_diffusers(lora_path_text)
    if "transformer.x_embedder.lora_A.weight" in sd:
        new_in_channels = sd["transformer.x_embedder.lora_A.weight"].shape[1]
        if new_in_channels % 4 != 0:
            raise ValueError("Invalid Nunchaku FLUX LoRA input channel shape.")
        new_in_channels = new_in_channels // 4

        old_in_channels = ret_model.model.model_config.unet_config["in_channels"]
        if old_in_channels < new_in_channels:
            ret_model.model.model_config.unet_config["in_channels"] = new_in_channels

    return ret_model


def get_comfy_lora_list() -> List[str]:
    try:
        import folder_paths

        return ["无"] + folder_paths.get_filename_list("loras")
    except Exception:
        return ["无"]


def _first_existing(paths: Iterable[Path]) -> Optional[Path]:
    for path in paths:
        if path.exists():
            return path
    return None


class Krea2RandomLoraModelOnly:
    def __init__(self):
        self.loaded_lora = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模型": ("MODEL",),
                "启用": ("BOOLEAN", {"default": True}),
                "随机": ("BOOLEAN", {"default": True, "tooltip": "开启后从目录里按种子随机选择 LoRA。关闭后使用固定字段。"}),
                "LoRA目录": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "placeholder": "留空 = ComfyUI/models/loras，也可点击输入框选择文件夹",
                        "tooltip": "LoRA 所在文件夹。可填绝对路径，也可填 models/loras 下面的子文件夹。",
                    },
                ),
                "固定": (
                    get_comfy_lora_list(),
                    {"tooltip": "关闭随机时从 ComfyUI 默认 models/loras 列表中选择 LoRA。"},
                ),
                "LoRA值最小": (
                    "FLOAT",
                    {
                        "default": 0.6,
                        "min": -100.0,
                        "max": 100.0,
                        "step": 0.01,
                        "tooltip": "LoRA 模型强度随机范围下限。和 LoRA值最大 相同就是固定值。",
                    },
                ),
                "LoRA值最大": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": -100.0,
                        "max": 100.0,
                        "step": 0.01,
                        "tooltip": "LoRA 模型强度随机范围上限。和 LoRA值最小 相同就是固定值。",
                    },
                ),
                "重绘值最小": (
                    "FLOAT",
                    {
                        "default": 0.5,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "重绘值随机范围下限。和 重绘值最大 相同就是固定值。",
                    },
                ),
                "重绘值最大": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "重绘值随机范围上限。可把输出接到采样器 denoise/重绘幅度。",
                    },
                ),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "control_after_generate": True,
                        "tooltip": "LoRA 随机选择使用的种子。使用随机按钮时会像采样器一样更新这个数字。",
                    },
                ),
                "子目录": ("BOOLEAN", {"default": False, "tooltip": "开启后也会扫描目录下面的子文件夹。"}),
                "过滤": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "placeholder": "留空不过滤；填 K2T 只随机文件名里含 K2T 的 LoRA",
                        "tooltip": "只在文件名包含这些文字的 LoRA 里随机；留空表示不过滤。",
                    },
                ),
                "LoRA值步进": (
                    "FLOAT",
                    {
                        "default": 0.05,
                        "min": 0.01,
                        "max": 100.0,
                        "step": 0.01,
                        "tooltip": "LoRA 强度只会按此间隔随机。推荐：0.01 细腻变化；0.05 平衡自然；0.10 差异明显。",
                    },
                ),
                "重绘值步进": (
                    "FLOAT",
                    {
                        "default": 0.05,
                        "min": 0.01,
                        "max": 1.0,
                        "step": 0.01,
                        "tooltip": "重绘值只会按此间隔随机。推荐：0.01 细腻变化；0.05 平衡自然；0.10 差异明显。",
                    },
                ),
            }
        }

    RETURN_TYPES = ("MODEL", "STRING", "STRING", "INT", "FLOAT", "FLOAT", "STRING")
    RETURN_NAMES = ("模型", "触发词", "LoRA", "本次种子", "LoRA强度", "重绘值", "组合名")
    OUTPUT_TOOLTIPS = (
        "已经应用所选 LoRA 的模型。",
        "与所选 LoRA 对应的触发词。",
        "当前选中的 LoRA 文件名。",
        "本次实际用于随机选择 LoRA 的种子。输入种子为 0 时，这里会显示自动生成的真实种子。",
        "本次实际应用到模型上的 LoRA 强度。",
        "本次随机得到的重绘值，可接到采样器 denoise/重绘幅度输入。",
        "LoRA名_LoRA值_重绘值，适合保存文件名或记录。",
    )
    FUNCTION = "load_lora"
    CATEGORY = "Krea2"
    DESCRIPTION = "随机或固定 LoRA 加载器，只加载到模型，并输出对应触发词。"
    SEARCH_ALIASES = ["筋斗云随机LORA", "Krea2 随机 LoRA", "随机 LoRA 仅模型", "Krea2 LoRA"]

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        seed = kwargs.get("seed", kwargs.get("固定种子", kwargs.get("种子", 0)))
        if kwargs.get("启用") and kwargs.get("随机") and int(seed) == 0:
            return float("NaN")
        return (
            kwargs.get("启用"),
            kwargs.get("随机"),
            kwargs.get("LoRA目录", kwargs.get("目录")),
            kwargs.get("固定"),
            kwargs.get("LoRA值最小", kwargs.get("L最小", kwargs.get("强度"))),
            kwargs.get("LoRA值最大", kwargs.get("L最大", kwargs.get("强度"))),
            kwargs.get("LoRA值步进", 0.05),
            kwargs.get("重绘值最小", kwargs.get("采最小")),
            kwargs.get("重绘值最大", kwargs.get("采最大")),
            kwargs.get("重绘值步进", 0.05),
            seed,
            kwargs.get("子目录"),
            kwargs.get("过滤"),
        )

    def load_lora(self, **kwargs):
        model = kwargs["模型"]
        enabled = kwargs["启用"]
        random_mode = kwargs["随机"]
        lora_folder = kwargs.get("LoRA目录", kwargs.get("目录", ""))
        fixed_lora_name = kwargs["固定"]
        lora_min = kwargs.get("LoRA值最小", kwargs.get("L最小", kwargs.get("强度", 0.6)))
        lora_max = kwargs.get("LoRA值最大", kwargs.get("L最大", kwargs.get("强度", 1.0)))
        lora_step = kwargs.get("LoRA值步进", 0.05)
        repaint_min = kwargs.get("重绘值最小", kwargs.get("采最小", 0.5))
        repaint_max = kwargs.get("重绘值最大", kwargs.get("采最大", 1.0))
        repaint_step = kwargs.get("重绘值步进", 0.05)
        seed = kwargs.get("seed", kwargs.get("固定种子", kwargs.get("种子", 0)))
        recursive = kwargs["子目录"]
        filename_filter = kwargs["过滤"]

        if not enabled:
            return (model, "", "", int(seed), 0.0, 0.0, "")

        folder = self._resolve_lora_folder(lora_folder)
        effective_seed = resolve_effective_seed(seed) if random_mode else int(seed)
        lora_strength = random_range_value(
            lora_min,
            lora_max,
            effective_seed,
            "lora_strength",
            step=lora_step,
        )
        repaint_value = random_range_value(
            repaint_min,
            repaint_max,
            effective_seed,
            "repaint_value",
            step=repaint_step,
        )
        selected_path = self._choose_lora_path(
            folder=folder,
            random_mode=random_mode,
            fixed_lora_name=fixed_lora_name,
            recursive=recursive,
            filename_filter=filename_filter,
            seed=effective_seed,
        )
        if selected_path is None:
            return (model, "", "", effective_seed, lora_strength, repaint_value, "")

        validate_lora_file(selected_path)
        model_lora = self._apply_model_lora(model, selected_path, lora_strength)
        trigger_word = trigger_for_lora(selected_path)
        lora_name = lora_output_name(selected_path)
        summary = build_lora_summary(lora_name, lora_strength, repaint_value)

        return (model_lora, trigger_word, lora_name, effective_seed, lora_strength, repaint_value, summary)

    def _resolve_lora_folder(self, lora_folder: str) -> Path:
        folder_text = str(lora_folder or "").strip().strip('"')

        if folder_text:
            candidate = Path(folder_text).expanduser()
            if candidate.is_absolute():
                return candidate

        try:
            import folder_paths

            lora_roots = [Path(path) for path in folder_paths.get_folder_paths("loras")]
        except Exception:
            lora_roots = []

        if not folder_text:
            if lora_roots:
                return lora_roots[0]
            return Path("models") / "loras"

        candidates = [root / folder_text for root in lora_roots]
        candidates.append(Path(folder_text).expanduser())
        existing = _first_existing(candidates)
        return existing or candidates[0]

    def _choose_lora_path(
        self,
        folder: Path,
        random_mode: bool,
        fixed_lora_name: str,
        recursive: bool,
        filename_filter: str,
        seed: int,
    ) -> Optional[Path]:
        if random_mode:
            loras = scan_lora_files(folder, recursive=recursive, filename_filter=filename_filter)
            if not loras:
                raise FileNotFoundError(f"No LoRA files found in: {folder}")
            return select_lora(loras, seed)

        fixed_name = str(fixed_lora_name or "").strip().strip('"')
        if not fixed_name or fixed_name.casefold() in {"none", "无"}:
            return None

        fixed_path = Path(fixed_name).expanduser()
        if fixed_path.is_absolute():
            return fixed_path

        try:
            import folder_paths

            return Path(folder_paths.get_full_path_or_raise("loras", fixed_name))
        except Exception:
            pass

        candidates = [
            folder / fixed_name,
            folder / fixed_path.name,
            Path(fixed_name).expanduser(),
        ]
        existing = _first_existing(candidates)
        if existing is not None:
            return existing

        raise FileNotFoundError(f"Fixed LoRA file was not found: {fixed_name}")

    def _apply_model_lora(self, model, lora_path: Path, strength_model: float):
        import comfy.sd
        import comfy.utils

        lora_key = os.path.abspath(str(lora_path))
        lora = None
        lora_metadata = None
        if self.loaded_lora is not None and self.loaded_lora[0] == lora_key:
            lora = self.loaded_lora[1]
            lora_metadata = self.loaded_lora[2]

        if lora is None:
            try:
                lora, lora_metadata = comfy.utils.load_torch_file(
                    lora_key,
                    safe_load=True,
                    return_metadata=True,
                )
            except TypeError:
                lora = comfy.utils.load_torch_file(lora_key, safe_load=True)
                lora_metadata = None
            self.loaded_lora = (lora_key, lora, lora_metadata)

        try:
            return comfy.sd.load_lora_for_models(
                model,
                None,
                lora,
                strength_model,
                0,
                lora_metadata=lora_metadata,
            )[0]
        except TypeError:
            return comfy.sd.load_lora_for_models(model, None, lora, strength_model, 0)[0]


class NunchakuRandomLoraModelOnly(Krea2RandomLoraModelOnly):
    CATEGORY = "Nunchaku"
    DESCRIPTION = "Nunchaku FLUX 随机或固定 LoRA 加载器，只加载到模型，并输出对应触发词。"
    SEARCH_ALIASES = ["Nunchaku 随机 LoRA", "Nunchaku FLUX LoRA", "随机 LoRA Nunchaku"]
    OUTPUT_TOOLTIPS = (
        "已经应用所选 Nunchaku FLUX LoRA 的模型。",
        "与所选 LoRA 对应的触发词。",
        "当前选中的 LoRA 文件名。",
        "本次实际用于随机选择 LoRA 的种子。输入种子为 0 时，这里会显示自动生成的真实种子。",
        "本次实际应用到模型上的 LoRA 强度。",
        "本次随机得到的重绘值，可接到采样器 denoise/重绘幅度输入。",
        "LoRA名_LoRA值_重绘值，适合保存文件名或记录。",
    )

    def _apply_model_lora(self, model, lora_path: Path, strength_model: float):
        return apply_nunchaku_flux_lora(model, lora_path, strength_model)
