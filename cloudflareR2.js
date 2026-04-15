const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} = require("@aws-sdk/client-s3");

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CLOUDFLARE_ACCESS_KEY_ID = process.env.CLOUDFLARE_ACCESS_KEY_ID || "";
const CLOUDFLARE_ACCESS_KEY_SECRET = process.env.CLOUDFLARE_ACCESS_KEY_SECRET || "";
const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || "";
const CLOUDFLARE_R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL || "";
const USE_CLOUDFLARE_R2 = Boolean(
  CLOUDFLARE_ACCOUNT_ID &&
    CLOUDFLARE_ACCESS_KEY_ID &&
    CLOUDFLARE_ACCESS_KEY_SECRET &&
    CLOUDFLARE_R2_BUCKET_NAME
);

let s3Client = null;

if (USE_CLOUDFLARE_R2) {
  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: CLOUDFLARE_ACCESS_KEY_ID,
      secretAccessKey: CLOUDFLARE_ACCESS_KEY_SECRET
    }
  });
  console.log("Cloudflare R2 initialized");
}

/**
 * Upload buffer to Cloudflare R2
 * @param {Buffer} buffer - Image buffer
 * @param {string} key - S3 key (path in bucket)
 * @param {string} contentType - MIME type
 * @returns {Promise<{success: boolean, url: string, error?: string}>}
 */
async function uploadToR2(buffer, key, contentType = "image/jpeg") {
  try {
    if (!USE_CLOUDFLARE_R2 || !s3Client) {
      return {
        success: false,
        url: "",
        error: "Cloudflare R2 not configured"
      };
    }

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType
    });

    await s3Client.send(command);

    // Construct the public URL
    let publicUrl = "";
    if (CLOUDFLARE_R2_PUBLIC_URL) {
      // If custom domain is set, use it
      publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${key}`;
    } else {
      // Otherwise use default R2 URL
      publicUrl = `https://${CLOUDFLARE_R2_BUCKET_NAME}.${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
    }

    return {
      success: true,
      url: publicUrl
    };
  } catch (error) {
    console.error("Cloudflare R2 upload error:", error.message);
    return {
      success: false,
      url: "",
      error: error.message
    };
  }
}

/**
 * Delete object from Cloudflare R2
 * @param {string} key - S3 key (path in bucket)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteFromR2(key) {
  try {
    if (!USE_CLOUDFLARE_R2 || !s3Client) {
      return {
        success: false,
        error: "Cloudflare R2 not configured"
      };
    }

    const command = new DeleteObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: key
    });

    await s3Client.send(command);

    return {
      success: true
    };
  } catch (error) {
    console.error("Cloudflare R2 delete error:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Check if object exists in Cloudflare R2
 * @param {string} key - S3 key (path in bucket)
 * @returns {Promise<boolean>}
 */
async function existsInR2(key) {
  try {
    if (!USE_CLOUDFLARE_R2 || !s3Client) {
      return false;
    }

    const command = new HeadObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: key
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === "NotFound") {
      return false;
    }
    console.error("Cloudflare R2 exists check error:", error.message);
    return false;
  }
}

module.exports = {
  uploadToR2,
  deleteFromR2,
  existsInR2,
  USE_CLOUDFLARE_R2,
  CLOUDFLARE_R2_BUCKET_NAME,
  CLOUDFLARE_R2_PUBLIC_URL
};
