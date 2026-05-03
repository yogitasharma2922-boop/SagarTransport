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

`render.yaml` is included for Render.

Set these environment variables in Render:
- `NODE_ENV=production`
- `JWT_SECRET`
- `DATABASE_URL`
- `DRIVE_ROOT_FOLDER_ID`
- either `GOOGLE_SERVICE_ACCOUNT_JSON` or the OAuth variables

Health check endpoint:
- `/health`

Important:
- Production now fails fast if required env vars are missing
- This prevents silent fallback to local JSON storage on ephemeral hosting

## Google Drive behavior

In Drive mode:
- Every uploaded photo is saved to Google Drive
- The app creates or reuses a folder named after the upload target
- The file metadata is stored separately in Postgres
- If public sharing succeeds, the app stores a Drive URL
- If public sharing cannot be enabled, the app serves the file through `/api/photo/:id`
