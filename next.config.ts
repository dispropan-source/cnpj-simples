import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera um site 100% estático (pasta `out/`) para hospedagem simples (Hostinger).
  output: "export",
  // Export estático não usa o otimizador de imagens do servidor.
  images: { unoptimized: true },
  // URLs com barra final geram uma pasta por rota — mais amigável em hospedagem estática.
  trailingSlash: true,
};

export default nextConfig;
