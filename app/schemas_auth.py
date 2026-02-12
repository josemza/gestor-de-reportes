from pydantic import BaseModel, Field

class LoginIn(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_minutes: int

class MeOut(BaseModel):
    username: str
    activo: int
    roles: list[str]

class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)

class UserCreateIn(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    roles: list[str] = Field(default_factory=lambda: ["USER"])
    activo: int = Field(default=1)

class UserOut(BaseModel):
    id: int
    username: str
    activo: int
    roles: list[str]

class UserCreateOut(UserOut):
    password_temporal: str
