"""
Auth API - 회원가입/로그인
"""
import uuid
import hashlib
import secrets
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional
from sqlalchemy.orm import Session as DBSession

from database import get_db, PermissionGroup, User

logger = logging.getLogger(__name__)
router = APIRouter()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 260000)
    return f"{salt}${dk.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        salt, dk_hex = password_hash.split('$')
        dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 260000)
        return dk.hex() == dk_hex
    except Exception:
        return False


def build_permission_payload(user: User, db: DBSession) -> dict:
    permission_group = (user.permission_group or "default").strip() or "default"
    group = db.query(PermissionGroup).filter_by(group_key=permission_group).first()
    group_name = group.group_name if group else permission_group
    masking_access_level = (
        (group.masking_access_level if group else user.masking_access_level) or "masked"
    ).strip().lower() or "masked"
    return {
        "permission_group": permission_group,
        "permission_group_name": group_name,
        "masking_access_level": masking_access_level,
        "permissions": {
            "group": permission_group,
            "group_name": group_name,
            "can_view_masked_result": True,
            "can_view_original_result": masking_access_level == "original",
        },
    }


class RegisterRequest(BaseModel):
    username: str
    name: str
    email: str
    password: str


@router.post("/auth/register")
def register(body: RegisterRequest, db: DBSession = Depends(get_db)):
    # 중복 체크
    if db.query(User).filter_by(username=body.username).first():
        raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다.")
    if db.query(User).filter_by(email=body.email).first():
        raise HTTPException(status_code=409, detail="이미 사용 중인 이메일입니다.")

    user = User(
        user_id=body.username,
        username=body.username,
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        type='U',
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    logger.info(f"New user registered: {user.username} ({user.user_id})")
    return {
        "user_id": user.user_id,
        "username": user.username,
        "name": user.name,
        **build_permission_payload(user, db),
    }


class FindPasswordRequest(BaseModel):
    username: str
    email: str
    new_password: str


@router.post("/auth/find-password")
def find_password(body: FindPasswordRequest, db: DBSession = Depends(get_db)):
    user = db.query(User).filter_by(username=body.username, email=body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="아이디 또는 이메일이 일치하지 않습니다.")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"detail": "비밀번호가 변경되었습니다."}


class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


@router.put("/auth/profile/{user_id}")
def update_profile(user_id: str, body: ProfileUpdateRequest, db: DBSession = Depends(get_db)):
    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    if body.name is not None:
        user.name = body.name
    if body.email is not None:
        existing = db.query(User).filter_by(email=body.email).first()
        if existing and existing.user_id != user_id:
            raise HTTPException(status_code=409, detail="이미 사용 중인 이메일입니다.")
        user.email = body.email
    if body.new_password:
        if not body.current_password:
            raise HTTPException(status_code=400, detail="현재 비밀번호를 입력해주세요.")
        if not verify_password(body.current_password, user.password_hash):
            raise HTTPException(status_code=401, detail="현재 비밀번호가 올바르지 않습니다.")
        user.password_hash = hash_password(body.new_password)

    db.commit()
    return {
        "user_id": user.user_id,
        "username": user.username,
        "name": user.name,
        "email": user.email,
        "type": user.type,
        **build_permission_payload(user, db),
    }


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
def login(body: LoginRequest, db: DBSession = Depends(get_db)):
    user = db.query(User).filter_by(username=body.username).first()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")

    from datetime import datetime
    user.last_login = datetime.now()
    db.commit()

    logger.info(f"User logged in: {user.username} ({user.user_id})")
    return {
        "user_id": user.user_id,
        "username": user.username,
        "name": user.name,
        "type": user.type,
        **build_permission_payload(user, db),
    }
