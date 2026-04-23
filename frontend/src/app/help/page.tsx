import Sidebar from '@/components/Sidebar'

export default function HelpPage() {
  return (
    <div className="bg-background-light dark:bg-background-dark min-h-screen">
      <Sidebar />

      <main className="flex-1 ml-64 p-6 lg:p-10">
        <div className="w-full max-w-7xl mx-auto">
          <div className="flex flex-wrap justify-between gap-4 mb-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-text-primary-light dark:text-text-primary-dark text-3xl font-bold leading-tight tracking-tight">
                도움말
              </h1>
              <p className="text-text-secondary-light dark:text-text-secondary-dark text-base font-normal leading-normal">
                AI Doc Intelligence 사용 가이드
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark shadow-sm p-6">
              <h2 className="text-text-primary-light dark:text-text-primary-dark text-xl font-bold mb-4">
                시작하기
              </h2>
              <div className="space-y-4 text-text-secondary-light dark:text-text-secondary-dark">
                <p>
                  AI Doc Intelligence는 강력한 다국어 OCR을 사용하여 이미지나 PDF 파일을 검색 가능한 PDF로 변환합니다.
                </p>
                <ol className="list-decimal list-inside space-y-2">
                  <li>대시보드에서 파일을 드래그 앤 드롭하거나 찾아보기로 업로드하세요.</li>
                  <li>자동으로 OCR 처리가 시작되며 진행 상황을 실시간으로 확인할 수 있습니다.</li>
                  <li>처리가 완료되면 검색 가능한 PDF를 다운로드하거나 편집할 수 있습니다.</li>
                </ol>
              </div>
            </div>

            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark shadow-sm p-6">
              <h2 className="text-text-primary-light dark:text-text-primary-dark text-xl font-bold mb-4">
                주요 기능
              </h2>
              <div className="space-y-4">
                <div>
                  <h3 className="text-text-primary-light dark:text-text-primary-dark font-semibold mb-2">
                    다국어 OCR
                  </h3>
                  <p className="text-text-secondary-light dark:text-text-secondary-dark">
                    한국어, 중국어, 일본어, 영어 등 다양한 언어의 텍스트를 인식합니다.
                  </p>
                </div>
                <div>
                  <h3 className="text-text-primary-light dark:text-text-primary-dark font-semibold mb-2">
                    Searchable PDF
                  </h3>
                  <p className="text-text-secondary-light dark:text-text-secondary-dark">
                    원본 이미지 위에 투명한 텍스트 레이어를 추가하여 검색 가능한 PDF를 생성합니다.
                  </p>
                </div>
                <div>
                  <h3 className="text-text-primary-light dark:text-text-primary-dark font-semibold mb-2">
                    멀티 컬럼 검출
                  </h3>
                  <p className="text-text-secondary-light dark:text-text-secondary-dark">
                    자동으로 다단 레이아웃을 감지하여 올바른 읽기 순서를 적용합니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-border-dark shadow-sm p-6">
              <h2 className="text-text-primary-light dark:text-text-primary-dark text-xl font-bold mb-4">
                지원 형식
              </h2>
              <div className="text-text-secondary-light dark:text-text-secondary-dark">
                <ul className="list-disc list-inside space-y-2">
                  <li>PDF 파일 (.pdf)</li>
                  <li>이미지 파일 (.png, .jpg, .jpeg)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
