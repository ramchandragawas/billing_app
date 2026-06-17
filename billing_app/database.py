from __future__ import annotations

import json
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from billing_app.calculator import build_invoice_number
from billing_app.calculator import calculate_invoice
from billing_app.models import DashboardStats
from billing_app.models import InvoiceCalculated
from billing_app.models import InvoicePayload
from billing_app.models import StoreSettingsPayload


AUTO_NUMBER_PATTERN = re.compile(r"^CV-(\d+)$")
DRAFT_TTL_MINUTES = 30


class InvoiceConflictError(Exception):
    """Raised when an invoice number is already reserved or used."""


class DraftNotFoundError(Exception):
    """Raised when a preview draft token is missing or expired."""


class BillingDatabase:
    def __init__(self, db_path: Path):
        self.db_path = db_path

    def initialize(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._managed_connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=5000")

            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS invoices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    invoice_number TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    bill_date TEXT,
                    delivery_date TEXT,
                    status TEXT,
                    customer_name TEXT,
                    customer_phone TEXT,
                    grand_total TEXT,
                    balance_due TEXT,
                    payload_json TEXT NOT NULL,
                    calculation_json TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS store_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    settings_json TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS app_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS invoice_drafts (
                    preview_token TEXT PRIMARY KEY,
                    invoice_number TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                )
                """
            )

            self._ensure_invoice_column(connection, "bill_date", "TEXT")
            self._ensure_invoice_column(connection, "delivery_date", "TEXT")
            self._ensure_invoice_column(connection, "status", "TEXT")
            self._ensure_invoice_column(connection, "customer_phone", "TEXT")
            self._ensure_invoice_column(connection, "grand_total", "TEXT")
            self._ensure_invoice_column(connection, "balance_due", "TEXT")

            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_invoices_status_created ON invoices(status, created_at DESC)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_invoices_customer_phone ON invoices(customer_phone)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_invoice_drafts_expires_at ON invoice_drafts(expires_at)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_invoice_drafts_invoice_number ON invoice_drafts(invoice_number)"
            )

            self._seed_settings(connection)
            self._seed_sequence(connection)
            self._purge_expired_drafts(connection)

    def get_settings(self) -> dict:
        defaults = StoreSettingsPayload().model_dump(mode="json")
        with self._managed_connection() as connection:
            row = connection.execute("SELECT settings_json FROM store_settings WHERE id = 1").fetchone()
        if not row:
            return defaults
        stored = json.loads(row["settings_json"])
        defaults.update(stored)
        return defaults

    def save_settings(self, payload: StoreSettingsPayload) -> dict:
        with self._managed_connection() as connection:
            connection.execute(
                """
                INSERT INTO store_settings (id, settings_json)
                VALUES (1, ?)
                ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json
                """,
                (payload.model_dump_json(),),
            )
        return self.get_settings()

    def next_invoice_number(self) -> str:
        with self._managed_connection() as connection:
            return self._peek_next_invoice_number(connection)

    def create_invoice_draft(self, payload: InvoicePayload) -> dict:
        with self._managed_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._purge_expired_drafts(connection)

            invoice_number = payload.invoice_number or self._reserve_invoice_number(connection)
            if payload.invoice_number and self._invoice_number_in_use(connection, invoice_number):
                raise InvoiceConflictError(f"Invoice number {invoice_number} is already in use.")

            preview_token = uuid.uuid4().hex
            created_at = datetime.now()
            expires_at = created_at + timedelta(minutes=DRAFT_TTL_MINUTES)
            connection.execute(
                """
                INSERT INTO invoice_drafts (
                    preview_token,
                    invoice_number,
                    created_at,
                    expires_at,
                    payload_json
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    preview_token,
                    invoice_number,
                    created_at.isoformat(),
                    expires_at.isoformat(),
                    payload.model_dump_json(),
                ),
            )
            connection.commit()

        calculated = calculate_invoice(payload, invoice_number=invoice_number)
        return {
            "preview_token": preview_token,
            "expires_at": expires_at,
            "preview": calculated.model_dump(mode="json"),
        }

    def confirm_invoice_draft(self, preview_token: str) -> dict:
        with self._managed_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._purge_expired_drafts(connection)
            draft = connection.execute(
                """
                SELECT preview_token, invoice_number, payload_json
                FROM invoice_drafts
                WHERE preview_token = ?
                """,
                (preview_token,),
            ).fetchone()
            if not draft:
                raise DraftNotFoundError("Preview draft not found or expired.")

            invoice_number = draft["invoice_number"]
            if self._invoice_number_exists(connection, invoice_number):
                raise InvoiceConflictError(f"Invoice number {invoice_number} is already used.")

            payload = InvoicePayload.model_validate(json.loads(draft["payload_json"]))
            calculated = calculate_invoice(payload, invoice_number=invoice_number)
            cursor = connection.execute(
                """
                INSERT INTO invoices (
                    invoice_number,
                    created_at,
                    bill_date,
                    delivery_date,
                    status,
                    customer_name,
                    customer_phone,
                    grand_total,
                    balance_due,
                    payload_json,
                    calculation_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    calculated.invoice_number,
                    calculated.created_at.isoformat(),
                    calculated.bill_date,
                    calculated.delivery_date,
                    calculated.status,
                    calculated.customer_name,
                    calculated.customer_phone,
                    str(calculated.totals.grand_total),
                    str(calculated.totals.balance_due),
                    payload.model_dump_json(),
                    calculated.model_dump_json(),
                ),
            )
            invoice_id = cursor.lastrowid
            connection.execute("DELETE FROM invoice_drafts WHERE preview_token = ?", (preview_token,))
            connection.commit()

        invoice = self.get_invoice(invoice_id)
        return {
            "id": invoice_id,
            "invoice_number": calculated.invoice_number,
            "created_at": calculated.created_at.isoformat(),
            "invoice": invoice,
        }

    def update_invoice_status(self, invoice_id: int, status: str) -> dict | None:
        invoice = self.get_invoice(invoice_id)
        if not invoice:
            return None

        payload = invoice["payload"]
        calculated = invoice["calculated"]
        payload["status"] = status
        calculated["status"] = status

        with self._managed_connection() as connection:
            connection.execute(
                """
                UPDATE invoices
                SET status = ?, payload_json = ?, calculation_json = ?
                WHERE id = ?
                """,
                (status, json.dumps(payload), json.dumps(calculated), invoice_id),
            )
        return self.get_invoice(invoice_id)

    def get_invoice(self, invoice_id: int) -> dict | None:
        with self._managed_connection() as connection:
            row = connection.execute(
                """
                SELECT id, invoice_number, created_at, bill_date, delivery_date, status,
                       customer_name, customer_phone, grand_total, balance_due, payload_json, calculation_json
                FROM invoices
                WHERE id = ?
                """,
                (invoice_id,),
            ).fetchone()
        return self._row_to_invoice(row) if row else None

    def list_invoices(self, limit: int = 25, query: str | None = None, status: str | None = None) -> list[dict]:
        clauses: list[str] = []
        params: list[object] = []

        if query:
            like = f"%{query.strip()}%"
            clauses.append("(invoice_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)")
            params.extend([like, like, like])
        if status and status != "ALL":
            clauses.append("status = ?")
            params.append(status)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)

        with self._managed_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT id, invoice_number, created_at, bill_date, delivery_date, status,
                       customer_name, customer_phone, grand_total, balance_due, payload_json, calculation_json
                FROM invoices
                {where_sql}
                ORDER BY id DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [self._row_to_invoice(row) for row in rows]

    def recent_customers(self, query: str | None = None, limit: int = 8) -> list[dict]:
        clauses = ["(customer_name IS NOT NULL OR customer_phone IS NOT NULL)"]
        params: list[object] = []
        if query:
            like = f"%{query.strip()}%"
            clauses.append("(customer_name LIKE ? OR customer_phone LIKE ?)")
            params.extend([like, like])
        params.append(limit)

        with self._managed_connection() as connection:
            rows = connection.execute(
                f"""
                SELECT MAX(id) AS latest_invoice_id, customer_name, customer_phone,
                       MAX(created_at) AS last_seen
                FROM invoices
                WHERE {' AND '.join(clauses)}
                GROUP BY customer_name, customer_phone
                ORDER BY MAX(created_at) DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [
            {
                "latest_invoice_id": row["latest_invoice_id"],
                "customer_name": row["customer_name"],
                "customer_phone": row["customer_phone"],
                "last_seen": row["last_seen"],
            }
            for row in rows
        ]

    def dashboard_stats(self) -> dict:
        today = datetime.now().strftime("%Y-%m-%d")
        with self._managed_connection() as connection:
            total_invoices = connection.execute("SELECT COUNT(*) FROM invoices").fetchone()[0]
            status_rows = connection.execute(
                "SELECT status, COUNT(*) AS count FROM invoices GROUP BY status"
            ).fetchall()
            due_rows = connection.execute("SELECT balance_due FROM invoices WHERE status != 'CANCELLED'").fetchall()
            sales_rows = connection.execute(
                "SELECT grand_total FROM invoices WHERE substr(created_at, 1, 10) = ?",
                (today,),
            ).fetchall()

        counts = {row["status"] or "BOOKED": row["count"] for row in status_rows}
        total_due = sum(Decimal(row["balance_due"] or "0") for row in due_rows)
        today_sales = sum(Decimal(row["grand_total"] or "0") for row in sales_rows)

        stats = DashboardStats(
            total_invoices=total_invoices,
            booked_count=counts.get("BOOKED", 0) + counts.get("IN_PROGRESS", 0),
            ready_count=counts.get("READY", 0),
            delivered_count=counts.get("DELIVERED", 0),
            total_due=total_due,
            today_sales=today_sales,
        )
        return stats.model_dump(mode="json")

    def export_invoice_rows(self, query: str | None = None, status: str | None = None) -> list[dict]:
        invoices = self.list_invoices(limit=5000, query=query, status=status)
        rows: list[dict] = []
        for invoice in invoices:
            calculated = invoice["calculated"]
            totals = calculated["totals"]
            lines = calculated.get("lines", [])
            row = {
                "invoice_number": invoice["invoice_number"],
                "order_reference": calculated.get("order_reference") or "",
                "shipment_code": calculated.get("shipment_code") or "",
                "bill_date": invoice["bill_date"] or "",
                "delivery_date": invoice["delivery_date"] or "",
                "status": invoice["status"] or "",
                "customer_name": invoice["customer_name"] or "",
                "customer_phone": invoice["customer_phone"] or "",
                "customer_address": calculated.get("customer_address") or "",
                "delivery_name": calculated.get("delivery_name") or "",
                "delivery_phone": calculated.get("delivery_phone") or "",
                "delivery_address": calculated.get("delivery_address") or "",
                "payment_mode": calculated.get("payment_mode") or "",
                "tax_mode": calculated.get("tax_mode") or "",
                "customer_comments": calculated.get("customer_comments") or calculated.get("remark") or "",
                "gift_from": calculated.get("gift_from") or "",
                "gift_to": calculated.get("gift_to") or "",
                "total_quantity": totals.get("total_quantity") or "0.00",
                "subtotal": totals.get("subtotal") or "0.00",
                "discount_percent": totals.get("discount_percent") or "0.00",
                "discount_amount": totals.get("discount_amount") or "0.00",
                "taxable_subtotal": totals.get("taxable_subtotal") or "0.00",
                "igst_total": totals.get("igst_total") or "0.00",
                "sgst_total": totals.get("sgst_total") or "0.00",
                "cgst_total": totals.get("cgst_total") or "0.00",
                "total_tax": totals.get("total_tax") or "0.00",
                "subtotal_including_tax": totals.get("subtotal_including_tax") or "0.00",
                "grand_total": totals.get("grand_total") or "0.00",
                "advance_paid": totals.get("advance_paid") or "0.00",
                "balance_due": totals.get("balance_due") or "0.00",
                "item_summary": "",
            }

            item_parts: list[str] = []
            for line in lines:
                item_parts.append(
                    " | ".join(
                        part
                        for part in [
                            line.get("name") or "",
                            line.get("description") or "",
                            f"HSN {line.get('hsn_code')}" if line.get("hsn_code") else "",
                            f"Qty {line.get('quantity')}" if line.get("quantity") else "",
                            f"Rate {line.get('unit_price')}" if line.get("unit_price") else "",
                            f"GST {line.get('gst_rate')}%" if line.get("gst_rate") is not None else "",
                            f"Total {line.get('line_total')}" if line.get("line_total") else "",
                        ]
                        if part
                    )
                )
            row["item_summary"] = " || ".join(item_parts)

            rows.append(row)
        return rows

    def create_database_backup(self) -> Path:
        export_dir = self.db_path.parent / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        backup_path = export_dir / f"billing-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
        with self._managed_connection() as source:
            destination = sqlite3.connect(backup_path)
            try:
                source.backup(destination)
            finally:
                destination.close()
        return backup_path

    def health(self) -> dict:
        with self._managed_connection() as connection:
            invoice_count = connection.execute("SELECT COUNT(*) FROM invoices").fetchone()[0]
            draft_count = connection.execute("SELECT COUNT(*) FROM invoice_drafts").fetchone()[0]
        return {
            "status": "ok",
            "database_path": str(self.db_path),
            "invoice_count": invoice_count,
            "draft_count": draft_count,
        }

    def _seed_settings(self, connection: sqlite3.Connection) -> None:
        row = connection.execute("SELECT id FROM store_settings WHERE id = 1").fetchone()
        if row:
            return
        connection.execute(
            "INSERT INTO store_settings (id, settings_json) VALUES (1, ?)",
            (StoreSettingsPayload().model_dump_json(),),
        )

    def _seed_sequence(self, connection: sqlite3.Connection) -> None:
        row = connection.execute("SELECT value FROM app_meta WHERE key = 'next_invoice_sequence'").fetchone()
        if row:
            return
        invoice_rows = connection.execute("SELECT invoice_number FROM invoices").fetchall()
        max_sequence = 0
        for invoice_row in invoice_rows:
            sequence = self._extract_auto_sequence(invoice_row["invoice_number"])
            if sequence > max_sequence:
                max_sequence = sequence
        connection.execute(
            "INSERT INTO app_meta (key, value) VALUES ('next_invoice_sequence', ?)",
            (str(max_sequence + 1),),
        )

    def _reserve_invoice_number(self, connection: sqlite3.Connection) -> str:
        row = connection.execute("SELECT value FROM app_meta WHERE key = 'next_invoice_sequence'").fetchone()
        current = int(row["value"]) if row else 1
        connection.execute(
            """
            INSERT INTO app_meta (key, value)
            VALUES ('next_invoice_sequence', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (str(current + 1),),
        )
        return build_invoice_number(current)

    def _peek_next_invoice_number(self, connection: sqlite3.Connection) -> str:
        row = connection.execute("SELECT value FROM app_meta WHERE key = 'next_invoice_sequence'").fetchone()
        current = int(row["value"]) if row else 1
        return build_invoice_number(current)

    def _invoice_number_in_use(self, connection: sqlite3.Connection, invoice_number: str) -> bool:
        return self._invoice_number_exists(connection, invoice_number) or self._invoice_number_reserved(connection, invoice_number)

    def _invoice_number_exists(self, connection: sqlite3.Connection, invoice_number: str) -> bool:
        row = connection.execute(
            "SELECT 1 FROM invoices WHERE invoice_number = ? LIMIT 1",
            (invoice_number,),
        ).fetchone()
        return bool(row)

    def _invoice_number_reserved(self, connection: sqlite3.Connection, invoice_number: str) -> bool:
        row = connection.execute(
            "SELECT 1 FROM invoice_drafts WHERE invoice_number = ? LIMIT 1",
            (invoice_number,),
        ).fetchone()
        return bool(row)

    def _extract_auto_sequence(self, invoice_number: str | None) -> int:
        if not invoice_number:
            return 0
        match = AUTO_NUMBER_PATTERN.match(invoice_number)
        if not match:
            return 0
        return int(match.group(1))

    def _purge_expired_drafts(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            "DELETE FROM invoice_drafts WHERE expires_at <= ?",
            (datetime.now().isoformat(),),
        )

    def _ensure_invoice_column(self, connection: sqlite3.Connection, name: str, column_type: str) -> None:
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(invoices)").fetchall()}
        if name not in columns:
            connection.execute(f"ALTER TABLE invoices ADD COLUMN {name} {column_type}")

    def _row_to_invoice(self, row: sqlite3.Row) -> dict:
        payload = json.loads(row["payload_json"])
        calculated = json.loads(row["calculation_json"])
        return {
            "id": row["id"],
            "invoice_number": row["invoice_number"],
            "created_at": row["created_at"],
            "created_date": datetime.fromisoformat(row["created_at"]).strftime("%d %b %Y %I:%M %p"),
            "bill_date": row["bill_date"],
            "delivery_date": row["delivery_date"],
            "status": row["status"] or calculated.get("status", "BOOKED"),
            "customer_name": row["customer_name"],
            "customer_phone": row["customer_phone"],
            "grand_total": row["grand_total"],
            "balance_due": row["balance_due"],
            "payload": payload,
            "calculated": calculated,
        }

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _managed_connection(self):
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()
