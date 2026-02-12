import json
import os
from pathlib import Path
import uuid
from datetime import datetime, timezone
from sqlalchemy import select, update, text
from sqlalchemy.orm import Session
from .models import Reporte, Solicitud, SolicitudEvento
from .schemas import SolicitudCreate

ALLOWED_EXT_DEFAULT = {"csv","xlsx"}

def _norm_abs(p: str) -> str:
    return os.path.normcase(os.path.abspath(os.path.normpath(p)))

def is_path_under_base(candidate: str, base: str) -> bool:
    c = _norm_abs(candidate)
    b = _norm_abs(base)
    return c == b or c.startswith(b + os.sep)

def list_files_from_base(base: str, allowed_ext: set[str], max_items: int = 500) -> list[str]:
    out: list[str] = []
    p = Path(base)
    if not p.exists() or not p.is_dir():
        return out
    
    for item in p.iterdir():
        if not item.is_file():
            continue
        ext = item.suffix.lower().lstrip(".")
        if ext in allowed_ext:
            out.append(str(item))
            if len(out) >= max_items:
                break
    out.sort()
    return out

def _new_request_id() -> str:
    return f"REQ_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8].upper()}"


def add_evento(db: Session, solicitud_id: int, tipo: str, detalle: str | None, origen: str):
    db.add(SolicitudEvento(
        solicitud_id=solicitud_id,
        tipo_evento=tipo,
        detalle=detalle,
        origen=origen,
    ))


def create_reporte(db: Session, payload: dict) -> Reporte:
    now = datetime.now(timezone.utc)
    r = Reporte(**payload, created_at=now, updated_at=now)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def get_reporte_by_codigo(db: Session, codigo: str) -> Reporte | None:
    return db.execute(select(Reporte).where(Reporte.codigo == codigo)).scalar_one_or_none()


def list_reportes_activos(db: Session) -> list[Reporte]:
    q = select(Reporte).where(Reporte.activo == 1).order_by(Reporte.codigo)
    return list(db.execute(q).scalars())


def create_solicitud(db: Session, data: SolicitudCreate) -> Solicitud:
    rep = get_reporte_by_codigo(db, data.reporte_codigo)
    if not rep or rep.activo != 1:
        raise ValueError("Reporte no existe o no está activo")

    if rep.requiere_input_archivo == 1 and not data.ruta_input:
        raise ValueError("Este reporte requiere ruta_input")

    if data.ruta_input and rep.tipos_permitidos:
        allowed = {x.strip().lower() for x in rep.tipos_permitidos.split(";") if x.strip()}
        ext = data.ruta_input.split(".")[-1].lower() if "." in data.ruta_input else ""
        if allowed and ext not in allowed:
            raise ValueError(f"Extensión no permitida: .{ext}. Permitidas: {sorted(allowed)}")

    now = datetime.now(timezone.utc)
    s = Solicitud(
        request_id=_new_request_id(),
        reporte_id=rep.id,
        usuario=data.usuario,
        estado="EN_COLA",
        progreso=0,
        mensaje_estado="Solicitud registrada y en cola",
        ruta_input=data.ruta_input,
        parametros_json=json.dumps(data.parametros, ensure_ascii=False),
        intentos=0,
        max_intentos=max(1, data.max_intentos),
        fecha_solicitud=now,
        updated_at=now,
    )
    db.add(s)
    db.flush()
    add_evento(db, s.id, "ESTADO", "EN_COLA", "API")
    db.commit()
    db.refresh(s)
    return s


def get_solicitud_by_request_id(db: Session, request_id: str) -> Solicitud | None:
    return db.execute(select(Solicitud).where(Solicitud.request_id == request_id)).scalar_one_or_none()


def list_solicitudes_usuario(db: Session, usuario: str, limit: int = 100) -> list[Solicitud]:
    q = (
        select(Solicitud)
        .where(Solicitud.usuario == usuario)
        .order_by(Solicitud.fecha_solicitud.desc())
        .limit(min(max(limit, 1), 500))
    )
    return list(db.execute(q).scalars())


def take_next_job_atomically_oracle(db: Session, worker_id: str) -> Solicitud | None:
    """
    Oracle-friendly: FOR UPDATE SKIP LOCKED para que múltiples workers no colisionen.
    """
    # 1) tomar un id candidate bloqueándolo
    row = db.execute(text("""
        SELECT ROWID AS rid, SOLICITUD_ID
        FROM SOLICITUDES_REP_GCI
        WHERE ESTADO = 'EN_COLA'
        ORDER BY FECHA_SOLICITUD, SOLICITUD_ID
        FOR UPDATE SKIP LOCKED
    """)).first()

    if not row:
        db.rollback()
        return None

    rid = row.rid
    solicitud_id = int(row.solicitud_id)

    # 2) actualizar estado dentro de la misma transacción
    now = datetime.now(timezone.utc)
    db.execute(text(
        """
        UPDATE SOLICITUDES_REP_GCI
        SET ESTADO = 'EJECUTANDO',
            PROGRESO = 10,
            MENSAJE_ESTADO = :msg,
            FECHA_INICIO = :fecha_inicio,
            UPDATED_AT = :updated_at
        WHERE ROWID = :rid
        """
    ), {
        "msg": f"Tomada por worker {worker_id}",
        "fecha_inicio": now,
        "updated_at": now,
        "rid": rid,
    })
    
    add_evento(db, solicitud_id, "ESTADO", "EJECUTANDO", "WORKER")
    db.commit()

    s = db.execute(
        select(Solicitud).where(Solicitud.id == solicitud_id)
    ).scalar_one_or_none()

    return s

def take_next_job_atomically(db: Session, worker_id: str) -> Solicitud | None:
    """
    MariaDB-friendly: Usa FOR UPDATE SKIP LOCKED (requiere MariaDB 10.6+)
    y reemplaza ROWID por la clave primaria.
    """
    # 1) Tomar un ID candidato bloqueándolo
    # En MariaDB usamos la Primary Key directamente en lugar de ROWID
    row = db.execute(text("""
        SELECT SOLICITUD_ID
        FROM SOLICITUDES_REP_GCI
        WHERE ESTADO = 'EN_COLA'
        ORDER BY FECHA_SOLICITUD ASC, SOLICITUD_ID ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    """)).first()

    if not row:
        # Importante: No siempre es necesario rollback si no hubo cambios, 
        # pero ayuda a liberar cualquier estado de transacción.
        db.rollback()
        return None

    solicitud_id = int(row.SOLICITUD_ID)

    # 2) Actualizar estado dentro de la misma transacción
    now = datetime.now(timezone.utc)
    db.execute(text(
        """
        UPDATE SOLICITUDES_REP_GCI
        SET ESTADO = 'EJECUTANDO',
            PROGRESO = 10,
            MENSAJE_ESTADO = :msg,
            FECHA_INICIO = :fecha_inicio,
            UPDATED_AT = :updated_at
        WHERE SOLICITUD_ID = :sid
        """
    ), {
        "msg": f"Tomada por worker {worker_id}",
        "fecha_inicio": now,
        "updated_at": now,
        "sid": solicitud_id,
    })
    
    add_evento(db, solicitud_id, "ESTADO", "EJECUTANDO", "WORKER")
    db.commit()

    # 3) Recuperar el objeto ORM
    s = db.execute(
        select(Solicitud).where(Solicitud.id == solicitud_id)
    ).scalar_one_or_none()

    return s