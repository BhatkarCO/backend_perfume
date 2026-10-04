import crypto from "crypto";

export const issueCsrfToken = (req, res) => {
  const token = crypto.randomBytes(32).toString("hex");

  res.cookie("csrf_token", token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite:
      process.env.NODE_ENV === "production"
        ? "None"
        : "Lax",
    path: "/",
  });

  return res.status(200).json({
    csrfToken: token,
  });
};

export const requireCsrf = (req, res, next) => {
  const safeMethods = new Set([
    "GET",
    "HEAD",
    "OPTIONS",
  ]);

  if (safeMethods.has(req.method)) {
    return next();
  }

  const cookieToken = req.cookies.csrf_token;
  const headerToken = req.headers["x-csrf-token"];

  if (!cookieToken || !headerToken) {
    return res.status(403).json({
      message: "CSRF validation failed.",
    });
  }

  const cookieBuffer = Buffer.from(String(cookieToken));
  const headerBuffer = Buffer.from(String(headerToken));

  if (
    cookieBuffer.length !== headerBuffer.length ||
    !crypto.timingSafeEqual(
      cookieBuffer,
      headerBuffer,
    )
  ) {
    return res.status(403).json({
      message: "CSRF validation failed.",
    });
  }

  next();
};