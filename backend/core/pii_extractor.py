
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
        # 레이블 뒤 주소 캡처 (회사주소, 자택주소, 현주소, 주소 등 레이블 다음에 오는 주소)
        r"(?:회사\s*주소|자택\s*주소|주거\s*지|현\s*주소|거주\s*지|주소지|주\s*소)[\s:：]+([가-힣\d][가-힣0-9·()\-\s]{5,}(?:시|구|군|동|읍|면|로|길|가|번지|호|층)[가-힣0-9()\-\s]{0,40})",
        # 도로명 주소: xxx로/길 번지 (동/층/호 선택)
        r"\b[가-힣0-9·\- \t]+(?:로|길)\s?\d+(?:-\d+)?(?:\s?\d+[동층호실]*)?\b",
        # 지번 주소: 시/도 + 구/군 + 동/읍/면 + 번지
        r"\b[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|시|도)\s*[가-힣]+(?:구|군)\s*[가-힣]+(?:읍|면|동|가)\s*\d+(?:-\d+)?\b",
        # 지번 주소 (시/구 없이 동/읍/면 + 번지만)
        r"\b[가-힣]{2,}(?:읍|면|동|가)\s+\d+(?:-\d+)?\b",
        # 지번 주소 2: 시/도 + 구/군/시 까지만 있고 이후 도로명이 오는 경우
        r"\b[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|시|도)\s+[가-힣]+(?:구|군|시)\s+[가-힣0-9·\- \t]+(?:로|길)\s?\d+(?:-\d+)?\b",
    ],
    "NAME": [
        # 일반 레이블 뒤 이름
        r"(?:성\s*명|이\s*름|대\s*표\s*이\s*사|대표자|원\s*장|사\s*장|담당자|신청인|보호자|환\s*자|예\s*금\s*주|배\s*통\s*자|수\s*취\s*인|송\s*금\s*인|본\s*인|세\s*대\s*주)[\s\n:：]*([가-힣]{2,4})\b",
        # 직급/직책 레이블 뒤 이름 (인사공고, 발령 문서 등)
        r"(?:부\s*장|차\s*장|과\s*장|대\s*리|사\s*원|수\s*석|책\s*임|선\s*임|주\s*임|팀\s*장|본\s*부\s*장|전\s*무|상\s*무|이\s*사|사\s*장|대\s*표|원\s*장|교\s*수|교\s*사|강\s*사|의\s*사|간\s*호\s*사|약\s*사|변\s*호\s*사|회\s*계\s*사)[\s\n:：]+([가-힣]{2,4})\b",
        # 이름 뒤 경칭/서명 표시 (귀하, 님, 씨, (인), (서명) 등)
        r"([가-힣]{2,4})\s*(?:귀하|님|씨)\b",
        r"([가-힣]{2,4})\s*[\(\（]\s*(?:인|서명|印)\s*[\)\）]",
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
}

ALLOWED_TYPES = {
    "PHONE", "EMAIL", "RRN", "FOREIGNER_REG_NO", "BUSINESS_REG_NO",
    "ACCOUNT_NO", "HEALTH_INSURANCE_NO", "CREDIT_CARD", "PASSPORT_NO",
    "IP_ADDRESS", "CAR_NO", "ROAD_ADDRESS", "NAME"
}

# NAME 오탐 방지: 이름처럼 생겼지만 이름이 아닌 단어 블랙리스트
NAME_BLACKLIST = {
    # 레이블/키워드
    "성명", "이름", "전화", "이메일", "주소", "직위", "직책", "부서", "팀명",
    "담당자", "대표자", "대표이사", "원장", "사장", "담당", "신청인", "보호자",
    "예금주", "수취인", "송금인", "본인", "세대주", "환자",
    # 직급/직책 단어 (이사 뒤에 오는 단어가 이름으로 잡히는 오탐 방지)
    "이사", "부장", "차장", "과장", "대리", "사원", "팀장", "본부장", "전무", "상무",
    # 일반 조사/어미/단어
    "이나", "와의", "에서", "으로", "에게", "한국", "서울", "부산", "대구",
    "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남",
    "전북", "전남", "경북", "경남", "제주", "이하", "여백", "확인", "내용",
    "관계", "번호", "등록", "등본", "초본", "발급", "신청", "용도", "목적",
    "정보", "처리", "동의", "거부", "철회", "권리", "의무", "책임", "규정",
    # 업무/문서 용어 (직급 레이블 뒤에 올 수 있는 비이름 단어)
    "해당", "기존", "변경", "없음", "있음", "이전", "신규", "현재", "현직",
    "완료", "승인", "반려", "대상", "제외", "포함", "적용", "미적용",
    "인사", "발령", "공고", "사항", "현황", "결과", "내역", "직급", "직책",
    # 문서 섹션 표제어 합성어
    "인사공고", "인적사항", "발령사항", "변경사항", "해당사항", "인사발령",
    "직급변경", "직책변경", "인사현황", "발령현황", "직급현황",
}

# KoBERT NER 모델 초기화
_kobert_ner_model = None
_kobert_ner_tokenizer = None

KOBERT_NAME_CONFIDENCE_MIN = 0.80  # NER 신뢰도 하한선 상향 (불확실한 단어 오탐 방지)


def _is_valid_kobert_name(value: str, score: float) -> bool:
    collapsed = re.sub(r'\s+', '', value)
    if score < KOBERT_NAME_CONFIDENCE_MIN:
        return False
    if not re.fullmatch(r'[가-힣]{2,4}', collapsed):
        return False
    if collapsed in _STANDALONE_NAME_BLACKLIST:
        return False
    if any(collapsed.endswith(s) for s in _NON_NAME_SUFFIXES):
        return False
    if len(collapsed) == 2 and re.search(r'[하되어이의을를은는가나]$', collapsed):
        return False
    # '하기', '가기' 등 동사형이나 UI 버튼명 패턴 일괄 제거
    if re.search(r'(하기|가기|보기|도움말)$', collapsed):
        return False
    # 행정구역 접미사로 끝나는 단어는 인명이 아님 (서울시, 중구, 강원도 등)
    if re.search(r'[시구군도읍면동]$', collapsed):
        return False
    return True


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
                        # NAME 블랙리스트: 라벨/업무용어 오탐 방지 (확장 블랙리스트 사용)
                        if pii_type == "NAME" and re.sub(r'\s+', '', value) in _STANDALONE_NAME_BLACKLIST:
                            continue
                            
                        # 추출된 값(value) 부분만의 정밀한 sub-bbox를 추정 (실패 시 원본 라인 bbox 사용)
                        sub_bbox = _estimate_sub_bbox(value, text, bbox) or bbox
                        results.append({
                            "type": pii_type,
                            "value": value,
                            "page": page_num,
                            "bbox": sub_bbox,
                            "_context": text,
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
                        # NAME 블랙리스트: 라벨/업무용어 오탐 방지 (확장 블랙리스트 사용)
                        if pii_type == "NAME" and re.sub(r'\s+', '', value) in _STANDALONE_NAME_BLACKLIST:
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
                        })

    results = _deduplicate(results)
    logger.info(f"[2차 인접 라인 병합] 누적 {len(results)}개")

    # ── 정규식 추출 NAME 규칙 검증 ───────────────────────────
    # 정규식은 레이블 뒤 한글을 기계적으로 잡기 때문에 조사/어미 오탐 가능성이 있음.
    # 블랙리스트/접미사/조사 패턴으로 실제 이름이 아닌 항목 제거.
    results = _validate_regex_names(results)
    logger.info(f"[NAME 규칙 검증] 완료 후 {len(results)}개")

    # ── 3차: KoBERT NER 보조 (NAME, ROAD_ADDRESS) ────────────────────────────────
    for page in ocr_pages:
        page_num = page["page_number"]
        lines = page.get("lines", [])
        page_text = "\n".join(l.get("text", "") for l in lines if l.get("text"))
        if not page_text.strip():
            continue

        ner_items = _extract_with_kobert_ner(page_text)

        for item in ner_items:
            if item["type"] == "NAME":
                collapsed_val = re.sub(r'\s+', '', item["value"])
                # NAME 블랙리스트 필터 (확장 블랙리스트 포함)
                if collapsed_val in _STANDALONE_NAME_BLACKLIST:
                    logger.debug(f"[NER 블랙리스트] NAME 오탐 제거: {item['value']}")
                    continue
                # 문서 섹션 표제어 접미사 필터
                if any(collapsed_val.endswith(s) for s in _NON_NAME_SUFFIXES):
                    logger.debug(f"[NER 접미사 필터] NAME 오탑 제거: {item['value']}")
                    continue
                # 2글자 한글이 조사/어미인 경우 제거
                if len(collapsed_val) == 2 and re.search(r'[하되어이의을를은는가나]$', collapsed_val):
                    logger.debug(f"[NER 블랙리스트] 조사/어미 패턴 제거: {item['value']}")
                    continue

            # 해당 value가 등장하는 모든 bbox 찾기
            bboxes = _find_all_value_bboxes(item["value"], lines)
            if not bboxes:
                # bbox를 못 찾아도 pii_items 목록에는 포함 (bbox=None)
                if not _is_covered(item["value"], item["type"], results):
                    results.append({
                        "type": item["type"],
                        "value": item["value"],
                        "page": page_num,
                        "bbox": None,
                    })
            else:
                for bbox in bboxes:
                    # 이미 동일 bbox로 등록된 항목은 건너뜀
                    already = any(
                        r["type"] == item["type"]
                        and r["value"] == item["value"]
                        and r.get("bbox") == bbox
                        for r in results
                    )
                    if not already:
                        results.append({
                            "type": item["type"],
                            "value": item["value"],
                            "page": page_num,
                            "bbox": bbox,
                        })

    # 3차에서는 value+bbox 기준 중복 제거 (같은 이름이 다른 위치에 있으면 유지)
    seen = set()
    deduped_results = []
    for r in results:
        key = (r["type"], r["value"], str(r.get("bbox")))
        if key not in seen:
            seen.add(key)
            deduped_results.append(r)
    results = deduped_results

    logger.info(f"[3차 KoBERT NER 보조] 최종 {len(results)}개: {results}")

    # ── 4차: 독립 라인 이름 감지 (비활성화) ─────────
    # NER(3차) 도입으로 인해 오탐(False Positive)이 잦고, 
    # 허공에 뜬 텍스트는 향후 OCR 레이아웃 분석을 통해 보완할 예정이므로 비활성화합니다.
    # results = _detect_standalone_names(ocr_pages, results)
    # logger.info(f"[4차 독립라인 이름 감지] 최종 {len(results)}개")

    return results


# 직급/직책 키워드 (인접 라인에 있으면 이름으로 판단)
_JOB_TITLE_WORDS = {
    "부장", "차장", "과장", "대리", "사원", "수석", "책임", "선임", "주임",
    "팀장", "본부장", "전무", "상무", "이사", "사장", "대표", "원장",
    "교수", "교사", "강사", "의사", "간호사", "약사", "변호사", "회계사",
    "발령행", "발령", "직급", "직책", "수취인", "송금인", "예금주",
}

# 이름처럼 생겼지만 이름이 아닌 단어 (블랙리스트 확장)
_STANDALONE_NAME_BLACKLIST = NAME_BLACKLIST | {
    "인사", "공고", "개최", "결과", "아래", "같이", "변경", "현직", "사항",
    "부장", "차장", "과장", "대리", "사원", "수석", "책임", "선임", "주임",
    "팀장", "본부장", "전무", "상무", "이사", "사장", "대표", "원장",
    "발령", "직급", "직책", "일자", "이하", "다음", "위와", "해당", "기존",
    "변경", "없음", "완료", "처리", "확인", "승인", "반려", "수정", "삭제",
    "추가", "등록", "조회", "출력", "저장", "취소", "닫기", "입력", "선택",
    "건강", "보험", "연금", "세금", "급여", "수당", "상여", "퇴직", "휴가",
    "출장", "교육", "훈련", "평가", "승진", "전보", "파견", "겸직", "해임",
    "임명", "위촉", "해촉", "임기", "기간", "날짜", "제목", "내용", "비고",
    "합계", "소계", "금액", "단위", "수량", "단가", "총액", "부가세",
    # 빈출 비즈니스 서식 용어 및 OCR 오인식 단어 추가
    "사업자", "상호", "주업태명", "주종목명", "업태명", "종목명", "업태", "종목", "여두", "훈개발봉", "소재지", "사업장",
    # 서비스, 결제 관련 빈출 단어
    "월납", "서비스", "포인트", "마일리지", "할인", "결제", "납부", "청구", "조회",
    # 문서 섹션 표제어 합성어 (개별 단어는 있지만 합성어는 없었음)
    "인사공고", "인적사항", "발령사항", "기존이사", "변경사항", "해당사항",
    "현황사항", "처리사항", "확인사항", "결과사항", "인사발령", "인사현황",
    "발령현황", "직급현황", "직책현황", "인사내역", "발령내역", "직급변경",
    "직책변경", "현직현황", "현직이사", "신규이사", "기존직급", "변경직급",
    "사항없음", "해당없음", "내용없음", "비고없음",
    # 이력서/개인정보 양식 레이블 (직접 등재)
    "현주소", "자택주소", "회사주소", "재직기간", "근무기간", "재직회사",
    "신원확인", "신원조회", "제출처", "발급처", "수령처", "접수처",
    "작성일", "발급일", "유효기간", "서명란", "확인란", "날인란",
    "병역사항", "병역구분", "학력사항", "경력사항", "자격사항", "수상내역",
    "희망연봉", "희망직종", "희망부서", "지원부서", "지원동기",
    "보훈번호", "장애등급", "긴급연락", "비상연락",
}

# 이름이 아닌 단어의 접미사 (이 접미사로 끝나는 합성어는 무조건 이름 아님)
_NON_NAME_SUFFIXES = {
    "공고", "사항", "현황", "결과", "내역", "명단", "목록", "기준",
    "방법", "절차", "양식", "서식", "기록", "현황표", "명세", "내용",
    # 문서 레이블 접미사 (현주소·재직기간·신원확인·제출처 등 오탐 방지)
    "주소", "기간", "확인", "처", "지", "란", "일자", "날짜", "번호", "종류",
    "금액", "직종", "업종", "학교", "학과", "전공", "계열", "등급", "자격",
}


def _detect_standalone_names(ocr_pages: list, existing_results: list) -> list:
    """
    독립 라인에 2~4글자 한글만 있는 경우, 인접 라인 문맥으로 이름 여부 판단.
    LLM 없이 동작하는 fallback 방식.
    """
    results = list(existing_results)
    already_values = {(r["type"], r["value"]) for r in results}

    for page in ocr_pages:
        page_num = page["page_number"]
        lines = [l for l in page.get("lines", []) if l.get("text") and l.get("bbox")]

        for i, line in enumerate(lines):
            raw_text = line.get("text", "").strip()
            # OCR 공백 제거 후 순수 한글 2~4글자인지 확인
            collapsed = re.sub(r'\s+', '', raw_text)
            if not re.fullmatch(r'[가-힣]{2,4}', collapsed):
                continue
            if collapsed in _STANDALONE_NAME_BLACKLIST:
                continue
            # 문서 섹션 표제어 접미사로 끝나는 단어는 이름 아님
            # 예: 인사공고(→공고), 인적사항(→사항), 발령사항(→사항)
            if any(collapsed.endswith(s) for s in _NON_NAME_SUFFIXES):
                continue
            # 행정구역 접미사로 끝나는 단어는 인명이 아님
            if re.search(r'[시구군도읍면동]$', collapsed):
                continue
                
            # 조사/어미 및 버튼/동사형 패턴 제거 (4차에도 적용)
            if len(collapsed) == 2 and re.search(r'[하되어이의을를은는가나]$', collapsed):
                continue
            if re.search(r'(하기|가기|보기|도움말)$', collapsed):
                continue

            # 인접 라인(앞뒤 2줄) 중 직급/레이블이 있으면 이름으로 판단
            context_lines = lines[max(0, i-2):i] + lines[i+1:min(len(lines), i+3)]
            context_text = " ".join(l.get("text", "") for l in context_lines)
            context_collapsed = re.sub(r'\s+', '', context_text)

            is_name_context = any(kw in context_collapsed for kw in _JOB_TITLE_WORDS)
            # 인접 라인이 숫자(사번)인 경우도 이름 가능성 있음
            if not is_name_context:
                for cl in context_lines:
                    ct = cl.get("text", "").strip()
                    if re.fullmatch(r'\d{4,6}', re.sub(r'\s+', '', ct)):
                        is_name_context = True
                        break
            # 같은 페이지에 이미 다른 PII(전화·주민번호 등)가 감지된 경우 → 개인정보 양식 가능성 높음
            if not is_name_context:
                non_name_types = {"PHONE", "RRN", "FOREIGNER_REG_NO", "ACCOUNT_NO",
                                  "CREDIT_CARD", "BUSINESS_REG_NO", "EMAIL", "CAR_NO"}
                if any(r.get("page") == page_num and r.get("type") in non_name_types
                       for r in results):
                    is_name_context = True
            
            # [수정] 이 규칙이 "월납", "서비스" 등 문서 내 모든 2~4글자 단어를 이름으로 오탐하게 만드는 주범이므로 비활성화합니다.
            # (페이지에 다른 PII가 있다고 해서 무조건 이름으로 간주하지 않음)
            # if not is_name_context:
            #     ...

            if not is_name_context:
                continue

            # 이미 같은 value+bbox로 등록된 경우 스킵
            bbox = line.get("bbox")
            already = any(
                r["type"] == "NAME" and r["value"] == collapsed and r.get("bbox") == bbox
                for r in results
            )
            if already:
                continue

            results.append({
                "type": "NAME",
                "value": collapsed,
                "page": page_num,
                "bbox": bbox,
            })
            logger.info(f"[4차] 독립 이름 감지: '{collapsed}' (페이지 {page_num})")

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
    """type 내에서 value가 부분 문자열 관계인 경우 중복 제거."""
    def sc(s):
        return re.sub(r'[\s\-\n\r\t]', '', str(s))

    deduped = []
    for item in results:
        val = sc(item["value"])
        is_dup = False
        for existing in deduped:
            if existing["type"] != item["type"]:
                continue
            ex = sc(existing["value"])
            if val == ex or val in ex or ex in val:
                is_dup = True
                break
        if not is_dup:
            deduped.append(item)
    return deduped


def _validate_regex_names(results: list) -> list:
    """
    정규식으로 추출된 NAME 항목을 규칙 기반으로 검증.
    블랙리스트, 접미사 패턴, 조사/어미 패턴으로 오탐 제거.
    _context 임시 필드도 함께 정리.
    NAME이 아닌 타입은 그대로 통과.
    """
    before_count = sum(1 for r in results if r.get("type") == "NAME")
    filtered = []
    for r in results:
        r.pop("_context", None)
        if r["type"] != "NAME":
            filtered.append(r)
            continue

        collapsed = re.sub(r'\s+', '', r["value"])

        # 블랙리스트 체크
        if collapsed in _STANDALONE_NAME_BLACKLIST:
            logger.debug(f"[NAME 규칙 검증] 블랙리스트 제거: {r['value']}")
            continue

        # 접미사 필터 (인사공고, 발령사항 등 문서 표제어)
        if any(collapsed.endswith(s) for s in _NON_NAME_SUFFIXES):
            logger.debug(f"[NAME 규칙 검증] 접미사 패턴 제거: {r['value']}")
            continue

        # 2글자이고 조사/어미로 끝나면 제거
        if len(collapsed) == 2 and re.search(r'[하되어이의을를은는가나]$', collapsed):
            logger.debug(f"[NAME 규칙 검증] 조사/어미 패턴 제거: {r['value']}")
            continue

        # 동사형/버튼명 패턴 일괄 제거 (조회하기, 인쇄하기 등)
        if re.search(r'(하기|가기|보기|도움말)$', collapsed):
            logger.debug(f"[NAME 규칙 검증] 버튼/동사형 패턴 제거: {r['value']}")
            continue

        # 행정구역 접미사로 끝나는 단어는 인명이 아님
        if re.search(r'[시구군도읍면동]$', collapsed):
            logger.debug(f"[NAME 규칙 검증] 행정구역 접미사 제거: {r['value']}")
            continue

        filtered.append(r)

    after_count = sum(1 for r in filtered if r.get("type") == "NAME")
    logger.info(f"[NAME 규칙 검증] {before_count}개 중 {after_count}개 통과")
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
    """문자 시각적 너비 추정. 한글/한자 등 전각 문자는 2, 나머지는 1."""
    cp = ord(c)
    if (0x1100 <= cp <= 0x11FF   # 한글 자모
            or 0x3000 <= cp <= 0x9FFF   # CJK 기호/한자
            or 0xAC00 <= cp <= 0xD7A3   # 한글 완성형
            or 0xF900 <= cp <= 0xFAFF   # CJK 호환 한자
            or 0xFF01 <= cp <= 0xFF60): # 전각 ASCII
        return 2.0
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
