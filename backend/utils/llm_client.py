import json
import logging
import requests
from typing import Dict, List, Tuple

from config import Config
from utils.web_search import search_web_for_quote

logger = logging.getLogger(__name__)

def call_ollama(prompt: str, json_format: bool = False) -> str:
    if not Config.LLM_ENABLED:
        return ""
        
    url = f"{Config.LLM_API_URL.rstrip('/')}/api/generate"
    payload = {
        "model": Config.LLM_MODEL_NAME,
        "prompt": prompt,
        "stream": False
    }
    if json_format:
        payload["format"] = "json"
        
    try:
        response = requests.post(url, json=payload, timeout=120)
        response.raise_for_status()
        result = response.json()
        return result.get("response", "")
    except Exception as e:
        logger.error(f"Ollama API request failed: {e}")
        return ""

def process_document_with_llm(full_text: str) -> Tuple[str, str]:
    """
    Returns (summary_text, citations_json_str)
    """
    if not full_text or len(full_text.strip()) < 10:
        return "", "[]"
        
    logger.info("Generating summary via LLM...")
    # 1. 요약 생성
    summary_prompt = f"""다음 문서를 읽고 핵심 내용을 3~5줄로 자연스럽게 요약해 주세요.
불필요한 인사말 없이 요약된 결과물만 출력하세요.

문서 내용:
{full_text}"""
    summary = call_ollama(summary_prompt).strip()
    
    logger.info("Extracting citations via LLM...")
    # 2. 인용문 추출
    citation_prompt = f"""다음 문서에서 쌍따옴표나 인용 부호로 둘러싸인 중요한 '인용문', 명언, 참조 문구를 찾아주세요.
반드시 JSON 배열 형태로만 반환해야 하며 다른 설명은 적지 마세요. 인용문이 없으면 [] 을 반환하세요.
형식: [ {{"quote": "인용문 내용"}} ]

문서 내용:
{full_text}"""

    citations_json_str = call_ollama(citation_prompt, json_format=True)
    citations_data = []
    try:
        if citations_json_str:
            # LLM이 텍스트로 감싸서 주는 경우 방어 코드
            clean_str = citations_json_str.strip()
            if clean_str.startswith("```json"):
                clean_str = clean_str[7:]
            if clean_str.endswith("```"):
                clean_str = clean_str[:-3]
            clean_str = clean_str.strip()
            if clean_str:
                citations_data = json.loads(clean_str)
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse citations JSON: {e} | Raw: {citations_json_str}")
        
    # 3. 인용문 출처 웹 검색 및 결합
    final_citations = []
    if isinstance(citations_data, list):
        for item in citations_data:
            if not isinstance(item, dict):
                continue
            quote = item.get("quote", "")
            if not quote or len(quote) < 5:
                continue
                
            logger.info(f"Searching web for quote: {quote[:20]}...")
            search_results = search_web_for_quote(quote)
            
            if search_results:
                # LLM에게 검색 결과를 주고 출처를 판단하게 함
                eval_prompt = f"""다음 인용문의 출처를 제시된 웹 검색 결과를 바탕으로 판단하세요.

인용문: "{quote}"

웹 검색 결과 (JSON):
{json.dumps(search_results, ensure_ascii=False, indent=2)}

위 결과를 종합하여 이 인용문이 어디서 유래했는지(어떤 책, 기사, 저자 등) 출처를 한 문장으로 간결하게 작성하세요.
불필요한 설명 없이 출처 정보만 출력하세요."""
                
                source = call_ollama(eval_prompt).strip()
                final_citations.append({
                    "quote": quote,
                    "source": source,
                    "web_links": [r["href"] for r in search_results]
                })
            else:
                final_citations.append({
                    "quote": quote,
                    "source": "검색된 웹 출처를 찾을 수 없습니다.",
                    "web_links": []
                })

    return summary, json.dumps(final_citations, ensure_ascii=False)
