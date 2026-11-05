import { db, auth } from "./firebase-config.js";
import { checkAuth, logoutUser } from "./auth.js";
import { 
  collection, 
  query,
  where,
  getDocs, 
  getDoc,
  doc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const normText = (v) =>
  String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function productKey(p) {
  const barcode = String(p.barcode ?? "").trim().toLowerCase();
  if (barcode) return `barcode:${barcode}`;
  const name = normText(p.name);
  if (!name) return "";
  return `name:${name}|size:${normText(p.size)}`;
}

function normalizeCategory(raw) {
  const original = String(raw ?? "").trim();
  const c = original.toLowerCase().replace(/\s+/g, " ");
  if (!c) return "";
  if (c.startsWith("beverag") || c === "drink" || c === "drinks") return "Beverage";
  if (c.startsWith("cann")) return "Canned";
  if (c.startsWith("alcohol")) return "Alcohol";
  if (c.startsWith("coffee") || /\btea\b/.test(c)) return "Coffee & Tea";
  if (c.startsWith("biscuit") || c.startsWith("cracker")) return "Biscuits";
  if (c.startsWith("chip")) return "Chips";
  if (c.startsWith("condiment")) return "Condiments";
  if (c.startsWith("noodle")) return "Noodles";
  if (c.startsWith("household")) return "Household";
  return original;
}

let currentUserId = null;
let trendChartChartJS = null;
let categoryChartChartJS = null;

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
        storeNameEl.innerText = uData.store_name || uData.full_name || uData.name || "My Store";
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
    console.error("Error fetching user details:", err);
    if (storeNameEl) storeNameEl.innerText = "My Store";
  }

  loadDashboardData();
});

function getSaleDate(data) {
  const raw = data.createdAt || data.created_at || data.createdAtMs || data.date;
  if (!raw) return new Date();
  if (typeof raw.toDate === "function") return raw.toDate();
  if (raw instanceof Date) return raw;
  return new Date(raw);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function fetchAllSales() {
  const safeDocs = (promise) => promise.then((s) => s.docs).catch((e) => {
    console.error("Sales fetch error:", e);
    return [];
  });

  const [rootDocs, orderDocs, legacyDocs] = await Promise.all([
    safeDocs(getDocs(query(collection(db, "transactions"), where("userId", "==", currentUserId)))),
    safeDocs(getDocs(query(collection(db, "orders"), where("userId", "==", currentUserId)))),
    safeDocs(getDocs(collection(db, "users", currentUserId, "transactions")))
  ]);

  const sales = [];

  legacyDocs.forEach((d) => sales.push(d.data()));
  rootDocs.forEach((d) => sales.push(d.data()));

  orderDocs.forEach((d) => {
    const data = d.data();
    if (data.source === "web_app") return;
    sales.push(data);
  });

  return sales;
}

async function loadDashboardData() {
  try {
    const sales = await fetchAllSales();

    let totalRevenue = 0;
    let totalTransactions = 0;
    let cashCount = 0;
    let creditCount = 0;
    
    const months12 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyRevenueMap = {};
    months12.forEach(m => monthlyRevenueMap[m] = 0);

    const productSalesMap = {};

    sales.forEach((data) => {
      const amount = Number(data.total_amount || data.totalAmount || data.total || 0);
      
      totalRevenue += amount;
      totalTransactions++;

      const method = String(data.payment_method || data.paymentMethod || 'cash').toLowerCase();
      if (method.includes("credit") || method.includes("utang")) {
        creditCount++;
      } else {
        cashCount++;
      }

      const dateObj = getSaleDate(data);

      if (!isNaN(dateObj.getTime())) {
        const monthLabel = dateObj.toLocaleString('en-US', { month: 'short' });
        if (monthlyRevenueMap[monthLabel] !== undefined) {
          monthlyRevenueMap[monthLabel] += amount;
        }
      }

      if (Array.isArray(data.items)) {
        data.items.forEach(item => {
          if (item.name) {
            if (!productSalesMap[item.name]) {
              productSalesMap[item.name] = { qty: 0, revenue: 0 };
            }
            const qty = Number(item.qty || item.quantity || 1);
            const lineRevenue = item.subtotal != null
              ? Number(item.subtotal)
              : Number(item.price || 0) * qty;
            productSalesMap[item.name].qty += qty;
            productSalesMap[item.name].revenue += lineRevenue;
          }
        });
      }
    });

    const estProfit = totalRevenue * 0.20;
    const avgSale = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    const cashPct = totalTransactions > 0 ? (cashCount / totalTransactions) * 100 : 0;
    const creditPct = totalTransactions > 0 ? (creditCount / totalTransactions) * 100 : 0;

    const statRev = document.getElementById("statTotalRevenue");
    const statTxns = document.getElementById("statTotalTxns");
    const statProf = document.getElementById("statTotalProfit");
    const statMargin = document.getElementById("statProfitMargin");
    const statAvg = document.getElementById("statAvgSale");
    const cashTxt = document.getElementById("cashPctText");
    const creditTxt = document.getElementById("creditPctText");

    if (statRev) statRev.innerText = `₱${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (statTxns) statTxns.innerText = `${totalTransactions} total transactions`;
    if (statProf) statProf.innerText = `₱${estProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (statMargin) statMargin.innerText = totalRevenue > 0 ? "20%" : "0%";
    if (statAvg) statAvg.innerText = `₱${avgSale.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (cashTxt) cashTxt.innerText = `${cashPct.toFixed(1)}%`;
    if (creditTxt) creditTxt.innerText = `${creditPct.toFixed(1)}%`;

    renderCleanLineChart(months12, monthlyRevenueMap);
    loadCleanCategoryDonut();
    renderTopProducts(productSalesMap);

  } catch (error) {
    console.error("Error loading dashboard data:", error);
  }
}

function renderCleanLineChart(monthsList, monthlyRevenueMap) {
  const canvas = document.getElementById("trendChartCanvas");
  if (!canvas) return;

  const revData = monthsList.map(m => monthlyRevenueMap[m] || 0);
  const profitData = revData.map(val => val * 0.20);

  if (trendChartChartJS) {
    trendChartChartJS.destroy();
  }

  const ctx = canvas.getContext("2d");

  const revGrad = ctx.createLinearGradient(0, 0, 0, 250);
  revGrad.addColorStop(0, "rgba(22, 163, 74, 0.3)");
  revGrad.addColorStop(1, "rgba(22, 163, 74, 0.0)");

  const profGrad = ctx.createLinearGradient(0, 0, 0, 250);
  profGrad.addColorStop(0, "rgba(234, 179, 8, 0.3)");
  profGrad.addColorStop(1, "rgba(234, 179, 8, 0.0)");

  trendChartChartJS = new Chart(ctx, {
    type: 'line',
    data: {
      labels: monthsList,
      datasets: [
        {
          label: 'Revenue (Benta)',
          data: revData,
          borderColor: '#16a34a',
          backgroundColor: revGrad,
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#16a34a'
        },
        {
          label: 'Profit (Tubo)',
          data: profitData,
          borderColor: '#ca8a04',
          backgroundColor: profGrad,
          borderWidth: 2,
          borderDash: [5, 5],
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#ca8a04'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#102a24', font: { family: 'sans-serif', weight: 'bold' } }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ₱${context.raw.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#64748b', font: { weight: 'bold' } }
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: {
            color: '#64748b',
            callback: function(val) { return '₱' + val; }
          }
        }
      }
    }
  });
}

async function fetchMergedProducts() {
  const safeDocs = (promise) => promise.then((s) => s.docs).catch((e) => {
    console.error("Products fetch error:", e);
    return [];
  });

  const [legacyDocs, invDocs] = await Promise.all([
    safeDocs(getDocs(query(collection(db, "products"), where("userId", "==", currentUserId)))),
    safeDocs(getDocs(collection(db, "users", currentUserId, "inventory")))
  ]);

  const map = new Map();

  legacyDocs.forEach((d) => {
    const p = d.data();
    const key = productKey(p);
    if (key) map.set(key, p);
  });

  invDocs.forEach((d) => {
    const p = d.data();
    const key = productKey(p);
    if (!key) return;
    if (p.hidden === true) {
      map.delete(key);
    } else {
      map.set(key, p);
    }
  });

  return [...map.values()];
}

async function loadCleanCategoryDonut() {
  const canvas = document.getElementById("categoryChartCanvas");
  if (!canvas) return;

  try {
    const products = await fetchMergedProducts();

    const catCounts = {};

    products.forEach((data) => {
      const cat = normalizeCategory(data.category) || 'Others';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    });

    const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
    
    const topLabels = [];
    const topData = [];
    let othersSum = 0;

    sortedCats.forEach(([catName, count], idx) => {
      if (idx < 4) {
        topLabels.push(catName);
        topData.push(count);
      } else {
        othersSum += count;
      }
    });

    if (othersSum > 0) {
      topLabels.push("Others");
      topData.push(othersSum);
    }

    if (topLabels.length === 0) {
      topLabels.push("No Items");
      topData.push(1);
    }

    if (categoryChartChartJS) {
      categoryChartChartJS.destroy();
    }

    const ctx = canvas.getContext("2d");

    categoryChartChartJS = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: topLabels,
        datasets: [{
          data: topData,
          backgroundColor: ['#16a34a', '#eab308', '#0284c7', '#8b5cf6', '#ef4444'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#102a24', font: { size: 12, weight: 'bold' }, padding: 12 }
          },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = Math.round((ctx.raw / total) * 100);
                return `${ctx.label}: ${pct}% (${ctx.raw} items)`;
              }
            }
          }
        },
        cutout: '65%'
      }
    });

  } catch (err) {
    console.error("Error loading category donut:", err);
  }
}

function renderTopProducts(productSalesMap) {
  const tbody = document.getElementById("topProductsTableBody");
  if (!tbody) return;

  const sorted = Object.entries(productSalesMap).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);

  if (sorted.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align: center; color: #94a3b8; padding: 30px;">No sales recorded yet.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = sorted.map(([name, data]) => `
    <tr>
      <td style="font-weight:700; color:#102a24;">${escapeHtml(name)}</td>
      <td>${data.qty}</td>
      <td style="font-weight:800; color:#102a24;">₱${data.revenue.toFixed(2)}</td>
    </tr>
  `).join('');
}

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", logoutUser);
}