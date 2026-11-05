import { db, auth } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

function applyTheme(themeName) {
  const theme =
    themeName ||
    localStorage.getItem("sari_theme") ||
    "default";

  if (theme !== "default") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }

  if (themeName) {
    localStorage.setItem("sari_theme", theme);
  }

  if (document.body) {
    document.body.classList.remove(
      "theme-default",
      "theme-nordic",
      "theme-emerald"
    );
  }

  localStorage.removeItem("sariAppTheme");
}

applyTheme();

function initializeSidebar() {
  const sidebarLinks = document.querySelectorAll(
    ".sidebar-nav .sidebar-link"
  );

  if (!sidebarLinks.length) return;

  let currentPage = window.location.pathname
    .split("/")
    .pop()
    .toLowerCase();

  if (!currentPage || currentPage === "/") {
    currentPage = "homepage.html";
  }

  sidebarLinks.forEach((link) => {
    const linkUrl = new URL(link.href, window.location.href);

    const linkPage = linkUrl.pathname
      .split("/")
      .pop()
      .toLowerCase();

    const isActive = linkPage === currentPage;

    link.classList.toggle("active", isActive);

    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function getStatusBadgeHtml(stock) {
  const stockNum = Number(stock) || 0;
  if (stockNum === 0) {
    return `<span class="status-badge out-of-stock">Out of Stock</span>`;
  } else if (stockNum <= 5) {
    return `<span class="status-badge low-stock">Low Stock</span>`;
  } else {
    return `<span class="status-badge in-stock">In Stock</span>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  applyTheme();
  initializeSidebar();

  onAuthStateChanged(auth, (user) => {
    const path = window.location.pathname.toLowerCase();

    const isAuthPage =
      /\/(login|signup|index)(\.html)?\/?$/.test(path) ||
      path === "/";

    if (user && !isAuthPage) {
      listenForNotificationBadge(user.uid);
      loadTopbarAvatar(user.uid);
    }

    if (!user) {
      applyTheme("default");
    }
  });

  document.querySelectorAll(".toggle-eye").forEach((eyeIcon) => {
    eyeIcon.addEventListener("click", () => {
      const wrapper = eyeIcon.closest(".password-wrapper");
      if (!wrapper) return;

      const input = wrapper.querySelector("input");
      if (!input) return;

      const isPassword = input.type === "password";

      input.type = isPassword ? "text" : "password";

      eyeIcon.classList.toggle("fa-eye-slash", !isPassword);
      eyeIcon.classList.toggle("fa-eye", isPassword);
    });
  });

  const logoutBtn = document.getElementById("logoutBtn");

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async (event) => {
      event.preventDefault();

      try {
        await signOut(auth);

        localStorage.removeItem("userProfileImage");
        localStorage.removeItem("customStoreName");
        localStorage.removeItem("sari_theme");

        window.location.href = "login.html";
      } catch (error) {
        console.error("Logout error:", error);

        showToast("Unable to log out. Please try again.", "error");
      }
    });
  }

  const posCategories = document.querySelectorAll(".pos-category");

  posCategories.forEach((button) => {
    button.addEventListener("click", () => {
      posCategories.forEach((item) => {
        item.classList.remove("active");
      });

      button.classList.add("active");
    });
  });

  const posPaymentBtns = document.querySelectorAll(
    ".pos-payment-btn"
  );

  posPaymentBtns.forEach((button) => {
    button.addEventListener("click", () => {
      posPaymentBtns.forEach((item) => {
        item.classList.remove("active");
      });

      button.classList.add("active");
    });
  });

  document.querySelectorAll(".pos-qty-stepper").forEach((stepper) => {
    const qtyLabel = stepper.querySelector("span");
    const buttons = stepper.querySelectorAll("button");

    if (buttons.length < 2 || !qtyLabel) return;

    buttons[0].addEventListener("click", () => {
      const current = parseInt(qtyLabel.textContent, 10) || 1;

      qtyLabel.textContent = Math.max(1, current - 1);
    });

    buttons[1].addEventListener("click", () => {
      const current = parseInt(qtyLabel.textContent, 10) || 1;

      qtyLabel.textContent = current + 1;
    });
  });

  const clearCartBtn = document.querySelector(".pos-clear-cart");

  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", () => {
      const cartItems = document.querySelector(".pos-cart-items");

      if (cartItems) {
        cartItems.innerHTML = `
          <p style="
            color: #9aa9a0;
            font-size: 0.85rem;
            text-align: center;
            padding: 20px 0;
          ">
            Cart is empty.
          </p>
        `;
      }
    });
  }
});

async function loadTopbarAvatar(userId) {
  try {
    const savedStoreName = localStorage.getItem("customStoreName");
    const savedImage = localStorage.getItem("userProfileImage");

    const storeNameEl = document.getElementById("topbarStoreName");

    if (storeNameEl && savedStoreName) {
      storeNameEl.innerText = savedStoreName;
    }

    const target =
      document.getElementById("avatarContainer") ||
      document.getElementById("topbarAvatarContainer") ||
      document.querySelector(".topbar-avatar:not(img)");

    if (target && savedImage) {
      renderAvatar(target, savedImage);
    }

    const snap = await getDoc(doc(db, "users", userId));

    if (!snap.exists()) return;

    const userData = snap.data();

    applyTheme(userData.app_theme || "default");

    const nameToDisplay =
      userData.store_name ||
      userData.full_name ||
      "My Store";

    if (storeNameEl) {
      storeNameEl.innerText = nameToDisplay;

      localStorage.setItem("customStoreName", nameToDisplay);
    }

    const imageUrl =
      userData.profile_image ||
      userData.photoURL ||
      "";

    if (
      imageUrl &&
      /^(data:image\/|https?:\/\/)/i.test(imageUrl)
    ) {
      localStorage.setItem("userProfileImage", imageUrl);

      if (target) {
        renderAvatar(target, imageUrl);
      }
    } else if (target && !savedImage) {
      target.style.backgroundImage = "";
      target.innerHTML = nameToDisplay.charAt(0).toUpperCase();
    }
  } catch (error) {
    console.error("Error loading topbar avatar:", error);
  }
}

function renderAvatar(target, imageUrl) {
  if (target.classList.contains("topbar-avatar")) {
    target.innerHTML = "";
    target.style.backgroundImage = `url("${imageUrl}")`;
    target.style.backgroundSize = "cover";
    target.style.backgroundPosition = "center";
  } else {
    target.innerHTML = `
      <img
        src="${imageUrl}"
        class="topbar-avatar"
        style="
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
        "
        alt="Store profile"
      >
    `;
  }
}

function listenForNotificationBadge(userId) {
  const notifBtn = document.getElementById("notificationBtn");

  if (!notifBtn) return;

  let badgeEl = document.getElementById("notifBadge");

  if (!badgeEl) {
    notifBtn.style.position = "relative";

    badgeEl = document.createElement("span");
    badgeEl.id = "notifBadge";

    badgeEl.style.cssText = `
      display: none;
      position: absolute;
      top: -2px;
      right: -2px;
      background: #ef4444;
      color: #ffffff;
      font-size: 10px;
      font-weight: 800;
      padding: 2px 5px;
      border-radius: 10px;
      border: 2px solid #111d17;
      min-width: 18px;
      text-align: center;
    `;

    notifBtn.appendChild(badgeEl);
  }

  const notifQuery = query(
    collection(db, "notifications"),
    where("userId", "==", userId),
    where("isRead", "==", false)
  );

  onSnapshot(
    notifQuery,
    (snapshot) => {
      const unreadCount = snapshot.size;

      if (unreadCount > 0) {
        badgeEl.innerText =
          unreadCount > 99 ? "99+" : String(unreadCount);

        badgeEl.style.display = "inline-block";
      } else {
        badgeEl.style.display = "none";
      }
    },
    (error) => {
      console.error("Error fetching notification badge:", error);
    }
  );
}

function changeTheme(themeName) {
  applyTheme(themeName || "default");

  if (typeof window.showToast === "function") {
    window.showToast("Theme updated successfully!");
  }
}

function showToast(message, type = "success") {
  let toast = document.getElementById("sariToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "sariToast";

    document.body.appendChild(toast);
  }

  let icon = "fa-circle-check";

  if (type === "error") {
    icon = "fa-circle-xmark";
  } else if (type === "warning") {
    icon = "fa-triangle-exclamation";
  } else if (type === "info") {
    icon = "fa-circle-info";
  }

  const iconEl = document.createElement("i");
  iconEl.className = `fa-solid ${icon}`;

  const textEl = document.createElement("span");
  textEl.textContent = message;

  toast.replaceChildren(iconEl, textEl);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  clearTimeout(window.sariToastTimeout);

  window.sariToastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

window.changeTheme = changeTheme;
window.showToast = showToast;
window.getStatusBadgeHtml = getStatusBadgeHtml;