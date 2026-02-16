from __future__ import annotations

import json
import logging
import shlex
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

from app.config import settings
from app.db import SessionLocal, engine
from app import crud
from app.models import Solicitud, Reporte, ReporteLock


# ----------------------------
# Logging del worker
# ----------------------------
def setup_logger() -> logging.Logger:
    log_dir = Path(settings.WORKER_LOG_DIR)
    log_dir.mkdir(parents=True, exist_ok=True)

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


def ensure_lock_table():
    ReporteLock.__table__.create(bind=engine, checkfirst=True)


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


def build_command(
    reporte: Reporte,
    solicitud: Solicitud,
) -> str | list[str]:
    """
    Construye el comando final a ejecutar.
    Convención propuesta:
      - reporte.comando contiene la ruta al .bat (o comando base).
      - se agregan args estándar para trazabilidad.
      - si necesitas args custom, usa parametros_json.
    """
    if not reporte.comando or not reporte.comando.strip():
        raise RuntimeError("El reporte no tiene comando configurado.")

    # Aseguramos comillas por si la ruta tiene espacios (ej: "C:\Archivos de Programa\run.bat")
    cmd_path = reporte.comando.strip()
    base_cmd = f'"{cmd_path}"' if " " in cmd_path and not cmd_path.startswith('"') else cmd_path
    params = safe_json_loads(solicitud.parametros_json)

    # Args estándar (puedes adaptarlos a tu .bat)
    # Nota: en shell=True conviene construir string bien escapado para Windows.
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

    # Si algún día usas shell=False, retornamos lista tokenizada
    return shlex.split(cmd_str, posix=False)


def write_request_log(
    request_id: str,
    command_repr: str,
    result: RunResult | None = None,
    error: str | None = None,
) -> str:
    log_dir = Path(settings.WORKER_LOG_DIR)
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{request_id}.log"

    lines: list[str] = []
    lines.append(f"request_id={request_id}")
    lines.append(f"timestamp_utc={now_utc().isoformat()}Z")
    lines.append(f"command={command_repr}")

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

    with open(log_path, "w", encoding="utf-8", errors="replace") as f:
        f.write("\n".join(lines))

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


def heartbeat_lock(reporte_id: int, solicitud_id: int):
    hb_db = SessionLocal()
    try:
        ok = crud.touch_reporte_lock_heartbeat(
            db=hb_db,
            reporte_id=reporte_id,
            solicitud_id=solicitud_id,
            worker_id=resolve_worker_id(),
        )
        if ok:
            hb_db.commit()
        else:
            hb_db.rollback()
            logger.warning(
                "Heartbeat de lock ignorado | reporte_id=%s | solicitud_id=%s | worker_id=%s",
                reporte_id,
                solicitud_id,
                resolve_worker_id(),
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
            worker_id=resolve_worker_id(),
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
    try:
        reporte = db.get(Reporte, job.reporte_id)
        if not reporte:
            err = "Reporte asociado no existe."
            log_path = write_request_log(job.request_id, command_repr="N/A", error=err)
            mark_error_or_retry(db, job, log_path=log_path, error_msg=err)
            return

        update_progress(db, job.id, 20, "Preparando ejecución...")
        command = build_command(reporte, job)
        command_repr = command if isinstance(command, str) else " ".join(command)

        logger.info("Ejecutando %s | request_id=%s | cmd=%s", reporte.codigo, job.request_id, command_repr)
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
        log_path = write_request_log(job.request_id, command_repr="N/A", error=err)
        mark_error_or_retry(db, job, log_path=log_path, error_msg=err)
    finally:
        release_lock(job.reporte_id, job.id)


def main():
    ensure_lock_table()
    logger.info(
        "Worker iniciado | id=%s | poll=%ss | horario=%02d:00-%02d:00 | timezone=%s",
        resolve_worker_id(),
        settings.WORKER_POLL_SECONDS,
        settings.WORKER_ACTIVE_START_HOUR,
        settings.WORKER_ACTIVE_END_HOUR,
        settings.WORKER_TIMEZONE,
    )
    Path(settings.WORKER_LOG_DIR).mkdir(parents=True, exist_ok=True)
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
                resolve_worker_id(),
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
