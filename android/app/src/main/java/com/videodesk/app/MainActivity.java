package com.videodesk.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import androidx.webkit.WebViewAssetLoader;

import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.mapper.VideoFormat;
import com.yausername.youtubedl_android.mapper.VideoInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.net.URI;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import kotlin.Unit;

public class MainActivity extends Activity {
    private final ExecutorService workers = Executors.newFixedThreadPool(3);
    private final Map<String, Inspection> inspections = new ConcurrentHashMap<>();
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private WebView web;
    private volatile String startupError;

    private static class Inspection {
        String url;
        Set<String> videoFormats = new HashSet<>();
        Set<String> audioFormats = new HashSet<>();
    }

    private static class Job {
        volatile String status = "queued";
        volatile float progress = 0;
        volatile String error;
        volatile String filename;
        volatile long size;
        volatile Uri uri;
        volatile String mime;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView loading = new TextView(this);
        loading.setText("Starting VideoDesk…");
        loading.setTextSize(20);
        loading.setPadding(36, 64, 36, 36);
        setContentView(loading);
        workers.execute(() -> {
            try {
                YoutubeDL.getInstance().init(this);
                FFmpeg.getInstance().init(this);
            } catch (Exception e) { startupError = clean(e); }
            runOnUiThread(this::showApp);
        });
    }

    private void showApp() {
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "VideoDeskAndroid");
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && !"appassets.androidplatform.net".equals(request.getUrl().getHost())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                    return true;
                }
                return false;
            }
        });
        setContentView(web);
        web.loadUrl("https://appassets.androidplatform.net/index.html");
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private class Bridge {
        @JavascriptInterface public void request(String id, String path, String body) {
            workers.execute(() -> {
                int status = 200;
                JSONObject response;
                try {
                    JSONObject payload = new JSONObject(body);
                    if ("/api/health".equals(path)) {
                        response = new JSONObject().put("ok", startupError == null).put("yt_dlp", startupError == null).put("ffmpeg", startupError == null);
                        if (startupError != null) response.put("error", startupError);
                    } else if (startupError != null) {
                        throw new IllegalStateException("Downloader could not start: " + startupError);
                    } else if ("/api/inspect".equals(path)) {
                        response = inspect(payload.optString("url"));
                    } else if ("/api/download".equals(path)) {
                        response = startDownload(payload);
                        status = 202;
                    } else if (path.startsWith("/api/jobs/")) {
                        response = jobInfo(path.substring("/api/jobs/".length()));
                    } else {
                        status = 404;
                        response = new JSONObject().put("error", "Not found.");
                    }
                } catch (Exception e) {
                    status = 400;
                    response = new JSONObject();
                    try { response.put("error", clean(e)); } catch (Exception ignored) { }
                }
                int finalStatus = status;
                String script = "window.videoDeskAndroidResponse(" + JSONObject.quote(id) + "," + finalStatus + "," + JSONObject.quote(response.toString()) + ")";
                runOnUiThread(() -> { if (web != null) web.evaluateJavascript(script, null); });
            });
        }

        @JavascriptInterface public void openFile(String id) {
            Job job = jobs.get(id);
            if (job == null || job.uri == null) return;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(job.uri, job.mime);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivity(intent); } catch (Exception ignored) { }
            });
        }
    }

    private JSONObject inspect(String url) throws Exception {
        URI uri = new URI(url);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null)
            throw new IllegalArgumentException("Enter a valid public video URL.");
        VideoInfo info = YoutubeDL.getInstance().getInfo(url);
        ArrayList<VideoFormat> formats = info.getFormats();
        if (formats == null) formats = new ArrayList<>();
        VideoFormat bestAudio = null;
        for (VideoFormat f : formats) {
            if ("none".equals(f.getVcodec()) && hasAudio(f) && (bestAudio == null || number(f.getAbr()) > number(bestAudio.getAbr()))) bestAudio = f;
        }
        Map<Integer, VideoFormat> byHeight = new HashMap<>();
        for (VideoFormat f : formats) {
            if (!hasVideo(f) || f.getHeight() < 1 || (!hasAudio(f) && bestAudio == null)) continue;
            VideoFormat old = byHeight.get(f.getHeight());
            if (old == null || number(f.getTbr()) > number(old.getTbr())) byHeight.put(f.getHeight(), f);
        }
        Inspection inspection = new Inspection();
        inspection.url = url;
        JSONArray options = new JSONArray();
        JSONArray audioOptions = new JSONArray();
        ArrayList<Integer> heights = new ArrayList<>(byHeight.keySet());
        heights.sort(Comparator.reverseOrder());
        for (int height : heights) {
            VideoFormat f = byHeight.get(height);
            String formatId = f.getFormatId() + (hasAudio(f) ? "" : "+" + bestAudio.getFormatId());
            addOption(options, inspection, formatId, height + "p", f);
            if (options.length() >= 30) break;
        }
        if (options.length() == 0) for (VideoFormat f : formats) {
            if (hasVideo(f) && hasAudio(f)) { addOption(options, inspection, f.getFormatId(), "Original", f); break; }
        }
        boolean audioAvailable = false;
        for (VideoFormat f : formats) if (hasAudio(f)) { audioAvailable = true; break; }
        if (audioAvailable) {
            addAudioOption(audioOptions, inspection, "audio-original", "Original audio", "SOURCE");
            addAudioOption(audioOptions, inspection, "audio-mp3-high", "MP3 · 192 kbps", "MP3");
            addAudioOption(audioOptions, inspection, "audio-mp3-small", "MP3 · 96 kbps", "MP3");
        }
        if (options.length() == 0 && audioOptions.length() == 0) throw new IllegalArgumentException("No downloadable video or audio format was found.");
        String token = UUID.randomUUID().toString().replace("-", "");
        inspections.put(token, inspection);
        JSONObject preview = new JSONObject().put("kind", "unavailable");
        String key = info.getExtractorKey();
        String id = info.getId();
        if (key != null && key.toLowerCase().contains("youtube") && id != null && id.matches("[A-Za-z0-9_-]{11}")) {
            preview = new JSONObject().put("kind", "embed").put("url", "https://www.youtube-nocookie.com/embed/" + id);
        } else {
            for (VideoFormat f : formats) if (hasVideo(f) && hasAudio(f) && f.getUrl() != null && f.getUrl().startsWith("https://")) {
                preview = new JSONObject().put("kind", "video").put("url", f.getUrl());
                break;
            }
        }
        String webpage = info.getWebpageUrl();
        return new JSONObject().put("token", token).put("title", info.getTitle() == null ? "Untitled video" : info.getTitle())
                .put("source", key == null ? uri.getHost() : key).put("duration", info.getDuration())
                .put("thumbnail", info.getThumbnail()).put("webpage_url", webpage == null ? url : webpage)
                .put("preview", preview).put("options", options).put("audio_options", audioOptions).put("ffmpeg", true);
    }

    private static void addOption(JSONArray options, Inspection inspection, String id, String label, VideoFormat f) throws Exception {
        inspection.videoFormats.add(id);
        long size = f.getFileSize() > 0 ? f.getFileSize() : f.getFileSizeApproximate();
        options.put(new JSONObject().put("id", id).put("label", label).put("ext", f.getExt() == null ? "VIDEO" : f.getExt().toUpperCase())
                .put("size", size));
    }

    private static void addAudioOption(JSONArray options, Inspection inspection, String id, String label, String ext) throws Exception {
        inspection.audioFormats.add(id);
        options.put(new JSONObject().put("id", id).put("label", label).put("ext", ext).put("size", JSONObject.NULL));
    }

    private JSONObject startDownload(JSONObject payload) throws Exception {
        Inspection inspection = inspections.get(payload.optString("token"));
        String format = payload.optString("format_id");
        String kind = payload.optString("kind", "video");
        if (inspection == null || !("video".equals(kind) ? inspection.videoFormats.contains(format) : "audio".equals(kind) && inspection.audioFormats.contains(format)))
            throw new IllegalArgumentException("Inspect the link and select an available quality first.");
        String id = UUID.randomUUID().toString().replace("-", "");
        Job job = new Job();
        jobs.put(id, job);
        workers.execute(() -> download(id, inspection.url, format, kind, job));
        return new JSONObject().put("job_id", id);
    }

    private void download(String id, String url, String format, String kind, Job job) {
        File dir = new File(getCacheDir(), "download-" + id);
        dir.mkdirs();
        job.status = "downloading";
        try {
            YoutubeDLRequest request = new YoutubeDLRequest(url);
            request.addOption("--no-playlist");
            if ("audio".equals(kind)) {
                request.addOption("--format", "bestaudio/best");
                request.addOption("--extract-audio");
                request.addOption("--audio-format", "audio-original".equals(format) ? "best" : "mp3");
                if ("audio-mp3-high".equals(format)) request.addOption("--audio-quality", "192K");
                if ("audio-mp3-small".equals(format)) request.addOption("--audio-quality", "96K");
            } else {
                request.addOption("--format", format);
                request.addOption("--merge-output-format", "mp4/mkv");
            }
            request.addOption("--output", new File(dir, "%(title).180B [%(id)s].%(ext)s").getAbsolutePath());
            YoutubeDL.getInstance().execute(request, id, (progress, eta, line) -> { job.progress = Math.min(99f, progress); return Unit.INSTANCE; });
            File[] files = dir.listFiles(file -> file.isFile() && !file.getName().endsWith(".part") && !file.getName().endsWith(".ytdl"));
            if (files == null || files.length == 0) throw new IllegalStateException("Download finished without a media file.");
            File chosen = files[0];
            for (File file : files) if (file.length() > chosen.length()) chosen = file;
            String ext = chosen.getName().toLowerCase();
            if ("audio".equals(kind)) {
                job.mime = ext.endsWith(".mp3") ? "audio/mpeg" : ext.endsWith(".m4a") ? "audio/mp4" : ext.endsWith(".webm") ? "audio/webm" : ext.endsWith(".opus") || ext.endsWith(".ogg") ? "audio/ogg" : ext.endsWith(".flac") ? "audio/flac" : ext.endsWith(".aac") ? "audio/aac" : "application/octet-stream";
            } else {
                job.mime = ext.endsWith(".mp4") ? "video/mp4" : ext.endsWith(".webm") ? "video/webm" : ext.endsWith(".mkv") ? "video/x-matroska" : "application/octet-stream";
            }
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, chosen.getName());
            values.put(MediaStore.MediaColumns.MIME_TYPE, job.mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/VideoDesk");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri destination = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (destination == null) throw new IllegalStateException("Could not save in Downloads.");
            try (FileInputStream input = new FileInputStream(chosen); OutputStream output = getContentResolver().openOutputStream(destination)) {
                if (output == null) throw new IllegalStateException("Could not write the video file.");
                byte[] buffer = new byte[1024 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            } catch (Exception e) { getContentResolver().delete(destination, null, null); throw e; }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(destination, values, null, null);
            job.uri = destination;
            job.filename = chosen.getName();
            job.size = chosen.length();
            job.progress = 100;
            job.status = "ready";
            chosen.delete();
            dir.delete();
        } catch (Exception e) { job.error = clean(e); job.status = "error"; }
    }

    private JSONObject jobInfo(String id) throws Exception {
        Job job = jobs.get(id);
        if (job == null) throw new IllegalArgumentException("Download not found.");
        return new JSONObject().put("status", job.status).put("progress", job.progress).put("error", job.error)
                .put("filename", job.filename).put("size", job.size);
    }

    private static boolean hasVideo(VideoFormat f) {
        if ("none".equals(f.getVcodec())) return false;
        if (f.getVcodec() != null) return true;
        return f.getExt() != null && ("mp4".equals(f.getExt()) || "webm".equals(f.getExt()) || "mkv".equals(f.getExt()) || "mov".equals(f.getExt()) || "m4v".equals(f.getExt()));
    }
    private static boolean hasAudio(VideoFormat f) {
        if ("none".equals(f.getAcodec())) return false;
        if (f.getAcodec() != null) return true;
        return f.getExt() != null && (hasVideo(f) || "mp3".equals(f.getExt()) || "m4a".equals(f.getExt()) || "aac".equals(f.getExt()) || "ogg".equals(f.getExt()) || "opus".equals(f.getExt()) || "flac".equals(f.getExt()) || "wav".equals(f.getExt()));
    }
    private static double number(Number n) { return n == null ? 0 : n.doubleValue(); }
    private static String clean(Exception e) { return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(); }
}
