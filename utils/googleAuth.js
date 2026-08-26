import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL,
);

export const createGoogleOAuthState = () => {
  return crypto.randomBytes(32).toString("hex");
};

export const getGoogleAuthUrl = (state) => {
  return googleClient.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
    state,
  });
};

export const exchangeGoogleCode = async (code) => {
  const { tokens } = await googleClient.getToken(code);

  if (!tokens.id_token) {
    throw new Error("Google did not return an ID token.");
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!payload?.sub || !payload?.email) {
    throw new Error("Invalid Google account information.");
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || "Google User",
    emailVerified: payload.email_verified === true,
  };
};