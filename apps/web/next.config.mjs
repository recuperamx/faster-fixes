import { createMDX } from "fumadocs-mdx/next";

// RECUPERA FORK PATCH: upstream hardcodes its own R2 public hostname in
// `images.remotePatterns`, so a self-hosted instance pointed at a different
// bucket gets its screenshots rejected by next/image. Derive the allowed host
// from NEXT_PUBLIC_STORAGE_BASE_URL instead.
const storageRemotePattern = (() => {
  const baseUrl = process.env.NEXT_PUBLIC_STORAGE_BASE_URL;
  if (!baseUrl) return [];
  try {
    const { protocol, hostname } = new URL(baseUrl);
    return [{ protocol: protocol.replace(":", ""), hostname }];
  } catch {
    return [];
  }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@workspace/ui"],
  typedRoutes: true,

  experimental: {
    authInterrupts: true,
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },

  images: {
    // Optimize image formats for better performance
    formats: ["image/avif", "image/webp"],
    // Configure quality levels for different use cases
    qualities: [25, 50, 75, 90],
    // Responsive device sizes for srcset generation
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    // Additional image sizes for smaller images
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Longer cache TTL for production performance
    minimumCacheTTL: 31536000, // 1 year
    remotePatterns: [
      // Self-hosted object store, derived from NEXT_PUBLIC_STORAGE_BASE_URL
      ...storageRemotePattern,

      // Google profile pictures
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },

      // S3 buckets
      {
        protocol: "https",
        hostname: "readyjs-dev.s3.eu-west-3.amazonaws.com",
      },

      // R2 bucket
      {
        protocol: "https",
        hostname: "pub-c5726c6e6e084e2eb959739e0af1646a.r2.dev",
      },

      // for testing
      {
        protocol: "https",
        hostname: "loremflickr.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "cdn.jsdelivr.net",
      },
    ],
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
