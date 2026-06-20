# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Durak Imperia production release rules.
# R8 is enabled for store builds, but these runtime bridges are reached by
# reflection, Cordova plugin metadata, or Android WebView JavaScript bindings.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,JavascriptInterface
-keep class com.durakimperia.game.** { *; }

# Capacitor / Cordova bridge and plugin entrypoints.
-keep class com.getcapacitor.** { *; }
-keep class org.apache.cordova.** { *; }
-keep class capacitor.cordova.android.plugins.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.codetrixstudio.capacitor.** { *; }
-keep class com.getcapacitor.community.admob.** { *; }
-keep class com.admobcommunity.** { *; }
-keep class cc.fovea.** { *; }
-keep class com.android.billingclient.** { *; }

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Google/Firebase/Ads SDKs use generated metadata and reflective adapters.
-keep class com.google.android.gms.ads.** { *; }
-keep class com.google.android.gms.measurement.** { *; }
-keep class com.google.firebase.** { *; }
-keep class com.google.android.datatransport.** { *; }
-keep class com.google.gson.** { *; }

# Realtime stack and network clients used by native plugins.
-keep class io.socket.** { *; }
-keep class io.reactivex.** { *; }
-dontwarn io.socket.**
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.apache.cordova.**
-dontwarn com.getcapacitor.**
-dontwarn com.google.firebase.ktx.Firebase
