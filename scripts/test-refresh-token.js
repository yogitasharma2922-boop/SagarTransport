const { google } = require('googleapis');

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.error('Missing one of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN');
    process.exit(2);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  try {
    // Attempt to obtain a fresh access token using the refresh token
    const token = await oauth2Client.getAccessToken();
    if (token && token.token) {
      console.log('REFRESH_OK');
      process.exit(0);
    }
    console.error('No access token returned', token);
    process.exit(3);
  } catch (err) {
    // Print a concise error message (do NOT print secrets)
    console.error('ERROR', (err && err.message) || err);
    process.exit(1);
  }
}

main();
