# Julkaisijan ohjeet

Photo & Moto -sivuston sisällöntuottajan ja ylläpitäjän käsikirja.

Tämä dokumentti on **ainoa virallinen ohje** sisällön julkaisemiseen sivustolle.
Se kattaa kaksi erillistä järjestelmää: artikkelien kirjoittamisen Decap CMS:llä
ja vanhojen valokuvien tunnistamisen sekä gallerioiden hallinnan
yllapito-sivulla.

Käsikirja sijaitsee repon juuressa (`JULKAISIJAN_OHJEET.md`) ja näkyy sivustolla
osoitteessa [/fi/julkaisijan-ohjeet/](/fi/julkaisijan-ohjeet/). Päivitykset
tehdään suoraan markdown-tiedostoon — sivu päivittyy itsestään seuraavan
julkaisun yhteydessä.

---

## Sisältö

1. [Yleistä](#yleistä)
2. [Artikkelien kirjoittaminen — Decap CMS](#artikkelien-kirjoittaminen--decap-cms)
3. [Käyttäjätilit ja oikeudet — IAM](#käyttäjätilit-ja-oikeudet--iam)
4. [Tunnistamattomat kuvat — yllapito](#tunnistamattomat-kuvat--yllapito)
5. [Galleriat — Hallitse galleriaa](#galleriat--hallitse-galleriaa)
6. [Yleisimmät tilanteet](#yleisimmät-tilanteet)
7. [Vianetsintä](#vianetsintä)

---

## Yleistä

Photo & Moto -sivustolla on **kaksi erillistä ylläpitojärjestelmää**, koska ne
hoitavat aivan eri asioita:

| Järjestelmä | Mitä tehdään | Kuka käyttää |
|---|---|---|
| **Decap CMS** osoitteessa `/admin/` | Artikkelien kirjoittaminen ja julkaisu | Sisällöntuottajat (toimittajat) |
| **Ylläpito** osoitteessa `/fi/yllapito` | Vanhojen kuvien tunnistus, gallerioiden hallinta | Ylläpitäjät |

Sisällöntuottajat tarvitsevat lähinnä vain Decap CMS:n. Ylläpitäjät käyttävät
molempia. Tämä käsikirja kuvaa molemmat — voit hyppiä omaan osioosi.

### Tärkeintä tietää

- **Tallennus julkaisee suoraan tuotantoon.** Decap CMS:ssä tehty muutos
  ilmestyy `www.photoandmoto.fi`-sivulle noin kahdessa minuutissa. Ei
  tarvitse painaa "julkaise" erikseen — tallennus riittää.
- **Esikatselu Decapin sisällä on luotettava.** Näet artikkelin sellaisena kuin
  se tulee näkymään sivustolla ennen tallennusta.
- **Poistot ovat lopullisia.** Decap kysyy varmistuksen ennen poistoa, mutta
  poiston jälkeen artikkeli häviää sivustolta ~2 minuutissa. Palauttaminen
  vaatii kehittäjän apua (`git revert`).

---

## Artikkelien kirjoittaminen — Decap CMS

### Kirjautuminen

1. Avaa osoite: **<https://www.photoandmoto.fi/admin/>**
2. Klikkaa "Kirjaudu GitHubilla"
3. Käytä omaa GitHub-tunnustasi (sinut on lisättävä etukäteen pääsylistalle)

### Käyttöliittymän osat

Sisäänkirjautumisen jälkeen näkyvissä on:

- **Vasemmalla:** kokoelmien lista
  - **Artikkelit** — kaikki olemassa olevat artikkelit
  - **+ Uusi MXGP-juttu** — pikalisäys MXGP-aiheelle (kategoria + runko esitäytetty)
  - **+ Uusi historiallinen tarina** — pikalisäys historiakirjoitukselle
  - **Kategoriat** — artikkelien kategorialista
- **Yläpalkki:** kun olet muokkaamassa artikkelia, näet **Tallenna**, **Julkaise**,
  **Poista artikkeli** -painikkeet
- **Sisältöalue:** vasemmalla muokkauslomake, oikealla esikatselu

### Uuden artikkelin luominen

#### Pikalisäys-pohjat (suositeltu tapa)

Pikalisäys-pohjat säästävät aikaa, koska kategoria, tagit ja sisältörunko on
valmiiksi täytetty. Lisäksi automaattinen käännös on oletuksena käytössä.

**MXGP-jutun pohja sisältää:**

- Kategoria: `MXGP` (esitäytetty, ei muokattavissa pikalisäyksen kautta)
- Tagi: `MXGP`
- Sisältörunko: avauskappale, kilpailun kulku, tulostaulukko, yhteenveto

**Historiallisen tarinan pohja sisältää:**

- Kategoria: `Historical`
- Tagi: `historia`
- Sisältörunko: avauskappale, tausta, tarina, perintö

Klikkaa vasemmalla **+ Uusi MXGP-juttu** tai **+ Uusi historiallinen tarina**.
Uusi luonnos avautuu valmiilla pohjalla.

#### Tyhjästä (Artikkelit-kokoelma)

Klikkaa vasemmalla **Artikkelit**, sitten oikealla **New Artikkeli** (oikeassa
yläkulmassa). Tämä on tyhjä lomake — sopii mihin tahansa muuhun kuin
MXGP- tai historiajuttuun.

### Kenttien selitykset

| Kenttä | Mitä siihen tulee |
|---|---|
| **Otsikko** | Artikkelin otsikko (näkyy sivustolla ja hakukoneissa) |
| **Alaotsikko** | Lyhyt selitys (valinnainen, näkyy otsikon alla) |
| **Kirjoittaja** | Oletus: "Photo & Moto" |
| **Päivämäärä** | Julkaisupäivä (näkyy artikkelilistassa, vaikuttaa järjestykseen) |
| **Kategoria** | Pakollinen. Valitse pudotusvalikosta. |
| **Avainsanat** | Tagit hakua ja kategorisointia varten |
| **Pääkuva (hero)** | Iso kuva otsikon yläpuolella |
| **Korttikuva** | Pieni kuva listausnäkymässä (jos eri kuin pääkuva) |
| **Näytä pääkuva otsikon yläpuolella** | Yleensä päällä — laita pois, jos haluat pelkän tekstin |
| **Pääkuvan kuvateksti** | Pienellä pääkuvan alle |
| **Piilota sivustolta** | Luonnostila — artikkeli ei näy julkisesti |
| **SEO-kuvaus** | Hakukoneille (maks. 160 merkkiä) |
| **Automaattisesti käännetty** | Käänteinen toggle, ks. seuraava osio |
| **Sisältö** | Itse artikkelin teksti markdown-muodossa |
| **Lähteet** | Valinnainen lista — yksi lähde per rivi, URL-osoitteet muuttuvat linkeiksi |

### Automaattinen käännös FI → EN

Photo & Moto on kaksikielinen — jokaisesta artikkelista pitäisi periaatteessa
olla sekä suomenkielinen että englanninkielinen versio. Tämä hoituu
automaattisesti.

#### Miten se toimii

Jokaisessa artikkelissa on **Automaattisesti käännetty** -valintaruutu.

| Tila | Mitä tapahtuu kun tallennat suomenkielisen artikkelin |
|---|---|
| ☑ valittu | Gemini-tekoäly kääntää artikkelin englanniksi automaattisesti |
| ☐ ei valittu | Englanninkielistä versiota ei kosketa |

#### Käytännön työnkulku

**Uudelle artikkelille (pikalisäys-pohjasta):**

1. Kirjoita artikkeli suomeksi (Automaattisesti käännetty on jo valittu)
2. Tallenna
3. Odota ~2 minuuttia — englanninkielinen versio syntyy automaattisesti
4. Avaa artikkeli uudelleen, klikkaa **EN**-välilehteä yläosassa
5. Lue käännös, korjaa mahdolliset kömpelyydet
6. **Poista valinta** Automaattisesti käännetty -ruudusta (tärkeää!)
7. Tallenna

Kohdan 6 jälkeen tulevaisuuden suomenkielisen artikkelin muokkaukset eivät
enää kirjoita ylitsesi käännöstä.

**Uudelle artikkelille (Artikkelit-kokoelma, tyhjästä):**

Sama kuin yllä, mutta sinun on **valittava ruutu itse** ensimmäisellä
tallennuksella jos haluat käännöksen. Oletuksena se on pois päältä.

#### Milloin et halua automaattista käännöstä

- Artikkeli on niin paikallinen aihe, että englanninkielistä versiota ei
  tarvita
- Artikkeli on jo manuaalisesti käännetty englanniksi ja haluat suojella sitä

Jätä ruutu valitsematta. Englanninkielistä tiedostoa ei luoda.

### Kuvien lisääminen tekstiin

Kuvat lisätään markdown-sisältöön kahdella tavalla:

1. **Mediakirjasto** — klikkaa kuvaikkonia muokkauspalkissa → valitse olemassa
   oleva kuva tai lataa uusi
2. **Suora upload** — vedä kuva sisällöksi suoraan, järjestelmä lataa sen

Kuvat tallennetaan automaattisesti `public/images/`-kansioon ja ne
pakkautuvat (GitHub Action tekee sen taustalla noin minuutissa).

**Tärkeää kuvista:**

- Suositeltu koko: leveys 1200–1600px, JPEG, ≤ 500 KB
- Liian isot kuvat pakkautuvat automaattisesti — älä huoli ylikoosta
- Kuvateksti markdownissa: `![Kuvateksti](/images/tiedosto.jpg)`

### Tallentaminen ja julkaisu

**Decapissa ei ole erillistä "julkaise" -nappia.** Tallenna = julkaise.
Painikkeen nimi on yksinkertaisesti **Tallenna**.

Kun tallennat:

1. Decap commitoi muutoksen Git-tietovarastoon (näet "Muutokset tallennettu")
2. Cloudflare havaitsee muutoksen ja rakentaa sivuston uudelleen
3. Noin 2 minuutin kuluttua artikkeli näkyy osoitteessa `www.photoandmoto.fi`

Voit tarkistaa tilan:

- **GitHub Actions:** <https://github.com/photoandmoto/photoandmoto/actions>
  (vihreä rasti = käännös onnistui, build pyörii)
- **Cloudflare deployments:** näet uusimman julkaisun statuksen sivuston
  rakentamisen ajan

### Artikkelin muokkaaminen

1. Avaa **Artikkelit** vasemmalla
2. Klikkaa artikkelia listasta
3. Tee muutokset
4. **Tallenna**

Muutokset menevät heti tuotantoon. Jos haluat tehdä useita muutoksia
peräkkäin ilman että jokainen tallennus laukaisee buildin, voit valita
**Piilota sivustolta** -ruudun, tehdä muutokset, ja poistaa valinnan kun
olet valmis.

### Artikkelin poistaminen

1. Avaa artikkeli muokattavaksi
2. Klikkaa yläpalkista **Poista artikkeli**
3. Vahvista poisto ("Haluatko varmasti poistaa tämän julkaistun artikkelin?")
4. Klikkaa **OK**

Artikkeli häviää sivustolta noin 2 minuutissa. Sekä suomen- että
englanninkielinen versio poistetaan samalla kerralla.

> ⚠️ **Poisto on lopullinen.** Palautus on mahdollinen vain `git revert`
> -komennolla, joka vaatii kehittäjän apua. Tarkista kahdesti ennen poistoa.

---

## Käyttäjätilit ja oikeudet — IAM

Tämä osio koskee `yllapito`-työkaluja (Tunnista kuva, Hallitse galleriaa,
Käyttäjät). Decap CMS käyttää erillistä GitHub-pohjaista kirjautumista —
ks. yllä oleva [Artikkelien kirjoittaminen](#artikkelien-kirjoittaminen--decap-cms).

Photo & Moton ylläpitojohtoinen autentikointi perustuu **henkilökohtaisiin
käyttäjätileihin**. Jokaisella työkaluja käyttävällä on oma
sähköpostiosoite + salasana, ja ylläpitotyökalujen välilehdet näkyvät
yksilöllisten oikeuksien mukaan. Vanha jaettu salasana on poistettu
käytöstä.

### Kirjautuminen

1. Avaa osoite: **<https://www.photoandmoto.fi/fi/yllapito>**
2. Syötä sähköposti ja salasana
3. Kirjaudu sisään — näet vain ne välilehdet joihin sinulla on oikeudet

Istunto pysyy voimassa 30 päivää selaimen evästeen kautta. Voit kirjautua ulos
yläpalkin **Kirjaudu ulos** -painikkeesta milloin tahansa.

### Salasanan unohtaminen

Jos olet unohtanut salasanasi, käytä **Unohditko salasanan?** -linkkiä
kirjautumissivulla, tai mene suoraan osoitteeseen
[/fi/palauta-salasana/](/fi/palauta-salasana/).

Palautusprosessi:

1. Syötä sähköpostiosoitteesi
2. Vastaa **3 turvakysymyksestä vähintään 2** oikein (kysymykset olet itse
   asettanut tiliä ottaessa)
3. Aseta uusi salasana
4. Kirjaudu sisään uudella salasanalla

Jos et muista turvakysymystesi vastauksia, työkalun ylläpitäjä voi luoda
sinulle **uuden provisiointilinkin**, jolla pääset asettamaan salasanan ja
turvakysymykset uudelleen.

> **Huom!** Palautusyrityksistä jää jälki ylläpidon **Palautuslokiin** — sekä
> onnistuneet että epäonnistuneet yritykset, IP-osoitteineen. Tämä estää
> väärinkäyttöä: jos näet lokissa yrittämistä joita et tehnyt itse,
> ota yhteyttä ylläpitäjään.

### Oikeudet

Jokaisella käyttäjällä on **rooli** (Editor tai Admin) ja **viisi erillistä
oikeutta**, jotka määrittelevät mitä työkaluja hän näkee. Oikeudet ovat
riippumattomia roolista — admin voi olla luonteeltaan rajoitettu ja editor
voi saada laajat oikeudet.

| Tunnus | Oikeus | Mitä mahdollistaa |
|---|---|---|
| **T** | Tarkista | Yhteisön ehdotusten tarkistus ja kuvien tunnistaminen (Tarkista-välilehti) |
| **L** | Lähetä kuva | Uusien tunnistettavien kuvien lataaminen (Lähetä kuva -välilehti) |
| **G** | Hallitse galleriaa | Julkaistujen gallerioiden hallinta: kuvatekstit, siirrot, poistot, gallerian uudelleennimeäminen (Hallitse galleriaa -välilehti) |
| **A** | Hallitse artikkeleita | Pääsy Decap CMS:ään (Hallitse artikkeleita ↗ -linkki avaa erillisen GitHub-kirjautumisen) |
| **I** | Hallitse käyttäjiä | Tämän IAM-paneelin käyttö: uusien käyttäjien luonti, oikeuksien muokkaus, deaktivointi (Käyttäjät-välilehti) |

Tunnukset T/L/G/A/I näkyvät väribadgeina Käyttäjät-listassa.

### Käyttäjien hallinta

*Tämä osio koskee vain käyttäjiä, joilla on **I** (Hallitse käyttäjiä) -oikeus.*

Käyttäjät-välilehti näkyy työkalun oikealla puolella, eroteltuna muista
välilehdistä. Siellä näet taulukon kaikista käyttäjistä: nimi, sähköposti,
rooli, oikeudet badgeina, aktiivisuusstatus, viimeisin kirjautumisaika sekä
toiminnot.

#### Uuden käyttäjän luominen

1. Klikkaa **+ Lisää uusi käyttäjä** -painiketta
2. Täytä etunimi, sukunimi, sähköpostiosoite
3. Valitse rooli (Editor on yleensä oikea valinta uusille toimittajille)
4. Valitse oikeudet ruksaamalla kohdat. Oletukset uudelle editorille:
   - ☑ Tarkista
   - ☑ Lähetä kuva
   - ☑ Hallitse artikkeleita
   - ☐ Hallitse galleriaa (anna vain kokeneille)
   - ☐ Hallitse käyttäjiä (admin-tasoinen oikeus)
5. Klikkaa **Luo ja tee linkki**
6. **Kopioi näyttöön ilmestyvä provisiointilinkki** ja lähetä se käyttäjälle
   (sähköpostilla, viestillä, miten vain)

> **Huom!** Linkki näytetään vain kerran. Jos suljet ikkunan ennen kopioimista,
> sinun on luotava uusi linkki **Uusi linkki** -painikkeella käyttäjän riviltä.

#### Provisiointilinkit

Provisiointilinkki on **kertakäyttöinen, 7 päivää voimassa oleva** URL,
jolla käyttäjä aktivoi tilinsä. Linkin muoto:

`https://www.photoandmoto.fi/fi/aseta-salasana?token=<satunnaisesti-luotu-tunnus>`

Kun käyttäjä avaa linkin:

1. Hän näkee `aseta-salasana`-sivun jossa hän asettaa:
   - Vahvan salasanan (vähintään 12 merkkiä, sekä isoja että pieniä kirjaimia,
     numeroita ja erikoismerkkejä)
   - **3 turvakysymystä** ja vastaukset niihin (käytetään salasanan
     palauttamisessa)
2. Vahvistaa asetukset
3. Saa onnistumisilmoituksen ja voi kirjautua sisään

Linkki katoaa käytöstä heti kun käyttäjä vahvistaa asetuksensa. Jos linkki
ehtii vanheta (7 päivää) tai käyttäjä hukkaa sen, luo uusi:

#### Uuden linkin luominen olemassa olevalle käyttäjälle

Käyttäjät-taulukosta klikkaa kyseisen rivin **Uusi linkki** -painiketta.
Vahvistus-ikkuna kertoo selvästi, että **käyttäjän nykyinen salasana ja
turvakysymykset poistetaan** — hänen on asetettava ne uudelleen avatessaan
linkin. Tämä on tarkoituksellinen turvatoimenpide: linkin uudelleenluonti
voidaan tehdä myös tilanteissa, joissa epäillään tilin väärinkäyttöä.

Deaktivoidulle käyttäjälle uuden linkin luominen toimii samalla tavalla, mutta
se myös **reaktivoi tilin** automaattisesti.

#### Käyttäjän tietojen muokkaaminen

Klikkaa **Muokkaa**-painiketta käyttäjän riviltä. Voit muuttaa:

- Etunimi, sukunimi
- Rooli
- Oikeudet (T/L/G/A/I)

Sähköpostiosoitetta ei voi muuttaa jälkikäteen — jos käyttäjällä vaihtuu
sähköposti, deaktivoi vanha tili ja luo uusi.

#### Käyttäjän deaktivointi

Klikkaa **Poista**-painiketta käyttäjän riviltä. "Poista" on hieman
harhaanjohtava nimi — tili **deaktivoidaan**, ei poisteta tietokannasta:

- Käyttäjän istunto lopetetaan välittömästi
- Hän ei voi enää kirjautua sisään
- Historia (esim. kenen lisäämä mikäkin kuva on) säilyy
- Reaktivointi on mahdollista luomalla uusi provisiointilinkki **Uusi linkki**
  -painikkeesta (sama painike toimii myös deaktivoiduille käyttäjille)

Viimeisen aktiivisen admin-IAM-käyttäjän deaktivointi on estetty — muuten
ylläpitojärjestelmä lukittuisi.

### Palautusloki

Käyttäjät-välilehden alaosassa on kokoontaitettava **Palautusloki
(viimeisimmät 50 yritystä)** -osio. Se kirjaa kaikki salasanan
palautusyritykset:

- ✓ (vihreä) = onnistunut palautus
- ✗ (punainen) = epäonnistunut yritys (väärät turvakysymysvastaukset,
  vanhentunut tunnus tms.)

Jokaisesta merkinnästä näkyy sähköpostiosoite (jos syötetty), IP-osoite ja
yrityksen ajankohta. Mikäli näet tunnistamattomia yrityksiä tai paljon
epäonnistuneita peräkkäin — etenkin osoitteille jotka eivät kuulu omille
käyttäjillesi — tämä voi olla merkki kohdistuneesta hyökkäyksestä. Ota
yhteyttä kehittäjään tilanteessa, jossa lokissa näkyy epäilyttävää toimintaa.

---

## Tunnistamattomat kuvat — yllapito

Tämä osio koskee ylläpitäjiä — sisällöntuottajat voivat ohittaa tämän.
Kirjautuminen ja oikeudet on kuvattu yllä osiossa
[Käyttäjätilit ja oikeudet](#käyttäjätilit-ja-oikeudet--iam) — tässä keskitytään
työkalun välilehtien käyttöön.

Näkyvät välilehdet oikeuksien mukaan:

- **Tarkista** (oikeus T) — yhteisön ehdotusten tarkistus ja kuvien tunnistus
- **Lähetä kuva** (oikeus L) — uuden tunnistamattoman kuvan lähettäminen
- **Hallitse galleriaa** (oikeus G) — julkaistujen gallerioiden hallinta
- **Käyttäjät** (oikeus I) — IAM-paneeli (ks. yllä)
- **Hallitse artikkeleita ↗** (oikeus A) — linkki Decap CMS:ään

### Uuden tunnistamattoman kuvan lähettäminen

1. Mene **Lähetä kuva** -välilehdelle
2. Valitse kuvatiedosto (JPEG suositeltu)
3. Täytä alustavat tiedot, jos tiedät jotain:
   - **Vuosi (arvio)** — esim. "1985" tai "1980-luvun alku"
   - **Henkilöt** — keitä kuvassa on
   - **Paikka** — missä kuva on otettu
   - **Muu tieto** — vapaata tekstiä
4. Klikkaa **Lähetä**

Kuva ilmestyy heti Tunnista-välilehdelle ja landing-pagen "APUA TARVITAAN"
-blokkiin (jos kuvalle on luotu pikkukuva).

### Kuvan tunnistaminen yhteisön avulla

Yhteisön jäsenet voivat ehdottaa tietoja kuvalle osoitteessa
`/fi/tunnistamatta`. Ylläpitäjänä tarkistat ehdotukset ja kirjaat lopullisen,
oikean tiedon.

#### Tarkista-välilehden työnkulku

1. **Klikkaa kuvaa** listasta → modaali avautuu
2. Lue **yhteisön ehdotukset** alaosassa (jos niitä on)
3. Kirjoita **viralliset tiedot** lomakekenttiin:
   - Vuosi
   - Henkilöt
   - Paikka
   - Muu tieto
4. Klikkaa **Tallenna**

Status päivittyy automaattisesti:

| Tilanne | Status |
|---|---|
| Mitään ei ole vielä tunnistettu | **Uusi** |
| Osa tiedoista täytetty | **Osittain tunnistettu** |
| Vuosi + henkilöt + paikka kaikki täytetty | **Tunnistettu** |

Tunnistetut kuvat voidaan siirtää galleriaan (seuraava kohta).

### Julkaiseminen galleriaan

Kun kuvalla on status **Tunnistettu**, se voidaan julkaista pysyvään
galleriaan.

#### Olemassa olevaan galleriaan

1. Avaa tunnistettu kuva (klikkaa kuvaa Tarkista-välilehdellä)
2. Klikkaa **Julkaise Galleriaan**
3. Valitse galleria pudotusvalikosta (lista päivittyy automaattisesti)
4. Tarkista **kuvateksti** (vakiomuoto: `henkilöt paikka vuosi`) — muokkaa
   tarvittaessa
5. Klikkaa **Julkaise**

Kuva siirtyy galleriaan noin 2 minuutissa:

- Julkaisuputki (`publish.js`) commitoi alkuperäisen kuvan GitHubiin
- GitHub Action luo pikkukuvan ja vesileimatun näyttöversion
- Cloudflare rakentaa sivuston uudelleen
- Kuva ilmestyy galleriaan, häviää tunnistamattomat-listalta

#### Uuteen galleriaan

1. Klikkaa **Julkaise Galleriaan**
2. Valitse pudotusvalikosta **➕ Luo uusi galleria…**
3. Syötä gallerian nimi (esim. "Suomi 90s")
4. Tarkista kuvateksti
5. Klikkaa **Julkaise**

Uusi galleria luodaan automaattisesti, kategorisoidaan slugin perusteella
(`suomi-90s` → kategoria "finland"), ja ensimmäinen kuva lisätään siihen.

---

## Galleriat — Hallitse galleriaa

Tämä osio koskee ylläpitäjiä.

**Hallitse galleriaa** -välilehdellä voit:

- **Muokata kuvatekstiä** — klikkaa kuvaa, muokkaa kuvatekstiä, tallenna
- **Poistaa kuvan galleriasta** — klikkaa kuvaa, valitse Poista, vahvista
- **Siirtää kuvan toiseen galleriaan** — toistaiseksi tehtävä manuaalisesti
  (Phase D backlogissa, ks. README)

Muutokset (kuvatekstien muokkaukset, poistot) tallentuvat samalla tavalla
kuin julkaisut — Git-commit + Cloudflare-build, ~2 minuuttia.

### Mitä Hallitse galleriaa ei vielä osaa

Backlogissa olevia, vielä toteuttamattomia ominaisuuksia (Phase D):

- Kuvien uudelleenjärjestäminen galleriassa
- Kokonaisen gallerian poistaminen

Nämä vaativat toistaiseksi manuaalista git-työtä — ota yhteyttä kehittäjään.

---

## Yleisimmät tilanteet

### "Haluan kirjoittaa uuden MXGP-jutun"

1. <https://www.photoandmoto.fi/admin/> → kirjaudu GitHubilla
2. Vasemmalla **+ Uusi MXGP-juttu**
3. Täytä otsikko, alaotsikko, päivämäärä (tämän päivän)
4. Pohja on jo valmiina — täytä omat tiedot
5. Lisää pääkuva (vedä kuva pääkuva-kenttään tai valitse mediakirjastosta)
6. Tallenna
7. Odota 2 min, avaa **EN**-välilehti, tarkista käännös
8. Poista **Automaattisesti käännetty** -valinta englanninkielisestä versiosta
9. Tallenna

### "Haluan että artikkeli näkyy vain suomeksi"

Älä valitse **Automaattisesti käännetty** -ruutua. Englanninkielistä tiedostoa
ei luoda eikä artikkeli näy `/en/aikakone/`-listassa.

Voit myös myöhemmin manuaalisesti poistaa englanninkielisen version, jos
sellainen on jo luotu — avaa artikkeli, vaihda EN-välilehdelle, klikkaa
**Poista artikkeli**.

### "Haluan korjata vain englanninkielistä versiota"

Suomenkielinen versio on muokkauksesi lähteenä, joten käännöstä ei lähtökohtaisesti tarvita.

1. Avaa artikkeli muokattavaksi
2. **Tarkista että Automaattisesti käännetty -valinta on POIS PÄÄLTÄ**
   englanninkielisessä versiossa
3. Vaihda **EN**-välilehdelle
4. Tee muutokset
5. Tallenna

Jos Automaattisesti käännetty olisi ollut päällä, suomenkielisen artikkelin
seuraava tallennus olisi kirjoittanut englanninkielisen version yli.

### "En pääse kirjautumaan — olen unohtanut salasanan"

Käytä [/fi/palauta-salasana/](/fi/palauta-salasana/) ja vastaa
turvakysymyksiisi (2 / 3 riittää oikein). Jos et muista vastauksiakaan,
pyydä ylläpitäjää luomaan sinulle uusi provisiointilinkki Käyttäjät-taulukon
**Uusi linkki** -painikkeella. Tämä nollaa tilisi salasanan ja
turvakysymykset; asetat ne uudelleen linkin avatessa.

### "Joku väärä kirjautui sisään minun tililläni"

Vaihda salasana välittömästi (palauta-salasana-linkki tai pyydä admin-IAM
-oikeuksilla varustettua kollegaa luomaan uusi provisiointilinkki). Ilmoita
kehittäjälle, jolloin hän voi tarkistaa Palautuslokin ja istunnot.

### "Vahingossa poistin artikkelin — voiko palauttaa?"

Kyllä, mutta se vaatii kehittäjän apua. Sano hänelle:

- Artikkelin slug (URL:n viimeinen osa, esim. `mxgp-2026-argentina`)
- Suunnilleen mihin aikaan poisto tapahtui

Hän palauttaa artikkelin `git revert <commit-sha>` -komennolla — noin 30
sekunnin työ.

### "Tarvitsen lisätä uuden kategorian"

1. Avaa **Kategoriat** vasemmalla
2. Klikkaa **New Kategoria**
3. Täytä:
   - **Tunniste** (englanniksi, esim. `Speedway`) — tämä tallennetaan
     artikkelien tiedostoihin
   - **Näytettävä nimi** (suomeksi, esim. `Speedway`) — tämä näkyy
     pudotusvalikossa
4. Tallenna

> ⚠️ **Älä koskaan muuta olemassa olevan kategorian tunnistetta.** Kaikki
> sitä käyttävät artikkelit lakkaavat näkymästä. Näytettävän nimen voit
> muuttaa milloin tahansa.

---

## Vianetsintä

### Decap ei lataudu

- Hard-refresh selaimessa: **Ctrl+Shift+R**
- Tarkista että GitHub-tunnuksellasi on pääsy `photoandmoto`-organisaatioon
- Jos virhe jää, kerro kehittäjälle tarkalleen mitä näytöllä lukee

### Kirjautuminen epäonnistuu

- Yleisin syy: GitHub-tunnuksesi ei ole vielä lisätty pääsylistalle. Pyydä
  kehittäjää lisäämään.
- Toinen syy: selain estää OAuth-uudelleenohjauksen — kokeile toista selainta
  tai poista evästeet domainilta

### "Tallensin artikkelin mutta se ei näy sivustolla"

Tarkista vaiheittain:

1. **Cloudflare deployment** — onko build käynnissä tai epäonnistuiko se?
   <https://dash.cloudflare.com> → Workers & Pages → photoandmoto → Deployments
2. **Onko Piilota sivustolta valittu?** — tarkista artikkelin lomakkeesta
3. **Mene osoitteeseen suoraan** — `https://www.photoandmoto.fi/fi/aikakone/<slug>/`
4. **Selaimen välimuisti** — Ctrl+Shift+R refreshaa kovaa

### "Englanninkielistä käännöstä ei syntynyt"

Tarkista:

1. **Onko Automaattisesti käännetty valittu?** Avaa artikkeli, tarkista ruutu
2. **GitHub Actions** — <https://github.com/photoandmoto/photoandmoto/actions/workflows/translate-article.yml>
   - Vihreä rasti = käännös onnistui
   - Punainen X = käännös epäonnistui, klikkaa avataksesi lokin
3. Jos rasti on vihreä mutta käännöstä ei näy, hard-refresh selain

### "Kuva on liian iso (yli 5 MB)"

Mediakirjasto saattaa hylätä kuvan. Tee jokin näistä:

- Pakkaa kuva ennen latausta (esim. <https://squoosh.app>)
- Mene Mediakirjastoon, lataa pienempi versio
- Kerro kehittäjälle — automaattipakkausta voidaan virittää

### Jokin muu menee pieleen

Kerro kehittäjälle:

1. Mitä yritit tehdä
2. Mitä näytöllä lukee (kuvakaappaus on paras)
3. Suunnilleen mihin aikaan ongelma alkoi

---

## Päivitykset tähän käsikirjaan

Tämä dokumentti on `JULKAISIJAN_OHJEET.md` repon juuressa. Päivittäminen:

1. Muokkaa tiedostoa joko paikallisesti tai GitHubin web-editorissa
2. Commitoi muutos
3. Sivun [/fi/julkaisijan-ohjeet/](/fi/julkaisijan-ohjeet/) sisältö päivittyy
   automaattisesti seuraavan buildin yhteydessä (~2 min)

Jos näet käsikirjassa vanhentunutta tietoa tai puutteita, päivitä se itse tai
kerro kehittäjälle.

---

*Viimeksi päivitetty: kesäkuu 2026 (lisätty IAM-osio)*
