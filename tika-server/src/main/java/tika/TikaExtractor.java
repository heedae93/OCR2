package tika;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.util.regex.Pattern;

import org.apache.tika.exception.TikaException;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.parser.AutoDetectParser;
import org.apache.tika.parser.ParseContext;
import org.apache.tika.parser.Parser;
import org.apache.tika.parser.hwp.HwpV5Parser;
import org.apache.tika.parser.microsoft.OfficeParserConfig;
import org.apache.tika.parser.pdf.PDFParserConfig;
import org.apache.tika.sax.BodyContentHandler;
import org.xml.sax.SAXException;

/**
 * 파일 유형별 텍스트 추출 (Java Tika 임베디드 100% 활용)
 * Spring/DB 의존성 없이 순수 추출 로직만 포함
 */
public class TikaExtractor {

    // 파일/경로처럼 보이는 줄 판단 정규식 (Java 원본 그대로)
    private final Pattern FILENAME_LIKE = Pattern.compile("^[^\\s]+(?:/[^\\s]+)*\\.[^\\s]+$");

    /** 확장자에 따라 적절한 추출 메서드로 라우팅 */
    public String extractByExt(File file, String ext) {
        String lower = (ext == null ? "" : ext.toLowerCase());
        switch (lower) {
            case ".hwp":  return extractTextHwp(file);
            case ".hwpx": return extractSection0(extractTextHwpx(file));
            case ".doc":
            case ".docx": return extractTextWord(file);
            case ".xls":
            case ".xlsx": return extractTextExcel(file);
            case ".ppt":
            case ".pptx": return extractTextPpt(file);
            case ".pdf":  return extractTextPdf(file);
            default:      return extractTextCommon(file);
        }
    }

    /** Word */
    public String extractTextWord(File file)  { return extractTextCommon(file); }

    /** Excel */
    public String extractTextExcel(File file) { return extractTextCommon(file); }

    /** PowerPoint */
    public String extractTextPpt(File file)   { return extractTextCommon(file); }

    /** PDF 전용 */
    public String extractTextPdf(File file)   { return extractTextCommon(file); }

    /** HWP 전용 (HwpV5Parser 우선, 실패 시 공통으로 폴백) */
    public String extractTextHwp(File file) {
        try (InputStream is = new FileInputStream(file)) {
            BodyContentHandler handler = new BodyContentHandler(-1);
            Metadata metadata = new Metadata();
            ParseContext ctx = new ParseContext();
            new HwpV5Parser().parse(is, handler, metadata, ctx);
            return handler.toString();
        } catch (Exception e) {
            return extractTextCommon(file);
        }
    }

    /** HWPX(XML 패키지): 텍스트만 깔끔하게 (후처리 적용) */
    public String extractTextHwpx(File file) {
        String raw = extractTextCommon(file);
        return cleanPlainText(raw);
    }

    /** AutoDetectParser + 컨피그 주입하여 텍스트 추출 (PDF 설정 포함) */
    public String extractTextCommon(File file) {
        BodyContentHandler handler = new BodyContentHandler(-1);
        Metadata metadata = new Metadata();
        Parser parser = new AutoDetectParser();
        ParseContext context = new ParseContext();

        context.set(Parser.class, parser);
        context.set(OfficeParserConfig.class, officeConfig());
        context.set(PDFParserConfig.class, pdfConfig());

        try (InputStream is = new FileInputStream(file)) {
            parser.parse(is, handler, metadata, context);
            return handler.toString();
        } catch (IOException | TikaException | SAXException e) {
            System.err.println("[Tika] 추출 실패: " + file.getName() + " - " + e.getMessage());
            return null;
        }
    }

    // ── 텍스트 후처리 ──────────────────────────────────────────────────────

    /** 줄바꿈/공백/nbsp 등을 정리해서 깔끔한 텍스트로 반환 (Java 원본 그대로) */
    private static String cleanPlainText(String s) {
        if (s == null) return "";
        String out = s;
        out = out.replace("\r\n", "\n").replace("\r", "\n");
        out = out.replace(' ', ' ')
                 .replace('​', ' ')
                 .replace('﻿', ' ');
        out = out.replaceAll("[ \\t\\x0B\\f]+", " ");
        out = out.replaceAll("\\n{3,}", "\n\n");
        out = out.replaceAll("[ \\t]+\\n", "\n");
        return out.trim();
    }

    /**
     * HWPX AutoDetect 결과에서 "Contents/section0.xml" 이후 본문만 추출 (Java 원본 그대로)
     */
    public String extractSection0(String fullText) {
        if (fullText == null || fullText.isEmpty()) return "";

        try (BufferedReader br = new BufferedReader(new StringReader(fullText))) {
            String line;
            boolean inTarget = false;
            StringBuilder sb = new StringBuilder();

            while ((line = br.readLine()) != null) {
                String trimmed = line.trim();
                if (!inTarget) {
                    if ("Contents/section0.xml".equals(trimmed)) {
                        inTarget = true;
                    }
                } else {
                    if (isFilenameLike(trimmed)) {
                        break;
                    }
                    sb.append(line).append(System.lineSeparator());
                }
            }

            if (sb.length() == 0) return "";
            while (sb.length() > 0 &&
                   (sb.charAt(sb.length() - 1) == '\n' || sb.charAt(sb.length() - 1) == '\r')) {
                sb.setLength(sb.length() - 1);
            }
            return sb.toString();
        } catch (IOException e) {
            throw new RuntimeException("입력 텍스트 처리 중 오류", e);
        }
    }

    private boolean isFilenameLike(String line) {
        if (line == null || line.isEmpty()) return false;
        return FILENAME_LIKE.matcher(line).matches();
    }

    // ── Tika 파서 설정 ────────────────────────────────────────────────────

    /** OfficeParserConfig (Java 원본 그대로) */
    private OfficeParserConfig officeConfig() {
        OfficeParserConfig cfg = new OfficeParserConfig();
        cfg.setIncludeHeadersAndFooters(false);
        cfg.setIncludeDeletedContent(false);
        cfg.setIncludeMoveFromContent(true);
        cfg.setIncludeShapeBasedContent(false);
        cfg.setExtractMacros(false);
        invokeIfExists(cfg, "setUseSAXDocxExtractor",    new Class[]{boolean.class}, new Object[]{true});
        invokeIfExists(cfg, "setUseSAXPptxExtractor",    new Class[]{boolean.class}, new Object[]{true});
        invokeIfExists(cfg, "setIncludeCellComments",    new Class[]{boolean.class}, new Object[]{true});
        invokeIfExists(cfg, "setExtractCellComments",    new Class[]{boolean.class}, new Object[]{true});
        invokeIfExists(cfg, "setExtractSheetsFromXLSX",  new Class[]{boolean.class}, new Object[]{true});
        invokeIfExists(cfg, "setIncludeSlideNotes",      new Class[]{boolean.class}, new Object[]{true});
        invokeIfExists(cfg, "setIncludeSlideMasterContent", new Class[]{boolean.class}, new Object[]{false});
        return cfg;
    }

    /** PDFParserConfig (Java 원본 그대로) */
    private PDFParserConfig pdfConfig() {
        PDFParserConfig pdf = new PDFParserConfig();
        pdf.setSortByPosition(true);
        pdf.setExtractAnnotationText(true);
        pdf.setExtractAcroFormContent(true);
        pdf.setExtractInlineImages(false);
        invokeIfExists(pdf, "setAddMoreFormatting",                new Class[]{boolean.class}, new Object[]{true});
        invokeIfExists(pdf, "setSuppressDuplicateOverlappingText", new Class[]{boolean.class}, new Object[]{true});
        try {
            @SuppressWarnings("rawtypes")
            Class<?> ocrEnum = Class.forName("org.apache.tika.parser.pdf.PDFParserConfig$OCR_STRATEGY");
            @SuppressWarnings({"unchecked","rawtypes"})
            Object NONE = Enum.valueOf((Class<Enum>) ocrEnum, "NO_OCR");
            invokeIfExists(pdf, "setOcrStrategy", new Class[]{ocrEnum}, new Object[]{NONE});
        } catch (Throwable ignore) {}
        return pdf;
    }

    /** 리플렉션 보조: 메서드가 있으면만 호출 (Java 원본 그대로) */
    private void invokeIfExists(Object target, String methodName, Class<?>[] paramTypes, Object[] args) {
        try {
            java.lang.reflect.Method m = target.getClass().getMethod(methodName, paramTypes);
            m.invoke(target, args);
        } catch (NoSuchMethodException e) {
            // 현재 Tika 버전에 없는 옵션 → 무시
        } catch (Exception e) {
            System.err.println("[Tika Config] " + methodName + " 호출 실패: " + e.getMessage());
        }
    }
}
