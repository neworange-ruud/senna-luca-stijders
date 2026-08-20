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

In de stad staan liften. Een lift gaat altijd naar de lift met dezelfde naam, en die naam staat er bij, dus je ziet waar je uitkomt zonder een menu. Ga op de lift staan en druk op Actie. Staat de andere speler precies op de uitgang, dan kom je er netjes naast te staan; is er helemaal geen plek, dan blijf je staan en kun je het meteen opnieuw proberen.

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
