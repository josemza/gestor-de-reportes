import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


INPUT_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,99}$")


def _validate_binary_flag(value: int | None, field_name: str) -> int | None:
    if value is None:
        return None
    if value not in (0, 1):
        raise ValueError(f"{field_name} debe ser 0 o 1")
    return value


def _normalize_tipos_permitidos(raw: str | None) -> str | None:
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
            raise ValueError("tipos_permitidos contiene extensiones inválidas")
        if ext not in seen:
            normalized.append(ext)
            seen.add(ext)

    return ";".join(normalized) if normalized else None

class CarpetaPermitidaCreate(BaseModel):
    ruta_base: str = Field(min_length=3)

class CarpetaPermitidaUpdate(BaseModel):
    ruta_base: str | None = None
    activo: int | None = None # 1/0

class CarpetaPermitidaOut(BaseModel):
    id: int
    reporte_codigo: str
    ruta_base: str
    activo: int

    model_config = {"from_attributes": True}


class ReporteInputDefCreate(BaseModel):
    codigo_input: str = Field(min_length=2, max_length=100)
    nombre_visible: str = Field(min_length=1, max_length=255)
    tipo_input: Literal["archivo", "texto", "periodo"]
    obligatorio: int = Field(default=1)
    orden: int = Field(default=1, ge=1)
    activo: int = Field(default=1)
    tipos_permitidos: str | None = None

    @field_validator("codigo_input")
    @classmethod
    def validate_codigo_input(cls, value: str) -> str:
        code = value.strip()
        if not INPUT_CODE_PATTERN.fullmatch(code):
            raise ValueError("codigo_input debe cumplir ^[a-z][a-z0-9_]{1,99}$")
        return code

    @field_validator("nombre_visible")
    @classmethod
    def validate_nombre_visible(cls, value: str) -> str:
        txt = value.strip()
        if not txt:
            raise ValueError("nombre_visible es requerido")
        return txt

    @field_validator("obligatorio")
    @classmethod
    def validate_obligatorio(cls, value: int) -> int:
        validated = _validate_binary_flag(value, "obligatorio")
        assert validated is not None
        return validated

    @field_validator("activo")
    @classmethod
    def validate_activo(cls, value: int) -> int:
        validated = _validate_binary_flag(value, "activo")
        assert validated is not None
        return validated

    @field_validator("tipos_permitidos")
    @classmethod
    def validate_tipos_permitidos(cls, value: str | None) -> str | None:
        return _normalize_tipos_permitidos(value)

    @model_validator(mode="after")
    def validate_tipo_vs_extensiones(self) -> "ReporteInputDefCreate":
        if self.tipo_input != "archivo" and self.tipos_permitidos is not None:
            raise ValueError("tipos_permitidos solo aplica para inputs de tipo archivo")
        return self


class ReporteInputDefUpdate(BaseModel):
    nombre_visible: str | None = Field(default=None, min_length=1, max_length=255)
    tipo_input: Literal["archivo", "texto", "periodo"] | None = None
    obligatorio: int | None = None
    orden: int | None = Field(default=None, ge=1)
    activo: int | None = None
    tipos_permitidos: str | None = None

    @field_validator("nombre_visible")
    @classmethod
    def validate_nombre_visible(cls, value: str | None) -> str | None:
        if value is None:
            return None
        txt = value.strip()
        if not txt:
            raise ValueError("nombre_visible es requerido")
        return txt

    @field_validator("obligatorio")
    @classmethod
    def validate_obligatorio(cls, value: int | None) -> int | None:
        return _validate_binary_flag(value, "obligatorio")

    @field_validator("activo")
    @classmethod
    def validate_activo(cls, value: int | None) -> int | None:
        return _validate_binary_flag(value, "activo")

    @field_validator("tipos_permitidos")
    @classmethod
    def validate_tipos_permitidos(cls, value: str | None) -> str | None:
        return _normalize_tipos_permitidos(value)

    @model_validator(mode="after")
    def validate_tipo_vs_extensiones(self) -> "ReporteInputDefUpdate":
        if self.tipo_input is not None and self.tipo_input != "archivo" and self.tipos_permitidos is not None:
            raise ValueError("tipos_permitidos solo aplica para inputs de tipo archivo")
        return self


class ReporteInputDefOut(BaseModel):
    id: int
    reporte_id: int
    codigo_input: str
    nombre_visible: str
    tipo_input: str
    obligatorio: int
    orden: int
    activo: int
    tipos_permitidos: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class InputCarpetaPermitidaCreate(BaseModel):
    ruta_base: str = Field(min_length=1, max_length=1000)

    @field_validator("ruta_base")
    @classmethod
    def validate_ruta_base(cls, value: str) -> str:
        txt = value.strip()
        if not txt:
            raise ValueError("ruta_base es requerida")
        return txt


class InputCarpetaPermitidaUpdate(BaseModel):
    ruta_base: str | None = Field(default=None, min_length=1, max_length=1000)
    activo: int | None = None

    @field_validator("ruta_base")
    @classmethod
    def validate_ruta_base(cls, value: str | None) -> str | None:
        if value is None:
            return None
        txt = value.strip()
        if not txt:
            raise ValueError("ruta_base es requerida")
        return txt

    @field_validator("activo")
    @classmethod
    def validate_activo(cls, value: int | None) -> int | None:
        return _validate_binary_flag(value, "activo")


class InputCarpetaPermitidaOut(BaseModel):
    id: int
    input_def_id: int
    ruta_base: str
    activo: int
    created_at: datetime

    model_config = {"from_attributes": True}

class ReporteAdminCreate(BaseModel):
    codigo: str = Field(min_length=2, max_length=100)
    nombre: str = Field(min_length=3, max_length=255)
    descripcion: str | None = None
    requiere_input_archivo: int = Field(default=1)
    tipos_permitidos: str | None = None
    activo: int = Field(default=1)
    comando: str | None = None
    ruta_output_base: str | None = None
    parametros_ejemplo_json: str | None = None

class ReporteAdminUpdate(BaseModel):
    codigo: str | None = Field(default=None, min_length=2, max_length=100)
    nombre: str | None = Field(default=None, min_length=3, max_length=255)
    descripcion: str | None = None
    requiere_input_archivo: int | None = None
    tipos_permitidos: str | None = None
    activo: int | None = None
    comando: str | None = None
    ruta_output_base: str | None = None
    parametros_ejemplo_json: str | None = None

class ReporteAdminOut(BaseModel):
    id: int
    codigo: str
    nombre: str
    descripcion: str | None
    requiere_input_archivo: int
    tipos_permitidos: str | None
    activo: int
    comando: str | None
    ruta_output_base: str | None
    parametros_ejemplo_json: str | None

    model_config = {"from_attributes": True}


class ReporteAdminPageOut(BaseModel):
    items: list[ReporteAdminOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class EquipoCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)
    activo: int = Field(default=1)


class EquipoUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=120)
    activo: int | None = None


class EquipoOut(BaseModel):
    id: int
    nombre: str
    activo: int

    model_config = {"from_attributes": True}


class EquipoAsignacionIn(BaseModel):
    equipo_ids: list[int] = Field(default_factory=list)


class EquipoUsuariosAsignacionIn(BaseModel):
    usuario_ids: list[int] = Field(default_factory=list)


class EquipoReportesAsignacionIn(BaseModel):
    reporte_ids: list[int] = Field(default_factory=list)


class EquipoResumenOut(BaseModel):
    id: int
    nombre: str
    activo: int
    usuarios_count: int
    reportes_count: int


class EquipoResumenDetalleOut(BaseModel):
    equipo: EquipoOut
    usuarios_count: int
    reportes_count: int


class TablaConsultaAdminCreate(BaseModel):
    codigo: str = Field(min_length=2, max_length=100)
    nombre: str = Field(min_length=2, max_length=255)
    tabla_bd: str = Field(min_length=2, max_length=255)
    descripcion: str | None = None
    columnas_permitidas: str = Field(min_length=1)
    columnas_resultado: str | None = None
    activo: int = Field(default=1)


class TablaConsultaAdminUpdate(BaseModel):
    codigo: str | None = Field(default=None, min_length=2, max_length=100)
    nombre: str | None = Field(default=None, min_length=2, max_length=255)
    tabla_bd: str | None = Field(default=None, min_length=2, max_length=255)
    descripcion: str | None = None
    columnas_permitidas: str | None = None
    columnas_resultado: str | None = None
    activo: int | None = None


class TablaConsultaAdminOut(BaseModel):
    id: int
    codigo: str
    nombre: str
    tabla_bd: str
    descripcion: str | None
    columnas_permitidas: str
    columnas_resultado: str | None
    activo: int

    model_config = {"from_attributes": True}


class TablaConsultaAdminPageOut(BaseModel):
    items: list[TablaConsultaAdminOut]
    total: int
    page: int
    page_size: int
    total_pages: int
