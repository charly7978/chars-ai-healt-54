package com.example.charsaihealth;

import android.app.Application;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;

import java.util.ArrayList;

public class MainApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        
        // Habilitar depuración WebView en modo desarrollo
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }
}
