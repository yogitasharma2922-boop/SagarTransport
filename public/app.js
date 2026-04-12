const authSection = document.getElementById("authSection");
const userSection = document.getElementById("userSection");
const adminSection = document.getElementById("adminSection");

const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const loginStatus = document.getElementById("loginStatus");

const userLabel = document.getElementById("userLabel");
const adminLabel = document.getElementById("adminLabel");
const logoutBtn = document.getElementById("logoutBtn");
const adminLogoutBtn = document.getElementById("adminLogoutBtn");

const nameInput = document.getElementById("nameInput");
const nameList = document.getElementById("nameList");
const siteInput = document.getElementById("siteInput");
const vehicleSize = document.getElementById("vehicleSize");
const statusEl = document.getElementById("status");
const photoGrid = document.getElementById("photoGrid");
const photoSummary = document.getElementById("photoSummary");
const folderList = document.getElementById("folderList");
const adminPhotoSummary = document.getElementById("adminPhotoSummary");
const adminPhotoList = document.getElementById("adminPhotoList");
const adminSearch = document.getElementById("adminSearch");
const refreshAdmin = document.getElementById("refreshAdmin");
const activityLog = document.getElementById("activityLog");

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const preview = document.getElementById("preview");
const captureBtn = document.getElementById("captureBtn");
const switchCameraBtn = document.getElementById("switchCameraBtn");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const loadBtn = document.getElementById("loadBtn");

let capturedBlob = null;
let currentFacingMode = "environment";
let token = null;
let currentUser = null;
let currentPhotoData = [];
let currentAdminPhotoData = [];

function setStatus(msg, type = "info", retain = false) {
  statusEl.textContent = msg;
  statusEl.className = "status status--" + type;
  if (!retain) {
    setTimeout(() => {
      statusEl.textContent = "";
      statusEl.className = "status";
    }, 4000);
  }
}

function showSection(role) {
  authSection.classList.add("hidden");
  userSection.classList.add("hidden");
  adminSection.classList.add("hidden");

  if (role === "admin") adminSection.classList.remove("hidden");
  else if (role === "user") userSection.classList.remove("hidden");
  else authSection.classList.remove("hidden");
}

async function callApi(path, options = {}) {
  options.headers = options.headers || {};
  if (token) options.headers["Authorization"] = `Bearer ${token}`;
  if (!options.headers["Content-Type"] && !(options.body instanceof FormData)) {
    options.headers["Content-Type"] = "application/json";
  }
  if (options.body && typeof options.body !== "string" && !(options.body instanceof FormData)) {
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(path, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.detail ? ` (${err.detail})` : "";
    throw new Error((err.error || `HTTP ${res.status}`) + detail);
  }
  return res.json();
}

function loginSuccess(data) {
  token = data.token;
  currentUser = { username: data.username, role: data.role };
  if (data.role === "admin") {
    adminLabel.textContent = `Admin: ${data.username}`;
    showSection("admin");
    fetchAdminData();
  } else {
    userLabel.textContent = `User: ${data.username}`;
    showSection("user");
    loadNames();
    startCamera(currentFacingMode);
    setStatus("Logged in. Capture and upload photos.", "success", true);
    // Default to blank so driver name can be entered freely.
    nameInput.value = "";
  }
}

async function doLogin() {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username || !password) {
    loginStatus.textContent = "Username and password are required.";
    return;
  }

  loginStatus.textContent = "Logging in...";
  try {
    const data = await callApi("/api/login", {
      method: "POST",
      body: { username, password }
    });
    loginSuccess(data);
  } catch (err) {
    loginStatus.textContent = err.message;
    console.error("Login error", err);
  }
}

async function doSignup() {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username || !password) {
    loginStatus.textContent = "Username and password are required.";
    return;
  }

  loginStatus.textContent = "Signing up...";
  try {
    await callApi("/api/signup", {
      method: "POST",
      body: { username, password }
    });
    loginStatus.textContent = "Signup successful. Logging in...";
    await doLogin();
  } catch (err) {
    loginStatus.textContent = err.message;
    console.error("Signup error", err);
  }
}

function doLogout() {
  token = null;
  currentUser = null;
  stopCamera();
  showSection(null);
  setStatus("", "info");
  photoGrid.innerHTML = "";
  folderList.innerHTML = "";
  adminPhotoList.innerHTML = "";
  activityLog.textContent = "";
}

function stopCamera() {
  if (video && video.srcObject) {
    const tracks = video.srcObject.getTracks();
    tracks.forEach((track) => track.stop());
    video.srcObject = null;
  }
}

async function startCamera(mode = "environment") {
  stopCamera();
  try {
    currentFacingMode = mode;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false });
    video.srcObject = stream;
    switchCameraBtn.textContent = mode === "environment" ? "Use Front Camera" : "Use Back Camera";
    captureBtn.disabled = false;
    setStatus(`Camera ready (${mode}).`, "success", true);
  } catch (err) {
    setStatus("Camera access failed. Please allow camera permissions.", "error", true);
    captureBtn.disabled = true;
    switchCameraBtn.disabled = true;
  }
}

function refreshSaveState() {
  saveBtn.disabled = !(capturedBlob && nameInput.value.trim() && siteInput.value.trim());
  clearBtn.disabled = !capturedBlob;
}

function resizeImageBlob(blob, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const targetW = Math.round(img.width * scale);
      const targetH = Math.round(img.height * scale);
      const off = document.createElement("canvas");
      off.width = targetW;
      off.height = targetH;
      const ctx = off.getContext("2d");
      ctx.drawImage(img, 0, 0, targetW, targetH);
      off.toBlob(
        (out) => {
          if (!out) return reject(new Error("Failed to resize image"));
          resolve(out);
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for resize"));
    };
    img.src = url;
  });
}

function toggleButtons(disable) {
  [captureBtn, saveBtn, loadBtn, clearBtn, switchCameraBtn].forEach((btn) => {
    btn.disabled = disable || (btn === saveBtn && !(capturedBlob && nameInput.value.trim()));
  });
}

captureBtn.addEventListener("click", () => {
  if (!video.videoWidth) {
    setStatus("Camera not ready yet.");
    return;
  }
  const width = video.videoWidth;
  const height = video.videoHeight;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);
  canvas.toBlob((blob) => {
    capturedBlob = blob;
    preview.src = URL.createObjectURL(blob);
    setStatus("Photo captured. Ready to save.", "success");
    saveBtn.disabled = false;
    clearBtn.disabled = false;
    refreshSaveState();
  }, "image/jpeg", 0.92);
});

switchCameraBtn.addEventListener("click", async () => {
  const nextMode = currentFacingMode === "environment" ? "user" : "environment";
  setStatus(`Switching to ${nextMode === "environment" ? "back" : "front"} camera...`, "info", true);
  await startCamera(nextMode);
});

saveBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  const siteName = siteInput.value.trim();
  const size = vehicleSize.value;
  if (!name) {
    setStatus("Please enter a name.", "warn");
    return;
  }
  if (!siteName) {
    setStatus("Please enter a site name.", "warn");
    return;
  }
  if (!capturedBlob) {
    setStatus("Please capture a photo first.", "warn");
    return;
  }

  let uploadBlob = capturedBlob;
  try {
    const maxDim = size === "small" ? 1280 : 1920;
    const quality = size === "small" ? 0.7 : 0.85;
    uploadBlob = await resizeImageBlob(capturedBlob, maxDim, quality);
  } catch (err) {
    console.warn("Resize failed, using original image.", err);
  }

  const form = new FormData();
  form.append("name", name);
  form.append("siteName", siteName);
  form.append("vehicleSize", size);
  form.append("photo", uploadBlob, "capture.jpg");

  setStatus("Saving...", "info", true);
  toggleButtons(true);

  try {
    const data = await callApi("/api/upload", { method: "POST", body: form });
    setStatus(`Saved for ${data.name}.`, "success");
    capturedBlob = null;
    preview.src = "";
    clearBtn.disabled = true;
    refreshSaveState();
    await loadNames();
    await loadPhotos(name);
  } catch (err) {
    setStatus(err.message || "Save failed.", "error", true);
  } finally {
    toggleButtons(false);
  }
});

clearBtn.addEventListener("click", () => {
  capturedBlob = null;
  preview.src = "";
  setStatus("Input cleared. Ready for next capture.", "info");
  refreshSaveState();
});

loadBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) {
    setStatus("Enter a name to load photos.", "warn");
    return;
  }
  await loadPhotos(name);
});

nameInput.addEventListener("input", () => {
  refreshSaveState();
  if (!nameInput.value.trim()) {
    photoGrid.innerHTML = "";
    setStatus("Enter a name to show saved photos.", "info");
  }
});

siteInput.addEventListener("input", () => {
  refreshSaveState();
});

loginBtn.addEventListener("click", doLogin);
signupBtn.addEventListener("click", doSignup);
logoutBtn.addEventListener("click", doLogout);
adminLogoutBtn.addEventListener("click", doLogout);

async function loadNames() {
  try {
    const data = await callApi("/api/names");
    nameList.innerHTML = "";
    data.names.forEach((n) => {
      const opt = document.createElement("option");
      opt.value = n;
      nameList.appendChild(opt);
    });
  } catch (err) {
    console.warn(err);
  }
}

function parseTimestampFromFilename(filename) {
  // New style: name_2026-04-03_10-30-22.jpg
  let match = filename.match(/_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
  if (match) {
    const [datePart, timePart] = match[1].split("_");
    const isoString = `${datePart}T${timePart.replace(/-/g, ":")}`;
    const date = new Date(isoString);
    if (!Number.isNaN(date.valueOf())) return date;
  }

  // Older style: 20260403_104541.jpg or name_20260403_104541.jpg
  match = filename.match(/(?:.*_)?(\d{8}_\d{6})/);
  if (match) {
    const [datePart, timePart] = match[1].split("_");
    const isoString = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}`;
    const date = new Date(isoString);
    if (!Number.isNaN(date.valueOf())) return date;
  }

  return null;
}

function formatTimestampDisplay(filename) {
  const date = parseTimestampFromFilename(filename);
  return date ? date.toLocaleString() : "";
}

function renderPhotoList(photos, targetList) {
  targetList.innerHTML = "";
  photos.forEach((p) => {
    const card = document.createElement("div");
    card.className = "photo-card";

    const img = document.createElement("img");
    img.src = p.url;
    img.alt = p.filename;

    const meta = document.createElement("div");
    meta.className = "photo-meta";
    const ts = p.capturedAt || formatTimestampDisplay(p.filename);
    const sizeLabel = p.vehicleSize ? ` | ${p.vehicleSize.toUpperCase()}` : "";
    const siteLabel = p.siteName ? ` | ${p.siteName}` : "";
    meta.textContent = ts ? `Captured: ${ts}${sizeLabel}${siteLabel}` : `${p.filename}${sizeLabel}${siteLabel}`;

    card.append(img, meta);
    targetList.appendChild(card);
  });
}

function updateSummary(photos, targetEl) {
  if (!targetEl) return;
  if (!photos || !photos.length) {
    targetEl.textContent = "";
    return;
  }
  let small = 0;
  let big = 0;
  photos.forEach((p) => {
    if (p.vehicleSize === "small") small += 1;
    else if (p.vehicleSize === "big") big += 1;
  });
  targetEl.textContent = `Count: Small ${small} | Big ${big} | Total ${photos.length}`;
}

async function loadPhotos(name) {
  setStatus(`Loading photos for ${name}...`, "info", true);
  toggleButtons(true);
  try {
    const data = await callApi(`/api/photos?name=${encodeURIComponent(name)}`);
    if (!data.photos || data.photos.length === 0) {
      photoGrid.innerHTML = "";
      currentPhotoData = [];
      updateSummary([], photoSummary);
      setStatus("No photos found for this name.", "warn");
      return;
    }

    currentPhotoData = data.photos.map((p) => {
      const capturedAt = parseTimestampFromFilename(p.filename);
      return {
        ...p,
        capturedAt,
      };
    });

    const sorted = currentPhotoData
      .slice()
      .sort((a, b) => {
        if (a.capturedAt && b.capturedAt) return b.capturedAt - a.capturedAt;
        if (a.capturedAt) return -1;
        if (b.capturedAt) return 1;
        return 0;
      });

    renderPhotoList(sorted, photoGrid);
    updateSummary(sorted, photoSummary);
    setStatus(`Showing ${sorted.length} photo(s), sorted by date (newest first).`, "success");
  } catch (err) {
    setStatus(err.message || "Failed to load photos.", "error");
  } finally {
    toggleButtons(false);
  }
}

function filterPhotosByDate(dateString, data, targetList) {
  let filtered = data;
  if (dateString) {
    const selected = new Date(dateString);
    filtered = data.filter((p) => {
      if (!p.capturedAt) return false;
      const d = new Date(p.capturedAt);
      return d.toISOString().slice(0, 10) === selected.toISOString().slice(0, 10);
    });
  }

  renderPhotoList(filtered, targetList);
  if (targetList === photoGrid) updateSummary(filtered, photoSummary);
  if (targetList === adminPhotoList) updateSummary(filtered, adminPhotoSummary);
  if (!filtered.length) {
    setStatus("No photos found for selected date.", "warn");
  } else {
    setStatus(`Showing ${filtered.length} photo(s) for selected date.`, "success");
  }
}

async function fetchAdminData() {
  try {
    const data = await callApi("/api/admin/folders");
    folderList.innerHTML = "";
    data.names.forEach((name) => {
      const row = document.createElement("div");
      row.className = "panel-row";
      const text = document.createElement("span");
      text.textContent = name;
      const viewBtn = document.createElement("button");
      viewBtn.textContent = "View Images";
      viewBtn.addEventListener("click", () => loadAdminPhotos(name));
      row.append(text, viewBtn);
      folderList.appendChild(row);
    });

    const activity = await callApi("/api/admin/activity");
    activityLog.textContent = activity.logs
      .map((l) => `${l.timestamp} | ${l.username} | ${l.targetFolder} | ${l.filename} | ${l.vehicleSize || "N/A"} | ${l.siteName || "N/A"}`)
      .join("\n");
  } catch (err) {
    console.error(err);
  }
}

async function loadAdminPhotos(name) {
  try {
    const data = await callApi(`/api/photos?name=${encodeURIComponent(name)}`);
    adminPhotoList.innerHTML = `\n<h4>Images for ${name}</h4>\n`;

    currentAdminPhotoData = data.photos.map((p) => {
      const capturedAt = parseTimestampFromFilename(p.filename);
      return { ...p, capturedAt };
    });
    if (!currentAdminPhotoData.length) {
      updateSummary([], adminPhotoSummary);
    }

    const sorted = currentAdminPhotoData.slice().sort((a, b) => {
      if (a.capturedAt && b.capturedAt) return b.capturedAt - a.capturedAt;
      if (a.capturedAt) return -1;
      if (b.capturedAt) return 1;
      return 0;
    });

    renderPhotoList(sorted, adminPhotoList);
    updateSummary(sorted, adminPhotoSummary);
  } catch (err) {
    console.error(err);
  }
}

const photoDateFilter = document.getElementById("photoDateFilter");
const adminDateFilter = document.getElementById("adminDateFilter");

function setMaxDateToday(input) {
  if (!input) return;
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  input.max = todayStr;
  if (!input.value) input.value = todayStr;
}

setMaxDateToday(photoDateFilter);
setMaxDateToday(adminDateFilter);

refreshAdmin.addEventListener("click", fetchAdminData);
adminSearch.addEventListener("input", () => {
  const filter = adminSearch.value.toLowerCase();
  Array.from(folderList.children).forEach((child) => {
    const text = child.querySelector("span").textContent.toLowerCase();
    child.style.display = text.includes(filter) ? "flex" : "none";
  });
});

photoDateFilter.addEventListener("change", () => {
  filterPhotosByDate(photoDateFilter.value, currentPhotoData, photoGrid);
});

adminDateFilter.addEventListener("change", () => {
  filterPhotosByDate(adminDateFilter.value, currentAdminPhotoData, adminPhotoList);
});

showSection(null);
