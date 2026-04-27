
import re
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

# KoBERT NER imports
try:
    from transformers import AutoTokenizer, AutoModelForTokenClassification, pipeline
    import torch
    KOBERT_NER_AVAILABLE = True
except ImportError:
    KOBERT_NER_AVAILABLE = False
    logger.warning("KoBERT NER 의존성 없음. 정규식 단독 동작.")

PII_PATTERNS = {
    "PHONE": [
        r"\b01[016789]-?\d{3,4}-?\d{4}\b",
        r"\b02-?\d{3,4}-?\d{4}\b",
        r"\b0[3-6][1-5]-?\d{3,4}-?\d{4}\b",
        r"\b070-?\d{3,4}-?\d{4}\b",
        # 전국대표번호 (1544, 1588, 1600, 1800 등)
        r"\b1[0-9]{3}-\d{4}\b",
        # 국번 없는 7자리 지역번호 (예: 305-3311, 376-5555)
        r"\b[2-9]\d{2}-\d{4}\b",
    ],
    "EMAIL": [
        r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b"
    ],
    "RRN": [
        r"\b\d{6}-?[1-4]\d{6}\b"
    ],
    "FOREIGNER_REG_NO": [
        r"\b\d{6}-?[5-8]\d{6}\b"
    ],
    "BUSINESS_REG_NO": [
        r"\b\d{3}-\d{2}-\d{5}\b"
    ],
    "ACCOUNT_NO": [
        r"\b(?!01[016789]|02-|070)\d{4,6}-\d{2,6}-\d{4,7}\b",
        r"\b\d{3,4}-\d{3,4}-\d{4}-\d{2}\b",
        # 은행명 + 하이픈 없는 숫자 계좌번호 (예: 케이뱅크 1001 33370105, 기업 21302612001120)
        r"(?:케이뱅크|국민|신한|우리|하나|기업|농협|씨티|SC제일|카카오뱅크|토스뱅크|수협|우체국|새마을|부산|경남|대구|전북|광주|제주|산업|기술|외환)[\s]*(\d[\d\s]{7,19}\d)",
    ],
    "HEALTH_INSURANCE_NO": [
        r"\b\d{1,2}-\d{7,10}\b"
    ],
    "CREDIT_CARD": [
        r"\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b",
    ],
    "PASSPORT_NO": [
        r"\b[A-Z]{1,2}\d{7,8}\b",
        r"\b[MSROD]\d{8}\b"
    ],
    "IP_ADDRESS": [
        r"\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b"
    ],
    "CAR_NO": [
        r"\b\d{2,3}\s?[가-힣]\s?\d{4}\b",
        r"\b[가-힣]{1,2}\s?\d{2,3}\s?[가-힣]\s?\d{4}\b",
    ],
    "ROAD_ADDRESS": [
        # 사용자의 요청에 따라 정규식으로 주소를 찾지 않고 오직 NER로만 찾습니다.
    ],
    "NAME": [
        # 레이블이 명확할 때만 정규식으로 강제 추출 (NER 보완용)
        # 한국어 이름: 레이블 뒤 2~4글자 한글
        r"(?:성\s*명|이\s*름|대\s*표\s*이\s*사|대\s*표\s*자|대\s*표|신청인|보호자|환\s*자|예\s*금\s*주|본\s*인|세\s*대\s*주)\s*[:：]?\s*([가-힣]{2,4})\b",
        # 영문 이름과 괄호로 병기된 한글 이름 (라벨 없이 강제 추출, 예: 이영희 (Lee Young-hee))
        r"([가-힣]{2,4})\s*\(\s*[A-Za-z][A-Za-z\s\-]{0,20}[A-Za-z]\s*\)",
    ],
    "ENGLISH_NAME": [
        # 한글/영문 레이블 뒤 영문 이름 (선택적으로 앞에 한글 이름과 괄호 포함)
        r"(?:성\s*명|이\s*름|대\s*표\s*이\s*사|대\s*표\s*자|대\s*표|신청인|보호자|환\s*자|예\s*금\s*주|본\s*인|세\s*대\s*주|Name|Representative|Applicant|Patient|Depositor)\s*[:：]?\s*(?:[가-힣]{2,4}\s*\(\s*)?([A-Za-z][A-Za-z\s\-]{0,20}[A-Za-z])\b(?:\s*\))?",
        # 한글 이름(2~4자) 뒤 괄호 안 영문 이름
        r"[가-힣]{2,4}\s*\(\s*([A-Za-z][A-Za-z\s\-]{0,20}[A-Za-z])\s*\)"
    ],
}

TYPE_NORMALIZE_MAP = {
    "전화번호": "PHONE", "휴대폰": "PHONE", "휴대전화": "PHONE", "핸드폰": "PHONE",
    "이메일": "EMAIL", "이메일주소": "EMAIL", "email": "EMAIL",
    "주민등록번호": "RRN", "주민번호": "RRN",
    "외국인등록번호": "FOREIGNER_REG_NO",
    "사업자등록번호": "BUSINESS_REG_NO",
    "계좌번호": "ACCOUNT_NO", "은행계좌": "ACCOUNT_NO",
    "건강보험번호": "HEALTH_INSURANCE_NO", "건강보험": "HEALTH_INSURANCE_NO",
    "신용카드번호": "CREDIT_CARD", "카드번호": "CREDIT_CARD",
    "여권번호": "PASSPORT_NO",
    "ip주소": "IP_ADDRESS", "ip": "IP_ADDRESS",
    "차량번호": "CAR_NO", "자동차번호": "CAR_NO", "차량번호판": "CAR_NO", "번호판": "CAR_NO",
    "도로명주소": "ROAD_ADDRESS", "주소": "ROAD_ADDRESS",
    "이름": "NAME", "성명": "NAME",
    "영문이름": "ENGLISH_NAME", "영어이름": "ENGLISH_NAME", "english_name": "ENGLISH_NAME",
}

ALLOWED_TYPES = {
    "PHONE", "EMAIL", "RRN", "FOREIGNER_REG_NO", "BUSINESS_REG_NO",
    "ACCOUNT_NO", "HEALTH_INSURANCE_NO", "CREDIT_CARD", "PASSPORT_NO",
    "IP_ADDRESS", "CAR_NO", "ROAD_ADDRESS", "NAME", "ENGLISH_NAME"
}

# KoBERT NER 모델 초기화
_kobert_ner_model = None
_kobert_ner_tokenizer = None

# [수정] 모델의 문맥 판단력을 100% 신뢰하도록 하한선을 높임 (오탐 차단)
KOBERT_NAME_CONFIDENCE_MIN = 0.85


def _is_valid_kobert_name(value: str, score: float) -> bool:
    if score < KOBERT_NAME_CONFIDENCE_MIN:
        return False
    # 한국어 이름: 2~4글자 한글
    if re.fullmatch(r'[가-힣]{2,4}', re.sub(r'\s+', '', value)):
        return True
    # 영문 이름: 하이픈·공백 제거 후 순수 알파벳 2자 이상
    # 허용 케이스: Hong Gil-dong / HONG GILDONG / honggildong / HongGildong
    alnum = re.sub(r'[\s\-]', '', value.strip())
    if alnum.isalpha() and len(alnum) >= 2:
        return True
    return False


def _init_kobert_ner():
    """KoBERT NER 모델 초기화 (lazy loading)"""
    global _kobert_ner_model, _kobert_ner_tokenizer
    if not KOBERT_NER_AVAILABLE:
        return False
    
    if _kobert_ner_model is None:
        try:
            model_name = "bespin-global/klue-roberta-base-ner"
            _kobert_ner_tokenizer = AutoTokenizer.from_pretrained(model_name)
            _kobert_ner_model = AutoModelForTokenClassification.from_pretrained(model_name)
            logger.info("KoBERT NER 모델 로드 완료 (bespin-global/klue-roberta-base-ner)")
        except Exception as e:
            logger.error(f"KoBERT NER 모델 로드 실패: {e}")
            return False
    return True

def _extract_with_kobert_ner(text: str) -> List[Dict[str, Any]]:
    """KoBERT NER로 개인정보 추출 (NAME, ROAD_ADDRESS)"""
    if not _init_kobert_ner():
        logger.warning("KoBERT NER 모델 사용 불가 - 빈 결과 반환")
        return []
    
    try:
        # NER 파이프라인 생성
        ner_pipeline = pipeline(
            "ner", 
            model=_kobert_ner_model, 
            tokenizer=_kobert_ner_tokenizer,
            aggregation_strategy="simple",
            device=0 if torch.cuda.is_available() else -1
        )
        
        entities = ner_pipeline(text)
        
        pii_items = []
        for entity in entities:
            entity_type = entity['entity_group']
            value = entity['word'].strip()
            
            # NER 태그를 PII 타입으로 매핑
            # 일반적인 NER 태그: PER(인물), LOC(장소), ORG(조직)
            if entity_type in ['PER', 'PERSON', 'PS']:  # 사람
                if _is_valid_kobert_name(value, entity['score']):
                    pii_items.append({
                        "type": "NAME",
                        "value": value,
                        "confidence": entity['score']
                    })
            elif entity_type in ['LOC', 'LOCATION', 'LC']:  # 장소
                # 도로명+번지 또는 지번 숫자가 있는 경우만 주소로 판정
                # "서울시", "중구" 등 행정구역 단독명은 번지 없으므로 제외
                if re.search(r'(?:로|길|동|읍|면)\s*\d+', value) or re.search(r'\d+\s*번지', value):
                    pii_items.append({
                        "type": "ROAD_ADDRESS",
                        "value": value,
                        "confidence": entity['score']
                    })
            # 필요시 다른 태그 추가 (ORG → BUSINESS_REG_NO 등)
        
        logger.info(f"[KoBERT NER] {len(pii_items)}개 추출")
        return pii_items
        
    except Exception as e:
        logger.error(f"KoBERT NER 추출 실패: {e}")
        return []

# ============================================================
# 메인 추출 함수
# ============================================================


# ============================================================
# 메인 함수: OCR pages → PII + bbox 한 번에 반환
# ============================================================

def extract_pii_from_pages(ocr_pages: list) -> list:
    """
    1차: 라인별 정규식 추출 → bbox 즉시 확정
    2차: 인접 라인 병합 후 정규식 (줄 걸침 PII 대응)
    3차: LLM 보조 추출 (NAME 등 문맥 의존형)

    반환: [{"type", "value", "page", "bbox"}, ...]
    """
    results = []

    # ── 1차: 라인별 정규식 ──────────────────────────────────
    for page in ocr_pages:
        page_num = page["page_number"]
        for line in page.get("lines", []):
            text = line.get("text", "")
            bbox = line.get("bbox")
            if not text or not bbox:
                continue

            processed = _preprocess_for_regex(text)

            for pii_type, patterns in PII_PATTERNS.items():
                for pattern in patterns:
                    for m in re.finditer(pattern, processed):
                        value = _get_match_value(m)
                        if not value:
                            continue
                            
                        # 추출된 값(value) 부분만의 정밀한 sub-bbox를 추정 (실패 시 원본 라인 bbox 사용)
                        sub_bbox = _estimate_sub_bbox(value, text, bbox) or bbox
                        results.append({
                            "type": pii_type,
                            "value": value,
                            "page": page_num,
                            "bbox": sub_bbox,
                            "_context": text,
                            "source": "정규식 (1차)"
                        })

    results = _deduplicate(results)
    logger.info(f"[1차 라인별 정규식] {len(results)}개 추출")

    # ── 2차: 인접 라인 병합 ─────────────────────────────────
    for page in ocr_pages:
        page_num = page["page_number"]
        lines = [l for l in page.get("lines", []) if l.get("text") and l.get("bbox")]

        for i in range(len(lines) - 1):
            l1, l2 = lines[i], lines[i + 1]
            # \n 구분자 사용: _preprocess_for_regex가 줄별로 처리하므로
            # 줄 경계 숫자끼리 합쳐지는 오탐 방지 (예: "84" + "123" → "84123")
            merged_text = l1["text"] + "\n" + l2["text"]
            processed = _preprocess_for_regex(merged_text)

            for pii_type, patterns in PII_PATTERNS.items():
                for pattern in patterns:
                    for m in re.finditer(pattern, processed):
                        value = _get_match_value(m)
                        if not value or _is_covered(value, pii_type, results):
                            continue
                        # 값이 어느 라인에 속하는지 먼저 확인 후 tight bbox 사용
                        # → 레이블(l1)까지 마스킹하는 문제 방지
                        # _estimate_sub_bbox는 라인 전체와 동일하면 None 반환하므로
                        # "값이 해당 라인에 존재하는가"를 별도로 판단해야 함
                        def _normalize_for_match(s):
                            s = re.sub(r'[\s\-\u2013\u2014\u2015\u2212.,]', '', str(s))
                            return s.replace('O','0').replace('o','0').replace('l','1').replace('I','1')

                        norm_val = _normalize_for_match(value)
                        if norm_val in _normalize_for_match(l1["text"]):
                            sub_bbox = _estimate_sub_bbox(value, l1["text"], l1["bbox"]) or l1["bbox"]
                        elif norm_val in _normalize_for_match(l2["text"]):
                            sub_bbox = _estimate_sub_bbox(value, l2["text"], l2["bbox"]) or l2["bbox"]
                        else:
                            # 정말 두 줄에 걸친 경우 fallback
                            sub_bbox = _merge_bboxes(l1["bbox"], l2["bbox"])
                        results.append({
                            "type": pii_type,
                            "value": value,
                            "page": page_num,
                            "bbox": sub_bbox,
                            "_context": l1["text"] + " " + l2["text"],
                            "source": "정규식 (2차 병합)"
                        })

    results = _deduplicate(results)
    logger.info(f"[2차 인접 라인 병합] 누적 {len(results)}개")

    # ── 정규식 추출 NAME 규칙 검증 ───────────────────────────
    results = _validate_regex_names(results)
    logger.info(f"[NAME 규칙 검증] 완료 후 {len(results)}개")

    # ── 3차: KoBERT NER 보조 (NAME, ROAD_ADDRESS) ────────────────────────────────
    print("\n[진행] KoBERT NER (이름/주소) 분석을 시작합니다...")
    if _init_kobert_ner():
        try:
            ner_pipeline = pipeline(
                "ner", 
                model=_kobert_ner_model, 
                tokenizer=_kobert_ner_tokenizer,
                aggregation_strategy="simple",
                device=0 if torch.cuda.is_available() else -1
            )
            
            for page in ocr_pages:
                page_num = page["page_number"]
                lines = page.get("lines", [])
                
                # 글자 수 제한 에러를 막기 위해 전체가 아닌 '한 줄씩' NER에 통과시킵니다.
                for line in lines:
                    text = line.get("text", "").strip()
                    if not text: continue
                    
                    # 512 토큰 제한을 원천 차단 (200글자까지만 자름)
                    safe_text = text[:200]
                    entities = ner_pipeline(safe_text)
                    
                    for entity in entities:
                        entity_type = entity['entity_group']
                        value = entity['word'].strip()
                        score = entity['score']
                        
                        if entity_type in ['PER', 'PERSON', 'PS']:
                            if _is_valid_kobert_name(value, score):
                                alnum = re.sub(r'[\s\-]', '', value)
                                is_english = alnum.isalpha() and not re.search(r'[가-힣]', value)
                                assigned_type = "ENGLISH_NAME" if is_english else "NAME"
                                sub_bbox = _estimate_sub_bbox(value, text, line.get("bbox")) or line.get("bbox")
                                results.append({"type": assigned_type, "value": value, "page": page_num, "bbox": sub_bbox, "source": "NER (KoBERT)"})
                                
                        elif entity_type in ['LOC', 'LOCATION', 'LC']:
                            idx = text.find(value)
                            if idx != -1:
                                # 1. 앞으로(Backward) 확장: 서울특별시, 경기도 등 행정구역이 NER 토큰에서 잘렸을 때 복원
                                prefix = text[:idx]
                                back_match = re.search(r'((?:[가-힣]+(?:도|시|군|구|읍|면|동)\s+)+)$', prefix)
                                if back_match:
                                    ext_back = back_match.group(1)
                                    value = ext_back + value
                                    idx = text.find(value)  # 위치 갱신

                                # 2. 뒤로(Forward) 확장: 세부 주소 및 (문래동3가) 같은 괄호 참조 주소 복원
                                remainder = text[idx + len(value):]
                                match = re.match(r'^[\s,.\d\-시구군읍면동층호지번길로가의A-Za-z]+(?:\s*\([가-힣A-Za-z\d\s,.-]+\))?', remainder)
                                if match:
                                    ext = match.group(0)
                                    # 확장 바로 뒤 숫자+호 패턴이 이어지면 추가 보완
                                    after = remainder[len(ext):]
                                    ho = re.match(r'^\d+\s*호', after)
                                    if ho:
                                        ext = ext + ho.group(0)
                                    value = value + ext.rstrip()

                            if re.search(r'(?:로|길|동|읍|면)\s*\d+', value) or re.search(r'\d+\s*번지', value) or re.search(r'\d+동\s*\d+호', value):
                                sub_bbox = _estimate_sub_bbox(value, text, line.get("bbox")) or line.get("bbox")
                                results.append({"type": "ROAD_ADDRESS", "value": value, "page": page_num, "bbox": sub_bbox, "source": "NER (KoBERT)"})
        except Exception as e:
            print(f"[오류] KoBERT NER 실행 중 에러: {e}")
    else:
        print("[경고] KoBERT NER 모델을 사용할 수 없습니다.")

    # 3차에서는 value+bbox 기준 중복 제거 (같은 이름이 다른 위치에 있으면 유지)
    seen = set()
    deduped_results = []
    for r in results:
        key = (r["type"], r["value"], str(r.get("bbox")))
        if key not in seen:
            seen.add(key)
            deduped_results.append(r)
    results = deduped_results

    # ── 최종 추출 결과 명확하게 터미널에 출력 (print 사용) ──
    print("\n" + "="*55)
    print("            [개인정보 추출 최종 결과]            ")
    print("="*55)
    if not results:
        print("  추출된 데이터가 없습니다.")
    for r in results:
        source = r.get("source", "UNKNOWN")
        pii_type = r.get("type", "UNKNOWN")
        val = r.get("value", "")
        print(f"  [{source:15s}] {pii_type:15s} | '{val}'")
    print("="*55 + "\n")

    # ── 4차: 독립 라인 이름 감지 (비활성화) ─────────
    # NER(3차) 도입으로 인해 오탐(False Positive)이 잦고, 
    # 허공에 뜬 텍스트는 향후 OCR 레이아웃 분석을 통해 보완할 예정이므로 비활성화합니다.
    # results = _detect_standalone_names(ocr_pages, results)
    # logger.info(f"[4차 독립라인 이름 감지] 최종 {len(results)}개")

    return results



# ============================================================
# 유틸리티
# ============================================================

def _get_match_value(m: re.Match) -> str:
    """캡처 그룹이 있으면 group(1), 없으면 group(0) 반환."""
    if m.lastindex and m.lastindex >= 1:
        return m.group(1).strip()
    return m.group(0).strip()


def _is_covered(value: str, pii_type: str, existing: list) -> bool:
    """이미 추출된 목록에 같은 타입으로 포함되어 있는지 확인."""
    def sc(s):
        return re.sub(r'[\s\-\n\r\t]', '', str(s))

    val = sc(value)
    for item in existing:
        if item["type"] != pii_type:
            continue
        ex = sc(item["value"])
        if val in ex or ex in val:
            return True
        if pii_type == "ROAD_ADDRESS" and len(val) >= 10 and len(ex) >= 10:
            if val[:10] in ex or ex[:10] in val:
                return True
    return False


def _merge_bboxes(bbox1: list, bbox2: list) -> list:
    """두 bbox를 감싸는 최소 bbox 반환."""
    if not bbox1:
        return bbox2
    if not bbox2:
        return bbox1
    return [
        min(bbox1[0], bbox2[0]),
        min(bbox1[1], bbox2[1]),
        max(bbox1[2], bbox2[2]),
        max(bbox1[3], bbox2[3]),
    ]


def _find_all_value_bboxes(value: str, lines: list) -> list:
    """LLM이 반환한 value가 등장하는 모든 라인의 bbox를 반환 (중복 위치 대응)."""
    def normalize(s):
        s = re.sub(r'[\s\-\u2013\u2014\u2015\u2212.,]', '', str(s))
        return s.replace('O', '0').replace('o', '0').replace('l', '1').replace('I', '1')

    norm_val = normalize(value)
    found = []
    for line in lines:
        orig_text = line.get("text", "")
        norm_line = normalize(orig_text)
        bbox = line.get("bbox")
        if bbox and norm_val in norm_line:
                sub_bbox = _estimate_sub_bbox(value, orig_text, bbox) or bbox
                found.append(sub_bbox)
    return found


def _deduplicate(results: list) -> list:
    """type 내에서 value가 부분 문자열 관계인 경우 중복 제거. 더 긴(완전한) 값을 유지."""
    def sc(s):
        return re.sub(r'[\s\-\n\r\t]', '', str(s))

    deduped = []
    for item in results:
        val = sc(item["value"])
        is_dup = False
        for i, existing in enumerate(deduped):
            if existing["type"] != item["type"]:
                continue
            ex = sc(existing["value"])
            if val == ex or val in ex:
                # 새 항목이 기존보다 같거나 짧음 → 기존 유지
                is_dup = True
                break
            if ex in val:
                # 새 항목이 기존보다 김 → 더 완전한 값으로 교체 (예: "...1203" → "...1203호")
                deduped[i] = item
                is_dup = True
                break
        if not is_dup:
            deduped.append(item)
    return deduped


def _validate_regex_names(results: list) -> list:
    """
    무한 블랙리스트 대신, 구조적 규칙과 AI(KoBERT) 분업을 통한 스마트 필터링.
    """
    filtered = []

    # 1. 정규식 탐지 단서로 쓴 라벨 키워드 (이 단어들은 이름 자체가 될 수 없음)
    LABEL_KEYWORDS = {"성명", "이름", "대표이사", "대표자", "대표", "신청인", "보호자", "환자", "예금주", "본인", "세대주"}

    for r in results:
        r.pop("_context", None)
        if r.get("type") == "NAME" and r.get("source", "").startswith("정규식"):
            val_clean = re.sub(r'\s+', '', r.get("value", ""))
            
            # 규칙 A: 라벨 자체를 이름으로 오인한 경우 (예: "본인 성명") 무조건 제외
            if val_clean in LABEL_KEYWORDS:
                continue
                
            # 규칙 B: 2글자 이하 단어는 정규식에서 과감히 버림 ("확인", "서명", "없음" 등 2글자 일반명사 오탐 원천 차단)
            # -> 진짜 2글자 이름(예: 허재)은 뒤이어 실행되는 3차 KoBERT NER가 문맥으로 파악하여 살려냄
            if len(val_clean) < 3:
                continue

        filtered.append(r)

    return filtered



# ============================================================
# 정규식 전처리
# ============================================================

def _fix_ocr_ip(text: str) -> str:
    """OCR로 망가진 IP 주소 복원."""
    octet_pat = r'(?:\d{1,2}\s\d{1,2}|\d{1,3})'
    sep_pat   = r'[\s.,]+'
    full_pat  = rf'\b({octet_pat}){sep_pat}({octet_pat}){sep_pat}({octet_pat}){sep_pat}({octet_pat})\b'

    def _normalize(m: re.Match) -> str:
        full = m.group(0)
        if not re.search(r'[.,]', full):
            return full
        parts = [re.sub(r'\s+', '', m.group(i)) for i in range(1, 5)]
        try:
            if all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
                return '.'.join(parts)
        except ValueError:
            pass
        return full

    return re.sub(full_pat, _normalize, text)


def _preprocess_for_regex(text: str) -> str:
    """OCR 오인식 보정. 줄바꿈은 절대 제거하지 않는다."""
    processed_lines = []
    for line in text.split('\n'):
        line = _fix_ocr_ip(line)
        # en/em-dash → 일반 하이픈 (예: "980115–2823649" → "980115-2823649")
        line = re.sub(r'[\u2013\u2014\u2015\u2212]', '-', line)
        # 숫자 문맥에서 OCR 오인식 보정: 숫자/하이픈 인접한 O→0, l/I→1
        # 예: "07O-7829-5335" → "070-7829-5335"
        line = re.sub(r'(?<=[\d\-])[Oo](?=[\d\-])', '0', line)
        line = re.sub(r'(?<=\d)[Oo](?=[\d\-])', '0', line)
        line = re.sub(r'(?<=[\d\-])[lI](?=[\d\-])', '1', line)
        line = re.sub(r'(?<=\d)[lI](?=[\d\-])', '1', line)
        # 숫자-숫자/하이픈 사이 공백 제거
        line = re.sub(r'(?<=\d)[ \t]+(?=[\d\-])', '', line)
        line = re.sub(r'(?<=[\d\-])[ \t]+(?=\d)', '', line)
        processed_lines.append(line)
    return '\n'.join(processed_lines)


# ============================================================
# Sub-bbox 추정 (라인 일부에 PII가 있는 경우)
# ============================================================

def _char_visual_width(c: str) -> float:
    """문자 시각적 너비 추정. 한글/한자 등 전각 문자는 2, 나머지는 1을 기준으로 세밀하게 보정."""
    cp = ord(c)
    if (0x1100 <= cp <= 0x11FF   # 한글 자모
            or 0x3000 <= cp <= 0x9FFF   # CJK 기호/한자
            or 0xAC00 <= cp <= 0xD7A3   # 한글 완성형
            or 0xF900 <= cp <= 0xFAFF   # CJK 호환 한자
            or 0xFF01 <= cp <= 0xFF60): # 전각 ASCII
        return 2.0
    if c.isspace():
        return 0.5   # 공백은 보통 매우 좁음
    if c in '.,:;-\'\"|`!()[]{}\\/':
        return 0.6   # 기호들도 좁음
    if c in 'ilI1':
        return 0.7   # 얇은 문자/숫자
    if c.isdigit():
        return 1.1   # 숫자는 일반 알파벳보다 살짝 넓은 경향
    if c.isupper():
        return 1.3   # 대문자는 소문자보다 넓음
    if c in 'mwWM':
        return 1.5   # 특히 넓은 알파벳
    return 1.0


def _text_visual_width(text: str) -> float:
    return sum(_char_visual_width(c) for c in text)


def _estimate_sub_bbox(pii_value: str, line_text_orig: str, line_bbox: list):
    """
    PII 값이 라인의 일부일 때 해당 부분의 bbox 추정.
    OCR 오인식(O↔0, l↔1)을 허용하는 regex로 위치를 찾고
    문자별 시각적 너비 비율로 x좌표를 보간한다 (한글은 2배 너비).
    라인 전체와 동일하거나 위치를 못 찾으면 None 반환.
    """
    if not line_text_orig or not pii_value:
        return None

    ocr_map = {'0': '[0Oo]', '1': '[1lI]', 'O': '[0Oo]', 'o': '[0Oo]',
               'l': '[1lI]', 'I': '[1lI]'}
    pattern_parts = []
    for orig_c in pii_value:
        if orig_c in ocr_map:
            pattern_parts.append(ocr_map[orig_c])
        else:
            pattern_parts.append(re.escape(orig_c))

    pii_pattern = r'[\s\-]*'.join(pattern_parts)

    match = re.search(pii_pattern, line_text_orig)
    if not match:
        return None

    start_char = match.start()
    end_char   = match.end()
    total_len  = len(line_text_orig)

    if start_char == 0 and end_char >= total_len:
        return None

    # 시각적 너비 기준으로 비율 계산 (한글 2x, ASCII 1x)
    total_visual = _text_visual_width(line_text_orig)
    if total_visual == 0:
        return None
    start_visual = _text_visual_width(line_text_orig[:start_char])
    end_visual   = _text_visual_width(line_text_orig[:end_char])

    x1, y1, x2, y2 = line_bbox
    line_width   = x2 - x1
    start_ratio  = start_visual / total_visual
    end_ratio    = end_visual   / total_visual

    sub_x1 = x1 + start_ratio * line_width
    sub_x2 = x1 + end_ratio * line_width

    return [sub_x1, y1, sub_x2, y2]



def normalize_type(raw_type: str) -> str:
    key = raw_type.strip().lower().replace(" ", "")
    return TYPE_NORMALIZE_MAP.get(key, raw_type.strip().upper())


# ============================================================
# 마스킹 값 생성
# ============================================================

def mask_value(pii_type: str, value: str) -> str:
    """
    기준:
      NAME            성 제외 나머지 *               홍**
      ENGLISH_NAME    앞 4자리 노출, 나머지 *         SEO ******
      PHONE           뒤 4자리 ****                  010-1234-****
      RRN             뒤 7자리 *******               980115-*******
      FOREIGNER_REG_NO 뒤 7자리 *******              800101-*******
      PASSPORT_NO     뒤 4자리 ****                  12345****
      ROAD_ADDRESS    도로명 번호·동·층·호 숫자 *       주안로 * , ****동 ****호
      EMAIL           @ 앞 3번째 자리부터 *           sy******@naver.com
      CREDIT_CARD     PCI-DSS: 중간 4+4자리 ****     9430-2000-****-2391
      ACCOUNT_NO      뒤 5자리 *                     430-20-1*****
      IP_ADDRESS      첫 옥텟 ***                    ***.8.7.12
      BUSINESS_REG_NO 앞 3자리 제외 **-*****          123-**-*****
      HEALTH_INSURANCE_NO 뒤 4자리 ****              123456****
      CAR_NO          한글+뒤 4자리 마스킹             19*****
    """
    v = value.strip()

    if pii_type == "NAME":
        if len(v) >= 2:
            return v[0] + '*' * (len(v) - 1)
        return v

    elif pii_type == "ENGLISH_NAME":
        visible = min(4, len(v))
        return v[:visible] + '*' * max(0, len(v) - visible)

    elif pii_type == "PHONE":
        digits_pos = [i for i, c in enumerate(v) if c.isdigit()]
        if len(digits_pos) >= 4:
            result = list(v)
            for pos in digits_pos[-4:]:
                result[pos] = '*'
            return ''.join(result)
        return v

    elif pii_type in ("RRN", "FOREIGNER_REG_NO"):
        digits_pos = [i for i, c in enumerate(v) if c.isdigit()]
        if len(digits_pos) >= 7:
            result = list(v)
            for pos in digits_pos[-7:]:
                result[pos] = '*'
            return ''.join(result)
        return v

    elif pii_type == "PASSPORT_NO":
        if len(v) >= 4:
            return v[:-4] + '****'
        return v

    elif pii_type == "ROAD_ADDRESS":
        # 1. 괄호 안 상세정보 전체 마스킹 (예: (신당동, 스마일원룸) → (***))
        result = re.sub(r'\([^)]+\)', '(***)', v)
        # 2. 주소 내 모든 숫자 그룹 마스킹
        #    - OCR 오인식("길"→"긴")에 무관하게 번지/동/층/호/건물호수 전체 처리
        result = re.sub(r'\d+', lambda m: '*' * len(m.group()), result)
        return result

    elif pii_type == "EMAIL":
        if '@' in v:
            local, domain = v.split('@', 1)
            if len(local) > 2:
                return local[:2] + '*' * (len(local) - 2) + '@' + domain
            return v
        return v

    elif pii_type == "CREDIT_CARD":
        digits = re.sub(r'[\s\-]', '', v)
        if len(digits) == 16:
            return f"{digits[:4]}-{digits[4:8]}-****-{digits[12:]}"
        return re.sub(r'(?<=\d{4}[\-\s])\d{4}[\-\s]\d{4}(?=[\-\s]\d)', '****-****', v)

    elif pii_type == "ACCOUNT_NO":
        digits_pos = [i for i, c in enumerate(v) if c.isdigit()]
        if len(digits_pos) >= 5:
            result = list(v)
            for pos in digits_pos[-5:]:
                result[pos] = '*'
            return ''.join(result)
        return v

    elif pii_type == "IP_ADDRESS":
        return re.sub(r'^\d+', '***', v)

    elif pii_type == "BUSINESS_REG_NO":
        return re.sub(r'(\d{3})-\d{2}-\d{5}', r'\1-**-*****', v)

    elif pii_type == "HEALTH_INSURANCE_NO":
        digits_pos = [i for i, c in enumerate(v) if c.isdigit()]
        if len(digits_pos) >= 4:
            result = list(v)
            for pos in digits_pos[-4:]:
                result[pos] = '*'
            return ''.join(result)
        return v

    elif pii_type == "CAR_NO":
        # "12가3456" → "12가****"  길이를 value와 동일하게 유지해야 partial_bbox가 올바르게 계산됨
        return re.sub(r'(\d{2,3}\s?[가-힣])\s?\d{4}', lambda m: m.group(1) + '****', v)

    half = max(1, len(v) // 2)
    return v[:half] + '*' * (len(v) - half)
