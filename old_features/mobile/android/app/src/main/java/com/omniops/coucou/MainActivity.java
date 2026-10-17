package com.omniops.coucou;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

public class MainActivity extends AppCompatActivity {
    private static final String PREFS_NAME = "omniops_mobile_prefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTH_TOKEN = "auth_token";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_ROLE = "role";
    private static final String DEFAULT_SERVER_URL = "";

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private SharedPreferences prefs;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        webView = findViewById(R.id.web_view);
        swipeRefresh = findViewById(R.id.swipe_refresh);

        setupWebView();

        swipeRefresh.setOnRefreshListener(() -> {
            webView.reload();
            swipeRefresh.setRefreshing(false);
        });

        loadInitialContent();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                // Fallback to bundled dedicated mobile operator console
                view.loadUrl("file:///android_asset/index.html");
            }
        });

        webView.addJavascriptInterface(new OmniOpsAndroidBridge(), "OmniOpsBridge");
    }

    private void loadInitialContent() {
        // ALWAYS keep the app inside the dedicated Mobile Operator Console
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        String currentUrl = webView.getUrl();
        if (currentUrl != null && !currentUrl.startsWith("file:///android_asset/")) {
            // Return from external web view back to the dedicated mobile operator console
            webView.loadUrl("file:///android_asset/index.html");
            return;
        }
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    public class OmniOpsAndroidBridge {

        @JavascriptInterface
        public void authenticateBiometric(String title, String subtitle, String callbackJs) {
            runOnUiThread(() -> {
                BiometricHelper.authenticate(MainActivity.this, title, subtitle, new BiometricHelper.BiometricCallback() {
                    @Override
                    public void onSuccess() {
                        triggerJs(callbackJs + "(true, 'success')");
                    }

                    @Override
                    public void onError(int errorCode, String errString) {
                        triggerJs(callbackJs + "(false, '" + errString.replace("'", "\\'") + "')");
                    }

                    @Override
                    public void onFailed() {
                        triggerJs(callbackJs + "(false, 'failed')");
                    }
                });
            });
        }

        @JavascriptInterface
        public boolean hasBiometric() {
            return BiometricHelper.isBiometricAvailable(MainActivity.this);
        }

        @JavascriptInterface
        public void saveSession(String serverUrl, String token, String username, String role) {
            prefs.edit()
                .putString(KEY_SERVER_URL, serverUrl != null ? serverUrl.trim() : "")
                .putString(KEY_AUTH_TOKEN, token != null ? token.trim() : "")
                .putString(KEY_USERNAME, username != null ? username.trim() : "")
                .putString(KEY_ROLE, role != null ? role.trim() : "")
                .apply();
        }

        @JavascriptInterface
        public String getSession() {
            JSONObject obj = new JSONObject();
            try {
                obj.put("serverUrl", prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL));
                obj.put("token", prefs.getString(KEY_AUTH_TOKEN, ""));
                obj.put("username", prefs.getString(KEY_USERNAME, ""));
                obj.put("role", prefs.getString(KEY_ROLE, ""));
            } catch (Exception ignored) {}
            return obj.toString();
        }

        @JavascriptInterface
        public void clearSession() {
            prefs.edit()
                .remove(KEY_AUTH_TOKEN)
                .remove(KEY_USERNAME)
                .remove(KEY_ROLE)
                .apply();
        }

        @JavascriptInterface
        public void setServerUrl(String url) {
            prefs.edit().putString(KEY_SERVER_URL, url != null ? url.trim() : "").apply();
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, "آدرس سرور ذخیره شد", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public String getServerUrl() {
            return prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL);
        }

        @JavascriptInterface
        public void openDesktopWeb(String url) {
            runOnUiThread(() -> {
                if (url != null && !url.isEmpty()) {
                    webView.loadUrl(url);
                }
            });
        }

        @JavascriptInterface
        public void returnToMobileOperator() {
            runOnUiThread(() -> {
                webView.loadUrl("file:///android_asset/index.html");
            });
        }

        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void vibrateDevice(int durationMs) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(durationMs);
                }
            }
        }

        @JavascriptInterface
        public void toggleFloatingService(boolean enable) {
            Intent serviceIntent = new Intent(MainActivity.this, CoucouFloatingService.class);
            if (enable) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent);
                } else {
                    startService(serviceIntent);
                }
            } else {
                stopService(serviceIntent);
            }
        }

        @JavascriptInterface
        public void httpRequest(String urlStr, String method, String headersJson, String bodyJson, String callbackJs) {
            new Thread(() -> {
                HttpURLConnection conn = null;
                try {
                    URL url = new URL(urlStr);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod(method != null ? method.toUpperCase() : "GET");
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(15000);
                    conn.setDoInput(true);

                    if (headersJson != null && !headersJson.isEmpty()) {
                        JSONObject headers = new JSONObject(headersJson);
                        Iterator<String> keys = headers.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            conn.setRequestProperty(k, headers.getString(k));
                        }
                    }

                    if (bodyJson != null && !bodyJson.isEmpty() && !"GET".equalsIgnoreCase(method)) {
                        conn.setDoOutput(true);
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(bodyJson.getBytes(StandardCharsets.UTF_8));
                        }
                    }

                    int code = conn.getResponseCode();
                    InputStream is = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
                    String responseBody = "";
                    if (is != null) {
                        try (BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                            StringBuilder sb = new StringBuilder();
                            String line;
                            while ((line = reader.readLine()) != null) {
                                sb.append(line);
                            }
                            responseBody = sb.toString();
                        }
                    }

                    String escapedBody = responseBody.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "");
                    triggerJs(callbackJs + "(" + code + ", '" + escapedBody + "')");
                } catch (Exception e) {
                    String err = e.getMessage() != null ? e.getMessage().replace("'", "\\'") : "Network error";
                    triggerJs(callbackJs + "(-1, '" + err + "')");
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            }).start();
        }

        private void triggerJs(String code) {
            webView.post(() -> webView.evaluateJavascript(code, null));
        }
    }
}
