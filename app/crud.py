import json
import os
from pathlib import Path
import uuid
from datetime import datetime, timezone
import re
from typing import Any
from sqlalchemy import select, update, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from .models import (
    InputCarpetaPermitida,
    Reporte,
    ReporteInputDef,
    Solicitud,
    SolicitudEvento,
    ReporteLock,
    SolicitudInputValor,
)
from .schemas import SolicitudCreate, SolicitudCreateV2

ALLOWED_EXT_DEFAULT = {"csv","xlsx"}
TEXT_INPUT_MAX_LENGTH = 1000
PERIODO_PATTERN = re.compile(r"^\d{6}$")

def _norm_abs(p: str) -> str:
    return os.path.normcase(os.path.abspath(os.path.normpath(p)))

def is_path_under_base(candidate: str, base: str) -> bool:
    c = _norm_abs(candidate)
    b = _norm_abs(base)
    return c == b or c.startswith(b + os.sep)


def _split_allowed_ext(raw: str | None) -> set[str]:
    allowed = {x.strip().lower().lstrip(".") for x in (raw or "").split(";") if x.strip()}
    return allowed or set(ALLOWED_EXT_DEFAULT)


def _file_extension(path_value: str) -> str:
    suffix = Path(path_value).suffix.lower().lstrip(".")
    return suffix

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


def get_reporte_input_defs(db: Session, reporte_id: int, only_active: bool = False) -> list[ReporteInputDef]:
    query = select(ReporteInputDef).where(ReporteInputDef.reporte_id == reporte_id)
    if only_active:
        query = query.where(ReporteInputDef.activo == 1)
    query = query.order_by(ReporteInputDef.orden.asc(), ReporteInputDef.id.asc())
    return list(db.execute(query).scalars().all())


def get_reporte_input_def_by_codigo(
    db: Session,
    reporte_id: int,
    codigo_input: str,
    only_active: bool = False,
) -> ReporteInputDef | None:
    query = select(ReporteInputDef).where(
        ReporteInputDef.reporte_id == reporte_id,
        ReporteInputDef.codigo_input == codigo_input,
    )
    if only_active:
        query = query.where(ReporteInputDef.activo == 1)
    return db.execute(query).scalar_one_or_none()


def get_input_carpetas_permitidas(
    db: Session,
    input_def_id: int,
    only_active: bool = False,
) -> list[InputCarpetaPermitida]:
    query = select(InputCarpetaPermitida).where(InputCarpetaPermitida.input_def_id == input_def_id)
    if only_active:
        query = query.where(InputCarpetaPermitida.activo == 1)
    query = query.order_by(InputCarpetaPermitida.id.asc())
    return list(db.execute(query).scalars().all())


def list_files_for_input(
    db: Session,
    input_def: ReporteInputDef,
    max_items: int = 500,
) -> list[dict[str, str]]:
    allowed = _split_allowed_ext(input_def.tipos_permitidos)
    carpetas = get_input_carpetas_permitidas(db, input_def.id, only_active=True)
    rutas: list[str] = []
    for carpeta in carpetas:
        rutas.extend(list_files_from_base(carpeta.ruta_base, allowed, max_items=max_items))

    unique = sorted(set(rutas))[:max_items]
    return [
        {
            "nombre_archivo": Path(ruta).name,
            "ruta_archivo": ruta,
        }
        for ruta in unique
    ]


def validate_input_file_path(
    db: Session,
    input_def: ReporteInputDef,
    ruta_archivo: str,
) -> dict[str, Any]:
    ruta_raw = (ruta_archivo or "").strip()
    if not ruta_raw:
        raise ValueError(f"El input {input_def.codigo_input} requiere ruta_archivo")

    if input_def.tipo_input != "archivo":
        raise ValueError(f"El input {input_def.codigo_input} no es de tipo archivo")

    allowed = _split_allowed_ext(input_def.tipos_permitidos)
    ext = _file_extension(ruta_raw)
    if ext not in allowed:
        raise ValueError(
            f"Extensión no permitida para {input_def.codigo_input}: .{ext or '?'}."
            f" Permitidas: {sorted(allowed)}"
        )

    carpetas = get_input_carpetas_permitidas(db, input_def.id, only_active=True)
    if not carpetas:
        raise ValueError(f"El input {input_def.codigo_input} no tiene carpetas permitidas activas")

    matched_base: str | None = None
    normalized_path: str | None = None
    for carpeta in carpetas:
        try:
            if is_path_under_base(ruta_raw, carpeta.ruta_base):
                matched_base = carpeta.ruta_base
                normalized_path = _norm_abs(ruta_raw)
                break
        except Exception:
            continue

    if not matched_base or not normalized_path:
        raise ValueError(f"La ruta enviada para {input_def.codigo_input} no pertenece a una carpeta permitida activa")

    exists_at_validation = False
    try:
        exists_at_validation = Path(ruta_raw).exists()
    except Exception:
        exists_at_validation = False

    if not exists_at_validation:
        raise ValueError(f"La ruta enviada para {input_def.codigo_input} no existe o no es accesible")

    try:
        is_file = Path(ruta_raw).is_file()
    except Exception:
        is_file = False
    if not is_file:
        raise ValueError(f"La ruta enviada para {input_def.codigo_input} no corresponde a un archivo")

    return {
        "ruta_archivo": ruta_raw,
        "metadata": {
            "nombre_archivo": Path(ruta_raw).name,
            "extension": ext,
            "ruta_base_match": matched_base,
            "ruta_normalizada": normalized_path,
            "exists_at_validation": exists_at_validation,
        },
    }

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


def create_solicitud_multi_input(
    db: Session,
    reporte: Reporte,
    usuario: str,
    payload: SolicitudCreateV2,
    input_defs: list[ReporteInputDef],
) -> Solicitud:
    if not input_defs:
        raise ValueError("El reporte no tiene definiciones de input. Usa POST /solicitudes para el modo legacy")

    all_defs_by_code = {row.codigo_input: row for row in input_defs}
    active_defs = [row for row in input_defs if row.activo == 1]
    active_defs_by_code = {row.codigo_input: row for row in active_defs}

    if not active_defs:
        raise ValueError("El reporte no tiene inputs activos configurados")

    payload_items = {item.codigo_input: item for item in payload.inputs}

    unknown_codes = sorted(code for code in payload_items if code not in all_defs_by_code)
    if unknown_codes:
        raise ValueError(f"Inputs desconocidos para el reporte: {', '.join(unknown_codes)}")

    inactive_codes = sorted(code for code in payload_items if code not in active_defs_by_code)
    if inactive_codes:
        raise ValueError(f"Hay inputs inactivos en el payload: {', '.join(inactive_codes)}")

    conflicting_params = sorted(set(payload.parametros.keys()) & set(all_defs_by_code.keys()))
    if conflicting_params:
        raise ValueError(
            "parametros contiene claves que duplican codigo_input definidos: "
            + ", ".join(conflicting_params)
        )

    missing_required = sorted(
        row.codigo_input
        for row in active_defs
        if row.obligatorio == 1 and row.codigo_input not in payload_items
    )
    if missing_required:
        raise ValueError(f"Faltan inputs obligatorios: {', '.join(missing_required)}")

    now = datetime.now(timezone.utc)
    rows_to_persist: list[SolicitudInputValor] = []

    for code, item in payload_items.items():
        input_def = active_defs_by_code[code]
        is_required = input_def.obligatorio == 1

        if input_def.tipo_input == "archivo":
            if item.valor is not None:
                raise ValueError(f"El input {code} usa ruta_archivo y no valor")

            if item.ruta_archivo is None:
                if is_required:
                    raise ValueError(f"El input {code} requiere ruta_archivo")
                rows_to_persist.append(
                    SolicitudInputValor(
                        input_def_id=input_def.id,
                        codigo_input=input_def.codigo_input,
                        tipo_input=input_def.tipo_input,
                        valor=None,
                        ruta_archivo=None,
                        metadata_json=None,
                        created_at=now,
                    )
                )
                continue

            validated = validate_input_file_path(db, input_def, item.ruta_archivo or "")
            rows_to_persist.append(
                SolicitudInputValor(
                    input_def_id=input_def.id,
                    codigo_input=input_def.codigo_input,
                    tipo_input=input_def.tipo_input,
                    valor=None,
                    ruta_archivo=validated["ruta_archivo"],
                    metadata_json=json.dumps(validated["metadata"], ensure_ascii=False),
                    created_at=now,
                )
            )
            continue

        if item.ruta_archivo is not None:
            raise ValueError(f"El input {code} no acepta ruta_archivo")

        value = (item.valor or "").strip()
        if not value:
            if is_required:
                raise ValueError(f"El input {code} requiere valor")
            rows_to_persist.append(
                SolicitudInputValor(
                    input_def_id=input_def.id,
                    codigo_input=input_def.codigo_input,
                    tipo_input=input_def.tipo_input,
                    valor=None,
                    ruta_archivo=None,
                    metadata_json=None,
                    created_at=now,
                )
            )
            continue

        metadata: dict[str, Any] | None = None
        if input_def.tipo_input == "texto":
            if len(value) > TEXT_INPUT_MAX_LENGTH:
                raise ValueError(
                    f"El input {code} excede la longitud máxima permitida de {TEXT_INPUT_MAX_LENGTH} caracteres"
                )
        elif input_def.tipo_input == "periodo":
            if not PERIODO_PATTERN.fullmatch(value):
                raise ValueError(f"El input {code} debe tener formato YYYYMM")
            year = int(value[:4])
            month = int(value[4:])
            if month < 1 or month > 12:
                raise ValueError(f"El input {code} tiene un mes inválido")
            metadata = {"anio": year, "mes": month}
        else:
            raise ValueError(f"Tipo de input no soportado: {input_def.tipo_input}")

        rows_to_persist.append(
            SolicitudInputValor(
                input_def_id=input_def.id,
                codigo_input=input_def.codigo_input,
                tipo_input=input_def.tipo_input,
                valor=value,
                ruta_archivo=None,
                metadata_json=json.dumps(metadata, ensure_ascii=False) if metadata else None,
                created_at=now,
            )
        )

    estado_inicial = "EN_COLA"
    s = Solicitud(
        request_id=_new_request_id(),
        reporte_id=reporte.id,
        usuario=usuario,
        estado=estado_inicial,
        progreso=0,
        mensaje_estado="Solicitud multi-input registrada y en cola",
        ruta_input=None,
        parametros_json=json.dumps(payload.parametros, ensure_ascii=False),
        intentos=0,
        max_intentos=max(1, payload.max_intentos),
        fecha_solicitud=now,
        updated_at=now,
    )
    db.add(s)
    db.flush()

    for row in rows_to_persist:
        row.solicitud_id = s.id
        db.add(row)

    add_evento(db, s.id, "ESTADO", estado_inicial, "API")
    add_evento(db, s.id, "INFO", "Solicitud creada en modo multi_input", "API")
    db.commit()
    db.refresh(s)
    return s


def get_solicitud_input_valores(db: Session, solicitud_id: int) -> list[SolicitudInputValor]:
    query = (
        select(SolicitudInputValor)
        .options(selectinload(SolicitudInputValor.input_def))
        .where(SolicitudInputValor.solicitud_id == solicitud_id)
        .order_by(SolicitudInputValor.id.asc())
    )
    return list(db.execute(query).scalars().all())


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


def _db_dialect_name(db: Session) -> str:
    bind = db.get_bind()
    return getattr(getattr(bind, "dialect", None), "name", "") or ""


def take_next_job_atomically_oracle(
    db: Session,
    worker_id: str,
    lock_stale_seconds: int = 60,
) -> Solicitud | None:
    """
    Oracle-friendly: evita LIMIT 1 y mantiene el lock por REPORTE_ID.
    """
    max_attempts = 5

    for _ in range(max_attempts):
        cleanup_stale_reporte_locks(db, stale_after_seconds=lock_stale_seconds)
        db.commit()

        now = datetime.now(timezone.utc)
        alive_since = datetime.fromtimestamp(
            now.timestamp() - lock_stale_seconds,
            tz=timezone.utc,
        )

        row = db.execute(text("""
            SELECT s.ROWID AS rid, s.SOLICITUD_ID, s.REPORTE_ID
            FROM SOLICITUDES_REP_GCI s
            LEFT JOIN REPORTE_LOCKS_REP_GCI l
                ON l.REPORTE_ID = s.REPORTE_ID
               AND l.HEARTBEAT_AT >= :alive_since
            WHERE s.ESTADO IN ('EN_COLA', 'PENDIENTE_ADAPTACION_WORKER')
              AND l.REPORTE_ID IS NULL
            ORDER BY s.FECHA_SOLICITUD ASC, s.SOLICITUD_ID ASC
            FOR UPDATE SKIP LOCKED
        """), {"alive_since": alive_since}).first()

        if not row:
            db.rollback()
            return None

        rid = row.RID if hasattr(row, "RID") else row.rid
        solicitud_id = int(row.SOLICITUD_ID if hasattr(row, "SOLICITUD_ID") else row.solicitud_id)
        reporte_id = int(row.REPORTE_ID if hasattr(row, "REPORTE_ID") else row.reporte_id)

        if not try_acquire_reporte_lock(
            db=db,
            reporte_id=reporte_id,
            solicitud_id=solicitud_id,
            worker_id=worker_id,
        ):
            db.rollback()
            continue

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

        return db.execute(
            select(Solicitud).where(Solicitud.id == solicitud_id)
        ).scalar_one_or_none()

    db.rollback()
    return None

def take_next_job_atomically(db: Session, worker_id: str, lock_stale_seconds: int = 60) -> Solicitud | None:
    """
    MariaDB-friendly: Usa FOR UPDATE SKIP LOCKED (requiere MariaDB 10.6+)
    y reemplaza ROWID por la clave primaria.
    """
    if _db_dialect_name(db) == "oracle":
        return take_next_job_atomically_oracle(
            db=db,
            worker_id=worker_id,
            lock_stale_seconds=lock_stale_seconds,
        )

    max_attempts = 5

    for _ in range(max_attempts):
        cleanup_stale_reporte_locks(db, stale_after_seconds=lock_stale_seconds)
        db.commit()

        now = datetime.now(timezone.utc)
        alive_since = datetime.fromtimestamp(
            now.timestamp() - lock_stale_seconds,
            tz=timezone.utc,
        )

        row = db.execute(text("""
            SELECT s.SOLICITUD_ID, s.REPORTE_ID
            FROM SOLICITUDES_REP_GCI s
            LEFT JOIN REPORTE_LOCKS_REP_GCI l
                ON l.REPORTE_ID = s.REPORTE_ID
               AND l.HEARTBEAT_AT >= :alive_since
            WHERE s.ESTADO IN ('EN_COLA', 'PENDIENTE_ADAPTACION_WORKER')
              AND l.REPORTE_ID IS NULL
            ORDER BY s.FECHA_SOLICITUD ASC, s.SOLICITUD_ID ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        """), {"alive_since": alive_since}).first()

        if not row:
            db.rollback()
            return None

        solicitud_id = int(row.SOLICITUD_ID)
        reporte_id = int(row.REPORTE_ID)

        if not try_acquire_reporte_lock(
            db=db,
            reporte_id=reporte_id,
            solicitud_id=solicitud_id,
            worker_id=worker_id,
        ):
            db.rollback()
            continue

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

        return db.execute(
            select(Solicitud).where(Solicitud.id == solicitud_id)
        ).scalar_one_or_none()

    db.rollback()
    return None


def cleanup_stale_reporte_locks(db: Session, stale_after_seconds: int) -> int:
    alive_since = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() - stale_after_seconds,
        tz=timezone.utc,
    )
    result = db.execute(text("""
        DELETE FROM REPORTE_LOCKS_REP_GCI
        WHERE HEARTBEAT_AT < :alive_since
    """), {"alive_since": alive_since})
    return int(result.rowcount or 0)


def try_acquire_reporte_lock(
    db: Session,
    reporte_id: int,
    solicitud_id: int,
    worker_id: str,
) -> bool:
    now = datetime.now(timezone.utc)
    lock = ReporteLock(
        reporte_id=reporte_id,
        solicitud_id=solicitud_id,
        worker_id=worker_id,
        locked_at=now,
        heartbeat_at=now,
        updated_at=now,
    )
    try:
        db.add(lock)
        db.flush()
        return True
    except IntegrityError:
        return False


def touch_reporte_lock_heartbeat(
    db: Session,
    reporte_id: int,
    solicitud_id: int,
    worker_id: str,
) -> bool:
    now = datetime.now(timezone.utc)
    result = db.execute(text("""
        UPDATE REPORTE_LOCKS_REP_GCI
        SET HEARTBEAT_AT = :now,
            UPDATED_AT = :now
        WHERE REPORTE_ID = :reporte_id
          AND SOLICITUD_ID = :solicitud_id
          AND WORKER_ID = :worker_id
    """), {
        "now": now,
        "reporte_id": reporte_id,
        "solicitud_id": solicitud_id,
        "worker_id": worker_id,
    })
    return (result.rowcount or 0) == 1


def release_reporte_lock(
    db: Session,
    reporte_id: int,
    solicitud_id: int,
    worker_id: str,
) -> bool:
    result = db.execute(text("""
        DELETE FROM REPORTE_LOCKS_REP_GCI
        WHERE REPORTE_ID = :reporte_id
          AND SOLICITUD_ID = :solicitud_id
          AND WORKER_ID = :worker_id
    """), {
        "reporte_id": reporte_id,
        "solicitud_id": solicitud_id,
        "worker_id": worker_id,
    })
    return (result.rowcount or 0) == 1
