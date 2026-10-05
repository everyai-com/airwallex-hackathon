import Sidebar from "@/components/lab/sidebar";

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh max-w-full flex-col overflow-hidden lg:flex-row">
      <Sidebar />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
