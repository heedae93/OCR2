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
                        "doc_id": {"type": "keyword"},
                        "text": {"type": "text", "analyzer": "korean_analyzer"},
                        "summary": {"type": "text", "analyzer": "korean_analyzer"},
                        "keywords": {"type": "keyword"},
                        "created_at": {"type": "date", "format": "yyyy-MM-dd HH:mm:ss"}
                    }
                }
            }
            self.client.indices.create(index=self.index_name, body=settings)
            logger.info(f"인덱스 '{self.index_name}' 생성 완료 (한글 nori 분석기 적용)")

    def add_document(self, doc_id, text, summary, keywords):
        """OCR 및 EXAONE 결과를 저장"""
        from datetime import datetime
        body = {
            "doc_id": doc_id,
            "text": text,
            "summary": summary,
            "keywords": keywords,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%mm:%ss")
        }
        return self.client.index(
            index=self.index_name,
            body=body,
            id=doc_id,
            refresh=True
        )

    def search(self, query_text):
        """키워드 검색"""
        query = {
            "query": {
                "multi_match": {
                    "query": query_text,
                    "fields": ["text", "summary", "keywords"]
                }
            }
        }
        return self.client.search(index=self.index_name, body=query)

# 전역 객체로 생성하여 어디서든 공유
search_engine = SearchEngine()