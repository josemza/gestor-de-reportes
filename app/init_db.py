from datetime import datetime, timezone
from sqlalchemy import select, func, inspect, text
from .db import Base, engine, SessionLocal
from .models import Reporte
from .models_auth import Rol


def init_db():
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        insp = inspect(engine)
        cols_reportes = {c["name"].upper() for c in insp.get_columns("REPORTES_REP_GCI")}
        if "RUTA_OUTPUT_BASE" not in cols_reportes:
            dialect = engine.dialect.name.lower()
            if "oracle" in dialect:
                db.execute(text("ALTER TABLE REPORTES_REP_GCI ADD (RUTA_OUTPUT_BASE VARCHAR2(1000))"))
            else:
                db.execute(text("ALTER TABLE REPORTES_REP_GCI ADD COLUMN RUTA_OUTPUT_BASE VARCHAR(1000)"))
            db.commit()

        count_roles = db.execute(select(func.count()).select_from(Rol)).scalar_one()
        if count_roles == 0:
            db.add_all([Rol(nombre="ADMIN"), Rol(nombre="USER")])
            db.commit()

        count_reportes = db.execute(select(func.count()).select_from(Reporte)).scalar_one()
        if count_reportes == 0:
            now = datetime.now(timezone.utc)
            db.add_all([
                Reporte(
                    codigo="RPT_EMAILS_CLI_ASEG_AG",
                    nombre="Reporte Emails Clientes Asegurado Agente",
                    descripcion="Genera reporte con correos segun numaviso del input",
                    requiere_input_archivo=True,
                    tipos_permitidos="csv;xlsx",
                    activo=True,
                    comando="python generar_rep_email_1.py",
                    created_at=now,
                    updated_at=now,
                ),
                Reporte(
                    codigo="RPT_PRUEBAS_1",
                    nombre="Reporte de pruebas",
                    descripcion="Reporte",
                    requiere_input_archivo=False,
                    tipos_permitidos=None,
                    activo=True,
                    comando="python generar_reporte.py",
                    created_at=now,
                    updated_at=now,
                )
            ])
            db.commit()
    finally:
        db.close()
