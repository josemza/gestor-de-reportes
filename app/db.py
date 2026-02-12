from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.db_conn.engine import get_engine

engine = get_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()