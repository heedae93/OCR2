"""
Users Admin API - administrator user and group management
"""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBSession

from api.auth import hash_password
from config import Config
from database import CustomMaskingField, PermissionGroup, User, get_db

logger = logging.getLogger(__name__)
router = APIRouter()

VALID_USER_TYPES = {"A", "U"}
VALID_MASKING_ACCESS_LEVELS = {"masked", "original"}
DEFAULT_PERMISSION_GROUP = "default"
UNASSIGNED_PERMISSION_GROUP = "__unassigned__"
DEFAULT_MASKING_FIELDS = [
    {"field_key": "title", "label": "문서 제목", "source": "system"},
    {"field_key": "date", "label": "발행 날짜", "source": "system"},
    {"field_key": "amount", "label": "금액/수치", "source": "system"},
    {"field_key": "vendor", "label": "업체/기관명", "source": "system"},
    {"field_key": "address", "label": "주소/위치", "source": "system"},
    {"field_key": "person", "label": "인명/담당자", "source": "system"},
]


def normalize_permission_group_key(value: Optional[str], fallback: str = DEFAULT_PERMISSION_GROUP) -> str:
    group = (value or fallback).strip()
    return group or fallback


def normalize_user_permission_group(value: Optional[str]) -> str:
    group = (value or "").strip()
    if not group or group == UNASSIGNED_PERMISSION_GROUP:
        return ""
    return group


def normalize_masking_access_level(value: Optional[str]) -> str:
    level = (value or "masked").strip().lower()
    return level or "masked"


def validate_user_type(value: str) -> str:
    if value not in VALID_USER_TYPES:
        raise HTTPException(status_code=400, detail="type must be 'A' or 'U'.")
    return value


def validate_masking_access_level(value: str) -> str:
    if value not in VALID_MASKING_ACCESS_LEVELS:
        raise HTTPException(status_code=400, detail="masking_access_level must be 'masked' or 'original'.")
    return value


def normalize_masking_field_keys(values: Optional[list[str]]) -> list[str]:
    normalized: list[str] = []
    for value in values or []:
        key = (value or "").strip()
        if key and key not in normalized:
            normalized.append(key)
    return normalized


def parse_masking_field_keys(raw_value: Optional[str]) -> list[str]:
    if not raw_value:
        return []
    try:
        data = json.loads(raw_value)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return normalize_masking_field_keys([str(item) for item in data])


def dump_masking_field_keys(values: Optional[list[str]]) -> str:
    return json.dumps(normalize_masking_field_keys(values), ensure_ascii=False)


def list_available_masking_fields(db: DBSession) -> list[dict]:
    custom_fields = db.query(CustomMaskingField).order_by(CustomMaskingField.created_at.asc()).all()
    merged = {field["field_key"]: field for field in DEFAULT_MASKING_FIELDS}
    for field in custom_fields:
        merged[field.field_key] = {
            "field_key": field.field_key,
            "label": field.label,
            "source": "custom",
        }
    return list(merged.values())


def get_group_or_404(db: DBSession, group_key: str) -> PermissionGroup:
    group = db.query(PermissionGroup).filter_by(group_key=group_key).first()
    if not group:
        raise HTTPException(status_code=404, detail="Permission group not found.")
    return group


def serialize_group(group: PermissionGroup, user_count: int) -> dict:
    masking_field_keys = parse_masking_field_keys(group.masking_field_keys)
    return {
        "group_key": group.group_key,
        "group_name": group.group_name,
        "description": group.description,
        "masking_access_level": normalize_masking_access_level(group.masking_access_level),
        "masking_field_keys": masking_field_keys,
        "is_system": bool(group.is_system),
        "user_count": user_count,
        "created_at": group.created_at.strftime("%Y-%m-%d %H:%M:%S") if group.created_at else None,
        "updated_at": group.updated_at.strftime("%Y-%m-%d %H:%M:%S") if group.updated_at else None,
    }


def serialize_user(user: User, group: Optional[PermissionGroup]) -> dict:
    permission_group = normalize_user_permission_group(user.permission_group)
    resolved_group = group.group_key if group else permission_group
    resolved_group_name = group.group_name if group else "미배정"
    masking_access_level = normalize_masking_access_level(
        group.masking_access_level if group else user.masking_access_level
    )
    masking_field_keys = parse_masking_field_keys(group.masking_field_keys) if group else []
    return {
        "user_id": user.user_id,
        "username": user.username,
        "name": user.name,
        "email": user.email,
        "type": user.type,
        "permission_group": resolved_group,
        "permission_group_name": resolved_group_name,
        "masking_access_level": masking_access_level,
        "masking_field_keys": masking_field_keys,
        "total_jobs": user.total_jobs,
        "created_at": user.created_at.strftime("%Y-%m-%d %H:%M:%S") if user.created_at else None,
        "last_login": user.last_login.strftime("%Y-%m-%d %H:%M:%S") if user.last_login else None,
        "permissions": {
            "group": resolved_group,
            "group_name": resolved_group_name,
            "can_view_masked_result": True,
            "can_view_original_result": masking_access_level == "original",
            "masking_field_keys": masking_field_keys,
        },
        "is_assigned": bool(group),
    }


class PermissionGroupCreateRequest(BaseModel):
    group_key: str
    group_name: str
    description: Optional[str] = None
    masking_access_level: str = Field(default="masked")
    masking_field_keys: list[str] = Field(default_factory=list)


class PermissionGroupUpdateRequest(BaseModel):
    group_name: Optional[str] = None
    description: Optional[str] = None
    masking_access_level: Optional[str] = None
    masking_field_keys: Optional[list[str]] = None


class UserCreateRequest(BaseModel):
    username: str
    name: str
    email: str
    password: str
    type: str = "U"
    permission_group: str = Field(default="default")


class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    type: Optional[str] = None
    permission_group: Optional[str] = None


@router.get("/admin/masking-fields")
def get_masking_fields(db: DBSession = Depends(get_db)):
    return list_available_masking_fields(db)


@router.get("/admin/permission-groups")
def list_permission_groups(db: DBSession = Depends(get_db)):
    groups = db.query(PermissionGroup).order_by(PermissionGroup.is_system.desc(), PermissionGroup.group_name.asc()).all()
    return [
        serialize_group(
            group,
            db.query(User).filter(User.permission_group == group.group_key).count(),
        )
        for group in groups
    ]


@router.post("/admin/permission-groups")
def create_permission_group(body: PermissionGroupCreateRequest, db: DBSession = Depends(get_db)):
    group_key = normalize_permission_group_key(body.group_key)
    masking_access_level = validate_masking_access_level(normalize_masking_access_level(body.masking_access_level))

    if db.query(PermissionGroup).filter_by(group_key=group_key).first():
        raise HTTPException(status_code=409, detail="This group key is already in use.")

    group = PermissionGroup(
        group_key=group_key,
        group_name=body.group_name.strip(),
        description=(body.description or "").strip() or None,
        masking_access_level=masking_access_level,
        masking_field_keys=dump_masking_field_keys(body.masking_field_keys),
        is_system=False,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    logger.info("Admin created permission group: %s", group.group_key)
    return serialize_group(group, 0)


def _invalidate_group_masked_pdf_cache(group_key: str) -> None:
    """해당 그룹의 마스킹 PDF 캐시 파일을 전부 삭제한다."""
    pattern = f"*_masked_{group_key}.pdf"
    deleted = 0
    for cached_file in Config.PROCESSED_DIR.glob(pattern):
        try:
            cached_file.unlink()
            deleted += 1
        except Exception as e:
            logger.warning(f"캐시 파일 삭제 실패 {cached_file.name}: {e}")
    if deleted:
        logger.info(f"그룹 '{group_key}' masking_field_keys 변경 → 캐시 {deleted}개 삭제")


@router.put("/admin/permission-groups/{group_key}")
def update_permission_group(group_key: str, body: PermissionGroupUpdateRequest, db: DBSession = Depends(get_db)):
    group = get_group_or_404(db, group_key)

    if body.group_name is not None:
        group.group_name = body.group_name.strip() or group.group_name
    if body.description is not None:
        group.description = body.description.strip() or None
    if body.masking_access_level is not None:
        group.masking_access_level = validate_masking_access_level(
            normalize_masking_access_level(body.masking_access_level)
        )
    field_keys_changed = body.masking_field_keys is not None
    if field_keys_changed:
        group.masking_field_keys = dump_masking_field_keys(body.masking_field_keys)

    db.commit()
    db.refresh(group)

    # masking_field_keys 변경 시 해당 그룹의 마스킹 PDF 캐시 삭제
    if field_keys_changed:
        _invalidate_group_masked_pdf_cache(group.group_key)

    user_count = db.query(User).filter(User.permission_group == group.group_key).count()
    logger.info("Admin updated permission group: %s", group.group_key)
    return serialize_group(group, user_count)


@router.delete("/admin/permission-groups/{group_key}")
def delete_permission_group(group_key: str, db: DBSession = Depends(get_db)):
    group = get_group_or_404(db, group_key)
    if group.is_system:
        raise HTTPException(status_code=400, detail="System groups cannot be deleted.")

    assigned_users = db.query(User).filter(User.permission_group == group.group_key).count()
    if assigned_users > 0:
        raise HTTPException(status_code=400, detail="Users are assigned to this group. Reassign them first.")

    db.delete(group)
    db.commit()
    logger.info("Admin deleted permission group: %s", group_key)
    return {"detail": "Permission group deleted successfully."}


@router.get("/admin/users")
def list_users(db: DBSession = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    group_map = {group.group_key: group for group in db.query(PermissionGroup).all()}
    return [serialize_user(user, group_map.get(user.permission_group)) for user in users]


@router.post("/admin/users")
def create_user(body: UserCreateRequest, db: DBSession = Depends(get_db)):
    if db.query(User).filter_by(username=body.username).first():
        raise HTTPException(status_code=409, detail="This username is already in use.")
    if body.email and db.query(User).filter_by(email=body.email).first():
        raise HTTPException(status_code=409, detail="This email is already in use.")

    user_type = validate_user_type(body.type)
    group_key = normalize_user_permission_group(body.permission_group) or DEFAULT_PERMISSION_GROUP
    group = get_group_or_404(db, group_key)

    user = User(
        user_id=body.username,
        username=body.username,
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        type=user_type,
        permission_group=group.group_key,
        masking_access_level=group.masking_access_level,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("Admin created user: %s (group=%s)", user.username, group.group_key)
    return serialize_user(user, group)


@router.put("/admin/users/{user_id}")
def update_user(user_id: str, body: UserUpdateRequest, db: DBSession = Depends(get_db)):
    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if body.name is not None:
        user.name = body.name
    if body.email is not None:
        existing = db.query(User).filter_by(email=body.email).first()
        if existing and existing.user_id != user_id:
            raise HTTPException(status_code=409, detail="This email is already in use.")
        user.email = body.email
    if body.password:
        user.password_hash = hash_password(body.password)
    if body.type is not None:
        user.type = validate_user_type(body.type)
    if body.permission_group is not None:
        group_key = normalize_user_permission_group(body.permission_group)
        if group_key:
            group = get_group_or_404(db, group_key)
            user.permission_group = group.group_key
            user.masking_access_level = group.masking_access_level
        else:
            user.permission_group = ""
            user.masking_access_level = "masked"

    db.commit()
    db.refresh(user)
    group = None
    if user.permission_group:
        group = db.query(PermissionGroup).filter_by(group_key=user.permission_group).first()
    logger.info("Admin updated user: %s (group=%s)", user.username, user.permission_group)
    return serialize_user(user, group)


@router.delete("/admin/users/{user_id}")
def delete_user(user_id: str, db: DBSession = Depends(get_db)):
    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    db.delete(user)
    db.commit()
    logger.info("Admin deleted user: %s", user_id)
    return {"detail": "User deleted successfully."}
