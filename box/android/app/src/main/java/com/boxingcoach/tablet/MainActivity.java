package com.boxingcoach.tablet;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int CAMERA_PERMISSION_REQUEST = 1001;
    private static final String APP_HOST = "app.local";
    private static final String LOCAL_APP_URL = "https://" + APP_HOST + "/index.html";
    private static final String HOSTED_APP_URL = BuildConfig.HOSTED_APP_URL.trim();
    private WebView webView;
    private PermissionRequest pendingCameraRequest;
    private Uri allowedOrigin;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        boolean hostedMode = !HOSTED_APP_URL.isEmpty();
        Uri appUri = Uri.parse(hostedMode ? HOSTED_APP_URL : LOCAL_APP_URL);
        if (hostedMode && !"https".equalsIgnoreCase(appUri.getScheme())) {
            throw new IllegalStateException("Hosted Android app URL must use HTTPS");
        }
        allowedOrigin = appUri;
        webView.addJavascriptInterface(new PlatformBridge(hostedMode), "BoxingCoachAndroid");
        webView.setWebViewClient(hostedMode ? new HostedAppClient() : new LocalAssetClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }
        });
        webView.loadUrl(appUri.toString());
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        Uri origin = request.getOrigin();
        if (origin == null || !sameOrigin(allowedOrigin, origin)) {
            request.deny();
            return;
        }
        List<String> allowed = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                allowed.add(resource);
            }
        }
        if (allowed.isEmpty()) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(allowed.toArray(new String[0]));
            return;
        }
        pendingCameraRequest = request;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_REQUEST || pendingCameraRequest == null) {
            return;
        }
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            pendingCameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingCameraRequest.deny();
        }
        pendingCameraRequest = null;
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }

    private final class LocalAssetClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !sameOrigin(allowedOrigin, request.getUrl());
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!APP_HOST.equals(uri.getHost())) {
                return null;
            }
            String path = uri.getPath();
            if (path == null || path.equals("/")) {
                path = "/index.html";
            }
            String assetPath = path.substring(1);
            if (assetPath.contains("..")) {
                return response(403, "text/plain", "Forbidden");
            }
            try {
                InputStream stream = getAssets().open(assetPath);
                return new WebResourceResponse(mimeType(assetPath), encoding(assetPath), stream);
            } catch (IOException error) {
                return response(404, "text/plain", "Not found");
            }
        }

        private WebResourceResponse response(int status, String mimeType, String body) {
            return new WebResourceResponse(
                mimeType,
                "UTF-8",
                status,
                status == 404 ? "Not Found" : "Forbidden",
                null,
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8))
            );
        }

        private String encoding(String path) {
            String lower = path.toLowerCase(Locale.ROOT);
            if (lower.endsWith(".wasm") || lower.endsWith(".task")) {
                return null;
            }
            return "UTF-8";
        }

        private String mimeType(String path) {
            String lower = path.toLowerCase(Locale.ROOT);
            if (lower.endsWith(".html")) return "text/html";
            if (lower.endsWith(".css")) return "text/css";
            if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
            if (lower.endsWith(".json")) return "application/json";
            if (lower.endsWith(".wasm")) return "application/wasm";
            if (lower.endsWith(".task")) return "application/octet-stream";
            if (lower.endsWith(".svg")) return "image/svg+xml";
            if (lower.endsWith(".png")) return "image/png";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
            return "application/octet-stream";
        }
    }

    private final class HostedAppClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !sameOrigin(allowedOrigin, request.getUrl());
        }
    }

    private static boolean sameOrigin(Uri expected, Uri candidate) {
        return expected != null
            && candidate != null
            && String.valueOf(expected.getScheme()).equalsIgnoreCase(String.valueOf(candidate.getScheme()))
            && String.valueOf(expected.getHost()).equalsIgnoreCase(String.valueOf(candidate.getHost()))
            && effectivePort(expected) == effectivePort(candidate);
    }

    private static int effectivePort(Uri uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private static final class PlatformBridge {
        private final boolean hostedMode;

        private PlatformBridge(boolean hostedMode) {
            this.hostedMode = hostedMode;
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public boolean offlineMode() {
            return !hostedMode;
        }
    }
}
