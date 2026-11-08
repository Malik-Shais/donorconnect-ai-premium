import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DonorConnect AI Premium",
    short_name: "DonorConnect",
    description: "Blood donor coordination with consent-based contact sharing.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf6f1",
    theme_color: "#7a1630",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
