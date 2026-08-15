import json
import os
import re
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from aiohttp import web


BACKUP_DIRECTORY = ".jindouyun-workflow-backups"
MAX_BACKUPS = 20
WORKFLOW_DIRECTORY = "workflows"
BACKUP_ID_PATTERN = re.compile(
    r"\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d{6}(?:_\d+)?\.json"
)


def _json_response_error(message: str, status: int = 400):
    return web.json_response({"ok": False, "error": message}, status=status)


def _normalize_workflow_path(value: object) -> str:
    path = str(value or "").strip().replace("\\", "/").lstrip("/")
    if not path:
        raise ValueError("没有可备份的工作流路径")
    if path.startswith(f"{WORKFLOW_DIRECTORY}/"):
        path = path[len(WORKFLOW_DIRECTORY) + 1 :]
    if not path.lower().endswith((".json", ".app.json")):
        raise ValueError("工作流必须是 JSON 文件")
    parts = [part for part in path.split("/") if part]
    if not parts or any(part in (".", "..") for part in parts):
        raise ValueError("工作流路径无效")
    return "/".join(parts)


def _safe_backup_key(workflow_path: str) -> str:
    readable = re.sub(r"[^0-9A-Za-z._\-\u4e00-\u9fff]+", "_", workflow_path)
    readable = readable.strip("._") or "workflow"
    digest = __import__("hashlib").sha256(workflow_path.encode("utf-8")).hexdigest()[:12]
    return f"{readable[:90]}__{digest}"


def _backup_root(user_root: Path, workflow_path: str) -> Path:
    return user_root / BACKUP_DIRECTORY / _safe_backup_key(workflow_path)


def _workflow_file(user_root: Path, workflow_path: str) -> Path:
    root = (user_root / WORKFLOW_DIRECTORY).resolve()
    target = (root / Path(workflow_path)).resolve()
    if os.path.commonpath((str(root), str(target))) != str(root):
        raise ValueError("工作流路径超出了用户目录")
    return target


def _backup_files(root: Path):
    if not root.exists():
        return []
    return sorted(
        (
            path
            for path in root.glob("*.json")
            if path.is_file() and not path.name.endswith(".meta.json")
        ),
        key=lambda path: path.name,
        reverse=True,
    )


def _normalize_metadata_text(value: object, field: str, maximum: int) -> str:
    text = str(value or "").strip()
    if len(text) > maximum:
        raise ValueError(f"{field}不能超过 {maximum} 个字符")
    return text


def _validate_backup_id(value: object) -> str:
    backup_id = str(value or "")
    if not BACKUP_ID_PATTERN.fullmatch(backup_id):
        raise ValueError("历史版本编号无效")
    return backup_id


def _write_metadata(path: Path, metadata: dict):
    metadata_path = path.with_suffix(".meta.json")
    fd, temp_name = tempfile.mkstemp(prefix=".metadata-", suffix=".tmp", dir=path.parent)
    os.close(fd)
    try:
        Path(temp_name).write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(temp_name, metadata_path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def _create_backup(
    user_root: Path,
    workflow_path: str,
    reason: str = "save",
    name: object = "",
    note: object = "",
):
    normalized_name = _normalize_metadata_text(name, "版本名称", 80)
    normalized_note = _normalize_metadata_text(note, "版本备注", 1000)
    source = _workflow_file(user_root, workflow_path)
    if not source.is_file():
        return None

    root = _backup_root(user_root, workflow_path)
    root.mkdir(parents=True, exist_ok=True)
    now = datetime.now().astimezone()
    timestamp = now.strftime("%Y-%m-%d_%H-%M-%S_%f")
    destination = root / f"{timestamp}.json"
    collision = 1
    while destination.exists():
        destination = root / f"{timestamp}_{collision}.json"
        collision += 1

    fd, temp_name = tempfile.mkstemp(prefix=".backup-", suffix=".tmp", dir=root)
    os.close(fd)
    try:
        shutil.copy2(source, temp_name)
        os.replace(temp_name, destination)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)

    metadata = {
        "workflow_path": workflow_path,
        "created_at": now.isoformat(timespec="milliseconds"),
        "reason": str(reason or "save"),
        "name": normalized_name,
        "note": normalized_note,
    }
    _write_metadata(destination, metadata)

    for stale in _backup_files(root)[MAX_BACKUPS:]:
        stale.unlink(missing_ok=True)
        stale.with_suffix(".meta.json").unlink(missing_ok=True)
    return destination


def _read_metadata(path: Path):
    metadata_path = path.with_suffix(".meta.json")
    if metadata_path.is_file():
        try:
            data = json.loads(metadata_path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except (OSError, json.JSONDecodeError):
            pass
    modified = datetime.fromtimestamp(path.stat().st_mtime).astimezone()
    return {
        "created_at": modified.isoformat(timespec="milliseconds"),
        "reason": "save",
        "name": "",
        "note": "",
    }


def _update_backup_metadata(
    user_root: Path,
    workflow_path: str,
    backup_id: object,
    name: object,
    note: object,
):
    backup_id = _validate_backup_id(backup_id)
    root = _backup_root(user_root, workflow_path).resolve()
    target = (root / backup_id).resolve()
    if os.path.commonpath((str(root), str(target))) != str(root):
        raise ValueError("历史版本路径无效")
    if not target.is_file():
        raise FileNotFoundError("找不到这个历史版本")
    metadata = _read_metadata(target)
    metadata.update(
        {
            "workflow_path": workflow_path,
            "name": _normalize_metadata_text(name, "版本名称", 80),
            "note": _normalize_metadata_text(note, "版本备注", 1000),
        }
    )
    _write_metadata(target, metadata)
    return metadata


def _delete_backup(user_root: Path, workflow_path: str, backup_id: object):
    backup_id = _validate_backup_id(backup_id)
    root = _backup_root(user_root, workflow_path).resolve()
    target = (root / backup_id).resolve()
    if os.path.commonpath((str(root), str(target))) != str(root):
        raise ValueError("历史版本路径无效")
    if not target.is_file():
        raise FileNotFoundError("找不到这个历史版本")
    target.unlink()
    target.with_suffix(".meta.json").unlink(missing_ok=True)


def _get_user_root(prompt_server, request) -> Path:
    user_root = prompt_server.user_manager.get_request_user_filepath(
        request, None, create_dir=True
    )
    if not user_root:
        raise PermissionError("无法访问当前 ComfyUI 用户目录")
    return Path(user_root).resolve()


def register_workflow_backup_routes(prompt_server):
    routes = prompt_server.routes

    @routes.post("/jindouyun_design/workflow_backups/create")
    async def create_workflow_backup(request):
        try:
            data = await request.json()
            workflow_path = _normalize_workflow_path(data.get("workflow_path"))
            user_root = _get_user_root(prompt_server, request)
            created = _create_backup(
                user_root,
                workflow_path,
                data.get("reason", "save"),
                data.get("name", ""),
                data.get("note", ""),
            )
            return web.json_response(
                {
                    "ok": True,
                    "created": created is not None,
                    "backup_id": created.name if created else None,
                    "limit": MAX_BACKUPS,
                }
            )
        except (ValueError, PermissionError) as error:
            return _json_response_error(str(error))
        except Exception as error:
            return _json_response_error(f"创建工作流备份失败：{error}", status=500)

    @routes.get("/jindouyun_design/workflow_backups")
    async def list_workflow_backups(request):
        try:
            workflow_path = _normalize_workflow_path(
                request.rel_url.query.get("workflow_path")
            )
            user_root = _get_user_root(prompt_server, request)
            root = _backup_root(user_root, workflow_path)
            backups = []
            for path in _backup_files(root):
                metadata = _read_metadata(path)
                backups.append(
                    {
                        "id": path.name,
                        "created_at": metadata.get("created_at"),
                        "reason": metadata.get("reason", "save"),
                        "name": metadata.get("name", ""),
                        "note": metadata.get("note", ""),
                        "size": path.stat().st_size,
                    }
                )
            return web.json_response(
                {
                    "ok": True,
                    "workflow_path": workflow_path,
                    "limit": MAX_BACKUPS,
                    "backups": backups,
                }
            )
        except (ValueError, PermissionError) as error:
            return _json_response_error(str(error))
        except Exception as error:
            return _json_response_error(f"读取工作流历史失败：{error}", status=500)

    @routes.get("/jindouyun_design/workflow_backups/content")
    async def get_workflow_backup(request):
        try:
            workflow_path = _normalize_workflow_path(
                request.rel_url.query.get("workflow_path")
            )
            backup_id = _validate_backup_id(request.rel_url.query.get("backup_id"))
            user_root = _get_user_root(prompt_server, request)
            root = _backup_root(user_root, workflow_path).resolve()
            target = (root / backup_id).resolve()
            if os.path.commonpath((str(root), str(target))) != str(root):
                raise ValueError("历史版本路径无效")
            if not target.is_file():
                return _json_response_error("找不到这个历史版本", status=404)
            try:
                workflow = json.loads(target.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                return _json_response_error(f"历史版本文件损坏：{error}", status=500)
            return web.json_response({"ok": True, "workflow": workflow})
        except (ValueError, PermissionError) as error:
            return _json_response_error(str(error))
        except Exception as error:
            return _json_response_error(f"加载工作流历史失败：{error}", status=500)

    @routes.post("/jindouyun_design/workflow_backups/metadata")
    async def update_workflow_backup_metadata(request):
        try:
            data = await request.json()
            workflow_path = _normalize_workflow_path(data.get("workflow_path"))
            user_root = _get_user_root(prompt_server, request)
            metadata = _update_backup_metadata(
                user_root,
                workflow_path,
                data.get("backup_id"),
                data.get("name", ""),
                data.get("note", ""),
            )
            return web.json_response({"ok": True, "metadata": metadata})
        except FileNotFoundError as error:
            return _json_response_error(str(error), status=404)
        except (ValueError, PermissionError) as error:
            return _json_response_error(str(error))
        except Exception as error:
            return _json_response_error(f"更新工作流版本失败：{error}", status=500)

    @routes.post("/jindouyun_design/workflow_backups/delete")
    async def delete_workflow_backup(request):
        try:
            data = await request.json()
            workflow_path = _normalize_workflow_path(data.get("workflow_path"))
            user_root = _get_user_root(prompt_server, request)
            _delete_backup(user_root, workflow_path, data.get("backup_id"))
            return web.json_response({"ok": True, "deleted": True})
        except FileNotFoundError as error:
            return _json_response_error(str(error), status=404)
        except (ValueError, PermissionError) as error:
            return _json_response_error(str(error))
        except Exception as error:
            return _json_response_error(f"删除工作流版本失败：{error}", status=500)
