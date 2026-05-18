
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
        r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.,][a-zA-Z]{2,}\b"
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
    # ACCOUNT_NO: 은행명이 명시된 경우에만 정규식으로 추출 (날짜/사업자번호 오탐 방지)
    # 은행명 없이 단독 숫자만 있는 경우는 NER(3차) 및 공간 근접성(2.5차)으로만 추출
    "ACCOUNT_NO": [
        r'(?:신한|국민|하나|우리|농협|기업|SC제일|씨티|카카오|토스|케이뱅크|우체국|새마을금고|수협)은행\s*([\d][\d\-\s]{8,22}\d)',
    ],
    "HEALTH_INSURANCE_NO": [
        r"\b\d{1,2}-\d{7,10}\b"
    ],
    "CREDIT_CARD": [
        r"\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b",
    ],
    "ENGLISH_NAME": [
        r'\(([A-Z][a-z]+(?:[\s\-][A-Z]?[a-z]+)+)\)',  # (Hong Gil-dong), (Lee Young-hee)
    ],
    "PASSPORT_NO": [
        r"\b[A-Z]{1,2}\d{7,8}\b",
        r"\b[MSROD]\d{8}\b"
    ],
    "IP_ADDRESS": [
        r"\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b"
    ],
    "MAC_ADDRESS": [
        r"\b(?:[0-9A-Fa-f]{2}[:-]){5}(?:[0-9A-Fa-f]{2})\b"
    ],
    "CAR_NO": [
        r"\b\d{2,3}\s?[가-힣]\s?\d{4}\b",
        r"\b[가-힣]{1,2}\s?\d{2,3}\s?[가-힣]\s?\d{4}\b",
    ],
    "DRIVERS_LICENSE": [
        r"\b\d{2}-\d{2}-\d{6}-\d{2}\b"
    ],
    "ROAD_ADDRESS": [
        # 줄 바꿈(2차 병합)에서도 끊어진 주소를 감지할 수 있도록 유연한 정규식 추가
        r"(?:[가-힣]+(?:도|특별시|광역시|시|군|구)[\s\n]+)?[가-힣]+(?:구|시|군|읍|면|동|가|리)[\s\n]+[가-힣\d\s\n]+(?:로|길)[\s\n]+\d+(?:-\d+)?"
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
    "mac주소": "MAC_ADDRESS", "mac": "MAC_ADDRESS",
    "차량번호": "CAR_NO", "자동차번호": "CAR_NO", "차량번호판": "CAR_NO", "번호판": "CAR_NO",
    "운전면허번호": "DRIVERS_LICENSE", "면허번호": "DRIVERS_LICENSE",
    "도로명주소": "ROAD_ADDRESS", "주소": "ROAD_ADDRESS",
    "이름": "NAME", "성명": "NAME",
    "영문이름": "ENGLISH_NAME", "영어이름": "ENGLISH_NAME", "english_name": "ENGLISH_NAME",
}

ALLOWED_TYPES = {
    "PHONE", "EMAIL", "RRN", "FOREIGNER_REG_NO", "BUSINESS_REG_NO",
    "ACCOUNT_NO", "HEALTH_INSURANCE_NO", "CREDIT_CARD", "PASSPORT_NO", "IP_ADDRESS", 
    "MAC_ADDRESS", "CAR_NO", "DRIVERS_LICENSE", "ROAD_ADDRESS", "NAME", "ENGLISH_NAME"
}

# KoBERT NER 모델 초기화
_kobert_ner_model = None
_kobert_ner_tokenizer = None

# NER 모델이 사람 이름이라고 확신하는 기준점 (오탐 원천 차단을 위해 상향)
# 임계값이 너무 낮으면 '바랍니다'의 오타인 '바락' 등도 이름으로 통과됨
KOBERT_NAME_CONFIDENCE_MIN = 0.60

def _clean_kobert_name(value: str, score: float) -> str:
    """NER 결과를 검증하고 불필요한 기호를 제거하여 반환 (유효하지 않으면 None)"""
    if score < KOBERT_NAME_CONFIDENCE_MIN:
        return None
        
    # NER이 이름 주변의 (인), (서명) 등을 함께 잡은 경우 제거
    clean_val = re.sub(r'\((?:인|서명|주|상호|대표)\)', '', value)
    # 특수문자 제거 (이름 사이에 들어간 하이픈 등은 영문이름을 위해 유지)
    clean_val = re.sub(r'[:：;;\(\)\[\]\{\}\'\"<>.,]', '', clean_val).strip()
    
    # 한국어 이름: 2~5글자 한글 (공백이 포함된 '홍 길 동' 처리 가능)
    if re.fullmatch(r'[가-힣]{2,5}', re.sub(r'\s+', '', clean_val)):
        return clean_val
        
    # 영문 이름: 하이픈·공백 제거 후 순수 알파벳 2자 이상
    alnum = re.sub(r'[\s\-]', '', clean_val)
    if alnum.isalpha() and len(alnum) >= 2:
        return clean_val
        
    return None

def _is_valid_kobert_name(value: str, score: float) -> bool:
    # 하위 호환성 유지용
    return _clean_kobert_name(value, score) is not None

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
                cleaned_name = _clean_kobert_name(value, entity['score'])
                if cleaned_name:
                    pii_items.append({
                        "type": "NAME",
                        "value": cleaned_name,
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
            
            # 계좌번호 문맥 인식 1: 기관명(ORG) 뒤에 오는 계좌번호 탐색
            elif entity_type in ['ORG', 'ORGANIZATION', 'OG']:
                idx = text.find(value)
                if idx != -1:
                    remainder = text[idx + len(value):]
                    # '은행 계좌번호: ' 와 같은 글자들이 올 수 있으므로 최대 15자의 비숫자 문자 허용 (3차)
                    match = re.search(r'^[^0-9]{0,15}([\d\-\s]{10,25})', remainder)
                    if match:
                        acc_num = match.group(1).strip()
                        if len(re.sub(r'[\s\-]', '', acc_num)) >= 10:
                            if not re.fullmatch(r'\d{3}-\d{2}-\d{5}', acc_num) and not re.match(r'\d{4}[-./]\d{2}[-./]\d{2}', acc_num):
                                pii_items.append({
                                    "type": "ACCOUNT_NO",
                                    "value": acc_num,
                                    "confidence": entity['score']
                                })
            
            # 계좌번호 문맥 인식 2: 수량/숫자(QT)로 인식된 값 중 계좌번호 형태이면서 문맥 키워드가 있는 경우
            elif entity_type in ['QT', 'QUANTITY', 'AF', 'ARTIFACT']:
                clean_val = re.sub(r'[\s\-]', '', value)
                if clean_val.isdigit() and 10 <= len(clean_val) <= 20:
                    if re.search(r'(은행|뱅크|농협|수협|우체국|새마을|증권|투자|계좌|입금|송금)', text):
                        if not re.fullmatch(r'\d{3}-\d{2}-\d{5}', value) and not re.match(r'\d{4}[-./]\d{2}[-./]\d{2}', value):
                            pii_items.append({
                                "type": "ACCOUNT_NO",
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

    # ── 2.5차: 공간 근접성 기반 추출 (표 구조 대응) ────────────────
    # KoBERT NER가 없거나 표 형식으로 라벨과 값이 떨어진 경우 보완
    results = _extract_pii_by_proximity(ocr_pages, results)
    logger.info(f"[2.5차 공간 근접성] 누적 {len(results)}개")

    # ── 3차: KoBERT NER 보조 (NAME, ROAD_ADDRESS, ACCOUNT_NO) ────────────────────
    print("\n[진행] KoBERT NER (이름/주소/계좌번호) 분석을 시작합니다...")
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
                            cleaned_name = _clean_kobert_name(value, score)
                            if cleaned_name:
                                alnum = re.sub(r'[\s\-]', '', cleaned_name)
                                is_english = alnum.isalpha() and not re.search(r'[가-힣]', cleaned_name)
                                assigned_type = "ENGLISH_NAME" if is_english else "NAME"
                                sub_bbox = _estimate_sub_bbox(cleaned_name, text, line.get("bbox")) or line.get("bbox")
                                results.append({"type": assigned_type, "value": cleaned_name, "page": page_num, "bbox": sub_bbox, "source": "NER (KoBERT)"})
                                
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

                        elif entity_type in ['ORG', 'ORGANIZATION', 'OG']:
                            # 기관명(은행 등) 바로 뒤에 오는 10~25자리 숫자 → 계좌번호
                            idx = text.find(value)
                            if idx != -1:
                                remainder = text[idx + len(value):]
                                # '은행 계좌번호: ' 와 같은 글자들이 올 수 있으므로 최대 15자의 비숫자 문자 허용 (3차)
                                acc_match = re.search(r'^[^0-9]{0,15}([\d\-\s]{10,25})', remainder)
                                if acc_match:
                                    acc_num = acc_match.group(1).strip()
                                    if len(re.sub(r'[\s\-]', '', acc_num)) >= 10:
                                        if not re.fullmatch(r'\d{3}-\d{2}-\d{5}', acc_num) and not re.match(r'\d{4}[-./]\d{2}[-./]\d{2}', acc_num):
                                            sub_bbox = _estimate_sub_bbox(acc_num, text, line.get("bbox")) or line.get("bbox")
                                            results.append({"type": "ACCOUNT_NO", "value": acc_num, "page": page_num, "bbox": sub_bbox, "source": "NER (KoBERT)"})

                        elif entity_type in ['QT', 'QUANTITY']:
                            # 숫자(QT)가 10~20자리이고 은행 키워드가 문맥에 있으면 계좌번호
                            clean_val = re.sub(r'[\s\-]', '', value)
                            if clean_val.isdigit() and 10 <= len(clean_val) <= 20:
                                if re.search(r'(은행|뱅크|농협|수협|우체국|새마을|증권|투자|계좌|입금|송금)', text):
                                    if not re.fullmatch(r'\d{3}-\d{2}-\d{5}', value) and not re.match(r'\d{4}[-./]\d{2}[-./]\d{2}', value):
                                        sub_bbox = _estimate_sub_bbox(value, text, line.get("bbox")) or line.get("bbox")
                                        results.append({"type": "ACCOUNT_NO", "value": value, "page": page_num, "bbox": sub_bbox, "source": "NER (KoBERT)"})

        except Exception as e:
            print(f"[오류] KoBERT NER 실행 중 에러: {e}")
    else:
        print("[경고] KoBERT NER 모델을 사용할 수 없습니다.")

    # ── 3.5차: 이름 전파 (Name Propagation) ──────────────────────────────────────
    print("\n[진행] 이름 전파(Name Propagation) 분석을 시작합니다...")
    found_names = set()
    # 기존에 확실하게 찾은 이름들 수집
    for r in results:
        if r.get("type") in ("NAME", "ENGLISH_NAME") and r.get("value"):
            val = r["value"].strip()
            if len(val) >= 2:  # 2글자 이상인 이름만 전파 (1글자는 오탐 위험)
                found_names.add((r["type"], val))

    if found_names:
        for page in ocr_pages:
            page_num = page["page_number"]
            for line in page.get("lines", []):
                text = line.get("text", "")
                line_bbox = line.get("bbox")
                if not text or not line_bbox:
                    continue
                
                # 텍스트 내에 수집된 이름이 존재하면 위치를 추정하여 마스킹 추가
                for name_type, name_val in found_names:
                    if name_val in text:
                        sub_bbox = _estimate_sub_bbox(name_val, text, line_bbox) or line_bbox
                        results.append({"type": name_type, "value": name_val, "page": page_num, "bbox": sub_bbox, "source": "이름 전파"})

    # 최종 중복 제거: 더 완전한 정보(긴 값)를 가진 항목을 유지
    results = _deduplicate(results)

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
    """type 내에서 value가 부분 문자열 관계인 경우 중복 제거. 더 긴(완전한) 값을 유지.
    NAME/ENGLISH_NAME은 위치(page+bbox)가 다르면 같은 value라도 독립 항목으로 유지한다.
    (같은 이름이 문서의 여러 곳에 등장하면 각 위치를 모두 마스킹해야 하기 때문)"""
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

            # For NAME/ENGLISH_NAME, if values are identical but location is different, keep both.
            if item["type"] in ("NAME", "ENGLISH_NAME"):
                same_loc = (
                    item.get("page") == existing.get("page") and
                    str(item.get("bbox")) == str(existing.get("bbox"))
                )
                if not same_loc and val == ex:
                    continue # This is not a duplicate, check against next existing item.

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

    for r in results:
        r.pop("_context", None)
        if r.get("type") == "NAME" and r.get("source", "").startswith("정규식"):
            val_clean = re.sub(r'\s+', '', r.get("value", ""))
            
            # 규칙 B: 2글자 이하 단어는 정규식에서 과감히 버림 ("확인", "서명", "없음" 등 2글자 일반명사 오탐 원천 차단)
            # -> 공간 근접성(Table)이나 3차 KoBERT NER가 문맥으로 파악하여 살려냄
            if len(val_clean) < 3:
                continue

        filtered.append(r)

    return filtered


def _extract_pii_by_proximity(ocr_pages: list, results: list) -> list:
    """
    라벨(성명, 주민번호 등)과 값이 표 형식으로 떨어져 있는 경우 공간적 근접성을 이용해 추출.
    """
    LABEL_MAP = {
        "NAME": ["성명", "이름", "성 명", "이 름", "대표이사", "대표자", "성  명"],
        "RRN": ["주민등록번호", "주민번호", "주민등록", "RRN"],
        "PHONE": ["전화번호", "휴대폰", "연락처", "H.P", "연 락 처"],
        "ACCOUNT_NO": ["계좌번호", "계좌", "입금계좌", "계 좌 번 호"]
    }
    # 이름 탐지에서 제외할 일반적인 명사/직급
    EXCLUDE_NAME_WORDS = {
        "과장", "차장", "팀장", "사원", "대리", "부장", "이사", "대표", "지원", "영업", "개발", "인사",
        "팀", "부서", "본부", "실", "센터", "공고", "결과", "아래", "사항", "내용", "확인", "서명", "날인",
        "성명", "이름", "본인", "대표자", "대표이사", "신청인", "보호자", "환자", "예금주", "입금", "계좌",
        "합계", "금액", "비고", "순위", "번호", "일자", "날짜", "시간", "장소", "주소", "연락처", "전화",
        "문의", "안내", "참조", "비고", "파일", "첨부", "제출", "작성", "승인", "검토", "완료", "진행",
        "품목", "품목명", "단가", "수량", "이메일",
        "발급", "사유", "신청", "부수", "용도", "목적", "구분", "종류"
    }

    def _is_overlap(b1, b2):
        if not b1 or not b2: return False
        return not (b1[2] < b2[0] or b1[0] > b2[2] or b1[3] < b2[1] or b1[1] > b2[3])

    def _get_overlap_x(b1, b2):
        overlap = min(b1[2], b2[2]) - max(b1[0], b2[0])
        return max(0, overlap)

    new_results = list(results)
    
    for page in ocr_pages:
        page_num = page["page_number"]
        lines = [l for l in page.get("lines", []) if l.get("text") and l.get("bbox")]
        if not lines: continue

        # 1. 라벨 헤더 식별
        headers = []
        for l in lines:
            txt = re.sub(r'\s+', '', l["text"])
            for p_type, keywords in LABEL_MAP.items():
                if any(kw.replace(' ', '') == txt or (len(txt) < 10 and kw.replace(' ', '') in txt) for kw in keywords):
                    headers.append({"type": p_type, "bbox": l["bbox"], "text": l["text"]})

        # 2. 근접 라인 탐색
        for header in headers:
            pii_type = header["type"]
            hx1, hy1, hx2, hy2 = header["bbox"]
            h_width = hx2 - hx1
            h_height = hy2 - hy1

            for line in lines:
                text = line["text"].strip()
                if not text or line["bbox"] == header["bbox"]:
                    continue

                # 이미 추출된 항목인지 확인
                if any(r["page"] == page_num and _is_overlap(r["bbox"], line["bbox"]) for r in new_results):
                    continue

                cx1, cy1, cx2, cy2 = line["bbox"]
                
                # 가로(우측) 근접: Y축 겹치고 X축이 라벨 우측에 있음
                y_overlap = min(hy2, cy2) - max(hy1, cy1)
                is_horiz = y_overlap > (min(h_height, cy2-cy1) * 0.5)
                dist_h = cx1 - hx2
                
                # 세로(하단) 근접: X축 겹치고 Y축이 라벨 하단에 있음
                x_overlap = _get_overlap_x(header["bbox"], line["bbox"])
                is_vert = x_overlap > (min(h_width, cx2-cx1) * 0.5)
                dist_v = cy1 - hy2

                match_found = False
                # 이름(NAME) 특화 로직
                if pii_type == "NAME":
                    # 한글 2~4자 (공백 허용)
                    clean_text = re.sub(r'\s+', '', text)
                    if 2 <= len(clean_text) <= 4 and re.match(r'^[가-힣]+$', clean_text):
                        if not any(w in clean_text for w in EXCLUDE_NAME_WORDS):
                            # 거리 조건: 가로는 라벨 3배 이내, 세로는 라벨 15배 이내 (표가 길 수 있음)
                            if (is_horiz and 0 < dist_h < h_width * 3) or (is_vert and 0 < dist_v < h_height * 15):
                                match_found = True
                
                # 계좌번호(ACCOUNT_NO) 특화 로직 (2.5차)
                elif pii_type == "ACCOUNT_NO":
                    clean_text = re.sub(r'[\s\-]', '', text)
                    if clean_text.isdigit() and 10 <= len(clean_text) <= 25:
                        is_business_no = re.fullmatch(r'\d{3}-\d{2}-\d{5}', text.strip())
                        is_date = re.match(r'\d{4}[-./]\d{2}[-./]\d{2}', text.strip())
                        if not is_business_no and not is_date:
                            # 거리가 비교적 가까운 경우 매칭
                            if (is_horiz and 0 < dist_h < h_width * 10) or (is_vert and 0 < dist_v < h_height * 5):
                                match_found = True

                # 주민번호(RRN) 등 다른 타입은 이미 1차 정규식에서 (라벨 없이도) 잡혔을 가능성이 큼
                # 만약 안 잡혔다면 여기서 추가 가능 (필요 시)

                if match_found:
                    new_results.append({
                        "type": pii_type,
                        "value": text,
                        "page": page_num,
                        "bbox": line["bbox"],
                        "source": "공간 근접성 (Table)"
                    })

    return _deduplicate(new_results)



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
               'l': '[1lI]', 'I': '[1lI]', '.': '[.,]', ',': '[.,]'}
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
      MAC_ADDRESS     뒤 3자리 옥텟 **                00:0A:95:**:**:**
      DRIVERS_LICENSE 중간 6자리 ******              11-12-******-12
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

    elif pii_type == "MAC_ADDRESS":
        parts = re.split(r'[:-]', v)
        if len(parts) == 6:
            sep = ':' if ':' in v else '-'
            return sep.join(parts[:3]) + sep + "**" + sep + "**" + sep + "**"
        return v

    elif pii_type == "DRIVERS_LICENSE":
        # 11-12-123456-12 -> 11-12-******-12
        return re.sub(r'(\d{2}-\d{2}-)\d{6}(-\d{2})', r'\1******\2', v)

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
