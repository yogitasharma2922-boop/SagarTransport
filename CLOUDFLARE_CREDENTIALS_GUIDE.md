# How to Get Cloudflare R2 Details

Follow these steps to get all the information you need for your Sagar Transport app.

## Step 1: Create Cloudflare Account

1. Go to https://www.cloudflare.com
2. Click **Sign Up** (top right)
3. Enter your email and password
4. Verify your email
5. Skip adding a website (or add one if you have)
6. Click **Create Account**

## Step 2: Create R2 Bucket

1. Log in to Cloudflare Dashboard
2. Look for **R2 Object Storage** in the left sidebar (or search for it)
3. Click **R2**
4. Click **Create Bucket**
5. Fill in:
   - **Bucket Name**: `sagar-transport-images` (or your preferred name)
   - **Region**: Leave as default
6. Click **Create Bucket**

**Note down your Bucket Name** (you'll need this)

## Step 3: Get Your Account ID

1. In R2 overview, look at the **Bucket URL**
   - Format: `https://[bucket-name].[account-id].r2.cloudflarestorage.com`
   - Example: `https://sagar-transport-images.abc123def456.r2.cloudflarestorage.com`

2. Extract the **Account ID** (middle part between dots)
   - From example above: `abc123def456`

**✏️ Copy your Account ID** (11-12 character alphanumeric string)

## Step 4: Generate R2 API Token

### Method 1: In R2 Settings (Easiest)

1. In R2 bucket page, go to **Settings** (top right)
2. Scroll down to **API Tokens**
3. Click **Create API Token**
4. Choose **Edit** (allows read/write access)
5. Select the token scope:
   - Choose **Object**
   - Select **All** for objects
6. Click **Create API Token**

A popup will show your credentials. **Copy all three:**

```
Access Key ID:     ___________________
Secret Access Key: ___________________
Session Token:     (leave this)
```

### Method 2: Via Cloudflare API Tokens Page

1. Go to **Cloudflare Dashboard** → **Account** (bottom left)
2. Click **API Tokens**
3. Click **Create Token**
4. Use Template: **Edit Cloudflare Workers**
5. Modify permissions:
   - Remove **Workers** permission
   - Add **R2: Object Storage** permission
   - Select **Edit** access
6. Create and copy credentials

## Summary of Required Details

You now have these 4 key pieces of information:

```
1. CLOUDFLARE_ACCOUNT_ID
   Example: abc123def456789

2. CLOUDFLARE_ACCESS_KEY_ID
   Example: 3d4b5c6d7e8f9g0h1i2j3k4l

3. CLOUDFLARE_ACCESS_KEY_SECRET
   Example: x1y2z3a4b5c6d7e8f9g0h1i2j3k4l5m6n7o8p9q0r1s2t3u4v5w6x7y8z

4. CLOUDFLARE_R2_BUCKET_NAME
   Example: sagar-transport-images
```

## Verify Your Details

To verify everything is correct, you can test the connection:

### Test 1: Check Bucket Exists
```
Go to: https://[bucket-name].[account-id].r2.cloudflarestorage.com
Should show: Access Denied (means bucket is private ✓)
```

### Test 2: Check API Token
At the command line (after npm install):
```bash
node -e "
const { S3Client } = require('@aws-sdk/client-s3');
const client = new S3Client({
  region: 'auto',
  endpoint: 'https://[ACCOUNT_ID].r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: '[ACCESS_KEY_ID]',
    secretAccessKey: '[SECRET_ACCESS_KEY]'
  }
});
console.log('Connection test passed ✓');
"
```

Replace the bracketed values with your actual credentials.

## Using in Render.com

1. Go to **Render Dashboard**
2. Select your **SagarTransport** service
3. Click **Environment** tab
4. Add these variables (click **Add Environment Variable**):

| Key | Value |
|-----|-------|
| CLOUDFLARE_ACCOUNT_ID | Your Account ID |
| CLOUDFLARE_ACCESS_KEY_ID | Your Access Key |
| CLOUDFLARE_ACCESS_KEY_SECRET | Your Secret Key |
| CLOUDFLARE_R2_BUCKET_NAME | Your Bucket Name |
| DATABASE_URL | Your PostgreSQL URL |
| JWT_SECRET | Your secret key |

5. Click **Save Changes**
6. Render will auto-redeploy

## Using Locally (.env file)

Create a `.env` file in your project root:

```env
CLOUDFLARE_ACCOUNT_ID=abc123def456789
CLOUDFLARE_ACCESS_KEY_ID=3d4b5c6d7e8f9g0h1i2j3k4l
CLOUDFLARE_ACCESS_KEY_SECRET=x1y2z3a4b5c6d7e8f9g0h1i2j3k4l5m6n7o8p9q0r1s2t3u4v5w6x7y8z
CLOUDFLARE_R2_BUCKET_NAME=sagar-transport-images

DATABASE_URL=postgresql://user:pass@localhost:5432/sagartransport
JWT_SECRET=your-secret-key-here
```

Then run:
```bash
npm install
npm start
```

## Optional: Custom Domain for Images

If you want images to load from your own domain instead of Cloudflare R2 URL:

1. In R2 bucket → **Settings**
2. Look for **Custom Domains**
3. Click **Connect Domain**
4. Enter your domain (e.g., `images.yoursite.com`)
5. Follow DNS setup instructions
6. Add to `.env`:
   ```
   CLOUDFLARE_R2_PUBLIC_URL=https://images.yoursite.com
   ```

## Security Notes

⚠️ **NEVER:**
- Share your `CLOUDFLARE_ACCESS_KEY_SECRET`
- Commit `.env` file to Git
- Post credentials in public chat/forums

✅ **DO:**
- Use environment variables in production
- Rotate credentials if leaked
- Use `.gitignore` to hide `.env` file

## Troubleshooting

**Q: Can't find R2 in Cloudflare Dashboard?**
- A: Click your account → **Workers & Pages** → **R2**

**Q: Where's my Account ID?**
- A: In R2 → Go to any bucket → Look at the URL

**Q: API Token not working?**
- A: Make sure you selected **Edit** permission (not Read Only)

**Q: How much does R2 cost?**
- A: Free tier: 10GB storage free per month
- Only pay for storage if you exceed 10GB

## File Locations

After setup, all images will be stored at:
```
https://[bucket-name].[account-id].r2.cloudflarestorage.com/[name]/[filename].jpg
```

Example:
```
https://sagar-transport-images.abc123def456.r2.cloudflarestorage.com/site-a/vehicle_photo.jpg
```

## Need Help?

- Cloudflare R2 Docs: https://developers.cloudflare.com/r2/
- Cloudflare Support: https://support.cloudflare.com/
- Check app logs: `npm start` shows connection status

---

Once you have all 4 details, your app is ready to:
✅ Upload images to Cloudflare R2
✅ Store URLs in PostgreSQL
✅ Serve images globally via CDN
