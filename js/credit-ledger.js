import { db, auth } from "./firebase-config.js";
import { checkAuth, logoutUser } from "./auth.js";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  getDoc,
  doc, 
  updateDoc,
  addDoc,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUserId = null;
let allCredits = [];

checkAuth(async (user) => {
  currentUserId = user.uid;

  const storeNameEl = document.getElementById("topbarStoreName") || document.getElementById("topbarUserEmail");
  const avatarContainer = document.getElementById("avatarContainer") || document.getElementById("topbarAvatarContainer");

  if (storeNameEl) {
    storeNameEl.style.color = "#ffffff";
    storeNameEl.style.fontWeight = "700";
    storeNameEl.innerText = "Loading...";
  }

  try {
    const userDoc = await getDoc(doc(db, "users", currentUserId));
    let profileImg = null;

    if (userDoc.exists()) {
      const uData = userDoc.data();
      if (storeNameEl) {
        storeNameEl.innerText = uData.store_name || uData.full_name || "My Store";
      }
      profileImg = uData.profile_image || null;
    } else {
      if (storeNameEl) storeNameEl.innerText = "My Store";
    }

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
  } catch (err) {
    console.error("Error fetching profile:", err);
    if (storeNameEl) storeNameEl.innerText = "My Store";
  }

  loadCreditLedger();
});

async function loadCreditLedger() {
  try {
    const credQuery = query(collection(db, "credits"), where("userId", "==", currentUserId));
    const credSnap = await getDocs(credQuery);

    allCredits = [];
    credSnap.forEach((docSnap) => {
      allCredits.push({ id: docSnap.id, ...docSnap.data() });
    });

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const txQuery = query(
      collection(db, "transactions"),
      where("userId", "==", currentUserId),
      where("payment_method", "==", "Cash")
    );
    const txSnap = await getDocs(txQuery);

    let collectedThisMonth = 0;
    txSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.created_at) {
        const txDate = data.created_at.toDate();
        if (txDate >= firstDayOfMonth) {
          collectedThisMonth += Number(data.total_amount || 0);
        }
      }
    });

    const collectedEl = document.getElementById("statCollectedThisMonth");
    if (collectedEl) {
      collectedEl.innerText = `₱${collectedThisMonth.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }

    renderLedger();
  } catch (error) {
    console.error("Error loading credits ledger:", error);
  }
}

function renderLedger() {
  const searchInput = document.getElementById("searchCustomerInput");
  const search = searchInput ? searchInput.value.trim().toLowerCase() : "";

  const filtered = allCredits.filter((c) => {
    const nameMatch = c.customerName && c.customerName.toLowerCase().includes(search);
    const phoneMatch = c.phone && c.phone.toLowerCase().includes(search);
    return !search || nameMatch || phoneMatch;
  });

  let totalOwed = 0;
  let overdueCount = 0;
  let uniqueCustomers = new Set();

  filtered.forEach((c) => {
    if (c.customerName) uniqueCustomers.add(c.customerName);
    if (!c.isPaid) {
      totalOwed += Number(c.amount || 0);
      if (c.isOverdue) overdueCount++;
    }
  });

  const setElemText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  };

  setElemText("statTotalOwed", `₱${totalOwed.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  setElemText("statCustomerCount", uniqueCustomers.size);
  setElemText("statOverdueCount", overdueCount);

  const tbody = document.getElementById("ledgerTableBody");
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: #94a3b8; padding: 30px;">No customer credit records found.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((cred) => {
    const initials = (cred.customerName || "CU").substring(0, 2).toUpperCase();
    const amount = Number(cred.amount || 0);
    const isPaid = cred.isPaid === true;
    const hasDebt = !isPaid && amount > 0;

    const statusPill = isPaid
      ? `<span style="background:#dcfce7; color:#15803d; padding:4px 12px; border-radius:20px; font-weight:800; font-size:11px;">Paid</span>`
      : `<span style="background:#fee2e2; color:#dc2626; padding:4px 12px; border-radius:20px; font-weight:800; font-size:11px;">Unpaid</span>`;

    const actionBtn = hasDebt
      ? `<button type="button" class="btn-mark-paid" data-id="${cred.id}" data-name="${cred.customerName}" data-amount="${amount}" style="background: #164a41; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 800; transition: background 0.15s ease;">
          <i class="fa-solid fa-check"></i> Paid
        </button>`
      : `<span style="color: #94a3b8; font-size: 12px; font-style: italic;">Settled</span>`;

    const displayDate = cred.date || (cred.createdAt ? new Date(cred.createdAt.toDate()).toLocaleDateString() : 'N/A');

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 10px; font-weight: 800;">
            <span style="background:#164a41; color:#fff; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px;">${initials}</span> 
            ${cred.customerName || ''}
          </div>
        </td>
        <td style="color: #64748b;">${cred.phone || 'N/A'}</td>
        <td style="font-weight: 800;">₱${amount.toFixed(2)}</td>
        <td style="color: #64748b;">₱${(cred.creditLimit || 2000).toLocaleString('en-US')}</td>
        <td style="color: #64748b;">${displayDate}</td>
        <td>${statusPill}</td>
        <td style="text-align: center;">${actionBtn}</td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll(".btn-mark-paid").forEach((btn) => {
    btn.addEventListener("click", () => {
      markPaid(btn.dataset.id, btn.dataset.name, Number(btn.dataset.amount));
    });
  });
}

async function markPaid(creditId, customerName, paidAmount) {
  if (confirm(`Mark credit for ${customerName} as fully paid?`)) {
    try {
      const credRef = doc(db, "credits", creditId);
      await updateDoc(credRef, {
        isPaid: true,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, "transactions"), {
        userId: currentUserId,
        payment_method: "Cash",
        customer_name: customerName,
        total_amount: paidAmount,
        created_at: serverTimestamp()
      });

      alert("Payment successful!");
      loadCreditLedger();
    } catch (error) {
      console.error("Error updating payment:", error);
      alert("Failed to process payment: " + error.message);
    }
  }
}

/* MODAL CONTROLS & ADD CREDIT FORM */
const modal = document.getElementById("addCreditModal");
const openModalBtn = document.getElementById("openAddModalBtn");
const closeModalBtn = document.getElementById("closeAddModalBtn");
const addCreditForm = document.getElementById("addCreditForm");

if (openModalBtn) {
  openModalBtn.addEventListener("click", () => {
    if (modal) modal.classList.add("active");
  });
}

if (closeModalBtn) {
  closeModalBtn.addEventListener("click", () => {
    if (modal) modal.classList.remove("active");
  });
}

if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.remove("active");
    }
  });
}

if (addCreditForm) {
  addCreditForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentUserId) {
      alert("User not authenticated.");
      return;
    }

    const name = document.getElementById("newCustomerName").value.trim();
    const phone = document.getElementById("newCustomerPhone").value.trim();
    const amount = Number(document.getElementById("newCreditAmount").value);
    const notes = document.getElementById("newCreditNotes").value.trim();
    const saveBtn = document.getElementById("btnSaveCredit");

    if (!name || isNaN(amount) || amount <= 0) {
      alert("Please enter a valid customer name and credit amount.");
      return;
    }

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";
      }

      const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

      await addDoc(collection(db, "credits"), {
        userId: currentUserId,
        customerName: name,
        phone: phone || "N/A",
        amount: amount,
        notes: notes || "",
        isPaid: false,
        date: todayStr,
        createdAt: serverTimestamp()
      });

      alert("Credit record added successfully!");
      addCreditForm.reset();
      if (modal) modal.classList.remove("active");
      loadCreditLedger();

    } catch (err) {
      console.error("Error adding credit record:", err);
      alert("Failed to add credit record: " + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerText = "Save Credit Record";
      }
    }
  });
}

const searchInputEl = document.getElementById("searchCustomerInput");
if (searchInputEl) {
  searchInputEl.addEventListener("input", renderLedger);
}

const logoutBtnEl = document.getElementById("logoutBtn");
if (logoutBtnEl) {
  logoutBtnEl.addEventListener("click", logoutUser);
}