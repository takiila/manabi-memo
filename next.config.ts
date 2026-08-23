import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "@aws-sdk/client-s3"],
};

export default nextConfig;
