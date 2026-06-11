from datetime import datetime, timezone
from sqlalchemy import (
    String,
    Integer,
    DateTime,
    ForeignKey,
    Text,
    Boolean,
    Identity,
    CheckConstraint,
    UniqueConstraint,
    Index,
)
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
    parametros_ejemplo_json: Mapped[str | None] = mapped_column("PARAMETROS_EJEMPLO_JSON", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("CREATED_AT", DateTime, default=datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column("UPDATED_AT", DateTime, default=datetime.now(timezone.utc), nullable=False)

    solicitudes = relationship("Solicitud", back_populates="reporte")
    input_defs = relationship("ReporteInputDef", back_populates="reporte")

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
    input_valores = relationship("SolicitudInputValor", back_populates="solicitud", cascade="all, delete-orphan")


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


class ReporteInputDef(Base):
    __tablename__ = "REPORTE_INPUT_DEF_REP_GCI"
    __table_args__ = (
        UniqueConstraint("REPORTE_ID", "CODIGO_INPUT", name="UQ_REP_INPUT_DEF_01"),
        CheckConstraint("TIPO_INPUT IN ('archivo','texto','periodo')", name="CK_REP_INPUT_TIPO_01"),
        CheckConstraint("OBLIGATORIO IN (0,1)", name="CK_REP_INPUT_OBL_01"),
        CheckConstraint("ACTIVO IN (0,1)", name="CK_REP_INPUT_ACT_01"),
        CheckConstraint("ORDEN >= 1", name="CK_REP_INPUT_ORD_01"),
        Index("IX_REP_INPUT_REP_ORD", "REPORTE_ID", "ORDEN", "ID"),
        Index("IX_REP_INPUT_REP_COD", "REPORTE_ID", "CODIGO_INPUT"),
    )

    id: Mapped[int] = mapped_column("ID", Integer, Identity(start=1), primary_key=True)
    reporte_id: Mapped[int] = mapped_column(
        "REPORTE_ID",
        ForeignKey("REPORTES_REP_GCI.REPORTE_ID"),
        nullable=False,
        index=True,
    )
    codigo_input: Mapped[str] = mapped_column("CODIGO_INPUT", String(100), nullable=False)
    nombre_visible: Mapped[str] = mapped_column("NOMBRE_VISIBLE", String(255), nullable=False)
    tipo_input: Mapped[str] = mapped_column("TIPO_INPUT", String(20), nullable=False)
    obligatorio: Mapped[int] = mapped_column("OBLIGATORIO", Integer, default=1, nullable=False)
    orden: Mapped[int] = mapped_column("ORDEN", Integer, default=1, nullable=False)
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False)
    tipos_permitidos: Mapped[str | None] = mapped_column("TIPOS_PERMITIDOS", String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column("CREATED_AT", DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column("UPDATED_AT", DateTime, nullable=False)

    reporte = relationship("Reporte", back_populates="input_defs")
    carpetas_permitidas = relationship("InputCarpetaPermitida", back_populates="input_def")
    solicitud_valores = relationship("SolicitudInputValor", back_populates="input_def")


class InputCarpetaPermitida(Base):
    __tablename__ = "INPUT_CARPETAS_PERMITIDAS_REP_GCI"
    __table_args__ = (
        UniqueConstraint("INPUT_DEF_ID", "RUTA_BASE", name="UQ_INPUT_CARP_RUTA_01"),
        CheckConstraint("ACTIVO IN (0,1)", name="CK_INPUT_CARP_ACT_01"),
        Index("IX_INPUT_CARP_INP_ACT", "INPUT_DEF_ID", "ACTIVO"),
    )

    id: Mapped[int] = mapped_column("ID", Integer, Identity(start=1), primary_key=True)
    input_def_id: Mapped[int] = mapped_column(
        "INPUT_DEF_ID",
        ForeignKey("REPORTE_INPUT_DEF_REP_GCI.ID"),
        nullable=False,
        index=True,
    )
    ruta_base: Mapped[str] = mapped_column("RUTA_BASE", String(1000), nullable=False)
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column("CREATED_AT", DateTime, nullable=False)

    input_def = relationship("ReporteInputDef", back_populates="carpetas_permitidas")


class SolicitudInputValor(Base):
    __tablename__ = "SOLICITUD_INPUT_VALOR_REP_GCI"
    __table_args__ = (
        UniqueConstraint("SOLICITUD_ID", "CODIGO_INPUT", name="UQ_SOL_INPUT_VALOR_01"),
        CheckConstraint("TIPO_INPUT IN ('archivo','texto','periodo')", name="CK_SOL_INPUT_TIPO_01"),
        Index("IX_SOL_INPUT_SOL_COD", "SOLICITUD_ID", "CODIGO_INPUT"),
        Index("IX_SOL_INPUT_DEF_CREATED", "INPUT_DEF_ID", "CREATED_AT"),
    )

    id: Mapped[int] = mapped_column("ID", Integer, Identity(start=1), primary_key=True)
    solicitud_id: Mapped[int] = mapped_column(
        "SOLICITUD_ID",
        ForeignKey("SOLICITUDES_REP_GCI.SOLICITUD_ID"),
        nullable=False,
        index=True,
    )
    input_def_id: Mapped[int] = mapped_column(
        "INPUT_DEF_ID",
        ForeignKey("REPORTE_INPUT_DEF_REP_GCI.ID"),
        nullable=False,
        index=True,
    )
    codigo_input: Mapped[str] = mapped_column("CODIGO_INPUT", String(100), nullable=False)
    tipo_input: Mapped[str] = mapped_column("TIPO_INPUT", String(20), nullable=False)
    valor: Mapped[str | None] = mapped_column("VALOR", Text, nullable=True)
    ruta_archivo: Mapped[str | None] = mapped_column("RUTA_ARCHIVO", Text, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column("METADATA_JSON", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("CREATED_AT", DateTime, nullable=False)

    solicitud = relationship("Solicitud", back_populates="input_valores")
    input_def = relationship("ReporteInputDef", back_populates="solicitud_valores")


class ReporteEquipo(Base):
    __tablename__ = "REPORTE_EQUIPO_REP_GCI"
    __table_args__ = (UniqueConstraint("REPORTE_ID", "EQUIPO_ID", name="UQ_REPORTE_EQUIPO"),)

    id: Mapped[int] = mapped_column("REPORTE_EQUIPO_ID", Integer, Identity(start=1), primary_key=True)
    reporte_id: Mapped[int] = mapped_column("REPORTE_ID", ForeignKey("REPORTES_REP_GCI.REPORTE_ID"), nullable=False, index=True)
    equipo_id: Mapped[int] = mapped_column("EQUIPO_ID", ForeignKey("EQUIPOS_REP_GCI.EQUIPO_ID"), nullable=False, index=True)
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False)

    reporte = relationship("Reporte")


class ReporteLock(Base):
    __tablename__ = "REPORTE_LOCKS_REP_GCI"

    reporte_id: Mapped[int] = mapped_column(
        "REPORTE_ID",
        ForeignKey("REPORTES_REP_GCI.REPORTE_ID"),
        primary_key=True,
    )
    solicitud_id: Mapped[int] = mapped_column("SOLICITUD_ID", Integer, nullable=False, index=True)
    worker_id: Mapped[str] = mapped_column("WORKER_ID", String(120), nullable=False, index=True)
    locked_at: Mapped[datetime] = mapped_column("LOCKED_AT", DateTime, nullable=False)
    heartbeat_at: Mapped[datetime] = mapped_column("HEARTBEAT_AT", DateTime, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column("UPDATED_AT", DateTime, nullable=False)

    reporte = relationship("Reporte")


class TablaConsultaPermitida(Base):
    __tablename__ = "TABLAS_CONSULTA_REP_GCI"

    id: Mapped[int] = mapped_column("TABLA_ID", Integer, Identity(start=1), primary_key=True)
    codigo: Mapped[str] = mapped_column("CODIGO", String(100), unique=True, nullable=False, index=True)
    nombre: Mapped[str] = mapped_column("NOMBRE", String(255), nullable=False)
    tabla_bd: Mapped[str] = mapped_column("TABLA_BD", String(255), unique=True, nullable=False, index=True)
    descripcion: Mapped[str | None] = mapped_column("DESCRIPCION", Text, nullable=True)
    columnas_permitidas: Mapped[str] = mapped_column("COLUMNAS_PERMITIDAS", Text, nullable=False)
    columnas_resultado: Mapped[str | None] = mapped_column("COLUMNAS_RESULTADO", Text, nullable=True)
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column("CREATED_AT", DateTime, default=datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column("UPDATED_AT", DateTime, default=datetime.now(timezone.utc), nullable=False)


class TablaConsultaEquipo(Base):
    __tablename__ = "TABLA_CONSULTA_EQUIPO_REP_GCI"
    __table_args__ = (UniqueConstraint("TABLA_ID", "EQUIPO_ID", name="UQ_TABLA_CONSULTA_EQUIPO"),)

    id: Mapped[int] = mapped_column("TABLA_CONSULTA_EQUIPO_ID", Integer, Identity(start=1), primary_key=True)
    tabla_id: Mapped[int] = mapped_column("TABLA_ID", ForeignKey("TABLAS_CONSULTA_REP_GCI.TABLA_ID"), nullable=False, index=True)
    equipo_id: Mapped[int] = mapped_column("EQUIPO_ID", ForeignKey("EQUIPOS_REP_GCI.EQUIPO_ID"), nullable=False, index=True)
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False)

    tabla = relationship("TablaConsultaPermitida")
