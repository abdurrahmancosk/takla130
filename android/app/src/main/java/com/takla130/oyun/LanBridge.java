package com.takla130.oyun;

import android.app.Activity;
import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Aynı Wi-Fi (ya da telefon hotspot'u) üzerindeki oyuncular için UDP yayın köprüsü.
 * Sunucu yok: her cihaz durumunu ağın yayın adresine gönderir, herkes herkesi duyar.
 * JavaScript tarafı: TaklaLan.start(port), send(json), poll() -> [{d, a}], info(), vibrate(ms), exitApp().
 */
public class LanBridge {
    private static final int MAX_QUEUE = 3000;

    private final Activity act;
    private final ConcurrentLinkedQueue<String> inbox = new ConcurrentLinkedQueue<>();
    private final AtomicInteger inboxSize = new AtomicInteger();
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private volatile DatagramSocket socket;
    private volatile boolean running;
    private volatile List<InetAddress> targets = new ArrayList<>();
    private volatile long targetsAt;
    private int port;
    private WifiManager.MulticastLock lock;

    LanBridge(Activity act) {
        this.act = act;
    }

    @JavascriptInterface
    public synchronized boolean start(int port) {
        if (running) return true;
        try {
            this.port = port;
            DatagramSocket s = new DatagramSocket(null);
            s.setReuseAddress(true);
            s.setBroadcast(true);
            s.bind(new InetSocketAddress(port));
            socket = s;
            running = true;
            acquireLock();
            Thread rx = new Thread(this::receiveLoop, "takla-lan-rx");
            rx.setDaemon(true);
            rx.start();
            return true;
        } catch (Exception e) {
            running = false;
            return false;
        }
    }

    private void receiveLoop() {
        byte[] buf = new byte[65507];
        while (running) {
            try {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                socket.receive(p);
                if (inboxSize.get() >= MAX_QUEUE) continue;           // JS yetişemiyorsa eskileri değil yenileri at
                String data = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                String from = p.getAddress() != null ? p.getAddress().getHostAddress() : "";
                inbox.add("{\"d\":" + JSONObject.quote(data) + ",\"a\":" + JSONObject.quote(from) + "}");
                inboxSize.incrementAndGet();
            } catch (Exception e) {
                if (!running) break;
                try { Thread.sleep(50); } catch (InterruptedException ie) { break; }
            }
        }
    }

    /** Gelen paketleri JSON dizisi olarak verir (her karede bir kez çağrılır). */
    @JavascriptInterface
    public String poll() {
        StringBuilder sb = new StringBuilder("[");
        String s;
        int n = 0;
        while (n < 600 && (s = inbox.poll()) != null) {
            inboxSize.decrementAndGet();
            if (n > 0) sb.append(',');
            sb.append(s);
            n++;
        }
        return sb.append(']').toString();
    }

    @JavascriptInterface
    public void send(String msg) {
        if (!running || msg == null) return;
        final byte[] data = msg.getBytes(StandardCharsets.UTF_8);
        if (data.length > 60000) return;
        sender.execute(() -> {
            DatagramSocket s = socket;
            if (s == null) return;
            for (InetAddress a : targets()) {
                try {
                    s.send(new DatagramPacket(data, data.length, a, port));
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** Wi-Fi / hotspot arayüzlerinin yayın adresleri (3 s önbellek). Hücresel veri arayüzleri dışarıda. */
    private List<InetAddress> targets() {
        long now = System.currentTimeMillis();
        if (now - targetsAt < 3000 && !targets.isEmpty()) return targets;
        List<InetAddress> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String name = ni.getName() == null ? "" : ni.getName();
                if (name.startsWith("rmnet") || name.startsWith("ccmni") || name.startsWith("pdp") || name.startsWith("dummy") || name.startsWith("tun")) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress b = ia.getBroadcast();
                    if (b instanceof Inet4Address && !out.contains(b)) out.add(b);
                }
            }
        } catch (Exception ignored) {
        }
        if (out.isEmpty()) {
            try {
                out.add(InetAddress.getByName("255.255.255.255"));
            } catch (Exception ignored) {
            }
        }
        targets = out;
        targetsAt = now;
        return out;
    }

    /** Cihazın yerel ağ adresi (menüde gösterilir). */
    @JavascriptInterface
    public String info() {
        String ip = "";
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String name = ni.getName() == null ? "" : ni.getName();
                if (name.startsWith("rmnet") || name.startsWith("ccmni") || name.startsWith("pdp") || name.startsWith("dummy") || name.startsWith("tun")) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress a = ia.getAddress();
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) { ip = a.getHostAddress(); break; }
                }
                if (!ip.isEmpty()) break;
            }
        } catch (Exception ignored) {
        }
        try {
            JSONObject o = new JSONObject();
            o.put("ip", ip);
            o.put("ok", running);
            return o.toString();
        } catch (Exception e) {
            return "{\"ip\":\"\",\"ok\":false}";
        }
    }

    @JavascriptInterface
    public void vibrate(int ms) {
        try {
            Vibrator v = (Vibrator) act.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            int d = Math.max(5, Math.min(400, ms));
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(d);
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void exitApp() {
        act.runOnUiThread(act::finishAndRemoveTask);
    }

    private void acquireLock() {
        try {
            if (lock == null) {
                WifiManager wm = (WifiManager) act.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm == null) return;
                lock = wm.createMulticastLock("takla130-lan");
                lock.setReferenceCounted(false);
            }
            if (!lock.isHeld()) lock.acquire();       // bazı telefonlar kilit olmadan yayın paketlerini almaz
        } catch (Exception ignored) {
        }
    }

    private void releaseLock() {
        try {
            if (lock != null && lock.isHeld()) lock.release();
        } catch (Exception ignored) {
        }
    }

    void onPause() {
        releaseLock();
    }

    void onResume() {
        if (running) acquireLock();
    }

    void stop() {
        running = false;
        releaseLock();
        DatagramSocket s = socket;
        socket = null;
        if (s != null) s.close();
        sender.shutdownNow();
    }
}
