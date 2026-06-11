import re
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator


INPUT_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,99}$")
PERIODO_PATTERN = re.compile(r"^\d{6}$")
TEXT_INPUT_MAX_LENGTH = 1000

class HealthOut(BaseModel):
    status: str
    service: str
    utc_time: str
    client_ip: str

class ReporteCreate(BaseModel):
    codigo: str
    nombre: str
    descripcion: str | None = None
    requiere_input_archivo: bool = False
    tipos_permitidos: str | None = None
    activo: bool = True
    comando: str | None = None
    ruta_output_base: str | None = None
    parametros_ejemplo_json: str | None = None

class ReporteOut(BaseModel):
    id: int
    codigo: str
    nombre: str
    requiere_input_archivo: bool
    tipos_permitidos: str | None
    activo: bool
    parametros_ejemplo_json: str | None

    model_config = {"from_attributes": True}

class SolicitudCreate(BaseModel):
    reporte_codigo: str
    usuario: str | None = None
    ruta_input: str | None = None
    parametros: dict[str, Any] = Field(default_factory=dict)
    max_intentos: int = 2


class SolicitudInputValorIn(BaseModel):
    codigo_input: str = Field(min_length=2, max_length=100)
    valor: str | None = None
    ruta_archivo: str | None = None

    @field_validator("codigo_input")
    @classmethod
    def validate_codigo_input(cls, value: str) -> str:
        code = value.strip()
        if not INPUT_CODE_PATTERN.fullmatch(code):
            raise ValueError("codigo_input debe cumplir ^[a-z][a-z0-9_]{1,99}$")
        return code

    @field_validator("valor")
    @classmethod
    def normalize_valor(cls, value: str | None) -> str | None:
        if value is None:
            return None
        txt = value.strip()
        return txt or None

    @field_validator("ruta_archivo")
    @classmethod
    def normalize_ruta_archivo(cls, value: str | None) -> str | None:
        if value is None:
            return None
        txt = value.strip()
        return txt or None


class SolicitudCreateV2(BaseModel):
    reporte_codigo: str
    inputs: list[SolicitudInputValorIn] = Field(default_factory=list)
    parametros: dict[str, Any] = Field(default_factory=dict)
    max_intentos: int = 2

    @field_validator("reporte_codigo")
    @classmethod
    def validate_reporte_codigo(cls, value: str) -> str:
        txt = value.strip()
        if not txt:
            raise ValueError("reporte_codigo es requerido")
        return txt

    @model_validator(mode="after")
    def validate_unique_input_codes(self) -> "SolicitudCreateV2":
        seen: set[str] = set()
        duplicates: list[str] = []
        for item in self.inputs:
            if item.codigo_input in seen:
                duplicates.append(item.codigo_input)
            seen.add(item.codigo_input)
        if duplicates:
            dup_str = ", ".join(sorted(set(duplicates)))
            raise ValueError(f"inputs contiene codigo_input duplicados: {dup_str}")
        return self

class SolicitudOut(BaseModel):
    request_id: str
    reporte_codigo: str
    usuario: str
    estado: str
    progreso: int
    mensaje_estado: str | None
    ruta_output: str | None
    error_detalle: str | None
    fecha_solicitud: datetime
    fecha_inicio: datetime | None
    fecha_fin: datetime | None
    updated_at: datetime


class SolicitudInputValorOut(BaseModel):
    codigo_input: str
    nombre_visible: str
    tipo_input: str
    obligatorio: int
    valor: str | None
    ruta_archivo: str | None
    metadata: dict[str, Any] | None = None


class SolicitudIntentoOut(BaseModel):
    intento: int
    modo_inputs: Literal["legacy", "multi_input"] | None = None
    input_count: int | None = None
    estado_resultado: str | None = None
    log_path: str | None = None
    payload_path: str | None = None
    comando: str | None = None
    duration_sec: float | None = None
    timed_out: bool | None = None
    returncode: int | None = None
    stdout_tail: str | None = None
    stderr_tail: str | None = None
    worker_error: str | None = None
    payload_preview: dict[str, Any] | None = None


class SolicitudDetalleOut(SolicitudOut):
    modo_inputs: Literal["legacy", "multi_input"]
    ruta_input_legacy: str | None
    parametros: dict[str, Any]
    inputs_enviados: list[SolicitudInputValorOut]
    intentos_registrados: int
    max_intentos: int
    intento_actual_o_ultimo: int | None
    log_path_ultimo: str | None
    payload_path_ultimo: str | None
    comando_ultimo: str | None
    intentos_detalle: list[SolicitudIntentoOut]


class ReporteInputVisibleOut(BaseModel):
    id: int
    codigo_input: str
    nombre_visible: str
    tipo_input: str
    obligatorio: int
    orden: int
    activo: int
    tipos_permitidos: str | None

    model_config = {"from_attributes": True}


class ReporteInputsOut(BaseModel):
    reporte_codigo: str
    modo_inputs: Literal["legacy", "multi_input"]
    inputs: list[ReporteInputVisibleOut]


class ArchivoInputDisponibleOut(BaseModel):
    nombre_archivo: str
    ruta_archivo: str


class ReporteInputArchivosOut(BaseModel):
    reporte_codigo: str
    codigo_input: str
    archivos: list[ArchivoInputDisponibleOut]


class SolicitudPageOut(BaseModel):
    items: list[SolicitudOut]
    total: int
    page: int
    page_size: int
    total_pages: int

class EventoOut(BaseModel):
    tipo_evento: str
    detalle: str | None
    origen: str | None
    created_at: datetime
    
    model_config = {"from_attributes": True}


class TablaConsultaDisponibleOut(BaseModel):
    id: int
    codigo: str
    nombre: str
    tabla_bd: str
    descripcion: str | None
    columnas_permitidas: list[str]
    columnas_resultado: list[str]


class TableFilterIn(BaseModel):
    column: str = Field(min_length=1, max_length=255)
    operator: Literal["eq", "neq", "contains", "startswith", "endswith", "gt", "gte", "lt", "lte", "in", "isnull"]
    value: Any = None


class TableQueryIn(BaseModel):
    tabla_id: int
    filters: list[TableFilterIn] = Field(default_factory=list)
    order_by: str | None = Field(default=None, max_length=255)
    order_dir: Literal["asc", "desc"] = "asc"


class TableQueryOut(BaseModel):
    tabla_id: int
    tabla_codigo: str
    tabla_nombre: str
    columns: list[str]
    items: list[dict[str, Any]]
    total_returned: int
    truncated: bool
