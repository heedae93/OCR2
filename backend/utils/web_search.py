import logging
from typing import List, Dict

try:
    from duckduckgo_search import DDGS
except ImportError:
    DDGS = None

logger = logging.getLogger(__name__)

def search_web_for_quote(quote: str, max_results: int = 3) -> List[Dict]:
    """Search DuckDuckGo for the origin of a quote."""
    if DDGS is None:
        logger.error("duckduckgo-search is not installed")
        return []
        
    try:
        results = []
        with DDGS() as ddgs:
            # 약간 긴 문구는 따옴표를 쳐서 정확도 향상, 너무 길면 따옴표 생략
            query = f'"{quote}"' if len(quote) < 50 else quote
            ddgs_results = ddgs.text(query, max_results=max_results)
            
            if not ddgs_results:
                # 결과가 없으면 따옴표 없이 다시 검색
                ddgs_results = ddgs.text(quote, max_results=max_results)
                
            for r in ddgs_results:
                results.append({
                    "title": r.get("title", ""),
                    "href": r.get("href", ""),
                    "body": r.get("body", "")
                })
        return results
    except Exception as e:
        logger.error(f"Web search failed for quote '{quote}': {e}")
        return []
