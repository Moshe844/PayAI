import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright", "playwright-core", "pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
