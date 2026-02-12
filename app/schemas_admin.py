from pydantic import BaseModel, Field

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

class ReporteAdminCreate(BaseModel):
    codigo: str = Field(min_length=2, max_length=100)
    nombre: str = Field(min_length=3, max_length=255)
    descripcion: str | None = None
    requiere_input_archivo: int = Field(default=1)
    tipos_permitidos: str | None = None
    activo: int = Field(default=1)
    comando: str | None = None
    ruta_output_base: str | None = None

class ReporteAdminUpdate(BaseModel):
    codigo: str | None = Field(default=None, min_length=2, max_length=100)
    nombre: str | None = Field(default=None, min_length=3, max_length=255)
    descripcion: str | None = None
    requiere_input_archivo: int | None = None
    tipos_permitidos: str | None = None
    activo: int | None = None
    comando: str | None = None
    ruta_output_base: str | None = None

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

    model_config = {"from_attributes": True}


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
