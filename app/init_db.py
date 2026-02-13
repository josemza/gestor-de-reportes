from datetime import datetime, timezone
from sqlalchemy import select, func, inspect, text
from .db import Base, engine, SessionLocal
from .models import Reporte
from .models_auth import Rol, Usuario, UsuarioRol
from .security import hash_password


def init_db():
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # --- 1. Inicialización de ROLES ---
        count_roles = db.execute(select(func.count()).select_from(Rol)).scalar_one()
        if count_roles == 0:
            rol_admin = Rol(nombre="ADMIN")
            rol_user = Rol(nombre="USER")
            db.add_all([rol_admin, rol_user])
            db.commit()
            print("Roles creados.")

        # --- 2. Inicialización de USUARIO ADMIN ---
        # Verificamos si ya existe el usuario 'admin'
        admin_exists = db.execute(select(Usuario).where(Usuario.username == "admin")).scalar_one_or_none()
        
        if not admin_exists:
            # Creamos el objeto Usuario
            new_admin = Usuario(
                username="admin",
                # Nota: Aquí deberías usar un hash real (ej. de passlib o bcrypt)
                password_hash=hash_password("Admin123!"), 
                activo=1,
                created_at=datetime.now(timezone.utc)
            )
            db.add(new_admin)
            db.flush() # flush() envía el objeto a la DB para obtener el ID sin cerrar la transacción

            # --- 3. Asignación de ROL al ADMIN ---
            # Buscamos el objeto del rol ADMIN que acabamos de crear (o que ya existía)
            admin_role = db.execute(select(Rol).where(Rol.nombre == "ADMIN")).scalar_one()
            
            # Creamos la relación en la tabla intermedia
            relacion = UsuarioRol(usuario_id=new_admin.id, rol_id=admin_role.id)
            db.add(relacion)
            
            db.commit()
            print("Usuario admin creado y rol asignado.")

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
