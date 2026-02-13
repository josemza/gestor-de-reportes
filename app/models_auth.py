from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, UniqueConstraint, Identity
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db import Base

class Usuario(Base):
    __tablename__ = "USUARIOS_REP_GCI"

    id: Mapped[int] = mapped_column("USUARIO_ID", Integer, Identity(start=1), primary_key=True)
    username: Mapped[str] = mapped_column("USERNAME", String(100), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column("PASSWORD_HASH", String(500), nullable=False)
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False)  # 1/0
    created_at: Mapped[datetime] = mapped_column("CREATED_AT", DateTime, default=datetime.utcnow, nullable=False)

    roles = relationship("UsuarioRol", back_populates="usuario", cascade="all, delete-orphan")

class Rol(Base):
    __tablename__ = "ROLES_REP_GCI"

    id: Mapped[int] = mapped_column("ROL_ID", Integer, Identity(start=1), primary_key=True)
    nombre: Mapped[str] = mapped_column("NOMBRE", String(80), unique=True, nullable=False)

    usuarios = relationship("UsuarioRol", back_populates="rol", cascade="all, delete-orphan")

class UsuarioRol(Base):
    __tablename__ = "USUARIO_ROL_REP_GCI"
    __table_args__ = (UniqueConstraint("USUARIO_ID", "ROL_ID", name="UQ_USUARIO_ROL"),)

    id: Mapped[int] = mapped_column("USUARIO_ROL_ID", Integer, Identity(start=1), primary_key=True)
    usuario_id: Mapped[int] = mapped_column("USUARIO_ID", ForeignKey("USUARIOS_REP_GCI.USUARIO_ID"), nullable=False)
    rol_id: Mapped[int] = mapped_column("ROL_ID", ForeignKey("ROLES_REP_GCI.ROL_ID"), nullable=False)

    usuario = relationship("Usuario", back_populates="roles")
    rol = relationship("Rol", back_populates="usuarios")


class Equipo(Base):
    __tablename__ = "EQUIPOS_REP_GCI"

    id: Mapped[int] = mapped_column("EQUIPO_ID", Integer, Identity(start=1), primary_key=True)
    nombre: Mapped[str] = mapped_column("NOMBRE", String(120), unique=True, nullable=False, index=True)
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False)

    usuarios = relationship("UsuarioEquipo", back_populates="equipo", cascade="all, delete-orphan")


class UsuarioEquipo(Base):
    __tablename__ = "USUARIO_EQUIPO_REP_GCI"
    __table_args__ = (UniqueConstraint("USUARIO_ID", "EQUIPO_ID", name="UQ_USUARIO_EQUIPO"),)

    id: Mapped[int] = mapped_column("USUARIO_EQUIPO_ID", Integer, Identity(start=1), primary_key=True)
    usuario_id: Mapped[int] = mapped_column("USUARIO_ID", ForeignKey("USUARIOS_REP_GCI.USUARIO_ID"), nullable=False)
    equipo_id: Mapped[int] = mapped_column("EQUIPO_ID", ForeignKey("EQUIPOS_REP_GCI.EQUIPO_ID"), nullable=False)
    activo: Mapped[int] = mapped_column("ACTIVO", Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column("CREATED_AT", DateTime, default=datetime.utcnow, nullable=False)

    usuario = relationship("Usuario")
    equipo = relationship("Equipo", back_populates="usuarios")
