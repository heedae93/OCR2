'use client'

import Sidebar from '@/components/Sidebar'
import Dashboard from '@/components/Dashboard'

export default function HomePage() {
  return (
    <div className="bg-slate-50 dark:bg-slate-50 min-h-screen">
      <Sidebar />

      <main className="ml-64 flex-1 min-w-0 p-6 pb-24 lg:p-10 lg:pb-28">
        <Dashboard />
      </main>
    </div>
  )
}
