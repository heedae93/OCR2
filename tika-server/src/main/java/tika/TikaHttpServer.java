package tika;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Tika 텍스트 추출 HTTP 서버
 *
 * 엔드포인트:
 *   GET  /health          → 200 "OK"
 *   POST /extract         → JSON {"filePath":"...","ext":".pdf"} → text/plain
 *
 * 실행: java -jar tika-extract-server-1.0.0.jar [PORT]
 *       기본 포트: 9090
 */
public class TikaHttpServer {

    private static final TikaExtractor EXTRACTOR = new TikaExtractor();

    public static void main(String[] args) throws IOException {
        int port = (args.length > 0) ? Integer.parseInt(args[0]) : 9090;

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);

        // 동시 처리: CPU 코어 수 × 2 스레드
        server.setExecutor(Executors.newFixedThreadPool(
                Runtime.getRuntime().availableProcessors() * 2));

        server.createContext("/health", TikaHttpServer::handleHealth);
        server.createContext("/extract", TikaHttpServer::handleExtract);

        server.start();
        System.out.println("[Tika] HTTP 서버 시작 — 포트 " + port);
        System.out.println("[Tika] POST /extract   {\"filePath\":\"...\",\"ext\":\".pdf\"}");
        System.out.println("[Tika] GET  /health");
    }

    // ── 핸들러 ────────────────────────────────────────────────────────────

    private static void handleHealth(HttpExchange ex) throws IOException {
        if (!"GET".equalsIgnoreCase(ex.getRequestMethod())) {
            sendResponse(ex, 405, "Method Not Allowed");
            return;
        }
        sendResponse(ex, 200, "OK");
    }

    private static void handleExtract(HttpExchange ex) throws IOException {
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            sendResponse(ex, 405, "Method Not Allowed");
            return;
        }

        // 요청 바디 읽기
        String body;
        try (InputStream is = ex.getRequestBody()) {
            body = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }

        // JSON 파싱 ({"filePath":"...","ext":"..."})
        String filePath = parseJsonString(body, "filePath");
        String ext      = parseJsonString(body, "ext");

        if (filePath == null || filePath.isEmpty()) {
            sendResponse(ex, 400, "filePath 필드가 없습니다");
            return;
        }
        if (ext == null || ext.isEmpty()) {
            sendResponse(ex, 400, "ext 필드가 없습니다");
            return;
        }

        File file = new File(filePath);
        if (!file.exists() || !file.isFile()) {
            sendResponse(ex, 404, "파일을 찾을 수 없습니다: " + filePath);
            return;
        }

        // 텍스트 추출
        String text;
        try {
            text = EXTRACTOR.extractByExt(file, ext);
        } catch (Exception e) {
            System.err.println("[Tika] 추출 오류: " + filePath + " — " + e.getMessage());
            sendResponse(ex, 500, "추출 실패: " + e.getMessage());
            return;
        }

        if (text == null) {
            sendResponse(ex, 500, "추출 결과가 null입니다");
            return;
        }

        sendResponse(ex, 200, text);
    }

    // ── 유틸 ──────────────────────────────────────────────────────────────

    private static void sendResponse(HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "text/plain; charset=UTF-8");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }

    /** 단순 JSON 문자열 필드 파싱 (외부 라이브러리 불필요) */
    private static final Pattern JSON_STRING =
            Pattern.compile("\"([^\"]+)\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");

    private static String parseJsonString(String json, String key) {
        Pattern p = Pattern.compile(
                "\"" + Pattern.quote(key) + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        Matcher m = p.matcher(json);
        if (!m.find()) return null;
        // JSON string unescape (minimal, correct enough for Windows paths)
        // IMPORTANT: do NOT do a blanket "\\\\" -> "\\" replacement; it breaks sequences like "C:\\\\Users\\\\..."
        String s = m.group(1);
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '\\' || i + 1 >= s.length()) {
                out.append(c);
                continue;
            }
            char n = s.charAt(i + 1);
            switch (n) {
                case '\\':
                    out.append('\\');
                    i++;
                    break;
                case '"':
                    out.append('"');
                    i++;
                    break;
                case '/':
                    out.append('/');
                    i++;
                    break;
                case 'b':
                    out.append('\b');
                    i++;
                    break;
                case 'f':
                    out.append('\f');
                    i++;
                    break;
                case 'n':
                    out.append('\n');
                    i++;
                    break;
                case 'r':
                    out.append('\r');
                    i++;
                    break;
                case 't':
                    out.append('\t');
                    i++;
                    break;
                case 'u':
                    // Unicode escape: backslash-u plus 4 hex digits
                    if (i + 5 < s.length()) {
                        String hex = s.substring(i + 2, i + 6);
                        try {
                            int code = Integer.parseInt(hex, 16);
                            out.append((char) code);
                            // consumed: 'u' + 4 hex digits (outer loop will advance one more)
                            i += 5;
                        } catch (NumberFormatException e) {
                            // malformed escape — keep as-is
                            out.append(c);
                        }
                    } else {
                        out.append(c);
                    }
                    break;
                default:
                    // Unknown escape — keep backslash + next char (lenient)
                    out.append(n);
                    i++;
                    break;
            }
        }
        return out.toString();
    }
}
