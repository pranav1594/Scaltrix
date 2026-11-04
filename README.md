# Scaltrix Finance Manager (Step 1: Foundation)

React + TypeScript + Vite front end, Supabase (database, auth, file storage), Tauri desktop shell for Windows.

## What is in this step
- `src/engine/` the calculation engine (integer paise and basis points, no floating-point errors)
- `tests/engine.test.ts` 23 tests that reproduce every worked example in the calculation documentation
- `supabase/migrations/0001_init.sql` tables, row-level security, reserve guards, audit log, 8 private storage buckets
- Login, Dashboard, Settings (all rules editable) and a live Split Calculator
- `.env.example` for your Supabase keys and bucket names

## Setup on Windows (PowerShell)

### 1. Unzip and install
```powershell
cd path\to\scaltrix
npm install
```

### 2. Create the database (once)
1. Open your Supabase project, then **SQL Editor, New query**.
2. Open `supabase\migrations\0001_init.sql`, copy everything, paste it in, click **Run**.
3. It should finish with "Success". Check **Storage**: you should see 8 buckets.

### 3. Add your keys
```powershell
copy .env.example .env
notepad .env
```
Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings, API Keys). Leave `SUPABASE_SERVICE_ROLE_KEY` empty for now. Never share the `.env` file.

### 4. Run the tests and the app in the browser
```powershell
npm test
npm run dev
```
Open http://localhost:1420, sign in with the user you created in Supabase, go to **Settings**, enter your founders and real weights (they must total 100%), then press **Save settings**. Try the **Split Calculator**.

### 5. Wrap it as a Windows desktop app (Tauri)
Run once:
```powershell
npx tauri init
```
Answer the prompts:
| Prompt | Answer |
|---|---|
| App name | Scaltrix |
| Window title | Scaltrix |
| Web assets location | ..\dist |
| Dev server URL | http://localhost:1420 |
| Frontend dev command | npm run dev |
| Frontend build command | npm run build |

Then:
```powershell
npm run tauri dev      # opens the desktop window (first run compiles Rust, takes a few minutes)
npm run tauri build    # creates the .msi / .exe installer under src-tauri\target\release\bundle
```

## Security notes
- `.env` is in `.gitignore`. Do not upload it anywhere.
- Only the anon key goes in `.env` for the app. The service-role key must never be used in React code.
- Supabase sign-ups should stay disabled. Add each founder under Authentication, Users.
- Reserve expenses and product costs cannot be saved without an attached bill (enforced by the database).
- The reserve ledger is append-only: fix mistakes with an adjustment entry, not by editing.

---

## Step 3 update: Projects, Employees, Payments, Extra Payouts

### Do this once after unzipping over your existing folder
1. Supabase, SQL Editor, New query: paste `supabase\migrations\0002_projects_functions.sql`, click **Run**.
   (Do NOT re-run 0001. It was already applied.)
2. Keep your existing `.env`. Copy over the new files (or unzip into a new folder and copy your `.env` into it).
3. `npm install` then `npm test` (26 tests) then `npm run dev`.

### Try this flow
1. **Settings**: make sure your founders and weights are saved (total 100%).
2. **Employees**: add your team.
3. **Projects**: create a project (name, client, agreed price).
4. On the project page: add employees, give each a score, **Save team**.
5. **Record payment** (attach proof). You see a preview first. The reserve, founders and employees are updated together.
6. Record a second payment later: the split is recalculated on the total received, using the rules saved on the project.
7. In the team table use **Give extra** on an employee. Track deductions on **Extra Payouts**.

### Notes
- Reserve ledger screen, View Bill for spending, and founder advances come in the next step.
- "View proof" opens files in your browser window. The desktop (Tauri) build needs a small opener plugin, which we add when packaging.

---

## Step 4 update: PDFs, Add invoice, project calculator, dashboard

**No new database script this time.** Just unzip over your folder (keep your `.env`), then:
```powershell
npm install      # adds the PDF library
npm test         # 33 tests
npm run dev
```

### What's new
- **Projects, Add invoice** button: opens a panel to (a) generate the project's settlement statement as a PDF and add it to the project, or (b) upload an existing invoice file. Each generated statement carries a revision number.
- **Split Calculator, Project** selector: calculate on a real project's team and saved rules. Choose to calculate on total received, agreed price, or a custom amount. Team scores can be edited for what-ifs (the project is never changed).
- **Split Calculator, Generate PDF**: exports exactly what you see. **Save PDF to project** also files it in the project's documents.
- **Extra payouts**:
  - Project team table shows any extra still owed by that employee, with a **Deduct ₹X now** button (next installment, the full amount, or the agreed % of their share on that project).
  - The calculator and PDFs show extra given, recovered and outstanding per employee.
  - The **Dashboard** shows totals given, recovered and outstanding, who owes the company, the latest extras, and projects with money left to collect.

### Notes
- PDFs embed the DejaVu Sans font (free licence) so the rupee sign prints correctly.
- Generated PDFs download through the browser. In the Windows installer build, saving files to disk needs a small Tauri plugin, which we add at packaging time.
- Settlement statement sections for bonds/referrals will be added when the Bonds module exists.

---

## Step 5 update: client invoices, founder extras, reserve bills, logo, dark mode

### Do this once (there IS a new database script this time)
1. Supabase, SQL Editor, New query: paste `supabase\migrations\0003_invoices_extras_bills.sql`, click **Run**.
   (Do NOT re-run 0001 or 0002. Your existing data is kept.)
2. Unzip over your folder, keep your `.env`.
3. `npm install` then `npm test` (37 tests) then `npm run dev`.

### What's new
- **Projects, Client invoices, Add invoice**: record an invoice you raised for the client. The form shows the project, client, price, received and already-invoiced amounts. Enter number (next one is suggested), dates, amount, status (Draft, Sent, Paid, Cancelled) and optionally attach the invoice file. A saved invoice without a file shows **Attach file**. The **Settlement statement** PDF is now its own section and lists the invoices.
- **Extra Payouts**: a form at the top records an extra for an **employee or a founder/shareholder**, optionally linked to a project, with the recovery plan (one-time, installments, or % of future project shares). The usual share is optional, only needed to show the extra as a %. Founders' extras also appear on the project page and Dashboard, with **Deduct now**.
- **Reserve and Bills** (new page): add spending from the reserve (date, amount, what for, category, paid to). Bills, screenshots or PDFs are **optional**, can be several per expense, and can be added later with **Add bill**. The reserve cannot go below zero and entries cannot be edited or deleted.
- **Logo** (your image): sidebar, login page, and the header of every PDF. To change it, replace `src/assets/logo.png` (and `logo-dark.png`, the light-text version for dark mode) with files of the same proportions.
- **Dark / light mode**: the toggle is at the bottom of the sidebar and on the login page. Your choice is remembered.

### Notes
- Reserve spending entered before this update that already had a bill keeps it.
- For the Windows installer we will also turn the logo into the app icon.

---

## Step 5b update: founder bonds and number fields

**No new database script.** Unzip over your folder (keep `.env`), then `npm install`, `npm test`, `npm run dev`.

- **Settings, Founders and rank weights**: each saved founder has a bond button.
  - No bond yet: **Upload bond** (PDF or image).
  - Bond uploaded: **View bond** opens it; **Replace** uploads a newer version. The old file is kept in storage and the newest one is shown.
  - A founder you have just added shows "Save settings to add a bond" until you press **Save settings**.
  - Files go to the private `bonds-founders` bucket, and each is recorded in the `bonds` table.
- **Number fields (whole app)**: clicking or tabbing into a number selects the old value, so typing replaces it (0 becomes 40, 40 becomes 0), and leading zeros never appear (no more "040"). Clicking again inside a field you are already typing in still places the cursor, so you can fix one digit.

---

## Step 6 update: per-project scoring methods and client bonds

### Do this once (new database script)
1. Supabase, SQL Editor, New query: paste `supabase\migrations\0004_scoring_and_tasks.sql`, click **Run**. (Do NOT re-run 0001 to 0003. Existing projects keep working and keep their typed scores.)
2. Unzip over your folder, keep your `.env`.
3. `npm install`, `npm test` (51 tests), `npm run dev`.

### Four scoring methods, chosen per project
Each project picks ONE method on its page (**Team and contribution**). Settings, Policies sets only the default for NEW projects (and the default blend for Weighted mix).

| Method | What you enter | Share of the employee pool |
|---|---|---|
| Manual rating | Rating 0-10 per person | rating / total of all ratings |
| Hours worked | Hours and a role weight (1 = normal, 1.5 = senior) | (hours x role weight) / total |
| Task points | Tasks with points, assigned to people, marked Done | done points / total done points |
| Weighted mix | All of the above plus the blend (default 40 / 40 / 20) | each part is compared as a percentage first, then blended |

- Weighted mix compares people by percentage, so ratings, hours and points can be on different scales. If nobody has data for one part, its weight is spread over the others and a note says so.
- Change the method or numbers, press **Save team**: the shares preview first. The employee pool total never changes (the database refuses it), only who gets what.
- Splits now use exact integer maths (6 decimals of score), so paise always add up.

### Client bond (for "pay part now, bring new clients for the rest")
On the project page, **Client bond**:
- Upload the signed bond (PDF or image) and record: amount covered by the bond, paid when signed, number of new clients required, deadline, and compensation if he fails (from Settings by default, editable per bond).
- Add each client he brings and tick **verified** once they have signed or paid.
- The box shows what happens if the bond closed today. Each verified client waives an equal part of the covered amount. If he fails, he owes the remaining part plus compensation. **Close bond** sets Fulfilled, Partial or Failed.
- Example: Rs 25,000 covered by 3 clients, 1 verified: Rs 8,333.33 waived, Rs 16,666.67 still due, plus compensation.
- The Dashboard lists open client bonds, and the settlement PDF includes the bond.

Note: compensation and waiver rules are the ones you described. Please check the numbers against your signed bond wording.
