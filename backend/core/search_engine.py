from opensearchpy import OpenSearch
from config import Config  # 방금 수정한 그 config.py입니다.
import logging

# 로그 설정 (문제가 생겼을 때 확인하기 위함)
logger = logging.getLogger(__name__)

class SearchEngine:
    def __init__(self):
        # 1. Config 클래스에 정의한 설정값들을 가져옵니다.
        self.host = Config.OS_HOST
        self.port = Config.OS_PORT
        self.auth = (Config.OS_USER, Config.OS_PASS)
        self.index_name = Config.OS_INDEX_NAME

        # 2. OpenSearch 클라이언트 연결
        self.client = OpenSearch(
            hosts=[{'host': self.host, 'port': self.port}],
            http_auth=self.auth,
            use_ssl=False,  # 로컬 도커 환경이므로 False
            verify_certs=False,
            http_compress=True
        )

    def create_index_if_not_exists(self):
        """인덱스가 없으면 한글 분석기 설정과 함께 생성"""
        if not self.client.indices.exists(index=self.index_name):
            settings = {
                "settings": {
                    "index": {
                        "analysis": {
                            "analyzer": {
                                "korean_analyzer": {
                                    "tokenizer": "nori_tokenizer"
                                }
                            }
                        }
                    }
                },
                "mappings": {
                    "properties": {
                        "job_id": {"type": "keyword"},
                        "session_id": {"type": "keyword"},
                        "filename": {"type": "text", "analyzer": "korean_analyzer", "fields": {"keyword": {"type": "keyword"}}},
                        "text": {"type": "text", "analyzer": "korean_analyzer"},
                        "summary": {"type": "text", "analyzer": "korean_analyzer"},
                        "keywords": {"type": "keyword"},
                        "created_at": {"type": "date", "format": "yyyy-MM-dd HH:mm:ss"}
                    }
                }
            }
            self.client.indices.create(index=self.index_name, body=settings)
            logger.info(f"인덱스 '{self.index_name}' 생성 완료 (한글 nori 분석기 적용)")

    def add_document(self, job_id, text, summary, keywords, session_id=None, filename=None):
        """OCR 및 EXAONE 결과를 저장"""
        from datetime import datetime
        body = {
            "job_id": job_id,
            "session_id": session_id or "",
            "filename": filename or "",
            "text": text,
            "summary": summary,
            "keywords": keywords,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        try:
            return self.client.index(
                index=self.index_name,
                body=body,
                id=job_id,
                refresh=True
            )
        except Exception as e:
            logger.error(f"OpenSearch add_document 실패 (job_id={job_id}): {e}")
            return None

    def search(self, query_text: str, size: int = 10, from_: int = 0) -> dict:
        """키워드 검색 (페이지네이션 + 하이라이트 포함)"""
        query = {
            "from": from_,
            "size": size,
            "query": {
                "bool": {
                    "should": [
                        {
                            "multi_match": {
                                "query": query_text,
                                "fields": ["text^1", "summary^2", "keywords^3", "filename^4"],
                                "type": "best_fields"
                            }
                        },
                        {
                            "wildcard": {
                                "filename": {
                                    "value": f"*{query_text}*",
                                    "boost": 4.0
                                }
                            }
                        },
                        {
                            "wildcard": {
                                "filename.keyword": {
                                    "value": f"*{query_text}*",
                                    "boost": 4.0
                                }
                            }
                        }
                    ],
                    "minimum_should_match": 1
                }
            },
            "highlight": {
                "fields": {
                    "text":    {"fragment_size": 150, "number_of_fragments": 2},
                    "summary": {"fragment_size": 150, "number_of_fragments": 1}
                },
                "pre_tags":  ["<mark>"],
                "post_tags": ["</mark>"]
            }
        }
        try:
            return self.client.search(index=self.index_name, body=query)
        except Exception as e:
            logger.error(f"OpenSearch search 실패: {e}")
            return {}

    def format_results(self, raw_response: dict) -> dict:
        """OpenSearch 원본 응답을 프론트엔드에서 쓰기 편한 형태로 가공"""
        hits = raw_response.get("hits", {})
        total = hits.get("total", {}).get("value", 0)
        results = []

        for hit in hits.get("hits", []):
            source = hit.get("_source", {})
            highlights = hit.get("highlight", {})

            # 하이라이트된 발췌문 생성: text > summary 순으로 시도
            if highlights.get("text"):
                snippet = " ... ".join(highlights["text"])
            elif highlights.get("summary"):
                snippet = " ... ".join(highlights["summary"])
            elif source.get("summary"):
                snippet = source["summary"][:200]
            else:
                snippet = source.get("text", "")[:200]

            results.append({
                "job_id":     source.get("job_id"),
                "session_id": source.get("session_id", ""),
                "filename":   source.get("filename", ""),
                "score":      round(hit.get("_score", 0), 3),
                "snippet":    snippet,
                "summary":    source.get("summary", ""),
                "keywords":   source.get("keywords", []),
                "created_at": source.get("created_at"),
            })

        return {
            "total":   total,
            "results": results,
        }

    def delete_document(self, job_id: str) -> bool:
        """문서 삭제 (PDF 삭제 시 OpenSearch에서도 제거)"""
        try:
            self.client.delete(index=self.index_name, id=job_id, refresh=True)
            logger.info(f"OpenSearch 문서 삭제 완료 (job_id={job_id})")
            return True
        except Exception as e:
            logger.warning(f"OpenSearch 문서 삭제 실패 (job_id={job_id}): {e}")
            return False


# 전역 객체로 생성하여 어디서든 공유
search_engine = SearchEngine()