# Fieldhouse

Fieldhouse is a sports academy desk for players, attendance, matches, and readiness. The public repository name is up to the team owner; this local project does not create or connect a remote repository.

Competition app: [Open Fieldhouse](https://vibe-coding-challenge-2-0-cp-0.vercel.app/)

## What the app supports

- The first coach creates the academy workspace and coach account in one step. Athlete records include age, student ID, class or year, sport, and team.
- Coaches add teams and staff accounts, then assign coaches to teams. Coaches can manage athletes, attendance, matches, and scores only for teams assigned to them.
- Athletes can have an optional sign-in and only see their own records.
- Scouts see only athletes who meet the readiness rule.
- Each new session starts with every rostered athlete marked Absent. Coaches can mark the whole roster at once, adjust individual records, and close the session to lock the official register.
- Every match is linked to one exact closed attendance register. A score can be saved only for an athlete marked Present in that register.
- Trial readiness means at least 75% attendance and scores recorded in at least two matches. Exactly 75% qualifies.
- Each record is entered in its own field, including a player’s sport and a match’s date and sport. The server checks that the values agree with the selected team and closed register.
- Related writes are saved together in one database transaction.

## Run it locally

Use Node.js 20.9 or newer.

1. In MongoDB Atlas, create a database user with read/write access to this app’s database. Allow your current laptop IP in the project’s Network Access settings.
2. Copy the example environment file to a private local file:

   Copy-Item .env.example .env.local

3. In .env.local, set MONGODB_URI to your Atlas connection string, MONGODB_DB to an explicit database name, and AUTH_SECRET to a private random value of at least 32 characters. Generate one in PowerShell with: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))". Keep .env.local private; Git ignores it. The app will not silently choose a database if MONGODB_DB is missing.
4. Install packages and start the app:

   npm install
   npm run dev

5. Open http://localhost:3000/login, choose “Create an academy,” and make the first coach account. That coach can create teams, add athletes, and create coach or scout accounts.

The app does not contain demo records by default. To create a separate demo workspace, set FIELDHOUSE_SEED_DEMO=true and the coach, scout, and player demo email/password values in .env.local, use a database name containing “demo,” and run npm run seed:demo. The seed is disabled in production. Do not use a real student database for demo data.

## Checks

Run the focused route behavior tests, lint, and TypeScript checks with:

```sh
npm test
npm run lint
npm run typecheck
```

## Environment values

| Name | Used for |
| --- | --- |
| MONGODB_URI | Private MongoDB Atlas connection string |
| MONGODB_DB | Database name for this environment |
| AUTH_SECRET | Signs the HTTP-only login cookie |
| FIELDHOUSE_SEED_DEMO | Explicit opt-in for local demo seeding |
| DEMO_COACH_*, DEMO_SCOUT_*, DEMO_PLAYER_* | Demo-only role accounts |

Never use a NEXT_PUBLIC_ prefix for server secrets. Use different database names and AUTH_SECRET values for development, preview, and production.

## Deploy to Vercel

1. Push this local project to the GitHub repository you already own.
2. In Vercel, import that existing repository and create a project.
3. Add MONGODB_URI, MONGODB_DB, and AUTH_SECRET to the Vercel project’s server-side environment variables. Keep the production database separate from local and preview data.
4. Deploy, open the assigned live URL, and create the first coach and academy at /login.
5. In MongoDB Atlas, configure Network Access so the deployed Vercel app can reach the cluster. Use the narrowest allowlist that works for the chosen Vercel plan and deployment setup.

Atlas accepts connections only from IPs on the project access list. Vercel uses dynamic outbound IPs by default; stable egress is a separate networking feature. For a competition demo, use a dedicated demo database and a strong database password. Do not put real student records behind a broad Atlas allowlist. For official use, arrange stable egress or private networking and your institution’s privacy review before onboarding students. See [Atlas network access](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/) and [Vercel outbound IP guidance](https://vercel.com/kb/guide/how-to-allowlist-deployment-ip-address).

No Codex plugins are required for the app itself. It uses the MongoDB Node.js driver, Next.js, and standard Vercel deployment settings.

## Data and access

- Database reads and writes are scoped to the signed-in academy.
- Passwords are bcrypt hashes. Login uses a signed, HTTP-only, same-site cookie that is secure in production.
- Role checks happen in API routes; hiding a screen in the browser is not treated as access control.
- Coach access is checked against each team’s assigned coaches in the API.
- Match eligibility checks use the exact linked attendance register, not a date-only match.
- Keep the roster limited to details needed for sports administration. Do not add medical, guardian, or other sensitive student information without an approved privacy process.
