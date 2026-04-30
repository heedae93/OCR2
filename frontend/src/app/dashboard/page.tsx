'use client'

import Sidebar from '@/components/Sidebar'
import Dashboard from '@/components/Dashboard'

export default function HomePage() {
  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen">
      <Sidebar />

      <main className="flex-1 ml-64 mt-14 p-6">
        <Dashboard />
      </main>
    </div>
  )
}
