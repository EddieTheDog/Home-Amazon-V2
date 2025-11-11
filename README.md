# home-amazon (Demo)

A small server-rendered Node.js reservation & package tracking demo app. Designed to deploy on Render (free tier) quickly using a JSON file DB.

## What you get
- Customer reservation form → reservation ID + QR (tracking page)
- Front desk UI: lookup, assign tracking, print barcode label
- Store dashboard: move to loading, mark ready
- Driver UI: claim, deliver (text or photo)
- Simple JSON file persistence (`data/db.json`)
- Server-side QR (qrcode) and barcode generation (bwip-js)

## How to deploy on Render (web UI only)
1. Create a GitHub repo (name it `home-amazon`) and add the files in this repo via **Add file → Create new file**.
2. Sign into Render (https://render.com) and connect GitHub.
3. Create a new **Web Service**:
   - Select the `home-amazon` repo and `main` branch.
   - Environment: **Node**
   - Plan: **Free**
   - Build Command: `npm install`
   - Start Command: `node server.js`
4. Add environment variables in Render service settings:
   - `SESSION_SECRET` — random string
   - `FRONT_DESK_PASS` — e.g. `frontdesk`
   - `STORE_PASS` — e.g. `store`
   - `DRIVER_PASS` — e.g. `driver`
5. Deploy. After the first deploy, open the service URL.

## Important notes about persistence
- This demo stores data in `data/db.json` on the instance filesystem.
- On Render, files can be ephemeral: redeploying or scaling may reset the file. This is fine for demos but **not** recommended for production.
- For production, switch to a managed DB (Postgres on Render, or any hosted DB) and update `server.js` to persist to that DB.

## Pages
- `/` — Reservation form
- `/track/:id` — Public tracking page
- `/login?role=frontdesk` — Login for front desk
- `/login?role=store` — Login for store
- `/login?role=driver` — Login for drivers
- `/desk` — Front desk UI (login required)
- `/store` — Store dashboard (login required)
- `/driver` — Driver portal (login required)

## API Endpoints (summary)
- `POST /api/reservations` — create reservation `{ itemDescription, customerName?, customerContact?, weightEstimate? }` → returns `{ id, qrUrl }`
- `GET /api/reservations/:id` — get reservation object
- `POST /api/reservations/:id/assign-tracking` — (frontdesk) `{ trackingNumber?, storageLocation?, frontDeskTags? }`
- `GET /api/reservations/:id/label` — (frontdesk) printable barcode label HTML
- `POST /api/reservations/:id/move-to-loading` — (store)
- `POST /api/reservations/:id/mark-ready` — (store)
- `POST /api/reservations/:id/claim` — (driver)
- `POST /api/reservations/:id/deliver` — (driver) form-data with `proofPhoto` or JSON `{ proofType:'text', proofValue:'...' }`
- `GET /api/reservations?status=stored` — list filter

## Testing checklist (do this after deploy)
1. Create reservation at `/` — note reservation ID (Rxxxxx) and tracking URL.
2. Open `/login?role=frontdesk` and login with `FRONT_DESK_PASS`. Open `/desk`, load the reservation ID, assign tracking & print label.
3. Open `/login?role=store` and check `/store`, move to loading / mark ready.
4. On phone, open `/login?role=driver`, load by tracking number, claim, and deliver (text/photo).
5. Confirm `/track/:id` reflects status events in near-real time.

## To switch to a persistent DB later
- Use Postgres (Render Managed Postgres) and update `server.js` to use `pg` or an ORM (knex/sequelize) and remove JSON file read/write.

## Security
- This demo uses simple role passwords from environment variables. For production, implement proper user accounts and strong auth.

---

If you'd like, I can now:
- (A) create a ZIP of these files and provide it, or
- (B) convert persistence to SQLite instead of JSON before you deploy, or
- (C) generate the exact GitHub Web-UI paste sequence (file names + copy contents) to make adding them faster.

Tell me which (A/B/C) you prefer, or indicate any change (like using `sqlite3` instead of JSON). I'm ready to produce the code variations immediately.
