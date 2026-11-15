# Saját edzésterv-alkalmazás – útmutató

Ez az alkalmazás (https://edzesterv2026-web.github.io/edzesterv/) bárki saját edzéstervével használható. A kód közös, az adatok mindenkinek a saját **privát** GitHub-tárolójában vannak, így senki nem látja a másik tervét és naplóját.

## 1. GitHub-fiók és privát tároló
1. Regisztrálj a https://github.com oldalon (ingyenes).
2. https://github.com/new → Repository name: `edzesnaplo-adatok` → **Private** → pipáld be: *Add a README file* → **Create repository**.

## 2. Az adatfájlok feltöltése
A tárolóba három fájl kell (a tárolóban: *Add file → Upload files*):
- `plan.json` – az edzésterved (lásd lent, ezt a Claude elkészíti),
- `log.json` – kezdetben csak ennyi: `{}`,
- `garmin.json` – a mintából másold: [garmin.json](garmin.json).
Nem kötelező: `uszodak.json` – ha nincs, az Uszoda fül nem jelenik meg.

### A plan.json elkészítése Claude-dal
Add oda Claude-nak az edzéstervedet és ezt a mintát: [plan.json](plan.json), és kérd meg, hogy ugyanilyen szerkezetben készítse el a teljes tervet. A fontos mezők:
- `verseny`: a verseny napja (ÉÉÉÉ-HH-NN), ebből számol vissza az alkalmazás; `versenyNev`: a verseny neve.
- `het1Hetfo`: az 1. hét hétfője; `het0`: a 0. (bevezető) hét első és utolsó napja – ha nincs ilyen, legyen a 0. hét az 1. hét előtti hétvége.
- `pulzus`: a futó pulzuszónáid (a saját küszöbpulzusod alapján).
- `hetek`: hetenként `het` (szám), `cim` (pl. „3. hét – jan. 18–24. · alapozás · kb. 7 óra”), `megj` (megjegyzés vagy üres).
- `edzesek`: minden edzés külön elem: `id` = „ÉÉÉÉ-HH-NN-sorszám”, `het`, `datum`, `nap` (H, K, Sze, Cs, P, Szo, V), `sport` (Úszás, Bringa, Futás, Brick, Kondi, Pihenő, Utazás, Egyéb, Verseny), `edzes` (rövid név, az időtartammal: pl. „Futás 40' Z2”, „Bringa 1:30 Z2”), `hogyan` (részletes leírás).
- `fogalmak`: a fogalmak listája (`f` = fogalom, `j` = jelentés).

## 3. Hozzáférési kulcs a telefonhoz
https://github.com/settings/personal-access-tokens/new
- Token name: pl. `telefon`
- Expiration: a verseny utánra
- Repository access: **Only select repositories** → `edzesnaplo-adatok`
- Permissions → Repository permissions → **Contents: Read and write**
- **Generate token**, majd másold ki (csak egyszer látszik). Ne mentsd el máshová, és senkinek ne küldd el.

## 4. Az alkalmazás beállítása
1. A telefonon Safariban nyisd meg: https://edzesterv2026-web.github.io/edzesterv/
2. Írd be a GitHub-felhasználóneved, a tároló nevét (`edzesnaplo-adatok`) és a kulcsot → **Mentés és indítás**.
3. Megosztás → **Hozzáadás a kezdőképernyőhöz**.

Az FTP-t a Fogalmak fülön lehet megadni, ettől a bicikliedzéseknél wattok jelennek meg.

## 5. Nem kötelező: heti Garmin-ellenőrzés
Ha a Claude asztali alkalmazás fut a gépeden és be vagy jelentkezve a Garmin Connectbe a beépített böngészőjében, kérd meg a Claude-ot, hogy állítson be egy heti ütemezett feladatot, amely:
- a beépített böngészővel kiolvassa az előző hét Garmin-tevékenységeit,
- összeveti a `plan.json` (és a `log.json`-ban áthelyezett `d` dátumok, valamint az „x-” kezdetű saját edzések) alapján,
- és a `garmin.json`-ba írja: `edzesek[id] = {"s": "49 perc · 22,1 km · átl. pulzus 131", "perc": 49}`, a terven kívülieket az `extra` listába (`{"datum","sport","s","perc"}`), a heti összefoglalót a `hetek["N"]` mezőbe.

## Fontos
A kód közös: ha az alkalmazás kinézete vagy funkciója változik, az mindenkinél megváltozik. Ha saját, független változatot szeretnél, a GitHubon a https://github.com/edzesterv2026-web/edzesterv oldalon a **Fork** gombbal másold le, és a saját GitHub Pages címedet használd.
