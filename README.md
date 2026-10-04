# Prozone.shop — Legal Digital Store

## Features
- Login / Register
- Product listing
- Cart / checkout
- BTC + LTC manual payment
- Manual admin order approval
- User dashboard
- Admin panel
- SQLite database
- Password hashing with bcrypt

## Local setup

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Change `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `BTC_ADDRESS`, and `LTC_ADDRESS`.
4. Run:
   ```bash
   npm install
   npm start
   ```
5. Open `http://localhost:3000`.

## GitHub + Render deployment

GitHub stores the source code. A Node/Express backend should be deployed on a server platform such as Render; GitHub Pages alone cannot run this backend.

1. Create a GitHub repository.
2. Upload this project (do not upload `.env` or `data/`).
3. On Render, create a Web Service from the GitHub repository.
4. Build command: `npm install`
5. Start command: `npm start`
6. Add the environment variables from `.env.example`.
7. For production, use persistent storage for SQLite or replace SQLite with a managed database.
8. Set `NODE_ENV=production`.

## Important production notes

- Change the default admin password before deployment.
- Use a long random `SESSION_SECRET`.
- Configure your own BTC/LTC addresses.
- Only sell lawful products/content you have the right to distribute.
- Manual crypto payments should be verified against the blockchain before approving an order.
- Do not store private keys, seed phrases, or wallet passwords in this app.
