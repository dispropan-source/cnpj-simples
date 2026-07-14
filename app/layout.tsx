import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

const SITE_URL = "https://cnpj.dispropan.app";
const title = "CNPJ Simples — consulta em lote";
const description = "Consulte CNPJs de um arquivo CSV e identifique o enquadramento no Simples Nacional.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description,
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title,
    description,
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    images: [{ url: "/og.png", width: 1734, height: 907, alt: title }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={`${archivo.variable} ${mono.variable}`}>{children}</body></html>;
}
