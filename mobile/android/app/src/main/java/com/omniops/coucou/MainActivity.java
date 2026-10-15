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

public class MainActivity extends AppCompatActivity {
    private static final String PREFS_NAME = "omniops_mobile_prefs";
    private static final String KEY_SERVER_URL = "server_url";

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
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                // Fallback to bundled offline dashboard
                view.loadUrl("file:///android_asset/index.html");
            }
        });

        webView.addJavascriptInterface(new OmniOpsAndroidBridge(), "OmniOpsBridge");
    }

    private void loadInitialContent() {
        String savedUrl = prefs.getString(KEY_SERVER_URL, "");
        if (!savedUrl.isEmpty()) {
            webView.loadUrl(savedUrl);
        } else {
            webView.loadUrl("file:///android_asset/index.html");
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
        public void setServerUrl(String url) {
            prefs.edit().putString(KEY_SERVER_URL, url).apply();
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, "آدرس سرور ذخیره شد: " + url, Toast.LENGTH_SHORT).show();
                webView.loadUrl(url);
            });
        }

        @JavascriptInterface
        public String getServerUrl() {
            return prefs.getString(KEY_SERVER_URL, "");
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

        private void triggerJs(String code) {
            webView.post(() -> webView.evaluateJavascript(code, null));
        }
    }
}
