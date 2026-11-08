import re
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

BG = Literal["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
_PHONE = re.compile(r"^[0-9+()\-\s]{7,20}$")
Text = lambda n, m=80: Field(min_length=n, max_length=m)  # noqa: E731


class Strip(BaseModel):
    @field_validator("*", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v


def _phone(v):
    if v in (None, ""):
        return None
    if not _PHONE.match(v):
        raise ValueError("Enter a valid phone number")
    return v


class RegisterIn(Strip):
    name: str = Text(2, 60)
    email: str
    password: str = Field(min_length=8, max_length=128)
    role: Literal["donor", "requester"]
    city: str = Text(2, 60)
    phone: Optional[str] = None
    blood_group: Optional[BG] = None
    accept_terms: bool

    @field_validator("email")
    @classmethod
    def _e(cls, v):
        if not _EMAIL.match(v):
            raise ValueError("Enter a valid email address")
        return v.lower()

    @field_validator("password")
    @classmethod
    def _p(cls, v):
        if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
            raise ValueError("Password needs at least one letter and one number")
        return v

    @field_validator("phone")
    @classmethod
    def _ph(cls, v):
        return _phone(v)

    @field_validator("accept_terms")
    @classmethod
    def _t(cls, v):
        if not v:
            raise ValueError("You must confirm you are 18+ and accept the terms")
        return v


class LoginIn(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=128)


class DonorProfileIn(Strip):
    blood_group: BG
    city: str = Text(2, 60)
    phone: Optional[str] = None
    available: bool
    last_donation: Optional[date] = None

    @field_validator("phone")
    @classmethod
    def _ph(cls, v):
        return _phone(v)

    @field_validator("last_donation")
    @classmethod
    def _d(cls, v):
        if v and v > date.today():
            raise ValueError("Last donation cannot be in the future")
        return v


class RequestIn(Strip):
    patient_label: str = Text(2, 40)  # alias/initials only - never full medical details
    blood_group: BG
    units: int = Field(ge=1, le=10)
    city: str = Text(2, 60)
    hospital: str = Text(2, 100)
    urgency: Literal["routine", "urgent", "critical"]
    needed_by: Optional[date] = None
    note: Optional[str] = Field(default=None, max_length=300)


class StatusIn(Strip):
    status: Literal["open", "fulfilled", "cancelled"]
    note: Optional[str] = Field(default=None, max_length=200)


class InviteIn(BaseModel):
    donor_id: int


class RespondIn(BaseModel):
    share_contact: bool = False


class OfferRespondIn(RespondIn):
    action: Literal["accept", "decline"]


class AdminUserIn(BaseModel):
    active: bool


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
