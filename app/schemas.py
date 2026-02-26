from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field

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

class ReporteOut(BaseModel):
    id: int
    codigo: str
    nombre: str
    requiere_input_archivo: bool
    tipos_permitidos: str | None
    activo: bool

    model_config = {"from_attributes": True}

class SolicitudCreate(BaseModel):
    reporte_codigo: str
    usuario: str | None = None
    ruta_input: str | None = None
    parametros: dict[str, Any] = Field(default_factory=dict)
    max_intentos: int = 2

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
