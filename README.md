# Botricello Home — sito e gestionale (versione 1)

Sito vetrina bilingue IT/EN, preventivi automatici, salvataggio richieste D1 + apertura WhatsApp, calendario admin, prezzi mensili, tariffe per date/periodi, sconti per durata, conferma/rifiuto richieste e blocchi manuali. Zero librerie frontend e nessun servizio di pagamento.

## Prima di pubblicare

1. **Questa è una versione test, non ancora pronta per raccogliere dati di clienti reali.** Completa l'informativa privacy (la pagina attuale è volutamente una bozza); verifica gli obblighi per la locazione, CIN e dispositivi di sicurezza prima di attivare gli annunci.
2. Crea un progetto Cloudflare Pages e un database D1 chiamato `botricello-home`.
3. Apri `wrangler.jsonc` e sostituisci `REPLACE_WITH_YOUR_D1_DATABASE_ID` con l'ID D1.
4. Collega il progetto Pages al repository GitHub: **build command vuoto**, **output directory `public`**, **root del progetto `/`**. Il progetto usa `functions/api/[[path]].js` (Pages Functions) e D1 binding `DB`.
5. In Pages → Settings → Bindings, collega il database D1 alla variabile `DB`; pubblica nuovamente dopo il collegamento.
6. Inizializza il database con `schema.sql` dalla dashboard D1 oppure con `npm run db:remote` (potrebbe chiedere conferma).
7. In Pages → Settings → Variables and Secrets configura **due segreti**, `ADMIN_PASSWORD` (password lunga e unica, mai nel repository) e `ADMIN_SALT` (stringa casuale lunga, stabile nel tempo). Non usare una password di test in produzione. Dopo modifiche ai segreti ripubblica il progetto.
8. Apri `/admin.html` per accedere; cambia prezzi, testi e immagini da URL HTTPS. Le immagini reali non sono ancora caricate: il sito usa segnaposto, non immagini false.
9. Prima di condividere il sito con clienti: testa login, preventivi, richieste, conflitti calendario, WhatsApp e visualizzazione da telefono.

## Sviluppo in locale

- `npm install`
- crea il database D1 su Cloudflare e inserisci il suo ID in `wrangler.jsonc`.
- `npm run db:local`
- crea un file `.dev.vars` **non committato** con `ADMIN_PASSWORD="una-password-lunga"` e `ADMIN_SALT="un-sale-casuale-lungo"`.
- `npm run dev` e apri `http://localhost:8788` e `/admin.html`.

## Regole economiche

- Le tariffe base sono importi **esemplificativi**, da modificare nell'admin.
- Le tariffe specifiche sono inclusive di entrambi i giorni selezionati. Il checkout della prenotazione è escluso dal conteggio delle notti.
- Prezzo uguale da 1 a 4 ospiti, soggiorno minimo una notte, pulizia finale inclusa.
- Uno sconto attivo con la soglia più alta soddisfatta viene applicato al totale.
- La prenotazione non è confermata finché il gestore non cambia stato.
- L'apertura di WhatsApp non dimostra l'invio del messaggio.

## Limiti attuali e miglioramenti successivi

- Non c'è un caricamento diretto delle immagini: in admin si inseriscono URL HTTPS di fotografie ospitate altrove.
- Non c'è invio automatico WhatsApp né email; l'operatore invia il messaggio aprendo WhatsApp.
- Nessun sincronizzatore Booking/Airbnb, nessuna integrazione di pagamento, nessun sistema automatico di documentazione ospiti.
- Le richieste sono memorizzate senza pulizia programmata: implementare una policy di cancellazione dei dati e controlli GDPR prima del lancio reale.
- Un blocco manuale va inserito solo su date non già confermate (la UI amministrativa non offre ancora un controllo preventivo sui blocchi).
- Le sessioni sono limitate a 8 ore; per un uso pubblico sensibile valutare ulteriori difese anti-bot e limitazione del tasso delle richieste. Il login ha una protezione di base contro i tentativi ripetuti.

## Albero file

- `public/index.html`, `public/style.css`, `public/site.js`: sito pubblico
- `public/admin.html`, `public/admin.js`: pannello riservato
- `functions/api/[[path]].js`: API Cloudflare Pages Functions
- `schema.sql`: struttura D1 e dati di esempio (eseguire una sola volta su database vuoto)
- `public/privacy.html`: modello da completare

## Struttura essenziale

Solo due cartelle necessarie a Cloudflare Pages: `public/` (sito e admin) e `functions/` (API). `schema.sql` è nella radice e inizializza D1. Nessuna cartella `node_modules`, `dist`, `build` o duplicata è inclusa.
