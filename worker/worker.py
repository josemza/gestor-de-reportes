from __future__ import annotations

import json
import logging
import shlex
import shutil
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
import os
import socket
from pathlib import Path
from typing import Any, Callable
import uuid
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from sqlalchemy.orm import Session

# Cargar .env antes de importar settings
load_dotenv()

from app.config import ensure_directory, resolve_project_path, settings
from app.db import SessionLocal, engine
from app import crud
from app.models import Solicitud, Reporte, ReporteLock, SolicitudInputValor


# ----------------------------
# Logging del worker
# ----------------------------
def setup_logger() -> logging.Logger:
    log_dir = ensure_directory(settings.WORKER_LOG_DIR, label="WORKER_LOG_DIR")
    ensure_directory(settings.WORKER_PAYLOAD_DIR, label="WORKER_PAYLOAD_DIR")

    logger = logging.getLogger("worker")
    logger.setLevel(logging.INFO)

    if not logger.handlers:
        fh = logging.FileHandler(log_dir / "worker_runtime.log", encoding="utf-8")
        sh = logging.StreamHandler()

        fmt = logging.Formatter(
            "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        fh.setFormatter(fmt)
        sh.setFormatter(fmt)

        logger.addHandler(fh)
        logger.addHandler(sh)

    return logger


logger = setup_logger()
MULTI_INPUT_CONTRACT_VERSION = 2


def ensure_lock_table():
    try:
        ReporteLock.__table__.create(bind=engine, checkfirst=True)
    except Exception as exc:
        raise RuntimeError(
            "No se pudo validar o crear REPORTE_LOCKS_REP_GCI. "
            "En Oracle esto suele indicar que la tabla no existe en el esquema objetivo "
            "o que el usuario no tiene permisos de inspección/DDL."
        ) from exc


# ----------------------------
# Utilidades
# ----------------------------
@dataclass
class RunResult:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool
    duration_sec: float

def resolve_worker_id() -> str:
    env_id = os.getenv("WORKER_ID", "").strip()
    if env_id:
        return env_id
    return f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"


WORKER_ID = resolve_worker_id()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def is_within_working_hours(now_local: datetime | None = None) -> bool:
    """
    Ventana horaria para aceptar nuevas ejecuciones.
    - start == end: 24 horas (siempre activo)
    - start < end: ventana del mismo dia [start, end)
    - start > end: ventana cruzando medianoche (ej. 22 -> 6)
    """
    if now_local is None:
        now_local = datetime.now(ZoneInfo(settings.WORKER_TIMEZONE))

    start = settings.WORKER_ACTIVE_START_HOUR
    end = settings.WORKER_ACTIVE_END_HOUR
    hour = now_local.hour

    if start == end:
        return True
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def safe_json_loads(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        val = json.loads(raw)
        return val if isinstance(val, dict) else {}
    except Exception:
        return {}


def strict_json_loads(raw: str | None, field_name: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        val = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"{field_name} inválido: {e.msg}") from e
    if not isinstance(val, dict):
        raise RuntimeError(f"{field_name} debe ser un objeto JSON")
    return val


def strict_optional_json_loads(raw: str | None, field_name: str) -> dict[str, Any] | None:
    if raw is None:
        return None
    return strict_json_loads(raw, field_name)


def detect_request_mode(input_rows: list[SolicitudInputValor]) -> str:
    return "multi_input" if input_rows else "legacy"


def _build_base_command_path(reporte: Reporte) -> str:
    if not reporte.comando or not reporte.comando.strip():
        raise RuntimeError("El reporte no tiene comando configurado.")

    cmd_path = reporte.comando.strip()
    _validate_command_target(cmd_path)
    return f'"{cmd_path}"' if " " in cmd_path and not cmd_path.startswith('"') else cmd_path


def _validate_command_target(command_text: str) -> None:
    raw = (command_text or "").strip().strip('"')
    if not raw:
        raise RuntimeError("El reporte no tiene comando configurado.")

    looks_like_file_target = raw.lower().endswith((".bat", ".cmd", ".exe", ".ps1"))
    has_path_separator = "\\" in raw or "/" in raw
    if not looks_like_file_target and not has_path_separator:
        return

    if not has_path_separator:
        resolved_from_path = shutil.which(raw)
        if resolved_from_path:
            return

    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = resolve_project_path(raw)

    if not candidate.exists():
        raise RuntimeError(f"El comando configurado no existe o no es accesible: {raw}")
    if not candidate.is_file():
        raise RuntimeError(f"El comando configurado no corresponde a un archivo ejecutable: {raw}")


def _validate_existing_input_file(path_value: str, *, label: str) -> None:
    raw = (path_value or "").strip()
    if not raw:
        raise RuntimeError(f"El archivo input {label} no fue informado")

    path_obj = Path(raw)
    try:
        exists = path_obj.exists()
    except OSError as e:
        raise RuntimeError(f"El archivo input {label} no es accesible: {raw} ({e})") from e
    if not exists:
        raise RuntimeError(f"El archivo input {label} no existe o fue eliminado antes de la ejecución: {raw}")

    try:
        is_file = path_obj.is_file()
    except OSError as e:
        raise RuntimeError(f"No se pudo validar el archivo input {label}: {raw} ({e})") from e
    if not is_file:
        raise RuntimeError(f"La ruta del input {label} no corresponde a un archivo: {raw}")


def build_legacy_command(
    reporte: Reporte,
    solicitud: Solicitud,
) -> str | list[str]:
    """
    Mantiene el contrato legacy:
      reporte.bat --request_id ... --usuario ... --ruta_input ... --clave valor
    """
    base_cmd = _build_base_command_path(reporte)
    params = safe_json_loads(solicitud.parametros_json)

    request_id = solicitud.request_id
    ruta_input = solicitud.ruta_input or ""
    usuario = solicitud.usuario

    extra_args = []
    # agrega parametros_json como --k "v"
    for k, v in params.items():
        if isinstance(v, (dict, list)):
            v = json.dumps(v, ensure_ascii=False)
        extra_args.append(f'--{k} "{str(v)}"')

    # args base estándar
    std_args = [
        f'--request_id "{request_id}"',
        f'--usuario "{usuario}"',
    ]
    if ruta_input:
        std_args.append(f'--ruta_input "{ruta_input}"')

    cmd_str = " ".join([base_cmd] + std_args + extra_args)

    # Para .bat en Windows, shell=True + string suele ser lo más robusto.
    if settings.WORKER_USE_SHELL:
        return cmd_str

    return shlex.split(cmd_str, posix=False)


def build_multi_input_payload_content(
    reporte: Reporte,
    solicitud: Solicitud,
    input_rows: list[SolicitudInputValor],
) -> dict[str, Any]:
    parametros = strict_json_loads(solicitud.parametros_json, "parametros_json")
    inputs_payload: dict[str, Any] = {}

    for row in input_rows:
        metadata = strict_optional_json_loads(row.metadata_json, f"metadata_json de {row.codigo_input}")
        value = row.ruta_archivo if row.tipo_input == "archivo" else row.valor
        obligatorio = bool(row.input_def and row.input_def.obligatorio == 1)
        inputs_payload[row.codigo_input] = {
            "tipo": row.tipo_input,
            "obligatorio": obligatorio,
            "valor": value,
            "ruta_archivo": row.ruta_archivo,
            "metadata": metadata,
        }

    generated_at = now_utc().replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "request_id": solicitud.request_id,
        "solicitud_id": solicitud.id,
        "reporte_codigo": reporte.codigo,
        "usuario": solicitud.usuario,
        "modo_inputs": "multi_input",
        "inputs": inputs_payload,
        "parametros": parametros,
        "metadata": {
            "contract_version": MULTI_INPUT_CONTRACT_VERSION,
            "ruta_output_base": reporte.ruta_output_base.strip() if reporte.ruta_output_base else None,
            "generated_at_utc": generated_at,
        },
    }


def write_multi_input_payload_file(
    solicitud: Solicitud,
    intento_actual: int,
    payload: dict[str, Any],
) -> str:
    payload_dir = ensure_directory(settings.WORKER_PAYLOAD_DIR, label="WORKER_PAYLOAD_DIR")
    payload_path = payload_dir / f"{solicitud.request_id}__try_{intento_actual}.json"
    try:
        with open(payload_path, "w", encoding="utf-8", errors="replace") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except OSError as e:
        raise RuntimeError(f"No se pudo escribir el payload JSON temporal en {payload_path}: {e}") from e
    return str(payload_path)


def build_multi_input_command(
    reporte: Reporte,
    solicitud: Solicitud,
    payload_path: str,
) -> str | list[str]:
    """
    Contrato multi-input:
      reporte.bat --request_id ... --usuario ... --params "<json_path>"
    """
    base_cmd = _build_base_command_path(reporte)
    std_args = [
        f'--request_id "{solicitud.request_id}"',
        f'--usuario "{solicitud.usuario}"',
        f'--params "{payload_path}"',
    ]
    cmd_str = " ".join([base_cmd] + std_args)

    if settings.WORKER_USE_SHELL:
        return cmd_str

    return shlex.split(cmd_str, posix=False)


def write_request_log(
    request_id: str,
    command_repr: str,
    result: RunResult | None = None,
    error: str | None = None,
    context: dict[str, Any] | None = None,
) -> str:
    log_dir = ensure_directory(settings.WORKER_LOG_DIR, label="WORKER_LOG_DIR")
    attempt_number = None
    if context:
        raw_attempt = context.get("attempt_number")
        try:
            attempt_number = int(raw_attempt) if raw_attempt is not None else None
        except (TypeError, ValueError):
            attempt_number = None

    if attempt_number and attempt_number >= 1:
        log_path = log_dir / f"{request_id}__try_{attempt_number}.log"
    else:
        log_path = log_dir / f"{request_id}.log"

    lines: list[str] = []
    lines.append(f"request_id={request_id}")
    lines.append(f"timestamp_utc={now_utc().isoformat()}Z")
    lines.append(f"command={command_repr}")
    if context:
        for key, value in context.items():
            lines.append(f"{key}={value}")

    if result is not None:
        lines.append(f"duration_sec={result.duration_sec:.3f}")
        lines.append(f"timed_out={result.timed_out}")
        lines.append(f"returncode={result.returncode}")
        lines.append("")
        lines.append("=== STDOUT ===")
        lines.append(result.stdout or "")
        lines.append("")
        lines.append("=== STDERR ===")
        lines.append(result.stderr or "")

    if error:
        lines.append("")
        lines.append("=== WORKER_ERROR ===")
        lines.append(error)

    try:
        with open(log_path, "w", encoding="utf-8", errors="replace") as f:
            f.write("\n".join(lines))
    except OSError as e:
        raise RuntimeError(f"No se pudo escribir el log del request {request_id} en {log_path}: {e}") from e

    return str(log_path)


def run_command(
    command: str | list[str],
    timeout_sec: int,
    heartbeat_interval_sec: int,
    on_heartbeat: Callable[[], None] | None = None,
) -> RunResult:
    started = time.perf_counter()
    process = subprocess.Popen(
        command,
        shell=settings.WORKER_USE_SHELL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    heartbeat_interval_sec = max(1, heartbeat_interval_sec)
    heartbeat_deadline = time.perf_counter() + heartbeat_interval_sec

    try:
        while True:
            elapsed = time.perf_counter() - started
            remaining_total = timeout_sec - elapsed
            if remaining_total <= 0:
                raise subprocess.TimeoutExpired(command, timeout_sec)

            remaining_for_heartbeat = heartbeat_deadline - time.perf_counter()
            wait_timeout = min(remaining_total, max(0.1, remaining_for_heartbeat))

            try:
                stdout, stderr = process.communicate(timeout=wait_timeout)
                dur = time.perf_counter() - started
                return RunResult(
                    returncode=process.returncode or 0,
                    stdout=stdout or "",
                    stderr=stderr or "",
                    timed_out=False,
                    duration_sec=dur,
                )
            except subprocess.TimeoutExpired:
                now = time.perf_counter()
                if now >= heartbeat_deadline:
                    if on_heartbeat:
                        on_heartbeat()
                    heartbeat_deadline = now + heartbeat_interval_sec
                continue
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, stderr = process.communicate()
        dur = time.perf_counter() - started
        return RunResult(
            returncode=124,  # convención timeout
            stdout=stdout or "",
            stderr=(stderr or "") + f"\n[timeout] excedió {timeout_sec} segundos",
            timed_out=True,
            duration_sec=dur,
        )


def update_progress(db: Session, solicitud_id: int, progreso: int, msg: str):
    db.query(Solicitud).filter(Solicitud.id == solicitud_id).update({
        Solicitud.progreso: progreso,
        Solicitud.mensaje_estado: msg,
        Solicitud.updated_at: now_utc(),
    })
    db.commit()


def record_worker_event(db: Session, solicitud_id: int, tipo: str, detalle: str):
    crud.add_evento(db, solicitud_id, tipo, detalle, "WORKER")
    db.commit()


def mark_ok(
    db: Session,
    solicitud_id: int,
    log_path: str,
    ruta_output: str | None,
    msg: str = "Proceso finalizado correctamente",
):
    db.query(Solicitud).filter(Solicitud.id == solicitud_id).update({
        Solicitud.estado: "OK",
        Solicitud.progreso: 100,
        Solicitud.mensaje_estado: msg,
        Solicitud.log_path: log_path,
        Solicitud.ruta_output: ruta_output,
        Solicitud.error_detalle: None,
        Solicitud.fecha_fin: now_utc(),
        Solicitud.updated_at: now_utc(),
    })
    crud.add_evento(db, solicitud_id, "ESTADO", "OK", "WORKER")
    db.commit()


def mark_error_or_retry(
    db: Session,
    solicitud: Solicitud,
    log_path: str,
    error_msg: str,
):
    # refrescar valor actual de intentos
    db.refresh(solicitud)
    next_intentos = (solicitud.intentos or 0) + 1
    max_intentos = max(1, solicitud.max_intentos or 1)

    if next_intentos < max_intentos:
        # reencolar
        db.query(Solicitud).filter(Solicitud.id == solicitud.id).update({
            Solicitud.estado: "EN_COLA",
            Solicitud.progreso: 0,
            Solicitud.mensaje_estado: f"Reintento programado ({next_intentos}/{max_intentos})",
            Solicitud.intentos: next_intentos,
            Solicitud.log_path: log_path,
            Solicitud.error_detalle: error_msg,
            Solicitud.updated_at: now_utc(),
        })
        crud.add_evento(
            db,
            solicitud.id,
            "ERROR",
            f"Fallo ejecución. Reencolada {next_intentos}/{max_intentos}. Detalle: {error_msg}",
            "WORKER",
        )
    else:
        # error final
        db.query(Solicitud).filter(Solicitud.id == solicitud.id).update({
            Solicitud.estado: "ERROR",
            Solicitud.progreso: 100,
            Solicitud.mensaje_estado: "Proceso finalizado con error",
            Solicitud.intentos: next_intentos,
            Solicitud.log_path: log_path,
            Solicitud.error_detalle: error_msg,
            Solicitud.fecha_fin: now_utc(),
            Solicitud.updated_at: now_utc(),
        })
        crud.add_evento(
            db,
            solicitud.id,
            "ERROR",
            f"ERROR final ({next_intentos}/{max_intentos}). Detalle: {error_msg}",
            "WORKER",
        )

    db.commit()


def resolve_output_path_from_reporte(reporte: Reporte) -> str | None:
    """
    La ruta de salida debe provenir de la configuración del reporte.
    No se infiere desde parametros_json ni desde stdout/stderr.
    """
    if reporte.ruta_output_base and reporte.ruta_output_base.strip():
        return reporte.ruta_output_base.strip()
    return None


def current_attempt_number(solicitud: Solicitud) -> int:
    return max(1, (solicitud.intentos or 0) + 1)


def heartbeat_lock(reporte_id: int, solicitud_id: int):
    hb_db = SessionLocal()
    try:
        ok = crud.touch_reporte_lock_heartbeat(
            db=hb_db,
            reporte_id=reporte_id,
            solicitud_id=solicitud_id,
            worker_id=WORKER_ID,
        )
        if ok:
            hb_db.commit()
        else:
            hb_db.rollback()
            logger.warning(
                "Heartbeat de lock ignorado | reporte_id=%s | solicitud_id=%s | worker_id=%s",
                reporte_id,
                solicitud_id,
                WORKER_ID,
            )
    except Exception:
        hb_db.rollback()
        logger.exception(
            "Error enviando heartbeat de lock | reporte_id=%s | solicitud_id=%s",
            reporte_id,
            solicitud_id,
        )
    finally:
        hb_db.close()


def release_lock(reporte_id: int, solicitud_id: int):
    lock_db = SessionLocal()
    try:
        released = crud.release_reporte_lock(
            db=lock_db,
            reporte_id=reporte_id,
            solicitud_id=solicitud_id,
            worker_id=WORKER_ID,
        )
        if released:
            lock_db.commit()
        else:
            lock_db.rollback()
            logger.warning(
                "No se pudo liberar lock (no pertenece al worker actual o ya no existe) | reporte_id=%s | solicitud_id=%s",
                reporte_id,
                solicitud_id,
            )
    except Exception:
        lock_db.rollback()
        logger.exception(
            "Error liberando lock | reporte_id=%s | solicitud_id=%s",
            reporte_id,
            solicitud_id,
        )
    finally:
        lock_db.close()


def process_job(db: Session, job: Solicitud):
    mode = "legacy"
    payload_path: str | None = None
    input_count = 0
    intento_actual = current_attempt_number(job)
    try:
        reporte = db.get(Reporte, job.reporte_id)
        if not reporte:
            err = "Reporte asociado no existe."
            log_path = write_request_log(job.request_id, command_repr="N/A", error=err, context={"attempt_number": intento_actual})
            mark_error_or_retry(db, job, log_path=log_path, error_msg=err)
            return

        input_rows = crud.get_solicitud_input_valores(db, job.id)
        mode = detect_request_mode(input_rows)
        input_count = len(input_rows)
        if job.estado == "PENDIENTE_ADAPTACION_WORKER" and mode != "multi_input":
            raise RuntimeError(
                "La solicitud estaba en PENDIENTE_ADAPTACION_WORKER pero no tiene valores persistidos en SOLICITUD_INPUT_VALOR_REP_GCI"
            )

        record_worker_event(
            db,
            job.id,
            "INTENTO",
            f"Intento {intento_actual} iniciado | modo={mode} | inputs={input_count}",
        )
        update_progress(db, job.id, 20, "Preparando ejecución...")
        if mode == "multi_input":
            for row in input_rows:
                if row.tipo_input == "archivo" and row.ruta_archivo:
                    _validate_existing_input_file(row.ruta_archivo or "", label=row.codigo_input)
        elif job.ruta_input:
            _validate_existing_input_file(job.ruta_input, label="legacy")

        if mode == "multi_input":
            payload_content = build_multi_input_payload_content(reporte, job, input_rows)
            payload_path = write_multi_input_payload_file(job, intento_actual, payload_content)
            record_worker_event(
                db,
                job.id,
                "PAYLOAD",
                f"Payload temporal generado para intento {intento_actual}",
            )
            command = build_multi_input_command(reporte, job, payload_path)
        else:
            command = build_legacy_command(reporte, job)

        command_repr = command if isinstance(command, str) else " ".join(command)
        log_context = {
            "mode": mode,
            "input_count": input_count,
            "attempt_number": intento_actual,
        }
        if payload_path:
            log_context["payload_path"] = payload_path

        logger.info(
            "Ejecutando %s | request_id=%s | mode=%s | input_count=%s | payload_path=%s | cmd=%s",
            reporte.codigo,
            job.request_id,
            mode,
            input_count,
            payload_path or "N/A",
            command_repr,
        )
        record_worker_event(
            db,
            job.id,
            "EJECUCION",
            f"Comando invocado por worker para intento {intento_actual}",
        )
        update_progress(db, job.id, 40, "Ejecutando proceso...")

        result = run_command(
            command=command,
            timeout_sec=settings.WORKER_JOB_TIMEOUT_SECONDS,
            heartbeat_interval_sec=settings.WORKER_LOCK_HEARTBEAT_SECONDS,
            on_heartbeat=lambda: heartbeat_lock(job.reporte_id, job.id),
        )

        update_progress(db, job.id, 80, "Finalizando y registrando resultado...")

        log_path = write_request_log(
            request_id=job.request_id,
            command_repr=command_repr,
            result=result,
            context=log_context,
        )
        record_worker_event(
            db,
            job.id,
            "RESULTADO",
            f"Intento {intento_actual} finalizado | returncode={result.returncode} | timed_out={result.timed_out}",
        )

        if result.returncode == 0 and not result.timed_out:
            ruta_output = resolve_output_path_from_reporte(reporte)
            mark_ok(
                db,
                solicitud_id=job.id,
                log_path=log_path,
                ruta_output=ruta_output,
                msg="Proceso finalizado correctamente",
            )
            logger.info("OK request_id=%s", job.request_id)
        else:
            err_msg = (
                f"ReturnCode={result.returncode}; timed_out={result.timed_out}; "
                f"stderr={result.stderr[:1500]}"
            )
            mark_error_or_retry(db, job, log_path=log_path, error_msg=err_msg)
            logger.error("Fallo request_id=%s | %s", job.request_id, err_msg)

    except Exception as ex:
        # error inesperado del worker
        err = f"Excepción no controlada: {type(ex).__name__}: {ex}"
        logger.exception("Error no controlado en request_id=%s", job.request_id)
        context = {
            "mode": mode,
            "input_count": input_count,
            "attempt_number": intento_actual,
        }
        if payload_path:
            context["payload_path"] = payload_path
        log_path = write_request_log(job.request_id, command_repr="N/A", error=err, context=context)
        mark_error_or_retry(db, job, log_path=log_path, error_msg=err)
    finally:
        release_lock(job.reporte_id, job.id)


def main():
    ensure_lock_table()
    db_dialect = getattr(getattr(engine, "dialect", None), "name", "unknown")
    logger.info(
        "Worker iniciado | id=%s | db_dialect=%s | poll=%ss | horario=%02d:00-%02d:00 | timezone=%s | payload_dir=%s",
        WORKER_ID,
        db_dialect,
        settings.WORKER_POLL_SECONDS,
        settings.WORKER_ACTIVE_START_HOUR,
        settings.WORKER_ACTIVE_END_HOUR,
        settings.WORKER_TIMEZONE,
        settings.WORKER_PAYLOAD_DIR,
    )
    ensure_directory(settings.WORKER_LOG_DIR, label="WORKER_LOG_DIR")
    ensure_directory(settings.WORKER_PAYLOAD_DIR, label="WORKER_PAYLOAD_DIR")
    in_schedule_prev: bool | None = None

    while True:
        in_schedule = is_within_working_hours()
        if in_schedule_prev is None or in_schedule != in_schedule_prev:
            state = "ACTIVO" if in_schedule else "FUERA_DE_HORARIO"
            logger.info(
                "Estado de ventana horaria: %s | rango=%02d:00-%02d:00",
                state,
                settings.WORKER_ACTIVE_START_HOUR,
                settings.WORKER_ACTIVE_END_HOUR,
            )
            in_schedule_prev = in_schedule

        if not in_schedule:
            time.sleep(settings.WORKER_POLL_SECONDS)
            continue

        db = SessionLocal()
        try:
            job = crud.take_next_job_atomically(
                db,
                WORKER_ID,
                lock_stale_seconds=settings.WORKER_LOCK_STALE_SECONDS,
            )
            if job:
                logger.info("Job tomado | request_id=%s", job.request_id)
                process_job(db, job)
            else:
                time.sleep(settings.WORKER_POLL_SECONDS)
        except Exception:
            logger.exception("Error en loop principal del worker")
            time.sleep(settings.WORKER_POLL_SECONDS)
        finally:
            db.close()


if __name__ == "__main__":
    main()
