import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Ads are drawn with bundled open fonts read from node_modules at runtime
  // (src/lib/creative/render/fonts.ts). The path is computed, so tracing can't
  // see it: include the six woff files in every server function that may render.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@fontsource/inter/files/inter-latin-{400,600,700}-normal.woff",
      "./node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-{400,600,700}-normal.woff",
      // C7-2: latin-ext beside each Latin file, for the next Latin-script languages.
      "./node_modules/@fontsource/inter/files/inter-latin-ext-{400,600,700}-normal.woff",
      "./node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-ext-{400,600,700}-normal.woff",
    ],
  },
  partialPrefetching: true,
  experimental: {
    // F-10: a logo PNG may be 1 MB, and the upload's multipart framing adds a little (the default limit is 1 MB).
    serverActions: { bodySizeLimit: "1100kb" },
  },
  turbopack: {
    rules: {
      // Tailwind only processes the global stylesheet; CSS modules are left to Next.
      "*globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
