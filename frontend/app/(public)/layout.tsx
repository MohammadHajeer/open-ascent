import { Footer } from "@/components/shared/footer";
import { Navbar } from "@/components/shared/navbar";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <main id="top" className="min-h-dvh overflow-x-hidden bg-background flex flex-col">
      <Navbar />
      {children}
      <Footer />
    </main>
  );
}
