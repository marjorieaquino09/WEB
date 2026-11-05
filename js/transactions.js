import { db } from "./firebase-config.js";
import { checkAuth, logoutUser } from "./auth.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Global variables para sa state management
let currentUserId = null;
let storeName = "My Store";
let allTransactions = [];

// Tatlong pinagmumulan ng benta data:
//  - root: 'transactions' collection (benta galing sa Web App)
//  - legacy: 'users/{uid}/transactions' subcollection (lumang lokasyon)
//  - orders: 'orders' collection (benta galing sa Mobile App)
const sources = { root: [], legacy: [], orders: [] };

// 1. Suriin kung authenticated ang user bago mag-load ng data
checkAuth(async (user) => {
  currentUserId = user.uid;

  const topbarEl = document.getElementById("topbarStoreName") || document.getElementById("topbarUserEmail");
  const avatarContainer = document.getElementById("avatarContainer") || document.getElementById("topbarAvatarContainer");

  if (topbarEl) {
    topbarEl.style.color = "#ffffff";
    topbarEl.style.fontWeight = "700";
    topbarEl.innerText = "Loading...";
  }

  try {
    // Kunin ang impormasyon ng tindahan mula sa 'users' collection
    const userDoc = await getDoc(doc(db, "users", currentUserId));
    let profileImg = null;

    if (userDoc.exists()) {
      const data = userDoc.data();
      storeName = data.store_name || data.full_name || "My Store";
      profileImg = data.profile_image || null;

      if (topbarEl) {
        topbarEl.innerText = storeName;
      }
    } else {
      if (topbarEl) topbarEl.innerText = "My Store";
    }

    // Set up ang avatar image ng user sa topbar
    if (avatarContainer) {
      if (profileImg) {
        avatarContainer.style.backgroundImage = `url("${profileImg}")`;
        avatarContainer.style.backgroundSize = "cover";
        avatarContainer.style.backgroundPosition = "center";
        avatarContainer.innerHTML = "";
      } else {
        avatarContainer.style.backgroundImage = "";
        avatarContainer.style.backgroundColor = "#ffffff";
        avatarContainer.style.color = "#1b382b";
        avatarContainer.style.display = "flex";
        avatarContainer.style.alignItems = "center";
        avatarContainer.style.justifyContent = "center";
        avatarContainer.style.borderRadius = "50%";
        avatarContainer.style.width = "32px";
        avatarContainer.style.height = "32px";
        avatarContainer.innerHTML = `<i class="fa-solid fa-user"></i>`;
      }
    }
  } catch (error) {
    console.error("Error fetching store info:", error);
    if (topbarEl) topbarEl.innerText = "My Store";
  }

  // Simulan ang realtime listener para sa mga benta
  loadTransactionsRealtime();
});

// 2. Realtime listener para sa tatlong pinagmumulan ng benta sa Firestore
function loadTransactionsRealtime() {
  if (!currentUserId) return;

  const listen = (ref, key, tag) => {
    onSnapshot(
      ref,
      (snapshot) => {
        sources[key] = snapshot.docs.map((d) => ({
          id: d.id,
          _src: tag,
          ...d.data()
        }));
        rebuildTransactions();
      },
      (error) => {
        console.error(`Error fetching ${tag}:`, error);
        rebuildTransactions();
      }
    );
  };

  // Web app transactions
  listen(
    query(collection(db, "transactions"), where("userId", "==", currentUserId)),
    "root",
    "transactions"
  );

  // Legacy transactions
  listen(
    collection(db, "users", currentUserId, "transactions"),
    "legacy",
    "users/transactions"
  );

  // Mobile app orders
  listen(
    query(collection(db, "orders"), where("userId", "==", currentUserId)),
    "orders",
    "orders"
  );
}

// Helper para sa pagkuha ng timestamp value
function txnTime(t) {
  return getTimestampValue(t.createdAt || t.created_at || t.createdAtMs);
}

// 3. Pagsasamahin ang mga benta at tatanggalin ang duplicate records
function rebuildTransactions() {
  const map = new Map();

  sources.legacy.forEach((t) => map.set(`legacy:${t.id}`, t));
  sources.root.forEach((t) => map.set(`txn:${t.id}`, t));

  // Iniiwasan ang duplication: laktawan ang mga order na nagmula sa 'web_app' dahil nasa 'transactions' na sila
  sources.orders
    .filter((o) => o.source !== "web_app")
    .forEach((o) => map.set(`order:${o.id}`, o));

  // I-sort mula sa pinakabago hanggang pinakaluma
  allTransactions = [...map.values()].sort((a, b) => txnTime(b) - txnTime(a));

  renderTransactions();
}

// Standardized timestamp parser
function getTimestampValue(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  const parsed = new Date(value).getTime();

  return Number.isNaN(parsed) ? 0 : parsed;
}

// Formatter para sa customer name
function displayCustomer(txn) {
  const name = String(txn.customerName || txn.customer_name || "").trim();
  if (!name || name.toLowerCase() === "cash") return "Walk-in Customer";
  return name;
}

// 4. I-render ang data sa UI Table at i-compute ang summary totals
function renderTransactions() {
  let creditSales = 0;
  let cashSales = 0;

  allTransactions.forEach((txn) => {
    const amount = Number(
      txn.totalAmount ||
      txn.total_amount ||
      0
    );

    const method = String(
      txn.paymentMethod ||
      txn.payment_method ||
      "cash"
    ).toLowerCase();

    if (method.includes("credit") || method.includes("utang")) {
      creditSales += amount;
    } else {
      cashSales += amount;
    }
  });

  const setElemText = (id, value) => {
    const element = document.getElementById(id);
    if (element) {
      element.innerText = value;
    }
  };

  // Update ang Summary Cards sa itaas
  setElemText(
    "statCreditSales",
    `₱${creditSales.toLocaleString("en-US", {
      minimumFractionDigits: 2
    })}`
  );

  setElemText(
    "statCashSales",
    `₱${cashSales.toLocaleString("en-US", {
      minimumFractionDigits: 2
    })}`
  );

  setElemText(
    "statTotalTransactions",
    allTransactions.length
  );

  const tbody = document.getElementById("transactionTableBody");

  if (!tbody) return;

  // Render kapag walang records
  if (allTransactions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td
          colspan="5"
          style="
            text-align:center;
            color:#7c8b82;
            padding:30px;
          "
        >
          No transactions recorded yet.
        </td>
      </tr>
    `;
    return;
  }

  // Populate ang rows ng Table
  tbody.innerHTML = allTransactions
    .map((txn, index) => {
      const amount = Number(
        txn.totalAmount ||
        txn.total_amount ||
        0
      );

      const paymentMethod = String(
        txn.paymentMethod ||
        txn.payment_method ||
        "cash"
      ).toLowerCase();

      const isCredit = paymentMethod.includes("credit") || paymentMethod.includes("utang");
      const pillClass = isCredit ? "credit" : "cash";
      const customerDisplay = displayCustomer(txn);

      // Auto-generate ng Receipt Number halimbawa: #T-0002[cite: 18, 19]
      const receiptNo = `#T-${String(allTransactions.length - index).padStart(4, "0")}`;

      let dateFormatted = "N/A";
      const timestamp = txnTime(txn);

      if (timestamp > 0) {
        const date = new Date(timestamp);

        dateFormatted =
          date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
          }) +
          " " +
          date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit"
          });
      }

      const pillStyle = isCredit
        ? "background:#f3e8ff;color:#7e22ce;"
        : "background:#dcfce7;color:#15803d;";

      const displayMethod = isCredit ? "Credit / Utang" : "Cash";

      return `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td
            class="receipt-cell"
            style="
              padding:14px 0;
              font-weight:700;
              color:#1e293b;
            "
          >
            ${receiptNo}
          </td>

          <td
            style="
              padding:14px 0;
              color:#334155;
            "
          >
            ${escapeHtml(customerDisplay)}
          </td>

          <td
            class="price-cell"
            style="
              padding:14px 0;
              font-weight:700;
              color:#0f172a;
            "
          >
            ₱${amount.toFixed(2)}
          </td>

          <td style="padding:14px 0;">
            <span
              class="payment-pill ${pillClass}"
              style="
                padding:4px 10px;
                border-radius:20px;
                font-size:.75rem;
                font-weight:700;
                ${pillStyle}
              "
            >
              ${displayMethod}
            </span>
          </td>

          <td
            class="actions-cell"
            style="
              padding:14px 0;
              text-align:right;
            "
          >
            <button
              type="button"
              class="view-receipt-link"
              data-id="${escapeHtml(txn.id)}"
              data-index="${index}"
              data-receipt="${receiptNo}"
              data-customer="${escapeHtml(customerDisplay)}"
              data-amount="₱${amount.toFixed(2)}"
              data-payment="${displayMethod}"
              data-date="${dateFormatted}"
              style="
                background:none;
                border:none;
                color:#164a41;
                font-weight:bold;
                cursor:pointer;
              "
            >
              View Receipt
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  // Event listener para sa "View Receipt" button[cite: 18, 19]
  document
    .querySelectorAll(".view-receipt-link")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const setModalText = (id, text) => {
          const element = document.getElementById(id);
          if (element) {
            element.innerText = text;
          }
        };

        setModalText("modalReceiptId", button.dataset.receipt);
        setModalText("modalCustomer", button.dataset.customer);
        setModalText("modalAmount", button.dataset.amount);
        setModalText("modalPayment", button.dataset.payment);
        setModalText("modalDate", button.dataset.date);
        setModalText("modalStoreName", storeName);

        renderReceiptItems(allTransactions[Number(button.dataset.index)]);

        const modal = document.getElementById("receiptModal");
        if (modal) {
          modal.style.display = "flex";
        }
      });
    });
}

// 5. I-ensure ang container para sa listahan ng mga biniling item sa resibo
function ensureItemsBox() {
  let box = document.getElementById("modalItems");
  if (box) return box;

  const amountEl = document.getElementById("modalAmount");
  if (!amountEl) return null;

  let node = amountEl;
  while (
    node.parentElement &&
    node.parentElement.id !== "receiptModal" &&
    node.parentElement.children.length < 3
  ) {
    node = node.parentElement;
  }
  if (!node.parentElement) return null;

  box = document.createElement("div");
  box.id = "modalItems";
  node.parentElement.insertBefore(box, node);
  return box;
}

// 6. I-render ang mga partikular na paninda sa loob ng Receipt Modal[cite: 19]
function renderReceiptItems(txn) {
  const box = ensureItemsBox();
  if (!box) return;

  const items = txn && Array.isArray(txn.items) ? txn.items : [];

  const header = `
    <div style="font-weight:700; margin:12px 0 6px; padding-top:10px; border-top:1px dashed #cbd5e1;">
      List of Purchased Items
    </div>
  `;

  if (items.length === 0) {
    box.innerHTML = header + `
      <div style="font-size:.85rem; opacity:.7; padding-bottom:10px;">
        No details available for the purchased items.
      </div>
    `;
    return;
  }

  const rows = items.map((item) => {
    const name = String(item.name || item.productName || item.barcode || "Item");
    const qty = Number(item.quantity ?? item.qty ?? 1);
    const price = Number(item.price ?? item.unitPrice ?? 0);
    const line = item.subtotal != null ? Number(item.subtotal) : price * qty;

    return `
      <div style="display:flex; justify-content:space-between; gap:12px; font-size:.9rem; padding:3px 0;">
        <div style="min-width:0;">
          <div style="font-weight:600; overflow-wrap:anywhere;">${escapeHtml(name)}</div>
          <div style="font-size:.78rem; opacity:.7;">${qty} × ₱${price.toFixed(2)}</div>
        </div>
        <div style="font-weight:700; white-space:nowrap;">₱${line.toFixed(2)}</div>
      </div>
    `;
  }).join("");

  box.innerHTML = header + rows + `
    <div style="border-bottom:1px dashed #cbd5e1; margin-top:8px;"></div>
  `;
}

// 7. Modal Close Button Event Listener[cite: 19]
const closeReceiptBtn = document.getElementById("closeReceiptBtn");
if (closeReceiptBtn) {
  closeReceiptBtn.addEventListener("click", () => {
    const modal = document.getElementById("receiptModal");
    if (modal) {
      modal.style.display = "none";
    }
  });
}

// 8. Print Receipt Button Event Listener[cite: 19]
const printReceiptBtn = document.getElementById("printReceiptBtn");
if (printReceiptBtn) {
  printReceiptBtn.addEventListener("click", () => {
    window.print();
  });
}

// 9. FUNCTIONAL CSV EXPORT: I-download ang transactions sa Excel/CSV File[cite: 20]
const exportBtn = document.getElementById("exportBtn");
if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    if (!allTransactions || allTransactions.length === 0) {
      alert("No transaction records available to export.");
      return;
    }

    // Header ng CSV File
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Receipt No,Customer,Total Amount (PHP),Payment Method,Date\n";

    // Isulat ang bawat transaction record sa CSV
    allTransactions.forEach((txn, index) => {
      const receiptNo = `#T-${String(allTransactions.length - index).padStart(4, "0")}`;
      const customer = displayCustomer(txn).replace(/,/g, " ");
      const amount = Number(txn.totalAmount || txn.total_amount || 0).toFixed(2);
      const paymentMethod = String(txn.paymentMethod || txn.payment_method || "cash").toLowerCase();
      const methodStr = paymentMethod.includes("credit") || paymentMethod.includes("utang") ? "Credit / Utang" : "Cash";

      let dateFormatted = "N/A";
      const timestamp = txnTime(txn);
      if (timestamp > 0) {
        dateFormatted = new Date(timestamp).toLocaleString('en-US').replace(/,/g, "");
      }

      csvContent += `"${receiptNo}","${customer}","${amount}","${methodStr}","${dateFormatted}"\n`;
    });

    // Auto-download file sa browser
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `SARI_Transactions_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);

    link.click();
    document.body.removeChild(link);
  });
}

// 10. Logout Button Event Listener
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", logoutUser);
}

// Security Helper: HTML Escaper para maiwasan ang XSS Injection
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}