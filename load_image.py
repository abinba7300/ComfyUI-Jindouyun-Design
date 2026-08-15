import re
import hashlib
import shutil
from pathlib import Path

import folder_paths
from nodes import LoadImage


_NATURAL_PARTS = re.compile(r"(\d+)")
_LOCAL_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}


def _natural_key(value):
    return [int(part) if part.isdigit() else part.casefold() for part in _NATURAL_PARTS.split(str(value))]


def _annotated_root(image_name):
    relative_name, annotated_root = folder_paths.annotated_filepath(str(image_name or "").strip())
    if annotated_root is not None:
        root = Path(annotated_root).resolve()
        annotation = (
            " [output]" if root == Path(folder_paths.get_output_directory()).resolve()
            else " [temp]" if root == Path(folder_paths.get_temp_directory()).resolve()
            else " [input]"
        )
        return relative_name.strip(), root, annotation
    return relative_name.strip(), Path(folder_paths.get_input_directory()).resolve(), ""


def _inside_root(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def list_sibling_images(image_name):
    relative_name, root, annotation = _annotated_root(image_name)
    if not relative_name:
        return {"images": [], "index": -1}

    current_path = (root / relative_name).resolve()
    if not _inside_root(current_path, root):
        raise ValueError("图片路径超出了 ComfyUI 允许访问的目录")

    directory = current_path.parent
    if not directory.is_dir() or not _inside_root(directory, root):
        return {"images": [], "index": -1}

    names = [entry.name for entry in directory.iterdir() if entry.is_file()]
    names = folder_paths.filter_files_content_types(names, ["image"])
    names.sort(key=_natural_key)

    images = []
    for name in names:
        relative = (directory / name).relative_to(root).as_posix()
        images.append(f"{relative}{annotation}")

    current_value = f"{current_path.relative_to(root).as_posix()}{annotation}"
    try:
        index = images.index(current_value)
    except ValueError:
        index = -1
    return {"images": images, "index": index}


def _local_siblings(source_path):
    path = Path(str(source_path or "").strip().strip('"')).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"图片不存在: {path}")
    images = [
        item for item in path.parent.iterdir()
        if item.is_file() and item.suffix.lower() in _LOCAL_IMAGE_EXTENSIONS
    ]
    images.sort(key=lambda item: _natural_key(item.name))
    try:
        index = images.index(path)
    except ValueError:
        index = -1
    return path, images, index


def prepare_local_image(source_path):
    path, images, index = _local_siblings(source_path)
    cache_root = Path(folder_paths.get_input_directory()).resolve() / "jindouyun_local_images"
    cache_root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(str(path).casefold().encode("utf-8")).hexdigest()[:16]
    safe_stem = re.sub(r"[^0-9A-Za-z._-]+", "_", path.stem).strip("._") or "image"
    target = cache_root / f"{safe_stem}_{digest}{path.suffix.lower()}"
    shutil.copy2(path, target)
    return {
        "image": target.relative_to(Path(folder_paths.get_input_directory()).resolve()).as_posix(),
        "source_path": str(path),
        "folder_path": str(path.parent),
        "image_name": path.stem,
        "index": index,
        "total": len(images),
    }


def _file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.digest()


def resolve_dropped_source(image_name, file_name="", file_size=0, candidate_paths=()):
    uploaded = Path(folder_paths.get_annotated_filepath(image_name)).resolve()
    if not uploaded.is_file():
        raise ValueError(f"找不到拖入后上传的图片：{image_name}")

    expected_name = Path(str(file_name or uploaded.name)).name.casefold()
    try:
        expected_size = max(0, int(file_size or 0))
    except (TypeError, ValueError):
        expected_size = 0

    uploaded_digest = None
    matches = []
    seen = set()
    for value in candidate_paths or ():
        text = str(value or "").strip().strip('"')
        if not text:
            continue
        try:
            candidate = Path(text).expanduser().resolve()
        except OSError:
            continue
        key = str(candidate).casefold()
        if key in seen or candidate == uploaded:
            continue
        seen.add(key)
        try:
            if not candidate.is_file() or candidate.name.casefold() != expected_name:
                continue
            if expected_size and candidate.stat().st_size != expected_size:
                continue
            if uploaded_digest is None:
                uploaded_digest = _file_digest(uploaded)
            if _file_digest(candidate) != uploaded_digest:
                continue
        except OSError:
            continue
        matches.append(candidate)

    if len(matches) != 1:
        return {
            "resolved": False,
            "source_path": "",
            "folder_path": "",
            "image_name": Path(str(file_name or uploaded.name)).stem,
            "match_count": len(matches),
        }

    source = matches[0]
    return {
        "resolved": True,
        "source_path": str(source),
        "folder_path": str(source.parent),
        "image_name": source.stem,
        "match_count": 1,
    }


def navigate_local_image(source_path, direction):
    _, images, index = _local_siblings(source_path)
    if not images or index < 0:
        raise ValueError("当前图片所在文件夹中没有可切换的图片")
    requested_direction = int(direction)
    step = 0 if requested_direction == 0 else (1 if requested_direction > 0 else -1)
    next_index = (index + step) % len(images)
    return prepare_local_image(images[next_index])


class JindouyunLoadImage(LoadImage):
    @classmethod
    def INPUT_TYPES(cls):
        schema = super().INPUT_TYPES()
        required = dict(schema.get("required", {}))
        required["原始图片路径"] = ("STRING", {"default": ""})
        return {**schema, "required": required}

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "STRING")
    RETURN_NAMES = ("图像", "遮罩", "文件夹路径", "图像名称")
    FUNCTION = "load_image"
    CATEGORY = "筋斗云设计/图像"
    DESCRIPTION = "加载图片，并在节点内快速切换当前图片同目录下的上一张或下一张。"
    SEARCH_ALIASES = ["筋斗云加载图像", "加载图片", "上一张", "下一张", "image browser"]

    @classmethod
    def IS_CHANGED(cls, image, 原始图片路径=""):
        source = Path(str(原始图片路径 or "").strip().strip('"')).expanduser()
        if source.is_file():
            stat = source.stat()
            return f"{source.resolve()}:{stat.st_mtime_ns}:{stat.st_size}"
        return super().IS_CHANGED(image)

    @classmethod
    def VALIDATE_INPUTS(cls, image, 原始图片路径=""):
        source = str(原始图片路径 or "").strip().strip('"')
        if source and not Path(source).expanduser().is_file():
            return f"原始图片不存在: {source}"
        return super().VALIDATE_INPUTS(image)

    def load_image(self, image, 原始图片路径=""):
        loaded_image, loaded_mask = super().load_image(image)
        source_path = Path(str(原始图片路径 or "").strip().strip('"')).expanduser()
        image_path = (
            source_path.resolve()
            if source_path.is_file()
            else Path(folder_paths.get_annotated_filepath(image)).resolve()
        )
        return loaded_image, loaded_mask, str(image_path.parent), image_path.stem
