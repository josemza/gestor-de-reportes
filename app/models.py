from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, ForeignKey, Text, Boolean, Identity, CheckConstraint, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base


class Reporte(Base):
    __tablename__ = "REPORTES_REP_GCI"

    id: Mapped[int] = mapped_column("REPORTE_ID", Integer, Identity(start=1), primary_key=True)
    codigo: Mapped[str] = mapped_column("CODIGO", String(100), unique=True, nullable=False, index=True)
    nombre: Mapped[str] = mapped_column("NOMBRE", String(255), nullable=False)
    descripcion: Mapped[str | None] = mapped_column("DESCRIPCION", Text, nullable=True)
    requiere_input_archivo: Mapped[int] = mapped_column("REQUIERE_INPUT_ARCHIVO", Integer, default=1, nullable=False)
    tipos_permitidos: Mapped[str | None] = mapped_column("TIPOS_PERMITIDOS", String(255), nullable=True)  # csv;xlsx
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False)
    comando: Mapped[str | None] = mapped_column("COMANDO", String(500), nullable=True)
    ruta_output_base: Mapped[str | None] = mapped_column("RUTA_OUTPUT_BASE", String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column("CREATED_AT", DateTime, default=datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column("UPDATED_AT", DateTime, default=datetime.now(timezone.utc), nullable=False)

    solicitudes = relationship("Solicitud", back_populates="reporte")

    __table_args__ = (CheckConstraint("ACTIVO IN (0,1)",name="CK_REPORTES_ACTIVO_01"),
                      CheckConstraint("REQUIERE_INPUT_ARCHIVO IN (0,1)", name="CK_REPORTES_REQ_IN_01"))


class Solicitud(Base):
    __tablename__ = "SOLICITUDES_REP_GCI"

    id: Mapped[int] = mapped_column("SOLICITUD_ID", Integer, Identity(start=1), primary_key=True)
    request_id: Mapped[str] = mapped_column("REQUEST_ID", String(40), unique=True, nullable=False, index=True)
    reporte_id: Mapped[int] = mapped_column("REPORTE_ID", ForeignKey("REPORTES_REP_GCI.REPORTE_ID"), nullable=False, index=True)
    usuario: Mapped[str] = mapped_column("USUARIO_SOLICITANTE", String(120), nullable=False, index=True)

    estado: Mapped[str] = mapped_column("ESTADO", String(30), default="PENDIENTE", nullable=False, index=True)
    progreso: Mapped[int] = mapped_column("PROGRESO", Integer, default=0, nullable=False)
    mensaje_estado: Mapped[str | None] = mapped_column("MENSAJE_ESTADO", Text, nullable=True)

    ruta_input: Mapped[str | None] = mapped_column("RUTA_INPUT", Text, nullable=True)
    parametros_json: Mapped[str | None] = mapped_column("PARAMETROS_JSON", Text, nullable=True)

    intentos: Mapped[int] = mapped_column("INTENTOS", Integer, default=0, nullable=False)
    max_intentos: Mapped[int] = mapped_column("MAX_INTENTOS", Integer, default=2, nullable=False)

    ruta_output: Mapped[str | None] = mapped_column("RUTA_OUTPUT", Text, nullable=True)
    log_path: Mapped[str | None] = mapped_column("LOG_PATH", Text, nullable=True)
    error_detalle: Mapped[str | None] = mapped_column("ERROR_DETALLE", Text, nullable=True)

    fecha_solicitud: Mapped[datetime] = mapped_column("FECHA_SOLICITUD", DateTime, default=datetime.now(timezone.utc), nullable=False)
    fecha_inicio: Mapped[datetime | None] = mapped_column("FECHA_INICIO", DateTime, nullable=True)
    fecha_fin: Mapped[datetime | None] = mapped_column("FECHA_FIN", DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column("UPDATED_AT", DateTime, default=datetime.now(timezone.utc), nullable=False)

    reporte = relationship("Reporte", back_populates="solicitudes")
    eventos = relationship("SolicitudEvento", back_populates="solicitud", cascade="all, delete-orphan")


class SolicitudEvento(Base):
    __tablename__ = "SOLICITUD_EVENTOS_REP_GCI"

    id: Mapped[int] = mapped_column("EVENTO_ID", Integer, Identity(start=1), primary_key=True)
    solicitud_id: Mapped[int] = mapped_column("SOLICITUD_ID", ForeignKey("SOLICITUDES_REP_GCI.SOLICITUD_ID"), nullable=False, index=True)
    tipo_evento: Mapped[str] = mapped_column("TIPO_EVENTO", String(20), nullable=False)
    detalle: Mapped[str | None] = mapped_column("DETALLE", Text, nullable=True)
    origen: Mapped[str | None] = mapped_column("ORIGEN", String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column("CREATED_AT", DateTime, default=datetime.now(timezone.utc), nullable=False)

    solicitud = relationship("Solicitud", back_populates="eventos")

class ReporteCarpetaPermitida(Base):
    __tablename__ = "CARPETAS_PERMITIDAS_REP_GCI"

    id: Mapped[int] = mapped_column("ID", Integer, Identity(start=1), primary_key=True)
    reporte_id: Mapped[int] = mapped_column("REPORTE_ID", ForeignKey("REPORTES_REP_GCI.REPORTE_ID"), nullable=False, index=True)
    ruta_base: Mapped[str] = mapped_column("RUTA_BASE", String(1000), nullable=False)
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False) # 1/0

    reporte = relationship("Reporte")


class ReporteEquipo(Base):
    __tablename__ = "REPORTE_EQUIPO_REP_GCI"
    __table_args__ = (UniqueConstraint("REPORTE_ID", "EQUIPO_ID", name="UQ_REPORTE_EQUIPO"),)

    id: Mapped[int] = mapped_column("REPORTE_EQUIPO_ID", Integer, Identity(start=1), primary_key=True)
    reporte_id: Mapped[int] = mapped_column("REPORTE_ID", ForeignKey("REPORTES_REP_GCI.REPORTE_ID"), nullable=False, index=True)
    equipo_id: Mapped[int] = mapped_column("EQUIPO_ID", ForeignKey("EQUIPOS_REP_GCI.EQUIPO_ID"), nullable=False, index=True)
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False)

    reporte = relationship("Reporte")
