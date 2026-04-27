import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { OcrActivityProvider } from '@/contexts/OcrActivityContext'

export const metadata: Metadata = {
  title: 'AI Doc Intelligence',
  description: 'Powerful multilingual OCR with searchable PDF generation',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap"
        />
      </head>
      <body>
        <ThemeProvider>
          <OcrActivityProvider>
            {children}
          </OcrActivityProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
