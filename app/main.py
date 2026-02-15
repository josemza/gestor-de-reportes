from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import select, delete, func
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .deps_auth import require_admin_rutas, get_current_user
from . import crud
from .schemas import HealthOut, ReporteOut, ReporteCreate, SolicitudCreate, SolicitudOut, SolicitudPageOut, EventoOut
from .schemas_admin import (
    CarpetaPermitidaCreate,
    CarpetaPermitidaOut,
    CarpetaPermitidaUpdate,
    ReporteAdminCreate,
    ReporteAdminOut,
    ReporteAdminPageOut,
    ReporteAdminUpdate,
    EquipoCreate,
    EquipoUpdate,
    EquipoOut,
    EquipoAsignacionIn,
)
from .schemas_auth import UserCreateIn, UserCreateOut, UserOut, UserPasswordResetOut
from .init_db import init_db
from .models import Solicitud, SolicitudEvento, Reporte, ReporteCarpetaPermitida, ReporteEquipo
from .models_auth import Usuario, Rol, UsuarioRol, Equipo, UsuarioEquipo
from .security import hash_password
from .routers.auth import router as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    init_db()
    yield
    # SHUTDOWN
    # (si más adelante necesitas cerrar recursos globales, va aquí)


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    lifespan=lifespan,
)

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "Authorization"],
)

app.include_router(auth_router)

# static + frontend
BASE_DIR = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(BASE_DIR / "templates" / "index.html")


@app.get("/health", response_model=HealthOut, tags=["health"])
def health(request: Request):
    return HealthOut(
        status="ok",
        service=settings.APP_NAME,
        utc_time=datetime.now(timezone.utc).isoformat(),
        client_ip=request.client.host if request.client else "unknown",
    )


@app.get("/reportes", response_model=list[ReporteOut], tags=["reportes"])
def list_reportes(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    is_admin = "ADMIN" in current_user["roles"] or current_user["username"] == "admin"
    if is_admin:
        return crud.list_reportes_activos(db)

    rows = db.execute(
        select(Reporte)
        .join(ReporteEquipo, ReporteEquipo.reporte_id == Reporte.id)
        .join(UsuarioEquipo, UsuarioEquipo.equipo_id == ReporteEquipo.equipo_id)
        .where(
            Reporte.activo == 1,
            ReporteEquipo.activo == 1,
            UsuarioEquipo.activo == 1,
            UsuarioEquipo.usuario_id == current_user["id"],
        )
        .order_by(Reporte.codigo.asc())
    ).scalars().all()

    unique: dict[int, Reporte] = {r.id: r for r in rows}
    return list(unique.values())


@app.post("/reportes", response_model=ReporteOut, tags=["reportes"])
def create_reporte(payload: ReporteCreate, db: Session = Depends(get_db)):
    exists = crud.get_reporte_by_codigo(db, payload.codigo)
    if exists:
        raise HTTPException(status_code=409, detail="El código de reporte ya existe")
    return crud.create_reporte(db, payload.model_dump())


@app.get("/admin/reportes", response_model=ReporteAdminPageOut, tags=["admin"])
def list_reportes_admin(
    codigo: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=500),
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    codigo_norm = (codigo or "").strip().upper()
    query = select(Reporte)
    if codigo_norm:
        query = query.where(func.upper(Reporte.codigo).like(f"%{codigo_norm}%"))

    total = db.execute(
        select(func.count()).select_from(query.subquery())
    ).scalar_one()

    total_pages = max(1, (total + page_size - 1) // page_size)
    page_safe = min(page, total_pages) if total > 0 else 1
    offset = (page_safe - 1) * page_size

    items = db.execute(
        query.order_by(Reporte.codigo.asc()).offset(offset).limit(page_size)
    ).scalars().all()

    return ReporteAdminPageOut(
        items=items,
        total=total,
        page=page_safe,
        page_size=page_size,
        total_pages=total_pages,
    )


@app.post("/admin/reportes", response_model=ReporteAdminOut, tags=["admin"])
def create_reporte_admin(
    payload: ReporteAdminCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    exists = crud.get_reporte_by_codigo(db, payload.codigo.strip())
    if exists:
        raise HTTPException(status_code=409, detail="El código de reporte ya existe")

    now = datetime.now(timezone.utc)
    row = Reporte(
        codigo=payload.codigo.strip(),
        nombre=payload.nombre.strip(),
        descripcion=payload.descripcion,
        requiere_input_archivo=1 if payload.requiere_input_archivo else 0,
        tipos_permitidos=payload.tipos_permitidos,
        activo=1 if payload.activo else 0,
        comando=payload.comando,
        ruta_output_base=payload.ruta_output_base,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/admin/reportes/{reporte_id}", response_model=ReporteAdminOut, tags=["admin"])
def update_reporte_admin(
    reporte_id: int,
    payload: ReporteAdminUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    row = db.get(Reporte, reporte_id)
    if not row:
        raise HTTPException(status_code=404, detail="Reporte no existe")

    if payload.codigo is not None:
        codigo = payload.codigo.strip()
        dup = db.execute(
            select(Reporte).where(Reporte.codigo == codigo, Reporte.id != reporte_id)
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="Ya existe otro reporte con ese código")
        row.codigo = codigo

    if payload.nombre is not None:
        row.nombre = payload.nombre.strip()

    if payload.descripcion is not None:
        row.descripcion = payload.descripcion

    if payload.requiere_input_archivo is not None:
        row.requiere_input_archivo = 1 if payload.requiere_input_archivo else 0

    if payload.tipos_permitidos is not None:
        row.tipos_permitidos = payload.tipos_permitidos

    if payload.activo is not None:
        row.activo = 1 if payload.activo else 0

    if payload.comando is not None:
        row.comando = payload.comando
    
    if payload.ruta_output_base is not None:
        row.ruta_output_base = payload.ruta_output_base

    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.delete("/admin/reportes/{reporte_id}", tags=["admin"])
def delete_reporte_admin(
    reporte_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    row = db.get(Reporte, reporte_id)
    if not row:
        raise HTTPException(status_code=404, detail="Reporte no existe")

    row.activo = 0
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    return {"detail": "Reporte desactivado correctamente"}


@app.post("/solicitudes", response_model=SolicitudOut, tags=["solicitudes"])
def create_solicitud(
    payload: SolicitudCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    payload.usuario = current_user["username"]
    rep = crud.get_reporte_by_codigo(db, payload.reporte_codigo)
    if not rep or rep.activo != 1:
        raise HTTPException(status_code=404, detail="Reporte no existe o inactivo")

    is_admin = "ADMIN" in current_user["roles"] or current_user["username"] == "admin"
    if not is_admin:
        allowed = db.execute(
            select(ReporteEquipo.id)
            .join(UsuarioEquipo, UsuarioEquipo.equipo_id == ReporteEquipo.equipo_id)
            .where(
                ReporteEquipo.reporte_id == rep.id,
                ReporteEquipo.activo == 1,
                UsuarioEquipo.usuario_id == current_user["id"],
                UsuarioEquipo.activo == 1,
            )
        ).first()
        if not allowed:
            raise HTTPException(status_code=403, detail="No tienes acceso a este reporte por equipo")

    try:
        s = crud.create_solicitud(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    rep = db.get(Reporte, s.reporte_id)
    return SolicitudOut(
        request_id=s.request_id,
        reporte_codigo=rep.codigo if rep else payload.reporte_codigo,
        usuario=s.usuario,
        estado=s.estado,
        progreso=s.progreso,
        mensaje_estado=s.mensaje_estado,
        ruta_output=s.ruta_output or (rep.ruta_output_base if rep else None),
        error_detalle=s.error_detalle,
        fecha_solicitud=s.fecha_solicitud,
        fecha_inicio=s.fecha_inicio,
        fecha_fin=s.fecha_fin,
        updated_at=s.updated_at,
    )


@app.get("/solicitudes/{request_id}", response_model=SolicitudOut, tags=["solicitudes"])
def get_solicitud(request_id: str, db: Session = Depends(get_db)):
    s = crud.get_solicitud_by_request_id(db, request_id)
    if not s:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    rep = db.get(Reporte, s.reporte_id)
    return SolicitudOut(
        request_id=s.request_id,
        reporte_codigo=rep.codigo if rep else "UNKNOWN",
        usuario=s.usuario,
        estado=s.estado,
        progreso=s.progreso,
        mensaje_estado=s.mensaje_estado,
        ruta_output=s.ruta_output or (rep.ruta_output_base if rep else None),
        error_detalle=s.error_detalle,
        fecha_solicitud=s.fecha_solicitud,
        fecha_inicio=s.fecha_inicio,
        fecha_fin=s.fecha_fin,
        updated_at=s.updated_at,
    )


@app.get("/mis-solicitudes", response_model=SolicitudPageOut, tags=["solicitudes"])
def mis_solicitudes(
    usuario: str = Query(..., min_length=1),
    estado: str = Query(""),
    reporte_codigo: str = Query("", max_length=100),
    fecha_desde: str | None = Query(default=None),
    fecha_hasta: str | None = Query(default=None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=500),
    db: Session = Depends(get_db),
):
    usuario_norm = usuario.strip()
    estado_norm = (estado or "").strip().upper()
    reporte_codigo_norm = (reporte_codigo or "").strip().upper()

    dt_desde = None
    dt_hasta = None
    try:
        if fecha_desde:
            dt_desde = datetime.fromisoformat(fecha_desde)
            if len(fecha_desde) == 10:
                dt_desde = dt_desde.replace(hour=0, minute=0, second=0, microsecond=0)
        if fecha_hasta:
            dt_hasta = datetime.fromisoformat(fecha_hasta)
            if len(fecha_hasta) == 10:
                dt_hasta = dt_hasta.replace(hour=23, minute=59, second=59, microsecond=999999)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido. Usa YYYY-MM-DD") from e

    query = (
        select(Solicitud, Reporte.codigo, Reporte.ruta_output_base)
        .join(Reporte, Reporte.id == Solicitud.reporte_id, isouter=True)
        .where(Solicitud.usuario == usuario_norm)
    )

    if estado_norm:
        query = query.where(Solicitud.estado == estado_norm)
    if reporte_codigo_norm:
        query = query.where(func.upper(Reporte.codigo).like(f"%{reporte_codigo_norm}%"))
    if dt_desde:
        query = query.where(Solicitud.fecha_solicitud >= dt_desde)
    if dt_hasta:
        query = query.where(Solicitud.fecha_solicitud <= dt_hasta)

    total = db.execute(
        select(func.count()).select_from(query.subquery())
    ).scalar_one()

    total_pages = max(1, (total + page_size - 1) // page_size)
    page_safe = min(page, total_pages) if total > 0 else 1
    offset = (page_safe - 1) * page_size

    rows = db.execute(
        query.order_by(Solicitud.fecha_solicitud.desc()).offset(offset).limit(page_size)
    ).all()

    out: list[SolicitudOut] = []
    for s, rep_codigo, rep_output in rows:
        out.append(SolicitudOut(
            request_id=s.request_id,
            reporte_codigo=rep_codigo if rep_codigo else "UNKNOWN",
            usuario=s.usuario,
            estado=s.estado,
            progreso=s.progreso,
            mensaje_estado=s.mensaje_estado,
            ruta_output=s.ruta_output or rep_output,
            error_detalle=s.error_detalle,
            fecha_solicitud=s.fecha_solicitud,
            fecha_inicio=s.fecha_inicio,
            fecha_fin=s.fecha_fin,
            updated_at=s.updated_at,
        ))
    return SolicitudPageOut(
        items=out,
        total=total,
        page=page_safe,
        page_size=page_size,
        total_pages=total_pages,
    )


@app.get("/solicitudes/{request_id}/eventos", response_model=list[EventoOut], tags=["solicitudes"])
def solicitud_eventos(request_id: str, db: Session = Depends(get_db)):
    s = crud.get_solicitud_by_request_id(db, request_id)
    if not s:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    events = (
        db.query(SolicitudEvento)
        .filter(SolicitudEvento.solicitud_id == s.id)
        .order_by(SolicitudEvento.created_at.asc())
        .all()
    )
    return events


@app.get("/reportes/{codigo}/archivos-input", tags=["reportes"])
def list_archivos_input(
    codigo: str,
    max_items: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    rep = crud.get_reporte_by_codigo(db, codigo)
    if not rep or rep.activo != 1:
        raise HTTPException(status_code=404, detail="Reporte no existe o inactivo")
    
    rows = db.execute(
        select(ReporteCarpetaPermitida).where(
            ReporteCarpetaPermitida.reporte_id == rep.id, ReporteCarpetaPermitida.activo == 1
        )
    ).scalars().all()

    if not rows:
        return {"reporte": codigo, "archivos": []}
    
    allowed = {x.strip().lower() for x in (rep.tipos_permitidos or "").split(";") if x.strip()}
    if not allowed:
        allowed = {"csv", "xlsx"}
    
    archivos: list[str] = []
    for r in rows:
        archivos.extend(crud.list_files_from_base(r.ruta_base, allowed, max_items=max_items))
    
    archivos = sorted(set(archivos))[:max_items]

    return {"reporte": codigo, "archivos": archivos}


@app.get("/admin/reportes/{codigo}/carpetas", tags=["admin"])
def list_carpetas_reporte(
    codigo: str, 
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas)
    ):
    rep = crud.get_reporte_by_codigo(db, codigo)
    if not rep:
        raise HTTPException(status_code=404, detail="Reporte no existe")

    rows = db.execute(
        select(ReporteCarpetaPermitida)
        .where(ReporteCarpetaPermitida.reporte_id == rep.id)
        .order_by(ReporteCarpetaPermitida.id.desc())
    ).scalars().all()

    return [
        {
            "id": r.id,
            "reporte_codigo": codigo,
            "ruta_base": r.ruta_base,
            "activo": r.activo,
        }
        for r in rows
    ]


@app.post("/admin/reportes/{codigo}/carpetas", response_model=CarpetaPermitidaOut, tags=["admin"])
def add_carpeta_reporte(
    codigo: str, 
    payload: CarpetaPermitidaCreate, 
    db: Session = Depends(get_db),
    _user = Depends(require_admin_rutas)
    ):
    rep = crud.get_reporte_by_codigo(db, codigo)
    if not rep:
        raise HTTPException(status_code=404, detail="Reporte no existe")

    ruta = payload.ruta_base.strip()

    # evitar duplicado exacto activo
    dup = db.execute(
        select(ReporteCarpetaPermitida).where(
            ReporteCarpetaPermitida.reporte_id == rep.id,
            ReporteCarpetaPermitida.ruta_base == ruta,
            ReporteCarpetaPermitida.activo == 1
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail="La ruta ya está registrada y activa para este reporte")

    row = ReporteCarpetaPermitida(
        reporte_id=rep.id,
        ruta_base=ruta,
        activo=1
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return {
        "id": row.id,
        "reporte_codigo": codigo,
        "ruta_base": row.ruta_base,
        "activo": row.activo,
    }


@app.patch("/admin/carpetas/{carpeta_id}", response_model=CarpetaPermitidaOut, tags=["admin"])
def update_carpeta(
    carpeta_id: int, 
    payload: CarpetaPermitidaUpdate, 
    db: Session = Depends(get_db),
    _user = Depends(require_admin_rutas)
    ):
    row = db.get(ReporteCarpetaPermitida, carpeta_id)
    if not row:
        raise HTTPException(status_code=404, detail="Carpeta permitida no existe")

    if payload.ruta_base is not None:
        row.ruta_base = payload.ruta_base.strip()

    if payload.activo is not None:
        if payload.activo not in (0, 1):
            raise HTTPException(status_code=400, detail="activo debe ser 0 o 1")
        row.activo = payload.activo

    db.commit()
    db.refresh(row)

    rep = db.get(Reporte, row.reporte_id)
    return {
        "id": row.id,
        "reporte_codigo": rep.codigo if rep else "UNKNOWN",
        "ruta_base": row.ruta_base,
        "activo": row.activo,
    }


@app.get("/admin/usuarios", response_model=list[UserOut], tags=["admin"])
def list_usuarios(
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    users = db.execute(
        select(Usuario).order_by(Usuario.username.asc())
    ).scalars().all()

    out: list[UserOut] = []
    for user in users:
        role_rows = db.execute(
            select(Rol.nombre)
            .join(UsuarioRol, UsuarioRol.rol_id == Rol.id)
            .where(UsuarioRol.usuario_id == user.id)
        ).all()
        roles = [r[0] for r in role_rows]
        out.append(UserOut(
            id=user.id,
            username=user.username,
            activo=user.activo,
            roles=roles,
        ))
    return out


@app.post("/admin/usuarios", response_model=UserCreateOut, tags=["admin"])
def create_usuario(
    payload: UserCreateIn,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username inválido")

    existing = db.execute(
        select(Usuario).where(Usuario.username == username)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="El usuario ya existe")

    requested_roles = [r.strip().upper() for r in payload.roles if r and r.strip()]
    if not requested_roles:
        requested_roles = ["USER"]

    roles = db.execute(
        select(Rol).where(Rol.nombre.in_(requested_roles))
    ).scalars().all()
    found_role_names = {r.nombre for r in roles}
    missing_roles = [r for r in requested_roles if r not in found_role_names]
    if missing_roles:
        raise HTTPException(status_code=400, detail=f"Roles inexistentes: {', '.join(missing_roles)}")

    password_temporal = settings.DEFAULT_USER_PASSWORD
    user = Usuario(
        username=username,
        password_hash=hash_password(password_temporal),
        activo=1 if payload.activo else 0,
    )
    db.add(user)
    db.flush()

    for role in roles:
        db.add(UsuarioRol(usuario_id=user.id, rol_id=role.id))

    db.commit()
    db.refresh(user)

    return UserCreateOut(
        id=user.id,
        username=user.username,
        activo=user.activo,
        roles=sorted(found_role_names),
        password_temporal=password_temporal,
    )


@app.post("/admin/usuarios/{usuario_id}/reset-password", response_model=UserPasswordResetOut, tags=["admin"])
def reset_password_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    user = db.get(Usuario, usuario_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no existe")

    password_temporal = settings.DEFAULT_USER_PASSWORD
    user.password_hash = hash_password(password_temporal)
    db.add(user)
    db.commit()

    return UserPasswordResetOut(
        detail=f"Contraseña restaurada para el usuario '{user.username}'",
        password_temporal=password_temporal,
    )


@app.get("/admin/equipos", response_model=list[EquipoOut], tags=["admin"])
def list_equipos(
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    return db.execute(select(Equipo).order_by(Equipo.nombre.asc())).scalars().all()


@app.post("/admin/equipos", response_model=EquipoOut, tags=["admin"])
def create_equipo(
    payload: EquipoCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    nombre = payload.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="Nombre de equipo inválido")

    dup = db.execute(select(Equipo).where(Equipo.nombre == nombre)).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail="El equipo ya existe")

    row = Equipo(nombre=nombre, activo=1 if payload.activo else 0)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/admin/equipos/{equipo_id}", response_model=EquipoOut, tags=["admin"])
def update_equipo(
    equipo_id: int,
    payload: EquipoUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    row = db.get(Equipo, equipo_id)
    if not row:
        raise HTTPException(status_code=404, detail="Equipo no existe")

    if payload.nombre is not None:
        nombre = payload.nombre.strip()
        if not nombre:
            raise HTTPException(status_code=400, detail="Nombre inválido")
        dup = db.execute(select(Equipo).where(Equipo.nombre == nombre, Equipo.id != equipo_id)).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="Ya existe otro equipo con ese nombre")
        row.nombre = nombre

    if payload.activo is not None:
        row.activo = 1 if payload.activo else 0

    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.get("/admin/usuarios/{usuario_id}/equipos", response_model=list[EquipoOut], tags=["admin"])
def get_equipos_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    user = db.get(Usuario, usuario_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no existe")

    rows = db.execute(
        select(Equipo)
        .join(UsuarioEquipo, UsuarioEquipo.equipo_id == Equipo.id)
        .where(UsuarioEquipo.usuario_id == usuario_id, UsuarioEquipo.activo == 1)
        .order_by(Equipo.nombre.asc())
    ).scalars().all()
    return rows


@app.put("/admin/usuarios/{usuario_id}/equipos", tags=["admin"])
def set_equipos_usuario(
    usuario_id: int,
    payload: EquipoAsignacionIn,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    user = db.get(Usuario, usuario_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no existe")

    ids = sorted(set(payload.equipo_ids))
    if ids:
        found = db.execute(select(Equipo.id).where(Equipo.id.in_(ids), Equipo.activo == 1)).scalars().all()
        if len(found) != len(ids):
            raise HTTPException(status_code=400, detail="Uno o más equipos no existen o están inactivos")

    db.execute(delete(UsuarioEquipo).where(UsuarioEquipo.usuario_id == usuario_id))
    for equipo_id in ids:
        db.add(UsuarioEquipo(usuario_id=usuario_id, equipo_id=equipo_id, activo=1))
    db.commit()
    return {"detail": "Equipos del usuario actualizados correctamente"}


@app.get("/admin/reportes/{reporte_id}/equipos", response_model=list[EquipoOut], tags=["admin"])
def get_equipos_reporte(
    reporte_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    rep = db.get(Reporte, reporte_id)
    if not rep:
        raise HTTPException(status_code=404, detail="Reporte no existe")

    rows = db.execute(
        select(Equipo)
        .join(ReporteEquipo, ReporteEquipo.equipo_id == Equipo.id)
        .where(ReporteEquipo.reporte_id == reporte_id, ReporteEquipo.activo == 1)
        .order_by(Equipo.nombre.asc())
    ).scalars().all()
    return rows


@app.put("/admin/reportes/{reporte_id}/equipos", tags=["admin"])
def set_equipos_reporte(
    reporte_id: int,
    payload: EquipoAsignacionIn,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    rep = db.get(Reporte, reporte_id)
    if not rep:
        raise HTTPException(status_code=404, detail="Reporte no existe")

    ids = sorted(set(payload.equipo_ids))
    if ids:
        found = db.execute(select(Equipo.id).where(Equipo.id.in_(ids), Equipo.activo == 1)).scalars().all()
        if len(found) != len(ids):
            raise HTTPException(status_code=400, detail="Uno o más equipos no existen o están inactivos")

    db.execute(delete(ReporteEquipo).where(ReporteEquipo.reporte_id == reporte_id))
    for equipo_id in ids:
        db.add(ReporteEquipo(reporte_id=reporte_id, equipo_id=equipo_id, activo=1))
    db.commit()
    return {"detail": "Equipos del reporte actualizados correctamente"}
