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
    base_lines: list[dict] = []
    subtotal = Decimal("0")
    total_quantity = Decimal("0")

    for item in payload.items:
        base_amount = money(item.quantity * item.unit_price)
        subtotal += base_amount
        total_quantity += item.quantity
        base_lines.append(
            {
                "name": item.name,
                "description": item.description,
                "hsn_code": item.hsn_code,
                "quantity": money(item.quantity),
                "unit_price": money(item.unit_price),
                "gst_rate": money(item.gst_rate),
                "base_amount": base_amount,
            }
        )

    subtotal = money(subtotal)
    total_quantity = money(total_quantity)
    discount_percent = money(payload.discount_percent)
    discount_amount = money(subtotal * discount_percent / Decimal("100"))
    advance_paid = money(payload.advance_paid)
    remaining_discount = discount_amount
    taxable_subtotal = Decimal("0")
    igst_total = Decimal("0")
    sgst_total = Decimal("0")
    cgst_total = Decimal("0")

    for index, item in enumerate(base_lines):
        if subtotal > 0:
            proportional_discount = money(discount_amount * item["base_amount"] / subtotal)
        else:
            proportional_discount = Decimal("0.00")
        if index == len(base_lines) - 1:
            proportional_discount = remaining_discount
        proportional_discount = money(min(proportional_discount, item["base_amount"]))
        remaining_discount = money(max(remaining_discount - proportional_discount, Decimal("0")))

        taxable_amount = money(max(item["base_amount"] - proportional_discount, Decimal("0")))
        gst_rate = item["gst_rate"]
        if payload.tax_mode == "INTER_STATE":
            igst_amount = money(taxable_amount * gst_rate / Decimal("100"))
            sgst_amount = Decimal("0.00")
            cgst_amount = Decimal("0.00")
        else:
            half_rate = gst_rate / Decimal("2")
            igst_amount = Decimal("0.00")
            sgst_amount = money(taxable_amount * half_rate / Decimal("100"))
            cgst_amount = money(taxable_amount * half_rate / Decimal("100"))
        line_total = money(taxable_amount + igst_amount + sgst_amount + cgst_amount)

        taxable_subtotal += taxable_amount
        igst_total += igst_amount
        sgst_total += sgst_amount
        cgst_total += cgst_amount

        lines.append(
            InvoiceLineCalculated(
                name=item["name"],
                description=item["description"],
                hsn_code=item["hsn_code"],
                quantity=item["quantity"],
                unit_price=item["unit_price"],
                gst_rate=gst_rate,
                discount_amount=proportional_discount,
                taxable_amount=taxable_amount,
                igst_amount=igst_amount,
                sgst_amount=sgst_amount,
                cgst_amount=cgst_amount,
                line_total=line_total,
            )
        )

    taxable_subtotal = money(taxable_subtotal)
    igst_total = money(igst_total)
    sgst_total = money(sgst_total)
    cgst_total = money(cgst_total)
    total_tax = money(igst_total + sgst_total + cgst_total)
    subtotal_including_tax = money(taxable_subtotal + total_tax)
    grand_total = subtotal_including_tax
    balance_due = money(max(grand_total - advance_paid, Decimal("0")))

    return InvoiceCalculated(
        created_at=created_on,
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
        customer_address=payload.customer_address,
        customer_phone=payload.customer_phone,
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
            taxable_subtotal=taxable_subtotal,
            igst_total=igst_total,
            sgst_total=sgst_total,
            cgst_total=cgst_total,
            total_tax=total_tax,
            subtotal_including_tax=subtotal_including_tax,
            grand_total=grand_total,
            advance_paid=advance_paid,
            balance_due=balance_due,
        ),
    )
