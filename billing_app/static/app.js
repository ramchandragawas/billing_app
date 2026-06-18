const state = {
    settings: JSON.parse(document.getElementById("initial-settings").textContent),
    invoices: JSON.parse(document.getElementById("initial-invoices").textContent),
    customers: JSON.parse(document.getElementById("initial-customers").textContent),
    printers: JSON.parse(document.getElementById("initial-printers").textContent),
    previewToken: null,
    latestPreview: null,
    latestInvoice: null,
    editingInvoiceId: null,
    editingInvoiceNumber: null,
    currentQuery: "",
};

const invoiceForm = document.getElementById("invoice-form");
const settingsForm = document.getElementById("settings-form");
const historyResults = document.getElementById("history-results");
const historyQuery = document.getElementById("history-query");
const historyStatusFilter = document.getElementById("history-status-filter");
const previewStatus = document.getElementById("preview-status");
const draftPreview = document.getElementById("draft-preview");
const previewDraftButton = document.getElementById("preview-draft");
const confirmGenerateButton = document.getElementById("confirm-generate");
const directPrintButton = document.getElementById("direct-print");
const printerSelect = document.getElementById("printer-select");
const addLineButton = document.getElementById("add-line");
const cancelEditButton = document.getElementById("cancel-edit");
const editModeBanner = document.getElementById("edit-mode-banner");
const editModeTitle = document.getElementById("edit-mode-title");
const editModeCopy = document.getElementById("edit-mode-copy");
const customerShortcuts = document.getElementById("customer-shortcuts");

const descriptionCatalog = {
    Frame: ["Knight", "London House", "NVG", "Alsus", "Hexa", "5M discount", "Titan", "Fasttrack", "Clipon", "Other (Custom)"],
    Lens: [
        {
            label: "Lens Types",
            options: [
                "Single Vision",
                "Rx Single Vision",
                "Bifocal KT",
                "Bifocal D",
                "Progressive",
                "Rx Progressive",
                "Polarised",
                "Photochromatic",
            ],
        },
        {
            label: "Lens Options",
            options: [
                "Care",
                "HMC",
                "Blue Protect",
                "Night Vision",
                "MR8 Poly",
                "1.56 Index",
                "1.67 Index",
                "1.74 Index",
                "Tint Sunglasses",
            ],
        },
        "Other (Custom)",
    ],
    Accessories: ["Lens Spray", "Reading Glass", "Spare Part (Repair)", "Sponge", "Cloth", "Case", "Cleaning Kit", "Other (Custom)"],
    "Contact Lens": ["Bosch + Lomb", "Other (Custom)"],
    Other: ["Custom", "Service", "Adjustment", "Only Reading"],
};

const moneyFormatter = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

function getCurrencySymbol() {
    return state.settings.currency_symbol || "Rs.";
}

function formatCurrency(value) {
    const numeric = Number(value || 0);
    return `${getCurrencySymbol()} ${moneyFormatter.format(numeric)}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function toDateInputValue(value) {
    if (!value) return "";
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return text;
    }
    const slashMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (slashMatch) {
        return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
    }
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
        return "";
    }
    return parsed.toISOString().slice(0, 10);
}

function toBillDateValue(value) {
    const text = String(value || "").trim();
    const inputMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (inputMatch) {
        return `${inputMatch[3]}/${inputMatch[2]}/${inputMatch[1]}`;
    }
    return text;
}

function setStatus(message, tone = "info") {
    if (!previewStatus) return;
    previewStatus.dataset.tone = tone;
    previewStatus.textContent = message;
}

function clearPreviewPanel() {
    if (!draftPreview) return;
    draftPreview.hidden = true;
    draftPreview.innerHTML = "";
}

function clearSavedPreviewCardIfPresent() {
    if (state.previewToken) {
        return;
    }
    if (!draftPreview.hidden && draftPreview.querySelector(".saved-link-card")) {
        clearPreviewPanel();
    }
}

function getLineRows() {
    return Array.from(invoiceForm.querySelectorAll("[data-line-row]"));
}

function getRowControls(row) {
    return {
        kind: row.querySelector("[data-kind]"),
        description: row.querySelector("[data-description]"),
        price: row.querySelector("[data-price]"),
        qty: row.querySelector("[data-qty]"),
        total: row.querySelector("[data-line-total]"),
        hsn: row.querySelector("[data-hsn]"),
        gstRate: row.querySelector("[data-gst-rate]"),
    };
}

function createDescriptionOption(optionText) {
    const option = document.createElement("option");
    option.value = optionText;
    option.textContent = optionText;
    return option;
}

function isCustomOptionLabel(label) {
    return label === "Others (Custom)" || label === "Other (Custom)" || label === "Custom";
}

function renderDescriptionOptions(select, options, selectedValue = "") {
    const currentValue = selectedValue || select.value;
    select.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select description";
    select.appendChild(placeholder);

    options.forEach((entry) => {
        if (typeof entry === "string") {
            if (isCustomOptionLabel(entry)) {
                const customMarker = document.createElement("option");
                customMarker.value = "__custom__";
                customMarker.textContent = "Custom...";
                select.appendChild(customMarker);
                return;
            }
            select.appendChild(createDescriptionOption(entry));
            return;
        }

        const group = document.createElement("optgroup");
        group.label = entry.label || "Options";
        (entry.options || []).forEach((label) => {
            if (isCustomOptionLabel(label)) {
                const customMarker = document.createElement("option");
                customMarker.value = "__custom__";
                customMarker.textContent = "Custom...";
                group.appendChild(customMarker);
                return;
            }
            group.appendChild(createDescriptionOption(label));
        });
        select.appendChild(group);
    });

    if (currentValue && !Array.from(select.options).some((option) => option.value === currentValue)) {
        const customMarker = select.querySelector('option[value="__custom__"]');
        const option = createDescriptionOption(currentValue);
        if (customMarker && customMarker.parentNode === select) {
            select.insertBefore(option, customMarker);
        } else {
            select.appendChild(option);
        }
    }

    select.value = currentValue || "";
}

function syncDescriptionOptions(row, kind, selectedValue = "") {
    const { description } = getRowControls(row);
    const options = descriptionCatalog[kind] || descriptionCatalog.Other;
    renderDescriptionOptions(description, options, selectedValue);
}

function resetRow(row, kind = "Frame") {
    const controls = getRowControls(row);
    controls.kind.value = kind;
    controls.price.value = "";
    controls.qty.value = "1";
    controls.total.textContent = formatCurrency(0);
    controls.hsn.value = "";
    controls.gstRate.value = "0";
    syncDescriptionOptions(row, kind, "");
}

function cloneLineRow() {
    const source = getLineRows()[0];
    const clone = source.cloneNode(true);
    resetRow(clone, "Other");
    return clone;
}

function ensureLineRows(count) {
    const rows = getLineRows();
    while (rows.length < count) {
        const nextRow = cloneLineRow();
        invoiceForm.querySelector(".items-table").appendChild(nextRow);
        rows.push(nextRow);
    }
}

function updateRowTotal(row) {
    const { price, qty, total } = getRowControls(row);
    const unitPrice = Number(price.value || 0);
    const quantity = Number(qty.value || 0);
    total.textContent = formatCurrency(unitPrice * quantity);
}

function updateAllRowTotals() {
    getLineRows().forEach(updateRowTotal);
}

function isMeaningfulRow(row) {
    const { description, price } = getRowControls(row);
    return Boolean(description.value) && Number(price.value || 0) > 0;
}

function collectItems() {
    return getLineRows()
        .map((row) => {
            const controls = getRowControls(row);
            const kind = controls.kind.value.trim();
            const description = controls.description.value.trim();
            const unitPrice = Number(controls.price.value || 0);
            const quantity = Number(controls.qty.value || 0);
            return {
                name: kind,
                description,
                hsn_code: controls.hsn.value.trim() || null,
                quantity,
                unit_price: unitPrice,
                gst_rate: Number(controls.gstRate.value || 0),
                _row: row,
            };
        })
        .filter((item) => Boolean(item.description) && item.unit_price > 0 && item.quantity > 0)
        .map(({ _row, ...item }) => item);
}

function calculateLocalTotals(items) {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    const gstPercent = readNumberField("gst_percent", Number(state.settings.default_gst_percent ?? 0));
    const discountPercent = readNumberField("discount_percent", Number(state.settings.default_discount_percent ?? 0));
    const advancePaid = readNumberField("advance_paid", 0);
    const gstAmount = subtotal * gstPercent / 100;
    const subtotalIncludingTax = subtotal + gstAmount;
    const discountAmount = subtotalIncludingTax * discountPercent / 100;
    const grandTotal = Math.max(subtotalIncludingTax - discountAmount, 0);
    const balanceDue = Math.max(grandTotal - advancePaid, 0);
    return {
        subtotal,
        gstPercent,
        gstAmount,
        subtotalIncludingTax,
        discountPercent,
        discountAmount,
        grandTotal,
        advancePaid,
        balanceDue,
    };
}

function formField(name) {
    return invoiceForm.elements.namedItem(name);
}

function settingsField(name) {
    return settingsForm.elements.namedItem(name);
}

function readNumberField(name, fallback = 0) {
    const field = formField(name);
    if (!field) return fallback;
    const rawValue = String(field.value ?? "").trim();
    if (!rawValue) return fallback;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function populateSettingsForm() {
    Object.entries(state.settings).forEach(([key, value]) => {
        const field = settingsField(key);
        if (!field) return;
        if (field.type === "checkbox") {
            field.checked = Boolean(value);
            return;
        }
        field.value = value ?? "";
    });
    document.getElementById("hero-store-name").textContent = state.settings.store_name || "Clear View";
}

function fillInvoiceFormDefaults() {
    formField("bill_date").value = new Date().toISOString().slice(0, 10);
    formField("gst_percent").value = state.settings.default_gst_percent ?? 0;
    formField("discount_percent").value = state.settings.default_discount_percent ?? 0;
    formField("advance_paid").value = "0";
    formField("invoice_number").value = "";
    formField("customer_name").value = "";
    formField("customer_phone").value = "";
    formField("customer_email").value = "";
    formField("customer_address").value = "";
    formField("remark").value = "";
    formField("insurance_opt_in").checked = false;
    formField("membership_opt_in").checked = false;
    formField("advance_cash").checked = false;
    formField("advance_gpay").checked = false;
    state.editingInvoiceId = null;
    state.editingInvoiceNumber = null;
    updateEditModeUi();
}

function updateEditModeUi() {
    const editing = Boolean(state.editingInvoiceId);
    editModeBanner.hidden = !editing;
    previewDraftButton.textContent = editing ? "Preview Changes" : "Preview Bill";
    confirmGenerateButton.textContent = editing ? "Save Bill Changes" : "Generate Bill";
    editModeTitle.textContent = editing ? `Editing ${state.editingInvoiceNumber}` : "Editing bill";
    editModeCopy.textContent = editing
        ? "Preview the changes, then save to update the same bill."
        : "Changes will update the same saved bill.";
}

function markPreviewDirty(reason = "Draft changed. Preview again before saving.") {
    if (state.previewToken) {
        state.previewToken = null;
        state.latestPreview = null;
        confirmGenerateButton.disabled = true;
        clearPreviewPanel();
        setStatus(reason, "warning");
    }
}

function renderCustomerShortcuts(customers = state.customers) {
    if (!customerShortcuts) return;
    if (!customers.length) {
        customerShortcuts.innerHTML = '<span class="muted-chip">No recent customers yet.</span>';
        return;
    }
    customerShortcuts.innerHTML = customers.map((customer) => {
        const label = [customer.customer_name, customer.customer_phone, customer.customer_email]
            .filter(Boolean)
            .join(" | ");
        return `<button type="button" class="chip" data-customer-id="${customer.latest_invoice_id}">${escapeHtml(label || "Walk-in customer")}</button>`;
    }).join("");
}

function renderHistory(invoices = state.invoices) {
    if (!historyResults) return;
    if (!invoices.length) {
        historyResults.innerHTML = '<p class="empty-state">No bills saved yet.</p>';
        return;
    }

    historyResults.innerHTML = invoices.map((invoice) => {
        const cal = invoice.calculated || {};
        const customerLine = [invoice.customer_name || "Walk-in customer", invoice.customer_phone, invoice.customer_email]
            .filter(Boolean)
            .join(" | ");
        return `
            <article class="history-card">
                <div class="history-main">
                    <div>
                        <h3>${escapeHtml(invoice.invoice_number)}</h3>
                        <p>${escapeHtml(customerLine)}</p>
                    </div>
                    <div class="history-meta">
                        <span>${escapeHtml(invoice.bill_date || invoice.created_date || "")}</span>
                        <strong>${escapeHtml(formatCurrency(invoice.grand_total || cal.totals?.grand_total || 0))}</strong>
                        <small>Due ${escapeHtml(formatCurrency(invoice.balance_due || cal.totals?.balance_due || 0))}</small>
                    </div>
                </div>
                <div class="history-actions">
                    <a class="button button-ghost" href="/invoices/${invoice.id}/print" target="_blank" rel="noreferrer">Print</a>
                    <button class="button button-secondary" type="button" data-edit-invoice="${invoice.id}">Edit</button>
                </div>
            </article>
        `;
    }).join("");
}

function renderDraftPreview(preview) {
    if (!draftPreview) return;
    const lines = preview.lines || [];
    draftPreview.hidden = false;
    draftPreview.innerHTML = `
        <div class="preview-block">
            <div class="preview-header">
                <div>
                    <img src="/static/logo/clear-view-logo.svg" alt="Clear View logo" class="preview-logo">
                    <p class="preview-kicker">${escapeHtml(preview.store_name || state.settings.store_name)}</p>
                    <h3>${escapeHtml(preview.invoice_number)}</h3>
                </div>
                <div class="preview-invoice-meta">
                    <span>Bill date</span>
                    <strong>${escapeHtml(preview.bill_date || "")}</strong>
                    <span>Customer</span>
                    <strong>${escapeHtml(preview.customer_name || "Walk-in customer")}</strong>
                </div>
            </div>

            <div class="preview-summary-line">
                <span>${escapeHtml(preview.customer_phone || "")}</span>
                <span>${escapeHtml(preview.customer_email || "")}</span>
            </div>
            ${preview.customer_address ? `<div class="preview-summary-line"><span>${escapeHtml(preview.customer_address)}</span></div>` : ""}

            <div class="preview-items">
                <div class="preview-items-head">
                    <span>Description</span>
                    <span>Rate</span>
                    <span>Qty</span>
                    <span>Total</span>
                </div>
                ${lines.map((item) => `
                    <div class="preview-item-row">
                        <span>
                            <strong>${escapeHtml(item.name || "")}</strong>
                            <small>${escapeHtml(item.description || "")}</small>
                        </span>
                        <span>${escapeHtml(formatCurrency(item.unit_price || 0))}</span>
                        <span>${escapeHtml(item.quantity || "0")}</span>
                        <span>${escapeHtml(formatCurrency(item.line_total || 0))}</span>
                    </div>
                `).join("")}
            </div>

            <div class="preview-totals">
                <div><span>Subtotal</span><strong>${escapeHtml(formatCurrency(preview.totals?.subtotal || 0))}</strong></div>
                <div><span>GST ${escapeHtml(preview.gst_percent ?? state.settings.default_gst_percent ?? 0)}%</span><strong>${escapeHtml(formatCurrency(preview.totals?.total_tax || 0))}</strong></div>
                <div><span>Subtotal (Inc GST)</span><strong>${escapeHtml(formatCurrency(preview.totals?.subtotal_including_tax || 0))}</strong></div>
                <div><span>Discount ${escapeHtml(preview.totals?.discount_percent ?? 0)}%</span><strong>${escapeHtml(formatCurrency(preview.totals?.discount_amount || 0))}</strong></div>
                <div class="grand"><span>Grand Total</span><strong>${escapeHtml(formatCurrency(preview.totals?.grand_total || 0))}</strong></div>
                <div><span>Advance</span><strong>${escapeHtml(formatCurrency(preview.totals?.advance_paid || 0))}</strong></div>
                <div><span>Balance</span><strong>${escapeHtml(formatCurrency(preview.totals?.balance_due || 0))}</strong></div>
            </div>
        </div>
    `;
}

function fillLineRowsFromItems(items = []) {
    ensureLineRows(Math.max(items.length, 4));
    const rows = getLineRows();
    rows.forEach((row, index) => {
        const item = items[index];
        const controls = getRowControls(row);
        if (!item) {
            resetRow(row, row.querySelector("[data-kind]").value || "Other");
            return;
        }
        controls.kind.value = item.name || "Other";
        syncDescriptionOptions(row, controls.kind.value, item.description || "");
        controls.description.value = item.description || "";
        controls.price.value = item.unit_price ?? 0;
        controls.qty.value = item.quantity ?? 1;
        controls.hsn.value = item.hsn_code || "";
        controls.gstRate.value = item.gst_rate ?? 0;
        updateRowTotal(row);
    });
}

function collectPayload() {
    const items = collectItems();
    const payload = {
        source_invoice_id: state.editingInvoiceId || null,
        store_name: state.settings.store_name,
        store_address: state.settings.store_address,
        store_phone: state.settings.store_phone || null,
        store_gstin: state.settings.store_gstin || null,
        store_email: state.settings.store_email || null,
        customer_email: formField("customer_email").value.trim() || null,
        invoice_number: formField("invoice_number").value.trim() || null,
        bill_date: toBillDateValue(formField("bill_date").value),
        status: "BOOKED",
        customer_name: formField("customer_name").value.trim(),
        customer_phone: formField("customer_phone").value.trim(),
        customer_address: formField("customer_address").value.trim() || null,
        insurance_opt_in: formField("insurance_opt_in").checked,
        membership_opt_in: formField("membership_opt_in").checked,
        advance_cash: formField("advance_cash").checked,
        advance_gpay: formField("advance_gpay").checked,
        gst_percent: readNumberField("gst_percent", Number(state.settings.default_gst_percent ?? 0)),
        customer_comments: formField("remark").value.trim() || null,
        remark: formField("remark").value.trim() || null,
        discount_percent: readNumberField("discount_percent", Number(state.settings.default_discount_percent ?? 0)),
        advance_paid: readNumberField("advance_paid", 0),
        items,
    };
    return payload;
}

function updateLocalEstimate() {
    updateAllRowTotals();
    const items = collectItems();
    const totals = calculateLocalTotals(items);
    if (!items.length) {
        setStatus("Fill in at least one priced item, then preview the bill.", "info");
        return;
    }
    setStatus(
        `Local estimate: ${formatCurrency(totals.subtotal)} subtotal, ${formatCurrency(totals.grandTotal)} grand total.`,
        "info",
    );
}

async function previewBill() {
    if (!invoiceForm.reportValidity()) {
        setStatus("Please fill the required bill fields first.", "error");
        return;
    }
    const payload = collectPayload();
    if (!payload.items.length) {
        setStatus("Add at least one priced item before previewing.", "error");
        return;
    }
    if (payload.items.some((item) => !item.description)) {
        setStatus("Every billed line needs a description.", "error");
        return;
    }

    previewDraftButton.disabled = true;
    try {
        const response = await fetch("/api/invoices/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || data.message || "Unable to preview bill.");
        }

        state.previewToken = data.preview_token;
        state.latestPreview = data.preview;
        confirmGenerateButton.disabled = false;
        renderDraftPreview(data.preview);
        setStatus(
            state.editingInvoiceId
                ? `Preview ready for ${data.preview.invoice_number}. Save the changes to update the same bill.`
                : `Preview ready for ${data.preview.invoice_number}. Confirm it after checking the details.`,
            "success",
        );
        draftPreview.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
        setStatus(error.message || "Preview failed.", "error");
    } finally {
        previewDraftButton.disabled = false;
    }
}

async function confirmBill() {
    if (!state.previewToken) {
        setStatus("Preview the bill first.", "error");
        return;
    }
    confirmGenerateButton.disabled = true;
    try {
        const response = await fetch("/api/invoices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preview_token: state.previewToken }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || data.message || "Unable to save bill.");
        }

        state.latestInvoice = data.invoice;
        state.previewToken = null;
        state.latestPreview = null;
        await refreshInvoices();
        refreshCustomerShortcuts();
        resetBill();
        state.latestInvoice = data.invoice;
        directPrintButton.disabled = false;
        if (data.print_preview_url) {
            renderSavedPreviewLink(data.print_preview_url);
        }
        setStatus(
            data.operation === "updated"
                ? `Bill ${data.invoice.invoice_number} updated successfully.`
                : `Bill ${data.invoice.invoice_number} generated successfully.`,
            "success",
        );
    } catch (error) {
        setStatus(error.message || "Save failed.", "error");
    } finally {
        confirmGenerateButton.disabled = !state.previewToken;
    }
}

function renderSavedPreviewLink(url) {
    draftPreview.hidden = false;
    draftPreview.innerHTML = `
        <div class="saved-link-card">
            <h3>Bill saved</h3>
            <p>You can open the formatted print view now.</p>
            <a class="button button-primary" href="${url}" target="_blank" rel="noreferrer">Open Print View</a>
        </div>
    `;
}

async function saveSettings(event) {
    event.preventDefault();
    const payload = {};
    for (const element of Array.from(settingsForm.elements)) {
        if (!element.name) continue;
        if (element.type === "checkbox") {
            payload[element.name] = element.checked;
        } else {
            payload[element.name] = element.value.trim();
        }
    }

    try {
        const response = await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || data.message || "Unable to save settings.");
        }
        state.settings = data;
        populateSettingsForm();
        fillInvoiceFormDefaults();
        setStatus("Shop settings saved.", "success");
        refreshCustomerShortcuts();
    } catch (error) {
        setStatus(error.message || "Settings save failed.", "error");
    }
}

async function refreshInvoices() {
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (state.currentQuery) {
        params.set("query", state.currentQuery);
    }
    const response = await fetch(`/api/invoices?${params.toString()}`);
    state.invoices = await response.json();
    renderHistory(state.invoices);
}

async function refreshCustomerShortcuts() {
    const response = await fetch("/api/customers?limit=8");
    state.customers = await response.json();
    renderCustomerShortcuts(state.customers);
}

function populatePrinterSelect() {
    const printers = (state.printers && state.printers.printers) || [];
    if (!printers.length) {
        printerSelect.innerHTML = '<option value="">Open browser print view</option>';
        directPrintButton.disabled = false;
        directPrintButton.textContent = "Print View";
        return;
    }

    const defaultPrinter = printers.find((printer) => Boolean(printer.Default || printer.default));
    printerSelect.innerHTML = [
        '<option value="">Open browser print view</option>',
        ...printers.map((printer) => {
            const name = printer.Name || printer.name || "";
            const selected = defaultPrinter && name === (defaultPrinter.Name || defaultPrinter.name) ? " selected" : "";
            return `<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`;
        }),
    ].join("");
    directPrintButton.disabled = false;
    directPrintButton.textContent = "Thermal Print";
}

async function directPrintLatest() {
    if (!state.latestInvoice) {
        setStatus("Save a bill first, then print it.", "error");
        return;
    }
    const printerName = printerSelect.value.trim();
    if (!printerName) {
        window.open(`/invoices/${state.latestInvoice.id}/print`, "_blank", "noopener");
        return;
    }

    try {
        const response = await fetch(`/api/invoices/${state.latestInvoice.id}/print/raw`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ printer_name: printerName }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || data.message || "Unable to print.");
        }
        setStatus(data.message || "Bill sent to printer.", "success");
    } catch (error) {
        setStatus(error.message || "Direct print failed.", "error");
    }
}

async function loadInvoiceForEdit(invoiceId) {
    const response = await fetch(`/api/invoices/${invoiceId}`);
    if (!response.ok) {
        setStatus("Could not load that invoice.", "error");
        return;
    }
    const invoice = await response.json();
    const payload = invoice.payload || {};
    const calculated = invoice.calculated || {};

    fillInvoiceFormDefaults();
    state.editingInvoiceId = invoice.id;
    state.editingInvoiceNumber = invoice.invoice_number;

    formField("invoice_number").value = invoice.invoice_number || payload.invoice_number || "";
    formField("bill_date").value = toDateInputValue(invoice.bill_date || payload.bill_date || calculated.bill_date);
    formField("customer_name").value = invoice.customer_name || payload.customer_name || "";
    formField("customer_phone").value = invoice.customer_phone || payload.customer_phone || "";
    formField("customer_email").value = invoice.customer_email || payload.customer_email || "";
    formField("customer_address").value = payload.customer_address || calculated.customer_address || "";
    formField("remark").value = payload.remark || payload.customer_comments || calculated.remark || "";
    formField("discount_percent").value = calculated.totals?.discount_percent ?? payload.discount_percent ?? 0;
    formField("advance_paid").value = calculated.totals?.advance_paid ?? payload.advance_paid ?? 0;
    formField("gst_percent").value = calculated.gst_percent ?? payload.gst_percent ?? state.settings.default_gst_percent ?? 0;
    formField("insurance_opt_in").checked = Boolean(payload.insurance_opt_in || calculated.insurance_opt_in);
    formField("membership_opt_in").checked = Boolean(payload.membership_opt_in || calculated.membership_opt_in);
    formField("advance_cash").checked = Boolean(payload.advance_cash || calculated.advance_cash);
    formField("advance_gpay").checked = Boolean(payload.advance_gpay || calculated.advance_gpay);

    const items = calculated.lines || payload.items || [];
    fillLineRowsFromItems(items);
    updateAllRowTotals();
    updateEditModeUi();
    clearPreviewPanel();
    state.previewToken = null;
    confirmGenerateButton.disabled = true;
    setStatus(`Loaded ${invoice.invoice_number} for editing. Preview the updated bill before saving.`, "info");
    document.getElementById("bill-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetBill() {
    fillInvoiceFormDefaults();
    const rows = getLineRows();
    rows.slice(4).forEach((row) => row.remove());
    getLineRows().forEach((row, index) => resetRow(row, index === 1 ? "Lens" : index === 2 ? "Accessories" : index === 3 ? "Contact Lens" : "Frame"));
    getLineRows().forEach(updateRowTotal);
    state.previewToken = null;
    state.latestPreview = null;
    clearPreviewPanel();
    confirmGenerateButton.disabled = true;
    updateLocalEstimate();
}

async function updateHistoryFilter() {
    state.currentQuery = historyQuery.value.trim();
    await refreshInvoices();
}

function changeDescriptionForCustom(select) {
    const selected = select.value;
    if (selected !== "__custom__") return;
    const customValue = window.prompt("Type the custom description:");
    if (!customValue) {
        select.value = "";
        return;
    }
    const option = createDescriptionOption(customValue.trim());
    select.insertBefore(option, select.querySelector('option[value="__custom__"]'));
    select.value = customValue.trim();
}

function onInvoiceFormInput(event) {
    const target = event.target;
    const row = target.closest("[data-line-row]");
    clearSavedPreviewCardIfPresent();
    if (row && target.matches("[data-kind]")) {
        syncDescriptionOptions(row, target.value, "");
        markPreviewDirty();
        updateLocalEstimate();
        return;
    }
    if (row && target.matches("[data-description]")) {
        changeDescriptionForCustom(target);
        markPreviewDirty();
        updateLocalEstimate();
        return;
    }
    if (row && (target.matches("[data-price]") || target.matches("[data-qty]"))) {
        updateRowTotal(row);
        markPreviewDirty();
        updateLocalEstimate();
        return;
    }
    if (target.matches("input, textarea, select")) {
        markPreviewDirty();
        updateLocalEstimate();
    }
}

function onInvoiceFormChange(event) {
    const target = event.target;
    const row = target.closest("[data-line-row]");
    clearSavedPreviewCardIfPresent();
    if (row && target.matches("[data-description]")) {
        changeDescriptionForCustom(target);
    }
    if (row && target.matches("[data-kind]")) {
        syncDescriptionOptions(row, target.value, "");
        updateRowTotal(row);
    }
    updateLocalEstimate();
}

function bindHistoryHandlers() {
    historyResults.addEventListener("click", (event) => {
        const editButton = event.target.closest("[data-edit-invoice]");
        if (editButton) {
            const invoiceId = Number(editButton.dataset.editInvoice);
            loadInvoiceForEdit(invoiceId);
            return;
        }
    });
}

function wireShortcutClicks() {
    customerShortcuts.addEventListener("click", async (event) => {
        const chip = event.target.closest("[data-customer-id]");
        if (!chip) return;
        const invoiceId = Number(chip.dataset.customerId);
        try {
            const response = await fetch(`/api/invoices/${invoiceId}`);
            if (!response.ok) return;
            const invoice = await response.json();
            formField("customer_name").value = invoice.customer_name || "";
            formField("customer_phone").value = invoice.customer_phone || "";
            formField("customer_email").value = invoice.customer_email || "";
            formField("customer_address").value = invoice.payload?.customer_address || invoice.calculated?.customer_address || "";
            setStatus(`Loaded customer from ${invoice.invoice_number}.`, "success");
            markPreviewDirty();
        } catch {
            setStatus("Unable to load customer shortcut.", "error");
        }
    });
}

function wireNavigation() {
    document.querySelectorAll("[data-jump]").forEach((button) => {
        button.addEventListener("click", () => {
            const target = document.getElementById(button.dataset.jump);
            target?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
}

function bindLineRowEvents() {
    addLineButton.addEventListener("click", () => {
        ensureLineRows(getLineRows().length + 1);
        const rows = getLineRows();
        const row = rows[rows.length - 1];
        resetRow(row, "Other");
        row.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setStatus("Added a new bill line.", "info");
    });
}

function initializeRows() {
    getLineRows().forEach((row) => {
        const kind = row.querySelector("[data-kind]");
        syncDescriptionOptions(row, kind.value || "Frame", "");
        updateRowTotal(row);
    });
}

function bindPrinterSelect() {
    directPrintButton.addEventListener("click", directPrintLatest);
}

function bindFormEvents() {
    invoiceForm.addEventListener("input", onInvoiceFormInput);
    invoiceForm.addEventListener("change", onInvoiceFormChange);
    invoiceForm.addEventListener("submit", (event) => event.preventDefault());
    settingsForm.addEventListener("submit", saveSettings);
    previewDraftButton.addEventListener("click", previewBill);
    confirmGenerateButton.addEventListener("click", confirmBill);
    cancelEditButton.addEventListener("click", () => {
        resetBill();
    });
    historyQuery.addEventListener("input", () => {
        window.clearTimeout(historyQuery._timer);
        historyQuery._timer = window.setTimeout(updateHistoryFilter, 250);
    });
}

function refreshPreviewFromCurrentForm() {
    updateAllRowTotals();
    const items = collectItems();
    if (!items.length) {
        setStatus("Fill in at least one priced item, then preview the bill.", "info");
        return;
    }
    const totals = calculateLocalTotals(items);
    setStatus(
        `Local estimate: ${formatCurrency(totals.subtotal)} subtotal and ${formatCurrency(totals.grandTotal)} grand total.`,
        "info",
    );
}

function init() {
    populateSettingsForm();
    populatePrinterSelect();
    renderHistory(state.invoices);
    renderCustomerShortcuts(state.customers);
    initializeRows();
    fillInvoiceFormDefaults();
    updateLocalEstimate();
    updateEditModeUi();
    wireNavigation();
    wireShortcutClicks();
    bindHistoryHandlers();
    bindLineRowEvents();
    bindPrinterSelect();
    bindFormEvents();

    if (!formField("bill_date").value) {
        formField("bill_date").value = new Date().toISOString().slice(0, 10);
    }

    setStatus("Ready to create a new bill.", "info");
}

init();
