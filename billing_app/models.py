from __future__ import annotations

from datetime import date
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


DATE_FORMAT = "%d/%m/%Y"
DATE_INPUT_FORMAT = "%Y-%m-%d"
ORDER_STATUSES = ["BOOKED", "IN_PROGRESS", "READY", "DELIVERED", "CANCELLED"]
PAYMENT_MODES = ["Cash", "UPI", "Card", "Bank Transfer", "Mixed"]
TAX_MODES = ["INTRA_STATE", "INTER_STATE"]


def _decimal_from_value(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def normalize_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_date_string(value: Any) -> str | None:
    text = normalize_optional_text(value)
    if not text:
        return None
    for date_format in (DATE_FORMAT, DATE_INPUT_FORMAT):
        try:
            return datetime.strptime(text, date_format).strftime(DATE_FORMAT)
        except ValueError:
            continue
    raise ValueError("Date must be DD/MM/YYYY or YYYY-MM-DD")


def parse_bill_date(value: str | None) -> date | None:
    if not value:
        return None
    return datetime.strptime(value, DATE_FORMAT).date()


class LineItemPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=240)
    hsn_code: str | None = Field(default=None, max_length=40)
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    unit_price: Decimal = Field(ge=0)
    gst_rate: Decimal = Field(default=Decimal("0"), ge=0)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: Any) -> str:
        text = normalize_optional_text(value)
        if not text:
            raise ValueError("Item name is required")
        return text

    @field_validator("description", "hsn_code", mode="before")
    @classmethod
    def normalize_description(cls, value: Any) -> str | None:
        return normalize_optional_text(value)

    @field_validator("quantity", "unit_price", "gst_rate", mode="before")
    @classmethod
    def normalize_decimal(cls, value: Any) -> Decimal:
        return _decimal_from_value(value)


class StoreSettingsPayload(BaseModel):
    store_name: str = Field(default="Clear View", min_length=2, max_length=120)
    store_legal_name: str | None = Field(default="Clear View", max_length=160)
    store_address: str = Field(default="Clear View store address, city, state", min_length=4, max_length=300)
    store_phone: str | None = Field(default=None, max_length=40)
    store_gstin: str | None = Field(default=None, max_length=40)
    store_email: str | None = Field(default=None, max_length=120)
    default_gst_percent: Decimal = Field(default=Decimal("18"), ge=0)
    store_website: str | None = Field(default=None, max_length=120)
    store_state_code: str | None = Field(default=None, max_length=20)
    authorized_signatory: str | None = Field(default="Authorized Signatory", max_length=80)
    footer_note: str = Field(default="This is a computer generated invoice and does not require signature.", max_length=220)
    currency_symbol: str = Field(default="Rs.", max_length=8)
    default_discount_percent: Decimal = Field(default=Decimal("0"), ge=0)
    terms_and_conditions: str | None = Field(default=None, max_length=500)

    @field_validator(
        "store_name",
        "store_legal_name",
        "store_address",
        "store_phone",
        "store_gstin",
        "store_email",
        "store_website",
        "store_state_code",
        "authorized_signatory",
        "footer_note",
        "currency_symbol",
        "terms_and_conditions",
        mode="before",
    )
    @classmethod
    def normalize_text_fields(cls, value: Any) -> str | None:
        return normalize_optional_text(value)

    @field_validator("default_discount_percent", mode="before")
    @classmethod
    def normalize_default_discount(cls, value: Any) -> Decimal:
        return _decimal_from_value(value)

    @field_validator("default_gst_percent", mode="before")
    @classmethod
    def normalize_default_gst_percent(cls, value: Any) -> Decimal:
        return _decimal_from_value(value)


class InvoicePayload(BaseModel):
    source_invoice_id: int | None = Field(default=None, ge=1)
    store_name: str = Field(min_length=2, max_length=120)
    store_address: str = Field(min_length=4, max_length=300)
    store_phone: str | None = Field(default=None, max_length=40)
    store_gstin: str | None = Field(default=None, max_length=40)
    store_email: str | None = Field(default=None, max_length=120)
    customer_email: str | None = Field(default=None, max_length=120)
    invoice_number: str | None = Field(default=None, max_length=40)
    order_reference: str | None = Field(default=None, max_length=60)
    shipment_code: str | None = Field(default=None, max_length=60)
    bill_date: str | None = Field(default=None, max_length=40)
    delivery_date: str | None = Field(default=None, max_length=40)
    status: str = Field(default="BOOKED", max_length=20)
    payment_mode: str | None = Field(default=None, max_length=40)
    staff_name: str | None = Field(default=None, max_length=80)
    customer_name: str | None = Field(default=None, max_length=120)
    customer_address: str | None = Field(default=None, max_length=300)
    customer_phone: str | None = Field(default=None, max_length=40)
    insurance_opt_in: bool = False
    membership_opt_in: bool = False
    advance_cash: bool = False
    advance_gpay: bool = False
    gst_percent: Decimal = Field(default=Decimal("18"), ge=0)
    delivery_name: str | None = Field(default=None, max_length=120)
    delivery_address: str | None = Field(default=None, max_length=300)
    delivery_phone: str | None = Field(default=None, max_length=40)
    gift_from: str | None = Field(default=None, max_length=120)
    gift_to: str | None = Field(default=None, max_length=120)
    customer_comments: str | None = Field(default=None, max_length=500)
    tax_mode: str = Field(default="INTRA_STATE", max_length=20)
    right_eye: str | None = Field(default=None, max_length=500)
    left_eye: str | None = Field(default=None, max_length=500)
    remark: str | None = Field(default=None, max_length=500)
    lens_code_one: str | None = Field(default=None, max_length=80)
    lens_code_two: str | None = Field(default=None, max_length=80)
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0)
    advance_paid: Decimal = Field(default=Decimal("0"), ge=0)
    items: list[LineItemPayload] = Field(min_length=1)

    @field_validator(
        "store_name",
        "store_address",
        "store_phone",
        "store_gstin",
        "store_email",
        "customer_email",
        "invoice_number",
        "order_reference",
        "shipment_code",
        "staff_name",
        "customer_name",
        "customer_address",
        "customer_phone",
        "delivery_name",
        "delivery_address",
        "delivery_phone",
        "gift_from",
        "gift_to",
        "customer_comments",
        "right_eye",
        "left_eye",
        "remark",
        "lens_code_one",
        "lens_code_two",
        mode="before",
    )
    @classmethod
    def normalize_text_fields(cls, value: Any) -> str | None:
        return normalize_optional_text(value)

    @field_validator("bill_date", "delivery_date", mode="before")
    @classmethod
    def normalize_dates(cls, value: Any) -> str | None:
        return normalize_date_string(value)

    @field_validator("gst_percent", "discount_percent", "advance_paid", mode="before")
    @classmethod
    def normalize_money_fields(cls, value: Any) -> Decimal:
        return _decimal_from_value(value)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        normalized = (value or "BOOKED").strip().upper()
        if normalized not in ORDER_STATUSES:
            raise ValueError("Invalid status")
        return normalized

    @field_validator("tax_mode")
    @classmethod
    def validate_tax_mode(cls, value: str) -> str:
        normalized = (value or "INTRA_STATE").strip().upper()
        if normalized not in TAX_MODES:
            raise ValueError("Invalid tax mode")
        return normalized

    @field_validator("payment_mode", mode="before")
    @classmethod
    def normalize_payment_mode(cls, value: Any) -> str | None:
        text = normalize_optional_text(value)
        if not text:
            return None
        if text not in PAYMENT_MODES:
            raise ValueError("Invalid payment mode")
        return text

    @model_validator(mode="after")
    def validate_date_order(self) -> InvoicePayload:
        bill = parse_bill_date(self.bill_date)
        delivery = parse_bill_date(self.delivery_date)
        if bill and delivery and delivery < bill:
            raise ValueError("Delivery date cannot be earlier than bill date")
        return self


class InvoicePreviewResponse(BaseModel):
    preview_token: str
    expires_at: datetime
    preview: dict


class InvoiceConfirmPayload(BaseModel):
    preview_token: str = Field(min_length=8, max_length=128)

    @field_validator("preview_token", mode="before")
    @classmethod
    def normalize_preview_token(cls, value: Any) -> str:
        text = normalize_optional_text(value)
        if not text:
            raise ValueError("Preview token is required")
        return text


class InvoiceStatusPayload(BaseModel):
    status: str = Field(max_length=20)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in ORDER_STATUSES:
            raise ValueError("Invalid status")
        return normalized


class InvoiceTotals(BaseModel):
    total_quantity: Decimal
    subtotal: Decimal
    discount_percent: Decimal
    discount_amount: Decimal
    taxable_subtotal: Decimal
    igst_total: Decimal
    sgst_total: Decimal
    cgst_total: Decimal
    total_tax: Decimal
    subtotal_including_tax: Decimal
    grand_total: Decimal
    advance_paid: Decimal
    balance_due: Decimal


class InvoiceLineCalculated(BaseModel):
    name: str
    description: str | None = None
    hsn_code: str | None = None
    quantity: Decimal
    unit_price: Decimal
    gst_rate: Decimal
    discount_amount: Decimal
    taxable_amount: Decimal
    igst_amount: Decimal
    sgst_amount: Decimal
    cgst_amount: Decimal
    line_total: Decimal


class InvoiceCalculated(BaseModel):
    created_at: datetime
    source_invoice_id: int | None = None
    invoice_number: str
    order_reference: str | None = None
    shipment_code: str | None = None
    bill_date: str
    delivery_date: str | None = None
    status: str
    payment_mode: str | None = None
    staff_name: str | None = None
    store_name: str
    store_address: str
    store_phone: str | None = None
    store_gstin: str | None = None
    store_email: str | None = None
    customer_name: str | None = None
    customer_email: str | None = None
    customer_address: str | None = None
    customer_phone: str | None = None
    insurance_opt_in: bool = False
    membership_opt_in: bool = False
    advance_cash: bool = False
    advance_gpay: bool = False
    gst_percent: Decimal = Decimal("18")
    delivery_name: str | None = None
    delivery_address: str | None = None
    delivery_phone: str | None = None
    gift_from: str | None = None
    gift_to: str | None = None
    customer_comments: str | None = None
    tax_mode: str = "INTRA_STATE"
    right_eye: str | None = None
    left_eye: str | None = None
    remark: str | None = None
    lens_code_one: str | None = None
    lens_code_two: str | None = None
    lines: list[InvoiceLineCalculated]
    totals: InvoiceTotals


class DashboardStats(BaseModel):
    total_invoices: int
    booked_count: int
    ready_count: int
    delivered_count: int
    total_due: Decimal
    today_sales: Decimal
