from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMModel


class ContactRead(ORMModel):
    id: int
    name: str
    email: EmailStr
    company: str | None
    department: str | None
    note: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ContactUpsert(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    email: EmailStr
    company: str | None = None
    department: str | None = None
    note: str | None = None
    is_active: bool = True


class UserRead(ORMModel):
    id: int
    code: str
    display_name: str
    email: str | None
    department: str | None
    is_active: bool


class UserUpsert(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    display_name: str = Field(min_length=1, max_length=128)
    email: EmailStr | None = None
    department: str | None = None
    is_active: bool = True


class ProgressStepUpsert(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=64)
    short_label: str = Field(min_length=1, max_length=8)
    sort_order: int = 0
    is_active: bool = True
