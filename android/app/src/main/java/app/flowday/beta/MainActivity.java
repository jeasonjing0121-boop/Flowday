package app.flowday.beta;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Phase 5.0-B（B2）：Android 系统窗口适配层 —— 只做系统区域协调，不实现业务 UI。
 *
 * Insets 交付模型（B2 重写）：
 *   1) 系统 Insets 变化 → 缓存到字段（缓存永远可信）；
 *   2) JS 启动 / 页面重载 / 回到前台 → JS 调 FlowDayNative.requestInsets() 主动拉取；
 *   3) 原生收到拉取请求 → 无条件重发缓存值（force），不依赖"上次已发送"；
 *   4) 系统 Insets 变化时，若 JS 已经拉取过（jsRequested=true），则按值去重后推送；
 *   5) onResume / onConfigurationChanged → 重新 requestApplyInsets，保证旋转、字体缩放、
 *      分屏、手势/三键切换后缓存与推送都是最新值。
 *
 * 这样修复 B1 审计确认的两类根因：
 *   - 首帧推送早于 JS 钩子定义（钩子未定义 → evaluateJavascript 静默丢弃）；
 *   - 页面重载后 JS 变量清空而原生去重锁阻止重发。
 */
public class MainActivity extends BridgeActivity {

    /** 最近一次从系统读到的 Insets（px，物理像素）。-1 表示尚未读取。 */
    private int insetsTop = -1;
    private int insetsBottom = -1;
    private int insetsLeft = -1;
    private int insetsRight = -1;
    private int insetsIme = -1;

    /** 最近一次成功下发给 JS 的值，仅用于"系统变化"路径的去重。 */
    private int sentTop = -2;
    private int sentBottom = -2;
    private int sentLeft = -2;
    private int sentRight = -2;
    private int sentIme = -2;

    private boolean hasInsets = false;
    /** JS 是否已经调用过 requestInsets（= 钩子已就绪）。 */
    private boolean jsRequested = false;

    private View rootView;

    /** 供 Web 层调用的原生桥（最小能力面）。 */
    private class FlowDayBridge {
        @JavascriptInterface
        public void requestInsets() {
            jsRequested = true;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pushInsets(true);
                }
            });
        }

        @JavascriptInterface
        public void setDark(final boolean dark) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyBarAppearance(dark);
                }
            });
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        // 内容延伸到系统栏之下（Android 15+ 默认强制，这里显式声明兼容旧版本）
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
            window.setNavigationBarDividerColor(Color.TRANSPARENT);
        }

        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            // 禁止整页缩放手势（不改动 textZoom，系统字体/显示大小仍然生效）
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(false);
            webView.addJavascriptInterface(new FlowDayBridge(), "FlowDayNative");
        }

        // 默认按浅色图标启动；Web 层拿到主题后会立即纠正
        applyBarAppearance(false);

        rootView = findViewById(android.R.id.content);
        if (rootView != null) {
            ViewCompat.setOnApplyWindowInsetsListener(rootView, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
                storeInsets(bars.top, bars.bottom, bars.left, bars.right, ime.bottom);
                if (jsRequested) {
                    pushInsets(false);
                }
                return windowInsets;
            });
            ViewCompat.requestApplyInsets(rootView);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // 前台恢复（含从多任务返回）时刷新 Insets：某些厂商在恢复后会改变系统栏内边距
        requestInsetsUpdate();
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // 旋转 / 字体缩放 / 分屏 / 手势-三键切换：重新读取并（若已握手）推送
        requestInsetsUpdate();
    }

    private void requestInsetsUpdate() {
        if (rootView == null) return;
        ViewCompat.requestApplyInsets(rootView);
    }

    private void storeInsets(int top, int bottom, int left, int right, int imeBottom) {
        insetsTop = Math.max(0, top);
        insetsBottom = Math.max(0, bottom);
        insetsLeft = Math.max(0, left);
        insetsRight = Math.max(0, right);
        insetsIme = Math.max(0, imeBottom);
        hasInsets = true;
    }

    /**
     * 下发 Insets 给 Web 层。
     *
     * @param force true = JS 主动拉取（页面启动/重载/回前台），无条件重发；
     *              false = 系统 Insets 变化触发，仅当值与上次下发不同才重发。
     */
    private void pushInsets(boolean force) {
        if (!hasInsets) return;
        if (!force && isSameAsSent()) return;

        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;

        final float density = getResources().getDisplayMetrics().density;
        final int topDp = Math.round(insetsTop / density);
        final int bottomDp = Math.round(insetsBottom / density);
        final int leftDp = Math.round(insetsLeft / density);
        final int rightDp = Math.round(insetsRight / density);
        final int imeDp = Math.round(insetsIme / density);

        sentTop = insetsTop;
        sentBottom = insetsBottom;
        sentLeft = insetsLeft;
        sentRight = insetsRight;
        sentIme = insetsIme;

        final String js = "window.__lgApplyInsets&&window.__lgApplyInsets({top:" + topDp
                + ",bottom:" + bottomDp
                + ",left:" + leftDp
                + ",right:" + rightDp
                + ",imeBottom:" + imeDp
                + "})";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(js, null);
            }
        });
    }

    private boolean isSameAsSent() {
        return insetsTop == sentTop
                && insetsBottom == sentBottom
                && insetsLeft == sentLeft
                && insetsRight == sentRight
                && insetsIme == sentIme;
    }

    private void applyBarAppearance(boolean dark) {
        Window window = getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller == null) return;
        // 深色主题 → 浅色（白色）系统栏图标；浅色主题 → 深色图标
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }
}
