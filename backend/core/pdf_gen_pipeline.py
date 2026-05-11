#!/usr/bin/env python3
"""
한중일영 통합 OCR PDF 생성 파이프라인 (균형잡힌 텍스트 커버리지)
"""

# PaddlePaddle CPU 호환성 설정 (SIGILL 오류 방지)
import os
os.environ['PADDLE_FLAGS'] = 'use_mkldnn=false'
os.environ['OPENBLAS_CORETYPE'] = 'ZEN'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['PADDLE_NUM_THREADS'] = '1'
os.environ['FLAGS_use_mkldnn'] = '0'
os.environ['CPU_NUM_THREADS'] = '1'

import glob
import inspect
from pickle import TRUE
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import logging
from datetime import datetime
from collections import Counter
import tempfile
from typing import List, Dict, Any, Tuple, Optional

from paddleocr import PaddleOCR
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import Color

# 고급 감지를 위한 추가 라이브러리
try:
    from sklearn.cluster import DBSCAN
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

# PaddleOCR 3.x는 device 매개변수를 사용하므로 사전 감지
try:
    _PADDLE_OCR_SIGNATURE = inspect.signature(PaddleOCR.__init__)
    _PADDLE_OCR_SUPPORTS_USE_GPU = 'use_gpu' in _PADDLE_OCR_SIGNATURE.parameters
    _PADDLE_OCR_SUPPORTS_TEXT_REC_NAME = 'text_recognition_model_name' in _PADDLE_OCR_SIGNATURE.parameters
except (ValueError, TypeError):
    # 시그니처를 분석할 수 없는 경우(구버전)를 대비해 기본값 유지
    _PADDLE_OCR_SUPPORTS_USE_GPU = True
    _PADDLE_OCR_SUPPORTS_TEXT_REC_NAME = False


def _get_device_kwargs(use_gpu: bool) -> Dict[str, Any]:
    """PaddleOCR 버전에 맞는 디바이스 인수 생성"""
    if _PADDLE_OCR_SUPPORTS_USE_GPU:
        return {"use_gpu": use_gpu}

    device = 'gpu' if use_gpu else 'cpu'
    return {"device": device}


def _apply_custom_recognition_dir(ocr_params: Dict[str, Any], model_dir: str):
    """커스텀 인식 모델을 사용할 때 PaddleOCR 버전에 맞춰 파라미터 설정"""
    if not model_dir:
        return
    # PaddleOCR 3.x에서는 text_recognition_model_dir 사용
    ocr_params["text_recognition_model_dir"] = model_dir
    if _PADDLE_OCR_SUPPORTS_TEXT_REC_NAME:
        # 공식 모델 이름을 비워 커스텀 가중치를 우선 적용
        ocr_params["text_recognition_model_name"] = None


def _resolve_gpu_device_id() -> Optional[str]:
    """현재 설정에서 원하는 GPU ID를 문자열로 반환"""
    gpu_id = CONFIG.get('GPU_DEVICE_ID')
    try:
        if 'config_manager' in globals() and config_manager is not None:
            if hasattr(config_manager, 'get_gpu_id'):
                cfg_value = config_manager.get_gpu_id()
            else:
                cfg_value = config_manager.get('ocr.gpu_id', gpu_id)
            if cfg_value is not None:
                gpu_id = cfg_value
    except Exception:
        pass

    if gpu_id is None:
        return None

    gpu_str = str(gpu_id).strip()
    return gpu_str if gpu_str else None


def _set_cuda_device_env(gpu_device_id: Optional[str], use_gpu: bool):
    """CUDA_VISIBLE_DEVICES를 설정하여 원하는 GPU만 노출"""
    if use_gpu:
        if gpu_device_id:
            os.environ['CUDA_VISIBLE_DEVICES'] = gpu_device_id
        elif not os.environ.get('CUDA_VISIBLE_DEVICES'):
            os.environ['CUDA_VISIBLE_DEVICES'] = '0'
    else:
        os.environ['CUDA_VISIBLE_DEVICES'] = ''


# config_manager를 통해 설정 로드
try:
    from core.config_manager import create_legacy_config, config_manager
    CONFIG = create_legacy_config()
except ImportError:
    config_manager = None
    # config_manager is required; raise if not available
    raise ImportError("config_manager module is required. Ensure config.yaml exists at project root.")

def recover_missed_text_blocks(image_path, ocr_results, confidence_threshold=0.2, ocr_instance=None):
    """OCR에서 누락된 텍스트 블록 복구"""
    
    # 안전한 설정 접근
    text_coverage = CONFIG.get('TEXT_COVERAGE', {})
    if not text_coverage.get('ENABLE_TEXT_RECOVERY', False):
        return ocr_results
    
    try:
        image = cv2.imread(image_path)
        if image is None:
            return ocr_results
        
        # 이미지 전처리로 작은 텍스트 강화
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # 적응형 이진화
        adaptive_thresh = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
        )
        
        # 형태학적 연산
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        processed = cv2.morphologyEx(adaptive_thresh, cv2.MORPH_CLOSE, kernel)
        
        # 임시 파일로 저장
        temp_path = image_path.replace('.png', '_enhanced.png').replace('.jpg', '_enhanced.jpg')
        cv2.imwrite(temp_path, processed)
        
        # 기존 OCR 인스턴스 재사용 또는 새로 생성
        if ocr_instance is not None:
            ocr_sensitive = ocr_instance
        else:
            # 더 민감한 OCR 재실행 (기존 방식)
            gpu_device_id = _resolve_gpu_device_id()
            _set_cuda_device_env(gpu_device_id, True)
            ocr_sensitive = PaddleOCR(
                **_get_device_kwargs(True),  # GPU 사용 (SIGILL 오류 회피)
                use_angle_cls=True,
                lang='korean',
                det_limit_type='min',
                det_limit_side_len=100,
                enable_mkldnn=False,  # MKLDNN 비활성화 (SIGILL 오류 방지)
            )
        
        try:
            enhanced_results = ocr_sensitive.ocr(temp_path)
        except TypeError as e:
            if 'cls' in str(e):
                # PaddleOCR 버전 호환성 문제 해결
                self.logger.warning("OCR cls 인수 오류 감지, 기본 호출로 재시도")
                enhanced_results = ocr_sensitive.ocr(temp_path)
            else:
                raise
        
        # 기존 결과와 병합
        if enhanced_results and enhanced_results[0]:
            additional_blocks = []
            existing_boxes = [block['bbox'] for block in ocr_results]
            
            for result in enhanced_results[0]:
                box, (text, confidence) = result
                if confidence >= confidence_threshold and text.strip():
                    # bbox 변환
                    x_coords = [point[0] for point in box]
                    y_coords = [point[1] for point in box]
                    bbox = (min(x_coords), min(y_coords), max(x_coords), max(y_coords))
                    
                    # 기존 박스와 중복 확인
                    is_duplicate = False
                    for existing_bbox in existing_boxes:
                        if _boxes_overlap(bbox, existing_bbox, threshold=0.5):
                            is_duplicate = True
                            break
                    
                    if not is_duplicate:
                        additional_blocks.append({
                            'bbox': bbox,
                            'text': text.strip(),
                            'score': confidence
                        })
            
            # 결과 병합
            ocr_results.extend(additional_blocks)
            
            logging.info(f"추가 복구된 텍스트 블록: {len(additional_blocks)}개")
        
        # 임시 파일 삭제
        if os.path.exists(temp_path):
            os.unlink(temp_path)
            
    except Exception as e:
        logging.warning(f"텍스트 복구 실패: {e}")
    
    return ocr_results

def _boxes_overlap(box1, box2, threshold=0.5):
    """두 박스의 겹침 정도 확인"""
    x1_min, y1_min, x1_max, y1_max = box1
    x2_min, y2_min, x2_max, y2_max = box2
    
    # 교집합 계산
    intersect_x_min = max(x1_min, x2_min)
    intersect_y_min = max(y1_min, y2_min)
    intersect_x_max = min(x1_max, x2_max)
    intersect_y_max = min(y1_max, y2_max)
    
    if intersect_x_max <= intersect_x_min or intersect_y_max <= intersect_y_min:
        return False
    
    intersect_area = (intersect_x_max - intersect_x_min) * (intersect_y_max - intersect_y_min)
    box1_area = (x1_max - x1_min) * (y1_max - y1_min)
    box2_area = (x2_max - x2_min) * (y2_max - y2_min)
    
    overlap_ratio = intersect_area / min(box1_area, box2_area)
    return overlap_ratio > threshold

class SuperiorColumnDetector:
    """다단 감지기"""
    
    def __init__(self, debug_output_dir=None, enable_debug=False):
        self.logger = logging.getLogger(__name__)
        self.debug_output_dir = Path(debug_output_dir) if debug_output_dir else None
        self.enable_debug = enable_debug
        if self.enable_debug and self.debug_output_dir:
            self.debug_output_dir.mkdir(parents=True, exist_ok=True)
    
    def detect_layout_comprehensive(self, text_blocks, img_width, img_height, image_name="", debug=False):
        """종합 다단 레이아웃 감지"""
        
        min_blocks = CONFIG.get('COLUMN_DETECTION', {}).get('MIN_BLOCKS_FOR_DETECTION', 4)
        if len(text_blocks) < min_blocks:
            result = {
                'is_double_column': False,
                'confidence': 0.0,
                'method': 'insufficient_blocks',
                'column_boundary': img_width / 2,
                'left_blocks': [],
                'right_blocks': [],
                'details': f'블록 수 부족: {len(text_blocks)}개'
            }
            
            # 텍스트 블록이 부족해도 디버그 이미지는 생성
            if debug and self.enable_debug and self.debug_output_dir and text_blocks:
                try:
                    original_image_path = getattr(self, 'current_image_path', None)
                    debug_path = self._generate_debug_visualization(
                        text_blocks, img_width, img_height, result, image_name, original_image_path
                    )
                    if debug_path:
                        print(f"디버그 이미지 생성 성공 (블록 부족 상황): {debug_path}")
                except Exception as debug_error:
                    print(f"디버그 이미지 생성 중 오류 (블록 부족 상황): {debug_error}")
                    import traceback
                    traceback.print_exc()
            
            return result
        
        methods_results = []
        
        # 1. bbox 길이 기반 분석
        bbox_analysis_result = self._analyze_x_coordinate_distribution(text_blocks, img_width, debug)
        methods_results.append(bbox_analysis_result)
        
        # 2. 세로 빈 공간 패턴 분석
        vertical_gap_result = self._analyze_vertical_empty_space(text_blocks, img_width, img_height, debug)
        methods_results.append(vertical_gap_result)
        
        # 3. 클러스터링 기반 분석
        if SKLEARN_AVAILABLE:
            clustering_result = self._clustering_based_analysis(text_blocks, img_width, debug)
            methods_results.append(clustering_result)
        
        # 4. 텍스트 라인 시작점 패턴 분석
        line_start_result = self._analyze_text_line_patterns(text_blocks, img_width, debug)
        methods_results.append(line_start_result)
        
        # 5. 결과 종합
        final_result = self._synthesize_detection_results(
            methods_results, text_blocks, img_width, img_height, image_name, debug
        )
        
        return final_result
    
    def _analyze_x_coordinate_distribution(self, text_blocks, img_width, debug=False):
        """본문 텍스트 bbox 길이 기반 칼럼 분석 (사용자 제안)"""
        self.logger.info(f"🚀 bbox_width_analysis 시작: {len(text_blocks)}개 블록, 페이지 너비={img_width}px")

        try:
            if not text_blocks:
                return {'is_double_column': False, 'confidence': 0.0, 'method': 'bbox_analysis', 'column_boundary': img_width / 2}

            # 페이지 너비의 50% 기준점
            half_width = img_width * 0.5

            # bbox 길이 분석
            short_bboxes = []  # 페이지의 50% 미만
            long_bboxes = []   # 페이지의 50% 이상

            for i, block in enumerate(text_blocks):
                bbox = block['bbox']
                bbox_width = bbox[2] - bbox[0]  # x2 - x0
                width_ratio = bbox_width / img_width

                if bbox_width < half_width:
                    short_bboxes.append({
                        'index': i,
                        'bbox': bbox,
                        'width': bbox_width,
                        'ratio': width_ratio,
                        'center_x': (bbox[0] + bbox[2]) / 2
                    })
                else:
                    long_bboxes.append({
                        'index': i,
                        'bbox': bbox,
                        'width': bbox_width,
                        'ratio': width_ratio
                    })

            total_blocks = len(text_blocks)
            short_ratio = len(short_bboxes) / total_blocks
            long_ratio = len(long_bboxes) / total_blocks

            self.logger.info(f"📊 bbox 분석: 짧은bbox {len(short_bboxes)}개({short_ratio:.2f}), 긴bbox {len(long_bboxes)}개({long_ratio:.2f})")

            # 1. 단일칼럼 판정: 70% 이상이 페이지 너비의 50%를 초과
            if long_ratio >= 0.7:
                self.logger.info(f"📋 단일칼럼 판정: 긴bbox {long_ratio:.2f} >= 0.7")
                return {
                    'is_double_column': False,
                    'confidence': long_ratio,
                    'method': 'bbox_analysis',
                    'column_boundary': img_width / 2,
                    'details': {
                        'short_ratio': short_ratio,
                        'long_ratio': long_ratio,
                        'analysis': 'single_column_by_long_bbox'
                    }
                }

            # 2. 더블칼럼 후보 조건: 70% 이상이 페이지 너비의 50% 미만
            if short_ratio >= 0.7 and len(short_bboxes) >= 4:
                # 좌우 균형 분석
                page_center = img_width / 2
                left_blocks = [b for b in short_bboxes if b['center_x'] < page_center]
                right_blocks = [b for b in short_bboxes if b['center_x'] > page_center]

                left_ratio = len(left_blocks) / len(short_bboxes) if short_bboxes else 0
                right_ratio = len(right_blocks) / len(short_bboxes) if short_bboxes else 0

                self.logger.info(f"📊 좌우분포 분석: 좌측 {len(left_blocks)}개, 우측 {len(right_blocks)}개")
                self.logger.info(f"📊 좌우비율: L:{left_ratio:.2f}/R:{right_ratio:.2f}")

                # 좌우 균형 조건: 각각 최소 30% 이상
                if left_ratio >= 0.3 and right_ratio >= 0.3:
                    balance_score = 1.0 - abs(left_ratio - right_ratio)  # 균형도 점수
                    confidence = min(0.95, short_ratio * balance_score)

                    # 실제 칼럼 경계 찾기
                    real_boundary = self._find_real_column_gap(text_blocks, img_width, 600)  # 임시값

                    self.logger.info(f"📋 더블칼럼 판정: 짧은bbox {short_ratio:.2f} >= 0.7, 좌우균형 L:{left_ratio:.2f}/R:{right_ratio:.2f}")
                    return {
                        'is_double_column': True,
                        'confidence': confidence,
                        'method': 'bbox_analysis',
                        'column_boundary': real_boundary,
                        'details': {
                            'short_ratio': short_ratio,
                            'long_ratio': long_ratio,
                            'left_ratio': left_ratio,
                            'right_ratio': right_ratio,
                            'balance_score': balance_score,
                            'analysis': 'double_column_by_short_bbox_and_balance'
                        }
                    }

            # 3. 기본값: 단일칼럼
            self.logger.info(f"📋 기본 단일칼럼 판정: 조건 미충족")
            return {
                'is_double_column': False,
                'confidence': 0.3,
                'method': 'bbox_analysis',
                'column_boundary': img_width / 2,
                'details': {
                    'short_ratio': short_ratio,
                    'long_ratio': long_ratio,
                    'analysis': 'default_single_column'
                }
            }

        except Exception as e:
            self.logger.error(f"bbox 분석 중 오류: {e}")
            return {
                'is_double_column': False,
                'confidence': 0.0,
                'method': 'bbox_analysis_error',
                'column_boundary': img_width / 2,
                'details': {'error': str(e)}
            }
    
    def _analyze_vertical_empty_space(self, text_blocks, img_width, img_height, debug=False):
        """세로 빈 공간 분석 (본문 텍스트 기반 개선)"""
        try:
            # 임시로 본문 필터링 비활성화 - 전체 텍스트 사용
            analysis_blocks = text_blocks
            
            n_slices = 120
            slice_width = img_width / n_slices
            slice_density = [0] * n_slices
            
            for block in analysis_blocks:
                bbox = block['bbox']
                x0, x1 = bbox[0], bbox[2]
                height = bbox[3] - bbox[1]
                
                start_slice = max(0, int(x0 / slice_width))
                end_slice = min(n_slices - 1, int(x1 / slice_width))
                
                for slice_idx in range(start_slice, end_slice + 1):
                    slice_density[slice_idx] += height
            
            # 정규화 및 스무딩
            if max(slice_density) > 0:
                slice_density = [d / max(slice_density) for d in slice_density]
            
            window_size = 5
            smoothed_density = []
            for i in range(len(slice_density)):
                start = max(0, i - window_size // 2)
                end = min(len(slice_density), i + window_size // 2 + 1)
                smoothed_density.append(sum(slice_density[start:end]) / (end - start))
            
            middle_start = int(n_slices * 0.25)
            middle_end = int(n_slices * 0.75)
            middle_density = smoothed_density[middle_start:middle_end]
            
            if middle_density:
                min_density = min(middle_density)
                min_idx = middle_density.index(min_density) + middle_start
                gap_position = (min_idx + 0.5) * slice_width
                
                left_density = np.mean(smoothed_density[:middle_start]) if middle_start > 0 else 0
                right_density = np.mean(smoothed_density[middle_end:]) if middle_end < len(smoothed_density) else 0
                
                if debug:
                    print(f"세로빈공간: 위치 {gap_position:.1f}px, "
                          f"최소밀도 {min_density:.2f}, 좌우밀도 {left_density:.2f}/{right_density:.2f}")
                
                is_double_column = (
                    min_density < 0.15 and 
                    left_density > 0.25 and 
                    right_density > 0.25
                )
                
                if is_double_column:
                    confidence = min(0.85, (left_density + right_density - min_density * 2))
                    
                    # 🔧 실제 칼럼 간격 분석으로 정확한 경계 찾기
                    refined_boundary = self._find_real_column_gap(text_blocks, img_width, img_height)
                    
                    return {
                        'is_double_column': True,
                        'confidence': confidence,
                        'method': 'vertical_gap',
                        'column_boundary': refined_boundary,
                        'details': {
                            'gap_position': gap_position,
                            'min_density': min_density,
                            'left_density': left_density,
                            'right_density': right_density
                        }
                    }
            
            return {
                'is_double_column': False,
                'confidence': 0.1,
                'method': 'vertical_gap',
                'column_boundary': img_width / 2,
                'details': {'no_clear_gap': True}
            }
            
        except Exception as e:
            return {
                'is_double_column': False,
                'confidence': 0.0,
                'method': 'vertical_gap_error',
                'column_boundary': img_width / 2,
                'details': {'error': str(e)}
            }
    
    def _clustering_based_analysis(self, text_blocks, img_width, debug=False):
        """클러스터링 기반 분석 (본문 텍스트 기반 개선)"""
        try:
            # 임시로 본문 필터링 비활성화 - 전체 텍스트 사용
            analysis_blocks = text_blocks
            
            x_centers = np.array([[
                (block['bbox'][0] + block['bbox'][2]) / 2
            ] for block in analysis_blocks])
            
            eps = max(30, img_width * 0.08)
            clustering = DBSCAN(eps=eps, min_samples=3).fit(x_centers)
            labels = clustering.labels_
            
            unique_labels = set(labels)
            valid_clusters = [label for label in unique_labels if label != -1]
            noise_count = sum(1 for label in labels if label == -1)
            
            if debug:
                print(f"클러스터링: {len(valid_clusters)}개 클러스터, {noise_count}개 노이즈")
            
            if len(valid_clusters) >= 2:
                cluster_info = []
                for label in valid_clusters:
                    cluster_points = x_centers[labels == label]
                    center = float(np.mean(cluster_points))
                    size = len(cluster_points)
                    cluster_info.append((center, size))
                
                cluster_info.sort(key=lambda x: x[0])
                
                if len(cluster_info) >= 2:
                    left_center, left_size = cluster_info[0]
                    right_center, right_size = cluster_info[-1]
                    gap = right_center - left_center
                    
                    min_gap = img_width * 0.2
                    min_cluster_size = max(2, len(text_blocks) * 0.2)
                    
                    is_double_column = (
                        gap >= min_gap and
                        left_size >= min_cluster_size and
                        right_size >= min_cluster_size
                    )
                    
                    if is_double_column:
                        # 더 직관적인 신뢰도 계산: 간격 크기와 클러스터 균형도 기반
                        gap_score = min(0.4, gap / (img_width * 0.15))  # 간격이 클수록 높은 점수
                        balance_score = min(0.4, 1.0 - abs(left_size - right_size) / max(left_size, right_size))  # 균형이 좋을수록 높은 점수
                        confidence = gap_score + balance_score
                        # 🔧 실제 칼럼 간격 분석으로 정확한 경계 찾기
                        column_boundary = self._find_real_column_gap(text_blocks, img_width, img_height)
                        
                        return {
                            'is_double_column': True,
                            'confidence': confidence,
                            'method': 'clustering',
                            'column_boundary': column_boundary,
                            'details': {
                                'n_clusters': len(valid_clusters),
                                'gap': gap,
                                'left_center': left_center,
                                'right_center': right_center,
                                'left_size': left_size,
                                'right_size': right_size
                            }
                        }
            
            return {
                'is_double_column': False,
                'confidence': 0.1,
                'method': 'clustering',
                'column_boundary': img_width / 2,
                'details': {'n_clusters': len(valid_clusters)}
            }
            
        except Exception as e:
            return {
                'is_double_column': False,
                'confidence': 0.0,
                'method': 'clustering_error',
                'column_boundary': img_width / 2,
                'details': {'error': str(e)}
            }
    
    def _analyze_text_line_patterns(self, text_blocks, img_width, debug=False):
        """텍스트 라인 시작점 패턴 분석 (본문 텍스트 기반 개선)"""
        try:
            # 임시로 본문 필터링 비활성화 - 전체 텍스트 사용
            analysis_blocks = text_blocks
            
            start_x_coords = [block['bbox'][0] for block in analysis_blocks]
            
            tolerance = 25
            rounded_coords = [round(x / tolerance) * tolerance for x in start_x_coords]
            coord_counts = Counter(rounded_coords)
            
            most_common = coord_counts.most_common(5)
            
            if debug:
                print(f"라인 시작점: {most_common[:3]}")
            
            if len(most_common) >= 2:
                positions_and_counts = [(pos, count) for pos, count in most_common]
                positions_and_counts.sort(key=lambda x: x[0])
                
                for i in range(len(positions_and_counts) - 1):
                    for j in range(i + 1, len(positions_and_counts)):
                        pos1, count1 = positions_and_counts[i]
                        pos2, count2 = positions_and_counts[j]
                        
                        distance = abs(pos2 - pos1)
                        total_lines = len(text_blocks)
                        combined_ratio = (count1 + count2) / total_lines
                        
                        min_distance = img_width * 0.15
                        min_ratio = 0.5
                        
                        if distance >= min_distance and combined_ratio >= min_ratio:
                            confidence = min(0.75, combined_ratio * distance / (img_width * 0.3))
                            
                            # 🔧 실제 칼럼 간격 분석으로 정확한 경계 찾기
                            column_boundary = self._find_real_column_gap(text_blocks, img_width, 1000)
                            
                            return {
                                'is_double_column': True,
                                'confidence': confidence,
                                'method': 'line_patterns',
                                'column_boundary': column_boundary,
                                'details': {
                                    'pattern_ratio': combined_ratio,
                                    'distance': distance,
                                    'positions': [pos1, pos2],
                                    'counts': [count1, count2]
                                }
                            }
            
            return {
                'is_double_column': False,
                'confidence': 0.1,
                'method': 'line_patterns',
                'column_boundary': img_width / 2,
                'details': {'patterns': most_common}
            }
            
        except Exception as e:
            return {
                'is_double_column': False,
                'confidence': 0.0,
                'method': 'line_patterns_error',
                'column_boundary': img_width / 2,
                'details': {'error': str(e)}
            }
    
    def _find_real_column_gap(self, text_blocks: List[Dict], img_width: int, img_height: int) -> float:
        """🚀 혁신적 칼럼 간격 찾기 - 텍스트 블록 끝점 기반"""
        if len(text_blocks) < 4:
            return img_width / 2
        
        # 페이지 중앙 부분의 텍스트만 분석 (머리말/꼬리말 제외)
        center_blocks = []
        for block in text_blocks:
            bbox = block['bbox']
            y_center = (bbox[1] + bbox[3]) / 2
            
            # 페이지 중앙 60% 영역만 사용
            if img_height * 0.2 < y_center < img_height * 0.8:
                center_blocks.append(bbox)
        
        if len(center_blocks) < 4:
            center_blocks = [block['bbox'] for block in text_blocks]
        
        # 좌측/우측 텍스트 그룹 분리 시도
        x_centers = [(bbox[0] + bbox[2]) / 2 for bbox in center_blocks]
        x_centers.sort()
        
        # 중간점을 기준으로 좌우 분할
        mid_point = img_width / 2
        left_blocks = [bbox for bbox in center_blocks if (bbox[0] + bbox[2]) / 2 < mid_point]
        right_blocks = [bbox for bbox in center_blocks if (bbox[0] + bbox[2]) / 2 > mid_point]
        
        if len(left_blocks) >= 2 and len(right_blocks) >= 2:
            # 좌측 블록들의 가장 오른쪽 끝
            left_rightmost = max(bbox[2] for bbox in left_blocks)
            # 우측 블록들의 가장 왼쪽 시작
            right_leftmost = min(bbox[0] for bbox in right_blocks)
            
            if left_rightmost < right_leftmost:
                # 실제 간격이 존재하는 경우
                gap_center = (left_rightmost + right_leftmost) / 2
                gap_width = right_leftmost - left_rightmost
                
                # Debug: 실제 칼럼 간격 발견
                return gap_center
        
        # 대안: 텍스트 밀도가 가장 낮은 지점 찾기
        
        # 전체 X축을 100개 구간으로 나누어 밀도 계산
        n_bins = 100
        bin_width = img_width / n_bins
        density = [0] * n_bins
        
        for bbox in center_blocks:
            x1, x2 = bbox[0], bbox[2]
            start_bin = int(x1 / bin_width)
            end_bin = int(x2 / bin_width)
            
            for i in range(max(0, start_bin), min(n_bins, end_bin + 1)):
                density[i] += 1
        
        # 가장 밀도가 낮은 연속 구간 찾기
        min_density = min(density)
        candidates = []
        
        for i, d in enumerate(density):
            if d == min_density:
                x_pos = (i + 0.5) * bin_width
                # 페이지 중앙 30%-70% 범위 내의 후보만 고려
                if img_width * 0.3 < x_pos < img_width * 0.7:
                    candidates.append(x_pos)
        
        if candidates:
            # 가장 중앙에 가까운 위치 선택
            best_candidate = min(candidates, key=lambda x: abs(x - img_width / 2))
            return best_candidate

        # 칼럼 간격을 찾지 못함, 기본값 사용
        return img_width / 2
    
    def _synthesize_detection_results(self, results, text_blocks, img_width, img_height, image_name="", debug=False):
        """감지 결과 종합"""
        
        method_weights = {
            'x_distribution': 0.45,
            'vertical_gap': 0.30,
            'clustering': 0.15,
            'line_patterns': 0.10
        }
        
        positive_votes = 0
        total_votes = 0
        weighted_confidence_sum = 0.0
        best_result = None
        best_confidence = 0.0
        
        for result in results:
            if result['method'].endswith('_error'):
                continue
            
            total_votes += 1
            method = result['method']
            weight = method_weights.get(method, 0.05)
            confidence = result['confidence']
            
            if result['is_double_column']:
                positive_votes += 1
                weighted_confidence_sum += confidence * weight
                
                if confidence > best_confidence:
                    best_confidence = confidence
                    best_result = result
        
        confidence_threshold = CONFIG.get('COLUMN_DETECTION', {}).get('CONFIDENCE_THRESHOLD', 0.05)  # 임시로 낮춤
        # 더 관대한 판단: 1개 이상 방법이 더블칼럼으로 판단하고 신뢰도가 임계값 이상이면 OK
        min_positive_votes = 1
        
        # 🚀 임시로 더 관대한 조건: 1표만 받아도 더블칼럼으로 판단
        is_double_column = (positive_votes >= min_positive_votes)
        
        if debug:
            self.logger.debug(f"종합판단: {positive_votes}/{total_votes}표, "
                  f"가중신뢰도: {weighted_confidence_sum:.3f}")
            self.logger.debug(f"더블칼럼 감지 결과: {is_double_column} "
                  f"(조건: {positive_votes} >= {min_positive_votes} and {weighted_confidence_sum:.3f} >= {confidence_threshold})")
        
        if is_double_column and best_result:
            column_boundary = best_result['column_boundary']
            left_blocks_indices = []
            right_blocks_indices = []
            
            for i, block in enumerate(text_blocks):
                bbox = block['bbox']
                center_x = (bbox[0] + bbox[2]) / 2
                
                if center_x < column_boundary:
                    left_blocks_indices.append(i)
                else:
                    right_blocks_indices.append(i)
            
            result = {
                'is_double_column': True,
                'confidence': weighted_confidence_sum,
                'method': f"synthesized({best_result['method']})",
                'column_boundary': column_boundary,
                'left_blocks': left_blocks_indices,
                'right_blocks': right_blocks_indices,
                'details': {
                    'votes': f"{positive_votes}/{total_votes}",
                    'weighted_confidence': weighted_confidence_sum,
                    'best_method': best_result['method'],
                    'all_results': results
                }
            }
        else:
            result = {
                'is_double_column': False,
                'confidence': 1.0 - weighted_confidence_sum,
                'method': 'synthesized(negative)',
                'column_boundary': img_width / 2,
                'left_blocks': [],
                'right_blocks': [],
                'details': {
                    'votes': f"{positive_votes}/{total_votes}",
                    'weighted_confidence': weighted_confidence_sum,
                    'all_results': results
                }
            }
        
        # 디버그 이미지 생성 (컬럼 감지 성공/실패와 관계없이)
        if debug and self.enable_debug and self.debug_output_dir:
            try:
                # 현재 이미지 경로 가져오기
                original_image_path = getattr(self, 'current_image_path', None)
                debug_path = self._generate_debug_visualization(
                    text_blocks, img_width, img_height, result, image_name, original_image_path
                )
                if debug_path:
                    print(f"디버그 이미지 생성 성공: {debug_path}")
                else:
                    print("디버그 이미지 생성 실패: 경로가 반환되지 않음")
            except Exception as debug_error:
                print(f"디버그 이미지 생성 중 오류: {debug_error}")
                import traceback
                traceback.print_exc()
        
        return result
    
    def _generate_debug_visualization(self, text_blocks, img_width, img_height, result, image_name, original_image_path=None):
        """디버그 시각화 이미지 생성 - OCR 모델 결과 전용"""
        try:
            # OCR 결과 시각화를 위한 밝은 회색 배경 생성 (원본 이미지 대신)
            img = Image.new('RGB', (img_width, img_height), '#f5f5f5')
            
            # 직접 그리기 (오버레이 없이)
            draw = ImageDraw.Draw(img)
            
            # 한글 지원 폰트 로드 시도
            font_small = None
            font_large = None
            
            # 한글 폰트 경로 목록 (우선순위)
            korean_font_paths = [
                "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                "/System/Library/Fonts/AppleGothic.ttf",
                "C:/Windows/Fonts/malgun.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
            ]
            
            for font_path in korean_font_paths:
                try:
                    if os.path.exists(font_path):
                        font_small = ImageFont.truetype(font_path, 14)  # 크기 증가
                        font_large = ImageFont.truetype(font_path, 18)  # 크기 증가
                        break
                except:
                    continue
            
            # 폰트 로드 실패 시 기본 폰트 사용
            if font_small is None:
                try:
                    font_small = ImageFont.load_default()
                    font_large = ImageFont.load_default()
                except:
                    pass
            
            for i, block in enumerate(text_blocks):
                bbox = block['bbox']
                text = block.get('text', '').strip()
                score = block.get('score', 1.0)
                is_vertical_text = block.get('is_vertical_text', False) or block.get('is_vertical_line', False)
                
                # 세로쓰기 블록과 일반 블록의 색상 구분
                if is_vertical_text:
                    # 세로쓰기 라인: 파란색 계열
                    if score >= 0.8:
                        box_color = (0, 100, 200)  # 파란색 - 높은 정확도
                        text_bg_color = (0, 80, 180)
                    elif score >= 0.6:
                        box_color = (100, 150, 200)  # 연한 파란색 - 중간 정확도
                        text_bg_color = (80, 130, 180)
                    else:
                        box_color = (150, 150, 200)  # 회색빛 파란색 - 낮은 정확도
                        text_bg_color = (130, 130, 180)
                else:
                    # 일반 블록: 기존 색상
                    if score >= 0.8:
                        box_color = (0, 180, 0)  # 진한 초록색 - 높은 정확도
                        text_bg_color = (0, 150, 0)
                    elif score >= 0.6:
                        box_color = (200, 150, 0)  # 주황색 - 중간 정확도
                        text_bg_color = (180, 130, 0)
                    else:
                        box_color = (200, 0, 0)  # 빨간색 - 낮은 정확도  
                        text_bg_color = (180, 0, 0)
                
                # 바운딩 박스 그리기 (세로쓰기 블록은 더 두꺼운 테두리)
                line_width = 6 if is_vertical_text else 4
                draw.rectangle(bbox, outline=box_color, width=line_width)
                
                # OCR 인식된 텍스트를 바운딩 박스 내부에 완전히 표시
                if text and text.strip():  # 빈 문자열 체크 강화
                    # 박스 크기 확인
                    box_width = bbox[2] - bbox[0]
                    box_height = bbox[3] - bbox[1]
                    
                    # 작은 박스도 포함 (OCR 모델 결과를 완전히 보여주기 위함)
                    if box_width > 10 and box_height > 5:
                        # 텍스트 전처리 (특수문자 및 공백 정리)
                        clean_text = text.strip()
                        if clean_text:
                            # 원본 텍스트 사용 (단순화)
                            display_text = clean_text
                            
                            # 폰트가 있을 때 동적 크기 조정
                            if font_small:
                                # 박스에 맞는 최적 폰트 크기 찾기
                                optimal_font_size = self._find_optimal_font_size_for_text(
                                    display_text, box_width, box_height, 
                                    min_size=8, max_size=24
                                )
                                
                                if optimal_font_size > 0:
                                    try:
                                        # 최적 폰트로 다시 생성
                                        optimal_font = self._get_font_by_size(optimal_font_size)
                                        if optimal_font:
                                            # 최적 폰트로 텍스트 크기 재측정
                                            text_bbox = draw.textbbox((0, 0), display_text, font=optimal_font)
                                            text_width = text_bbox[2] - text_bbox[0]
                                            text_height = text_bbox[3] - text_bbox[1]
                                            
                                            # 텍스트 위치 계산 (박스 중앙 정렬)
                                            text_x = bbox[0] + max(2, (box_width - text_width) // 2)
                                            text_y = bbox[1] + max(2, (box_height - text_height) // 2)
                                            
                                            # 텍스트 배경 (반투명 흰색)
                                            bg_padding = 1
                                            bg_bbox = (
                                                text_x - bg_padding, 
                                                text_y - bg_padding, 
                                                text_x + text_width + bg_padding, 
                                                text_y + text_height + bg_padding
                                            )
                                            draw.rectangle(bg_bbox, fill=(255, 255, 255, 200), outline=(200, 200, 200))
                                            
                                            # OCR 인식 텍스트 그리기 (세로쓰기 지원)
                                            is_vertical_debug = block.get('is_vertical_text', False)
                                            if is_vertical_debug:
                                                # 세로쓰기: 각 글자를 세로로 배치
                                                print(f"🔍 디버그 세로쓰기: '{display_text}' at ({text_x}, {text_y})")
                                                self._draw_vertical_debug_text_chars(draw, display_text, text_x, text_y, optimal_font)
                                            else:
                                                # 가로쓰기: 일반 텍스트
                                                draw.text((text_x, text_y), display_text, fill=(0, 0, 0), font=optimal_font)
                                        else:
                                            # 폰트 생성 실패시 기본 폰트 사용
                                            is_vertical_debug = block.get('is_vertical_text', False)
                                            if is_vertical_debug:
                                                self._draw_vertical_debug_text_chars(draw, display_text, bbox[0] + 2, bbox[1] + 2, font_small)
                                            else:
                                                draw.text((bbox[0] + 2, bbox[1] + 2), display_text, fill=(0, 0, 0), font=font_small)
                                    except Exception as font_error:
                                        # 폰트 오류 시 기본 처리 (텍스트는 반드시 표시)
                                        try:
                                            is_vertical_debug = block.get('is_vertical_text', False)
                                            if is_vertical_debug:
                                                self._draw_vertical_debug_text_chars(draw, display_text, bbox[0] + 2, bbox[1] + 2, None)
                                            else:
                                                draw.text((bbox[0] + 2, bbox[1] + 2), display_text, fill=(0, 0, 0))
                                        except:
                                            # 마지막 폴백: 텍스트 요약
                                            fallback_text = clean_text[:5] if len(clean_text) > 5 else clean_text
                                            draw.text((bbox[0] + 1, bbox[1] + 1), fallback_text, fill=(0, 0, 0))
                                else:
                                    # 기본 폰트로 전체 텍스트 표시 시도
                                    try:
                                        is_vertical_debug = block.get('is_vertical_text', False)
                                        if is_vertical_debug:
                                            self._draw_vertical_debug_text_chars(draw, display_text, bbox[0] + 2, bbox[1] + 2, None)
                                        else:
                                            draw.text((bbox[0] + 2, bbox[1] + 2), display_text, fill=(0, 0, 0))
                                    except:
                                        pass
                            else:
                                # 폰트가 없을 때도 전체 텍스트 표시 시도
                                try:
                                    is_vertical_debug = block.get('is_vertical_text', False)
                                    if is_vertical_debug:
                                        self._draw_vertical_debug_text_chars(draw, display_text, bbox[0] + 2, bbox[1] + 2, None)
                                    else:
                                        draw.text((bbox[0] + 2, bbox[1] + 2), display_text, fill=(0, 0, 0))
                                except:
                                    pass
                
                # 정확도 표시 (우상단 코너)
                if font_small:
                    acc_text = f"{score:.3f}"
                    try:
                        acc_bbox = draw.textbbox((0, 0), acc_text, font=font_small)
                        acc_width = acc_bbox[2] - acc_bbox[0]
                        acc_height = acc_bbox[3] - acc_bbox[1]
                        
                        acc_x = bbox[2] - acc_width - 4
                        acc_y = bbox[1] + 2
                        
                        # 정확도 배경 (색상별)
                        bg_bbox = (acc_x - 2, acc_y - 1, acc_x + acc_width + 2, acc_y + acc_height + 1)
                        draw.rectangle(bg_bbox, fill=text_bg_color)
                        
                        # 정확도 텍스트 (흰색)
                        draw.text((acc_x, acc_y), acc_text, fill=(255, 255, 255), font=font_small)
                    except:
                        pass
            
            # 레이아웃 정보 표시 (더블 칼럼 경계선)
            if result['is_double_column']:
                boundary = result['column_boundary']
                draw.line([(boundary, 0), (boundary, img_height)], 
                         fill=(0, 200, 0), width=6)
                if font_large:
                    # 경계선 정보 텍스트 (배경 포함)
                    boundary_text = f"Column Boundary: {boundary:.1f}px"
                    try:
                        text_bbox = draw.textbbox((0, 0), boundary_text, font=font_large)
                        text_width = text_bbox[2] - text_bbox[0]
                        text_height = text_bbox[3] - text_bbox[1]
                        
                        text_x = boundary + 8
                        text_y = 30
                        
                        # 배경
                        bg_bbox = (text_x - 4, text_y - 2, text_x + text_width + 4, text_y + text_height + 2)
                        draw.rectangle(bg_bbox, fill=(0, 150, 0))
                        
                        # 텍스트
                        draw.text((text_x, text_y), boundary_text, fill=(255, 255, 255), font=font_large)
                    except:
                        pass
            
            # OCR 모델 성능 정보 패널 생성
            vertical_text_count = sum(1 for block in text_blocks if block.get('is_vertical_text', False) or block.get('is_vertical_line', False))
            regular_blocks_count = len(text_blocks) - vertical_text_count
            
            # 디버그 정보 패널 제거됨 (사용자 요청에 따라 bbox 정보 가림 방지)
            
            # 파일명에 job_id 포함 (있는 경우)
            timestamp = datetime.now().strftime("%H%M%S")
            if hasattr(self, 'current_job_id') and self.current_job_id:
                debug_filename = f"debug_{self.current_job_id}_{timestamp}.png"
            else:
                debug_filename = f"debug_{image_name}_{timestamp}.png"
            debug_path = self.debug_output_dir / debug_filename
            img.save(debug_path)
            
            return str(debug_path)
            
        except Exception as e:
            print(f"디버그 이미지 생성 실패: {e}")
            return None
    
    def _draw_vertical_debug_text_chars(self, draw, text, x, y, font):
        """디버그 시각화에서 세로쓰기 텍스트 그리기 (각 글자별)"""
        try:
            current_y = y
            char_height = font.size if font and hasattr(font, 'size') else 14
            
            for char in text:
                if char.strip():  # 공백이 아닌 문자만
                    if font:
                        draw.text((x, current_y), char, fill=(0, 0, 0), font=font)
                    else:
                        draw.text((x, current_y), char, fill=(0, 0, 0))
                    current_y += char_height  # 아래로 이동 (디버그는 좌표계가 반대)
        except Exception as e:
            # 오류 시 원본 텍스트 그리기
            if font:
                draw.text((x, y), text, fill=(0, 0, 0), font=font)
            else:
                draw.text((x, y), text, fill=(0, 0, 0))
    
    def _draw_vertical_debug_text(self, draw, text, x, y, font):
        """디버그 시각화에서 세로쓰기 텍스트 그리기 (줄바꿈 버전 - 호환성)"""
        try:
            lines = text.split('\n')
            current_y = y
            line_height = font.size if font and hasattr(font, 'size') else 14
            
            for line in lines:
                if line.strip():  # 빈 줄이 아닌 경우만
                    if font:
                        draw.text((x, current_y), line, fill=(0, 0, 0), font=font)
                    else:
                        draw.text((x, current_y), line, fill=(0, 0, 0))
                    current_y += line_height  # 아래로 이동 (디버그는 좌표계가 반대)
        except Exception as e:
            # 오류 시 원본 텍스트 그리기
            original_text = text.replace('\n', '')
            if font:
                draw.text((x, y), original_text, fill=(0, 0, 0), font=font)
            else:
                draw.text((x, y), original_text, fill=(0, 0, 0))
    
    def _find_optimal_font_size_for_text(self, text, box_width, box_height, min_size=8, max_size=24):
        """텍스트가 박스에 맞는 최적 폰트 크기 찾기"""
        try:
            # 이진 탐색으로 최적 폰트 크기 찾기
            left, right = min_size, max_size
            best_size = min_size
            
            for _ in range(10):  # 최대 10회 반복
                mid_size = (left + right) / 2
                font = self._get_font_by_size(int(mid_size))
                
                if font:
                    try:
                        # 임시 이미지로 텍스트 크기 측정
                        temp_img = Image.new('RGB', (1000, 1000), 'white')
                        temp_draw = ImageDraw.Draw(temp_img)
                        text_bbox = temp_draw.textbbox((0, 0), text, font=font)
                        text_width = text_bbox[2] - text_bbox[0]
                        text_height = text_bbox[3] - text_bbox[1]
                        
                        # 여유 공간을 고려한 체크 (padding 4px)
                        if text_width <= (box_width - 4) and text_height <= (box_height - 4):
                            best_size = mid_size
                            left = mid_size
                        else:
                            right = mid_size
                    except:
                        right = mid_size
                else:
                    right = mid_size
                
                if right - left < 0.5:
                    break
            
            return max(min_size, int(best_size))
            
        except Exception as e:
            return min_size
    
    def _get_font_by_size(self, font_size):
        """지정된 크기의 폰트 반환"""
        try:
            # 한글 폰트 경로 목록 (우선순위)
            korean_font_paths = [
                "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                "/System/Library/Fonts/AppleGothic.ttf",
                "C:/Windows/Fonts/malgun.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
            ]
            
            for font_path in korean_font_paths:
                try:
                    if os.path.exists(font_path):
                        return ImageFont.truetype(font_path, font_size)
                except:
                    continue
            
            # 기본 폰트 폴백
            try:
                return ImageFont.load_default()
            except:
                return None
                
        except Exception as e:
            return None

class PrecisionFontCalculator:
    """균형잡힌 정밀 폰트 크기 계산기"""
    
    def __init__(self, font_paths=None):
        self.font_cache = {}
        self.measurement_cache = {}
        self.font_paths = font_paths or [
            "C:/Windows/Fonts/malgun.ttf",
            "C:/Windows/Fonts/gulim.ttc",
            "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
            "/System/Library/Fonts/AppleGothic.ttf"
        ]
    
    def calculate_optimal_font_size(self, text, bbox, font_name=None, min_size=6, max_size=90):
        """균형잡힌 최적 폰트 크기 계산"""

        bbox_width = bbox[2] - bbox[0]
        bbox_height = bbox[3] - bbox[1]

        if len(text) == 0 or bbox_width <= 0 or bbox_height <= 0:
            return max(min_size, 8)

        cache_key = (text, bbox_width, bbox_height, font_name, min_size, max_size)
        if cache_key in self.measurement_cache:
            return self.measurement_cache[cache_key]

        # 보수적인 이진 탐색
        low = float(min_size)
        high = float(min(max_size, bbox_height * 1.5))
        best_size = low
        iteration = 0
        max_iterations = 25

        # 커버리지 비율과 폭 오버슈트 비율을 사용해 bbox 폭에 정확히 맞추도록 조정
        coverage_config = CONFIG.get('TEXT_COVERAGE', {})
        coverage_ratio = coverage_config.get('COVERAGE_FILL_RATIO', 1.0)
        overshoot_ratio = coverage_config.get('WIDTH_OVERSHOOT_RATIO', 1.0)
        target_width = bbox_width * coverage_ratio
        target_height = bbox_height * coverage_ratio

        while iteration < max_iterations and (high - low) > 0.2:
            mid = (low + high) / 2

            text_width, text_height = self._measure_text_dimensions(text, mid, font_name)

            width_fits = text_width <= target_width
            height_fits = text_height <= target_height

            if width_fits and height_fits:
                best_size = mid
                low = mid + 0.1
            else:
                high = mid - 0.1

            iteration += 1

        best_size = max(min_size, min(best_size, max_size))

        # 문자열 폭/높이를 PDF 폰트 기준으로 다시 측정하여 한 번 더 보정
        tolerance = max(0.5, target_width * 0.002)
        for _ in range(4):
            text_width, text_height = self._measure_text_dimensions(text, best_size, font_name)
            if text_width <= 0 or text_height <= 0:
                break

            width_diff = target_width - text_width
            if abs(width_diff) <= tolerance:
                break

            width_scale = target_width / text_width
            height_scale = target_height / text_height if text_height > 0 else width_scale

            # 높이를 벗어나지 않도록 보정
            if text_height * width_scale > target_height:
                width_scale = min(width_scale, height_scale)

            candidate_size = best_size * width_scale
            if abs(candidate_size - best_size) < 0.05:
                best_size = candidate_size
                break

            best_size = max(min_size, min(candidate_size, max_size))

        final_width, final_height = self._measure_text_dimensions(text, best_size, font_name)
        if (final_width and final_height) and (final_width > target_width or final_height > target_height):
            shrink_scale = min(target_width / final_width if final_width else 1.0,
                               target_height / final_height if final_height else 1.0)
            best_size = max(min_size, min(best_size * shrink_scale, max_size))

        final_width, final_height = self._measure_text_dimensions(text, best_size, font_name)
        if final_width and target_width and final_width < target_width - tolerance:
            desired_width = target_width * overshoot_ratio
            width_scale = desired_width / final_width if final_width else 1.0
            best_size = max(min_size, min(best_size * width_scale, max_size))
            final_width, final_height = self._measure_text_dimensions(text, best_size, font_name)
            if final_width and final_width > desired_width + tolerance:
                clamp_scale = (desired_width + tolerance) / final_width
                best_size = max(min_size, min(best_size * clamp_scale, max_size))

        final_width, final_height = self._measure_text_dimensions(text, best_size, font_name)
        if (final_width and final_height) and (final_width > target_width * overshoot_ratio + tolerance or final_height > target_height):
            shrink_scale = min((target_width * overshoot_ratio) / final_width if final_width else 1.0,
                               target_height / final_height if final_height else 1.0)
            best_size = max(min_size, min(best_size * shrink_scale, max_size))

        final_size = max(min_size, min(best_size, max_size))
        self.measurement_cache[cache_key] = final_size

        return final_size

    def _measure_text_dimensions(self, text, font_size, font_name=None):
        """실제 텍스트 크기 측정"""
        try:
            pdf_width, pdf_height = self._measure_pdf_text_dimensions(text, font_size, font_name)
            if pdf_width is not None and pdf_height is not None:
                return pdf_width, pdf_height
        except Exception:
            pass

        try:
            font = self._get_pil_font(font_size)

            temp_img = Image.new('RGB', (2000, 300), 'white')
            draw = ImageDraw.Draw(temp_img)

            bbox = draw.textbbox((0, 0), text, font=font)
            actual_width = bbox[2] - bbox[0]
            actual_height = bbox[3] - bbox[1]

            return actual_width, actual_height

        except Exception:
            return self._estimate_text_dimensions_precise(text, font_size)

    def _measure_pdf_text_dimensions(self, text, font_size, font_name):
        """ReportLab 폰트를 사용한 실제 PDF 텍스트 크기 측정"""
        if not font_name:
            return None, None

        try:
            width = pdfmetrics.stringWidth(text, font_name, font_size)
            font = pdfmetrics.getFont(font_name)
            if font is not None and hasattr(font, 'face'):
                face = font.face
                ascent = getattr(face, 'ascent', 1000)
                descent = getattr(face, 'descent', -200)
                height = ((ascent - descent) / 1000.0) * font_size
            else:
                height = font_size * 1.2

            if height <= 0:
                height = font_size

            return width, height
        except Exception:
            return None, None
    
    def _estimate_text_dimensions_precise(self, text, font_size):
        """정밀한 텍스트 크기 추정"""
        korean_chars = sum(1 for char in text if '\uac00' <= char <= '\ud7af')
        english_chars = len(text) - korean_chars
        
        if korean_chars > 0:
            korean_width = korean_chars * font_size * 0.88
            english_width = english_chars * font_size * 0.55
            total_width = korean_width + english_width
            height_multiplier = 1.15
        else:
            total_width = len(text) * font_size * 0.58
            height_multiplier = 1.1
        
        estimated_height = font_size * height_multiplier

        return total_width, estimated_height

    def _get_pil_font(self, font_size):
        """PIL 폰트 객체 반환"""
        font_size = int(font_size)

        if font_size not in self.font_cache:
            font = None

            for font_path in self.font_paths:
                try:
                    if os.path.exists(font_path):
                        font = ImageFont.truetype(font_path, font_size)
                        break
                except Exception:
                    continue

            if font is None:
                try:
                    font = ImageFont.load_default()
                except:
                    font = None

            self.font_cache[font_size] = font

        return self.font_cache[font_size]

    def measure_text(self, text, font_size, font_name=None):
        """문자열 너비/높이 측정 (ReportLab 우선)"""
        return self._measure_text_dimensions(text, font_size, font_name)

class CustomOCRModel:
    """커스텀 OCR 모델 클래스 (모델 선택 지원)"""

    def __init__(self, recognition_model_dir, use_gpu=TRUE):
        self.recognition_model_dir = recognition_model_dir
        self.use_gpu = use_gpu
        self.logger = logging.getLogger(__name__)
        self.engine_type = (CONFIG.get('OCR_ENGINE') or 'pp_structure').lower()
        self.structured_result = None
        self.ocr = self._create_ocr_model()

    @classmethod
    def create_dynamic_ocr(cls, ocr_model_type: str, recognition_model_dir: str, use_gpu: bool = True):
        """동적으로 OCR 모델 타입에 따라 인스턴스 생성"""
        instance = cls(recognition_model_dir, use_gpu)
        instance.ocr = instance._create_ocr_model(ocr_model_type)
        return instance
    
    def _create_ocr_model(self, ocr_model_type: str = "custom"):
        """OCR 모델 생성 (성능 최적화)"""
        device_name = "GPU" if self.use_gpu else "CPU"
        self.logger.info(f"모델 타입: {ocr_model_type}, 디바이스: {device_name}")

        if self.engine_type in {"pp_structure", "pp-structure", "ppstructure"}:
            from core.pp_structure_engine import PPStructureEngine

            self.logger.info(
                "Using PP-Structure engine (layout=%s, table=%s, table_model=%s)",
                CONFIG.get('PPSTRUCTURE_LAYOUT_MODEL'),
                CONFIG.get('PPSTRUCTURE_USE_TABLE_RECOGNITION'),
                CONFIG.get('PPSTRUCTURE_TABLE_MODEL'),
            )
            return PPStructureEngine(use_custom_recognition=bool(self.recognition_model_dir))

        gpu_device_id = _resolve_gpu_device_id() if self.use_gpu else None
        _set_cuda_device_env(gpu_device_id, self.use_gpu)

        selected_recognition_dir = None

        def _build_ocr_params():
            # 기본 OCR 파라미터 (라인 단위 감지 최적화)
            # Use global config_manager if available
            if config_manager is not None:
                detection_limit = config_manager.get('ocr.detection_limit_side_len', 1500)  # 1500으로 최적화
                rec_batch = config_manager.get('ocr.rec_batch_num', 1)  # 1로 최적화 (속도 향상)
                cpu_threads = config_manager.get('ocr.cpu_threads', 128)
            else:
                detection_limit = 1500  # 최적화된 값
                rec_batch = 1  # 최적화된 값
                cpu_threads = 128

            base_params = _get_device_kwargs(self.use_gpu)
            base_params.update({
                "use_doc_orientation_classify": False,  # 속도 향상
                "use_doc_unwarping": False,            # 속도 향상
                "use_textline_orientation": False,      # PaddleOCR 3.x 파라미터명

                # Detection 파라미터 (라인 단위 감지) - PaddleOCR 3.x 파라미터명
                "text_det_limit_type": 'max',               # 고해상도 유지
                "text_det_limit_side_len": detection_limit,  # 최적화된 값 (1500)
                "text_det_thresh": 0.3,                  # DB threshold
                "text_det_box_thresh": 0.5,              # Box threshold (낮추면 더 많이 감지)
                "text_det_unclip_ratio": 2.0,            # Unclip ratio (높이면 bbox가 커짐)

                # Recognition 파라미터 - PaddleOCR 3.x 파라미터명
                "text_recognition_batch_size": rec_batch,   # 1로 최적화 (속도 향상) ⭐
            })
            return base_params

        try:
            ocr_params = _build_ocr_params()

            # Use global config_manager if available
            if config_manager is not None:
                custom_models = config_manager.get('ocr.custom_models', {}) or {}
            else:
                custom_models = {}

            # 모델 타입별 설정
            if ocr_model_type == "custom":
                # 커스텀 모델 사용 (기본 경로)
                if self.recognition_model_dir and self.recognition_model_dir.strip():
                    _apply_custom_recognition_dir(ocr_params, self.recognition_model_dir)
                    selected_recognition_dir = self.recognition_model_dir
                    self.logger.info(f"커스텀 모델 경로: {self.recognition_model_dir}")
                elif 'best_0828' in custom_models:
                    fallback_model_dir = custom_models.get('best_0828')
                    if fallback_model_dir:
                        _apply_custom_recognition_dir(ocr_params, fallback_model_dir)
                        selected_recognition_dir = fallback_model_dir
                        self.logger.info(f"커스텀 모델 경로(폴백): {fallback_model_dir}")
            elif ocr_model_type in custom_models:
                custom_model_dir = custom_models.get(ocr_model_type, '')
                if custom_model_dir:
                    _apply_custom_recognition_dir(ocr_params, custom_model_dir)
                    selected_recognition_dir = custom_model_dir
                    self.logger.info(f"커스텀 모델 경로({ocr_model_type}): {custom_model_dir}")
                else:
                    self.logger.warning(f"{ocr_model_type} 모델 경로가 설정되지 않아 기본 모델을 사용합니다")
            elif ocr_model_type == "paddle_ch":
                ocr_params["lang"] = "ch"
                self.logger.info("PaddleOCR 중국어 모델 사용")
            elif ocr_model_type == "paddle_kr":
                ocr_params["lang"] = "korean"
                self.logger.info("PaddleOCR 한국어 모델 사용")
            else:
                self.logger.warning(f"알 수 없는 모델 타입: {ocr_model_type}, 기본 설정 사용")

            def _create_instance(params):
                return PaddleOCR(**params)

            # OCR 인스턴스 생성
            try:
                ocr = _create_instance(ocr_params)
            except Exception as initial_error:
                if selected_recognition_dir is not None:
                    self.logger.warning(
                        "커스텀 OCR 모델 로딩 실패(%s). 공식 모델로 자동 전환합니다.",
                        initial_error,
                    )
                    # 커스텀 관련 파라미터 제거 후 재시도
                    ocr_params = _build_ocr_params()
                    selected_recognition_dir = None
                    ocr = _create_instance(ocr_params)
                else:
                    raise

            if not hasattr(ocr, 'predict'):
                raise RuntimeError("predict 메서드가 없습니다!")

            self.logger.info(f"OCR 모델 로딩 성공 ({ocr_model_type})")
            return ocr
            
        except Exception as e:
            self.logger.error(f"모델 로딩 실패: {e}")
            raise
    
    def _apply_preprocessing(self, image_path: str) -> str:
        """OCR 전처리 파이프라인 (노이즈 제거, 업스케일, 대비 보정)"""
        preprocessing_config = CONFIG.get('PREPROCESSING', {}) or {}

        # config_manager가 있으면 최신 설정 반영
        try:
            if 'config_manager' in globals() and config_manager is not None:
                preprocessing_config = config_manager.get_preprocessing_config() or preprocessing_config
        except Exception as cfg_error:
            self.logger.debug(f"전처리 설정 로드 실패, 기본 사용: {cfg_error}")

        if not preprocessing_config or not preprocessing_config.get('enable', False):
            return image_path

        image = cv2.imread(image_path, cv2.IMREAD_COLOR)
        if image is None:
            self.logger.warning(f"전처리용 이미지 로드 실패, 원본 사용: {image_path}")
            return image_path

        processed = image
        original_shape = image.shape[:2]
        modified = False

        # 1. 컬러 노이즈 제거 (FastNlMeans)
        denoise_cfg = preprocessing_config.get('denoise', {}) or {}
        if denoise_cfg.get('enabled', False):
            try:
                h = int(denoise_cfg.get('h', 6))
                h_color = int(denoise_cfg.get('h_color', denoise_cfg.get('hColor', 6)))
                template_window = max(1, int(denoise_cfg.get('template_window_size', 7)))
                search_window = max(1, int(denoise_cfg.get('search_window_size', 21)))
                if template_window % 2 == 0:
                    template_window += 1
                if search_window % 2 == 0:
                    search_window += 1

                processed = cv2.fastNlMeansDenoisingColored(
                    processed,
                    None,
                    h,
                    h_color,
                    template_window,
                    search_window
                )
                modified = True
                self.logger.debug(
                    "전처리: FastNlMeansDenoisingColored 적용 (h=%d, h_color=%d)",
                    h,
                    h_color,
                )
            except Exception as denoise_error:
                self.logger.warning(f"노이즈 제거 실패, 단계 건너뜀: {denoise_error}")

        # 2. 저해상도 업스케일
        upscale_cfg = preprocessing_config.get('upscale', {}) or {}
        if upscale_cfg.get('enabled', False):
            try:
                min_edge_target = int(upscale_cfg.get('min_edge', 1600))
                max_scale = float(upscale_cfg.get('max_scale', 2.0))
                height, width = processed.shape[:2]
                short_edge = min(height, width)

                if short_edge > 0 and short_edge < min_edge_target:
                    scale = min(max_scale, max(min_edge_target / float(short_edge), 1.0))
                    if scale > 1.01:  # 최소 1% 이상 확대 시만 적용
                        new_size = (int(round(width * scale)), int(round(height * scale)))
                        processed = cv2.resize(processed, new_size, interpolation=cv2.INTER_CUBIC)
                        modified = True
                        self.logger.debug(
                            "전처리: 업스케일 적용 (scale=%.2f, size=%dx%d)",
                            scale,
                            new_size[0],
                            new_size[1],
                        )
            except Exception as upscale_error:
                self.logger.warning(f"업스케일 실패, 단계 건너뜀: {upscale_error}")

        # 3. 대비 보정 (CLAHE)
        clahe_cfg = preprocessing_config.get('clahe', {}) or {}
        if clahe_cfg.get('enabled', False):
            try:
                clip_limit = float(clahe_cfg.get('clip_limit', 3.0))
                tile_grid_size = clahe_cfg.get('tile_grid_size', [8, 8])
                if isinstance(tile_grid_size, (list, tuple)) and len(tile_grid_size) == 2:
                    tile_grid = (max(1, int(tile_grid_size[0])), max(1, int(tile_grid_size[1])))
                else:
                    tile_grid = (8, 8)

                clahe = cv2.createCLAHE(clipLimit=max(0.1, clip_limit), tileGridSize=tile_grid)
                lab = cv2.cvtColor(processed, cv2.COLOR_BGR2LAB)
                l, a, b = cv2.split(lab)
                l = clahe.apply(l)
                lab = cv2.merge((l, a, b))
                processed = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
                modified = True
                self.logger.debug(
                    "전처리: CLAHE 적용 (clip_limit=%.2f, tile=%s)",
                    clip_limit,
                    tile_grid,
                )
            except Exception as clahe_error:
                self.logger.warning(f"CLAHE 적용 실패, 단계 건너뜀: {clahe_error}")

        if not modified:
            return image_path

        try:
            preserve_size = preprocessing_config.get('preserve_size', True)
            if preserve_size and processed.shape[:2] != original_shape:
                orig_h, orig_w = original_shape
                interp = cv2.INTER_LINEAR if processed.shape[0] < orig_h or processed.shape[1] < orig_w else cv2.INTER_AREA
                processed = cv2.resize(processed, (orig_w, orig_h), interpolation=interp)
                self.logger.debug(
                    "전처리: 원본 크기 복원 (%dx%d)",
                    orig_w,
                    orig_h,
                )

            temp_file = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
            temp_path = temp_file.name
            temp_file.close()

            if not cv2.imwrite(temp_path, processed):
                self.logger.warning("전처리 이미지 저장 실패, 원본 사용")
                os.unlink(temp_path)
                return image_path

            self.logger.info(
                "전처리 완료: %s -> %s (shape=%dx%d)",
                Path(image_path).name,
                Path(temp_path).name,
                processed.shape[1],
                processed.shape[0],
            )
            return temp_path
        except Exception as save_error:
            self.logger.warning(f"전처리 결과 저장 실패, 원본 사용: {save_error}")
            return image_path

    def _standardize_image_format(self, image_path):
        """이미지를 OCR에 적합한 형식으로 표준화 (최적화된 버전)"""
        try:
            from PIL import Image
            import tempfile
            import os

            # 원본 이미지 로드
            with Image.open(image_path) as img:
                # 이미 RGB이고 PNG/JPEG인 경우 원본 그대로 사용 (가장 빠름)
                ext = Path(image_path).suffix.lower()
                if img.mode == 'RGB' and ext in ['.png', '.jpg', '.jpeg']:
                    self.logger.debug(f"이미지 이미 표준 형식, 변환 생략: {Path(image_path).name}")
                    return image_path

                # RGB가 아닌 경우만 변환 (RGBA, CMYK, P, L 등)
                if img.mode != 'RGB':
                    self.logger.debug(f"이미지 모드 변환 필요: {img.mode} -> RGB")
                    img = img.convert('RGB')
                else:
                    # RGB이지만 형식이 다른 경우 (TIFF, BMP 등) - 원본 반환
                    self.logger.debug(f"이미지 형식 {ext}, 변환 생략")
                    return image_path

                # 변환이 필요한 경우만 저장 (compress_level=0으로 빠르게)
                temp_file = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
                temp_path = temp_file.name
                temp_file.close()

                # PNG 압축 최소화 (속도 우선)
                img.save(temp_path, 'PNG', compress_level=0)

                self.logger.info(f"이미지 표준화 완료: {Path(image_path).name} -> RGB PNG")
                return temp_path

        except Exception as e:
            self.logger.warning(f"이미지 표준화 실패, 원본 사용: {e}")
            return image_path
    
    def predict(self, image_path):
        """OCR 수행 및 누락 텍스트 복구"""
        import time
        predict_start = time.time()

        if self.ocr is None:
            raise RuntimeError("OCR 모델이 초기화되지 않았습니다!")

        temp_paths = set()
        self.structured_result = None

        if self.engine_type in {"pp_structure", "pp-structure", "ppstructure"}:
            try:
                t0 = time.time()
                preprocessed_path = self._apply_preprocessing(image_path)
                if preprocessed_path != image_path:
                    temp_paths.add(preprocessed_path)

                standardized_image_path = self._standardize_image_format(preprocessed_path)
                if standardized_image_path != preprocessed_path:
                    temp_paths.add(standardized_image_path)

                self.structured_result = self.ocr.analyze(standardized_image_path) or {}
                ocr_blocks = self.structured_result.get('ocr_blocks', [])
                self.logger.info(
                    "PP-Structure analysis completed in %.2fs (%d text blocks, %d tables)",
                    time.time() - t0,
                    len(ocr_blocks),
                    len(self.structured_result.get('layout_info', {}).get('tables', [])),
                )
                return ocr_blocks if ocr_blocks else None
            finally:
                for temp_path in temp_paths:
                    try:
                        if temp_path and os.path.exists(temp_path):
                            os.unlink(temp_path)
                    except Exception as cleanup_error:
                        self.logger.debug(f"?꾩떆 ?뚯씪 ?뺣━ ?ㅽ뙣 ({temp_path}): {cleanup_error}")

        # 문자별 confidence 캡처를 위한 누적 모드 시작
        try:
            from core.ctc_patch import start_accumulating, stop_accumulating, get_char_confidences_for_texts
            start_accumulating()
        except ImportError:
            start_accumulating = None
            stop_accumulating = None
            get_char_confidences_for_texts = None

        try:
            # 이미지 전처리 및 표준화 적용
            t0 = time.time()
            preprocessed_path = self._apply_preprocessing(image_path)
            if preprocessed_path != image_path:
                temp_paths.add(preprocessed_path)
            t1 = time.time()

            standardized_image_path = self._standardize_image_format(preprocessed_path)
            if standardized_image_path != preprocessed_path:
                temp_paths.add(standardized_image_path)
            t2 = time.time()

            self.logger.info(f"OCR 수행: {Path(image_path).name} (전처리: {t1-t0:.2f}s, 표준화: {t2-t1:.2f}s)")
            t3 = time.time()
            results = self.ocr.predict(standardized_image_path)
            t4 = time.time()
            self.logger.info(f"PaddleOCR.predict 소요시간: {t4-t3:.2f}s")
            
            if results and len(results) > 0:
                if hasattr(results[0], 'json'):
                    res = results[0].json['res']
                    texts = res.get('rec_texts', [])
                    scores = res.get('rec_scores', [])
                    boxes = res.get('dt_polys', [])
                    
                    self.logger.info(f"기본 인식 결과: {len(texts)}개 텍스트")
                    
                    standard_results = []
                    for i, (text, score, box) in enumerate(zip(texts, scores, boxes)):
                        if text and text.strip():
                            try:
                                if isinstance(box, (list, tuple)) and len(box) == 4:
                                    valid_box = True
                                    for point in box:
                                        if not isinstance(point, (list, tuple)) or len(point) != 2:
                                            valid_box = False
                                            break
                                    
                                    if valid_box:
                                        x_coords = [float(point[0]) for point in box]
                                        y_coords = [float(point[1]) for point in box]
                                        bbox = (min(x_coords), min(y_coords), max(x_coords), max(y_coords))
                                        
                                        standard_results.append({
                                            'bbox': bbox,
                                            'text': text.strip(),
                                            'score': float(score),
                                            'result_index': i  # 문자별 confidence 매칭용
                                        })
                                    else:
                                        self.logger.warning(f"잘못된 좌표점 형태 (항목 {i}): {box}")
                                else:
                                    self.logger.warning(f"잘못된 박스 형태 (항목 {i}): {type(box)} - {box}")
                            except Exception as e:
                                self.logger.warning(f"항목 {i} 처리 오류: {e}")
                                continue
                    
                    # 문자별 confidence 캡처 - 텍스트 기반 매칭
                    if stop_accumulating is not None and get_char_confidences_for_texts is not None:
                        try:
                            text_conf_pairs = stop_accumulating()  # 누적 종료 및 결과 가져오기
                            # 최종 텍스트 목록 추출
                            final_texts = [r['text'] for r in standard_results]
                            # 텍스트 기반으로 char_confidences 매칭
                            matched_confidences = get_char_confidences_for_texts(final_texts, text_conf_pairs)

                            for i, result in enumerate(standard_results):
                                if i < len(matched_confidences):
                                    result['char_confidences'] = matched_confidences[i]
                                else:
                                    result['char_confidences'] = []
                                # result_index는 내부용이므로 제거
                                result.pop('result_index', None)

                            self.logger.debug(f"문자별 confidence 매칭 완료: {len(matched_confidences)}개")
                        except Exception as conf_error:
                            self.logger.warning(f"문자별 confidence 캡처 실패: {conf_error}")
                            for result in standard_results:
                                result['char_confidences'] = []
                                result.pop('result_index', None)
                    else:
                        for result in standard_results:
                            result['char_confidences'] = []
                            result.pop('result_index', None)

                    # 누락 텍스트 복구 시도 (OCR 인스턴스 재사용)
                    text_coverage = CONFIG.get('TEXT_COVERAGE', {})
                    if text_coverage.get('ENABLE_TEXT_RECOVERY', False):
                        self.logger.info("누락 텍스트 복구 시도...")
                        try:
                            # 기존 OCR 인스턴스 재사용하여 성능 개선
                            standard_results = recover_missed_text_blocks(image_path, standard_results, ocr_instance=self.ocr)
                        except Exception as recovery_error:
                            self.logger.warning(f"텍스트 복구 실패, 기본 결과 사용: {recovery_error}")
                            # 복구 실패해도 기본 결과는 유지

                    self.logger.info(f"최종 처리 결과: {len(standard_results)}개 유효한 텍스트")
                    return standard_results if standard_results else None
                else:
                    self.logger.error("예상하지 못한 predict 결과 형태")
                    return None
            else:
                self.logger.info("인식 결과 없음")
                return None
                
        except Exception as e:
            self.logger.error(f"OCR 실패: {e}")
            raise
        finally:
            for temp_path in temp_paths:
                try:
                    if temp_path and os.path.exists(temp_path):
                        os.unlink(temp_path)
                except Exception as cleanup_error:
                    self.logger.debug(f"임시 파일 정리 실패 ({temp_path}): {cleanup_error}")

class OCRPDFGenerator:
    """균형잡힌 OCR PDF 생성기"""
    
    def __init__(self, config):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.korean_font_name = self._setup_korean_font(config['FONT_CANDIDATES'])
        
        self.output_dir = Path(config['OUTPUT_PDF_DIR'])
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        debug_dir = config.get('COLUMN_DETECTION', {}).get('DEBUG_OUTPUT_DIR')
        enable_debug = config.get('COLUMN_DETECTION', {}).get('ENABLE_DEBUG_OUTPUT', False)
        
        self.column_detector = SuperiorColumnDetector(
            debug_output_dir=debug_dir,
            enable_debug=enable_debug
        )
        
        self.font_calculator = PrecisionFontCalculator()
        
        self.logger.info("균형잡힌 텍스트 커버리지 OCR PDF 생성기 초기화 완료")
        if not SKLEARN_AVAILABLE:
            self.logger.warning("scikit-learn 미설치: 클러스터링 분석 제외됨")
    
    def _setup_korean_font(self, font_candidates):
        """한글 폰트 설정"""
        korean_font_name = None
        for font_path, font_name in font_candidates:
            if os.path.exists(font_path):
                try:
                    pdfmetrics.registerFont(TTFont(font_name, font_path))
                    korean_font_name = font_name
                    self.logger.info(f"한글 폰트 등록 성공: {font_name}")
                    break
                except Exception as e:
                    self.logger.warning(f"폰트 등록 실패 {font_name}: {e}")
        
        if not korean_font_name:
            self.logger.warning("한글 폰트 등록 실패. 기본 폰트 사용.")
            korean_font_name = "Helvetica"
        
        return korean_font_name
    
    def generate_pdf(self, image_path, ocr_results, output_path=None):
        """균형잡힌 PDF 생성"""
        try:
            image = cv2.imread(str(image_path))
            if image is None:
                self.logger.error(f"이미지 로드 실패: {image_path}")
                return None
            
            img_height, img_width = image.shape[:2]
            image_name = Path(image_path).stem
            
            if output_path is None:
                output_path = self.output_dir / f"{image_name}_balanced_searchable.pdf"
            
            if not ocr_results:
                self.logger.warning(f"OCR 결과 없음: {image_path}")
                return self._create_image_only_pdf(image, output_path, img_width, img_height)
            
            # 다단 레이아웃 감지
            # 현재 이미지 경로를 detector에 전달
            self.column_detector.current_image_path = str(image_path)
            self.column_detector.current_job_id = getattr(self, 'current_job_id', None)
            
            detection_result = self.column_detector.detect_layout_comprehensive(
                ocr_results, img_width, img_height, image_name, debug=False
            )
            
            layout_type = "더블칼럼" if detection_result['is_double_column'] else "단일칼럼"
            self.logger.info(
                f"📋 {image_name}: {layout_type} "
                f"(신뢰도: {detection_result['confidence']:.3f}, "
                f"방법: {detection_result['method']})"
            )
            
            if detection_result['is_double_column']:
                self.logger.info(
                    f"   왼쪽 {len(detection_result['left_blocks'])}개, "
                    f"오른쪽 {len(detection_result['right_blocks'])}개, "
                    f"경계: {detection_result['column_boundary']:.1f}px"
                )
            
            # OCR 결과를 그대로 사용 (detection이 이미 올바름)
            processed_blocks = self._detect_vertical_text_simple(ocr_results)
            
            # detection_result 저장 (PDF 생성 시 사용)
            self._last_detection_result = detection_result
            
            # 텍스트 블록 정렬
            if detection_result['is_double_column']:
                sorted_blocks = self._sort_blocks_double_column(processed_blocks, detection_result)
            else:
                sorted_blocks = self._sort_blocks_single_column(processed_blocks)
            
            # 균형잡힌 PDF 생성
            return self._create_balanced_pdf(image, sorted_blocks, output_path, 
                                           img_width, img_height, image_name)
            
        except Exception as e:
            self.logger.error(f"PDF 생성 실패: {e}")
            return None
    
    def _sort_blocks_double_column(self, text_blocks, detection_result):
        """더블칼럼 블록 정렬 - 제목은 그대로, 본문만 좌측전체→우측전체"""
        column_boundary = detection_result.get('column_boundary', 0)
        
        # Y좌표로 정렬
        sorted_blocks = sorted(text_blocks, key=lambda x: (x['bbox'][1], x['bbox'][0]))
        
        # 제목 영역과 본문 영역 구분 (Y좌표 기준)
        if len(sorted_blocks) < 2:
            return sorted_blocks
            
        # 첫 번째 블록들을 제목으로 간주 (상위 30% 또는 첫 몇 줄)
        all_y_coords = [block['bbox'][1] for block in sorted_blocks]
        min_y = min(all_y_coords)
        max_y = max(all_y_coords)
        
        # 상위 25% Y좌표를 제목 영역으로 간주
        title_boundary_y = min_y + (max_y - min_y) * 0.25
        
        title_blocks = []
        body_blocks = []
        
        for block in sorted_blocks:
            if block['bbox'][1] <= title_boundary_y:
                title_blocks.append(block)
            else:
                body_blocks.append(block)
        
        # 제목 블록은 그대로 Y좌표 순서 유지
        title_blocks.sort(key=lambda x: (x['bbox'][1], x['bbox'][0]))
        
        # 본문 블록만 더블칼럼 정렬 (왼쪽 전체 → 오른쪽 전체)
        if body_blocks:
            body_left = []
            body_right = []

            for block in body_blocks:
                bbox = block['bbox']
                center_x = (bbox[0] + bbox[2]) / 2

                if center_x < column_boundary:
                    body_left.append(block)
                else:
                    body_right.append(block)

            body_left.sort(key=lambda x: (x['bbox'][1], x['bbox'][0]))
            body_right.sort(key=lambda x: (x['bbox'][1], x['bbox'][0]))
            sorted_body = body_left + body_right
            self.logger.info(
                f"더블칼럼 정렬: 제목 {len(title_blocks)}개, 좌측 {len(body_left)}개, 우측 {len(body_right)}개"
            )
        else:
            sorted_body = []
        
        # 최종 순서: 제목 → 본문(좌측전체→우측전체)
        return title_blocks + sorted_body
    
    def _process_row_blocks(self, row_blocks, left_blocks, right_blocks):
        """한 행의 블록들을 좌측/우측으로 분류하여 추가"""
        # 행 내에서 X좌표로 정렬
        row_blocks.sort(key=lambda x: x['center_x'])
        
        for block_info in row_blocks:
            if block_info['is_left']:
                left_blocks.append(block_info)
            else:
                right_blocks.append(block_info)
    
    def _sort_blocks_single_column(self, text_blocks):
        """단일칼럼 블록 정렬"""
        return sorted(text_blocks, key=lambda x: (x['bbox'][1], x['bbox'][0]))
    
    def _create_balanced_pdf(self, image, text_blocks, output_path, img_width, img_height, image_name):
        """균형잡힌 PDF 생성"""
        try:
            c = canvas.Canvas(str(output_path), pagesize=(img_width, img_height))
            
            img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(img_rgb)
            temp_img_path = self.output_dir / f"temp_{image_name}.png"
            pil_img.save(temp_img_path)
            c.drawImage(str(temp_img_path), 0, 0, width=img_width, height=img_height)
            
            # 균형잡힌 텍스트 레이어 추가 (더블칼럼 고려)
            if hasattr(self, '_last_detection_result') and self._last_detection_result.get('is_double_column', False):
                self._add_double_column_text_layers(c, text_blocks, img_height, image_name, self._last_detection_result)
            else:
                self._add_balanced_text_layers(c, text_blocks, img_height, image_name)
            
            c.save()
            
            if temp_img_path.exists():
                temp_img_path.unlink()
            
            self.logger.info(f"✅ 균형잡힌 PDF 생성 완료: {output_path}")
            return str(output_path)
            
        except Exception as e:
            self.logger.error(f"균형잡힌 PDF 생성 실패: {e}")
            return None
    
    def _add_balanced_text_layers(self, canvas_obj, text_blocks, img_height, image_name):
        """균형잡힌 텍스트 레이어 추가 - 세로쓰기 지원"""
        successful_blocks = 0
        failed_blocks = 0
        excluded_blocks = 0
        
        low_confidence_threshold = CONFIG.get('TEXT_COVERAGE', {}).get('LOW_CONFIDENCE_THRESHOLD', 0.3)
        
        
        for i, block in enumerate(text_blocks):
            try:
                bbox = block['bbox']
                text = block['text'].strip()
                score = block.get('score', 1.0)
                
                # 적절한 품질 기준 적용
                if not text or score < low_confidence_threshold:
                    if score < low_confidence_threshold:
                        excluded_blocks += 1
                    continue
                
                # 한글 폰트 결정
                has_korean = any('\uac00' <= char <= '\ud7af' for char in text)
                font_name = (self.korean_font_name if has_korean and 
                           self.korean_font_name != "Helvetica" else "Helvetica")

                # 균형잡힌 폰트 크기 계산
                min_size = self.config.get('ENGLISH_MIN_SIZE', 6)
                max_size = self.config.get('MAX_FONT_SIZE', 90)
                optimal_font_size = self.font_calculator.calculate_optimal_font_size(
                    text, bbox,
                    font_name=font_name,
                    min_size=min_size,
                    max_size=max_size
                )

                text_width, text_height = self.font_calculator.measure_text(
                    text, optimal_font_size, font_name
                )

                # 균형잡힌 텍스트 위치 계산
                x, y = self._calculate_balanced_text_position(text, bbox, optimal_font_size, img_height, has_korean)

                bbox_width = bbox[2] - bbox[0]
                if text_width:
                    x = bbox[0] + (bbox_width - text_width) / 2
                    x = max(bbox[0], min(x, bbox[2] - text_width))

                if text_height:
                    baseline_min = img_height - bbox[3]
                    baseline_max = img_height - bbox[1]
                    y = max(baseline_min, min(y, baseline_max))

                # 텍스트 렌더링 (줄바꿈이 포함된 경우 자동으로 세로 표시)
                text_alpha = self.config.get('TEXT_ALPHA', 0.01)
                canvas_obj.setFillAlpha(text_alpha)
                canvas_obj.setFillColor(Color(0, 0, 0, alpha=text_alpha))
                canvas_obj.setFont(font_name, optimal_font_size)
                
                # 세로쓰기 텍스트 처리
                is_vertical = block.get('is_vertical_text', False)
                
                if is_vertical:
                    # 세로쓰기: bbox 중앙에 각 글자를 세로로 배치
                    self.logger.info(f"📝 PDF 세로쓰기 렌더링: '{text}' at bbox {bbox}")
                    bbox_width = bbox[2] - bbox[0]
                    center_x = bbox[0] + bbox_width / 2 - optimal_font_size / 3
                    start_y = img_height - bbox[1] - optimal_font_size * 0.8
                    
                    char_y = start_y
                    char_spacing = optimal_font_size * 1.0
                    
                    for char in text:
                        if char.strip():  # 공백이 아닌 문자만
                            canvas_obj.drawString(center_x, char_y, char)
                            char_y -= char_spacing
                else:
                    # 가로쓰기: 일반 텍스트
                    canvas_obj.drawString(x, y, text)
                
                successful_blocks += 1
                
                # 디버그 로깅
                if i < 3:
                    self.logger.debug(
                        f"   텍스트 {i}: '{text[:20]}...' "
                        f"크기={optimal_font_size} 위치=({x:.1f},{y:.1f}) "
                        f"bbox={[int(coord) for coord in bbox]} "
                        f"신뢰도={score:.2f}"
                    )
                
            except Exception as e:
                failed_blocks += 1
                self.logger.warning(f"텍스트 레이어 추가 실패 (블록 {i}): {e}")
        
        # 균형잡힌 처리 결과 요약
        total_blocks = len(text_blocks)
        success_rate = (successful_blocks / total_blocks * 100) if total_blocks > 0 else 0
        
        self.logger.info(
            f"   균형잡힌 텍스트 레이어: {successful_blocks}/{total_blocks}개 성공 "
            f"({success_rate:.1f}%)"
        )
        
        if excluded_blocks > 0:
            self.logger.info(f"   품질기준 제외: {excluded_blocks}개")
        
        if failed_blocks > 0:
            self.logger.warning(f"   실패한 블록: {failed_blocks}개")
    
    def _add_double_column_text_layers(self, canvas_obj, text_blocks, img_height, image_name, detection_result):
        """더블칼럼 레이아웃용 텍스트 레이어 추가 - 칼럼별로 분리된 선택 영역"""
        column_boundary = detection_result.get('column_boundary', 0)
        
        # 페이지 크기 구하기
        page_width = canvas_obj._pagesize[0]
        page_height = canvas_obj._pagesize[1]
        
        left_blocks = []
        right_blocks = []
        
        # 칼럼별로 블록 분리
        for block in text_blocks:
            bbox = block['bbox']
            block_center_x = (bbox[0] + bbox[2]) / 2
            
            if block_center_x < column_boundary:
                left_blocks.append(block)
            else:
                right_blocks.append(block)
        
        self.logger.info(f"더블칼럼 텍스트 레이어: 좌측 {len(left_blocks)}개, 우측 {len(right_blocks)}개, 경계: {column_boundary:.1f}")
        
        # 왼쪽 칼럼 클리핑 영역 설정하고 텍스트 추가
        if left_blocks:
            canvas_obj.saveState()
            # 왼쪽 칼럼 클리핑 (x: 0 ~ column_boundary)
            path = canvas_obj.beginPath()
            path.rect(0, 0, column_boundary, page_height)
            canvas_obj.clipPath(path, stroke=0, fill=0)
            
            self._add_column_text_layer(canvas_obj, left_blocks, img_height, "left")
            canvas_obj.restoreState()
            
        # 오른쪽 칼럼 클리핑 영역 설정하고 텍스트 추가  
        if right_blocks:
            canvas_obj.saveState()
            # 오른쪽 칼럼 클리핑 (x: column_boundary ~ page_width)
            path = canvas_obj.beginPath()
            path.rect(column_boundary, 0, page_width - column_boundary, page_height)
            canvas_obj.clipPath(path, stroke=0, fill=0)
            
            self._add_column_text_layer(canvas_obj, right_blocks, img_height, "right")
            canvas_obj.restoreState()
    
    def _add_column_text_layer(self, canvas_obj, column_blocks, img_height, column_name):
        """단일 칼럼에 대한 텍스트 레이어 추가"""
        successful_blocks = 0
        failed_blocks = 0
        excluded_blocks = 0
        
        low_confidence_threshold = CONFIG.get('TEXT_COVERAGE', {}).get('LOW_CONFIDENCE_THRESHOLD', 0.3)
        
        for i, block in enumerate(column_blocks):
            try:
                bbox = block['bbox']
                text = block['text'].strip()
                score = block.get('score', 1.0)
                
                # 적절한 품질 기준 적용
                if not text or score < low_confidence_threshold:
                    if score < low_confidence_threshold:
                        excluded_blocks += 1
                    continue
                
                # 한글 폰트 결정
                has_korean = any('\uac00' <= char <= '\ud7af' for char in text)
                font_name = (self.korean_font_name if has_korean and 
                           self.korean_font_name != "Helvetica" else "Helvetica")

                # 균형잡힌 폰트 크기 계산
                min_size = self.config.get('ENGLISH_MIN_SIZE', 6)
                max_size = self.config.get('MAX_FONT_SIZE', 90)
                optimal_font_size = self.font_calculator.calculate_optimal_font_size(
                    text, bbox,
                    font_name=font_name,
                    min_size=min_size,
                    max_size=max_size
                )

                text_width, text_height = self.font_calculator.measure_text(
                    text, optimal_font_size, font_name
                )

                # 균형잡힌 텍스트 위치 계산 (bbox 내부에만 제한)
                x, y = self._calculate_balanced_text_position(text, bbox, optimal_font_size, img_height, has_korean)

                bbox_width = bbox[2] - bbox[0]
                if text_width:
                    x = bbox[0] + (bbox_width - text_width) / 2
                    x = max(bbox[0], min(x, bbox[2] - text_width))

                if text_height:
                    baseline_min = img_height - bbox[3]
                    baseline_max = img_height - bbox[1]
                    y = max(baseline_min, min(y, baseline_max))

                # 더블칼럼에서 추가 칼럼 경계 제한 (혹시 모를 오버플로우 방지)
                if column_name == "left" and text_width:
                    x = min(x, bbox[2] - text_width)
                elif column_name == "right" and text_width:
                    x = max(x, bbox[0])
                
                # 텍스트 렌더링 (매우 투명하게)
                text_alpha = self.config.get('TEXT_ALPHA', 0.01)
                canvas_obj.setFillAlpha(text_alpha)
                canvas_obj.setFillColor(Color(0, 0, 0, alpha=text_alpha))
                canvas_obj.setFont(font_name, optimal_font_size)
                
                # 세로쓰기 텍스트 처리
                is_vertical = block.get('is_vertical_text', False)
                
                if is_vertical:
                    # 세로쓰기: bbox 중앙에 각 글자를 세로로 배치
                    bbox_width = bbox[2] - bbox[0]
                    center_x = bbox[0] + bbox_width / 2 - optimal_font_size / 3
                    start_y = img_height - bbox[1] - optimal_font_size * 0.8
                    
                    char_y = start_y
                    char_spacing = optimal_font_size * 1.0
                    
                    for char in text:
                        if char.strip():  # 공백이 아닌 문자만
                            canvas_obj.drawString(center_x, char_y, char)
                            char_y -= char_spacing
                else:
                    # 가로쓰기: 일반 텍스트
                    canvas_obj.drawString(x, y, text)
                
                successful_blocks += 1
                
            except Exception as e:
                failed_blocks += 1
                self.logger.warning(f"{column_name} 칼럼 텍스트 레이어 추가 실패 (블록 {i}): {e}")
        
        self.logger.info(f"   {column_name} 칼럼: {successful_blocks}/{len(column_blocks)}개 성공")
    
    def _detect_vertical_layout(self, text_blocks):
        """문서 전체의 세로쓰기 레이아웃 감지 (한중일 세로쓰기 특화)"""
        if len(text_blocks) < 3:
            return False, []
            
        vertical_indicators = 0
        total_blocks = len(text_blocks)
        
        for block in text_blocks:
            bbox = block['bbox']
            text = block['text'].strip()
            bbox_width = bbox[2] - bbox[0]
            bbox_height = bbox[3] - bbox[1]
            aspect_ratio = bbox_height / bbox_width if bbox_width > 0 else 1
            
            # 세로쓰기 판별 조건들 (가중치 적용)
            score = 0
            
            # 1. 단일/소수 문자 (가장 강한 지표)
            if len(text) == 1:
                score += 3
            elif len(text) == 2:
                score += 2
            elif len(text) <= 4:
                score += 1
            
            # 2. bbox 세로 비율
            if aspect_ratio >= 2.0:
                score += 2
            elif aspect_ratio >= 1.5:
                score += 1
            
            # 3. 한중일 문자 포함
            has_cjk = any(
                '\u4e00' <= char <= '\u9fff' or  # 중국어
                '\u3040' <= char <= '\u309f' or  # 히라가나
                '\u30a0' <= char <= '\u30ff' or  # 가타카나
                '\uac00' <= char <= '\ud7af'     # 한글
                for char in text
            )
            if has_cjk:
                score += 1
            
            # 4. 작은 bbox 크기 (세로쓰기 특징)
            if bbox_width < 50 and bbox_height > bbox_width:
                score += 1
            
            # 스코어가 3 이상이면 세로쓰기 후보
            if score >= 3:
                vertical_indicators += 1
        
        # 전체 블록의 40% 이상이 세로쓰기 패턴이면 세로쓰기로 판단 (임계값 낮춤)
        vertical_ratio = vertical_indicators / total_blocks
        is_vertical_layout = vertical_ratio >= 0.4
        
        self.logger.info(f"📝 세로쓰기 분석: {vertical_indicators}/{total_blocks} 블록 ({vertical_ratio:.2f})")
        
        return is_vertical_layout, text_blocks if is_vertical_layout else []
    
    def _group_vertical_lines(self, text_blocks):
        """세로쓰기 텍스트 블록들을 세로 라인별로 그룹핑 (개선된 알고리즘)"""
        if not text_blocks:
            return []
        
        # X 좌표를 기준으로 세로 라인 그룹핑
        lines = []
        
        # 모든 블록을 X 좌표로 정렬
        sorted_blocks = sorted(text_blocks, key=lambda x: (x['bbox'][0] + x['bbox'][2]) / 2)
        
        current_line = []
        current_x_range = None
        tolerance = 40  # X 좌표 허용 오차 (증가)
        
        for block in sorted_blocks:
            bbox = block['bbox']
            x_center = (bbox[0] + bbox[2]) / 2
            x_left = bbox[0]
            x_right = bbox[2]
            
            if current_x_range is None:
                # 첫 번째 블록
                current_line = [block]
                current_x_range = (x_left, x_right, x_center)
            else:
                range_left, range_right, range_center = current_x_range
                
                # 겹치는 X 범위가 있거나 충분히 가까운지 확인
                overlap = min(x_right, range_right) - max(x_left, range_left)
                distance = abs(x_center - range_center)
                
                if overlap > 0 or distance <= tolerance:
                    # 같은 세로 라인에 속함
                    current_line.append(block)
                    # 범위 업데이트
                    new_left = min(x_left, range_left)
                    new_right = max(x_right, range_right)
                    new_center = sum((b['bbox'][0] + b['bbox'][2]) / 2 for b in current_line) / len(current_line)
                    current_x_range = (new_left, new_right, new_center)
                else:
                    # 새로운 세로 라인 시작
                    if current_line:
                        # 현재 라인을 Y 좌표로 정렬 (위에서 아래로)
                        current_line.sort(key=lambda x: x['bbox'][1])
                        lines.append(current_line)
                    
                    current_line = [block]
                    current_x_range = (x_left, x_right, x_center)
        
        # 마지막 라인 추가
        if current_line:
            current_line.sort(key=lambda x: x['bbox'][1])
            lines.append(current_line)
        
        # 세로 라인들을 오른쪽에서 왼쪽으로 정렬 (세로쓰기 읽기 순서)
        lines.sort(key=lambda line: sum((b['bbox'][0] + b['bbox'][2]) / 2 for b in line) / len(line), reverse=True)
        
        # 디버그 로그
        self.logger.info(f"📝 세로 라인 그룹핑 결과: {len(lines)}개 라인")
        for i, line in enumerate(lines):
            avg_x = sum((b['bbox'][0] + b['bbox'][2]) / 2 for b in line) / len(line)
            texts = [b['text'][:3] for b in line[:3]]  # 처음 3개 블록의 텍스트만
            self.logger.info(f"   라인 {i+1}: X={avg_x:.1f}, {len(line)}개 블록, 텍스트={texts}")
        
        return lines
    
    def _merge_vertical_line_text(self, line_blocks):
        """세로 라인의 텍스트 블록들을 하나의 텍스트로 병합"""
        if not line_blocks:
            return ""
        
        # Y 좌표 순서로 정렬되어 있으므로 순서대로 텍스트 결합
        merged_text = ""
        for i, block in enumerate(line_blocks):
            text = block['text'].strip()
            if text:
                if i > 0:
                    # 세로쓰기에서는 줄바꿈 없이 연결 (또는 공백으로 구분)
                    merged_text += text
                else:
                    merged_text = text
        
        return merged_text
    
    def _create_vertical_line_bbox(self, line_blocks):
        """세로 라인의 모든 블록을 포함하는 bbox 생성"""
        if not line_blocks:
            return None
        
        min_x = min(block['bbox'][0] for block in line_blocks)
        min_y = min(block['bbox'][1] for block in line_blocks)
        max_x = max(block['bbox'][2] for block in line_blocks)
        max_y = max(block['bbox'][3] for block in line_blocks)
        
        return (min_x, min_y, max_x, max_y)
    
    def _process_vertical_lines(self, vertical_lines):
        """세로 라인들을 처리하여 PDF 텍스트 블록으로 변환"""
        processed_blocks = []
        
        for i, line_blocks in enumerate(vertical_lines):
            if not line_blocks:
                continue
            
            # 라인의 텍스트를 병합
            merged_text = self._merge_vertical_line_text(line_blocks)
            if not merged_text.strip():
                continue
            
            # 라인 전체를 포함하는 bbox 생성
            line_bbox = self._create_vertical_line_bbox(line_blocks)
            
            # 라인의 평균 score 계산
            avg_score = sum(block.get('score', 1.0) for block in line_blocks) / len(line_blocks)
            
            processed_block = {
                'bbox': line_bbox,
                'text': merged_text,
                'score': avg_score,
                'is_vertical_line': True,
                'line_blocks': line_blocks  # 원본 블록들 정보 보존
            }
            
            processed_blocks.append(processed_block)
        
        return processed_blocks
    
    def _mark_vertical_blocks(self, all_blocks, vertical_lines):
        """개별 OCR 블록을 유지하면서 세로쓰기 정보만 추가"""
        # 세로 라인에 포함된 블록들의 인덱스 수집
        vertical_block_indices = set()
        for line in vertical_lines:
            for block in line:
                # 원본 블록과 매칭하여 인덱스 찾기
                for i, original_block in enumerate(all_blocks):
                    if (original_block['bbox'] == block['bbox'] and 
                        original_block['text'] == block['text']):
                        vertical_block_indices.add(i)
                        break
        
        # 모든 블록에 세로쓰기 여부 마킹
        marked_blocks = []
        for i, block in enumerate(all_blocks):
            new_block = block.copy()
            new_block['is_vertical_text'] = i in vertical_block_indices
            marked_blocks.append(new_block)
        
        return marked_blocks
    
    def _detect_vertical_text_simple(self, all_blocks):
        """PaddleOCR detection bbox를 믿고 세로쓰기 처리"""
        processed_blocks = []
        vertical_count = 0
        
        for block in all_blocks:
            bbox = block['bbox']
            text = block['text'].strip()
            bbox_width = bbox[2] - bbox[0]
            bbox_height = bbox[3] - bbox[1]
            aspect_ratio = bbox_height / bbox_width if bbox_width > 0 else 1
            
            new_block = block.copy()
            
            # 간단한 조건: bbox가 세로로 길면 세로쓰기
            is_vertical = aspect_ratio >= 1.5
            
            # 세로쓰기 플래그만 설정, 텍스트는 원본 그대로 유지
            new_block['is_vertical_text'] = is_vertical
            new_block['original_text'] = text  # 원본 텍스트 보존
            
            if is_vertical:
                vertical_count += 1
                self.logger.info(f"🔍 세로쓰기 감지: '{text}' (비율: {aspect_ratio:.2f})")
            processed_blocks.append(new_block)
        
        self.logger.info(f"📝 세로쓰기 블록 처리: {vertical_count}/{len(all_blocks)}개")
        return processed_blocks
    
    def _calculate_balanced_text_position(self, text, bbox, font_size, img_height, has_korean):
        """균형잡힌 텍스트 위치 계산 (세로쓰기 지원)"""
        bbox_width = bbox[2] - bbox[0]
        bbox_height = bbox[3] - bbox[1]
        
        # 가로쓰기 텍스트 위치 계산 (기존 로직 유지)
        return self._calculate_horizontal_text_position(text, bbox, font_size, img_height, has_korean)
    
    def _calculate_horizontal_text_position(self, text, bbox, font_size, img_height, has_korean):
        """가로쓰기 텍스트 위치 계산"""
        bbox_width = bbox[2] - bbox[0]
        bbox_height = bbox[3] - bbox[1]
        
        # 보수적인 텍스트 크기 추정
        if has_korean:
            korean_chars = sum(1 for char in text if '\uac00' <= char <= '\ud7af')
            english_chars = len(text) - korean_chars
            estimated_text_width = (korean_chars * font_size * 0.88 +
                                  english_chars * font_size * 0.55)
        else:
            estimated_text_width = len(text) * font_size * 0.58
        
        # 정확한 중앙 정렬
        coverage_fill = CONFIG.get('TEXT_COVERAGE', {}).get('COVERAGE_FILL_RATIO', 0.90)
        if estimated_text_width < bbox_width * coverage_fill:
            x_offset = (bbox_width - estimated_text_width) / 2
        else:
            x_offset = bbox_width * (1 - coverage_fill) / 2
        
        # 텍스트가 bbox 영역 내에만 위치하도록 제한 (확장 없음)
        x = bbox[0] + x_offset
        
        # bbox 경계를 넘지 않도록 제한
        if x < bbox[0]:
            x = bbox[0]
        elif x + estimated_text_width > bbox[2]:
            x = max(bbox[0], bbox[2] - estimated_text_width)
        
        # 정확한 수직 위치
        if has_korean:
            y_offset = font_size * 0.85 + bbox_height * 0.15
        else:
            y_offset = font_size * 0.82 + bbox_height * 0.12
        
        y = img_height - bbox[1] - y_offset
        
        return x, y
    
    def _calculate_vertical_text_position(self, text, bbox, font_size, img_height, has_korean):
        """세로쓰기 텍스트 위치 계산"""
        bbox_width = bbox[2] - bbox[0]
        bbox_height = bbox[3] - bbox[1]
        
        # 세로쓰기의 경우 x 좌표는 bbox 중앙
        text_coverage = CONFIG.get('TEXT_COVERAGE', {})
        expansion = text_coverage.get('BBOX_EXPANSION_PIXELS', 1)
        
        if text_coverage.get('EXPAND_CLICK_AREA', True):
            x = bbox[0] + bbox_width / 2 - font_size / 2
        else:
            x = bbox[0] + bbox_width / 2 - font_size / 2
        
        # 세로쓰기의 경우 y 좌표는 bbox 상단에서 시작
        # 텍스트가 위에서 아래로 읽히므로 상단에 배치
        if has_korean:
            y_offset = font_size * 0.9
        else:
            y_offset = font_size * 0.85
        
        y = img_height - bbox[1] - y_offset
        
        return x, y
    
    def _calculate_vertical_line_position(self, text, bbox, font_size, img_height, has_korean):
        """세로쓰기 라인의 텍스트 위치 계산"""
        bbox_width = bbox[2] - bbox[0]
        
        # 세로쓰기 라인의 경우 x 좌표는 bbox 중앙
        x = bbox[0] + bbox_width / 2 - font_size / 2
        
        # 세로쓰기 라인의 y 좌표는 bbox 상단에서 시작
        if has_korean:
            y_offset = font_size * 0.9
        else:
            y_offset = font_size * 0.85
        
        y = img_height - bbox[1] - y_offset
        
        return x, y
    
    def _draw_vertical_text_in_bbox(self, canvas_obj, text, bbox, font_size, img_height):
        """세로쓰기 텍스트를 bbox 안에 세로로 배치"""
        bbox_width = bbox[2] - bbox[0]
        bbox_height = bbox[3] - bbox[1]
        
        # bbox 중앙의 x 좌표
        center_x = bbox[0] + bbox_width / 2 - font_size / 3  # 약간 왼쪽으로 조정
        
        # bbox 상단부터 시작하는 y 좌표 (PDF 좌표계에서)
        start_y = img_height - bbox[1] - font_size * 0.8
        
        # 각 글자를 세로로 배치
        char_y = start_y
        char_spacing = font_size * 1.0  # 글자 간격
        
        for char in text:
            if char.strip():  # 공백이 아닌 문자만
                canvas_obj.drawString(center_x, char_y, char)
                char_y -= char_spacing  # 아래쪽으로 이동
                
                # bbox를 벗어나지 않도록 체크
                if char_y < img_height - bbox[3]:
                    break
    
    def _draw_individual_vertical_text(self, canvas_obj, text, x, y, font_size):
        """개별 세로쓰기 텍스트 렌더링 (bbox 내에서)"""
        # 각 글자를 세로로 배치
        char_y = y
        line_height = font_size * 1.1  # 글자 간격
        
        for char in text:
            if char.strip():  # 공백이 아닌 문자만 렌더링
                canvas_obj.drawString(x, char_y, char)
                char_y -= line_height  # 아래쪽으로 이동
    
    def _create_image_only_pdf(self, image, output_path, img_width, img_height):
        """이미지 전용 PDF 생성"""
        try:
            c = canvas.Canvas(str(output_path), pagesize=(img_width, img_height))
            
            img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(img_rgb)
            temp_img_path = self.output_dir / f"temp_image_only.png"
            pil_img.save(temp_img_path)
            c.drawImage(str(temp_img_path), 0, 0, width=img_width, height=img_height)
            
            c.save()
            
            if temp_img_path.exists():
                temp_img_path.unlink()
            
            self.logger.info("이미지 전용 PDF 생성 완료")
            return str(output_path)
            
        except Exception as e:
            self.logger.error(f"이미지 전용 PDF 생성 실패: {e}")
            return None

class OCRPDFPipeline:
    """균형잡힌 OCR PDF 생성 파이프라인"""
    
    def __init__(self, config):
        self.config = config
        self.logger = self._setup_logging(config['LOG_DIR'])
        
        try:
            self.ocr_model = CustomOCRModel(
                config['RECOGNITION_MODEL_DIR'],
                config['USE_GPU']
            )
        except RuntimeError as e:
            self.logger.error(f"OCR 모델 초기화 실패: {e}")
            raise
        
        self.pdf_generator = OCRPDFGenerator(config)
        
        self._print_initialization_banner()
    
    def _print_initialization_banner(self):
        """균형잡힌 초기화 배너 출력"""
        banner = """
╔═══════════════════════════════════════════════════════════════════════════════╗
║                  🎯 균형잡힌 텍스트 커버리지 OCR PDF 생성기                      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  🔧 다단 감지: 4가지 방법 조합 + 디버그 시각화                                  ║
║  📏 폰트 계산: PIL 실측 + 적정 크기 + 균형잡힌 커버리지                          ║
║  🎯 텍스트 위치: 정확한 배치 + 최소 확장 + 적절한 클릭영역                        ║
║  🔍 텍스트 복구: 누락 텍스트 자동 복구 (품질 기준 적용)                          ║
║  📊 scikit-learn: """ + ("✅ 사용 가능" if SKLEARN_AVAILABLE else "❌ 미설치") + """ (클러스터링 분석)                     ║
╚═══════════════════════════════════════════════════════════════════════════════╝
        """
        print(banner)
        
        self.logger.info("🎯 균형잡힌 텍스트 커버리지 OCR PDF 파이프라인 초기화 완료")
        
        coverage_settings = CONFIG['TEXT_COVERAGE']
        self.logger.info(f"   클릭영역 확장: {'최소' if coverage_settings['EXPAND_CLICK_AREA'] else '비활성'}")
        self.logger.info(f"   다중레이어 렌더링: {'비활성' if not coverage_settings['MULTI_LAYER_RENDERING'] else '활성'}")
        self.logger.info(f"   텍스트 복구: {'활성' if coverage_settings['ENABLE_TEXT_RECOVERY'] else '비활성'}")
        self.logger.info(f"   bbox 채움율: {coverage_settings['COVERAGE_FILL_RATIO']*100:.0f}%")
        self.logger.info(f"   폰트 부스트: {coverage_settings['FONT_SIZE_BOOST']}배")
        
        if not SKLEARN_AVAILABLE:
            self.logger.warning("⚠️ scikit-learn 미설치: pip install scikit-learn 권장")
    
    def _setup_logging(self, log_dir):
        """로깅 설정"""
        log_path = Path(log_dir)
        log_path.mkdir(parents=True, exist_ok=True)
        
        current_time = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_filename = f"{current_time}_balanced_ocr_pipeline.log"
        log_file_path = log_path / log_filename
        
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_file_path, encoding='utf-8'),
                logging.StreamHandler()
            ]
        )
        
        return logging.getLogger(__name__)
    
    def process_image(self, image_path, output_path=None):
        """단일 이미지 처리 (균형잡힌 텍스트 커버리지)"""
        try:
            self.logger.info(f"🔄 균형잡힌 처리 시작: {Path(image_path).name}")
            
            ocr_results = self.ocr_model.predict(image_path)
            
            if ocr_results is None:
                self.logger.warning(f"⚠️ OCR 결과 없음: {image_path}")
                return None
            
            pdf_path = self.pdf_generator.generate_pdf(image_path, ocr_results, output_path)
            
            if pdf_path:
                self.logger.info(f"✅ 균형잡힌 처리 완료: {Path(pdf_path).name}")
            
            return pdf_path
            
        except Exception as e:
            self.logger.error(f"❌ 균형잡힌 처리 실패 ({image_path}): {e}")
            return None
    
    def find_image_files(self, input_dir):
        """지원되는 이미지 파일들 찾기"""
        image_files = []
        input_path = Path(input_dir)
        
        if not input_path.exists():
            self.logger.error(f"입력 디렉토리 없음: {input_dir}")
            return image_files
        
        for ext in self.config['SUPPORTED_EXTENSIONS']:
            image_files.extend(glob.glob(str(input_path / "**" / ext), recursive=True))
            image_files.extend(glob.glob(str(input_path / "**" / ext.upper()), recursive=True))
        
        image_files.sort()
        self.logger.info(f"📂 발견된 이미지: {len(image_files)}개")
        return image_files
    
    def run_batch(self):
        """배치 처리 실행 (균형잡힌 텍스트 커버리지)"""
        self.logger.info("🚀 균형잡힌 텍스트 커버리지 배치 OCR PDF 생성 시작")
        
        image_files = self.find_image_files(self.config['INPUT_IMAGE_DIR'])
        
        if not image_files:
            self.logger.error(f"❌ 처리할 이미지 파일이 없습니다: {self.config['INPUT_IMAGE_DIR']}")
            return False
        
        success_count = 0
        total_count = len(image_files)
        
        print(f"📊 총 {total_count}개 이미지 균형잡힌 처리 시작...")
        
        for i, image_path in enumerate(image_files, 1):
            print(f"🔄 진행률: {i}/{total_count} ({i/total_count*100:.1f}%) - {Path(image_path).name}")
            
            if self.process_image(image_path):
                success_count += 1
        
        success_rate = (success_count / total_count * 100) if total_count > 0 else 0
        
        final_banner = f"""
╔═══════════════════════════════════════════════════════════════════════════════╗
║                     🎉 균형잡힌 텍스트 커버리지 완료!                            ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  📊 처리 결과: {success_count:3d}/{total_count:3d} 이미지 성공 ({success_rate:5.1f}%)                        ║
║  📁 출력 경로: {str(self.config['OUTPUT_PDF_DIR']):<50} ║
║  🔍 디버그 이미지: {str(CONFIG.get('COLUMN_DETECTION', {}).get('DEBUG_OUTPUT_DIR', 'N/A')):<44} ║
╚═══════════════════════════════════════════════════════════════════════════════╝
        """
        print(final_banner)
        
        self.logger.info(f"🏁 균형잡힌 처리 완료! {success_count}/{total_count} 이미지 처리 성공 ({success_rate:.1f}%)")
        return success_count > 0

def main():
    """메인 실행 함수"""
    try:
        pipeline = OCRPDFPipeline(CONFIG)
        success = pipeline.run_batch()
        
        if success:
            print("\n🎊 균형잡힌 텍스트 커버리지가 성공적으로 완료되었습니다!")
        else:
            print("\n💥 작업 실패! 로그를 확인하세요.")
            
    except Exception as e:
        print(f"\n❌ 파이프라인 실행 중 오류 발생: {e}")
        logging.error(f"파이프라인 실행 오류: {e}")

if __name__ == "__main__":
    main()
