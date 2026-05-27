import Sidebar from "@/components/Sidebar";

export default function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-text-primary-light dark:bg-slate-50 dark:text-text-primary-dark">
      <Sidebar />
      {children}
    </div>
  );
}
