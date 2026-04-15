# Cloudflare R2 Integration Guide

This guide explains how to set up and use Cloudflare R2 for storing compressed images in the Sagar Transport application.

## Overview

The application now integrates with **Cloudflare R2** to store compressed images. When enabled, images are automatically:

1. Compressed using Sharp (JPEG format)
2. Uploaded to Cloudflare R2 object storage
3. Links are stored in PostgreSQL database
4. Public URLs are returned to the frontend

If Cloudflare R2 is not configured or fails, the app automatically falls back to:
- Local storage (if `LOCAL_MODE=1`)
- Google Drive (if properly configured)

## Prerequisites

1. **Cloudflare Account** - Sign up at https://www.cloudflare.com
2. **R2 Bucket** - Create an R2 bucket for storing images
3. **API Token** - Generate Cloudflare API credentials
4. **PostgreSQL Database** - For storing image metadata and Cloudflare URLs

## Step 1: Create a Cloudflare R2 Bucket

1. Log in to Cloudflare Dashboard
2. Navigate to **R2** (Object Storage)
3. Click **Create bucket**
4. Enter a bucket name (e.g., `sagar-transport-images`)
5. Choose a region (default is fine)
6. Click **Create bucket**

Note your **Account ID** (visible in the R2 overview page)

## Step 2: Create R2 API Token

1. Go to **Settings** → **API Tokens** (in R2 overview)
2. Click **Create API Token**
3. Choose "Create a new API token"
4. Select **Edit** permissions (allows read/write access)
5. Select **Object (All)** as the scope
6. Click **Create API Token**
7. Copy and save:
   - **Access Key ID**
   - **Secret Access Key**

⚠️ **Important**: The secret access key is shown only once. Store it securely.

## Step 3: Set Up Environment Variables

Add these environment variables to your `.env` file or deployment platform:

### Cloudflare R2 Configuration

```env
# Cloudflare Account ID (found in R2 overview)
CLOUDFLARE_ACCOUNT_ID=your_account_id_here

# R2 API Token credentials
CLOUDFLARE_ACCESS_KEY_ID=your_access_key_id_here
CLOUDFLARE_ACCESS_KEY_SECRET=your_secret_access_key_here

# R2 Bucket name
CLOUDFLARE_R2_BUCKET_NAME=sagar-transport-images

# (Optional) Custom domain for public URLs
# Leave empty to use default R2 URL format
# Example: https://images.yourdomain.com
CLOUDFLARE_R2_PUBLIC_URL=

# PostgreSQL Database URL (required for storing links)
DATABASE_URL=postgresql://user:password@host:port/database
```

### Optional: Custom Domain Setup

To use a custom domain instead of the default R2 URL:

1. In Cloudflare R2 bucket settings, go to **Settings** → **Public access**
2. Enable **Allow access via R2 API**
3. Click **Connect domain** and follow the wizard
4. Set `CLOUDFLARE_R2_PUBLIC_URL` to your custom domain

## Step 4: Update Database

The schema has been automatically updated to include `cloudflare_url` column:

```sql
ALTER TABLE photos ADD COLUMN cloudflare_url TEXT;
```

This happens automatically on first run if using PostgreSQL.

## Step 5: Install Dependencies

After updating environment variables, install the AWS SDK:

```bash
npm install
```

Key new dependency:
- `@aws-sdk/client-s3` - For communicating with Cloudflare R2 (S3-compatible API)

## Step 6: Restart Application

```bash
npm start
```

Watch the logs for confirmation:
```
Cloudflare R2 initialized
Server running on http://localhost:3000
```

## Verification

1. Upload a photo through the app
2. Check the logs for success message:
   ```
   Uploaded to Cloudflare R2: folder_name/filename.jpg
   ```
3. Verify in Cloudflare R2 dashboard that the image appears in your bucket
4. Verify in PostgreSQL that the `cloudflare_url` is populated:
   ```sql
   SELECT filename, cloudflare_url FROM photos WHERE cloudflare_url IS NOT NULL LIMIT 1;
   ```

## URL Format

### Default R2 URL (no custom domain)
```
https://bucket-name.account-id.r2.cloudflarestorage.com/folder/filename.jpg
```

### Custom Domain URL
```
https://images.yourdomain.com/folder/filename.jpg
```

## Database Schema

### photos table

New column added:
```sql
cloudflare_url TEXT  -- Stores the public Cloudflare R2 URL
```

Full schema:
```sql
CREATE TABLE photos (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  site_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,                    -- Legacy field, or primary URL
  vehicle_size TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  drive_file_id TEXT,                   -- Google Drive ID (if uploaded there)
  cloudflare_url TEXT,                  -- Cloudflare R2 URL (NEW)
  UNIQUE (name, filename)
);
```

## Priority System

When retrieving photos, the app uses this URL priority:

1. **Cloudflare R2 URL** (if available) - Fastest & most reliable
2. **Google Drive URL** (if available)
3. **Local storage URL** (if available)

The first available URL is used for displaying photos.

## Performance & Cost Benefits

### Benefits of Cloudflare R2:
- ✅ **Fast CDN delivery** - Images served from Cloudflare edge locations
- ✅ **Reliable storage** - Enterprise-grade object storage
- ✅ **Pay-per-use** - No egress fees (unlike AWS S3)
- ✅ **Easy management** - Web dashboard and API
- ✅ **Automatic compression** - Sharp compression before upload

### Estimated Monthly Cost (for typical usage):
- Storage: $0.015 per GB stored (~$1/month for 70GB)
- API requests: $4.50 per 1 million requests (typically small portion of cost)

## Troubleshooting

### Issue: "Cloudflare R2 not configured"
**Solution**: Verify all required environment variables are set:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ACCESS_KEY_ID`
- `CLOUDFLARE_ACCESS_KEY_SECRET`
- `CLOUDFLARE_R2_BUCKET_NAME`

### Issue: "The specified bucket does not exist"
**Solution**: Verify bucket name exactly matches what you created in R2 dashboard.

### Issue: "InvalidAccessKeyId"
**Solution**: Check that your Access Key ID and Secret are correctly copied from the R2 API token.

### Issue: Images upload but URL is empty
**Solution**: Check that `DATABASE_URL` is set and PostgreSQL is running. Verify the photos table has `cloudflare_url` column.

### Issue: Slow uploads
**Solution**: This is normal for first upload. Subsequent uploads use the same connection pool. Consider implementing a queue system if needed.

## Fallback Behavior

If Cloudflare R2 is:

- **Not configured** → Uses Google Drive or Local storage (if available)
- **Upload fails** → Retries with Google Drive or Local storage
- **API error** → Logs warning, continues with fallback

This ensures the application remains functional even if Cloudflare R2 becomes temporarily unavailable.

## Rollback (Remove Cloudflare)

To remove Cloudflare R2 integration:

1. Delete or unset Cloudflare environment variables
2. Existing image URLs will still work (stored in DB)
3. New images will use Google Drive/Local storage fallback
4. The `cloudflare_url` column remains in database (no harm)

## File Size & Compression

The app compresses images before upload:
- **Small vehicle**: Max 1280px, JPEG quality 70%
- **Large vehicle**: Max 1920px, JPEG quality 80%

This ensures:
- Faster uploads
- Lower storage costs
- Better performance on frontend

## API Endpoints

### Upload Photo
```
POST /api/upload
Headers: Authorization: Bearer {token}
Body: 
  - photo: file
  - name: string
  - siteName: string
  - vehicleSize: "small" | "big"
Response:
  {
    "ok": true,
    "name": "folder_name",
    "filename": "filename.jpg"
  }
```

The photo URL is automatically returned when fetching photo list:
```
GET /api/photos?name=folder_name
Response:
  {
    "photos": [
      {
        "filename": "filename.jpg",
        "url": "https://bucket.account-id.r2.cloudflarestorage.com/folder_name/filename.jpg",
        "vehicleSize": "small",
        "siteName": "Site A"
      }
    ]
  }
```

### Delete Photo
```
DELETE /api/admin/photo
Headers: Authorization: Bearer {token}
Body:
  {
    "name": "folder_name",
    "filename": "filename.jpg"
  }
Response: { "ok": true }
```

Automatically deletes from Cloudflare R2 if the image is stored there.

## Security Notes

1. **API Credentials**: Keep `CLOUDFLARE_ACCESS_KEY_SECRET` secure. Never commit to git.
2. **Database**: Ensure PostgreSQL credentials are in environment variables.
3. **Bucket Privacy**: R2 bucket can be configured as private (more secure) or public.
4. **URL Generation**: URLs are stored in database, so access control should be at application level.

## Migration from Google Drive

If you have existing photos in Google Drive:

1. Existing Google Drive URLs will continue to work
2. New photos will use Cloudflare R2
3. To migrate old photos: Delete and re-upload them, or use a batch migration script

## Support

For issues:
1. Check PostgreSQL logs: `SELECT * FROM photos WHERE cloudflare_url IS NOT NULL;`
2. Check Cloudflare R2 dashboard for bucket contents
3. Review application logs for upload errors
4. Verify environment variables with: `node -e "console.log(process.env.CLOUDFLARE_R2_BUCKET_NAME)"`

## Next Steps

- Set up Cloudflare Workers for advanced image manipulation
- Configure R2 lifecycle policies to archive old images
- Set up CDN caching rules for frequently accessed images
- Monitor usage in Cloudflare dashboard
