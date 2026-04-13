const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { google } = require("googleapis");
const { Readable } = require("stream");
const { Pool } = require("pg");
let sharp = null;
try {
  sharp = require("sharp");
} catch {
  sharp = null;
}

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "change_this_secret_for_production";

const LOCAL_MODE = process.env.LOCAL_MODE === "1";
const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID || "";
const USE_OAUTH = process.env.USE_OAUTH === "1";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || "";
const DATABASE_URL = process.env.DATABASE_URL || "";
const USE_DB = !LOCAL_MODE && Boolean(DATABASE_URL);

const dataDir = path.join(__dirname, "data");
const localFiles = {
  users: path.join(dataDir, "users.json"),
  photos: path.join(dataDir, "photos.json"),
  activity: path.join(dataDir, "activity.json")
};

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = []) {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  const payload = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(filePath, payload, "utf8");
}

async function ensureDataDir() {
  await fs.promises.mkdir(dataDir, { recursive: true });
}

async function migrateLegacyJson() {
  const legacyUsers = path.join(__dirname, "users.json");
  const legacyPhotos = path.join(__dirname, "photos.json");
  const legacyActivity = path.join(__dirname, "activity.json");
  const mappings = [
    [legacyUsers, localFiles.users],
    [legacyPhotos, localFiles.photos],
    [legacyActivity, localFiles.activity]
  ];
  for (const [from, to] of mappings) {
    if (fileExists(from) && !fileExists(to)) {
      await fs.promises.copyFile(from, to);
    }
  }
}

let pool = null;
if (USE_DB) {
  const useSsl = !DATABASE_URL.includes("localhost") && !DATABASE_URL.includes("127.0.0.1");
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false
  });
}

async function initDb() {
  if (!USE_DB) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS photos (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      site_name TEXT NOT NULL,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      vehicle_size TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      drive_file_id TEXT,
      UNIQUE (name, filename)
    );
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS photos_name_idx ON photos(name);");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL,
      username TEXT NOT NULL,
      target_folder TEXT NOT NULL,
      filename TEXT NOT NULL,
      vehicle_size TEXT NOT NULL,
      site_name TEXT NOT NULL
    );
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS activity_timestamp_idx ON activity(timestamp DESC);");
}

async function importJsonToDbIfEmpty() {
  if (!USE_DB) return;
  const usersCount = await pool.query("SELECT COUNT(*)::int AS count FROM users;");
  if (usersCount.rows[0].count === 0) {
    const users = await readJson(localFiles.users, []);
    for (const user of users) {
      await pool.query(
        "INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4);",
        [user.id, user.username, user.passwordHash, user.role]
      );
    }
  }

  const photosCount = await pool.query("SELECT COUNT(*)::int AS count FROM photos;");
  if (photosCount.rows[0].count === 0) {
    const photos = await readJson(localFiles.photos, []);
    for (const photo of photos) {
      await pool.query(
        "INSERT INTO photos (name, site_name, filename, url, vehicle_size, uploaded_by, timestamp, drive_file_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8);",
        [
          photo.name,
          photo.siteName,
          photo.filename,
          photo.url,
          photo.vehicleSize,
          photo.uploadedBy,
          photo.timestamp ? new Date(photo.timestamp) : new Date(),
          photo.driveFileId || null
        ]
      );
    }
  }

  const activityCount = await pool.query("SELECT COUNT(*)::int AS count FROM activity;");
  if (activityCount.rows[0].count === 0) {
    const activity = await readJson(localFiles.activity, []);
    for (const entry of activity) {
      await pool.query(
        "INSERT INTO activity (timestamp, username, target_folder, filename, vehicle_size, site_name) VALUES ($1,$2,$3,$4,$5,$6);",
        [
          entry.timestamp ? new Date(entry.timestamp) : new Date(),
          entry.username,
          entry.targetFolder,
          entry.filename,
          entry.vehicleSize,
          entry.siteName
        ]
      );
    }
  }
}

// Initialize Google Drive (optional)
let drive = null;
let driveReady = false;

function loadServiceAccount() {
  const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonEnv) {
    return JSON.parse(jsonEnv);
  }
  const jsonPathEnv = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  if (jsonPathEnv && fileExists(jsonPathEnv)) {
    const raw = fs.readFileSync(jsonPathEnv, "utf8");
    return JSON.parse(raw);
  }
  const defaultPath = path.join(__dirname, "google-service-account.json");
  if (fileExists(defaultPath)) {
    const raw = fs.readFileSync(defaultPath, "utf8");
    return JSON.parse(raw);
  }
  return null;
}

if (!LOCAL_MODE) {
  try {
    if (!DRIVE_ROOT_FOLDER_ID) {
      throw new Error("Missing DRIVE_ROOT_FOLDER_ID");
    }
    let auth = null;
    const serviceAccount = loadServiceAccount();

    if (USE_OAUTH || (!serviceAccount && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN)) {
      const oauth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      oauth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
      auth = oauth;
      console.log("Drive initialized with OAuth. Root folder:", DRIVE_ROOT_FOLDER_ID);
    } else if (serviceAccount) {
      auth = new google.auth.JWT(
        serviceAccount.client_email,
        null,
        serviceAccount.private_key,
        ["https://www.googleapis.com/auth/drive"]
      );
      console.log("Drive initialized with service account. Root folder:", DRIVE_ROOT_FOLDER_ID);
    } else {
      throw new Error("Missing Google Drive credentials");
    }

    drive = google.drive({ version: "v3", auth });
    driveReady = true;
  } catch (err) {
    console.error("Drive init failed; falling back to LOCAL_MODE.", err.message);
  }
}

const USE_LOCAL = LOCAL_MODE || !driveReady;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("trust proxy", 1);

if (USE_LOCAL) {
  app.use("/data", express.static(dataDir));
}

async function loadUsers() {
  if (USE_DB) {
    const result = await pool.query(
      "SELECT id, username, password_hash AS \"passwordHash\", role FROM users ORDER BY username ASC;"
    );
    return result.rows;
  }
  return readJson(localFiles.users, []);
}

async function getUserByUsername(username) {
  if (USE_DB) {
    const result = await pool.query(
      "SELECT id, username, password_hash AS \"passwordHash\", role FROM users WHERE username = $1 LIMIT 1;",
      [username]
    );
    return result.rows[0];
  }
  const users = await loadUsers();
  return users.find((u) => u.username === username);
}

async function addUser(user) {
  if (USE_DB) {
    await pool.query(
      "INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4);",
      [user.id, user.username, user.passwordHash, user.role]
    );
    return;
  }
  const users = await loadUsers();
  users.push(user);
  await writeJson(localFiles.users, users);
}

async function listNames() {
  if (USE_DB) {
    const result = await pool.query("SELECT DISTINCT name FROM photos ORDER BY name ASC;");
    return result.rows.map((row) => row.name);
  }
  const photos = await readJson(localFiles.photos, []);
  return Array.from(new Set(photos.map((p) => p.name)));
}

async function listPhotosByName(name) {
  if (USE_DB) {
    const result = await pool.query(
      "SELECT filename, url, vehicle_size AS \"vehicleSize\", site_name AS \"siteName\", drive_file_id AS \"driveFileId\" FROM photos WHERE name = $1 ORDER BY filename DESC;",
      [name]
    );
    return result.rows.map((row) => ({
      filename: row.filename,
      url: row.url || (row.driveFileId ? `/api/photo/${row.driveFileId}` : ""),
      vehicleSize: row.vehicleSize || "",
      siteName: row.siteName || ""
    }));
  }
  const photos = [];
  const all = await readJson(localFiles.photos, []);
  all.forEach((p) => {
    if (p.name === name) {
      const url = p.url || (p.driveFileId ? `/api/photo/${p.driveFileId}` : "");
      photos.push({
        filename: p.filename,
        url,
        vehicleSize: p.vehicleSize || "",
        siteName: p.siteName || ""
      });
    }
  });
  photos.sort((a, b) => b.filename.localeCompare(a.filename));
  return photos;
}

async function savePhotoMetadata(entry) {
  if (USE_DB) {
    await pool.query(
      "INSERT INTO photos (name, site_name, filename, url, vehicle_size, uploaded_by, timestamp, drive_file_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8);",
      [
        entry.name,
        entry.siteName,
        entry.filename,
        entry.url,
        entry.vehicleSize,
        entry.uploadedBy,
        entry.timestamp,
        entry.driveFileId || null
      ]
    );
    return;
  }
  const photos = await readJson(localFiles.photos, []);
  photos.push(entry);
  await writeJson(localFiles.photos, photos);
}

async function saveActivity(entry) {
  if (USE_DB) {
    await pool.query(
      "INSERT INTO activity (timestamp, username, target_folder, filename, vehicle_size, site_name) VALUES ($1,$2,$3,$4,$5,$6);",
      [
        entry.timestamp,
        entry.username,
        entry.targetFolder,
        entry.filename,
        entry.vehicleSize,
        entry.siteName
      ]
    );
    return;
  }
  const activity = await readJson(localFiles.activity, []);
  activity.push(entry);
  await writeJson(localFiles.activity, activity);
}

async function listActivity() {
  if (USE_DB) {
    const result = await pool.query(
      "SELECT timestamp, username, target_folder AS \"targetFolder\", filename, vehicle_size AS \"vehicleSize\", site_name AS \"siteName\" FROM activity ORDER BY timestamp DESC;"
    );
    return result.rows.map((row) => ({
      timestamp: row.timestamp.toISOString(),
      username: row.username,
      targetFolder: row.targetFolder,
      filename: row.filename,
      vehicleSize: row.vehicleSize || "",
      siteName: row.siteName || ""
    }));
  }
  const activity = await readJson(localFiles.activity, []);
  return activity
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .map((entry) => ({
      timestamp: entry.timestamp,
      username: entry.username,
      targetFolder: entry.targetFolder,
      filename: entry.filename,
      vehicleSize: entry.vehicleSize || "",
      siteName: entry.siteName || ""
    }));
}

async function getPhotoDriveFileId(name, filename) {
  if (USE_DB) {
    const result = await pool.query(
      "SELECT drive_file_id FROM photos WHERE name = $1 AND filename = $2 LIMIT 1;",
      [name, filename]
    );
    return result.rows[0] ? result.rows[0].drive_file_id : null;
  }
  const photos = await readJson(localFiles.photos, []);
  const target = photos.find((p) => p.name === name && p.filename === filename);
  return target ? target.driveFileId : null;
}

async function deletePhotoMetadata(name, filename) {
  if (USE_DB) {
    await pool.query("DELETE FROM photos WHERE name = $1 AND filename = $2;", [name, filename]);
    return;
  }
  const photos = await readJson(localFiles.photos, []);
  const filtered = photos.filter((p) => !(p.name === name && p.filename === filename));
  await writeJson(localFiles.photos, filtered);
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

function sanitizeFolderName(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[<>:\"/\\|?*\x00-\x1F]/g, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

function sanitizeSiteName(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[<>:\"/\\|?*\x00-\x1F]/g, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

function normalizeVehicleSize(input) {
  const val = String(input || "").trim().toLowerCase();
  if (val === "small" || val === "big") return val;
  return "";
}

function timestampForFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

async function compressImageBuffer(buffer, vehicleSize) {
  if (!sharp) return buffer;
  const maxDim = vehicleSize === "small" ? 1280 : 1920;
  const quality = vehicleSize === "small" ? 70 : 80;
  return sharp(buffer)
    .rotate()
    .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}

app.post("/api/signup", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing credentials" });

  const existing = await getUserByUsername(username);
  if (existing) return res.status(400).json({ error: "User already exists" });

  const passwordHash = bcrypt.hashSync(password, 8);
  const newUser = { id: username, username, passwordHash, role: "user" };
  await addUser(newUser);

  res.json({ ok: true });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing credentials" });

  const user = await getUserByUsername(username);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = bcrypt.compareSync(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: "12h" });
  res.json({ token, role: user.role, username: user.username });
});

app.get("/api/profile", authMiddleware, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

app.get("/api/names", authMiddleware, async (req, res) => {
  try {
    const names = await listNames();
    res.json({ names });
  } catch (err) {
    res.status(500).json({ error: "Failed to read names" });
  }
});

app.get("/api/photos", authMiddleware, async (req, res) => {
  try {
    const nameRaw = req.query.name || "";
    const name = sanitizeFolderName(nameRaw);
    if (!name) return res.json({ photos: [] });

    const photos = await listPhotosByName(name);
    res.json({ photos });
  } catch (err) {
    res.status(500).json({ error: "Failed to list photos" });
  }
});

app.get("/api/admin/folders", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const names = await listNames();
    res.json({ names });
  } catch (err) {
    res.status(500).json({ error: "Failed to list folders" });
  }
});

function escapeDriveQueryString(input) {
  return String(input || "").replace(/'/g, "\\'");
}

async function ensureDriveFolder(folderName) {
  const escaped = escapeDriveQueryString(folderName);
  const q = [
    `'${DRIVE_ROOT_FOLDER_ID}' in parents`,
    "trashed = false",
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${escaped}'`
  ].join(" and ");
  const list = await drive.files.list({
    q,
    fields: "files(id,name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  if (list.data.files && list.data.files.length > 0) {
    return list.data.files[0].id;
  }
  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [DRIVE_ROOT_FOLDER_ID]
    },
    fields: "id"
    ,
    supportsAllDrives: true
  });
  return created.data.id;
}

app.post("/api/upload", authMiddleware, upload.single("photo"), async (req, res) => {
  try {
    const nameRaw = req.body.name || "";
    const name = sanitizeFolderName(nameRaw);
    if (!name) return res.status(400).json({ error: "Name is required" });
    const siteName = sanitizeSiteName(req.body.siteName || "");
    if (!siteName) return res.status(400).json({ error: "Site name is required" });
    const vehicleSize = normalizeVehicleSize(req.body.vehicleSize);
    if (!vehicleSize) return res.status(400).json({ error: "Vehicle size is required" });

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Photo is required" });
    }

    const filename = `${name}_${timestampForFilename()}.jpg`;
    let url = "";
    let driveFileId = "";
    let uploadBuffer = req.file.buffer;
    try {
      uploadBuffer = await compressImageBuffer(uploadBuffer, vehicleSize);
    } catch (err) {
      console.warn("Server-side compression failed, using original buffer.", err.message || err);
    }

    if (USE_LOCAL) {
      const targetDir = path.join(dataDir, name);
      await fs.promises.mkdir(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, filename);
      await fs.promises.writeFile(targetPath, uploadBuffer);
      url = `/data/${name}/${filename}`;
    } else {
      const folderId = await ensureDriveFolder(name);
      const media = {
        mimeType: "image/jpeg",
        body: Readable.from(uploadBuffer)
      };
      const created = await drive.files.create({
        requestBody: {
          name: filename,
          parents: [folderId]
        },
        media,
        fields: "id",
        supportsAllDrives: true
      });
      driveFileId = created.data.id;
      try {
        await drive.permissions.create({
          fileId: driveFileId,
          requestBody: { role: "reader", type: "anyone" },
          supportsAllDrives: true
        });
        url = `https://drive.google.com/uc?id=${driveFileId}`;
      } catch (permErr) {
        console.warn("Failed to set public permission, falling back to API route.", permErr.message || permErr);
        url = `/api/photo/${driveFileId}`;
      }
    }

    const now = new Date();
    await savePhotoMetadata({
      name,
      siteName,
      filename,
      url,
      vehicleSize,
      uploadedBy: req.user.username,
      timestamp: now,
      driveFileId
    });

    await saveActivity({
      timestamp: now,
      username: req.user.username,
      targetFolder: name,
      filename,
      vehicleSize,
      siteName
    });

    res.json({ ok: true, name, filename });
  } catch (err) {
    console.error("UPLOAD ERROR:", err.message);
    console.error("UPLOAD ERROR STACK:", err.stack);
    if (err.response) {
      console.error("DRIVE API ERROR:", JSON.stringify(err.response.data));
    }
    res.status(500).json({ error: err.message || "Failed to save photo" });
  }
});

app.get("/api/photo/:id", authMiddleware, async (req, res) => {
  try {
    if (USE_LOCAL) {
      return res.status(404).json({ error: "Not available in LOCAL_MODE" });
    }
    const fileId = req.params.id;
    const meta = await drive.files.get({ fileId, fields: "mimeType,name", supportsAllDrives: true });
    const mimeType = meta.data.mimeType || "application/octet-stream";
    const name = meta.data.name || "photo";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    const driveRes = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" }
    );
    driveRes.data.on("error", () => {
      res.status(500).end();
    });
    driveRes.data.pipe(res);
  } catch (err) {
    res.status(404).json({ error: "Photo not found" });
  }
});

app.delete("/api/admin/photo", authMiddleware, adminMiddleware, async (req, res) => {
  const { name, filename } = req.body;
  if (!name || !filename) return res.status(400).json({ error: "Missing name/filename" });

  try {
    const driveFileId = await getPhotoDriveFileId(name, filename);

    if (USE_LOCAL) {
      const targetPath = path.join(dataDir, name, filename);
      if (fileExists(targetPath)) {
        await fs.promises.unlink(targetPath);
      }
    } else if (driveFileId) {
      await drive.files.delete({ fileId: driveFileId });
    }

    await deletePhotoMetadata(name, filename);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

app.get("/api/admin/activity", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const logs = await listActivity();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: "Failed to read activity" });
  }
});

async function initDefaultAdmin() {
  const users = await loadUsers();
  if (users.length === 0) {
    const passwordHash = bcrypt.hashSync("admin123", 8);
    const defaultAdmin = { id: "admin", username: "admin", passwordHash, role: "admin" };
    await addUser(defaultAdmin);
  }
}

async function bootstrap() {
  await ensureDataDir();
  await migrateLegacyJson();
  await initDb();
  await importJsonToDbIfEmpty();
  await initDefaultAdmin();
}

bootstrap().catch(console.error);

app.listen(PORT, () => {
  const mode = USE_LOCAL ? "LOCAL_MODE" : "DRIVE_MODE";
  const meta = USE_DB ? "POSTGRES" : "JSON";
  console.log(`Server running on http://localhost:${PORT} (${mode}, ${meta})`);
});
