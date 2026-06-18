from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


class PrinterService:
    def list_printers(self) -> dict:
        commands = [
            "Get-Printer | Select-Object Name, Default | ConvertTo-Json",
            "Get-CimInstance -ClassName Win32_Printer | Select-Object Name, Default | ConvertTo-Json",
            "Get-WmiObject Win32_Printer | Select-Object Name, Default | ConvertTo-Json",
        ]
        errors: list[str] = []

        for command in commands:
            try:
                result = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", command],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=8,
                )
            except (FileNotFoundError, subprocess.CalledProcessError) as exc:
                errors.append(str(exc))
                continue
            except subprocess.TimeoutExpired as exc:
                errors.append(f"Printer lookup timed out: {exc}")
                continue

            output = result.stdout.strip()
            if not output:
                return {"available": True, "printers": [], "message": "No printers found."}

            printers = json.loads(output)
            if isinstance(printers, dict):
                printers = [printers]

            return {
                "available": True,
                "printers": printers,
                "message": "Connected printers loaded.",
            }

        return {
            "available": False,
            "printers": [],
            "message": "Unable to read Windows printers. " + " | ".join(errors),
        }

    def print_text_bill(self, printer_name: str, bill_text: str) -> dict:
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8") as handle:
            handle.write(bill_text)
            temp_path = Path(handle.name)

        safe_path = str(temp_path).replace("'", "''")
        safe_printer_name = printer_name.replace("'", "''")
        script = f"Get-Content -LiteralPath '{safe_path}' | Out-Printer -Name '{safe_printer_name}'"
        try:
            subprocess.run(
                ["powershell", "-NoProfile", "-Command", script],
                check=True,
                capture_output=True,
                text=True,
                timeout=12,
            )
        except (FileNotFoundError, subprocess.CalledProcessError) as exc:
            return {
                "printed": False,
                "message": f"Direct printing failed: {exc}",
                "temporary_file": str(temp_path),
            }
        except subprocess.TimeoutExpired as exc:
            return {
                "printed": False,
                "message": f"Direct printing timed out: {exc}",
                "temporary_file": str(temp_path),
            }

        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass

        return {
            "printed": True,
            "message": f"Bill sent to printer {printer_name}.",
            "temporary_file": None,
        }


def build_text_bill(invoice: dict) -> str:
    calculated = invoice["calculated"]
    totals = calculated["totals"]
    lines = [calculated["store_name"], calculated["store_address"]]
    if calculated.get("store_phone"):
        lines.append(f"Phone: {calculated['store_phone']}")
    if calculated.get("store_gstin"):
        lines.append(f"GSTIN: {calculated['store_gstin']}")
    if calculated.get("store_email"):
        lines.append(f"Email: {calculated['store_email']}")

    lines.extend(
        [
            "-" * 40,
            f"Invoice: {calculated['invoice_number']}",
            f"Date: {calculated['bill_date']}",
            f"Customer: {calculated.get('customer_name') or 'Walk-in'}",
        ]
    )

    if calculated.get("customer_phone"):
        lines.append(f"Phone: {calculated['customer_phone']}")
    if calculated.get("customer_email"):
        lines.append(f"Email: {calculated['customer_email']}")
    if calculated.get("remark") or calculated.get("customer_comments"):
        lines.append(f"Note: {calculated.get('customer_comments') or calculated.get('remark')}")
    flags = ", ".join(
        flag
        for flag, enabled in [
            ("Insurance", calculated.get("insurance_opt_in")),
            ("Membership", calculated.get("membership_opt_in")),
            ("Advance Cash", calculated.get("advance_cash")),
            ("Advance GPay", calculated.get("advance_gpay")),
        ]
        if enabled
    )
    lines.append(f"Flags: {flags or 'None'}")

    lines.extend(["-" * 40, f"{'Item':14}{'Qty':>4}{'Rate':>10}{'Total':>12}", "-" * 40])

    for item in calculated["lines"]:
        name = item["name"][:14]
        quantity = str(item.get("quantity") or "0")
        rate = str(item.get("unit_price") or "0.00")
        total = str(item.get("line_total") or "0.00")
        lines.append(f"{name:14}{quantity:>4}{rate:>10}{total:>12}")
        if item.get("description"):
            lines.append(f"  {item['description'][:38]}")

    lines.extend(
        [
            "-" * 40,
            f"{'Subtotal':>24}{totals['subtotal']:>16}",
            f"{'GST':>24}{totals['total_tax']:>16}",
            f"{'Subtotal Inc GST':>24}{totals['subtotal_including_tax']:>16}",
            f"{'Discount':>24}{totals['discount_amount']:>16}",
            f"{'Grand Total':>24}{totals['grand_total']:>16}",
            f"{'Advance':>24}{totals['advance_paid']:>16}",
            f"{'Balance':>24}{totals['balance_due']:>16}",
            "-" * 40,
            f"Thank you for shopping with {calculated['store_name']}.",
        ]
    )
    return "\n".join(lines)
