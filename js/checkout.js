import { db } from "./firebase-config.js";
import { checkAuth, logoutUser } from "./auth.js";
import { startBarcodeScanner, stopBarcodeScanner, isScannerRunning, sameBarcode } from "./scanner.js";
import { 
  collection, 
  query,
  where,
  onSnapshot, 
  doc, 
  getDoc, 
  serverTimestamp,
  writeBatch,
  deleteDoc,
  increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUserId = null;
let allProducts = [];
let inventoryItems = [];
let legacyItems = [];
let cart = [];
let selectedCategory = "All";
let searchQuery = "";
let paymentMethod = "Cash";

let remoteCartItems = null;
let productsLoaded = false;
let inventoryReady = false;
let legacyReady = false;
let pendingRemoteApply = false;
let hadRemoteCart = false;

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

  loadProductsRealtime();
  listenRemoteCart();
});

const SIZE_RE = /\b\d+(?:\.\d+)?\s?(?:ml|l|g|kg|oz|pcs|pc)\b/g;
const STOP_WORDS = new Set(["sachet", "pack", "pc", "pcs", "piece", "and", "the", "of"]);

function hasBarcode(item) {
  const bc = String(item.barcode || "").trim();
  return bc !== "" && bc.toUpperCase() !== "N/A";
}

function nameInfo(item) {
  const raw = String(item.name || "").toLowerCase().replace(/['’`]/g, "");
  const sizes = (raw.match(SIZE_RE) || []).map((s) => s.replace(/\s/g, ""));
  const words = raw
    .replace(SIZE_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => (w.length > 4 ? w.replace(/ing$/, "") : w));
  return { sizes, words, compact: words.join("") };
}

function isSameProduct(a, b) {
  const aHas = hasBarcode(a);
  const bHas = hasBarcode(b);

  if (aHas && bHas) {
    return sameBarcode(a.barcode, b.barcode);
  }

  const x = nameInfo(a);
  const y = nameInfo(b);
  if (!x.compact || !y.compact) return false;

  if (x.sizes.length && y.sizes.length && x.sizes.join() !== y.sizes.join()) {
    return false;
  }

  if (x.compact === y.compact) return true;

  const [small, large] = x.words.length <= y.words.length ? [x, y] : [y, x];
  return (
    small.words.length >= 2 &&
    large.words.length - small.words.length <= 1 &&
    small.words.every((w) => large.words.includes(w))
  );
}

function rebuildProducts() {
  const sorted = [...inventoryItems, ...legacyItems].sort((a, b) => {
    const barcodeDiff = Number(hasBarcode(b)) - Number(hasBarcode(a));
    if (barcodeDiff !== 0) return barcodeDiff;

    const stockDiff = Number(b.stock || 0) - Number(a.stock || 0);
    if (stockDiff !== 0) return stockDiff;

    return Number(b.src === "inventory") - Number(a.src === "inventory");
  });

  const groups = [];

  sorted.forEach((item) => {
    const group = groups.find((g) => isSameProduct(g, item));

    if (!group) {
      groups.push({ ...item });
      return;
    }

    if (!(Number(group.price) > 0) && Number(item.price) > 0) group.price = item.price;
    if (!hasBarcode(group) && hasBarcode(item)) group.barcode = item.barcode;
    if (!group.image && !group.imageUrl) group.image = item.image || item.imageUrl;
  });

  allProducts = groups;

  productsLoaded = inventoryReady && legacyReady;
  if (!productsLoaded) return;

  renderProducts();

  if (pendingRemoteApply) {
    pendingRemoteApply = false;
    applyRemoteCart();
  }
}

function loadProductsRealtime() {
  onSnapshot(
    collection(db, "users", currentUserId, "inventory"),
    (snapshot) => {
      inventoryItems = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.hidden) {
          inventoryItems.push({ id: docSnap.id, ...data, src: "inventory" });
        }
      });
      inventoryReady = true;
      rebuildProducts();
    },
    (err) => {
      console.error("Inventory load error:", err);
      inventoryReady = true;
      rebuildProducts();
    }
  );

  onSnapshot(
    query(collection(db, "products"), where("userId", "==", currentUserId)),
    (snapshot) => {
      legacyItems = [];
      snapshot.forEach((docSnap) => {
        legacyItems.push({ id: docSnap.id, ...docSnap.data(), src: "products" });
      });
      legacyReady = true;
      rebuildProducts();
    },
    (err) => {
      console.error("Products load error:", err);
      legacyReady = true;
      rebuildProducts();
    }
  );
}

function cartDocRef() {
  return doc(db, "users", currentUserId, "cart", "current");
}

function listenRemoteCart() {
  onSnapshot(
    cartDocRef(),
    (snap) => {
      const items = snap.exists() ? snap.data().items : null;

      if (!Array.isArray(items) || items.length === 0) {
        if (hadRemoteCart) {
          cart = [];
          renderCart();
        }
        hadRemoteCart = false;
        remoteCartItems = null;
        return;
      }

      hadRemoteCart = true;
      remoteCartItems = items;
      applyRemoteCart();
    },
    (err) => console.error("Cart sync error:", err)
  );
}

function applyRemoteCart() {
  if (!remoteCartItems) return;

  if (!productsLoaded) {
    pendingRemoteApply = true;
    return;
  }

  cart = remoteCartItems.map((r) => {
    const qty = Number(r.quantity || 1);
    const match = allProducts.find(
      (p) =>
        (r.barcode && p.barcode && sameBarcode(p.barcode, r.barcode)) ||
        p.id === r.productId ||
        (r.name && normName(p.name) === normName(r.name))
    );

    if (match && !r.skipInventory) {
      return {
        id: match.id,
        src: match.src,
        name: match.name || r.name || "",
        price: Number(match.price || r.price || 0),
        quantity: qty,
        stock: Number(match.stock || 0),
        image: match.image || match.imageUrl || r.imageUrl || "default.jpg",
        barcode: match.barcode || r.barcode || ""
      };
    }

    return {
      id: null,
      src: null,
      name: r.name || "Item",
      price: Number(r.price || 0),
      quantity: qty,
      stock: 999999,
      image: r.imageUrl || "default.jpg",
      barcode: r.barcode || "",
      skipInventory: true
    };
  });

  renderCart();
}

function resolveImage(raw) {
  if (!raw) return "uploads/default.jpg";
  if (raw.startsWith("http") || raw.startsWith("data:") || raw.startsWith("uploads/")) return raw;
  return `uploads/${raw}`;
}

function renderProducts() {
  const posGrid = document.getElementById("posGrid");
  if (!posGrid) return;

  const filtered = allProducts.filter((p) => {
    let matchCat = true;
    if (selectedCategory && selectedCategory !== "All") {
      const pCat = (p.category || "").toLowerCase();
      const selCat = selectedCategory.toLowerCase();

      if (selCat === "beverages" || selCat === "beverage") {
        matchCat = pCat.includes("beverage");
      } else if (selCat === "snacks" || selCat === "chips" || selCat === "biscuits") {
        matchCat = pCat.includes("snack") || pCat.includes("chip") || pCat.includes("biscuit");
      } else {
        matchCat = pCat === selCat;
      }
    }

    const matchSearch =
      !searchQuery ||
      (p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.barcode && String(p.barcode).includes(searchQuery));
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    posGrid.innerHTML = `<p style="grid-column: 1 / -1; color: #ffffff; text-align: center; padding: 20px;">Walang nahanap na produkto.</p>`;
    return;
  }

  posGrid.innerHTML = filtered.map((p) => {
    const stock = Number(p.stock || 0);
    const price = Number(p.price || 0);
    const isAvailable = stock > 0;
    const imgSource = resolveImage(p.image || p.imageUrl);

    return `
      <div class="pos-product-card" data-id="${p.id}" style="opacity: ${isAvailable ? '1' : '0.5'}; cursor: ${isAvailable ? 'pointer' : 'not-allowed'}; display: flex; flex-direction: column; align-items: center; text-align: center;">
        <div class="pos-add-btn"><i class="fa-solid fa-plus"></i></div>
        <img src="${imgSource}" onerror="this.onerror=null; this.src='https://via.placeholder.com/50?text=SARI';" style="width: 45px; height: 45px; object-fit: cover; border-radius: 8px; margin-bottom: 6px;">
        <div class="pos-product-name" style="width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.name || ''}</div>
        <div class="pos-product-price">₱${price.toFixed(2)}</div>
        <div style="font-size: 0.72rem; font-weight: 700; color: ${isAvailable ? '#4a9c62' : '#d1544a'};">
          Stock: ${stock}
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".pos-product-card").forEach((card) => {
    card.addEventListener("click", () => {
      addToCart(card.dataset.id);
    });
  });
}

function addToCart(productId) {
  const product = allProducts.find((p) => p.id === productId);
  if (!product || Number(product.stock) <= 0) return;

  const existing = cart.find((item) => item.id === productId);

  if (existing) {
    if (existing.quantity < Number(product.stock)) {
      existing.quantity += 1;
    } else {
      alert("Sobra na sa available stock!");
      return;
    }
  } else {
    cart.push({
      id: product.id,
      src: product.src,
      name: product.name,
      price: Number(product.price || 0),
      quantity: 1,
      stock: Number(product.stock),
      image: product.image || product.imageUrl || 'default.jpg',
      barcode: product.barcode || ""
    });
  }

  renderCart();
}

function renderCart() {
  const cartContainer = document.getElementById("cartContainer");
  const subtotalText = document.getElementById("subtotalText");
  const totalText = document.getElementById("totalText");

  if (cart.length === 0) {
    cartContainer.innerHTML = `<p style="text-align:center; color:#9aa9a0; font-size:13px; margin: 20px 0;">Cart is empty</p>`;
    if (subtotalText) subtotalText.innerText = "₱0.00";
    if (totalText) totalText.innerText = "₱0.00";
    return;
  }

  let total = 0;

  cartContainer.innerHTML = cart.map((item, idx) => {
    const itemTotal = item.price * item.quantity;
    total += itemTotal;
    const imgSource = resolveImage(item.image);

    return `
      <div class="pos-cart-item">
        <img src="${imgSource}" onerror="this.onerror=null; this.src='https://via.placeholder.com/34?text=SARI';" class="pos-cart-icon" style="width: 34px; height: 34px; object-fit: cover; border-radius: 50%;">
        <div style="overflow:hidden;">
          <div class="pos-cart-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.name}</div>
          <div class="pos-cart-unit-price">₱${item.price.toFixed(2)}</div>
        </div>
        <div class="pos-qty-stepper">
          <button class="qty-btn" data-idx="${idx}" data-act="minus">-</button>
          <span>${item.quantity}</span>
          <button class="qty-btn" data-idx="${idx}" data-act="plus">+</button>
        </div>
        <div class="pos-cart-line-price">₱${itemTotal.toFixed(2)}</div>
        <button class="pos-remove-btn" data-idx="${idx}"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `;
  }).join("");

  if (subtotalText) subtotalText.innerText = `₱${total.toFixed(2)}`;
  if (totalText) totalText.innerText = `₱${total.toFixed(2)}`;

  document.querySelectorAll(".qty-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx);
      const act = btn.dataset.act;

      if (act === "plus") {
        if (cart[idx].quantity < cart[idx].stock) {
          cart[idx].quantity += 1;
        } else {
          alert("Sobra na sa magagamit na stock!");
        }
      } else {
        cart[idx].quantity -= 1;
        if (cart[idx].quantity <= 0) cart.splice(idx, 1);
      }
      renderCart();
    });
  });

  document.querySelectorAll(".pos-remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx);
      cart.splice(idx, 1);
      renderCart();
    });
  });
}

const payCashBtn = document.getElementById("payCashBtn");
const payCreditBtn = document.getElementById("payCreditBtn");
const creditCustomerDiv = document.getElementById("creditCustomerDiv");

if (payCashBtn && payCreditBtn) {
  payCashBtn.addEventListener("click", () => {
    paymentMethod = "Cash";
    payCashBtn.classList.add("active");
    payCreditBtn.classList.remove("active");
    if (creditCustomerDiv) creditCustomerDiv.style.display = "none";
  });

  payCreditBtn.addEventListener("click", () => {
    paymentMethod = "Credit";
    payCreditBtn.classList.add("active");
    payCashBtn.classList.remove("active");
    if (creditCustomerDiv) creditCustomerDiv.style.display = "block";
  });
}

const completeSaleBtn = document.getElementById("completeSaleBtn");
if (completeSaleBtn) {
  completeSaleBtn.addEventListener("click", async () => {
    if (cart.length === 0) {
      alert("Walang laman ang cart!");
      return;
    }

    const customerInput = document.getElementById("customerNameInput");
    let customerName = customerInput ? customerInput.value.trim() : "";

    if (paymentMethod === "Credit" && !customerName) {
      alert("Pakilagay ang pangalan ng nagkakautang!");
      return;
    }

    const overStock = cart.find((i) => !i.skipInventory && i.quantity > i.stock);
    if (overStock) {
      alert(`Kulang ang stock ng ${overStock.name} (available: ${overStock.stock}).`);
      return;
    }

    try {
      completeSaleBtn.disabled = true;
      completeSaleBtn.innerText = "Processing...";

      const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const finalCustomer = paymentMethod === "Credit" ? customerName : "Walk-in Customer";
      const batch = writeBatch(db);

      const txnRef = doc(collection(db, "transactions"));
      batch.set(txnRef, {
        userId: currentUserId,
        items: cart,
        totalAmount: totalAmount,
        paymentMethod: paymentMethod,
        customerName: finalCustomer,
        createdAt: serverTimestamp()
      });

      if (paymentMethod === "Credit") {
        batch.set(doc(collection(db, "credits")), {
          userId: currentUserId,
          customerName: customerName,
          amount: Number(totalAmount),
          date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          isPaid: false,
          saleId: txnRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      for (const item of cart) {
        if (item.skipInventory || !item.id) continue;

        if (item.src === "products") {
          batch.update(doc(db, "products", item.id), {
            stock: increment(-item.quantity)
          });
        } else {
          batch.update(doc(db, "users", currentUserId, "inventory", item.id), {
            stock: increment(-item.quantity),
            updatedAt: serverTimestamp()
          });
        }
      }

      const orderRef = doc(collection(db, "orders"));
      batch.set(orderRef, {
        orderId: orderRef.id,
        items: cart.map((i) => ({
          barcode: i.barcode || i.id || "",
          id: i.barcode || i.id || "",
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          subtotal: i.price * i.quantity,
          ...(i.skipInventory ? { skipInventory: true } : {})
        })),
        totalAmount: totalAmount,
        paymentMethod: paymentMethod === "Credit" ? "Credit / Utang" : "Cash",
        customerName: finalCustomer,
        userId: currentUserId,
        status: "completed",
        source: "web_app",
        createdAtMs: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await batch.commit();

      try {
        await deleteDoc(cartDocRef());
      } catch (e) {
        console.warn("Hindi nabura ang shared cart:", e);
      }

      alert("Sale completed successfully!");
      cart = [];
      if (customerInput) customerInput.value = "";
      renderCart();

    } catch (err) {
      console.error("Sale Error:", err);
      alert("Nagka-error sa pagpoproseso.");
    } finally {
      completeSaleBtn.disabled = false;
      completeSaleBtn.innerText = "Complete Sale";
    }
  });
}

const clearCartBtn = document.getElementById("clearCartBtn");
if (clearCartBtn) {
  clearCartBtn.addEventListener("click", async () => {
    cart = [];
    renderCart();
    try {
      await deleteDoc(cartDocRef());
    } catch (e) {
      console.warn("Hindi nabura ang shared cart:", e);
    }
  });
}

const posSearch = document.getElementById("posSearch");
if (posSearch) {
  posSearch.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderProducts();
  });
}

document.querySelectorAll(".pos-category").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pos-category").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedCategory = btn.dataset.category || "All";
    renderProducts();
  });
});

function normName(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findProductByCode(code) {
  return allProducts.find((p) => p.barcode && sameBarcode(p.barcode, code)) || null;
}

async function handleScannedCode(rawCode) {
  const code = String(rawCode || "").trim();
  if (!code) return false;
  console.log("SCANNED:", code);

  const product = findProductByCode(code);
  if (product) {
    addToCart(product.id);
    return true;
  }
  alert(`Walang nakitang produkto para sa code na ito: ${code}`);
  return false;
}

const startScanBtn = document.getElementById("startScanBtn");
if (startScanBtn) {
  startScanBtn.addEventListener("click", async () => {
    if (isScannerRunning()) {
      await stopBarcodeScanner("reader");
      return;
    }

    await startBarcodeScanner({
      readerId: "reader",
      onDetected: (scannedCode) => {
        handleScannedCode(scannedCode);
      }
    });
  });
}

if (posSearch) {
  posSearch.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const code = posSearch.value.trim();
    if (!/^\d{6,}$/.test(code)) return;
    e.preventDefault();

    const ok = await handleScannedCode(code);
    if (ok) {
      posSearch.value = "";
      searchQuery = "";
      renderProducts();
    }
    posSearch.focus();
  });
}

let wedgeBuffer = "";
let wedgeLast = 0;
document.addEventListener("keydown", async (e) => {
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const now = Date.now();
  if (now - wedgeLast > 80) wedgeBuffer = "";
  wedgeLast = now;

  if (e.key === "Enter") {
    const code = wedgeBuffer;
    wedgeBuffer = "";
    if (/^\d{6,}$/.test(code)) await handleScannedCode(code);
    return;
  }
  if (e.key.length === 1) wedgeBuffer += e.key;
});

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    logoutUser();
  });
}