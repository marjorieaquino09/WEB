import { auth } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Tumutugma sa /login, /login.html, /signup, /signup.html, /index.html, at /
function isAuthPath() {
  const path = window.location.pathname;
  return /\/(login|signup|index)(\.html)?\/?$/.test(path) || path === "/";
}

// Session Check Function
export function checkAuth(callback) {
  onAuthStateChanged(auth, (user) => {
    // Huwag gumawa ng kahit ano habang nagsa-sign up
    if (sessionStorage.getItem("isSigningUp") === "true") return;

    // Huwag mag-load ng authenticated scripts sa login/signup page
    if (isAuthPath()) return;

    if (user) {
      if (typeof callback === "function") callback(user);
    } else {
      window.location.href = "index.html";
    }
  });
}

// Logout Function with Storage Clearing
export function logoutUser() {
  signOut(auth).then(() => {
    localStorage.removeItem("userProfileImage");
    localStorage.removeItem("customStoreName");
    window.location.href = "index.html";
  }).catch((error) => {
    console.error("Logout Error:", error);
    localStorage.removeItem("userProfileImage");
    localStorage.removeItem("customStoreName");
    window.location.href = "index.html";
  });
}

// Layout Slide Animation & Form Toggle Logic
document.addEventListener("DOMContentLoaded", () => {
  const authContainer = document.getElementById("authContainer");
  const loginWrapper = document.getElementById("loginFormWrapper");
  const signupWrapper = document.getElementById("signupFormWrapper");
  const switchToSignup = document.getElementById("switchToSignup");
  const switchToLogin = document.getElementById("switchToLogin");

  if (switchToSignup && authContainer && loginWrapper && signupWrapper) {
    switchToSignup.addEventListener("click", (e) => {
      e.preventDefault();
      authContainer.classList.add("signup-active");
      loginWrapper.style.display = "none";
      signupWrapper.style.display = "block";
    });
  }

  if (switchToLogin && authContainer && loginWrapper && signupWrapper) {
    switchToLogin.addEventListener("click", (e) => {
      e.preventDefault();
      authContainer.classList.remove("signup-active");
      signupWrapper.style.display = "none";
      loginWrapper.style.display = "block";
    });
  }

  // Password Visibility Toggles
  const toggleLoginPassword = document.getElementById("toggleLoginPassword");
  const loginPasswordInput = document.getElementById("loginPassword");
  if (toggleLoginPassword && loginPasswordInput) {
    toggleLoginPassword.addEventListener("click", () => {
      const type = loginPasswordInput.getAttribute("type") === "password" ? "text" : "password";
      loginPasswordInput.setAttribute("type", type);
      toggleLoginPassword.classList.toggle("fa-eye");
      toggleLoginPassword.classList.toggle("fa-eye-slash");
    });
  }

  const toggleSignupPassword = document.getElementById("toggleSignupPassword");
  const signupPasswordInput = document.getElementById("signupPassword");
  if (toggleSignupPassword && signupPasswordInput) {
    toggleSignupPassword.addEventListener("click", () => {
      const type = signupPasswordInput.getAttribute("type") === "password" ? "text" : "password";
      signupPasswordInput.setAttribute("type", type);
      toggleSignupPassword.classList.toggle("fa-eye");
      toggleSignupPassword.classList.toggle("fa-eye-slash");
    });
  }
});