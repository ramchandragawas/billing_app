from __future__ import annotations

import csv
import io
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from billing_app.database import BillingDatabase
from billing_app.database import DraftNotFoundError
from billing_app.database import InvoiceConflictError
from billing_app.models import InvoiceConfirmPayload
from billing_app.models import ORDER_STATUSES
from billing_app.models import InvoicePayload
from billing_app.models import InvoiceStatusPayload
from billing_app.models import StoreSettingsPayload
from billing_app.printer import PrinterService
from billing_app.printer import build_text_bill


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("BILLING_DB_PATH", str(BASE_DIR / "data" / "billing.db")))
STATIC_DIR = BASE_DIR / "static"

database = BillingDatabase(DB_PATH)
printer_service = PrinterService()
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class PrintPayload(BaseModel):
    printer_name: str


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.initialize()
    yield


app = FastAPI(
    title="Clear View Billing",
    description="Store billing, tax invoice printing, customer history, and order tracking.",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request) -> HTMLResponse:
    response = templates.TemplateResponse(
        request,
        "index.html",
        {
            "settings": database.get_settings(),
            "stats": database.dashboard_stats(),
            "invoices": database.list_invoices(limit=20),
            "customers": database.recent_customers(limit=8),
            "printer_info": printer_service.list_printers(),
            "statuses": ["ALL", *ORDER_STATUSES],
        },
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/healthz")
async def healthz():
    return database.health()


@app.get("/manifest.webmanifest")
async def manifest():
    settings = database.get_settings()
    return {
        "name": settings["store_name"],
        "short_name": settings["store_name"],
        "description": "Store billing and tax invoice app",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#f3eee7",
        "theme_color": "#16313c",
        "icons": [
            {"src": "/static/icons/app-icon.svg", "sizes": "512x512", "type": "image/svg+xml", "purpose": "any"},
            {"src": "/static/icons/app-maskable.svg", "sizes": "512x512", "type": "image/svg+xml", "purpose": "maskable"},
        ],
    }


@app.get("/service-worker.js")
async def service_worker():
    return FileResponse(
        STATIC_DIR / "service-worker.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/api/settings")
async def get_settings():
    return database.get_settings()


@app.put("/api/settings")
async def save_settings(payload: StoreSettingsPayload):
    return database.save_settings(payload)


@app.get("/api/stats")
async def get_stats():
    return database.dashboard_stats()


@app.get("/api/printers")
async def get_printers():
    return printer_service.list_printers()


@app.get("/api/customers")
async def get_customers(query: str | None = None, limit: int = 8):
    return database.recent_customers(query=query, limit=limit)


@app.get("/api/invoices")
async def list_invoices(limit: int = 25, query: str | None = None, status: str | None = None):
    return database.list_invoices(limit=limit, query=query, status=status)


@app.post("/api/invoices/preview")
async def preview_invoice(payload: InvoicePayload):
    try:
        draft = database.create_invoice_draft(payload)
    except InvoiceConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return {
        "message": "Preview generated successfully.",
        "preview_token": draft["preview_token"],
        "expires_at": draft["expires_at"].isoformat(),
        "preview": draft["preview"],
    }


@app.post("/api/invoices")
async def confirm_invoice(payload: InvoiceConfirmPayload):
    try:
        saved = database.confirm_invoice_draft(payload.preview_token)
    except DraftNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail=str(exc)) from exc
    except InvoiceConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return {
        "message": "Invoice created successfully.",
        "invoice": saved["invoice"],
        "print_preview_url": f"/invoices/{saved['id']}/print",
    }


@app.get("/api/export/invoices.csv")
async def export_invoices_csv(query: str | None = None, status: str | None = None):
    rows = database.export_invoice_rows(query=query, status=status)
    output = io.StringIO()
    fieldnames = [
        "invoice_number",
        "order_reference",
        "shipment_code",
        "bill_date",
        "delivery_date",
        "status",
        "customer_name",
        "customer_phone",
        "customer_address",
        "delivery_name",
        "delivery_phone",
        "delivery_address",
        "payment_mode",
        "tax_mode",
        "gift_from",
        "gift_to",
        "customer_comments",
        "item_summary",
        "total_quantity",
        "subtotal",
        "discount_percent",
        "discount_amount",
        "taxable_subtotal",
        "igst_total",
        "sgst_total",
        "cgst_total",
        "total_tax",
        "subtotal_including_tax",
        "grand_total",
        "advance_paid",
        "balance_due",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    csv_bytes = output.getvalue().encode("utf-8-sig")
    filename = f"bills-export-{Path(database.db_path).stem}.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(io.BytesIO(csv_bytes), media_type="text/csv; charset=utf-8", headers=headers)


@app.get("/api/export/database")
async def export_database():
    backup_path = database.create_database_backup()
    return FileResponse(
        backup_path,
        media_type="application/octet-stream",
        filename=backup_path.name,
    )


@app.get("/api/invoices/{invoice_id}")
async def get_invoice(invoice_id: int):
    invoice = database.get_invoice(invoice_id)
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found.")
    return invoice


@app.patch("/api/invoices/{invoice_id}/status")
async def update_invoice_status(invoice_id: int, payload: InvoiceStatusPayload):
    invoice = database.update_invoice_status(invoice_id, payload.status)
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found.")
    return {"message": "Status updated.", "invoice": invoice}


@app.get("/invoices/{invoice_id}/print", response_class=HTMLResponse)
async def print_preview(invoice_id: int, request: Request):
    invoice = database.get_invoice(invoice_id)
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found.")
    response = templates.TemplateResponse(
        request,
        "invoice_print.html",
        {"invoice": invoice, "settings": database.get_settings()},
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/invoices/{invoice_id}/print/raw")
async def print_invoice(invoice_id: int, payload: PrintPayload):
    invoice = database.get_invoice(invoice_id)
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found.")

    result = printer_service.print_text_bill(payload.printer_name, build_text_bill(invoice))
    result["preview_url"] = f"/invoices/{invoice_id}/print"
    return result
