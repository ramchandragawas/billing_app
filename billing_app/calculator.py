from __future__ import annotations

from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from billing_app.models import InvoiceCalculated
from billing_app.models import InvoiceLineCalculated
from billing_app.models import InvoicePayload
from billing_app.models import InvoiceTotals


TWOPLACES = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def build_invoice_number(sequence: int) -> str:
    return f"CV-{sequence:05d}"


def calculate_invoice(payload: InvoicePayload, invoice_number: str, created_at: datetime | None = None) -> InvoiceCalculated:
    created_on = created_at or datetime.now()
    lines: list[InvoiceLineCalculated] = []
    subtotal = Decimal("0")
    total_quantity = Decimal("0")

    for item in payload.items:
        base_amount = money(item.quantity * item.unit_price)
        subtotal += base_amount
        total_quantity += item.quantity
        lines.append(
            InvoiceLineCalculated(
                name=item.name,
                description=item.description,
                hsn_code=item.hsn_code,
                quantity=money(item.quantity),
                unit_price=money(item.unit_price),
                gst_rate=money(item.gst_rate),
                discount_amount=Decimal("0.00"),
                taxable_amount=base_amount,
                igst_amount=Decimal("0.00"),
                sgst_amount=Decimal("0.00"),
                cgst_amount=Decimal("0.00"),
                line_total=base_amount,
            )
        )

    subtotal = money(subtotal)
    total_quantity = money(total_quantity)
    gst_percent = money(payload.gst_percent)
    gst_amount = money(subtotal * gst_percent / Decimal("100"))
    subtotal_including_tax = money(subtotal + gst_amount)
    discount_percent = money(payload.discount_percent)
    discount_amount = money(subtotal_including_tax * discount_percent / Decimal("100"))
    grand_total = money(max(subtotal_including_tax - discount_amount, Decimal("0")))
    advance_paid = money(payload.advance_paid)
    balance_due = money(max(grand_total - advance_paid, Decimal("0")))

    return InvoiceCalculated(
        created_at=created_on,
        source_invoice_id=payload.source_invoice_id,
        invoice_number=payload.invoice_number or invoice_number,
        order_reference=payload.order_reference,
        shipment_code=payload.shipment_code,
        bill_date=payload.bill_date or created_on.strftime("%d/%m/%Y"),
        delivery_date=payload.delivery_date,
        status=payload.status,
        payment_mode=payload.payment_mode,
        staff_name=payload.staff_name,
        store_name=payload.store_name,
        store_address=payload.store_address,
        store_phone=payload.store_phone,
        store_gstin=payload.store_gstin,
        store_email=payload.store_email,
        customer_name=payload.customer_name,
        customer_email=payload.customer_email,
        customer_address=payload.customer_address,
        customer_phone=payload.customer_phone,
        insurance_opt_in=payload.insurance_opt_in,
        membership_opt_in=payload.membership_opt_in,
        advance_cash=payload.advance_cash,
        advance_gpay=payload.advance_gpay,
        gst_percent=gst_percent,
        delivery_name=payload.delivery_name or payload.customer_name,
        delivery_address=payload.delivery_address or payload.customer_address,
        delivery_phone=payload.delivery_phone or payload.customer_phone,
        gift_from=payload.gift_from,
        gift_to=payload.gift_to,
        customer_comments=payload.customer_comments or payload.remark,
        tax_mode=payload.tax_mode,
        right_eye=payload.right_eye,
        left_eye=payload.left_eye,
        remark=payload.remark,
        lens_code_one=payload.lens_code_one,
        lens_code_two=payload.lens_code_two,
        lines=lines,
        totals=InvoiceTotals(
            total_quantity=total_quantity,
            subtotal=subtotal,
            discount_percent=discount_percent,
            discount_amount=discount_amount,
            taxable_subtotal=subtotal,
            igst_total=Decimal("0.00"),
            sgst_total=Decimal("0.00"),
            cgst_total=Decimal("0.00"),
            total_tax=gst_amount,
            subtotal_including_tax=subtotal_including_tax,
            grand_total=grand_total,
            advance_paid=advance_paid,
            balance_due=balance_due,
        ),
    )
