# Senna & Luca Strijders

Besloten realtime browsergame voor Luca en Senna. De browserapp draait op Vercel; een Cloudflare Worker met een Durable Object wordt de enige autoriteit voor lobby- en wedstrijdstate. Upstash Redis bewaart in een latere fase uitsluitend apparaatkoppelingen en administratieve state.

De game is in uitvoering. [`docs/PRD.md`](docs/PRD.md) beschrijft het product en [`docs/PLAN.md`](docs/PLAN.md) is de actuele implementatie- en verificatiestatus.

## Architectuur

```text
iPad/browser -> Vercel (Vite-app + pairing/session APIs)
             -> Cloudflare Worker WebSocket
             -> Durable Object (een autoritatieve game room per omgeving)

Vercel APIs -> Upstash Redis (apparaatrollen, generaties en rate limits)
```

Vercel biedt alleen beveiligde pairing-, sessie- en health-APIs. De Cloudflare Worker en Durable Object zijn de enige autoriteit voor lobby- en wedstrijdstate. Browsercode mag nooit definitief schade, items, kistclaims of een winnaar toekennen.

## Vereisten

- Node.js 22
- npm 10 of nieuwer
- Voor deployment: afzonderlijke Vercel-, Cloudflare- en Upstash-configuratie voor preview en productie

## Lokaal starten

Installeer dependencies en start de Vite API-adapter plus Wrangler vanuit een terminal:

```sh
npm ci
npm run dev
```

De webapp/API gebruikt standaard `http://localhost:3000`; de lokale Worker gebruikt `http://127.0.0.1:8787`. Wrangler bewaart lokale Durable Object-state onder de genegeerde map `.wrangler/`. De adapter gebruikt dezelfde handlers/contracts als de Vercel Functions en start zonder cloudaccount. Gebruik `npm run dev:vercel` alleen voor provider-pariteit nadat het juiste Vercel-team interactief is gekozen.

`.env.example` bevat uitsluitend veilige lokale placeholders. Maak alleen wanneer nodig een genegeerde `.env.local` en zet echte secrets uitsluitend in de providerinstellingen. De browserbundel mag geen `ADMIN_PIN`, signing secret, Redis-token of intern Worker-secret bevatten.

## Beeld en geluid

Sprites, iconen en werelddecors komen uit de Layer MCP. De ruwe generaties staan in `assets/source/` en worden lokaal omgezet naar de bestanden die het spel laadt:

```sh
npm run assets
```

Dat script haalt de vlakke magenta achtergrond weg, snijdt het iconenblad in losse iconen, schaalt alles en schrijft het resultaat naar `public/art/`. Er zijn geen extra dependencies voor nodig en de stappen zijn gedekt door unittests. Ontbreekt of faalt een afbeelding, dan valt het spel terug op de eenvoudige vormen: de speelbaarheid en de botsingsvakken veranderen nooit mee.

### Spelers

Elk uiterlijk heeft zijn eigen spritesheet in `public/art/sprites/<uiterlijk>.png`: een strip van vier plaatjes naast elkaar, altijd in deze volgorde.

| Plaatje | Wanneer je het ziet      |
| ------- | ------------------------ |
| 1       | Stilstaan                |
| 2       | Stap met het ene been    |
| 3       | Stap met het andere been |
| 4       | Springen                 |

Lopen wisselt af tussen stap, stilstaan, andere stap, stilstaan. Dat leest als een looppas met een plaatje minder, en hoe harder je loopt hoe sneller de stappen gaan. Zodra je van de grond bent, zie je het springplaatje.

Beide kinderen spelen hetzelfde jongetje; wie wie is zie je aan de naam erboven en de gekleurde vlek onder de voeten. Kiezen jullie hetzelfde uiterlijk, dan zien jullie er dus hetzelfde uit. Dat mag: de naam en de kleur blijven verschillen.

De vier poses komen als een blokje van 2x2 uit de Layer MCP (`assets/source/poses-<uiterlijk>.png`). Het script zoekt de poses op aan hun eigen omtrek in plaats van op een raster te vertrouwen, gooit de schaduw weg die het model er toch onder zet, schaalt alle vier met dezelfde factor en zet ze op dezelfde vloer. Daardoor blijft het jongetje precies even groot terwijl hij loopt.

Geluid en muziek worden in de browser zelf gemaakt met de Web Audio API, omdat deze Layer-werkruimte geen audiomodel heeft. Er wordt niets gestart voordat de speler iets aanraakt of indrukt, en geluid en muziek hebben aparte knoppen die hun stand onthouden.

## Werelden en liften

Er zijn zes werelden en ze spelen echt anders:

| Wereld        | Waar het om gaat                                                      |
| ------------- | --------------------------------------------------------------------- |
| Strand        | De rustige wereld: een vlakke vloer met twee trappen van platformen.  |
| Bos           | Twee boomtrappen met stammen om je achter te verstoppen.              |
| Ruimteplaneet | Een gat in de grond met een krater als veilig eilandje in het midden. |
| Bouwplaats    | Een steiger tegen lange balken, met containers als dekking.           |
| Stad          | Een straat met twee daken die je alleen met de lift bereikt.          |
| Boot          | De kleinste wereld, voor een korte partij.                            |

Platformen houden je alleen tegen van boven. Je kunt er dus van onderaf doorheen springen en er bovenop landen; je stoot nooit je hoofd tegen een platform en je blijft er ook niet met je schouder tegenaan staan. De vloer en de dingen om je achter te verstoppen zijn wel gewoon massief.

In de stad staan liften. Een lift gaat altijd naar de lift met dezelfde naam, en die naam staat er bij, dus je ziet waar je uitkomt zonder een menu. Ga op de lift staan en druk op Actie. Staat de andere speler precies op de uitgang, dan kom je er netjes naast te staan; is er helemaal geen plek, dan blijf je staan en kun je het meteen opnieuw proberen.

Een kist open je door op de kist zelf te tikken. Zodra er een gele ring om de kist staat, is hij binnen bereik en doet een tik zijn werk; een tik ergens anders in het speelveld doet niets. De Actie-knop blijft ook gewoon werken, en is nog steeds de manier om een lift te nemen of een wapen van de grond te pakken.

Op elke knop staat een plaatje naast het woord: een pijl omhoog voor springen, een knal voor aanvallen, een schild voor blokkeren, een hand voor Actie en twee pijlen voor wisselen. Zo herkent een kind dat nog niet leest de knop aan het plaatje. De plaatjes zitten in de pagina zelf en kunnen dus niet los van het spel wegvallen.

Boven het speelveld staat steeds een korte tip, en niet meer dan een. De tip verdwijnt zodra je de knop een keer gebruikt hebt en komt daarna niet meer terug, ook niet in een volgende wedstrijd. Een kist of een lift binnen bereik gaat altijd voor.

## Testmodus

Voeg `?test=1` toe aan de URL om alleen te spelen zonder een tweede apparaat te koppelen:

```text
http://localhost:3000/?test=1        # jij bent Luca
http://localhost:3000/?test=senna    # jij bent Senna
```

De testmodus draait de volledige wedstrijd lokaal in de browser met dezelfde spelregels als de Durable Object: er wordt geen WebSocket geopend, geen koppeling gebruikt en geen gedeelde state gelezen of geschreven. Een echte wedstrijd kan er dus niet door beinvloed worden.

In het testpaneel kies je de speler, het gedrag van de oefenpop (Stilstaan, Achtervolgen, Wegrennen of Terugvechten), een wapen om te proberen (vuisten, zwaard, klein zwaard of blaster) en start je opnieuw. De testmodus werkt ook op een gedeployde omgeving, bijvoorbeeld om besturing en snelheid op een iPad te proberen.

## Omgevingen

`wrangler.toml` definieert geïsoleerde development-, preview- en production-workers. Deploy nooit zonder eerst de voorbeeld-origins te vervangen en de benodigde secrets met `wrangler secret put` te zetten. Vercel gebruikt dezelfde drie omgevingsnamen en aparte Redis-resources of key prefixes.

Benodigde variabelen staan in `.env.example`:

- `ADMIN_PIN`
- `SESSION_SIGNING_SECRET`
- `WORKER_INTERNAL_SECRET`
- `VITE_REALTIME_URL` (of `REALTIME_URL`; de sessie-API en de pairing-revocatie leiden hier allebei hun endpoint uit af)
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

## Deployen

Deploy altijd eerst de Worker en daarna de frontend, zodat een nieuwe spelversie nooit tegen een oudere server praat:

```sh
npx wrangler deploy --env preview      # of --env production
git push                               # Vercel bouwt automatisch
```

Een omgeving werkt pas volledig als deze variabelen in Vercel staan (naast de Upstash-variabelen die de integratie zelf zet):

- `ADMIN_PIN` - de pincode waarmee een volwassene een apparaat koppelt
- `SESSION_SIGNING_SECRET` - moet exact gelijk zijn aan het secret van de Worker
- `WORKER_INTERNAL_SECRET` - idem, voor het afmelden van een vervangen apparaat
- `REALTIME_URL` - de `wss://`-URL van de Worker van diezelfde omgeving

Ontbreekt `ADMIN_PIN`, dan weigert de koppelpagina elke pincode. Dat is veilig: niemand kan koppelen, maar spelen kan dan ook niet.

Controleer een gedeployde omgeving met:

```sh
npm run test:production
PRODUCTION_URL=https://... npm run test:production
```

Deze controle koppelt geen apparaat en raakt geen lopende wedstrijd aan.

## Controleren

```sh
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:e2e:webkit
npm run build
npm run check
```

`npm run check` controleert formatting, lint, unit- en integratietests, alle TypeScript-runtimes en de productiebuild. Browser-E2E staat apart omdat Playwright daarvoor Vite en Wrangler start. Installeer browsers eenmalig met `npx playwright install chromium webkit`.

Coverage voor de pure spelregels wordt geschreven naar `coverage/unit/` via:

```sh
npm run test:unit:coverage
```

## Een apparaat koppelen, vervangen of afmelden

Koppelen doet een volwassene eenmalig per iPad:

1. Open de productie-URL op de iPad.
2. Kies Luca of Senna.
3. Vul de `ADMIN_PIN` in en druk op **Dit apparaat koppelen**.

Het apparaat bewaart daarna een eigen sleutel in een HttpOnly-cookie. De kinderen hoeven de pincode nooit te weten en na een herstart is het apparaat binnen enkele seconden weer klaar om te spelen.

Gaat een iPad kapot of wordt hij vervangen, koppel dan het nieuwe apparaat voor diezelfde speler en zet **Dit apparaat vervangen** aan. De oude sleutel vervalt op dat moment: die iPad wordt uit de wedstrijd gezet en kan niet meer meespelen tot hij opnieuw gekoppeld wordt.

Wil je alle apparaten in één keer afmelden, verander dan `ADMIN_PIN`, `SESSION_SIGNING_SECRET` of `WORKER_INTERNAL_SECRET` in Vercel en deploy opnieuw. Alle bestaande sessies vervallen dan meteen.

## Terugdraaien en opnieuw beginnen

De Worker en de frontend worden apart teruggedraaid, en altijd in deze volgorde: eerst de frontend naar de vorige versie, daarna de Worker.

```sh
npx vercel rollback <deployment-url>                        # frontend terug
npx wrangler rollback --env production                      # Worker terug
```

Een wedstrijd wordt bewaard met een schemanummer. Draait de Worker een nieuwer schema dan de bewaarde wedstrijd, dan gooit hij die wedstrijd weg en begint met een lege lobby; de gekoppelde apparaten blijven wel gekoppeld. Dat is bedoeld: een half ingelezen wedstrijd zou harten of kisten kunnen verzinnen. Voor de kinderen betekent het dat ze na een update opnieuw een wereld kiezen.

Een vastgelopen wedstrijd los je op door beide iPads te verversen. Helpt dat niet, deploy de Worker dan opnieuw: de kamer start dan leeg op.

## Als iets niet werkt

| Wat je ziet                          | Wat het betekent                                                | Wat je doet                                                                       |
| ------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| "Nog niet gekoppeld"                 | Dit apparaat heeft geen sleutel (of de secrets zijn veranderd). | Koppel het apparaat opnieuw met de pincode.                                       |
| "De beheerpincode klopt niet."       | Verkeerde pincode, of `ADMIN_PIN` staat niet in Vercel.         | Controleer `ADMIN_PIN` in de Vercel-omgeving en deploy opnieuw.                   |
| "Te veel pogingen."                  | Vijf pogingen binnen een minuut vanaf hetzelfde netwerk.        | Wacht een minuut.                                                                 |
| "Verbinding herstellen" blijft staan | De iPad krijgt geen WebSocket naar de Worker.                   | Controleer `REALTIME_URL` en of de Worker `/health` antwoordt.                    |
| "Even wachten op de ander"           | De andere speler is weg of heeft een slechte verbinding.        | Wacht, of ververs de andere iPad.                                                 |
| "Het spel loopt niet gelijk"         | De pagina is ouder of nieuwer dan de server.                    | Druk op **Spel opnieuw laden**; deploy anders eerst de Worker en dan de frontend. |
| Alles staat stil in beide iPads      | De wedstrijd is bevroren omdat één verbinding stil is.          | Wacht tot de verbinding terug is; beide spelers moeten daarna op klaar drukken.   |

Snel controleren of een omgeving gezond is:

```sh
curl https://<worker-host>/health     # omgeving, protocolVersion, schemaVersion
curl https://<app-host>/api/health    # status en apiVersion
```

Beide moeten hetzelfde `protocolVersion` melden als de frontend die je gedeployd hebt.

## Bekende beperkingen en spelwaarden

Wat versie 1 bewust niet doet:

- Er zijn precies twee spelers: Luca en Senna. Er is geen derde plek, geen publiek en geen toernooi.
- Liften staan alleen in de stad. De andere vijf werelden hebben ze niet nodig.
- Muziek is een eenvoudig loopje dat in de browser zelf gemaakt wordt, omdat er geen audiomodel beschikbaar was. Geluid is nooit nodig om te weten wat er gebeurt: alles staat ook in beeld en in tekst.
- Een wedstrijd wordt niet bewaard over een update heen. Draait de Worker een nieuwer schema, dan begint de kamer leeg; de koppeling van de iPads blijft wel staan.
- De verbinding bevriest de wedstrijd voor beide spelers zodra één kant stil valt. Dat is opzet: anders zou een slechte verbinding een voordeel worden.
- Er is geen scherm om waardes aan te passen. De spelwaardes staan in `src/game/config.ts` en veranderen alleen door een nieuwe deploy.

De spelwaardes zoals ze nu staan:

| Wat                    | Waarde                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| Simulatie              | 30 ticks per seconde, 15 snapshots per seconde                      |
| Harten                 | 10 per speler                                                       |
| Rennen                 | 360 eenheden per seconde, 1,25 keer zo snel met Snelheid            |
| Springen               | impuls 760, zwaartekracht 1900 (springt ongeveer 152 eenheden hoog) |
| Vuisten                | bereik 48, 1 schade, 700 ms tussen slagen                           |
| Zwaard                 | bereik 90, 2 schade, 650 ms                                         |
| Klein zwaard           | bereik 64, 1 schade, 500 ms                                         |
| Blaster                | 6 pijltjes, 1 schade, 450 ms                                        |
| Zwaard gooien          | 500 ms opladen, komt na 8 seconden terug bij de eigenaar            |
| Blokkeren              | 1 schade minder van voren, 40 procent langzamer lopen               |
| Kisten                 | eerste na 8 seconden, daarna elke 12 seconden, maximaal 2 tegelijk  |
| Inhaalkist             | elke derde kist terwijl iemand 3 harten of meer achterstaat         |
| Schild                 | houdt 3 schade tegen                                                |
| Camouflage en Snelheid | 8 seconden                                                          |
| Lift                   | 1,5 seconde wachten voor dezelfde speler opnieuw mag                |
| Veilig na terugkomen   | 1,5 seconde                                                         |
