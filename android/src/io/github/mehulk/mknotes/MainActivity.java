package io.github.mehulk.mknotes;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.IOException;

/**
 * MK Notes: the notes web app, bundled, in a full-screen WebView. The page is
 * served from https://appassets.androidplatform.net/ (Android's reserved
 * address for app files), so it gets a proper origin: storage that survives,
 * and fetches to the laptop with the pairing key.
 */
public class MainActivity extends Activity {
    private static final int PICK_FILE = 1;
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private WebView web;
    private ValueCallback<Uri[]> pending;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // The laptop is plain http on your Wi-Fi; the pairing key guards it.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost())) return null;
                String name = uri.getLastPathSegment() == null ? "index.html" : uri.getLastPathSegment();
                String type = name.endsWith(".js") ? "text/javascript" : name.endsWith(".svg") ? "image/svg+xml"
                        : name.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
                try {
                    return new WebResourceResponse(type, "utf-8", getAssets().open(name));
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));  // web links open in the browser
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pending != null) pending.onReceiveValue(null);
                pending = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("image/*");
                startActivityForResult(Intent.createChooser(pick, "Add a photo"), PICK_FILE);
                return true;
            }
        });
        setContentView(web);
        web.loadUrl(pageFor(getIntent()));
    }

    /** mknotes://pair?server=http://192.168.1.5:8765/&key=... becomes the page's #key= pairing. */
    private String pageFor(Intent intent) {
        String page = HOME;
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && "mknotes".equals(data.getScheme())) {
            String server = data.getQueryParameter("server"), key = data.getQueryParameter("key");
            if (server != null && key != null) page += "#server=" + Uri.encode(server) + "&key=" + Uri.encode(key);
        }
        return page;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getData() != null) web.loadUrl(pageFor(intent));
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == PICK_FILE && pending != null) {
            pending.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pending = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
