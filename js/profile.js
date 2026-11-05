import { db, auth } from "./firebase-config.js";
import { checkAuth, logoutUser } from "./auth.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserId = null;
let userEmail = "";
let currentProfileImage = null;
let currentCoverImage = null;

const $ = (id) => document.getElementById(id);
const peso = (n) =>
  "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let toastTimer = null;
function toast(message, type = "ok") {
  const el = $("pfToast");
  if (!el) return alert(message);
  el.textContent = message;
  el.classList.toggle("error", type === "error");
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

async function saveUser(fields) {
  await setDoc(
    doc(db, "users", currentUserId),
    { ...fields, updated_at: serverTimestamp() },
    { merge: true }
  );
}

async function withButton(btn, busyText, idleText, task) {
  try {
    btn.disabled = true;
    btn.textContent = busyText;
    await task();
  } finally {
    btn.disabled = false;
    btn.textContent = idleText;
  }
}

function applyTheme(themeName) {
  const theme = themeName || "default";

  if (theme !== "default") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }

  localStorage.setItem("sari_theme", theme);

  document.querySelectorAll(".pf-theme").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

applyTheme(localStorage.getItem("sari_theme") || "default");

document.querySelectorAll(".pf-theme").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const selected = btn.dataset.theme;
    applyTheme(selected);

    if (currentUserId) {
      try {
        await saveUser({ app_theme: selected });
      } catch (err) {
        console.error("Error saving theme:", err);
        toast("Hindi na-save ang theme.", "error");
      }
    }
  });
});

function cropToJpeg(file, width, height, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Hindi mabasa ang file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Hindi valid na larawan ang file."));
      img.onload = () => {
        const scale = Math.max(width / img.width, height / img.height);
        const sw = width / scale;
        const sh = height / scale;
        const sx = (img.width - sw) / 2;
        const sy = (img.height - sh) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderAvatar(imgUrl) {
  const box = $("avatarBox");
  if (!box) return;
  if (imgUrl) {
    box.innerHTML = `<img src="${imgUrl}" alt="Profile picture">`;
  } else {
    box.innerHTML = `<i class="fa-solid fa-user"></i>`;
  }
}

function renderCover(imgUrl) {
  const cover = $("coverBox");
  if (!cover) return;
  if (imgUrl) {
    cover.style.backgroundImage = `url("${imgUrl}")`;
    cover.classList.add("has-image");
  } else {
    cover.style.backgroundImage = "";
    cover.classList.remove("has-image");
  }
}

function wirePicker(triggerIds, fileInputId, onFile) {
  const input = $(fileInputId);
  triggerIds.forEach((id) => {
    const el = $(id);
    if (el && input) el.addEventListener("click", () => input.click());
  });
  if (input) {
    input.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await onFile(file);
      } catch (err) {
        console.error("Image error:", err);
        toast("Hindi na-save ang picture: " + err.message, "error");
      }
      input.value = "";
    });
  }
}

wirePicker(["avatarBox", "avatarBtn"], "profileImageFile", async (file) => {
  currentProfileImage = await cropToJpeg(file, 256, 256, 0.85);
  renderAvatar(currentProfileImage);
  if (currentUserId) {
    await saveUser({ profile_image: currentProfileImage });
    localStorage.setItem("userProfileImage", currentProfileImage);
    toast("Na-update ang profile picture.");
  }
});

wirePicker(["changeCoverBtn"], "coverImageFile", async (file) => {
  currentCoverImage = await cropToJpeg(file, 1400, 320, 0.7);
  renderCover(currentCoverImage);
  if (currentUserId) {
    await saveUser({ cover_image: currentCoverImage });
    toast("Na-update ang cover photo.");
  }
});

async function loadStats() {
  try {
    const snap = await getDocs(collection(db, "users", currentUserId, "inventory"));
    $("statProducts").textContent = snap.size;
  } catch (err) {
    console.error("Error loading inventory count:", err);
  }

  try {
    const snap = await getDocs(collection(db, "users", currentUserId, "transactions"));
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    let total = 0;
    snap.forEach((d) => {
      const t = d.data();
      const when = t.created_at?.toDate ? t.created_at.toDate() : null;
      if (when && when >= start) total += Number(t.total || 0);
    });
    $("statSales").textContent = peso(total);
  } catch (err) {
    console.error("Error loading sales today:", err);
  }

  try {
    const snap = await getDocs(collection(db, "users", currentUserId, "credits"));
    let open = 0;
    snap.forEach((d) => {
      const c = d.data();
      if (c.status !== "paid") open += Number(c.balance ?? c.amount ?? 0);
    });
    $("statCredit").textContent = peso(open);
  } catch (err) {
    console.error("Error loading open credit:", err);
  }
}

function updateSideHeader(fullName, storeName) {
  $("sideName").textContent = fullName || "Owner name";
  $("sideStore").textContent = storeName || "Your store name";
}

checkAuth(async (user) => {
  currentUserId = user.uid;
  userEmail = user.email || "";
  $("valEmail").value = userEmail;

  try {
    const snap = await getDoc(doc(db, "users", currentUserId));

    if (snap.exists()) {
      const data = snap.data();
      const fullName = data.full_name || data.name || "";
      const storeName = data.store_name || "";

      $("inputFullName").value = fullName;
      $("inputPhone").value = data.phone || "";
      $("inputStoreName").value = storeName;
      $("inputStoreAddress").value = data.store_address || "";
      if (data.email) $("valEmail").value = data.email;

      updateSideHeader(fullName, storeName);

      currentProfileImage = data.profile_image || null;
      currentCoverImage = data.cover_image || null;
      renderAvatar(currentProfileImage);
      renderCover(currentCoverImage);

      if (data.tax_rate !== undefined) {
        $("tax_rate").value = data.tax_rate;
      }
      if (data.low_stock_threshold !== undefined) {
        $("low_stock_threshold").value = data.low_stock_threshold;
      }
      if (data.push_notifications !== undefined) {
        $("pushNotifToggle").checked = data.push_notifications;
      }
      if (data.low_stock_alerts !== undefined) {
        $("lowStockAlertToggle").checked = data.low_stock_alerts;
      }
      if (data.app_theme) applyTheme(data.app_theme);
    }
  } catch (err) {
    console.error("Error loading profile:", err);
    toast("Hindi ma-load ang profile mo.", "error");
  }

  loadStats();
});

$("accountForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fullName = $("inputFullName").value.trim();
  const phone = $("inputPhone").value.trim();

  try {
    await withButton($("saveAccountBtn"), "Saving...", "Save changes", async () => {
      await saveUser({ full_name: fullName, phone });
    });
    updateSideHeader(fullName, $("inputStoreName").value.trim());
    toast("Na-save ang account details.");
  } catch (err) {
    console.error("Error updating account:", err);
    toast("Hindi na-save: " + err.message, "error");
  }
});

$("storeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const storeName = $("inputStoreName").value.trim();
  const storeAddress = $("inputStoreAddress").value.trim();

  try {
    await withButton($("saveStoreBtn"), "Saving...", "Save changes", async () => {
      await saveUser({ store_name: storeName, store_address: storeAddress });
    });

    if (storeName) {
      localStorage.setItem("customStoreName", storeName);
    } else {
      localStorage.removeItem("customStoreName");
    }

    updateSideHeader($("inputFullName").value.trim(), storeName);
    toast("Na-save ang store details.");
  } catch (err) {
    console.error("Error updating store:", err);
    toast("Hindi na-save: " + err.message, "error");
  }
});

$("taxForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const rate = Number($("tax_rate").value);

  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    toast("0 hanggang 100 lang ang pwedeng tax rate.", "error");
    return;
  }

  try {
    await withButton($("saveTaxBtn"), "Saving...", "Save", async () => {
      await saveUser({ tax_rate: rate });
    });
    toast("Na-save ang tax rate.");
  } catch (err) {
    console.error("Error updating tax rate:", err);
    toast("Hindi na-save: " + err.message, "error");
  }
});

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = Number($("low_stock_threshold").value);

  if (!Number.isFinite(value) || value < 1) {
    toast("Ilagay ang number na 1 pataas.", "error");
    return;
  }

  try {
    await withButton($("saveThresholdBtn"), "Saving...", "Save", async () => {
      await saveUser({ low_stock_threshold: value });
    });
    toast("Na-save ang low stock threshold.");
  } catch (err) {
    console.error("Error updating threshold:", err);
    toast("Hindi na-save: " + err.message, "error");
  }
});

async function saveToggle(key, value) {
  try {
    await saveUser({ [key]: value });
  } catch (err) {
    console.error(`Error saving ${key}:`, err);
    toast("Hindi na-save ang setting.", "error");
  }
}

$("pushNotifToggle").addEventListener("change", (e) => {
  saveToggle("push_notifications", e.target.checked);
});

$("lowStockAlertToggle").addEventListener("change", (e) => {
  saveToggle("low_stock_alerts", e.target.checked);
});

$("changePasswordBtn").addEventListener("click", async () => {
  if (!userEmail) {
    toast("Walang email na nakita.", "error");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, userEmail);
    toast(`Nag-send ng reset link sa ${userEmail}. Check your inbox!`);
  } catch (err) {
    toast("Hindi naipadala ang reset email: " + err.message, "error");
  }
});

const aboutBtn = $("aboutBtn");
const showAbout = () => alert("Sari App v1.0 — Firebase Powered Edition");
aboutBtn.addEventListener("click", showAbout);
aboutBtn.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    showAbout();
  }
});

$("logoutBtn").addEventListener("click", () => logoutUser());

const navLinks = document.querySelectorAll("#pfNav a");

function setActive(id) {
  navLinks.forEach((a) => a.classList.toggle("active", a.dataset.target === id));
}

navLinks.forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const target = $(a.dataset.target);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(a.dataset.target);
    }
  });
});

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    },
    { rootMargin: "-25% 0px -65% 0px" }
  );
  navLinks.forEach((a) => {
    const section = $(a.dataset.target);
    if (section) observer.observe(section);
  });
}