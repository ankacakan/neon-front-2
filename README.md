# NEON FRONT 2.0

Tarayıcıda çalışan, **Three.js** tabanlı izometrik gerçek-zamanlı strateji (RTS) oyunu.
Gerçekçi "minyatür diorama" görünümü, modüler mimari ve görev/kampanya sistemi içerir.

---

## Çalıştırma (ÖNEMLİ: artık local server gerekli)

> Bu sürüm CC0 **PBR doku** ve **`.glb` 3D model** dosyaları kullanır.
> Bu dosyalar `file://` ile açıldığında tarayıcı CORS/güvenlik kuralları yüzünden
> **yüklenmez**. Bu yüzden `index.html`'e çift tıklamak artık çalışmaz.

Tek komut yeterli:

```bat
serve.cmd
```

veya PowerShell:

```powershell
.\serve.ps1
```

Ardından tarayıcıda şu adresi aç:

```
http://localhost:8123
```

Farklı port kullanmak için:

```bat
serve.cmd 9000
```

Sunucu `tools/serve.mjs` içindedir — bağımlılık gerektirmez (yalnızca Node 18+).
Durdurmak için terminalde `Ctrl+C`.

### Neden?

| Durum | `file://` | `http://localhost` |
|---|---|---|
| `.js` ES modülleri (importmap) | ❌ engelli | ✅ |
| `.glb` / `.gltf` modeller | ❌ CORS hatası | ✅ |
| `TextureLoader` ile `.jpg` PBR | ❌ | ✅ |
| `three/addons/` (post-processing) | ❌ | ✅ |

---

## Klasör yapısı

```
index.html            importmap (three + three/addons) + HUD iskeleti
style.css             askeri/cyber HUD, kaynak çubuğu, inşa paneli, menüler
serve.cmd / serve.ps1 tek komut sunucu
src/
  main.js             önyükleme ve oyun döngüsü
  config.js           tüm ayarlanabilir sabitler
  core/               engine, postfx, assets, input
  world/              mapgen, terrain, scenery, water
  units/              unit (tank/HQ/topçu/piyade/helikopter), models
  systems/            pathfinding, combat, ai, economy, missions, progression
  fx/                 particles, billboards, explosions, decals
  ui/                 hud, minimap, menus
  campaign/           missions (veri), campaign (durum), save (localStorage)
assets/
  textures/           CC0 PBR (ambientCG) — color/normal/roughness/ao/displacement
  models/             CC0 .glb (Kenney) — nature/tower-defense/city/car kit
  CREDITS.md          lisans kaydı
tools/
  fetch-assets.mjs    CC0 varlık indirici (bağımlılıksız)
  serve.mjs           statik dev sunucusu
```

---

## Varlıkları yeniden indirme

```bat
node tools/fetch-assets.mjs            :: doku + model
node tools/fetch-assets.mjs --textures :: yalnızca doku
node tools/fetch-assets.mjs --models   :: yalnızca .glb model
node tools/fetch-assets.mjs --force    :: var olanları yeniden indir
```

Tüm harici varlıklar **CC0 1.0 (Kamu Malı)** lisanslıdır. Detaylar: `assets/CREDITS.md`.

---

## Kontroller

| Girdi | İşlev |
|---|---|
| Sol tık | Birim / bina seç |
| Sol tık + sürükle | Dikdörtgen ile çoklu seçim |
| Sağ tık | Seçili birimleri hareket ettir / hedef göster |
| `W A S D` / ok tuşları | Kamerayı kaydır |
| Fare tekerleği | Zoom |
| `Q` / `E` | Kamerayı döndür |
| `1`-`4` | İnşa panelinden birim üret (tank / topçu / piyade / helikopter) |
| `R` | Takviye — 3 tank indir (bekleme süreli) |
| `B` | Hava saldırısı — fare konumuna bombardıman (bekleme süreli) |
| `Space` | Kamera odağını seçime al |
| `Ctrl` + `A` | Tüm savaş birimlerini seç |
| `Esc` | Duraklat / devam et (ayarlar ve görev menüsüne erişim) |

Minimap'e tıklayarak kamerayı doğrudan o noktaya taşıyabilirsiniz.

---

## Oynanış

- **Kaynak ekonomisi:** Üç kaynak vardır — `TEDARİK`, `YAKIT`, `MÜHİMMAT`.
  Karargah ayakta olduğu sürece ve ele geçirilen her kontrol noktası için saniyelik
  gelir üretilir. İnşa panelindeki her birim bu üç kaynaktan bir maliyet öder.
- **Kontrol noktaları:** Haritada 3 adet ele geçirilebilir nokta bulunur. Kendi
  birimleriniz yeterince uzun süre nokta içinde kalırsa sahiplik kazanılır; düşman
  da aynı şeyi yapabilir. Sahiplik gelir hızını doğrudan etkiler.
- **Üretim kuyruğu:** `1`-`4` tuşları veya inşa kartları ile birim kuyruğa girer.
  Üretim çubuğu dolduğunda birim karargahın yakınında cepheye iner
  (piyade bir takım halinde).
- **Kampanya:** 5 görevden oluşur (nehir hattı, karşı yaka, hava üstünlüğü,
  çöl taarruzu, cephe hattı). Görevler hedef bileşenleriyle tanımlanır:
  `destroy`, `capture`, `hold`, `kills`, `reach`, `survive`. Zafer/ yenilgi
  durumunda sonuç ekranı açılır; ilerleme, kilitler ve en iyi dereceler
  `localStorage` (`neonfront2_save_v1`) altında saklanır.
- **İlerleme:** XP ve askeri rütbe (`ER` → `GENERAL`) tamamlanan görev, imha ve
  kayıplara göre hesaplanır; görev seçim ekranında gösterilir.

---

## Teşhis köprüsü

Konsolda hata ayıklama için:

```js
__NEON_DIAG            // { shaderErrors, programs, calls, tris, fps, frameMs }
__NEON_DIAG.stats()    // anlık render istatistikleri
__NEON_DIAG.assets     // yüklenen PBR doku / .glb model sayıları
__NEON_DIAG.campaign() // { mission, status } — aktif görev ve durumu
__NEON_DIAG.forceSuccess()  // aktif görevi anında başarıya çevir (test)
window.__BOOT_ERR      // önyükleme hatası varsa metin, yoksa null
```

Shader derleme hataları `__NEON_DIAG.shaderErrors` içinde birikir; hedef bu listenin
**boş** kalmasıdır. Oyun döngüsü içinde yakalanan ilk beklenmedik hata
`__NEON_DIAG._frameError` alanına yazılır (sağlıklı durumda `null`).

---

## Performans hedefi

- Amaç: **60+ FPS**, yoğun savaşta dahi.
- Instancing (`InstancedMesh`), parçacık havuzları ve çalışma-anında sıfır tahsis ile.
- SSAO ve tilt-shift DOF yarım çözünürlükte çalışır ve ayarlardan kapatılabilir.
