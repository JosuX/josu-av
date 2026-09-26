import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme";
import { Nav } from "@/components/nav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AV Control",
  description: "Start and monitor MediaMTX and FFmpeg for the assembly stream",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col antialiased">
        <ThemeProvider>
          <TooltipProvider>
            <Nav />
            <main className="mx-auto w-full max-w-[120rem] flex-1 px-3 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6">{children}</main>
            <Toaster
              richColors
              position="bottom-right"
              mobileOffset={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
            />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
