import { Nav } from "@/components/nav";
import { Toaster } from "@/components/ui/sonner";

// Operator pages: navigation and toasts. The viewer page (/watch) has neither.
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-[120rem] flex-1 px-3 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
        {children}
      </main>
      <Toaster
        richColors
        position="bottom-right"
        mobileOffset={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
      />
    </>
  );
}
