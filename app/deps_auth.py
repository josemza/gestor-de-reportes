from __future__ import annotations
from typing import Callable
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models_auth import Usuario, UsuarioRol, Rol
from app.security import decode_token

bearer_scheme = HTTPBearer(auto_error=False)

def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    if not creds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = creds.credentials
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")

    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")

    user = db.execute(
        select(Usuario).where(Usuario.username == username)
    ).scalar_one_or_none()

    if not user or user.activo != 1:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario no activo o inexistente")

    role_rows = db.execute(
        select(Rol.nombre)
        .join(UsuarioRol, UsuarioRol.rol_id == Rol.id)
        .where(UsuarioRol.usuario_id == user.id)
    ).all()

    roles = [r[0] for r in role_rows]

    return {
        "id": user.id,
        "username": user.username,
        "activo": user.activo,
        "roles": roles,
    }

def require_role(role_name: str) -> Callable:
    def checker(current_user=Depends(get_current_user)):
        # Superuser bypass
        if current_user["username"] == "admin":
            return current_user
            
        if role_name not in current_user["roles"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Se requiere rol: {role_name}"
            )
        return current_user
    return checker

def require_admin_rutas(current_user=Depends(require_role("ADMIN"))):
    return current_user