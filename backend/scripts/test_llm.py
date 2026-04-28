import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from utils.llm_client import process_document_with_llm

sample_text = """
최근 인공지능 기술의 발전이 눈부시다. 여러 기업들이 치열하게 경쟁하고 있다.
샘 알트만은 "우리는 인류의 가장 강력한 도구를 만들고 있다"고 말했다.
또한, 한국 역사상 가장 위대한 명장 이순신 장군은 노량 해전에서 "나의 죽음을 적에게 알리지 말라"는 명언을 남겼다.
이러한 명언들은 오늘날에도 우리에게 큰 영감을 준다. 기술의 발전과 인간의 의지는 항상 함께 가야 한다.
"""

print("Starting LLM process...")
summary, citations = process_document_with_llm(sample_text)
print("===========================")
print("SUMMARY:")
print(summary)
print("===========================")
print("CITATIONS JSON:")
print(citations)
