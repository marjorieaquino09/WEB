import { db, auth } from "./firebase-config.js";
import { logoutUser } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { initializeDefaultProducts } from "./init-products.js";

let currentUserId = null;
let selectedCategory = "";
let searchQuery = "";
let rawUserInventory = [];
let rawCatalogProducts = [];
let mergedProducts = [];

let unsubscribeUserInventory = null;
let unsubscribeCatalog = null;

onAuthStateChanged(auth, async (user) => {
  const isAuthPage = window.location.pathname.endsWith("login.html") ||
                     window.location.pathname.endsWith("signup.html") ||
                     window.location.pathname.endsWith("index.html");

  if (isAuthPage) return;

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUserId = user.uid;

  loadTopbarUserData(user);

  try {
    if (typeof initializeDefaultProducts === "function") {
      await initializeDefaultProducts(currentUserId);
    }
  } catch (seedErr) {
    console.error("Error initializing default products:", seedErr);
  }

  loadProductsRealtime();
});

async function loadTopbarUserData(user) {
  const topbarStoreName = document.getElementById("topbarStoreName");
  const avatarContainer =
    document.getElementById("avatarContainer") ||
    document.getElementById("topbarAvatarContainer");

  if (topbarStoreName) {
    topbarStoreName.style.color = "#ffffff";
    topbarStoreName.style.fontWeight = "700";
  }

  try {
    const userDocRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userDocRef);

    let storeName = "My Store";
    let profileImg = null;

    if (userSnap.exists()) {
      const data = userSnap.data();
      storeName = data.store_name || data.full_name || "My Store";
      profileImg = data.profile_image || null;
    }

    if (topbarStoreName) {
      topbarStoreName.innerText = storeName;
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
  } catch (error) {
    console.error("Error loading topbar user data:", error);
  }
}

function loadProductsRealtime() {
  if (unsubscribeUserInventory) unsubscribeUserInventory();
  if (unsubscribeCatalog) unsubscribeCatalog();

  const userInvRef = collection(db, "users", currentUserId, "inventory");
  unsubscribeUserInventory = onSnapshot(userInvRef, (querySnapshot) => {
    rawUserInventory = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.hidden !== true) {
        rawUserInventory.push({ id: docSnap.id, ...data });
      }
    });
    combineAndRenderProducts();
  }, (error) => {
    console.error("Error fetching user inventory:", error);
  });

  const catalogRef = collection(db, "products");
  unsubscribeCatalog = onSnapshot(catalogRef, (querySnapshot) => {
    rawCatalogProducts = [];
    querySnapshot.forEach((docSnap) => {
      rawCatalogProducts.push({ id: docSnap.id, ...docSnap.data() });
    });
    combineAndRenderProducts();
  }, (error) => {
    console.error("Error fetching catalog products:", error);
  });
}

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
    return String(a.barcode).trim() === String(b.barcode).trim();
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

function combineAndRenderProducts() {
  const allItems = [...rawUserInventory, ...rawCatalogProducts].sort((a, b) => {
    const diff = Number(hasBarcode(b)) - Number(hasBarcode(a));
    if (diff !== 0) return diff;
    return Number(b.stock ?? b.stock_quantity ?? 0) - Number(a.stock ?? a.stock_quantity ?? 0);
  });

  const groups = [];

  allItems.forEach((item) => {
    const stock = Number(item.stock ?? item.stock_quantity ?? 0);
    const price = Number(item.price || 0);
    const image = item.imageUrl || item.image || "default.jpg";

    const group = groups.find((g) => isSameProduct(g, item));

    if (!group) {
      groups.push({ ...item, stock, price, image });
      return;
    }

    group.stock = Math.max(Number(group.stock || 0), stock);
    if (!(Number(group.price) > 0)) group.price = price;
    if (!hasBarcode(group) && hasBarcode(item)) group.barcode = item.barcode;
    if (!group.image || group.image === "default.jpg") group.image = image;
  });

  mergedProducts = groups.map((p) => ({
    ...p,
    stock: Number(p.stock || 0),
    price: Number(p.price || 0),
    image: p.imageUrl || p.image || "default.jpg"
  }));

  mergedProducts.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  renderProducts();
}

function renderProducts() {
  const productGrid = document.getElementById("productGrid");
  if (!productGrid) return;

  const filtered = mergedProducts.filter((p) => {
    const matchCategory = !selectedCategory || selectedCategory === "All" || p.category === selectedCategory;
    const matchSearch = !searchQuery ||
      (p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.barcode && p.barcode.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchCategory && matchSearch;
  });

  if (filtered.length === 0) {
    productGrid.innerHTML = `<p style="color: #ffffff; grid-column: 1 / -1; text-align: center; padding: 40px;">Wala pang nahanap na produkto.</p>`;
    return;
  }

  productGrid.innerHTML = filtered.map((p) => {
    const stock = Number(p.stock || 0);

    let imgSource = "uploads/default.jpg";
    if (p.image) {
      if (p.image.startsWith("http") || p.image.startsWith("data:")) {
        imgSource = p.image;
      } else if (p.image.startsWith("uploads/")) {
        imgSource = p.image;
      } else {
        imgSource = `uploads/${p.image}`;
      }
    }

    return `
      <div class="product-card">
        <div class="product-card-img-wrap">
          <img src="${imgSource}" alt="${p.name || 'Product'}" onerror="this.onerror=null; this.src='https://via.placeholder.com/150?text=SARI';">
        </div>
        <div class="product-info">
          <div class="product-category">${p.category || 'General'}</div>
          <div class="product-title">${p.name || ''}</div>
          <div class="product-barcode">Barcode: ${p.barcode || 'N/A'}</div>
          <div class="product-price">₱${Number(p.price || 0).toFixed(2)}</div>
        </div>
        <div class="product-bottom-row">
          <span class="product-stock" style="color: ${stock > 0 ? '#059669' : '#d1544a'};">
            Stock: ${stock}
          </span>
          ${
            stock === 0
              ? `<span style="font-size: 0.62rem; color: #94a3b8; font-weight: 700;">Out of Stock</span>`
              : ``
          }
        </div>
      </div>
    `;
  }).join("");
}

const searchForm = document.getElementById("searchForm");
if (searchForm) {
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    searchQuery = document.getElementById("searchInput").value.trim();
    renderProducts();
  });
}

const searchInput = document.getElementById("searchInput");
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderProducts();
  });
}

document.querySelectorAll(".category-pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll(".category-pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    selectedCategory = pill.dataset.category || "";
    renderProducts();
  });
});

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", (e) => {
    e.preventDefault();
    logoutUser();
  });
}