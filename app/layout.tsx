import "./globals.css";
import { Toaster } from "sonner";
import Link from "next/link";

export const metadata = { title: "HallBook", description: "Mobile hall booking" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
          <nav className="page-container flex items-center gap-3 py-3">
            <Link href="/" className="font-bold text-lg">HallBook</Link>
            <div className="ml-auto flex gap-3 text-sm">
              <Link href="/" className="underline">예약</Link>
              <Link href="/series" className="underline">반복예약</Link>
            </div>
          </nav>
        </header>
        <main className="page-container space-y-4 pb-24">{children}</main>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
