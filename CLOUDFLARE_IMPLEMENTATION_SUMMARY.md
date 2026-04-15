# Cloudflare R2 Integration - Implementation Summary

## What's Been Done

Your Sagar Transport application has been updated to integrate with **Cloudflare R2** for storing compressed images. Here's a complete overview of the changes:

---

## 📦 Files Modified

### 1. **package.json**
- ✅ Added `@aws-sdk/client-s3@^3.500.0` dependency
- This SDK allows communication with Cloudflare R2's S3-compatible API

### 2. **server.js**
- ✅ Imported Cloudflare R2 module
- ✅ Added `cloudflare_url` column to PostgreSQL photos table schema
- ✅ Updated `listPhotosByName()` to retrieve and prioritize Cloudflare URLs
- ✅ Updated `savePhotoMetadata()` to store Cloudflare URLs in database
- ✅ Added `getPhotoCloudflareUrl()` helper function
- ✅ Updated `/api/upload` endpoint to:
  - Compress image using Sharp
  - Upload compressed image to Cloudflare R2
  - Store Cloudflare URL in PostgreSQL
  - Fall back to Google Drive/Local storage if R2 fails
- ✅ Updated `/api/admin/photo` (DELETE) endpoint to:
  - Delete images from Cloudflare R2
  - Clean metadata from database

### 3. **cloudflareR2.js** (NEW FILE)
- ✅ Complete Cloudflare R2 integration module
- Functions:
  - `uploadToR2()` - Upload images to R2
  - `deleteFromR2()` - Delete images from R2
  - `existsInR2()` - Check if image exists
- S3Client configured with Cloudflare credentials
- Automatic fallback if credentials missing

### 4. **CLOUDFLARE_R2_SETUP.md** (NEW FILE)
- ✅ Complete step-by-step setup guide
- Prerequisites, environment variables, verification steps
- Troubleshooting guide
- Performance and cost information
- Database schema documentation
- API endpoint reference

### 5. **.env.example** (NEW FILE)
- ✅ Template for all required environment variables
- Clearly marked optional vs. required variables
- Quick start instructions

---

## 🚀 How It Works

### Upload Flow (Priority Order)

```
User uploads photo
    ↓
✓ Compress image (Sharp)
    ↓
✓ Try Cloudflare R2
    ├─ Success? → Store R2 URL in PostgreSQL → Use R2 URL
    └─ Failed? → Fall back to...
        ↓
    Try Google Drive
        ├─ Success? → Store Drive ID in PostgreSQL → Use Drive URL
        └─ Failed? → Fall back to...
            ↓
        Save to Local Storage
            ├─ Success? → Store local path in PostgreSQL
            └─ Failed? → Return error
```

### Retrieval Flow

```
User requests photos
    ↓
Query PostgreSQL
    ↓
Check cloudflare_url column
    ├─ Has Cloudflare URL? → Return fast R2 URL ✓
    ├─ Has Drive ID? → Construct Drive URL
    └─ Has Local path? → Construct local URL
```

### Deletion Flow

```
Admin deletes photo
    ↓
Check if stored in Cloudflare R2
    ├─ Yes? → Delete from Cloudflare R2
    └─ No? → Step to next...
        ↓
    Check if stored in Google Drive
        ├─ Yes? → Delete from Drive
        └─ No? → Step to next...
            ↓
        Delete from Local Storage
            ↓
    Delete metadata from PostgreSQL ✓
```

---

## 📋 Environment Variables Required

### For Cloudflare R2 (Recommended)
```
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_ACCESS_KEY_ID=your_access_key
CLOUDFLARE_ACCESS_KEY_SECRET=your_secret_key
CLOUDFLARE_R2_BUCKET_NAME=your_bucket_name
```

### For PostgreSQL (Required)
```
DATABASE_URL=postgresql://user:password@host:port/database
```

### For Google Drive (Optional - Fallback)
```
DRIVE_ROOT_FOLDER_ID=your_folder_id
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REFRESH_TOKEN=your_refresh_token
```

**See `.env.example` for all options**

---

## 🔧 Next Steps

### 1. **Get Cloudflare Credentials**
   - Create Cloudflare account (free): https://www.cloudflare.com
   - Create R2 bucket (first 10GB free per month)
   - Generate API token

### 2. **Set Environment Variables**
   - Copy `.env.example` to `.env`
   - Fill in Cloudflare credentials
   - Set DATABASE_URL for PostgreSQL

### 3. **Install Dependencies**
   ```bash
   npm install
   ```

### 4. **Start Application**
   ```bash
   npm start
   ```

### 5. **Test Upload**
   - Log in to app
   - Upload a test photo
   - Check logs: should see "Uploaded to Cloudflare R2"
   - Verify in Cloudflare Dashboard → R2 bucket

### 6. **Verify Database**
   ```sql
   SELECT filename, cloudflare_url FROM photos 
   WHERE cloudflare_url IS NOT NULL LIMIT 1;
   ```

---

## ✨ Key Features

### ✅ **Automatic Image Compression**
- Small vehicle: 1280px max, 70% JPEG quality
- Large vehicle: 1920px max, 80% JPEG quality
- Saves bandwidth and storage costs

### ✅ **Reliable Fallback System**
- Primary: Cloudflare R2
- Secondary: Google Drive
- Tertiary: Local storage
- Always uploads successfully

### ✅ **PostgreSQL Integration**
- Stores both old URLs (Drive) and new URLs (R2)
- Priority system ensures best URL is used
- Can migrate images gradually

### ✅ **Easy Management**
- Delete from R2 when admin deletes photo
- Automatic cleanup of storage
- No manual file management needed

### ✅ **Cost Effective**
- No egress fees from Cloudflare R2 (unlike AWS S3)
- Pay only for storage and API requests
- First 10GB of storage free every month

### ✅ **Fast Delivery**
- Images served from Cloudflare edge locations
- Global CDN included
- Faster than Google Drive for most users

---

## 📊 Database Schema Update

### New Column Added
```sql
ALTER TABLE photos ADD COLUMN cloudflare_url TEXT;
```

### Full Table Structure
```sql
CREATE TABLE photos (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  site_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,                 -- Primary URL (auto-selected)
  vehicle_size TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  drive_file_id TEXT,                -- Google Drive storage
  cloudflare_url TEXT,               -- ← NEW: Cloudflare R2 storage
  UNIQUE (name, filename)
);
```

---

## 🔍 Monitoring & Logs

### Check Upload Success
```bash
# Look for logs:
Uploaded to Cloudflare R2: folder_name/filename.jpg
```

### Check Delete Success
```bash
# Look for logs:
Deleted from Cloudflare R2: folder_name/filename.jpg
```

### Monitor API Access
```bash
# Query photo URLs in PostgreSQL:
SELECT filename, cloudflare_url, url FROM photos;
```

### View Cloudflare Dashboard
- Go to Cloudflare → R2
- View files in bucket
- Check API usage and costs
- Monitor bandwidth usage

---

## ⚠️ Important Notes

1. **Keep Secrets Safe**
   - Never commit `.env` file to git
   - Never share `CLOUDFLARE_ACCESS_KEY_SECRET`
   - Use secure environment variable storage in production

2. **Existing Images**
   - Old images remain available at their stored URLs
   - New images automatically use Cloudflare R2
   - No migration needed - gradual transition

3. **Fallback Guarantee**
   - If R2 fails, app automatically tries Drive/Local
   - Users won't experience upload failures
   - All images remain accessible

4. **Testing**
   - Test with small images first
   - Monitor logs during initial uploads
   - Verify URLs are accessible in Cloudflare dashboard

---

## 📚 Documentation Files Created

1. **`CLOUDFLARE_R2_SETUP.md`** - Complete setup and troubleshooting guide
2. **`.env.example`** - Environment variables template
3. **`cloudflareR2.js`** - R2 integration module (reusable)
4. **This file** - Quick reference and implementation summary

---

## 🎯 Quick Checklist

- [ ] Create Cloudflare account
- [ ] Create R2 bucket
- [ ] Generate API token
- [ ] Copy `.env.example` to `.env`
- [ ] Fill in Cloudflare credentials
- [ ] Update `DATABASE_URL`
- [ ] Run `npm install`
- [ ] Run `npm start`
- [ ] Test upload photo
- [ ] Verify in Cloudflare dashboard
- [ ] Check PostgreSQL for URL
- [ ] Production deployment

---

## 🆘 Troubleshooting

**Problem**: "Cloudflare R2 not configured"
- **Solution**: Check all `CLOUDFLARE_*` env variables are set

**Problem**: Upload succeeds but no Cloudflare URL in DB
- **Solution**: Verify `DATABASE_URL` is set and PostgreSQL is running

**Problem**: Images upload but are slow
- **Solution**: This is normal for first time. Connections are reused after.

**Problem**: Custom domain not working
- **Solution**: Verify `CLOUDFLARE_R2_PUBLIC_URL` and DNS settings

**See `CLOUDFLARE_R2_SETUP.md` for more troubleshooting**

---

## 📞 Support

For detailed information:
1. Read `CLOUDFLARE_R2_SETUP.md` for comprehensive guide
2. Check `.env.example` for variable descriptions
3. Review `cloudflareR2.js` for implementation details
4. Check application logs for error messages

Happy image storing! 🚀
