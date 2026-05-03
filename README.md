# SagarTransport

Transport photo capture app with:
- JWT login
- admin activity tracking
- Google Drive photo storage
- Postgres metadata storage for production

## Local run

Install dependencies:

```bash
npm install
```

Run in local file-storage mode:

```bash
# PowerShell
$env:LOCAL_MODE="1"
node server.js
```

The app opens at `http://localhost:3000`.

Default admin login:
- username: `admin`
- password: `admin123`

## Storage modes

`LOCAL_MODE=1`
- Photos are saved under `data/`
- Users, photo metadata, and activity are saved in local JSON files
- Good for testing only

Drive mode
- Photos are uploaded to Google Drive
- Users, photo metadata, and activity should be stored in Postgres via `DATABASE_URL`
- Recommended for deployment

## Required production env vars

These must be set for deployment:

```env
NODE_ENV=production
JWT_SECRET=replace_with_a_long_random_secret
DATABASE_URL=postgres_connection_string
DRIVE_ROOT_FOLDER_ID=your_google_drive_folder_id
```

Then choose one Google auth method.

### Option A: Service account

Set:

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Notes:
- Share the Drive folder with the service account email
- The app will create a subfolder per transport/site name inside the root folder

### Option B: OAuth client

Set:

```env
USE_OAUTH=1
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

You can also provide the client JSON instead of separate client ID/secret:

```env
GOOGLE_OAUTH_CLIENT_JSON={"installed":{"client_id":"...","client_secret":"..."}}
```

## About your `client_secret_*.json`

That file is your OAuth client configuration. It is useful, but it is not enough on its own.

You still need:
- `GOOGLE_REFRESH_TOKEN`
- `DRIVE_ROOT_FOLDER_ID`
- `DATABASE_URL`
- `JWT_SECRET`

## Render deployment

Deploy the branch:

- `codex/drive-employee-flow`

This project is configured for Google Drive via OAuth on Render.

Set these environment variables in Render:

```env
NODE_ENV=production
JWT_SECRET=replace_with_a_long_random_secret
DATABASE_URL=replace_with_your_render_postgres_external_database_url
DRIVE_ROOT_FOLDER_ID=1iRfZfmsHuWyXf-aNf_SHG0xyr-k3uI5o
USE_OAUTH=1
GOOGLE_CLIENT_ID=391510149716-1mut9chm6bq5ql38hikpi1ia180furfb.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=add_in_render_only
GOOGLE_REFRESH_TOKEN=add_in_render_only
PAYMENT_QR_LABEL=Online Payment QR
```

Do not set:

- `LOCAL_MODE=1`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

Health check endpoint:

- `/health`

After deploy, open:

- `https://your-render-app.onrender.com/health`

Expected result:

- `mode: DRIVE_MODE`
- `storage: POSTGRES` when `DATABASE_URL` is configured

Important:

- Production fails fast if required env vars are missing
- New uploads go to Google Drive
- User, activity, and photo metadata should use Render Postgres

## Google Drive behavior

In Drive mode:
- Every uploaded photo is saved to Google Drive
- The app creates or reuses a folder named after the upload target
- The file metadata is stored separately in Postgres
- If public sharing succeeds, the app stores a Drive URL
- If public sharing cannot be enabled, the app serves the file through `/api/photo/:id`
