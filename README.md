# telegram.domovina.ai

Telegram kanal po podcastu za [domovina.ai](https://domovina.ai). Podcast koji
pristane dobiva vlastiti Telegram **kanal** (jedna objava po novoj epizodi) i uz njega
povezanu **grupu za raspravu**: sva poglavlja epizode su komentari ispod njene objave,
svaki s linkom točno na taj trenutak na domovina.ai. Bot je
[@domovina_push_bot](https://t.me/domovina_push_bot).

Iza kanala stoji domovina.ai: vlastiti bot, vlastiti Telegram račun, vlastiti
Worker. Nijedan link ne vodi na YouTube.

Kad se epizoda javlja odlučuje **[`domovina-push`](https://github.com/domovinatv/domovina-push)**,
glavni usmjerivač obavijesti domovina.ai (postavke kanala, tihi sati, spremnost, bez
duplikata). Ovaj repo je njegov **Telegram dostavljač**.

```mermaid
flowchart LR
  P["domovina-push<br/>cron */10, usmjerivač"] -->|"FCM teme"| F["aplikacija"]
  P -->|"RPC publishEpisode"| T["telegram-domovina-ai<br/>TelegramPublisher"]
  T --> K[("KV tg:podcast:UC…")]
  T --> W["Workflow PublishEpisode<br/>objava + poglavlja u komentarima, pauza 3 s"]
  W --> R[("R2 data/id/episode.json")]
  W --> C["Telegram kanal podcasta"]
  V["podcast pristane"] --> M["scripts/provision na Macu<br/>MTProto: kanal + grupa"]
  M --> K
```

## Dijelovi

| Gdje | Što |
|---|---|
| `src/publisher.ts` | RPC `TelegramPublisher.publishEpisode`: ima li podcast kanal, je li epizoda novija od kanala, pokreni Workflow (id `ep-<video>-<UC>`, nikad dvaput) |
| `src/workflow.ts` | Workflow `PublishEpisode`: čita `episode.json` iz R2, objavi epizodu u kanal, pričeka nit (korak „nit”) pa pošalje poglavlja tiho kao komentare; svaki korak memoiziran |
| `src/threads.ts` | webhook hvata objavu koju Telegram proslijedi u grupu za raspravu → KV `tg:thread:<kanal>:<objava>` |
| `src/index.ts` | HTTP: mapiranje (provisioner), javni `{title, link}`, ručno pokretanje, webhook bota |
| `scripts/provision/` | MTProto provisioner ([teleproto](https://github.com/sanyok12345/teleproto)), jer Bot API ne može stvoriti kanal ni grupu |

## Pristanak = stvaranje kanala

Kanal nosi ime tuđeg podcasta, pa nastaje **samo kad podcast pristane**, i tada se
stvara jednom, ručno: `scripts/provision` → `npm run create-channel`. Postojanje
kanala JE zapis pristanka; nema zasebne zastavice. Ime je „<Podcast> · domovina.ai”.
U kanal idu samo epizode objavljene od dana stvaranja kanala. Vlasnik koji u
postavkama kanala isključi `push_notifications` (ili povuče kanal) utišava i Telegram.

Odluka i prvi kanal: [docs/2026-11-19-poglavlja-u-komentarima-i-prvi-kanal.md](docs/2026-11-19-poglavlja-u-komentarima-i-prvi-kanal.md).

## API

| Ruta | Auth | Što |
|---|---|---|
| `GET /` | – | zdravlje |
| `GET /public/podcasts/{UC…}` | – | `{title, link}` za gumb „Pridruži se” (CORS, 5 min cache) |
| `GET /podcasts/{UC…}` | bearer | puno mapiranje |
| `PUT /podcasts/{UC…}` | bearer | upis mapiranja (provisioner) |
| `POST /podcasts/{UC…}/episodes/{videoId}` | bearer | ručno pokreni objavu (test prvog kanala) |
| `POST /telegram/webhook` | `X-Telegram-Bot-Api-Secret-Token` | Telegram: proslijeđena objava → nit poglavlja |
| `POST /telegram/setup` | bearer | postavi webhook bota na ovaj Worker (jednom, i nakon promjene tajne) |
| RPC `TelegramPublisher.publishEpisode` | service binding | `{videoId, youtubeChannelId, date}` → `started` / `exists` / `no_channel` / `before_channel` |

## Postavljanje

```sh
npm ci && npm test && npm run typecheck
cp .dev.vars.example .dev.vars          # API_TOKEN, TELEGRAM_WEBHOOK_SECRET (openssl rand -hex 32), TELEGRAM_BOT_TOKEN
npx wrangler secret put API_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
# nakon deploya: curl -X POST -H "Authorization: Bearer $API_TOKEN" https://telegram.domovina.ai/telegram/setup
npx wrangler secret put TELEGRAM_BOT_TOKEN
npm run deploy                          # PRIJE domovina-push (service binding)

cd scripts/provision && npm ci && npm run login   # zaseban Domovina Telegram račun
```

## Licenca

MIT
