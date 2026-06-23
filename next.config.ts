import type { NextConfig } from "next";

function serverUrlHost() {
  const value = process.env.SERVER_URL?.trim();
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host;
  } catch {
    throw new Error("SERVER_URL must be a valid URL or hostname.");
  }
}

const serverHost = serverUrlHost();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
      ...(serverHost ? { allowedOrigins: [serverHost] } : {})
    }
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
