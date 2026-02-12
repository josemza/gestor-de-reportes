# app/passlib_stub.py
"""
Stub temporal para reemplazar passlib.context.CryptContext
NO usar en producción.
"""

from __future__ import annotations
import os
import base64
import hashlib
import hmac


class CryptContext:
    def __init__(self, schemes=None, deprecated="auto", **kwargs):
        self.schemes = schemes or ["argon2"]
        self.deprecated = deprecated

    def hash(self, password: str) -> str:
        # Hash temporal con scrypt (stdlib), formato compatible interno
        if not password:
            raise ValueError("password vacío")
        salt = os.urandom(16)
        dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
        return "scrypt$16384$8$1${}${}".format(
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(dk).decode("ascii"),
        )

    def verify(self, password: str, stored_hash: str) -> bool:
        try:
            if stored_hash.startswith("scrypt$"):
                _, n, r, p, salt_b64, hash_b64 = stored_hash.split("$")
                salt = base64.b64decode(salt_b64.encode("ascii"))
                expected = base64.b64decode(hash_b64.encode("ascii"))
                got = hashlib.scrypt(
                    password.encode("utf-8"),
                    salt=salt,
                    n=int(n),
                    r=int(r),
                    p=int(p),
                    dklen=len(expected),
                )
                return hmac.compare_digest(got, expected)

            # Si ya existe hash argon2 real, este stub no puede verificarlo.
            # Devuelve False para evitar falsos positivos.
            if stored_hash.startswith("$argon2"):
                return False

            return False
        except Exception:
            return False

    def needs_update(self, password_hash: str) -> bool:
        # Forzamos True para que luego, con passlib real, se pueda rehash oportunista.
        return True