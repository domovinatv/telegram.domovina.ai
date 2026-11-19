# scripts/provision — Telegram kanal po podcastu (MTProto)

Bot API **ne može stvoriti ni grupu ni kanal**. Zato kanal podcasta stvara ovaj
provisioner, korisničkom MTProto sesijom **zasebnog Domovina Telegram računa**
(ne osobnog). Bot domovina.ai (`TG_BOT_USERNAME`) postaje admin, a objavljuje
Worker `telegram.domovina.ai` kroz Bot API.

Po podcastu nastaju dva objekta: **kanal** za objave (poglavlja) i povezana
**grupa za raspravu** (komentari ispod svake objave). Mapiranje
`YouTube channel_id → chat` sprema se u KV Workera (`tg:podcast:<UC…>`); token
Workera čita iz `.dev.vars` u korijenu repoa.

Podrijetlo: `domovinatv/novcanik-comms/provision/` (srpanj 2026., GramJS),
arhiva na `/Volumes/DOMOVINA2TB/git/`. Prebačeno na
[`teleproto`](https://github.com/sanyok12345/teleproto) jer je GramJS arhiviran
14.07.2026. Istraživanje i odluke:
`fetch.domovina.tv/docs/2026-11-19-telegram-grupa-po-kanalu.md`.

## Sigurnost

- `.env` (TG_SESSION) je ekvivalent lozinke računa. Gitignoran, nikad u repo.
  Opoziv: Telegram → Settings → Devices.
- `teleproto` (i njegov nativni `cifrante`) dobiva punu sesiju. Verzije su
  **točno pinane** (bez `^`), `package-lock.json` je commitan, a nadogradnja ide
  namjerno, uz pregled diffa paketa.

## Jednom

```sh
cd scripts/provision
npm ci
cp .env.example .env    # TG_API_ID/HASH s my.telegram.org, TG_BOT_USERNAME
npm run login           # interaktivno: broj Domovina računa → kod → 2FA; ispiše TG_SESSION
```

## Kanal za podcast

```sh
npm run create-channel -- <UC…> --name "Podcast" \
  --avatar https://cdn.domovina.ai/registry/avatars/<slug>.jpg [--public <username>] [--dry-run]
```

Nazive slaže `src/naming.ts`: „Podcast 🇭🇷” + „Podcast 🇭🇷 · rasprava”.

Engleski par istog podcasta (zaseban pristanak):

```sh
npm run create-channel -- <UC…> --lang en --name "Podcast" \
  --avatar https://cdn.domovina.ai/registry/avatars/<slug>.jpg --dry-run
```

Nazivi „Podcast 🇬🇧” + „Podcast 🇬🇧 · discussion”, engleski opis; mapiranje ide u
`tg:podcast:<UC…>:en` (`PUT …?lang=en`).

Ako mapiranje za `<UC…>` (na tom jeziku) već postoji, skripta ga samo ispiše (nema duplikata).
Pokreće se jednom, ručno, kad podcast pristane: postojanje kanala je zapis
pristanka. Od tada epizode u kanal šalje `domovina-push` kroz Worker.

## Preimenovanje postojećeg para

```sh
npm run rename-channel -- <UC…> --name "Podcast" [--lang en] [--about] --dry-run
```

Isto pravilo iz `src/naming.ts`; mijenja samo nazive (i uz `--about` opis), kanal ostaje.
Nakon ~6 promjena zaredom Telegram vrati `FLOOD_WAIT` (~11 min): pričekaj i ponovi.

## Limiti (provjeriti na prvom stvarnom računu)

- ~500 kanala+grupa po računu → ~250 podcasta (dva objekta po podcastu).
- ~10 javnih `@username` po računu (20 uz Premium); default je privatni invite link.
- `FLOOD_WAIT` kod brzog stvaranja: provisioner stvara jedan podcast po pozivu.
