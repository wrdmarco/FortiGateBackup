export const sessionCookieName = "fgbp_session";
export const breakGlassCookieName = "fgbp_break_glass_settings";
export const sessionMaxAgeSeconds = 60 * 60 * 24 * 14;
export const breakGlassMaxAgeSeconds = 60 * 15;
export const sessionRefreshThresholdMs = 1000 * 60 * 60 * 24 * 7;

export function sessionExpiresAt() {
  return new Date(Date.now() + sessionMaxAgeSeconds * 1000);
}

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureSessionCookie(),
    path: "/",
    maxAge: sessionMaxAgeSeconds,
    ...(expires ? { expires } : {})
  };
}

export function breakGlassCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureSessionCookie(),
    path: "/",
    maxAge: breakGlassMaxAgeSeconds,
    ...(expires ? { expires } : {})
  };
}

function shouldUseSecureSessionCookie() {
  if (process.env.NODE_ENV !== "production") return false;
  const serverUrl = process.env.SERVER_URL?.toLowerCase() ?? "";
  if (serverUrl.startsWith("http://")) return false;
  return true;
}
