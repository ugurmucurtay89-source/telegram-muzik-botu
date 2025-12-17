# 🎶 Telegram Müzik Botu @Cumhurbbaskani

**@Cumhurbbaskani** tarafından geliştirilen bu proje, **Node.js** ile yapılmış, Telegram gruplarında müzik çalabilen, şarkı yönetimi yapabilen ve gelişmiş özelliklere sahip güçlü bir müzik botudur. Ayrıca, botun kullanım istatistiklerini gösteren basit bir web tabanlı **admin paneli** de içerir.

---

## ✨ Özellikler @Cumhurbbaskani

### Müzik Kontrolleri @Cumhurbbaskani

* `/play [şarkı adı/URL]`: **YouTube**, **Spotify** ve **SoundCloud** URL'lerini destekler. Şarkı adı verildiğinde YouTube'da arama yapar ve çalar veya sıraya ekler.
* `/queue`: Mevcut şarkı kuyruğunu gösterir.
* `/skip`: Mevcut şarkıyı atlar.
* `/remove [sıra no]`: Kuyruktan belirtilen sıradaki şarkıyı siler.
* `/clear`: Tüm şarkı kuyruğunu temizler.
* `/pause`: Çalan şarkıyı duraklatır.
* `/resume`: Duraklatılmış şarkıyı devam ettirir.
* `/nowplaying`: Şu an çalan şarkıyı ilerleme çubuğu ve kapak fotoğrafı ile gösterir.
* `/volume [0-100]`: Ses seviyesini ayarlar.
* `/shuffle`: Kuyruğu karıştırır.
* `/loop [on/off/queue]`: Şarkıyı (`on`) veya kuyruğu (`queue`) döngüye alır, kapatır (`off`).

### Gelişmiş Özellikler @Cumhurbbaskani

* **Otomatik Öneri Modu**: Kuyruk boşaldığında, kullanıcının dinleme geçmişinden rastgele bir şarkı önerir ve çalar.
* **Kişisel Çalma Listeleri**:
    * `/playlist save [isim]`: Mevcut kuyruğu bir çalma listesi olarak kaydeder.
    * `/playlist play [isim]`: Kaydedilmiş bir çalma listesini çalar.
    * `/playlist list`: Kayıtlı çalma listelerini listeler.
    * `/playlist delete [isim]`: Kayıtlı bir çalma listesini siler.
* `/history`: Dinlenmiş son 10 şarkıyı gösterir.
* `/download [şarkı adı/URL]`: Şarkıyı yüksek kalitede MP3 olarak indirir ve Telegram üzerinden gönderir.
* `/profile`: Kullanıcının toplam komut kullanımını, son komut zamanını, en çok dinlediği şarkıları ve sanatçıları gösterir.
* `/suggest`: Kullanıcının dinleme geçmişinden kişiye özel şarkı önerisi sunar.
* `/radio [stream URL]`: Canlı radyo yayını çalar (MTProto üzerinden).
* `/filter [efekt]`: Ses efektleri uygulamayı amaçlar (geliştirme aşamasında).

### Yönetim ve Kullanıcı Deneyimi @Cumhurbbaskani

* **Butonlarla Kontrol**: Çalan şarkı mesajının altında interaktif kontrol butonları bulunur.
* **Şarkı Değişince Mesaj Güncelleme**: Çalan şarkı bilgisi otomatik olarak güncellenir.
* **Sadece Yöneticiler Çalabilir**:
    * `/adminonly [on/off]`: Sadece belirlenmiş yöneticilerin müzik komutlarını kullanmasına izin verir.
* **AFK Sistemi**: Bot, belirli bir süre sesli sohbette boşta kalırsa otomatik olarak ayrılır.
* **Yönetici Ayar Komutları**:
    * `/admin_stats`: Botun genel kullanım istatistiklerini (toplam komut, sesli sohbet süresi, en aktif kullanıcılar/gruplar) gösterir.
    * `/admin_logs`: Son komut loglarını gösterir (kim, ne zaman, hangi komutu kullandı).
* **Aylık İstatistik Sıfırlama**: Tüm kullanım istatistikleri her ayın ilk günü saat 00:00'da otomatik olarak sıfırlanır.
* **Grup Odaklı**: Bot sadece grup sohbetlerinde çalışır, özel mesajlarda komutları kabul etmez.

---

## 🚀 Kurulum @Cumhurbbaskani

### Ön Gereksinimler

Kuruluma başlamadan önce bu gereksinimlerin bilgisayarınızda yüklü olduğundan emin olun:

* **Node.js**: Sisteminizde kurulu olmalıdır.
* **FFmpeg**: Ses işleme, müzik çalma ve indirme için FFmpeg'in kurulu ve sistem PATH'ine ekli olması gereklidir.
    * **Windows**: [ffmpeg.org/download.html](https://ffmpeg.org/download.html) adresinden indirip `bin` klasörünü PATH'e ekleyin.
    * **macOS**: `brew install ffmpeg`
    * **Linux (Debian/Ubuntu)**: `sudo apt update && sudo apt install ffmpeg`

### Projeyi Hazırlama

1. **Bot Dosyalarını İndir**: Proje dosyalarını bilgisayarınıza indirin ve botun ana klasörüne yerleştirin.
2. **Klasör Yapısını Doğrula**: Ana bot klasörünüzde şu klasörlerin olduğundan emin olun: `data/` (boş olabilir), `admin-panel/views/`.
3. **`package.json` Oluştur**: Projenizin ana dizininde bir terminal açın ve aşağıdaki komutu çalıştırın:

    ```
    npm init -y
    ```

4. **Bağımlılıkları Yükle**: Aynı terminalde şu komutu çalıştırın:

    ```
    npm install node-telegram-bot-api ytdl-core fluent-ffmpeg ytsr spotify-url-info soundcloud-scraper telegram express ejs
    ```

### Başlangıç Ayarları ve İlk Çalıştırma

#### 1. Telegram API Bilgilerini Ayarla (Çok Önemli!)

`index.js` dosyasını bir metin düzenleyiciyle açın ve aşağıdaki satırları kendi bilgilerinizle güncelleyin:

* `const BOT_TOKEN = '8131140912:AAEih1CQY0Yfgm3mrL2Zvoi3lf39cctyKT8';`: BotFather'dan aldığınız bot token'ını buraya yapıştırın.
* `const API_ID = 33818253;`: [my.telegram.org/apps](https://my.telegram.org/apps) adresinden aldığınız API ID'yi buraya yapıştırın (sayı).
* `const API_HASH = '22a4a51c2bd3799fdde7226fc112e6d6';`: [my.telegram.org/apps](https://my.telegram.org/apps) adresinden aldığınız API Hash'i buraya yapıştırın (uzun metin).
* `const ADMIN_IDS = [916150666];`: Kendi Telegram kullanıcı ID'nizi buraya yapıştırın (sayı). Birden fazla admin için virgülle ayırarak ekleyebilirsiniz: `[123456789, 987654321]`.

#### 2. Botu İlk Kez Çalıştırma ve MTProto Oturumunu Kaydetme

Botu ilk kez başlattığınızda, Telegram hesabınızla bir oturum kurması gerekecek.

1. Projenizin ana dizininde yeni bir terminal açın.
2. Şu komutu çalıştırın:

    ```
    node index.js
    ```

3. Terminalde bot sizden sırasıyla botun bağlı olduğu Telegram hesabının **telefon numarasını**, varsa **iki adımlı doğrulama şifresini** ve Telegram uygulamanıza gelen **doğrulama kodunu** isteyecektir. Bu bilgileri doğru bir şekilde girin.
4. Başarılı bir şekilde bağlandıktan sonra, terminalde `Oturum dizeniz (bunu StringSession'a kaydedin):` mesajını ve altında çok uzun bir metin (session string'iniz) göreceksiniz.
5. Bu uzun metni tamamen kopyalayın.
6. `index.js` dosyasındaki `const stringSession = new StringSession('');` yazan yeri bulun ve kopyaladığınız string'i tırnakların içine yapıştırın:

    ```
    const stringSession = new StringSession('BURAYA_KOPYALADIĞINIZ_ÇOK_UZUN_METİN_GELECEK');
    ```

7. `index.js` dosyasını kaydedin. Bu işlem, botu her yeniden başlattığınızda tekrar telefon numarası sormasını engelleyecektir.

---

## ⚙️ Kullanım Talimatları @Cumhurbbaskani

### Botu Başlatma

* **Bot Terminali**: İlk çalıştırmayı yaptığınız terminali kapatmadıysanız (veya kapattıysanız `Ctrl+C` ile durdurup), aşağıdaki komutla botu tekrar başlatın:

    ```
    node index.js
    ```

### Admin Panelini Başlatma

* **Admin Paneli Terminali**: Botun çalıştığı terminali açık bırakarak, projenizin ana dizininde yeni bir terminal açın.
* Şu komutu çalıştırın:

    ```
    node adminServer.js
    ```

* Web tarayıcınızı açın ve `http://localhost:3000/admin` adresine giderek botun kullanım istatistiklerini görüntüleyin.

### Telegram'da Botu Kullanma

1. Botunuzu bir Telegram grubuna ekleyin.
2. Bota **yönetici yetkilerini** verin; özellikle "Sesli Sohbetleri Yönet" yetkisinin verildiğinden emin olun.
3. Grupta bir sesli sohbet başlatın.
4. Botu kullanmaya başlayın:
    * `/joinvc`: Botu sesli sohbete katılmaya davet edin.
    * `/play [şarkı adı veya YouTube/Spotify/SoundCloud linki]`: Müzik çalmaya başlayın.
    * Diğer komutlar için `/help` yazabilirsiniz.

---

## ⚠️ Önemli Detaylar ve Dikkat Edilmesi Gerekenler @Cumhurbbaskani

* **MTProto Sesli Sohbet Akışı (Kritik!)**: Bu projedeki MTProto sesli sohbet entegrasyonu (müzik çalma ve radyo yayını), Telegram'ın düşük seviyeli MTProto API'sini kullanır. `index.js` dosyasındaki `playSong` ve `radio` fonksiyonları içinde, FFmpeg'den gelen ses verilerini Telegram'a gerçek zamanlı olarak UDP üzerinden gönderme mekanizması sadece **simüle edilmiştir**. Bu kısmı tam olarak çalışan hale getirmek, derinlemesine araştırma, düşük seviyeli ağ programlama bilgisi ve Telegram'ın Voice Chat protokol detayları hakkında kapsamlı bir anlayış gerektirir. **Bu kısmı tamamlamadan bot, sesli sohbete katılsa bile müzik çalmayacaktır.** Konsolda `[MTProto Simülasyon] Ses stream'i başlatıldı. Gerçek Opus paketleri burada gönderilecek.` gibi mesajlar göreceksiniz.
* **FFmpeg Kurulumu**: FFmpeg'in doğru bir şekilde kurulduğundan ve sistem PATH'ine eklendiğinden emin olun. Bu olmadan botun ses işleme ve indirme özellikleri çalışmayacaktır.
* **Hata Mesajları**: Komutları kullanırken terminaldeki çıktıları ve Telegram'da botun verdiği hata mesajlarını dikkatlice okuyun. Bunlar, sorunları gidermenize yardımcı olacaktır.
* **Sürekli Çalıştırma**: Botu sürekli çevrimiçi kalması ve aylık istatistik sıfırlama gibi zamanlanmış görevleri yerine getirmesi için bir sunucuda (örn. VPS, Railway, DigitalOcean) barındırmanız önerilir. Yerel bilgisayarınızda terminali kapattığınızda bot da durur.
* **Aylık Sıfırlama**: İstatistikler her ayın ilk günü saat 00:00'da otomatik olarak sıfırlanacaktır, ancak botun o anda çalışır durumda olması gerekmektedir.

---

## 📁 Proje Dosya Yapısı @Cumhurbbaskani
telegram-muzik-botu/
├── data/
│   ├── logs.json
│   ├── playlists.json
│   └── stats.json
├── admin-panel/
│   └── views/
│       └── stats.ejs
├── index.js
├── adminServer.js
└── package.json


### Açıklamalar

* `telegram-muzik-botu/`: Bu, projenizin ana klasörü. Tüm diğer dosyaları ve klasörleri bunun içine koymalısınız.
* `data/`: Botun kalıcı verilerini (istatistikler, çalma listeleri, loglar) tuttuğu klasör. Bu klasörü manuel olarak oluşturmalısınız.
    * `logs.json`: Komut kullanım kayıtları burada saklanır.
    * `playlists.json`: Kullanıcıların kaydettiği özel çalma listeleri burada tutulur.
    * `stats.json`: Botun genel kullanım istatistikleri (komut sayıları, sesli sohbet süreleri vb.) burada bulunur.
* `admin-panel/`: Yönetici panelinin web dosyalarını içerir.
    * `views/`: Admin panelinin HTML şablonları (EJS dosyaları) bu klasörde bulunur.
        * `stats.ejs`: Admin panelinin ana görünüm şablonu.
* `index.js`: Botun ana kod dosyasını içerir. Telegram API ile etkileşim, komut işleme ve müzik çalma mantığı buradadır.
* `adminServer.js`: Yönetici panelini web üzerinden sunan Express.js sunucu kodudur.
* `package.json`: Projenizin meta verilerini ve tüm Node.js bağımlılıklarını (yüklemeniz gereken kütüphaneler) listeler. `npm install` komutu bu dosyayı kullanarak gerekli modülleri kurar.

---

## ⚖️ Lisans ve Katkı @Cumhurbbaskani

**@Cumhurbbaskani** tarafından ücretsiz ve açık kaynak olarak halka sunulmuştur. Kullanımı ve üzerinde geliştirme yapılması tamamen serbesttir. Emeğe saygı göstermek ve projenin gelişimine katkıda bulunmak için lütfen projeyi beğenmeyi ve yıldızlamayı unutmayın.

**Önemli Not:** Projenin aslının (kaynak kodunun) izinsiz çoğaltılması ve dağıtılması yasaktır. Lütfen bu kurala uyun.

---

## ⚠️ Önemli Bilgilendirme @Cumhurbbaskani

Bu proje, **@Cumhurbbaskani** tarafından **deneysel amaçlarla geliştirilmiştir** ve ticari bir ürün olarak tasarlanmamıştır. Halka **ücretsiz olarak sunulmuştur** ve henüz geliştirme aşamasındadır. Bu nedenle, projenin **%100 sorunsuz çalışmadığını** belirtmek isteriz. Karşılaşabileceğiniz hatalar ve eksiklikler, projenin deneysel niteliğinden kaynaklanmaktadır. Anlayışınız için teşekkür ederiz.

---

### MTProto Simülasyonu Hakkında Kısa Not

Botun sesli sohbet özellikleri (müzik çalma ve radyo yayını), Telegram'ın düşük seviyeli **MTProto API**'sini kullanır. Projedeki `playSong` ve `radio` fonksiyonları içinde, ses verilerinin Telegram'a gerçek zamanlı olarak UDP üzerinden gönderilmesi kısmı şimdilik **sadece simüle edilmiştir**. Bu, botun sesli sohbete katılabileceği ancak henüz gerçek anlamda müzik yayını yapamayacağı anlamına gelir. Bu özelliğin tam olarak çalışır hale getirilmesi, ileri düzey ağ programlama bilgisi ve Telegram'ın sesli sohbet protokol detayları üzerine derinlemesine araştırma gerektirmektedir.

---

# Developed by **@Cumhurbbaskani** • 2025
