# PdfBox-Android: optional JPEG2000 decoder is not bundled; keep PdfBox classes used via reflection (fonts, filters).
-dontwarn com.gemalto.jp2.**
-keep class com.tom_roush.pdfbox.** { *; }
-keep class com.tom_roush.fontbox.** { *; }
-dontwarn com.tom_roush.**
