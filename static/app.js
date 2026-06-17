const state = {
    settings: JSON.parse(document.getElementById("initial-settings").textContent),
    stats: JSON.parse(document.getElementById("initial-stats").textContent),
    invoices: JSON.parse(document.getElementById("initial-invoices").textContent),
    customers: JSON.parse(document.getElementById("initial-customers").textContent),
    statuses: JSON.parse(document.getElementById("initial-statuses").textContent),
    latestInvoice: null,
    previewToken: null,
    previewInvoice: null,
    previewPayload: null,
    previewDirty: false,
    isGenerating: false,
};

const invoiceForm = document.getElementById("invoice-form");
const settingsForm = document.getElementById("settings-form");
const statusBox = document.getElementById("status-box");
const settingsStatus = document.getElementById("settings-status");
const historyResults = document.getElementById("history-results");
const recentCustomers = document.getElementById("recent-customers");
const previewDraftButton = document.getElementById("preview-draft");
const previewButton = document.getElementById("preview-last");
const directPrintButton = document.getElementById("direct-print");
const printerSelect = document.getElementById("printer-select");
const historySearch = document.getElementById("history-search");
const historyStatus = document.getElementById("history-status");
const installButton = document.getElementById("install-app");
const customerMatchBox = document.getElementById("customer-match-box");
const exportFilteredButton = document.getElementById("export-filtered-csv");
const billPreviewPanel = document.getElementById("bill-preview-panel");
const billPreviewNote = document.getElementById("bill-preview-note");
const billPreviewBody = document.getElementById("bill-preview-body");
const confirmGenerateButton = document.getElementById("confirm-generate");
const editPreviewButton = document.getElementById("edit-preview");
let installPrompt = null;

const moneyFormatter = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

function formatMoney(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? moneyFormatter.format(amount) : "0.00";
}

function formatCurrency(value) {
    return `${state.settings.currency_symbol} ${formatMoney(value)}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function localDateValue(date = new Date()) {
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60000);
    return local.toISOString().slice(0, 10);
}

function parseDateInput(value) {
    if (!value) {
        return null;
    }
    const [year, month, day] = value.split("-");
    if (!year || !month || !day) {
        return null;
    }
    return `${day}/${month}/${year}`;
}

function formatTimestamp(value) {
    if (!value) {
        return "Not available";
    }
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) {
        return value;
    }
    return dt.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

async function getErrorMessage(response, fallbackMessage) {
    try {
        const data = await response.json();
        if (typeof data?.detail === "string") {
            return data.detail;
        }
        if (Array.isArray(data?.detail)) {
            return data.detail.map((item) => item.msg || item.message || JSON.stringify(item)).join(" | ");
        }
        if (typeof data?.message === "string") {
            return data.message;
        }
    } catch {
        return fallbackMessage;
    }
    return fallbackMessage;
}

function billField(name) {
    return invoiceForm.elements.namedItem(name);
}

function settingsField(name) {
    return settingsForm.elements.namedItem(name);
}

function showStatus(target, message, isError = false) {
    target.textContent = message;
    target.className = isError ? "status-box error" : "status-box show";
}

function clearStatus(target) {
    target.textContent = "";
    target.className = "status-box";
}

function setSection(sectionId) {
    document.querySelectorAll(".section").forEach((section) => {
        section.classList.toggle("active", section.id === sectionId);
    });
    document.querySelectorAll(".nav-pill").forEach((button) => {
        button.classList.toggle("active", button.dataset.sectionTarget === sectionId);
    });
}

function statusBadgeClass(status) {
    if (status === "READY") return "badge ready";
    if (status === "DELIVERED") return "badge delivered";
    if (status === "CANCELLED") return "badge cancelled";
    if (status === "IN_PROGRESS") return "badge progress";
    return "badge";
}

function renderStats(stats) {
    state.stats = stats;
    document.getElementById("stat-total-invoices").textContent = stats.total_invoices;
    document.getElementById("stat-booked").textContent = stats.booked_count;
    document.getElementById("stat-due").textContent = formatCurrency(stats.total_due);
    document.getElementById("hero-sales").textContent = formatCurrency(stats.today_sales);
    document.getElementById("stat-today-sales").textContent = formatCurrency(stats.today_sales);
}

function renderCustomers(customers = state.customers) {
    if (!customers.length) {
        recentCustomers.innerHTML = `<div class="empty-state">Saved customers will appear here after you create a few bills.</div>`;
        return;
    }

    recentCustomers.innerHTML = customers.map((customer) => `
        <article class="customer-card">
            <div class="customer-top">
                <div>
                    <h3>${escapeHtml(customer.customer_name || "Unnamed Customer")}</h3>
                    <p class="customer-copy">${escapeHtml(customer.customer_phone || "No phone saved")}</p>
                </div>
                <span class="mini-label">Last seen</span>
            </div>
            <div class="summary-meta">
                <span>${escapeHtml(formatTimestamp(customer.last_seen))}</span>
            </div>
            <div class="history-actions">
                <button class="button button-secondary fill-customer" type="button" data-name="${escapeHtml(customer.customer_name || "")}" data-phone="${escapeHtml(customer.customer_phone || "")}">Use Customer</button>
            </div>
        </article>
    `).join("");
}

function renderHistory(invoices = state.invoices) {
    if (!invoices.length) {
        historyResults.innerHTML = `<div class="empty-state">No bills found for the current search or filter.</div>`;
        return;
    }

    historyResults.innerHTML = invoices.map((invoice) => {
        const calculated = invoice.calculated || {};
        const totals = calculated.totals || {};
        return `
            <article class="history-card">
                <div class="history-top">
                    <div>
                        <h3>${escapeHtml(invoice.invoice_number)}</h3>
                        <p class="history-copy">${escapeHtml(invoice.customer_name || "Walk-in Customer")}${invoice.customer_phone ? ` | ${escapeHtml(invoice.customer_phone)}` : ""}</p>
                    </div>
                    <span class="${statusBadgeClass(invoice.status)}">${escapeHtml(invoice.status)}</span>
                </div>
                <div class="history-meta">
                    <span>Bill Date: ${escapeHtml(invoice.bill_date || invoice.created_date)}</span>
                    <span>Order Ref: ${escapeHtml(calculated.order_reference || "-")}</span>
                    <span>Total: ${formatCurrency(invoice.grand_total || totals.grand_total)}</span>
                    <span>Balance Due: ${formatCurrency(invoice.balance_due || totals.balance_due)}</span>
                </div>
                <div class="history-actions">
                    <a class="history-link" href="/invoices/${invoice.id}/print" target="_blank" rel="noreferrer">Print Preview</a>
                    <select class="status-select" data-status-select data-id="${invoice.id}">
                        ${state.statuses
                            .filter((status) => status !== "ALL")
                            .map((status) => `<option value="${status}" ${invoice.status === status ? "selected" : ""}>${status}</option>`)
                            .join("")}
                    </select>
                    <button class="button button-secondary" type="button" data-fill-from-invoice="${invoice.id}">Use Customer</button>
                </div>
            </article>
        `;
    }).join("");
}

function fillStoreDefaults() {
    billField("store_name").value = state.settings.store_name || "";
    billField("store_address").value = state.settings.store_address || "";
    billField("store_phone").value = state.settings.store_phone || "";
    billField("store_gstin").value = state.settings.store_gstin || "";
    billField("store_email").value = state.settings.store_email || "";
    billField("discount_percent").value = state.settings.default_discount_percent || 0;
    document.getElementById("hero-store-name").textContent = state.settings.store_name || "Clear View";
    document.title = `${state.settings.store_name || "Clear View"} Billing`;
}

function setPreviewState({ visible = false, dirty = false, message = "" } = {}) {
    billPreviewPanel.hidden = !visible;
    billPreviewNote.textContent = message || (dirty
        ? "Bill details changed after preview. Run preview again before generating."
        : "Preview ready. Confirm to generate the final bill.");
    billPreviewNote.className = dirty ? "preview-note dirty" : "preview-note";
    confirmGenerateButton.disabled = !visible || dirty || !state.previewToken || state.isGenerating;
}

function invalidateDraftPreview() {
    if (!state.previewPayload || state.isGenerating) {
        return;
    }
    state.previewToken = null;
    state.previewDirty = true;
    setPreviewState({
        visible: true,
        dirty: true,
        message: "Bill details changed after preview. Click Preview Bill again before generating.",
    });
}

function collectItems() {
    return [...document.querySelectorAll("[data-item-row]")].map((row) => ({
        name: row.querySelector("[name='item_name']").value.trim(),
        description: row.querySelector("[name='description']").value.trim() || null,
        hsn_code: row.querySelector("[name='hsn_code']").value.trim() || null,
        quantity: Number(row.querySelector("[name='quantity']").value || 1),
        unit_price: Number(row.querySelector("[name='amount']").value || 0),
        gst_rate: Number(row.querySelector("[name='gst_rate']").value || 0),
    }));
}

function isMeaningfulItem(item) {
    return Boolean(item.name) && Boolean(
        item.description ||
        item.hsn_code ||
        item.unit_price > 0 ||
        item.quantity > 1
    );
}

function calculateLocalTotals(items, discountPercent, advancePaid, taxMode) {
    const activeItems = items.filter(isMeaningfulItem);
    const subtotal = activeItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const discountAmount = subtotal * discountPercent / 100;
    let remainingDiscount = discountAmount;
    let taxableSubtotal = 0;
    let igstTotal = 0;
    let sgstTotal = 0;
    let cgstTotal = 0;

    activeItems.forEach((item, index) => {
        const lineBase = item.quantity * item.unit_price;
        let lineDiscount = subtotal > 0 ? discountAmount * lineBase / subtotal : 0;
        if (index === activeItems.length - 1) {
            lineDiscount = remainingDiscount;
        }
        lineDiscount = Math.min(lineDiscount, lineBase);
        remainingDiscount -= lineDiscount;
        const taxableAmount = Math.max(lineBase - lineDiscount, 0);
        taxableSubtotal += taxableAmount;
        if (taxMode === "INTER_STATE") {
            igstTotal += taxableAmount * item.gst_rate / 100;
            return;
        }
        const splitTax = taxableAmount * item.gst_rate / 200;
        sgstTotal += splitTax;
        cgstTotal += splitTax;
    });

    const grandTotal = taxableSubtotal + igstTotal + sgstTotal + cgstTotal;
    return {
        subtotal,
        discountAmount,
        taxableSubtotal,
        igstTotal,
        sgstTotal,
        cgstTotal,
        grandTotal,
        balance: Math.max(grandTotal - advancePaid, 0),
    };
}

function calculatePreviewTotals() {
    const items = collectItems();
    const discountPercent = Number(billField("discount_percent").value || 0);
    const advancePaid = Number(billField("advance_paid").value || 0);
    const taxMode = billField("tax_mode").value || "INTRA_STATE";
    const totals = calculateLocalTotals(items, discountPercent, advancePaid, taxMode);

    document.getElementById("subtotal-value").textContent = formatCurrency(totals.subtotal);
    document.getElementById("discount-value").textContent = formatCurrency(totals.discountAmount);
    document.getElementById("taxable-value").textContent = formatCurrency(totals.taxableSubtotal);
    document.getElementById("igst-value").textContent = formatCurrency(totals.igstTotal);
    document.getElementById("sgst-value").textContent = formatCurrency(totals.sgstTotal);
    document.getElementById("cgst-value").textContent = formatCurrency(totals.cgstTotal);
    document.getElementById("grand-total-value").textContent = formatCurrency(totals.grandTotal);
    document.getElementById("advance-value").textContent = formatCurrency(advancePaid);
    document.getElementById("balance-value").textContent = formatCurrency(totals.balance);
}

function payloadFromForm() {
    return {
        store_name: billField("store_name").value.trim(),
        store_address: billField("store_address").value.trim(),
        store_phone: billField("store_phone").value.trim() || null,
        store_gstin: billField("store_gstin").value.trim() || null,
        store_email: billField("store_email").value.trim() || null,
        invoice_number: billField("invoice_number").value.trim() || null,
        order_reference: billField("order_reference").value.trim() || null,
        shipment_code: billField("shipment_code").value.trim() || null,
        bill_date: parseDateInput(billField("bill_date").value),
        delivery_date: parseDateInput(billField("delivery_date").value),
        status: billField("status").value,
        payment_mode: billField("payment_mode").value || null,
        customer_name: billField("customer_name").value.trim() || null,
        customer_address: billField("customer_address").value.trim() || null,
        customer_phone: billField("customer_phone").value.trim() || null,
        delivery_name: billField("delivery_name").value.trim() || null,
        delivery_address: billField("delivery_address").value.trim() || null,
        delivery_phone: billField("delivery_phone").value.trim() || null,
        gift_from: billField("gift_from").value.trim() || null,
        gift_to: billField("gift_to").value.trim() || null,
        customer_comments: billField("customer_comments").value.trim() || null,
        discount_percent: Number(billField("discount_percent").value || 0),
        advance_paid: Number(billField("advance_paid").value || 0),
        tax_mode: billField("tax_mode").value || "INTRA_STATE",
        items: collectItems().filter(isMeaningfulItem),
    };
}

function renderDraftPreview(preview) {
    const totals = preview.totals;
    const itemsMarkup = (preview.lines || []).map((line) => `
        <div class="preview-line detailed-preview-line">
            <div>
                <strong>${escapeHtml(line.name)}</strong>
                <small>${escapeHtml(line.description || "No description")}</small>
                <small>HSN: ${escapeHtml(line.hsn_code || "-")} | Qty: ${escapeHtml(line.quantity)} | Rate: ${escapeHtml(line.unit_price)} | GST: ${escapeHtml(line.gst_rate)}%</small>
            </div>
            <div>
                <strong>${formatCurrency(line.line_total)}</strong>
                <small>Taxable: ${formatCurrency(line.taxable_amount)}</small>
            </div>
        </div>
    `).join("");

    billPreviewBody.innerHTML = `
        <div class="preview-block">
            <strong>${escapeHtml(preview.invoice_number)}</strong>
            <p class="preview-copy">Bill Date: ${escapeHtml(preview.bill_date)} | Order Ref: ${escapeHtml(preview.order_reference || "-")} | Shipment: ${escapeHtml(preview.shipment_code || "-")} | Payment: ${escapeHtml(preview.payment_mode || "Not selected")}</p>
        </div>
        <div class="preview-grid">
            <div class="preview-block"><strong>Bill To</strong><p class="preview-copy">${escapeHtml(preview.customer_name || "Walk-in Customer")}<br>${escapeHtml(preview.customer_phone || "Phone not provided")}<br>${escapeHtml(preview.customer_address || "Address not provided")}</p></div>
            <div class="preview-block"><strong>Delivery</strong><p class="preview-copy">${escapeHtml(preview.delivery_name || preview.customer_name || "Same as billing")}<br>${escapeHtml(preview.delivery_phone || preview.customer_phone || "Phone not provided")}<br>${escapeHtml(preview.delivery_address || preview.customer_address || "Same as billing address")}</p></div>
        </div>
        <div class="preview-grid">
            <div class="preview-block"><strong>Gift / Notes</strong><p class="preview-copy">Gift From: ${escapeHtml(preview.gift_from || "-")}<br>Gift To: ${escapeHtml(preview.gift_to || "-")}<br>Comments: ${escapeHtml(preview.customer_comments || "No comments")}</p></div>
            <div class="preview-block"><strong>Tax Summary</strong><p class="preview-copy">Tax Mode: ${escapeHtml(preview.tax_mode || "INTRA_STATE")}<br>IGST: ${formatCurrency(totals.igst_total)}<br>SGST: ${formatCurrency(totals.sgst_total)}<br>CGST: ${formatCurrency(totals.cgst_total)}</p></div>
        </div>
        <div class="preview-lines">${itemsMarkup}</div>
        <div class="preview-grid">
            <div class="preview-block"><strong>Amounts</strong><p class="preview-copy">Subtotal: ${formatCurrency(totals.subtotal)}<br>Discount: ${formatCurrency(totals.discount_amount)}<br>Taxable Value: ${formatCurrency(totals.taxable_subtotal)}<br>Total Tax: ${formatCurrency(totals.total_tax)}</p></div>
            <div class="preview-block"><strong>Final</strong><p class="preview-copy">Grand Total: ${formatCurrency(totals.grand_total)}<br>Advance: ${formatCurrency(totals.advance_paid)}<br>Balance Due: ${formatCurrency(totals.balance_due)}</p></div>
        </div>
    `;
}

async function fetchStats() {
    const response = await fetch("/api/stats");
    renderStats(await response.json());
}

async function fetchHistory() {
    const params = new URLSearchParams();
    if (historySearch.value.trim()) {
        params.set("query", historySearch.value.trim());
    }
    if (historyStatus.value) {
        params.set("status", historyStatus.value);
    }
    params.set("limit", "50");
    const response = await fetch(`/api/invoices?${params.toString()}`);
    state.invoices = await response.json();
    renderHistory(state.invoices);
}

async function fetchCustomers() {
    const response = await fetch("/api/customers?limit=8");
    state.customers = await response.json();
    renderCustomers(state.customers);
}

async function refreshSurfaceData() {
    await Promise.all([fetchStats(), fetchHistory(), fetchCustomers()]);
}

function exportFilteredBills() {
    const params = new URLSearchParams();
    if (historySearch.value.trim()) {
        params.set("query", historySearch.value.trim());
    }
    if (historyStatus.value && historyStatus.value !== "ALL") {
        params.set("status", historyStatus.value);
    }
    const url = params.toString() ? `/api/export/invoices.csv?${params.toString()}` : "/api/export/invoices.csv";
    window.open(url, "_blank", "noopener");
}

async function saveInvoice() {
    if (!invoiceForm.reportValidity()) {
        return;
    }

    const payload = payloadFromForm();
    const hasUsefulItem = payload.items.some((item) => item.unit_price > 0 || item.description);
    if (!hasUsefulItem) {
        showStatus(statusBox, "Enter at least one item amount or item description before previewing the bill.", true);
        return;
    }

    previewDraftButton.disabled = true;
    clearStatus(statusBox);

    const response = await fetch("/api/invoices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    previewDraftButton.disabled = false;
    if (!response.ok) {
        showStatus(statusBox, await getErrorMessage(response, "Unable to generate the bill preview."), true);
        return;
    }

    const data = await response.json();
    state.previewToken = data.preview_token;
    state.previewInvoice = data.preview;
    state.previewPayload = { ...payload, invoice_number: data.preview.invoice_number };
    state.previewDirty = false;
    renderDraftPreview(data.preview);
    setPreviewState({
        visible: true,
        dirty: false,
        message: "Preview ready. Review the bill and confirm only when it matches the printed format you want.",
    });
    showStatus(statusBox, `Preview ready for ${data.preview.invoice_number}. Confirm it only after checking customer, tax, and amount details.`);
    billPreviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function confirmGenerateBill() {
    if (!state.previewPayload || !state.previewToken) {
        showStatus(statusBox, "Preview the bill first before generating it.", true);
        return;
    }
    if (state.previewDirty) {
        showStatus(statusBox, "The bill was edited after preview. Preview it again before generating.", true);
        return;
    }

    state.isGenerating = true;
    confirmGenerateButton.disabled = true;

    const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview_token: state.previewToken }),
    });

    state.isGenerating = false;
    if (!response.ok) {
        const message = await getErrorMessage(response, "Unable to generate the bill.");
        if (response.status === 410) {
            state.previewToken = null;
            state.previewDirty = true;
            setPreviewState({
                visible: true,
                dirty: true,
                message: "This preview expired. Click Preview Bill again before generating.",
            });
            showStatus(statusBox, message, true);
            return;
        }
        setPreviewState({
            visible: true,
            dirty: false,
            message: "Preview is still visible. Fix the issue and try confirming again.",
        });
        showStatus(statusBox, message, true);
        return;
    }

    const data = await response.json();
    state.latestInvoice = data.invoice;
    state.previewToken = null;
    state.previewPayload = null;
    state.previewInvoice = null;
    state.previewDirty = false;
    previewButton.disabled = false;
    directPrintButton.disabled = false;
    confirmGenerateButton.disabled = true;
    billPreviewNote.textContent = `Final bill ${data.invoice.invoice_number} generated successfully.`;
    billPreviewNote.className = "preview-note";
    showStatus(statusBox, `Generated ${data.invoice.invoice_number}. You can now open print preview or print directly.`);
    await refreshSurfaceData();
    setSection("history");
}

async function saveSettings(event) {
    event.preventDefault();
    clearStatus(settingsStatus);

    const payload = {
        store_name: settingsField("store_name").value.trim(),
        store_legal_name: settingsField("store_legal_name").value.trim() || settingsField("store_name").value.trim(),
        store_address: settingsField("store_address").value.trim(),
        store_phone: settingsField("store_phone").value.trim() || null,
        store_gstin: settingsField("store_gstin").value.trim() || null,
        store_email: settingsField("store_email").value.trim() || null,
        store_website: settingsField("store_website").value.trim() || null,
        store_state_code: settingsField("store_state_code").value.trim() || null,
        authorized_signatory: settingsField("authorized_signatory").value.trim() || "Authorized Signatory",
        footer_note: settingsField("footer_note").value.trim() || "This is a computer generated invoice and does not require signature.",
        currency_symbol: settingsField("currency_symbol").value.trim() || "Rs.",
        default_discount_percent: Number(settingsField("default_discount_percent").value || 0),
        terms_and_conditions: settingsField("terms_and_conditions").value.trim() || null,
    };

    const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        showStatus(settingsStatus, await getErrorMessage(response, "Unable to save settings."), true);
        return;
    }

    state.settings = await response.json();
    fillStoreDefaults();
    calculatePreviewTotals();
    renderStats(state.stats);
    if (state.previewInvoice) {
        renderDraftPreview(state.previewInvoice);
    }
    showStatus(settingsStatus, "Store settings saved successfully.");
    await Promise.all([fetchStats(), fetchCustomers()]);
}

async function updateInvoiceStatus(invoiceId, status) {
    const response = await fetch(`/api/invoices/${invoiceId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
    });

    if (!response.ok) {
        showStatus(statusBox, await getErrorMessage(response, "Unable to update status."), true);
        return;
    }

    const data = await response.json();
    showStatus(statusBox, `${data.invoice.invoice_number} updated to ${status}.`);
    await refreshSurfaceData();
}

async function printDirectly() {
    if (!state.latestInvoice) {
        showStatus(statusBox, "Save a bill first before direct printing.", true);
        return;
    }
    if (!printerSelect.value) {
        showStatus(statusBox, "Select a printer for direct printing, or use print preview instead.", true);
        return;
    }

    const response = await fetch(`/api/invoices/${state.latestInvoice.id}/print/raw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printer_name: printerSelect.value }),
    });

    if (!response.ok) {
        showStatus(statusBox, await getErrorMessage(response, "Unable to print the bill."), true);
        return;
    }

    const data = await response.json();
    showStatus(statusBox, data.message, !data.printed);
}

function openPrintPreview() {
    if (!state.latestInvoice) {
        showStatus(statusBox, "Save a bill first to open the print preview.", true);
        return;
    }
    window.open(`/invoices/${state.latestInvoice.id}/print`, "_blank", "noopener");
}

function resetBillForm() {
    invoiceForm.reset();
    fillStoreDefaults();
    billField("bill_date").value = localDateValue();
    billField("delivery_date").value = "";
    billField("status").value = "BOOKED";
    billField("payment_mode").value = "";
    billField("tax_mode").value = "INTRA_STATE";
    previewButton.disabled = true;
    directPrintButton.disabled = true;
    state.latestInvoice = null;
    state.previewToken = null;
    state.previewPayload = null;
    state.previewInvoice = null;
    state.previewDirty = false;
    state.isGenerating = false;
    billPreviewBody.innerHTML = "";
    setPreviewState({ visible: false });
    calculatePreviewTotals();
    clearStatus(statusBox);
    customerMatchBox.textContent = "Recent customer shortcuts will fill the billing section. Delivery fields are optional.";
}

function fillCustomer(name, phone) {
    billField("customer_name").value = name || "";
    billField("customer_phone").value = phone || "";
    setSection("new-bill");
    customerMatchBox.textContent = name || phone
        ? `Loaded customer ${name || ""}${phone ? ` (${phone})` : ""} into the bill form.`
        : "Customer info loaded.";
    invalidateDraftPreview();
}

function wireDynamicEvents() {
    historyResults.addEventListener("change", (event) => {
        if (event.target.matches("[data-status-select]")) {
            updateInvoiceStatus(event.target.dataset.id, event.target.value);
        }
    });

    historyResults.addEventListener("click", (event) => {
        const button = event.target.closest("[data-fill-from-invoice]");
        if (!button) {
            return;
        }
        const invoice = state.invoices.find((item) => String(item.id) === button.dataset.fillFromInvoice);
        if (invoice) {
            fillCustomer(invoice.customer_name, invoice.customer_phone);
        }
    });

    document.body.addEventListener("click", (event) => {
        const fillButton = event.target.closest(".fill-customer");
        if (!fillButton) {
            return;
        }
        fillCustomer(fillButton.dataset.name, fillButton.dataset.phone);
    });
}

function registerPwa() {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    }

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        installPrompt = event;
        installButton.hidden = false;
    });

    installButton.addEventListener("click", async () => {
        if (!installPrompt) {
            return;
        }
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        installButton.hidden = true;
    });
}

document.querySelectorAll(".nav-pill").forEach((button) => {
    button.addEventListener("click", () => setSection(button.dataset.sectionTarget));
});

document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => setSection(button.dataset.jump));
});

invoiceForm.addEventListener("submit", (event) => event.preventDefault());
invoiceForm.addEventListener("input", () => {
    calculatePreviewTotals();
    invalidateDraftPreview();
});
invoiceForm.addEventListener("change", invalidateDraftPreview);
previewDraftButton.addEventListener("click", saveInvoice);
settingsForm.addEventListener("submit", saveSettings);
previewButton.addEventListener("click", openPrintPreview);
directPrintButton.addEventListener("click", printDirectly);
confirmGenerateButton.addEventListener("click", confirmGenerateBill);
editPreviewButton.addEventListener("click", () => {
    setSection("new-bill");
    billField("customer_name").focus();
});
document.getElementById("reset-form").addEventListener("click", resetBillForm);
document.getElementById("refresh-history").addEventListener("click", fetchHistory);
exportFilteredButton.addEventListener("click", exportFilteredBills);
historySearch.addEventListener("input", () => {
    clearTimeout(historySearch._timer);
    historySearch._timer = setTimeout(fetchHistory, 250);
});
historyStatus.addEventListener("change", fetchHistory);

billField("bill_date").value = localDateValue();
fillStoreDefaults();
calculatePreviewTotals();
setPreviewState({ visible: false });
renderStats(state.stats);
renderCustomers(state.customers);
renderHistory(state.invoices);
wireDynamicEvents();
registerPwa();
