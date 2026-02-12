from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models_auth import Usuario, UsuarioRol, Rol
from app.schemas_auth import LoginIn, TokenOut, MeOut, PasswordChangeIn
from app.security import verify_password, needs_rehash, hash_password, create_access_token
from app.config import settings
from app.deps_auth import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.execute(
        select(Usuario).where(Usuario.username == payload.username)
    ).scalar_one_or_none()

    if not user or user.activo != 1:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")

    # Rehash oportunista si passlib sugiere update
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
        db.add(user)
        db.commit()

    role_rows = db.execute(
        select(Rol.nombre)
        .join(UsuarioRol, UsuarioRol.rol_id == Rol.id)
        .where(UsuarioRol.usuario_id == user.id)
    ).all()
    roles = [r[0] for r in role_rows]

    token = create_access_token(sub=user.username, roles=roles)

    return TokenOut(
        access_token=token,
        token_type="bearer",
        expires_in_minutes=settings.JWT_ACCESS_TOKEN_MINUTES
    )

@router.get("/me", response_model=MeOut)
def me(current_user=Depends(get_current_user)):
    return MeOut(
        username=current_user["username"],
        activo=current_user["activo"],
        roles=current_user["roles"],
    )

@router.patch("/change-password")
def change_password(
    payload: PasswordChangeIn,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.execute(
        select(Usuario).where(Usuario.username == current_user["username"])
    ).scalar_one_or_none()

    if not user or user.activo != 1:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La contraseña actual no coincide")

    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La nueva contraseña debe ser diferente")

    user.password_hash = hash_password(payload.new_password)
    db.add(user)
    db.commit()

    return {"detail": "Contraseña actualizada correctamente"}
