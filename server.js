const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const { uploadToR2, deleteFromR2, USE_CLOUDFLARE_R2 } = require("./cloudflareR2");
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
      cloudflare_url TEXT,
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

// Storage Configuration
if (USE_CLOUDFLARE_R2) {
  console.log("Using Cloudflare R2 for image storage");
} else if (LOCAL_MODE) {
  console.log("Using local file storage");
} else {
  console.error("ERROR: Cloudflare R2 not configured and LOCAL_MODE is off. Images cannot be stored.");
}

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
      "SELECT filename, url, vehicle_size AS \"vehicleSize\", site_name AS \"siteName\", cloudflare_url AS \"cloudflareUrl\" FROM photos WHERE name = $1 ORDER BY filename DESC;",
      [name]
    );
    return result.rows.map((row) => ({
      filename: row.filename,
      url: row.cloudflareUrl || row.url,
      vehicleSize: row.vehicleSize || "",
      siteName: row.siteName || ""
    }));
  }
  const photos = [];
  const all = await readJson(localFiles.photos, []);
  all.forEach((p) => {
    if (p.name === name) {
      photos.push({
        filename: p.filename,
        url: p.url,
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
      "INSERT INTO photos (name, site_name, filename, url, vehicle_size, uploaded_by, timestamp, cloudflare_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8);",
      [
        entry.name,
        entry.siteName,
        entry.filename,
        entry.url,
        entry.vehicleSize,
        entry.uploadedBy,
        entry.timestamp,
        entry.cloudflareUrl || null
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

async function getPhotoCloudflareUrl(name, filename) {
  if (USE_DB) {
    const result = await pool.query(
      "SELECT cloudflare_url FROM photos WHERE name = $1 AND filename = $2 LIMIT 1;",
      [name, filename]
    );
    return result.rows[0] ? result.rows[0].cloudflare_url : null;
  }
  return null;
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
    let cloudflareUrl = "";
    let uploadBuffer = req.file.buffer;
    
    try {
      uploadBuffer = await compressImageBuffer(uploadBuffer, vehicleSize);
    } catch (err) {
      console.warn("Server-side compression failed, using original buffer.", err.message || err);
    }

    // Upload to Cloudflare R2
    if (!USE_CLOUDFLARE_R2) {
      return res.status(500).json({ error: "Cloudflare R2 not configured" });
    }

    const r2Key = `${name}/${filename}`;
    const r2Result = await uploadToR2(uploadBuffer, r2Key, "image/jpeg");
    if (!r2Result.success) {
      console.error("Cloudflare R2 upload failed:", r2Result.error);
      return res.status(500).json({ error: "Failed to upload image to storage" });
    }

    cloudflareUrl = r2Result.url;
    url = cloudflareUrl;
    console.log(`Uploaded to Cloudflare R2: ${r2Key}`);

    const now = new Date();
    await savePhotoMetadata({
      name,
      siteName,
      filename,
      url,
      vehicleSize,
      uploadedBy: req.user.username,
      timestamp: now,
      cloudflareUrl
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
    res.status(500).json({ error: err.message || "Failed to save photo" });
  }
});

app.get("/api/photo/:id", authMiddleware, async (req, res) => {
  res.status(404).json({ error: "Photo endpoint not available. All images use Cloudflare R2." });
});

app.delete("/api/admin/photo", authMiddleware, adminMiddleware, async (req, res) => {
  const { name, filename } = req.body;
  if (!name || !filename) return res.status(400).json({ error: "Missing name/filename" });

  try {
    const cloudflareUrl = await getPhotoCloudflareUrl(name, filename);

    // Delete from Cloudflare R2
    if (cloudflareUrl && USE_CLOUDFLARE_R2) {
      const r2Key = `${name}/${filename}`;
      const deleteResult = await deleteFromR2(r2Key);
      if (deleteResult.success) {
        console.log(`Deleted from Cloudflare R2: ${r2Key}`);
      } else {
        console.warn("Cloudflare R2 delete warning:", deleteResult.error);
        // Continue with metadata deletion even if R2 delete fails
      }
    }

    // Delete metadata from database
    await deletePhotoMetadata(name, filename);
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete error:", err.message);
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
  const storage = "CLOUDFLARE_R2";
  const meta = USE_DB ? "POSTGRES" : "JSON";
  console.log(`Server running on http://localhost:${PORT} (${storage}, ${meta})`);
});
