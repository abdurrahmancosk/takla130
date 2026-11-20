package com.takla130.oyun;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

/**
 * Oyunun kabuğu: tam ekran, yatay WebView. Oyun dosyaları uygulamanın içinde (assets/game),
 * internet gerekmez. Dosyalar https://appassets.androidplatform.net/assets/... adresinden sunulur;
 * böylece ES modülleri (three.js) file:// kısıtlamasına takılmadan yüklenir.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/game/index.html";

    private WebView web;
    private LanBridge lan;
    private float[] safe = new float[] {0, 0, 0, 0};

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(14, 16, 19));
        setContentView(web);
        hideBars();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // ayarlar, ad, rekorlar
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);                           // sistem yazı boyutu oyunun düzenini bozmasın (MIUI / HarmonyOS)
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost());     // dış bağlantılar açılmaz
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushSafeArea();
            }
        });

        lan = new LanBridge(this);
        web.addJavascriptInterface(lan, "TaklaLan");

        // ekran çentiği (ön kamera deliği) için güvenli kenar boşlukları -> CSS piksel
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            Insets c = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            float d = getResources().getDisplayMetrics().density;
            safe = new float[] {c.left / d, c.top / d, c.right / d, c.bottom / d};
            pushSafeArea();
            return insets;
        });

        if (state == null || web.restoreState(state) == null) web.loadUrl(START);
    }

    private void pushSafeArea() {
        if (web == null) return;
        String js = String.format(java.util.Locale.US, "window.setSafeArea&&window.setSafeArea(%.1f,%.1f,%.1f,%.1f)",
                safe[0], safe[1], safe[2], safe[3]);
        web.evaluateJavascript(js, null);
    }

    private void hideBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // geri tuşu oyuna gider: oyunda duraklatır, menüde iki kez basınca çıkar
        web.evaluateJavascript("window.onAndroidBack&&window.onAndroidBack()", null);
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.onAndroidPause&&window.onAndroidPause()", null);
            web.onPause();
        }
        if (lan != null) lan.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideBars();
        if (lan != null) lan.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.onAndroidResume&&window.onAndroidResume()", null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (lan != null) lan.stop();
        if (web != null) {
            web.removeJavascriptInterface("TaklaLan");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
