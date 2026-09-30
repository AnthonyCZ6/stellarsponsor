import type { NextConfig } from "next";

// La dApp es 100 % cliente (lee y escribe en Stellar desde el navegador), así que se exporta
// como sitio estático en `out/`, listo para GitHub Pages o cualquier hosting estático.
// En Pages el sitio vive bajo /<repositorio>: el workflow define PAGES_BASE_PATH.
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath,
  images: { unoptimized: true },
};

export default nextConfig;
