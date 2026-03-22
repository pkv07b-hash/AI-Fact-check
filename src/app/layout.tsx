import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AXIOM.NULL | AI Fact-Checking Engine",
  description: "Neural-linked fact extraction. Cross-referencing 14.2B data points for sub-atomic truth detection.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200;400;700;800&family=Inter:wght@300;400;600&display=swap" rel="stylesheet"/>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
        <script id="tailwind-config" dangerouslySetInnerHTML={{
          __html: `
            tailwind.config = {
              darkMode: "class",
              theme: {
                extend: {
                  colors: {
                    "inverse-on-surface": "#263046",
                    "secondary-fixed-dim": "#b8c8da",
                    "on-error-container": "#ffdad6",
                    "on-background": "#d7e2ff",
                    "secondary-container": "#394857",
                    "background": "#071327",
                    "surface-variant": "#2a354b",
                    "primary-fixed-dim": "#b7c4ff",
                    "primary-fixed": "#dde1ff",
                    "on-error": "#690005",
                    "surface-bright": "#2e394f",
                    "primary-container": "#00134f",
                    "error-container": "#93000a",
                    "surface-container-lowest": "#030e22",
                    "outline": "#8e9196",
                    "on-surface-variant": "#c4c6cc",
                    "on-surface": "#d7e2ff",
                    "surface-container": "#142034",
                    "surface-container-highest": "#2a354b",
                    "primary": "#b7c4ff",
                    "on-primary": "#002682",
                    "surface-container-high": "#1f2a3f",
                    "on-primary-container": "#5378ff",
                    "inverse-surface": "#d7e2ff",
                    "outline-variant": "#44474c",
                    "secondary": "#b8c8da",
                    "surface-container-low": "#101b30",
                    "surface": "#071327",
                    "error": "#ffb4ab",
                    "on-primary-fixed-variant": "#0038b6",
                    "tertiary": "#c6c7c3",
                    "tertiary-container": "#181b19",
                  },
                  fontFamily: {
                    "headline": ["Manrope"],
                    "body": ["Inter"],
                    "label": ["Inter"]
                  },
                  borderRadius: {
                    "DEFAULT": "0px",
                    "lg": "0px",
                    "xl": "0px",
                    "full": "9999px"
                  },
                },
              },
            }
          `
        }} />
        <style dangerouslySetInnerHTML={{__html: `
          body {
            background-color: #071327;
            background-image: radial-gradient(#1f2a3f 1px, transparent 1px);
            background-size: 32px 32px;
            min-height: max(884px, 100dvh);
          }
          .asymmetric-tilt-left { transform: rotate(-2deg); }
          .asymmetric-tilt-right { transform: rotate(1.5deg); }
          .glass-panel {
            background: rgba(31, 42, 63, 0.4);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(183, 196, 255, 0.1);
          }
          .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
          }
          .truth-meter-bg {
            min-width: 4px;
            background: linear-gradient(90deg, #001452 0%, #b7c4ff 100%);
            box-shadow: 0 0 12px rgba(183, 196, 255, 0.35);
          }
          ::-webkit-scrollbar { width: 4px; height: 4px; }
          ::-webkit-scrollbar-track { background: #030e22; }
          ::-webkit-scrollbar-thumb { background: #44474c; }
          ::-webkit-scrollbar-thumb:hover { background: #b7c4ff; }
        `}} />
      </head>
      <body className="font-body text-on-surface selection:bg-primary selection:text-on-primary min-h-screen pb-24 md:pb-0">
        {children}
      </body>
    </html>
  );
}
