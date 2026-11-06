import { db, auth } from "./firebase-config.js";
import { checkAuth, logoutUser } from "./auth.js";
import {
  startBarcodeScanner,
  stopBarcodeScanner,
  isScannerRunning,
  sameBarcode
} from "./scanner.js";

import {
  collection,
  query,
  where,
  limit,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  doc,
  getDoc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUserId = null;
let allProducts = [];
let searchQuery = "";
let selectedCategory = "";
let editingProductId = null;

const PRODUCTS_PER_PAGE = 20;
let currentPage = 1;
let inventoryUnsubscribe = null;

function escapeInventoryText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

async function createNotification(title, message, alertType = "inventory") {
  if (!currentUserId) return;

  try {
    await addDoc(collection(db, "notifications"), {
      userId: currentUserId,
      type: "inventory",
      title,
      message,
      description: message,
      status: title,
      category: alertType,
      isRead: false,
      created_at: serverTimestamp()
    });
  } catch (err) {
    console.error("Error creating notification:", err);
  }
}

const DEFAULT_FILTER = (data) =>
  data.isDefault === true || !data.userId;

async function seedDefaultInventoryIfNeeded() {
  const userRef = doc(db, "users", currentUserId);

  try {
    const userSnap = await getDoc(userRef);

    if (
      userSnap.exists() &&
      userSnap.data().default_inventory_seeded_v2
    ) {
      return;
    }

    const invRef = collection(db, "users", currentUserId, "inventory");

    const [defaultsSnap, existingSnap] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(invRef)
    ]);

    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    const defaults = defaultsSnap.docs.filter(
      (item) => DEFAULT_FILTER(item.data()) && !existingIds.has(item.id)
    );

    for (let i = 0; i < defaults.length; i += 400) {
      const batch = writeBatch(db);

      defaults.slice(i, i + 400).forEach((item) => {
        const data = item.data();
        const image = data.image || data.imageUrl || "default.jpg";

        batch.set(doc(invRef, item.id), {
          userId: currentUserId,
          name: data.name || "",
          category: data.category || "General",
          barcode: data.barcode || "",
          price: Number(data.price || 0),
          stock: Number(data.stock ?? 0),
          image,
          imageUrl: image,
          hidden: false,
          isDefault: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
    }

    if (defaultsSnap.size > 0) {
      await setDoc(
        userRef,
        { default_inventory_seeded_v2: true },
        { merge: true }
      );
    }
  } catch (err) {
    console.error(
      "Error seeding default inventory:",
      err.code || "",
      err.message || err
    );
  }
}

checkAuth(async (user) => {
  currentUserId = user.uid;

  const storeNameEl =
    document.getElementById("topbarStoreName") ||
    document.getElementById("topbarUserEmail");

  const avatarContainer =
    document.getElementById("avatarContainer") ||
    document.getElementById("topbarAvatarContainer");

  if (storeNameEl) {
    storeNameEl.style.color = "#ffffff";
    storeNameEl.style.fontWeight = "700";
    storeNameEl.innerText = "Loading...";
  }

  try {
    const userDoc = await getDoc(doc(db, "users", currentUserId));

    let profileImg = null;

    if (userDoc.exists()) {
      const userData = userDoc.data();

      if (storeNameEl) {
        storeNameEl.innerText =
          userData.store_name ||
          userData.full_name ||
          "My Store";
      }

      profileImg = userData.profile_image || null;
    } else if (storeNameEl) {
      storeNameEl.innerText = "My Store";
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
        avatarContainer.innerHTML = '<i class="fa-solid fa-user"></i>';
      }
    }
  } catch (err) {
    console.error("Error fetching store name:", err);

    if (storeNameEl) {
      storeNameEl.innerText = "My Store";
    }
  }

  const stockInput = document.getElementById("addStock");

  if (stockInput && !stockInput.value) {
    stockInput.value = "0";
  }

  await seedDefaultInventoryIfNeeded();
  loadInventoryRealtime();
});

function loadInventoryRealtime() {
  if (!currentUserId) return;

  if (inventoryUnsubscribe) {
    inventoryUnsubscribe();
  }

  const inventoryRef = collection(
    db,
    "users",
    currentUserId,
    "inventory"
  );

  inventoryUnsubscribe = onSnapshot(
    inventoryRef,
    (snapshot) => {
      allProducts = [];

      snapshot.forEach((productDoc) => {
        allProducts.push({
          id: productDoc.id,
          ...productDoc.data()
        });
      });

      allProducts.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""))
      );

      console.log(
        "Inventory UID:",
        currentUserId,
        "| count:",
        allProducts.length
      );

      updateSummaryCards();
      renderInventoryTable();
    },
    (err) => {
      console.error(
        "Inventory listener error:",
        err.code,
        err.message
      );

      const tableBody = document.getElementById("inventoryTableBody");

      if (tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="6"
                style="text-align:center;padding:30px;color:#ef4444;">
              Hindi ma-load ang inventory (${escapeInventoryText(err.code)}).
              Check ang Firestore rules.
            </td>
          </tr>
        `;
      }
    }
  );
}

function updateSummaryCards() {
  const totalProducts = allProducts.length;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalValue = 0;

  allProducts.forEach((product) => {
    const stock = Number(product.stock || 0);
    const price = Number(product.price || 0);

    if (stock === 0) {
      outOfStockCount++;
    } else if (stock <= 5) {
      lowStockCount++;
    }

    totalValue += stock * price;
  });

  const setElemText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  };

  setElemText("statTotalProducts", totalProducts);
  setElemText("statLowStock", lowStockCount);
  setElemText("statOutOfStock", outOfStockCount);

  setElemText(
    "statInventoryValue",
    `₱${totalValue.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`
  );
}

function getStatusBadge(stock) {
  const stockNum = Number(stock) || 0;

  if (stockNum === 0) {
    return `<span class="status-badge out-of-stock">Out of Stock</span>`;
  } else if (stockNum <= 5) {
    return `<span class="status-badge low-stock">Low Stock</span>`;
  }

  return `<span class="status-badge in-stock">In Stock</span>`;
}

function renderInventoryTable() {
  const tableBody = document.getElementById("inventoryTableBody");
  const pagination = document.getElementById("inventoryPagination");

  if (!tableBody) return;

  const term = searchQuery.toLowerCase();

  const filtered = allProducts.filter((product) => {
    const name = String(product.name || "").toLowerCase();
    const barcode = String(product.barcode || "");

    const matchSearch =
      !term ||
      name.includes(term) ||
      barcode.toLowerCase().includes(term);

    const matchCategory =
      !selectedCategory ||
      product.category === selectedCategory;

    return matchSearch && matchCategory;
  });

  const totalProducts = filtered.length;
  const totalPages = Math.ceil(totalProducts / PRODUCTS_PER_PAGE);

  if (totalPages === 0) {
    currentPage = 1;
  } else if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  if (totalProducts === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6"
            style="text-align:center;padding:30px;color:#94a3b8;">
          No products found
        </td>
      </tr>
    `;

    if (pagination) pagination.innerHTML = "";
    return;
  }

  const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;

  const pageProducts = filtered.slice(
    startIndex,
    startIndex + PRODUCTS_PER_PAGE
  );

  tableBody.innerHTML = pageProducts.map((product) => {
    const stock = Number(product.stock || 0);
    const price = Number(product.price || 0);

    let imageSource = "assets/sari-logo.jpg";
    const rawImage = product.image || product.imageUrl || product.image_url;

    if (rawImage && rawImage !== "default.jpg") {
      if (
        rawImage.startsWith("http") ||
        rawImage.startsWith("data:") ||
        rawImage.startsWith("uploads/") ||
        rawImage.startsWith("assets/")
      ) {
        imageSource = rawImage;
      } else {
        imageSource = `uploads/${rawImage}`;
      }
    }

    const id = escapeInventoryText(product.id);
    const name = escapeInventoryText(product.name || "");
    const barcode = escapeInventoryText(product.barcode || "N/A");
    const category = escapeInventoryText(product.category || "General");

    return `
      <tr class="inv-product-row">
        <td>
          <div class="inv-product-cell">
            <img
              src="${escapeInventoryText(imageSource)}"
              alt=""
              onerror="this.onerror=null;this.src='assets/sari-logo.jpg';"
            >
            <div class="inv-product-info">
              <strong>${name}</strong>
              <small>Barcode: ${barcode}</small>
            </div>
          </div>
        </td>

        <td>${category}</td>
        <td>${stock}</td>
        <td><strong>₱${price.toFixed(2)}</strong></td>
        <td>${getStatusBadge(stock)}</td>

        <td>
          <div class="action-buttons">
            <button
              type="button"
              class="edit-btn"
              data-id="${id}"
              title="Edit Product"
              aria-label="Edit ${name}">
              <i class="fa-solid fa-pen"></i>
            </button>

            <button
              type="button"
              class="delete-btn"
              data-id="${id}"
              title="Delete Product"
              aria-label="Delete ${name}">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tableBody.querySelectorAll(".edit-btn").forEach((button) => {
    button.addEventListener("click", () => {
      populateEditForm(button.dataset.id);
    });
  });

  tableBody.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", () => {
      deleteProduct(button.dataset.id);
    });
  });

  renderPagination(totalProducts, totalPages, startIndex);
}

function renderPagination(totalProducts, totalPages, startIndex) {
  const pagination = document.getElementById("inventoryPagination");

  if (!pagination) return;

  const firstProduct = startIndex + 1;
  const lastProduct = Math.min(
    startIndex + PRODUCTS_PER_PAGE,
    totalProducts
  );

  let pageButtons = "";

  for (let page = 1; page <= totalPages; page++) {
    pageButtons += `
      <button
        type="button"
        class="inv-page-btn ${page === currentPage ? "active" : ""}"
        data-page="${page}"
        ${page === currentPage ? 'aria-current="page"' : ""}
        aria-label="Page ${page}">
        ${page}
      </button>
    `;
  }

  pagination.innerHTML = `
    <div class="inv-pagination-info">
      Showing <strong>${firstProduct}-${lastProduct}</strong>
      of <strong>${totalProducts}</strong> products
    </div>

    <div class="pagination-controls">
      <button
        type="button"
        class="inv-page-btn"
        data-page="${currentPage - 1}"
        ${currentPage === 1 ? "disabled" : ""}>
        <i class="fa-solid fa-chevron-left"></i>
        Previous
      </button>

      ${pageButtons}

      <button
        type="button"
        class="inv-page-btn"
        data-page="${currentPage + 1}"
        ${currentPage === totalPages ? "disabled" : ""}>
        Next
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>
  `;

  pagination.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;

      const nextPage = Number(button.dataset.page);

      if (
        !Number.isInteger(nextPage) ||
        nextPage < 1 ||
        nextPage > totalPages ||
        nextPage === currentPage
      ) {
        return;
      }

      currentPage = nextPage;
      renderInventoryTable();

      document.querySelector(".inv-table-container")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
    });
  });
}

function populateEditForm(id) {
  const product = allProducts.find((item) => item.id === id);

  if (!product) return;

  editingProductId = id;

  document.getElementById("addName").value = product.name || "";
  document.getElementById("addCategory").value = product.category || "";

  const barcodeInput = document.getElementById("addBarcode");

  if (barcodeInput) {
    barcodeInput.value = product.barcode || "";
  }

  document.getElementById("addStock").value =
    product.stock !== undefined ? product.stock : 0;

  document.getElementById("addPrice").value = product.price || 0;

  const button = document.getElementById("btnSaveProduct");

  if (button) {
    button.innerText = "Update Product";
    button.style.background = "#0284c7";
  }

  document.querySelector(".inv-form-card")
    ?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
}

const addProductForm = document.getElementById("addProductForm");

if (addProductForm) {
  addProductForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUserId) {
      alert("Please sign in before saving products.");
      return;
    }

    const name = document.getElementById("addName").value.trim();
    const category = document.getElementById("addCategory").value;

    const barcodeInput = document.getElementById("addBarcode");
    const barcode = barcodeInput ? barcodeInput.value.trim() : "";

    const stock = Number(document.getElementById("addStock").value);
    const price = Number(document.getElementById("addPrice").value);

    const fileInput = document.getElementById("addImageFile");

    if (
      !name ||
      !category ||
      !Number.isFinite(stock) ||
      stock < 0 ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      alert("Please enter valid product details.");
      return;
    }

    const existingProduct = editingProductId
      ? allProducts.find((product) => product.id === editingProductId)
      : null;

    let imageString =
      existingProduct?.image ||
      existingProduct?.imageUrl ||
      "default.jpg";

    if (fileInput?.files?.[0]) {
      const file = fileInput.files[0];

      if (!file.type.startsWith("image/")) {
        alert("Please select a valid image file.");
        return;
      }

      const reader = new FileReader();

      reader.onload = async (event) => {
        try {
          await saveOrUpdateToFirestore(
            name,
            category,
            barcode,
            stock,
            price,
            event.target.result
          );
        } catch (error) {
          console.error("Image save error:", error);
        }
      };

      reader.onerror = () => {
        alert("Unable to read the selected image.");
      };

      reader.readAsDataURL(file);
    } else {
      await saveOrUpdateToFirestore(
        name,
        category,
        barcode,
        stock,
        price,
        imageString
      );
    }
  });
}

async function saveOrUpdateToFirestore(
  name,
  category,
  barcode,
  stock,
  price,
  image
) {
  const button = document.getElementById("btnSaveProduct");

  const wasEditing = Boolean(editingProductId);

  try {
    if (!currentUserId) {
      throw new Error("No authenticated user.");
    }

    if (button) {
      button.disabled = true;
      button.innerText = wasEditing ? "Updating..." : "Saving...";
    }

    const inventoryRef = collection(
      db,
      "users",
      currentUserId,
      "inventory"
    );

    if (editingProductId) {
      const productRef = doc(inventoryRef, editingProductId);

      await updateDoc(productRef, {
        name,
        category,
        barcode: barcode || "",
        stock,
        price,
        image,
        imageUrl: image,
        updatedAt: serverTimestamp()
      });

      if (stock === 0) {
        await createNotification(
          "Out of Stock",
          `Naubos na ang stock ng ${name} (0 pcs)!`,
          "danger"
        );
      } else if (stock <= 5) {
        await createNotification(
          "Low Stock Alert",
          `Kakaunti na lang ang stock ng ${name} (${stock} pcs remaining).`,
          "warning"
        );
      } else {
        await createNotification(
          "Stock Updated",
          `Na-update ang stock ng ${name} sa ${stock} pcs.`,
          "info"
        );
      }

      editingProductId = null;
      alert("Product updated successfully!");
    } else {
      await addDoc(inventoryRef, {
        userId: currentUserId,
        name,
        category,
        barcode: barcode || "",
        stock,
        price,
        image,
        imageUrl: image,
        hidden: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      if (stock === 0) {
        await createNotification(
          "Out of Stock",
          `Idinagdag ang ${name} ngunit walang stock (0 pcs)!`,
          "danger"
        );
      } else if (stock <= 5) {
        await createNotification(
          "Low Stock Alert",
          `Idinagdag ang ${name} sa inventory (${stock} pcs - Low Stock).`,
          "warning"
        );
      } else {
        await createNotification(
          "New Product Added",
          `Naidagdag ang ${name} sa inventory (${stock} pcs).`,
          "info"
        );
      }

      alert("Product added successfully!");
    }

    addProductForm.reset();

    const stockInput = document.getElementById("addStock");
    if (stockInput) stockInput.value = "0";

    const fileInput = document.getElementById("addImageFile");
    if (fileInput) fileInput.value = "";

    currentPage = 1;

    if (button) {
      button.innerText = "Save Product";
      button.style.background = "";
    }
  } catch (err) {
    console.error("Error saving product:", err);
    alert(`Failed to save product: ${err.message || err}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.innerText = "Save Product";
    }
  }
}

async function deleteProduct(id) {
  if (!currentUserId) return;

  if (!confirm("Are you sure you want to delete this product?")) {
    return;
  }

  try {
    const targetProduct = allProducts.find((product) => product.id === id);

    const productName = targetProduct ? targetProduct.name : "Produkto";

    const inventoryRef = collection(
      db,
      "users",
      currentUserId,
      "inventory"
    );

    await deleteDoc(doc(inventoryRef, id));

    await createNotification(
      "Binurang Produkto",
      `Tinanggal ang ${productName} sa iyong inventory.`,
      "warning"
    );
  } catch (err) {
    console.error("Error deleting product:", err);
    alert("Failed to delete product. Please try again.");
  }
}

const inventorySearch = document.getElementById("inventorySearch");

if (inventorySearch) {
  inventorySearch.addEventListener("input", (event) => {
    searchQuery = event.target.value.trim();
    currentPage = 1;
    renderInventoryTable();
  });
}

const categoryFilter = document.getElementById("categoryFilter");

if (categoryFilter) {
  categoryFilter.addEventListener("change", (event) => {
    selectedCategory = event.target.value;
    currentPage = 1;
    renderInventoryTable();
  });
}

function normName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function findProductByCode(code) {
  let product = allProducts.find((item) =>
    sameBarcode(item.barcode, code)
  );

  if (product) return product;

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "users", currentUserId, "inventory"),
        where("barcode", "==", code)
      )
    );

    const data = snapshot.docs[0] ? snapshot.docs[0].data() : null;

    if (data && data.name) {
      const key = normName(data.name);

      product = allProducts.find(
        (item) => normName(item.name) === key
      );

      if (product) return product;
    }
  } catch (error) {
    console.warn("Inventory barcode lookup failed:", error);
  }

  return null;
}

async function handleScannedCode(rawCode) {
  const code = String(rawCode || "").trim();

  if (!code || !currentUserId) return;

  console.log("SCANNED:", code);

  const product = await findProductByCode(code);

  if (product) {
    const searchInput = document.getElementById("inventorySearch");

    const term = product.name || code;

    if (searchInput) searchInput.value = term;

    searchQuery = term;
    currentPage = 1;
    renderInventoryTable();
    return;
  }

  const barcodeInput = document.getElementById("addBarcode");

  if (barcodeInput) {
    barcodeInput.value = code;
  }

  const nameInput = document.getElementById("addName");

  if (nameInput) nameInput.focus();

  alert(
    `Bagong Barcode (${code})! Ilagay ang detalye at i-save ang produkto.`
  );
}

const startScanBtn = document.getElementById("startScanBtn");

if (startScanBtn) {
  startScanBtn.addEventListener("click", async () => {
    try {
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
    } catch (error) {
      console.error("Barcode scanner error:", error);
      alert("Unable to start the barcode scanner.");
    }
  });
}

if (inventorySearch) {
  inventorySearch.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;

    const code = inventorySearch.value.trim();

    if (!/^\d{6,}$/.test(code)) return;

    event.preventDefault();
    await handleScannedCode(code);
  });
}

let wedgeBuffer = "";
let wedgeLast = 0;

document.addEventListener("keydown", async (event) => {
  const tag =
    (document.activeElement && document.activeElement.tagName) || "";

  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;

  const now = Date.now();

  if (now - wedgeLast > 80) {
    wedgeBuffer = "";
  }

  wedgeLast = now;

  if (event.key === "Enter") {
    const code = wedgeBuffer;
    wedgeBuffer = "";

    if (/^\d{6,}$/.test(code)) {
      await handleScannedCode(code);
    }

    return;
  }

  if (event.key.length === 1) {
    wedgeBuffer += event.key;
  }
});

const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    logoutUser();
  });
}