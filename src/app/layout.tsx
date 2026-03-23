import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AXIOM.NULL | Intelligence for Truth Verification",
  description: "Neural-linked fact extraction. Cross-referencing 14.2B data points for sub-atomic truth detection.",
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
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
                    "background": "var(--background)",
                    "surface": "var(--surface)",
                    "surface-variant": "var(--surface-variant)",
                    "surface-container-lowest": "var(--surface-container-lowest)",
                    "surface-container-low": "var(--surface-container-low)",
                    "surface-container": "var(--surface-container)",
                    "surface-container-high": "var(--surface-container-high)",
                    "surface-container-highest": "var(--surface-container-highest)",
                    "on-surface": "var(--on-surface)",
                    "on-surface-variant": "var(--on-surface-variant)",
                    "primary": "var(--primary)",
                    "on-primary": "var(--on-primary)",
                    "primary-container": "var(--primary-container)",
                    "on-primary-container": "var(--on-primary-container)",
                    "outline": "var(--outline)",
                    "outline-variant": "var(--outline-variant)",
                    "error": "var(--error)",
                    "error-container": "var(--error-container)",
                    "secondary": "var(--secondary)",
                  },
                  fontFamily: {
                    "headline": ["Manrope"],
                    "body": ["Inter"],
                    "label": ["Inter"]
                  },
                  borderRadius: { "DEFAULT": "8px", "lg": "12px", "xl": "16px", "2xl": "24px", "full": "9999px" },
                  boxShadow: {
                    "glow": "0 0 25px var(--glow)",
                    "glow-lg": "0 0 40px var(--glow)",
                    "panel": "0 10px 40px var(--panel-shadow)",
                  }
                },
              },
            }
          `
        }} />
        <style dangerouslySetInnerHTML={{__html: `
          :root {
            /* Dark Theme (Default) */
            --background: #071327;
            --surface: #071327;
            --surface-variant: #2a354b;
            --surface-container-lowest: #030e22;
            --surface-container-low: #101b30;
            --surface-container: #142034;
            --surface-container-high: #1f2a3f;
            --surface-container-highest: #2a354b;
            --on-surface: #d7e2ff;
            --on-surface-variant: #c4c6cc;
            --primary: #b7c4ff;
            --on-primary: #002682;
            --primary-container: #00134f;
            --on-primary-container: #5378ff;
            --outline: #8e9196;
            --outline-variant: #44474c;
            --error: #ffb4ab;
            --error-container: #93000a;
            --secondary: #b8c8da;
            --glow: rgba(183, 196, 255, 0.3);
            --panel-shadow: rgba(0, 0, 0, 0.5);
          }
          
          .light {
            /* Light Theme - Barely-there warm tint */
            --background: #fefcf9;
            --surface: #ffffff;
            --surface-variant: #f0ede8;
            --surface-container-lowest: #ffffff;
            --surface-container-low: #fdfaf6;
            --surface-container: #f8f5f0;
            --surface-container-high: #f2ede6;
            --surface-container-highest: #ebe5dc;
            --on-surface: #1a1208;
            --on-surface-variant: #504840;
            --primary: #5b21b6;
            --on-primary: #ffffff;
            --primary-container: #ede9fe;
            --on-primary-container: #3b0764;
            --outline: #9c9690;
            --outline-variant: #dbd8d2;
            --error: #dc2626;
            --error-container: #fee2e2;
            --secondary: #6b5e4e;
            --glow: rgba(91, 33, 182, 0.2);
            --panel-shadow: rgba(60, 40, 10, 0.07);
          }

          body {
            background-color: var(--background);
            background-image: radial-gradient(var(--surface-container-high) 1px, transparent 1px);
            background-size: 32px 32px;
            min-height: max(884px, 100dvh);
            transition: background-color 0.3s ease, color 0.3s ease;
          }
          .asymmetric-tilt-left { transform: rotate(-2deg); }
          .asymmetric-tilt-right { transform: rotate(1.5deg); }
          .glass-panel {
            background: rgba(31, 42, 63, 0.4);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(183, 196, 255, 0.1);
          }
          .truth-meter-bg {
            min-width: 4px;
            background: linear-gradient(90deg, var(--primary-container) 0%, var(--primary) 100%);
            box-shadow: 0 0 12px rgba(183, 196, 255, 0.35);
          }
          ::-webkit-scrollbar { width: 4px; height: 4px; }
          ::-webkit-scrollbar-track { background: var(--surface-container-lowest); }
          ::-webkit-scrollbar-thumb { background: var(--outline-variant); }
          ::-webkit-scrollbar-thumb:hover { background: var(--primary); }
        `}} />
      </head>
      <body className="font-body text-on-surface selection:bg-primary selection:text-on-primary min-h-screen pb-24 md:pb-0">
        {children}
      </body>
    </html>
  );
}
