const fs = require("fs");
const path = require("path");
const http = require("http");
const { google } = require("googleapis");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadClientConfig() {
  const explicitPath = process.env.GOOGLE_OAUTH_CLIENT_PATH;
  const fallbackPath = path.join(__dirname, "..", "google-oauth-client.json");
  const filePath = explicitPath || fallbackPath;
  const payload = readJson(filePath);
  const root = payload.installed || payload.web || payload;
  if (!root.client_id || !root.client_secret) {
    throw new Error("Invalid OAuth client JSON");
  }
  return {
    clientId: root.client_id,
    clientSecret: root.client_secret
  };
}

async function main() {
  const port = Number(process.env.GOOGLE_OAUTH_PORT || 3010);
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const { clientId, clientSecret } = loadClientConfig();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive"]
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400);
        res.end("Missing code");
        return;
      }

      const { tokens } = await oauth2Client.getToken(code);
      const outputPath = path.join(__dirname, "..", "oauth-token-result.json");
      fs.writeFileSync(outputPath, JSON.stringify({
        clientId,
        clientSecret,
        redirectUri,
        refreshToken: tokens.refresh_token || "",
        accessToken: tokens.access_token || "",
        expiryDate: tokens.expiry_date || null
      }, null, 2));

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Authorization successful. You can return to Codex now.");
      console.log(`Refresh token saved to ${outputPath}`);
      if (!tokens.refresh_token) {
        console.log("No refresh token returned. Revoke app access in Google account and try again.");
      }
      setTimeout(() => {
        server.close(() => process.exit(0));
      }, 250);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Authorization failed. Check Codex output.");
      console.error(error.message || error);
      setTimeout(() => {
        server.close(() => process.exit(1));
      }, 250);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Open this URL in your browser:\n${authUrl}`);
    console.log(`Waiting for Google callback on ${redirectUri}`);
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
