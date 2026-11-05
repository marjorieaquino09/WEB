import { db, auth } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  onSnapshot,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserId = null;

let productsData = [];
let transactionsData = [];
let creditsData = [];
let directNotificationsData = [];

const container = document.getElementById("notificationsContainer");
const summary = document.getElementById("notificationSummary");
const storeName = document.getElementById("topbarStoreName");
const avatar = document.getElementById("topbarAvatarContainer") || document.getElementById("avatarContainer");

function showMessage(message, type = "normal") {
  if (!container) return;

  if (type === "error") {
    container.innerHTML = `
      <div class="notif-error">
        <i class="fa-solid fa-circle-exclamation" style="font-size:28px;margin-bottom:10px;"></i>
        <br>
        ${escapeHtml(message)}
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="notif-empty">
      <i class="fa-solid fa-bell-slash notif-empty-icon"></i>
      <br>
      ${escapeHtml(message)}
    </div>
  `;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showMessage("Please log in first.", "error");
    if (storeName) {
      storeName.innerText = "Not Logged In";
      storeName.style.color = "#ffffff";
    }
    return;
  }

  currentUserId = user.uid;

  try {
    await loadUserProfile();
    await loadAllNotifications();
    startRealtimeListeners();
  } catch (error) {
    console.error("Notification system error:", error);
    showMessage("Unable to load notifications. Check the browser console.", "error");
  }
});

async function loadUserProfile() {
  if (storeName) {
    storeName.style.color = "#ffffff";
    storeName.style.fontWeight = "700";
  }

  try {
    const savedStoreName = localStorage.getItem("customStoreName");
    const savedImage = localStorage.getItem("userProfileImage");

    const userRef = doc(db, "users", currentUserId);
    const userSnap = await getDoc(userRef);

    let nameToDisplay = savedStoreName || "My Store";
    let profileImg = savedImage || null;

    if (userSnap.exists()) {
      const data = userSnap.data();
      nameToDisplay = savedStoreName || data.store_name || data.full_name || "My Store";
      if (!profileImg && data.profile_image) {
        profileImg = data.profile_image;
      }
    }

    if (storeName) {
      storeName.innerText = nameToDisplay;
    }

    if (avatar) {
      avatar.style.width = "32px";
      avatar.style.height = "32px";
      avatar.style.borderRadius = "50%";
      avatar.style.display = "flex";
      avatar.style.alignItems = "center";
      avatar.style.justifyContent = "center";
      avatar.style.backgroundColor = "#ffffff";
      avatar.style.color = "#1b382b";
      avatar.style.fontWeight = "700";
      avatar.style.fontSize = "0.9rem";
      avatar.style.overflow = "hidden";

      if (profileImg) {
        avatar.innerHTML = `<img src="${escapeHtml(profileImg)}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" alt="Avatar">`;
      } else {
        const initialLetter = nameToDisplay.charAt(0).toUpperCase();
        avatar.innerText = initialLetter;
      }
    }
  } catch (error) {
    console.error("Profile error:", error);
    if (storeName) storeName.innerText = "My Store";
  }
}

async function loadAllNotifications() {
  const userProductsQuery = collection(db, "users", currentUserId, "inventory");
  const rootProductsQuery = query(collection(db, "products"), where("userId", "==", currentUserId));

  const userTransactionsQuery = collection(db, "users", currentUserId, "transactions");
  const rootTransactionsQuery = query(collection(db, "transactions"), where("userId", "==", currentUserId));

  const userCreditsQuery = collection(db, "users", currentUserId, "credits");
  const rootCreditsQuery = query(collection(db, "credits"), where("userId", "==", currentUserId));

  const userNotifsQuery = collection(db, "users", currentUserId, "notifications");
  const rootNotifsQuery = query(collection(db, "notifications"), where("userId", "==", currentUserId));

  const [
    uProdSnap, rProdSnap,
    uTxnSnap, rTxnSnap,
    uCredSnap, rCredSnap,
    uNotifSnap, rNotifSnap
  ] = await Promise.all([
    getDocs(userProductsQuery).catch(() => ({ docs: [] })),
    getDocs(rootProductsQuery).catch(() => ({ docs: [] })),
    getDocs(userTransactionsQuery).catch(() => ({ docs: [] })),
    getDocs(rootTransactionsQuery).catch(() => ({ docs: [] })),
    getDocs(userCreditsQuery).catch(() => ({ docs: [] })),
    getDocs(rootCreditsQuery).catch(() => ({ docs: [] })),
    getDocs(userNotifsQuery).catch(() => ({ docs: [] })),
    getDocs(rootNotifsQuery).catch(() => ({ docs: [] }))
  ]);

  const prodMap = new Map();
  [...rProdSnap.docs, ...uProdSnap.docs].forEach(docSnap => {
    prodMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });
  productsData = Array.from(prodMap.values());

  const txnMap = new Map();
  [...rTxnSnap.docs, ...uTxnSnap.docs].forEach(docSnap => {
    txnMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });
  transactionsData = Array.from(txnMap.values());

  const credMap = new Map();
  [...rCredSnap.docs, ...uCredSnap.docs].forEach(docSnap => {
    credMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });
  creditsData = Array.from(credMap.values());

  const notifMap = new Map();
  const unreadNotifRefs = [];

  [...rNotifSnap.docs, ...uNotifSnap.docs].forEach(docSnap => {
    const data = docSnap.data();
    const isSub = docSnap.ref.path.includes(`/users/${currentUserId}/`);
    notifMap.set(docSnap.id, { id: docSnap.id, isSubcollection: isSub, ...data });

    if (data.isRead !== true) {
      unreadNotifRefs.push({ ref: docSnap.ref });
    }
  });
  directNotificationsData = Array.from(notifMap.values());

  renderAll();

  if (unreadNotifRefs.length > 0) {
    await markNotificationsAsReadRefs(unreadNotifRefs);
  } else {
    clearNotifBadge();
  }
}

function startRealtimeListeners() {
  const userProductsRef = collection(db, "users", currentUserId, "inventory");
  const userTransactionsRef = collection(db, "users", currentUserId, "transactions");
  const userCreditsRef = collection(db, "users", currentUserId, "credits");
  const userNotifsRef = collection(db, "users", currentUserId, "notifications");

  const rootProductsRef = query(collection(db, "products"), where("userId", "==", currentUserId));
  const rootTransactionsRef = query(collection(db, "transactions"), where("userId", "==", currentUserId));
  const rootCreditsRef = query(collection(db, "credits"), where("userId", "==", currentUserId));
  const rootNotifsRef = query(collection(db, "notifications"), where("userId", "==", currentUserId));

  let rProds = [], uProds = [];
  let rTxns = [], uTxns = [];
  let rCreds = [], uCreds = [];
  let rNotifs = [], uNotifs = [];

  const updateAndRender = () => {
    const pMap = new Map();
    [...rProds, ...uProds].forEach(p => pMap.set(p.id, p));
    productsData = Array.from(pMap.values());

    const tMap = new Map();
    [...rTxns, ...uTxns].forEach(t => tMap.set(t.id, t));
    transactionsData = Array.from(tMap.values());

    const cMap = new Map();
    [...rCreds, ...uCreds].forEach(c => cMap.set(c.id, c));
    creditsData = Array.from(cMap.values());

    const nMap = new Map();
    const unreadRefs = [];
    [...rNotifs, ...uNotifs].forEach(n => {
      nMap.set(n.id, n);
      if (n.isRead !== true && n.docRef) {
        unreadRefs.push({ ref: n.docRef });
      }
    });
    directNotificationsData = Array.from(nMap.values());

    renderAll();

    if (unreadRefs.length > 0) {
      markNotificationsAsReadRefs(unreadRefs);
    } else {
      clearNotifBadge();
    }
  };

  onSnapshot(userProductsRef, snap => {
    uProds = [];
    snap.forEach(d => uProds.push({ id: d.id, ...d.data() }));
    updateAndRender();
  });

  onSnapshot(rootProductsRef, snap => {
    rProds = [];
    snap.forEach(d => rProds.push({ id: d.id, ...d.data() }));
    updateAndRender();
  });

  onSnapshot(userTransactionsRef, snap => {
    uTxns = [];
    snap.forEach(d => uTxns.push({ id: d.id, ...d.data() }));
    updateAndRender();
  });

  onSnapshot(rootTransactionsRef, snap => {
    rTxns = [];
    snap.forEach(d => rTxns.push({ id: d.id, ...d.data() }));
    updateAndRender();
  });

  onSnapshot(userCreditsRef, snap => {
    uCreds = [];
    snap.forEach(d => uCreds.push({ id: d.id, ...d.data() }));
    updateAndRender();
  });

  onSnapshot(rootCreditsRef, snap => {
    rCreds = [];
    snap.forEach(d => rCreds.push({ id: d.id, ...d.data() }));
    updateAndRender();
  });

  onSnapshot(userNotifsRef, snap => {
    uNotifs = [];
    snap.forEach(d => uNotifs.push({ id: d.id, docRef: d.ref, ...d.data() }));
    updateAndRender();
  });

  onSnapshot(rootNotifsRef, snap => {
    rNotifs = [];
    snap.forEach(d => rNotifs.push({ id: d.id, docRef: d.ref, ...d.data() }));
    updateAndRender();
  });
}

async function markNotificationsAsReadRefs(notifRefList) {
  const results = await Promise.allSettled(
    notifRefList.map((item) => updateDoc(item.ref, { isRead: true, read: true }))
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error("Hindi na-mark as read:", failed.map((f) => f.reason));
  }

  clearNotifBadge();
}

function clearNotifBadge() {
  const badgeEl = document.getElementById("notifBadge");
  if (badgeEl) {
    badgeEl.innerText = "0";
    badgeEl.style.display = "none";
  }
}

function renderAll() {
  const notifications = buildNotifications();
  updateSummary(notifications);
  renderNotifications(notifications);
}

function pickMessage(n) {
  const candidates = [
    n.message, n.description, n.body, n.subtitle, n.text,
    n.content, n.detail, n.details, n.msg, n.note
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  const peso = (v) => `₱${Number(v).toFixed(2)}`;
  const parts = [];

  const product = n.productName || n.product_name || n.product || n.name;
  if (typeof product === "string" && product.trim()) {
    parts.push(product.trim());
  }
  if (n.stock !== undefined && n.stock !== null && n.stock !== "") {
    parts.push(`${n.stock} left`);
  }
  if (n.customerName || n.customer_name) {
    parts.push(String(n.customerName || n.customer_name));
  }
  if (n.paymentMethod || n.payment_method) {
    parts.push(String(n.paymentMethod || n.payment_method));
  }
  const total = n.total ?? n.totalAmount ?? n.amount;
  if (total !== undefined && total !== null && total !== "" && !Number.isNaN(Number(total))) {
    parts.push(peso(total));
  }

  return parts.join(" — ");
}

function buildNotifications() {
  const notifications = [];

  directNotificationsData.forEach((notif) => {
    let iconClass = "fa-bell";
    let colorHex = "#60a5fa";

    const titleLower = String(notif.title || "").toLowerCase();

    if (notif.category === "danger" || titleLower.includes("out of stock")) {
      iconClass = "fa-circle-xmark";
      colorHex = "#ef4444";
    } else if (notif.category === "warning" || titleLower.includes("low stock")) {
      iconClass = "fa-triangle-exclamation";
      colorHex = "#f59e0b";
    } else if (notif.category === "sales" || notif.type === "sale") {
      iconClass = "fa-receipt";
      colorHex = "#22c55e";
    } else {
      iconClass = "fa-box";
      colorHex = "#22c55e";
    }

    notifications.push({
      type: notif.type || "inventory",
      title: notif.title || "Inventory Alert",
      message: pickMessage(notif),
      icon: iconClass,
      color: colorHex,
      time: getTime(notif.created_at || notif.createdAt)
    });
  });

  productsData.forEach((product) => {
    const stock = Number(product.stock ?? product.stock_quantity ?? 0);
    const prodTime = getTime(product.updatedAt || product.updated_at || product.createdAt || product.created_at);

    const isAlreadyInDirect = directNotificationsData.some(d => {
      const msg = pickMessage(d);
      return msg && product.name && msg.includes(product.name);
    });

    if (!isAlreadyInDirect && product.hidden !== true) {
      if (stock === 0) {
        notifications.push({
          type: "inventory",
          title: "Out of Stock",
          message: `"${product.name || "Product"}" is out of stock.`,
          icon: "fa-circle-xmark",
          color: "#ef4444",
          time: prodTime
        });
      } else if (stock <= 5) {
        notifications.push({
          type: "inventory",
          title: "Low Stock",
          message: `"${product.name || "Product"}" has only ${stock} left.`,
          icon: "fa-triangle-exclamation",
          color: "#f59e0b",
          time: prodTime
        });
      }
    }
  });

  transactionsData.forEach((transaction) => {
    const amount = Number(transaction.totalAmount || transaction.total_amount || transaction.amount || 0);
    const customer = transaction.customerName || transaction.customer_name || "Walk-in Customer";
    const method = transaction.paymentMethod || transaction.payment_method || "Cash";

    const isAlreadyInDirect = directNotificationsData.some(d => {
      const msg = pickMessage(d);
      return msg && msg.includes(`₱${amount.toFixed(2)}`);
    });

    if (!isAlreadyInDirect) {
      notifications.push({
        type: "transaction",
        title: "New Transaction",
        message: `${customer} — ${method} — ₱${amount.toFixed(2)}`,
        icon: "fa-receipt",
        color: "#60a5fa",
        time: getTime(transaction.createdAt || transaction.created_at)
      });
    }
  });

  creditsData.forEach((credit) => {
    const amount = Number(credit.amount || credit.totalAmount || credit.total_amount || 0);
    const customer = credit.customerName || credit.customer_name || "Customer";
    const paid = credit.isPaid === true;

    notifications.push({
      type: "credit",
      title: paid ? "Credit Paid" : "Unpaid Credit",
      message: paid ? `${customer} paid ₱${amount.toFixed(2)}.` : `${customer} owes ₱${amount.toFixed(2)}.`,
      icon: paid ? "fa-circle-check" : "fa-money-bill-transfer",
      color: paid ? "#22c55e" : "#f97316",
      time: getTime(credit.updatedAt || credit.updated_at || credit.createdAt || credit.created_at || credit.date)
    });
  });

  notifications.sort((a, b) => b.time - a.time);

  return notifications;
}

function updateSummary(notifications) {
  if (!summary) return;

  const inventory = notifications.filter(item => item.type === "inventory").length;
  const transactions = notifications.filter(item => item.type === "transaction" || item.type === "sale").length;
  const credits = notifications.filter(item => item.type === "credit").length;

  if (inventory === 0 && transactions === 0 && credits === 0) {
    summary.innerHTML = "";
    return;
  }

  summary.innerHTML = `
    ${inventory > 0 ? `<span class="notif-summary-item notif-summary-inventory">Inventory ${inventory}</span>` : ""}
    ${transactions > 0 ? `<span class="notif-summary-item notif-summary-transactions">Transactions ${transactions}</span>` : ""}
    ${credits > 0 ? `<span class="notif-summary-item notif-summary-credit">Credit ${credits}</span>` : ""}
  `;
}

function renderNotifications(notifications) {
  if (!container) return;

  if (notifications.length === 0) {
    showMessage("No notifications yet.");
    return;
  }

  container.innerHTML = `
    <div class="notif-section-title">
      <strong>Recent Notifications</strong>
      <span class="notif-count">${notifications.length}</span>
    </div>

    ${notifications.map((item) => `
      <div class="notif-item">
        <div class="notif-item-icon" style="color:${item.color}; background:${item.color}20;">
          <i class="fa-solid ${item.icon}"></i>
        </div>
        <div class="notif-item-content">
          <h4>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(item.message)}</p>
        </div>
        <div class="notif-item-time">
          ${formatTime(item.time)}
        </div>
      </div>
    `).join("")}
  `;
}

function getTime(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  if (typeof value === "object" && value.seconds) return value.seconds * 1000;
  return 0;
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}