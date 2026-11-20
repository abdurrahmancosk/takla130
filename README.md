# TAKLA-130 Oyun

TAKLA-130 akrobatik RC aracının Android oyunu. Araç, gerçek aracın fizik modeliyle sürülür: 203,6 g kütle, DC130 motorlar, 18650 pil, dişli oranları ve havasız TPU lastikler. Oyunda mini bir model şehir var. Caddelerde sürebilir, rampalardan atlayıp takla atabilir, botlara karşı yarışabilirsin. Aynı Wi-Fi'daki arkadaşlarınla birlikte de oynayabilirsin.

Şu cihazlar için ayarlandı:
- Xiaomi Redmi Note 9 Pro
- Xiaomi Redmi 14C
- Huawei MatePad 11.5S

Grafik kalitesi cihaza göre kendiliğinden seçilir. Kare hızı düşerse çözünürlük otomatik olarak azalır.

## APK nasıl oluşur?

Bu depo GitHub'a her gönderildiğinde **GitHub Actions** APK'yı kendisi derler. Derleme 5–8 dakika sürer ve APK iki yere konur:

- **Releases** (Sürümler) sayfası: `TAKLA-130-oyun-v1.0.N.apk`. Telefondan doğrudan indirmek için en kolay yol budur.
- **Actions** sekmesi: ilgili derlemenin altındaki `TAKLA-130-oyun-apk` dosyası.

Her derleme aynı anahtarla imzalanır ve sürüm numarası bir artar. Yeni APK eskisinin üstüne kurulur; kayıtların (ad, ayarlar, rekorlar) silinmez.

## Kurulum

**Xiaomi (MIUI / HyperOS)**
1. APK'yı indir ve dosyaya dokun.
2. "Bilinmeyen kaynaklar" için tarayıcıya ya da Dosyalar uygulamasına izin ver.
3. Güvenlik taraması uyarısı çıkarsa "Yine de yükle" de.

**Huawei MatePad 11.5S (HarmonyOS 4.x)**
1. Ayarlar → Sistem ve güncellemeler → **Saf mod** (Pure mode) seçeneğini kapat. Bu mod açıkken AppGallery dışından uygulama kurulamaz.
2. APK'ya dokunup kur.

> HarmonyOS **NEXT / 5** Android uygulamalarını (APK) çalıştırmaz. Tablet HarmonyOS 4.x'te kaldığı sürece sorun yok.

## Kontroller

| | |
|---|---|
| Sol yarı | ileri / geri (gerçek kumandanın sol çubuğu) |
| Sağ yarı | sağa / sola (sağ çubuk) |
| TAKLA | ileri giderken kısa bir geri darbesi verir; araç takla atar |
| ↻ | aracı düzeltir (yarışta son kontrol noktasına koyar) |
| ◉ | kamera: takip / uzak / üstten / sürücü |
| Geri tuşu | duraklatır; ana menüde iki kez basınca çıkar |

Araç çift taraflıdır: ters dönünce de aynı kontrollerle sürülür. Ayarlar'dan tek çubuk düzeni seçilebilir. Bluetooth oyun kolu da çalışır:
- sol çubuk: gaz,
- sağ çubuk: direksiyon,
- A: takla,
- B: düzelt.

## Wi-Fi çok oyunculu

1. Bütün cihazları **aynı Wi-Fi ağına** bağla. İnternet gerekmez.
2. Bir oyuncu "Wi-Fi çok oyunculu → Odayı kur" der: pist, tur sayısı, bot sayısı ve zorluğu seçer.
3. Diğer oyuncular "Açık odalar" listesinde odayı görüp **Katıl** der.
4. Ev sahibi **Yarışı başlat**'a basar. Herkes aynı anda geri sayımla başlar.

"Birlikte serbest sür" seçildiğinde serbest sürüşteki herkes şehirde birbirini görür.

**Cihazlar birbirini görmüyorsa:**
- Misafir ağları ve bazı modemler cihazların birbiriyle konuşmasını engeller (istemci yalıtımı / AP isolation).
- Bu durumda bir telefonun **mobil erişim noktasını (hotspot)** aç ve diğer cihazları ona bağla.

**Teknik ayrıntı:**
- Oyun UDP 47130 portunda yayın yapar.
- Oda kuran cihaz yarışı yönetir ve botları sürer.
- Her oyuncu kendi aracını kendi cihazında hesaplar ve durumunu saniyede 20 kez gönderir.

## Proje yapısı

```
android/                      Android uygulaması (WebView kabuğu + Wi-Fi köprüsü)
  app/src/main/java/...       MainActivity.java, LanBridge.java (UDP yayını)
  app/src/main/assets/game/   oyunun kendisi (HTML + JavaScript, three.js)
    js/physics.js             TAKLA-130 fizik modeli (simülasyonla aynı)
    js/world.js               mini şehir, pistler, rampalar, çarpışma ızgarası
    js/game.js                sürüş, botlar, tur ve sıralama
    js/net.js                 aynı ağdaki oyuncular, oda, yarış senkronu
    js/render.js              görüntü (three.js)
    js/main.js                menüler, kamera, gösterge
tools/three-indir.sh          three.js'i derleme sırasında indirir
.github/workflows/apk.yml     APK derleme ve yayınlama
```

**Bilgisayarda deneme:**
1. `bash tools/three-indir.sh` çalıştır.
2. `android/app/src/main/assets/game` klasörünü bir yerel sunucuyla aç, örneğin `python -m http.server`.
3. Aynı tarayıcıda iki sekme açarsan çok oyunculu mod sekmeler arasında çalışır.
