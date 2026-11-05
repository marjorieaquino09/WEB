import { db, auth } from "./firebase-config.js";
import { checkAuth, logoutUser } from "./auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserId = null;
let userEmail = "";

/* ---------------------------------------------------------
   THEME (same system as app.js: data-theme on <html> + "sari_theme")
--------------------------------------------------------- */
function applyTheme(themeName) {
  const theme = themeName || "default";

  if (theme !== "default") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }

  localStorage.setItem("sari_theme", theme);

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

// Apply saved theme immediately (before Firestore loads)
applyTheme(localStorage.getItem("sari_theme") || "default");

document.querySelectorAll(".theme-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const selectedTheme = btn.dataset.theme;
    applyTheme(selectedTheme);

    if (currentUserId) {
      try {
        const userRef = doc(db, "users", currentUserId);
        await updateDoc(userRef, {
          app_theme: selectedTheme,
          updated_at: serverTimestamp()
        });
      } catch (err) {
        console.error("Error saving theme to Firestore:", err);
      }
    }
  });
});

/* ---------------------------------------------------------
   AUTH + LOAD USER DATA
--------------------------------------------------------- */
checkAuth(async (user) => {
  currentUserId = user.uid;
  userEmail = user.email || "";

  const storeNameEl = document.getElementById("topbarStoreName") || document.getElementById("topbarUserEmail");
  const avatarContainer = document.getElementById("avatarContainer") || document.getElementById("topbarAvatarContainer");

  if (storeNameEl) {
    storeNameEl.style.color = "#ffffff";
    storeNameEl.style.fontWeight = "700";
    storeNameEl.innerText = "Loading...";
  }

  try {
    const userDocRef = doc(db, "users", currentUserId);
    const userSnap = await getDoc(userDocRef);
    let profileImg = null;

    if (userSnap.exists()) {
      const data = userSnap.data();

      if (storeNameEl) {
        storeNameEl.innerText = data.store_name || data.full_name || "My Store";
      }
      profileImg = data.profile_image || null;

      if (data.low_stock_threshold !== undefined) {
        document.getElementById("low_stock_threshold").value = data.low_stock_threshold;
      }
      if (data.push_notifications !== undefined) {
        document.getElementById("pushNotifToggle").checked = data.push_notifications;
      }
      if (data.low_stock_alerts !== undefined) {
        document.getElementById("lowStockAlertToggle").checked = data.low_stock_alerts;
      }

      if (data.app_theme) {
        applyTheme(data.app_theme);
      }
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
    console.error("Error loading settings:", err);
    if (storeNameEl) storeNameEl.innerText = "My Store";
  }
});

/* ---------------------------------------------------------
   LOW STOCK THRESHOLD FORM
--------------------------------------------------------- */
document.getElementById("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("saveThresholdBtn");
  const thresholdVal = Number(document.getElementById("low_stock_threshold").value);

  try {
    btn.disabled = true;
    btn.innerText = "Saving...";

    const userRef = doc(db, "users", currentUserId);
    await updateDoc(userRef, {
      low_stock_threshold: thresholdVal,
      updated_at: serverTimestamp()
    });

    btn.disabled = false;
    btn.innerText = "Save";

    alert("Settings saved successfully!");
  } catch (err) {
    btn.disabled = false;
    btn.innerText = "Save";
    console.error("Error updating threshold:", err);
    alert("Failed to save settings: " + err.message);
  }
});

/* ---------------------------------------------------------
   TOGGLES
--------------------------------------------------------- */
async function saveTogglePreference(key, value) {
  try {
    const userRef = doc(db, "users", currentUserId);
    await updateDoc(userRef, {
      [key]: value,
      updated_at: serverTimestamp()
    });
  } catch (err) {
    console.error(`Error saving ${key}:`, err);
  }
}

document.getElementById("pushNotifToggle").addEventListener("change", (e) => {
  saveTogglePreference("push_notifications", e.target.checked);
});

document.getElementById("lowStockAlertToggle").addEventListener("change", (e) => {
  saveTogglePreference("low_stock_alerts", e.target.checked);
});

/* ---------------------------------------------------------
   ACCOUNT / ABOUT / LOGOUT
--------------------------------------------------------- */
document.getElementById("changePasswordBtn").addEventListener("click", async () => {
  if (userEmail) {
    try {
      await sendPasswordResetEmail(auth, userEmail);
      alert(`A password reset link has been sent to ${userEmail}. Check your inbox!`);
    } catch (err) {
      alert("Failed to send reset email: " + err.message);
    }
  } else {
    alert("User email not found.");
  }
});

document.getElementById("aboutBtn").addEventListener("click", () => {
  alert("Sari App v1.0 — Firebase Powered Edition");
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  logoutUser();
});