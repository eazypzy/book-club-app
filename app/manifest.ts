import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Book Club",
    short_name: "Book Club",
    description: "Read together. Stay on pace.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fbf8f1",
    theme_color: "#fbf8f1",
    icons: [
      { src: "/icon.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" }
    ]
  };
}
