from contextlib import asynccontextmanager
from datetime import datetime, timezone, date
import json
from pathlib import Path
import re
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from sqlalchemy import select, delete, func, Table, MetaData, inspect, text
from sqlalchemy.exc import NoSuchTableError
from sqlalchemy.orm import Session
from sqlalchemy.sql.sqltypes import String, Text, Date, DateTime, Integer, Numeric, Float, Boolean

from .config import ensure_directory, resolve_project_path, settings
from .db import get_db
from .deps_auth import require_admin_rutas, get_current_user
from . import crud
from .schemas import (
    ArchivoInputDisponibleOut,
    HealthOut,
    ReporteInputsOut,
    ReporteInputArchivosOut,
    ReporteOut,
    ReporteCreate,
    SolicitudCreate,
    SolicitudCreateV2,
    SolicitudDetalleOut,
    SolicitudIntentoOut,
    SolicitudInputValorOut,
    SolicitudOut,
    SolicitudPageOut,
    EventoOut,
    TablaConsultaDisponibleOut,
    TableQueryIn,
    TableQueryOut,
)
from .schemas_admin import (
    CarpetaPermitidaCreate,
    CarpetaPermitidaOut,
    CarpetaPermitidaUpdate,
    InputCarpetaPermitidaCreate,
    InputCarpetaPermitidaOut,
    InputCarpetaPermitidaUpdate,
    ReporteAdminCreate,
    ReporteAdminOut,
    ReporteAdminPageOut,
    ReporteAdminUpdate,
    ReporteInputDefCreate,
    ReporteInputDefOut,
    ReporteInputDefUpdate,
    EquipoCreate,
    EquipoUpdate,
    EquipoOut,
    EquipoAsignacionIn,
    EquipoUsuariosAsignacionIn,
    EquipoReportesAsignacionIn,
    EquipoResumenOut,
    EquipoResumenDetalleOut,
    TablaConsultaAdminCreate,
    TablaConsultaAdminOut,
    TablaConsultaAdminPageOut,
    TablaConsultaAdminUpdate,
)
from .schemas_auth import UserCreateIn, UserCreateOut, UserOut, UserPasswordResetOut, UserRoleUpdateIn
from .init_db import init_db
from .models import (
    InputCarpetaPermitida,
    Solicitud,
    SolicitudInputValor,
    SolicitudEvento,
    Reporte,
    ReporteCarpetaPermitida,
    ReporteEquipo,
    ReporteInputDef,
    TablaConsultaPermitida,
    TablaConsultaEquipo,
)
from .models_auth import Usuario, Rol, UsuarioRol, Equipo, UsuarioEquipo
from .security import hash_password
from .routers.auth import router as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    ensure_directory(settings.WORKER_LOG_DIR, label="WORKER_LOG_DIR")
    ensure_directory(settings.WORKER_PAYLOAD_DIR, label="WORKER_PAYLOAD_DIR")
    init_db()
    yield
    # SHUTDOWN
    # (si más adelante necesitas cerrar recursos globales, va aquí)


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
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
INDEX_TEMPLATE_PATH = BASE_DIR / "templates" / "index.html"
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


def _render_index_html(app_version: str) -> str:
    html = INDEX_TEMPLATE_PATH.read_text(encoding="utf-8")
    return (
        html
        .replace("__APP_VERSION_URL__", quote(app_version, safe=""))
        .replace("__APP_VERSION_JSON__", json.dumps(app_version, ensure_ascii=False))
    )


@app.get("/", include_in_schema=False)
def home(_request: Request):
    return HTMLResponse(
        content=_render_index_html(settings.APP_VERSION),
        headers=NO_CACHE_HEADERS,
    )


@app.get("/version", tags=["health"])
def get_version(response: Response):
    response.headers.update(NO_CACHE_HEADERS)
    return {"version": settings.APP_VERSION}


@app.get("/health", response_model=HealthOut, tags=["health"])
def health(request: Request):
    return HealthOut(
        status="ok",
        service=settings.APP_NAME,
        utc_time=datetime.now(timezone.utc).isoformat(),
        client_ip=request.client.host if request.client else "unknown",
    )


def _split_columns(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [x.strip() for x in raw.split(";") if x and x.strip()]


def _normalize_json_example(raw: str | None) -> str | None:
    txt = (raw or "").strip()
    if not txt:
        return None

    try:
        parsed = json.loads(txt)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"parametros_ejemplo_json inválido: {e.msg}") from e

    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=422,
            detail="parametros_ejemplo_json debe ser un objeto JSON, no arreglo ni valor escalar",
        )

    return json.dumps(parsed, ensure_ascii=False, indent=2)


def _normalize_extensiones_input(raw: str | None) -> str | None:
    if raw is None:
        return None

    txt = raw.strip().lower()
    if not txt:
        return None

    normalized: list[str] = []
    seen: set[str] = set()
    for part in re.split(r"[;,]", txt):
        ext = part.strip().lstrip(".")
        if not ext:
            continue
        if not re.fullmatch(r"[a-z0-9]+", ext):
            raise HTTPException(status_code=422, detail="tipos_permitidos contiene extensiones inválidas")
        if ext not in seen:
            normalized.append(ext)
            seen.add(ext)

    return ";".join(normalized) if normalized else None


def _get_reporte_or_404(db: Session, reporte_id: int) -> Reporte:
    row = db.get(Reporte, reporte_id)
    if not row:
        raise HTTPException(status_code=404, detail="Reporte no existe")
    return row


def _get_input_def_or_404(db: Session, input_id: int) -> ReporteInputDef:
    row = db.get(ReporteInputDef, input_id)
    if not row:
        raise HTTPException(status_code=404, detail="Input del reporte no existe")
    return row


def _get_input_carpeta_or_404(db: Session, carpeta_id: int) -> InputCarpetaPermitida:
    row = db.get(InputCarpetaPermitida, carpeta_id)
    if not row:
        raise HTTPException(status_code=404, detail="Carpeta permitida del input no existe")
    return row


def _require_input_tipo_archivo(input_def: ReporteInputDef) -> None:
    if input_def.tipo_input != "archivo":
        raise HTTPException(status_code=400, detail="La operación solo aplica a inputs de tipo archivo")


def _parse_table_identifier(raw: str) -> tuple[str | None, str]:
    """
    Admite identificadores en formato:
    - TABLA
    - ESQUEMA.TABLA
    """
    value = (raw or "").strip()
    if not value:
        raise ValueError("TABLA_BD no puede estar vacío")

    parts = [p.strip() for p in value.split(".")]
    if len(parts) == 1:
        return None, parts[0]
    if len(parts) == 2 and all(parts):
        return parts[0], parts[1]
    raise ValueError("TABLA_BD debe tener formato TABLA o ESQUEMA.TABLA")


def _oracle_sa_normalize_identifier(name: str | None, bind: Any) -> str | None:
    """
    Oracle + SQLAlchemy normaliza identificadores no quoted en minúscula.
    Si recibimos nombres en MAYÚSCULA (convención Oracle), pasamos a minúscula
    para reflexión y lookups del Inspector/Table.
    """
    if not name:
        return name
    if getattr(bind.dialect, "name", "") != "oracle":
        return name
    stripped = name.strip()
    if not stripped:
        return stripped
    if stripped.isupper():
        return stripped.lower()
    return stripped


def _column_key(name: str) -> str:
    """
    Llave de comparación de columnas tolerante a:
    - mayúsculas/minúsculas
    - comillas dobles alrededor
    - espacios extras
    """
    return name.strip().strip('"').upper()


def _is_admin_user(current_user: dict[str, Any]) -> bool:
    return "ADMIN" in current_user["roles"] or current_user["username"] == "admin"


def _user_has_reporte_access(db: Session, reporte_id: int, current_user: dict[str, Any]) -> bool:
    if _is_admin_user(current_user):
        return True

    allowed = db.execute(
        select(ReporteEquipo.id)
        .join(UsuarioEquipo, UsuarioEquipo.equipo_id == ReporteEquipo.equipo_id)
        .join(Equipo, Equipo.id == ReporteEquipo.equipo_id)
        .where(
            ReporteEquipo.reporte_id == reporte_id,
            Equipo.activo == 1,
            ReporteEquipo.activo == 1,
            UsuarioEquipo.usuario_id == current_user["id"],
            UsuarioEquipo.activo == 1,
        )
    ).first()
    return allowed is not None


def _require_reporte_access(db: Session, reporte: Reporte, current_user: dict[str, Any]) -> None:
    if not _user_has_reporte_access(db, reporte.id, current_user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este reporte por equipo")


def _require_solicitud_access(solicitud: Solicitud, current_user: dict[str, Any], detail: str) -> None:
    if _is_admin_user(current_user):
        return
    if current_user["username"] != solicitud.usuario:
        raise HTTPException(status_code=403, detail=detail)


def _parse_json_object(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _build_solicitud_out(s: Solicitud, rep: Reporte | None, fallback_codigo: str) -> SolicitudOut:
    return SolicitudOut(
        request_id=s.request_id,
        reporte_codigo=rep.codigo if rep else fallback_codigo,
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


def _build_solicitud_input_out_rows(
    db: Session,
    input_rows: list[SolicitudInputValor],
) -> list[SolicitudInputValorOut]:
    if not input_rows:
        return []

    input_def_ids = sorted({row.input_def_id for row in input_rows})
    defs = db.execute(
        select(ReporteInputDef).where(ReporteInputDef.id.in_(input_def_ids))
    ).scalars().all()
    defs_by_id = {row.id: row for row in defs}

    out: list[SolicitudInputValorOut] = []
    for row in input_rows:
        input_def = defs_by_id.get(row.input_def_id)
        metadata = _parse_json_object(row.metadata_json)
        out.append(
            SolicitudInputValorOut(
                codigo_input=row.codigo_input,
                nombre_visible=input_def.nombre_visible if input_def else row.codigo_input,
                tipo_input=row.tipo_input,
                obligatorio=input_def.obligatorio if input_def else 0,
                valor=row.valor,
                ruta_archivo=row.ruta_archivo,
                metadata=metadata or None,
            )
        )
    return out


def _resolve_runtime_dir(raw_dir: str) -> Path:
    return resolve_project_path(raw_dir)


def _display_runtime_path(path: Path | None) -> str | None:
    if not path:
        return None
    try:
        return str(path.resolve().relative_to(BASE_DIR.parent.resolve()))
    except ValueError:
        return str(path.resolve())


def _safe_int(raw: str | None) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _safe_float(raw: str | None) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _safe_bool(raw: str | None) -> bool | None:
    if raw is None:
        return None
    normalized = str(raw).strip().lower()
    if normalized in {"true", "1", "yes", "si"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    return None


def _tail_text(raw: str | None, max_lines: int = 18, max_chars: int = 1600) -> str | None:
    if not raw:
        return None
    lines = [line.rstrip() for line in str(raw).splitlines()]
    if len(lines) > max_lines:
        lines = lines[-max_lines:]
    text = "\n".join(lines).strip()
    if len(text) > max_chars:
        text = f"...{text[-max_chars:]}"
    return text or None


def _parse_request_log_file(path: Path) -> dict[str, Any]:
    meta: dict[str, str] = {}
    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    worker_error_lines: list[str] = []
    section: str | None = None

    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return {}

    for line in lines:
        if line == "=== STDOUT ===":
            section = "stdout"
            continue
        if line == "=== STDERR ===":
            section = "stderr"
            continue
        if line == "=== WORKER_ERROR ===":
            section = "worker_error"
            continue

        if section == "stdout":
            stdout_lines.append(line)
            continue
        if section == "stderr":
            stderr_lines.append(line)
            continue
        if section == "worker_error":
            worker_error_lines.append(line)
            continue

        if "=" in line:
            key, value = line.split("=", 1)
            meta[key.strip()] = value.strip()

    return {
        "meta": meta,
        "stdout": "\n".join(stdout_lines).strip(),
        "stderr": "\n".join(stderr_lines).strip(),
        "worker_error": "\n".join(worker_error_lines).strip(),
    }


def _collect_request_attempt_artifacts(
    request_id: str,
    include_sensitive: bool,
) -> list[SolicitudIntentoOut]:
    pattern = re.compile(rf"^{re.escape(request_id)}(?:__try_(\d+))?\.log$", re.IGNORECASE)
    log_dir = _resolve_runtime_dir(settings.WORKER_LOG_DIR)
    payload_dir = _resolve_runtime_dir(settings.WORKER_PAYLOAD_DIR)

    logs_by_attempt: dict[int, Path] = {}
    if log_dir.exists():
        for path in log_dir.iterdir():
            if not path.is_file():
                continue
            match = pattern.fullmatch(path.name)
            if not match:
                continue
            attempt = int(match.group(1) or 1)
            current = logs_by_attempt.get(attempt)
            if current is None or "__try_" in path.name:
                logs_by_attempt[attempt] = path

    payload_pattern = re.compile(rf"^{re.escape(request_id)}(?:__try_(\d+))?\.json$", re.IGNORECASE)
    payloads_by_attempt: dict[int, Path] = {}
    if payload_dir.exists():
        for path in payload_dir.iterdir():
            if not path.is_file():
                continue
            match = payload_pattern.fullmatch(path.name)
            if not match:
                continue
            attempt = int(match.group(1) or 1)
            current = payloads_by_attempt.get(attempt)
            if current is None or "__try_" in path.name:
                payloads_by_attempt[attempt] = path

    attempts: list[SolicitudIntentoOut] = []
    for attempt in sorted(set(logs_by_attempt) | set(payloads_by_attempt)):
        log_path = logs_by_attempt.get(attempt)
        parsed = _parse_request_log_file(log_path) if log_path else {}
        meta = parsed.get("meta", {})

        payload_path = payloads_by_attempt.get(attempt)
        payload_path_raw = meta.get("payload_path")
        if payload_path is None and payload_path_raw:
            candidate = Path(payload_path_raw)
            if not candidate.is_absolute():
                candidate = (BASE_DIR.parent / candidate).resolve()
            try:
                if candidate.is_file() and candidate.resolve().is_relative_to(payload_dir):
                    payload_path = candidate
            except ValueError:
                payload_path = None

        payload_preview: dict[str, Any] | None = None
        if include_sensitive and payload_path and payload_path.is_file():
            try:
                parsed_payload = json.loads(payload_path.read_text(encoding="utf-8", errors="replace"))
                if isinstance(parsed_payload, dict):
                    payload_preview = parsed_payload
            except (OSError, json.JSONDecodeError):
                payload_preview = None

        returncode = _safe_int(meta.get("returncode"))
        timed_out = _safe_bool(meta.get("timed_out"))
        worker_error = parsed.get("worker_error") or None
        if worker_error:
            estado_resultado = "worker_error"
        elif returncode == 0 and timed_out is not True:
            estado_resultado = "ok"
        elif returncode is not None or timed_out:
            estado_resultado = "error"
        else:
            estado_resultado = "sin_resultado"

        attempts.append(
            SolicitudIntentoOut(
                intento=attempt,
                modo_inputs=meta.get("mode"),
                input_count=_safe_int(meta.get("input_count")),
                estado_resultado=estado_resultado,
                log_path=_display_runtime_path(log_path) if include_sensitive else None,
                payload_path=_display_runtime_path(payload_path) if include_sensitive else None,
                comando=meta.get("command") if include_sensitive else None,
                duration_sec=_safe_float(meta.get("duration_sec")),
                timed_out=timed_out,
                returncode=returncode,
                stdout_tail=_tail_text(parsed.get("stdout")) if include_sensitive else None,
                stderr_tail=_tail_text(parsed.get("stderr")) if include_sensitive else None,
                worker_error=worker_error if include_sensitive else None,
                payload_preview=payload_preview,
            )
        )

    return attempts


def _get_reporte_carpetas_activas(db: Session, reporte_id: int) -> list[ReporteCarpetaPermitida]:
    return db.execute(
        select(ReporteCarpetaPermitida).where(
            ReporteCarpetaPermitida.reporte_id == reporte_id,
            ReporteCarpetaPermitida.activo == 1,
        )
    ).scalars().all()


def _validate_legacy_ruta_input(
    db: Session,
    rep: Reporte,
    ruta_input: str | None,
) -> str | None:
    ruta = (ruta_input or "").strip()
    if not ruta:
        return None

    allowed = {x.strip().lower() for x in (rep.tipos_permitidos or "").split(";") if x.strip()}
    if not allowed:
        allowed = {"csv", "xlsx"}

    ext = Path(ruta).suffix.lower().lstrip(".")
    if ext not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Extensión no permitida para ruta_input: .{ext or '?'}. Permitidas: {sorted(allowed)}",
        )

    carpetas = _get_reporte_carpetas_activas(db, rep.id)
    if not carpetas:
        raise HTTPException(
            status_code=400,
            detail="El reporte no tiene carpetas permitidas activas para validar ruta_input",
        )

    if not any(crud.is_path_under_base(ruta, carpeta.ruta_base) for carpeta in carpetas):
        raise HTTPException(
            status_code=400,
            detail="La ruta_input enviada no pertenece a una carpeta permitida activa del reporte",
        )

    path_obj = Path(ruta)
    try:
        exists_at_validation = path_obj.exists()
    except OSError:
        exists_at_validation = False

    if not exists_at_validation:
        raise HTTPException(status_code=400, detail="La ruta_input enviada no existe o no es accesible")

    try:
        is_file = path_obj.is_file()
    except OSError:
        is_file = False

    if not is_file:
        raise HTTPException(status_code=400, detail="La ruta_input enviada no corresponde a un archivo")

    return ruta


def _serialize_user_out(db: Session, user: Usuario) -> UserOut:
    roles = _get_user_role_names(db, user.id)
    return UserOut(
        id=user.id,
        username=user.username,
        activo=user.activo,
        roles=roles,
    )


def _get_user_role_names(db: Session, user_id: int) -> list[str]:
    role_rows = db.execute(
        select(Rol.nombre)
        .join(UsuarioRol, UsuarioRol.rol_id == Rol.id)
        .where(UsuarioRol.usuario_id == user_id)
        .order_by(Rol.nombre.asc())
    ).all()
    return [r[0] for r in role_rows]


def _list_role_names(db: Session) -> list[str]:
    return db.execute(
        select(Rol.nombre).order_by(Rol.nombre.asc())
    ).scalars().all()


def _count_active_admin_users(db: Session) -> int:
    return db.execute(
        select(func.count(func.distinct(Usuario.id)))
        .join(UsuarioRol, UsuarioRol.usuario_id == Usuario.id)
        .join(Rol, Rol.id == UsuarioRol.rol_id)
        .where(
            Usuario.activo == 1,
            Rol.nombre == "ADMIN",
        )
    ).scalar_one()


def _get_equipo_or_404(db: Session, equipo_id: int) -> Equipo:
    equipo = db.get(Equipo, equipo_id)
    if not equipo:
        raise HTTPException(status_code=404, detail="Equipo no existe")
    return equipo


def _require_active_equipo(equipo: Equipo) -> None:
    if equipo.activo != 1:
        raise HTTPException(status_code=400, detail="El equipo no existe o está inactivo")


def _build_equipo_resumen_query():
    return (
        select(
            Equipo.id.label("id"),
            Equipo.nombre.label("nombre"),
            Equipo.activo.label("activo"),
            func.count(func.distinct(UsuarioEquipo.usuario_id)).label("usuarios_count"),
            func.count(func.distinct(ReporteEquipo.reporte_id)).label("reportes_count"),
        )
        .outerjoin(
            UsuarioEquipo,
            (UsuarioEquipo.equipo_id == Equipo.id) & (UsuarioEquipo.activo == 1),
        )
        .outerjoin(
            ReporteEquipo,
            (ReporteEquipo.equipo_id == Equipo.id) & (ReporteEquipo.activo == 1),
        )
        .group_by(Equipo.id, Equipo.nombre, Equipo.activo)
    )


def _resolve_allowed_tabla(
    db: Session,
    tabla_id: int,
    current_user: dict[str, Any],
) -> TablaConsultaPermitida | None:
    if _is_admin_user(current_user):
        return db.get(TablaConsultaPermitida, tabla_id)

    return db.execute(
        select(TablaConsultaPermitida)
        .join(TablaConsultaEquipo, TablaConsultaEquipo.tabla_id == TablaConsultaPermitida.id)
        .join(Equipo, Equipo.id == TablaConsultaEquipo.equipo_id)
        .join(UsuarioEquipo, UsuarioEquipo.equipo_id == TablaConsultaEquipo.equipo_id)
        .where(
            TablaConsultaPermitida.id == tabla_id,
            TablaConsultaPermitida.activo == 1,
            Equipo.activo == 1,
            TablaConsultaEquipo.activo == 1,
            UsuarioEquipo.activo == 1,
            UsuarioEquipo.usuario_id == current_user["id"],
        )
    ).scalar_one_or_none()


def _column_kind(col_type: Any) -> str:
    if isinstance(col_type, (String, Text)):
        return "str"
    if isinstance(col_type, (Integer, Numeric, Float)):
        return "num"
    if isinstance(col_type, (DateTime, Date)):
        return "date"
    if isinstance(col_type, Boolean):
        return "bool"
    return "str"


def _parse_filter_value(raw: Any, col_type: Any) -> Any:
    kind = _column_kind(col_type)
    if raw is None:
        return None

    if kind == "num":
        if isinstance(raw, (int, float)):
            return raw
        try:
            text = str(raw).strip()
            return float(text) if "." in text else int(text)
        except Exception as e:
            raise ValueError(f"Valor numérico inválido: {raw!r}") from e

    if kind == "bool":
        if isinstance(raw, bool):
            return raw
        txt = str(raw).strip().lower()
        if txt in {"1", "true", "t", "yes", "y"}:
            return True
        if txt in {"0", "false", "f", "no", "n"}:
            return False
        raise ValueError(f"Valor booleano inválido: {raw!r}")

    if kind == "date":
        if isinstance(raw, (datetime, date)):
            return raw
        txt = str(raw).strip()
        try:
            if "T" in txt:
                return datetime.fromisoformat(txt)
            return date.fromisoformat(txt)
        except Exception as e:
            raise ValueError(f"Valor de fecha inválido: {raw!r}. Use YYYY-MM-DD o ISO datetime.") from e

    return str(raw)


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
        .join(Equipo, Equipo.id == ReporteEquipo.equipo_id)
        .join(UsuarioEquipo, UsuarioEquipo.equipo_id == ReporteEquipo.equipo_id)
        .where(
            Reporte.activo == 1,
            Equipo.activo == 1,
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
    data = payload.model_dump()
    data["parametros_ejemplo_json"] = _normalize_json_example(payload.parametros_ejemplo_json)
    return crud.create_reporte(db, data)


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
        parametros_ejemplo_json=_normalize_json_example(payload.parametros_ejemplo_json),
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

    if payload.parametros_ejemplo_json is not None:
        row.parametros_ejemplo_json = _normalize_json_example(payload.parametros_ejemplo_json)

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


@app.get("/admin/reportes/{reporte_id}/inputs", response_model=list[ReporteInputDefOut], tags=["admin"])
def list_reporte_inputs_admin(
    reporte_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    _get_reporte_or_404(db, reporte_id)
    return db.execute(
        select(ReporteInputDef)
        .where(ReporteInputDef.reporte_id == reporte_id)
        .order_by(ReporteInputDef.orden.asc(), ReporteInputDef.id.asc())
    ).scalars().all()


@app.post("/admin/reportes/{reporte_id}/inputs", response_model=ReporteInputDefOut, tags=["admin"])
def create_reporte_input_admin(
    reporte_id: int,
    payload: ReporteInputDefCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    _get_reporte_or_404(db, reporte_id)

    dup = db.execute(
        select(ReporteInputDef).where(
            ReporteInputDef.reporte_id == reporte_id,
            ReporteInputDef.codigo_input == payload.codigo_input,
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail="Ya existe un input con ese codigo_input para este reporte")

    now = datetime.now(timezone.utc)
    row = ReporteInputDef(
        reporte_id=reporte_id,
        codigo_input=payload.codigo_input,
        nombre_visible=payload.nombre_visible,
        tipo_input=payload.tipo_input,
        obligatorio=payload.obligatorio,
        orden=payload.orden,
        activo=payload.activo,
        tipos_permitidos=_normalize_extensiones_input(payload.tipos_permitidos) if payload.tipo_input == "archivo" else None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/admin/reportes/inputs/{input_id}", response_model=ReporteInputDefOut, tags=["admin"])
def update_reporte_input_admin(
    input_id: int,
    payload: ReporteInputDefUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    row = _get_input_def_or_404(db, input_id)
    payload_fields = payload.model_fields_set

    if payload.nombre_visible is not None:
        row.nombre_visible = payload.nombre_visible

    if payload.tipo_input is not None:
        row.tipo_input = payload.tipo_input
        if payload.tipo_input != "archivo" and "tipos_permitidos" not in payload_fields:
            row.tipos_permitidos = None

    if payload.obligatorio is not None:
        row.obligatorio = payload.obligatorio

    if payload.orden is not None:
        row.orden = payload.orden

    if payload.activo is not None:
        row.activo = payload.activo

    if "tipos_permitidos" in payload_fields:
        if row.tipo_input != "archivo":
            row.tipos_permitidos = None
        else:
            row.tipos_permitidos = _normalize_extensiones_input(payload.tipos_permitidos)
    elif row.tipo_input != "archivo":
        row.tipos_permitidos = None

    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.delete("/admin/reportes/inputs/{input_id}", response_model=ReporteInputDefOut, tags=["admin"])
def delete_reporte_input_admin(
    input_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    row = _get_input_def_or_404(db, input_id)
    row.activo = 0
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.get("/admin/reportes/inputs/{input_id}/carpetas", response_model=list[InputCarpetaPermitidaOut], tags=["admin"])
def list_input_carpetas_admin(
    input_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    input_def = _get_input_def_or_404(db, input_id)
    _require_input_tipo_archivo(input_def)
    return db.execute(
        select(InputCarpetaPermitida)
        .where(InputCarpetaPermitida.input_def_id == input_id)
        .order_by(InputCarpetaPermitida.id.asc())
    ).scalars().all()


@app.post("/admin/reportes/inputs/{input_id}/carpetas", response_model=InputCarpetaPermitidaOut, tags=["admin"])
def create_input_carpeta_admin(
    input_id: int,
    payload: InputCarpetaPermitidaCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    input_def = _get_input_def_or_404(db, input_id)
    _require_input_tipo_archivo(input_def)

    dup = db.execute(
        select(InputCarpetaPermitida).where(
            InputCarpetaPermitida.input_def_id == input_id,
            InputCarpetaPermitida.ruta_base == payload.ruta_base,
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail="La ruta ya está registrada para este input")

    row = InputCarpetaPermitida(
        input_def_id=input_id,
        ruta_base=payload.ruta_base,
        activo=1,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/admin/reportes/inputs/carpetas/{carpeta_id}", response_model=InputCarpetaPermitidaOut, tags=["admin"])
def update_input_carpeta_admin(
    carpeta_id: int,
    payload: InputCarpetaPermitidaUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    row = _get_input_carpeta_or_404(db, carpeta_id)

    if payload.ruta_base is not None:
        dup = db.execute(
            select(InputCarpetaPermitida).where(
                InputCarpetaPermitida.input_def_id == row.input_def_id,
                InputCarpetaPermitida.ruta_base == payload.ruta_base,
                InputCarpetaPermitida.id != carpeta_id,
            )
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="La ruta ya está registrada para este input")
        row.ruta_base = payload.ruta_base

    if payload.activo is not None:
        row.activo = payload.activo

    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.get("/reportes/{codigo}/inputs", response_model=ReporteInputsOut, tags=["reportes"])
def get_reporte_inputs(
    codigo: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rep = crud.get_reporte_by_codigo(db, codigo)
    if not rep or rep.activo != 1:
        raise HTTPException(status_code=404, detail="Reporte no existe o inactivo")

    _require_reporte_access(db, rep, current_user)

    input_defs = crud.get_reporte_input_defs(db, rep.id, only_active=False)
    modo_inputs = "multi_input" if input_defs else "legacy"
    visible_inputs = [row for row in input_defs if row.activo == 1] if modo_inputs == "multi_input" else []

    return ReporteInputsOut(
        reporte_codigo=rep.codigo,
        modo_inputs=modo_inputs,
        inputs=visible_inputs,
    )


@app.get("/reportes/{codigo}/inputs/{codigo_input}/archivos", response_model=ReporteInputArchivosOut, tags=["reportes"])
def list_archivos_input_definido(
    codigo: str,
    codigo_input: str,
    max_items: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rep = crud.get_reporte_by_codigo(db, codigo)
    if not rep or rep.activo != 1:
        raise HTTPException(status_code=404, detail="Reporte no existe o inactivo")

    _require_reporte_access(db, rep, current_user)

    input_defs = crud.get_reporte_input_defs(db, rep.id, only_active=False)
    if not input_defs:
        raise HTTPException(status_code=400, detail="El reporte opera en modo legacy y no expone inputs definidos")

    input_def = crud.get_reporte_input_def_by_codigo(db, rep.id, codigo_input, only_active=False)
    if not input_def:
        raise HTTPException(status_code=404, detail="Input no existe para este reporte")
    if input_def.activo != 1:
        raise HTTPException(status_code=400, detail="El input solicitado está inactivo")
    if input_def.tipo_input != "archivo":
        raise HTTPException(status_code=400, detail="El input solicitado no es de tipo archivo")

    archivos = crud.list_files_for_input(db, input_def, max_items=max_items)
    return ReporteInputArchivosOut(
        reporte_codigo=rep.codigo,
        codigo_input=input_def.codigo_input,
        archivos=[ArchivoInputDisponibleOut(**row) for row in archivos],
    )


@app.post("/solicitudes", response_model=SolicitudOut, tags=["solicitudes"])
def create_solicitud(
    payload: SolicitudCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rep = crud.get_reporte_by_codigo(db, payload.reporte_codigo)
    if not rep or rep.activo != 1:
        raise HTTPException(status_code=404, detail="Reporte no existe o inactivo")

    _require_reporte_access(db, rep, current_user)
    ruta_input = _validate_legacy_ruta_input(db, rep, payload.ruta_input)
    payload = payload.model_copy(update={
        "usuario": current_user["username"],
        "ruta_input": ruta_input,
    })

    try:
        s = crud.create_solicitud(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    rep = db.get(Reporte, s.reporte_id)
    return _build_solicitud_out(s, rep, payload.reporte_codigo)


@app.post("/solicitudes-v2", response_model=SolicitudOut, tags=["solicitudes"])
def create_solicitud_v2(
    payload: SolicitudCreateV2,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rep = crud.get_reporte_by_codigo(db, payload.reporte_codigo)
    if not rep or rep.activo != 1:
        raise HTTPException(status_code=404, detail="Reporte no existe o inactivo")

    _require_reporte_access(db, rep, current_user)

    input_defs = crud.get_reporte_input_defs(db, rep.id, only_active=False)
    if not input_defs:
        raise HTTPException(
            status_code=400,
            detail="El reporte no tiene definiciones de input. Usa POST /solicitudes para el modo legacy",
        )

    try:
        s = crud.create_solicitud_multi_input(
            db=db,
            reporte=rep,
            usuario=current_user["username"],
            payload=payload,
            input_defs=input_defs,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    rep = db.get(Reporte, s.reporte_id)
    return _build_solicitud_out(s, rep, payload.reporte_codigo)


@app.get("/solicitudes/{request_id}", response_model=SolicitudOut, tags=["solicitudes"])
def get_solicitud(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    s = crud.get_solicitud_by_request_id(db, request_id)
    if not s:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    _require_solicitud_access(s, current_user, "No tienes acceso a esta solicitud")

    rep = db.get(Reporte, s.reporte_id)
    return _build_solicitud_out(s, rep, "UNKNOWN")


@app.get("/solicitudes/{request_id}/detalle", response_model=SolicitudDetalleOut, tags=["solicitudes"])
def get_solicitud_detalle(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    s = crud.get_solicitud_by_request_id(db, request_id)
    if not s:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    _require_solicitud_access(s, current_user, "No tienes acceso al detalle de esta solicitud")

    rep = db.get(Reporte, s.reporte_id)
    input_rows = crud.get_solicitud_input_valores(db, s.id)
    modo_inputs = "multi_input" if input_rows else "legacy"
    base = _build_solicitud_out(s, rep, "UNKNOWN")
    include_sensitive = _is_admin_user(current_user)
    intentos_detalle = _collect_request_attempt_artifacts(s.request_id, include_sensitive=include_sensitive)
    intentos_registrados = max(len(intentos_detalle), s.intentos or 0)
    if intentos_registrados == 0 and s.estado == "EJECUTANDO":
        intentos_registrados = 1
    intento_actual_o_ultimo: int | None = None
    if intentos_detalle:
        intento_actual_o_ultimo = intentos_detalle[-1].intento
    elif s.estado == "EJECUTANDO":
        intento_actual_o_ultimo = max(1, (s.intentos or 0) + 1)
    elif (s.intentos or 0) > 0:
        intento_actual_o_ultimo = s.intentos

    ultimo_intento = intentos_detalle[-1] if intentos_detalle else None

    return SolicitudDetalleOut(
        **base.model_dump(),
        modo_inputs=modo_inputs,
        ruta_input_legacy=s.ruta_input,
        parametros=_parse_json_object(s.parametros_json),
        inputs_enviados=_build_solicitud_input_out_rows(db, input_rows),
        intentos_registrados=intentos_registrados,
        max_intentos=max(1, s.max_intentos or 1),
        intento_actual_o_ultimo=intento_actual_o_ultimo,
        log_path_ultimo=ultimo_intento.log_path if ultimo_intento else None,
        payload_path_ultimo=ultimo_intento.payload_path if ultimo_intento else None,
        comando_ultimo=ultimo_intento.comando if ultimo_intento else None,
        intentos_detalle=intentos_detalle,
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
    current_user: dict = Depends(get_current_user),
):
    usuario_norm = usuario.strip()
    if not _is_admin_user(current_user):
        usuario_norm = current_user["username"]
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
def solicitud_eventos(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    s = crud.get_solicitud_by_request_id(db, request_id)
    if not s:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    _require_solicitud_access(s, current_user, "No tienes acceso a los eventos de esta solicitud")

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
    current_user: dict = Depends(get_current_user),
):
    rep = crud.get_reporte_by_codigo(db, codigo)
    if not rep or rep.activo != 1:
        raise HTTPException(status_code=404, detail="Reporte no existe o inactivo")

    _require_reporte_access(db, rep, current_user)
    
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
    return [_serialize_user_out(db, user) for user in users]


@app.get("/admin/roles", response_model=list[str], tags=["admin"])
def list_roles_admin(
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    return _list_role_names(db)


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


@app.patch("/admin/usuarios/{usuario_id}/rol", response_model=UserOut, tags=["admin"])
def update_usuario_role(
    usuario_id: int,
    payload: UserRoleUpdateIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_rutas),
):
    user = db.get(Usuario, usuario_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no existe")

    requested_role = payload.rol.strip().upper()
    if not requested_role:
        raise HTTPException(status_code=400, detail="Rol inválido")

    role = db.execute(
        select(Rol).where(Rol.nombre == requested_role)
    ).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=400, detail=f"Rol inválido: {requested_role}")

    current_roles = _get_user_role_names(db, user.id)
    if current_user["id"] == user.id and requested_role != "ADMIN":
        raise HTTPException(
            status_code=400,
            detail="No puedes quitarte a ti mismo el rol de administrador desde esta pantalla",
        )

    if (
        user.activo == 1
        and "ADMIN" in current_roles
        and requested_role != "ADMIN"
        and _count_active_admin_users(db) <= 1
    ):
        raise HTTPException(
            status_code=400,
            detail="Debe existir al menos un usuario admin activo en el sistema",
        )

    if len(current_roles) == 1 and current_roles[0] == requested_role:
        return _serialize_user_out(db, user)

    db.execute(delete(UsuarioRol).where(UsuarioRol.usuario_id == user.id))
    db.flush()
    db.add(UsuarioRol(usuario_id=user.id, rol_id=role.id))
    db.commit()
    db.refresh(user)
    return _serialize_user_out(db, user)


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


@app.get("/admin/equipos/resumen", response_model=list[EquipoResumenOut], tags=["admin"])
def list_equipos_resumen(
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    rows = db.execute(
        _build_equipo_resumen_query().order_by(Equipo.nombre.asc())
    ).all()
    return [
        EquipoResumenOut(
            id=row.id,
            nombre=row.nombre,
            activo=row.activo,
            usuarios_count=row.usuarios_count,
            reportes_count=row.reportes_count,
        )
        for row in rows
    ]


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


@app.get("/admin/equipos/{equipo_id}/usuarios", response_model=list[UserOut], tags=["admin"])
def get_usuarios_equipo(
    equipo_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    _get_equipo_or_404(db, equipo_id)
    users = db.execute(
        select(Usuario)
        .join(UsuarioEquipo, UsuarioEquipo.usuario_id == Usuario.id)
        .where(UsuarioEquipo.equipo_id == equipo_id, UsuarioEquipo.activo == 1)
        .order_by(Usuario.username.asc())
    ).scalars().all()
    return [_serialize_user_out(db, user) for user in users]


@app.put("/admin/equipos/{equipo_id}/usuarios", tags=["admin"])
def set_usuarios_equipo(
    equipo_id: int,
    payload: EquipoUsuariosAsignacionIn,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    _get_equipo_or_404(db, equipo_id)

    ids = sorted(set(payload.usuario_ids))
    if ids:
        found = db.execute(select(Usuario.id).where(Usuario.id.in_(ids))).scalars().all()
        if len(found) != len(ids):
            raise HTTPException(status_code=400, detail="Uno o más usuarios no existen")

    db.execute(delete(UsuarioEquipo).where(UsuarioEquipo.equipo_id == equipo_id))
    for usuario_id in ids:
        db.add(UsuarioEquipo(usuario_id=usuario_id, equipo_id=equipo_id, activo=1))
    db.commit()
    return {"detail": "Usuarios del equipo actualizados correctamente"}


@app.get("/admin/equipos/{equipo_id}/reportes", response_model=list[ReporteAdminOut], tags=["admin"])
def get_reportes_equipo(
    equipo_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    _get_equipo_or_404(db, equipo_id)
    return db.execute(
        select(Reporte)
        .join(ReporteEquipo, ReporteEquipo.reporte_id == Reporte.id)
        .where(ReporteEquipo.equipo_id == equipo_id, ReporteEquipo.activo == 1)
        .order_by(Reporte.codigo.asc())
    ).scalars().all()


@app.put("/admin/equipos/{equipo_id}/reportes", tags=["admin"])
def set_reportes_equipo(
    equipo_id: int,
    payload: EquipoReportesAsignacionIn,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    _get_equipo_or_404(db, equipo_id)

    ids = sorted(set(payload.reporte_ids))
    if ids:
        found = db.execute(select(Reporte.id).where(Reporte.id.in_(ids))).scalars().all()
        if len(found) != len(ids):
            raise HTTPException(status_code=400, detail="Uno o más reportes no existen")

    db.execute(delete(ReporteEquipo).where(ReporteEquipo.equipo_id == equipo_id))
    for reporte_id in ids:
        db.add(ReporteEquipo(reporte_id=reporte_id, equipo_id=equipo_id, activo=1))
    db.commit()
    return {"detail": "Reportes del equipo actualizados correctamente"}


@app.get("/admin/equipos/{equipo_id}/resumen", response_model=EquipoResumenDetalleOut, tags=["admin"])
def get_equipo_resumen(
    equipo_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    equipo = _get_equipo_or_404(db, equipo_id)
    row = db.execute(
        _build_equipo_resumen_query().where(Equipo.id == equipo_id)
    ).one()
    return EquipoResumenDetalleOut(
        equipo=equipo,
        usuarios_count=row.usuarios_count,
        reportes_count=row.reportes_count,
    )


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
        found = db.execute(select(Equipo.id).where(Equipo.id.in_(ids))).scalars().all()
        if len(found) != len(ids):
            raise HTTPException(status_code=400, detail="Uno o más equipos no existen")

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


@app.get("/admin/tablas-consulta", response_model=TablaConsultaAdminPageOut, tags=["admin"])
def list_tablas_consulta_admin(
    q: str = Query("", max_length=200),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=500),
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    q_norm = (q or "").strip().upper()
    query = select(TablaConsultaPermitida)
    if q_norm:
        query = query.where(
            func.upper(TablaConsultaPermitida.codigo).like(f"%{q_norm}%")
            | func.upper(TablaConsultaPermitida.nombre).like(f"%{q_norm}%")
            | func.upper(TablaConsultaPermitida.tabla_bd).like(f"%{q_norm}%")
        )

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    total_pages = max(1, (total + page_size - 1) // page_size)
    page_safe = min(page, total_pages) if total > 0 else 1
    offset = (page_safe - 1) * page_size

    items = db.execute(
        query.order_by(TablaConsultaPermitida.codigo.asc()).offset(offset).limit(page_size)
    ).scalars().all()

    return TablaConsultaAdminPageOut(
        items=items,
        total=total,
        page=page_safe,
        page_size=page_size,
        total_pages=total_pages,
    )


@app.post("/admin/tablas-consulta", response_model=TablaConsultaAdminOut, tags=["admin"])
def create_tabla_consulta_admin(
    payload: TablaConsultaAdminCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    codigo = payload.codigo.strip().upper()
    nombre = payload.nombre.strip()
    tabla_bd = payload.tabla_bd.strip()
    columnas_permitidas = payload.columnas_permitidas.strip()
    columnas_resultado = payload.columnas_resultado.strip() if payload.columnas_resultado else None

    if not _split_columns(columnas_permitidas):
        raise HTTPException(status_code=400, detail="Debes indicar al menos una columna permitida")

    dup_codigo = db.execute(
        select(TablaConsultaPermitida).where(TablaConsultaPermitida.codigo == codigo)
    ).scalar_one_or_none()
    if dup_codigo:
        raise HTTPException(status_code=409, detail="Ya existe una tabla registrada con ese código")

    dup_tabla = db.execute(
        select(TablaConsultaPermitida).where(TablaConsultaPermitida.tabla_bd == tabla_bd)
    ).scalar_one_or_none()
    if dup_tabla:
        raise HTTPException(status_code=409, detail="Esa tabla física ya está registrada en el whitelist")

    now = datetime.now(timezone.utc)
    row = TablaConsultaPermitida(
        codigo=codigo,
        nombre=nombre,
        tabla_bd=tabla_bd,
        descripcion=payload.descripcion,
        columnas_permitidas=columnas_permitidas,
        columnas_resultado=columnas_resultado,
        activo=1 if payload.activo else 0,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/admin/tablas-consulta/{tabla_id}", response_model=TablaConsultaAdminOut, tags=["admin"])
def update_tabla_consulta_admin(
    tabla_id: int,
    payload: TablaConsultaAdminUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    row = db.get(TablaConsultaPermitida, tabla_id)
    if not row:
        raise HTTPException(status_code=404, detail="Tabla del whitelist no existe")

    if payload.codigo is not None:
        codigo = payload.codigo.strip().upper()
        dup = db.execute(
            select(TablaConsultaPermitida).where(
                TablaConsultaPermitida.codigo == codigo,
                TablaConsultaPermitida.id != tabla_id,
            )
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="Ya existe otra tabla con ese código")
        row.codigo = codigo

    if payload.nombre is not None:
        row.nombre = payload.nombre.strip()

    if payload.tabla_bd is not None:
        tabla_bd = payload.tabla_bd.strip()
        dup = db.execute(
            select(TablaConsultaPermitida).where(
                TablaConsultaPermitida.tabla_bd == tabla_bd,
                TablaConsultaPermitida.id != tabla_id,
            )
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="Esa tabla física ya está registrada")
        row.tabla_bd = tabla_bd

    if payload.descripcion is not None:
        row.descripcion = payload.descripcion

    if payload.columnas_permitidas is not None:
        cols = payload.columnas_permitidas.strip()
        if not _split_columns(cols):
            raise HTTPException(status_code=400, detail="Debes indicar al menos una columna permitida")
        row.columnas_permitidas = cols

    if payload.columnas_resultado is not None:
        row.columnas_resultado = payload.columnas_resultado.strip() if payload.columnas_resultado else None

    if payload.activo is not None:
        row.activo = 1 if payload.activo else 0

    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.get("/admin/tablas-consulta/{tabla_id}/equipos", response_model=list[EquipoOut], tags=["admin"])
def get_equipos_tabla_consulta(
    tabla_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    row = db.get(TablaConsultaPermitida, tabla_id)
    if not row:
        raise HTTPException(status_code=404, detail="Tabla del whitelist no existe")

    return db.execute(
        select(Equipo)
        .join(TablaConsultaEquipo, TablaConsultaEquipo.equipo_id == Equipo.id)
        .where(TablaConsultaEquipo.tabla_id == tabla_id, TablaConsultaEquipo.activo == 1)
        .order_by(Equipo.nombre.asc())
    ).scalars().all()


@app.put("/admin/tablas-consulta/{tabla_id}/equipos", tags=["admin"])
def set_equipos_tabla_consulta(
    tabla_id: int,
    payload: EquipoAsignacionIn,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    row = db.get(TablaConsultaPermitida, tabla_id)
    if not row:
        raise HTTPException(status_code=404, detail="Tabla del whitelist no existe")

    ids = sorted(set(payload.equipo_ids))
    if ids:
        found = db.execute(select(Equipo.id).where(Equipo.id.in_(ids), Equipo.activo == 1)).scalars().all()
        if len(found) != len(ids):
            raise HTTPException(status_code=400, detail="Uno o más equipos no existen o están inactivos")

    db.execute(delete(TablaConsultaEquipo).where(TablaConsultaEquipo.tabla_id == tabla_id))
    for equipo_id in ids:
        db.add(TablaConsultaEquipo(tabla_id=tabla_id, equipo_id=equipo_id, activo=1))
    db.commit()
    return {"detail": "Equipos de la tabla actualizados correctamente"}


@app.get("/consulta-tablas/disponibles", response_model=list[TablaConsultaDisponibleOut], tags=["consulta-tablas"])
def list_tablas_consulta_disponibles(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if _is_admin_user(current_user):
        rows = db.execute(
            select(TablaConsultaPermitida)
            .where(TablaConsultaPermitida.activo == 1)
            .order_by(TablaConsultaPermitida.nombre.asc())
        ).scalars().all()
    else:
        rows = db.execute(
            select(TablaConsultaPermitida)
            .join(TablaConsultaEquipo, TablaConsultaEquipo.tabla_id == TablaConsultaPermitida.id)
            .join(Equipo, Equipo.id == TablaConsultaEquipo.equipo_id)
            .join(UsuarioEquipo, UsuarioEquipo.equipo_id == TablaConsultaEquipo.equipo_id)
            .where(
                TablaConsultaPermitida.activo == 1,
                Equipo.activo == 1,
                TablaConsultaEquipo.activo == 1,
                UsuarioEquipo.activo == 1,
                UsuarioEquipo.usuario_id == current_user["id"],
            )
            .order_by(TablaConsultaPermitida.nombre.asc())
        ).scalars().all()
        unique: dict[int, TablaConsultaPermitida] = {r.id: r for r in rows}
        rows = list(unique.values())

    return [
        TablaConsultaDisponibleOut(
            id=r.id,
            codigo=r.codigo,
            nombre=r.nombre,
            tabla_bd=r.tabla_bd,
            descripcion=r.descripcion,
            columnas_permitidas=_split_columns(r.columnas_permitidas),
            columnas_resultado=_split_columns(r.columnas_resultado) or _split_columns(r.columnas_permitidas),
        )
        for r in rows
    ]


@app.post("/consulta-tablas/search", response_model=TableQueryOut, tags=["consulta-tablas"])
def consulta_tablas_search(
    payload: TableQueryIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    whitelist = _resolve_allowed_tabla(db, payload.tabla_id, current_user)
    if not whitelist or whitelist.activo != 1:
        raise HTTPException(status_code=404, detail="La tabla no existe o no está permitida para tu usuario")

    allowed_filter_cols_list = _split_columns(whitelist.columnas_permitidas)
    if not allowed_filter_cols_list:
        raise HTTPException(status_code=400, detail="La tabla no tiene columnas permitidas configuradas")
    allowed_filter_keys = {_column_key(c) for c in allowed_filter_cols_list}

    result_cols = _split_columns(whitelist.columnas_resultado) or allowed_filter_cols_list
    result_col_keys = [_column_key(c) for c in result_cols]

    bind = db.get_bind()
    try:
        schema_name, table_name = _parse_table_identifier(whitelist.tabla_bd)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    schema_name = _oracle_sa_normalize_identifier(schema_name, bind)
    table_name = _oracle_sa_normalize_identifier(table_name, bind) or table_name

    try:
        reflected = Table(
            table_name,
            MetaData(),
            schema=schema_name,
            autoload_with=bind,
            resolve_fks=False,
        )
    except NoSuchTableError as e:
        raise HTTPException(status_code=400, detail=f"La tabla física no existe: {whitelist.tabla_bd}") from e
    real_cols = {c.name: c for c in reflected.columns}
    real_cols_ci = {_column_key(c.name): c for c in reflected.columns}

    missing_filter = [c for c in allowed_filter_cols_list if _column_key(c) not in real_cols_ci]
    if missing_filter:
        raise HTTPException(
            status_code=400,
            detail=f"Columnas permitidas inexistentes en tabla física: {', '.join(sorted(missing_filter))}",
        )

    missing_result = [c for c in result_cols if _column_key(c) not in real_cols_ci]
    if missing_result:
        raise HTTPException(
            status_code=400,
            detail=f"Columnas de resultado inexistentes en tabla física: {', '.join(sorted(missing_result))}",
        )

    conditions = []
    for f in payload.filters:
        col_name = f.column.strip()
        col_key = _column_key(col_name)
        if col_key not in allowed_filter_keys:
            raise HTTPException(status_code=400, detail=f"Filtro no permitido para columna: {f.column.strip()}")

        col = real_cols_ci[col_key]
        op = f.operator
        value = f.value

        if op == "isnull":
            is_null = True if value is None else str(value).strip().lower() in {"1", "true", "t", "yes"}
            conditions.append(col.is_(None) if is_null else col.is_not(None))
            continue

        if op == "in":
            if not isinstance(value, list) or not value:
                raise HTTPException(status_code=400, detail=f"El operador 'in' requiere una lista no vacía en {f.column.strip()}")
            parsed = [_parse_filter_value(v, col.type) for v in value]
            conditions.append(col.in_(parsed))
            continue

        if op in {"contains", "startswith", "endswith"}:
            if _column_kind(col.type) != "str":
                raise HTTPException(status_code=400, detail=f"El operador {op} solo aplica a columnas de texto")
            txt = str(value if value is not None else "").strip()
            if not txt:
                raise HTTPException(status_code=400, detail=f"El filtro {op} requiere un valor no vacío")
            if op == "contains":
                conditions.append(col.ilike(f"%{txt}%"))
            elif op == "startswith":
                conditions.append(col.ilike(f"{txt}%"))
            else:
                conditions.append(col.ilike(f"%{txt}"))
            continue

        parsed_value = _parse_filter_value(value, col.type)
        if op == "eq":
            conditions.append(col == parsed_value)
        elif op == "neq":
            conditions.append(col != parsed_value)
        elif op == "gt":
            conditions.append(col > parsed_value)
        elif op == "gte":
            conditions.append(col >= parsed_value)
        elif op == "lt":
            conditions.append(col < parsed_value)
        elif op == "lte":
            conditions.append(col <= parsed_value)
        else:
            raise HTTPException(status_code=400, detail=f"Operador no soportado: {op}")

    selected_cols = [real_cols_ci[_column_key(c)].label(c) for c in result_cols]
    query = select(*selected_cols)
    if conditions:
        query = query.where(*conditions)

    if payload.order_by:
        order_name = payload.order_by.strip()
        if order_name and _column_key(order_name) in set(result_col_keys):
            order_col = real_cols_ci[_column_key(order_name)]
            query = query.order_by(order_col.desc() if payload.order_dir == "desc" else order_col.asc())

    rows = db.execute(query.limit(21)).mappings().all()
    truncated = len(rows) > 20
    rows = rows[:20]

    items: list[dict[str, Any]] = []
    for row in rows:
        item: dict[str, Any] = {}
        for c in result_cols:
            v = row.get(c)
            if isinstance(v, (datetime, date)):
                item[c] = v.isoformat()
            else:
                item[c] = v
        items.append(item)

    return TableQueryOut(
        tabla_id=whitelist.id,
        tabla_codigo=whitelist.codigo,
        tabla_nombre=whitelist.nombre,
        columns=result_cols,
        items=items,
        total_returned=len(items),
        truncated=truncated,
    )


@app.get("/debug/oracle-reflection", tags=["debug"])
def debug_oracle_reflection(
    tabla_bd: str = Query(..., min_length=1, max_length=255),
    schema: str | None = Query(default=None, max_length=128),
    tables_sample_limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user=Depends(require_admin_rutas),
):
    """
    Debug de reflexión en Oracle con la conexión activa.
    """
    bind = db.get_bind()
    inspector = inspect(bind)

    parsed_schema, parsed_table = _parse_table_identifier(tabla_bd)
    effective_schema = schema.strip() if schema and schema.strip() else parsed_schema
    table_name = parsed_table
    effective_schema = _oracle_sa_normalize_identifier(effective_schema, bind)
    table_name = _oracle_sa_normalize_identifier(table_name, bind) or table_name

    current_schema = None
    current_schema_error = None
    try:
        current_schema = db.execute(
            text("select sys_context('USERENV','CURRENT_SCHEMA') from dual")
        ).scalar_one_or_none()
    except Exception as e:
        current_schema_error = str(e)

    has_table = False
    has_table_error = None
    try:
        has_table = inspector.has_table(table_name, schema=effective_schema)
    except Exception as e:
        has_table_error = str(e)

    table_names: list[str] = []
    get_table_names_error = None
    try:
        table_names = inspector.get_table_names(schema=effective_schema)
    except Exception as e:
        get_table_names_error = str(e)

    table_names_upper = {t.upper() for t in table_names}
    in_get_table_names = table_name.upper() in table_names_upper

    reflection_ok = False
    reflection_error = None
    reflection_error_type = None
    reflected_columns: list[str] = []
    try:
        reflected = Table(
            table_name,
            MetaData(),
            schema=effective_schema,
            autoload_with=bind,
            resolve_fks=False,
        )
        reflection_ok = True
        reflected_columns = [c.name for c in reflected.columns]
    except Exception as e:
        reflection_error_type = type(e).__name__
        reflection_error = str(e)

    return {
        "input": {
            "tabla_bd": tabla_bd,
            "schema_override": schema,
        },
        "resolved": {
            "schema": effective_schema,
            "table_name": table_name,
        },
        "connection": {
            "dialect": bind.dialect.name,
            "default_schema_name": inspector.default_schema_name,
            "current_schema": current_schema,
            "current_schema_error": current_schema_error,
        },
        "introspection": {
            "has_table": has_table,
            "has_table_error": has_table_error,
            "in_get_table_names": in_get_table_names,
            "get_table_names_error": get_table_names_error,
            "get_table_names_count": len(table_names),
            "get_table_names_sample": table_names[:tables_sample_limit],
        },
        "reflection": {
            "ok": reflection_ok,
            "error_type": reflection_error_type,
            "error": reflection_error,
            "columns_count": len(reflected_columns),
            "columns_sample": reflected_columns[:50],
        },
    }
