'use client'

import Sidebar from '@/components/Sidebar'
import Dashboard from '@/components/Dashboard'

export default function HomePage() {
  return (
    <div className="bg-slate-50 dark:bg-slate-50 min-h-screen">
      <Sidebar />

      <main className="flex-1 ml-64 p-6">
        <Dashboard />
      </main>
    </div>
  )
}
