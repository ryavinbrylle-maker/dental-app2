# School Dental App: Audit, Improvement and Redesign Report

**Date:** 20 October 2026
**Scope:** the whole app: the registration form, the dentist workspace (Students, Appointments, School Years, Student Record, Dental Examination) and the server API.
**Backup:** before any change, every file was copied to `backup-2026-10-20-before-redesign/`. Nothing in the database was deleted or migrated by this work.

---

## 1. Executive Summary

**Starting point.** The app already covered the core workflow well:
- QR registration;
- grade and section rosters with M/F student codes;
- a class appointment queue with an Absent container and late arrivals;
- a tooth-map exam with multiple conditions per tooth and drag-to-mark;
- offline saving with background sync;
- school-year archives and returning-student matching.

The weak points were:
- **Look:** each page had grown separately, with a black title on teal (poor contrast), light-grey labels below readable contrast, and no shared navigation. Moving between features meant hunting for buttons in a toolbar.
- **A hidden message bug:** pop-up messages such as "Saved on this device" and "Marked absent" were invisible on every page except the student list.
- **No unsaved-work protection:** leaving an examination with Back, Cancel or the menu silently threw away the marked teeth and notes.
- **Weak server checks on the public registration form:** malformed ages or birthdates caused server errors, and any amount of text was stored.
- **No security headers** on the website.
- **No real-time summary** for the dentist (how many students, how many examined, what is happening today).

**What was done**, all within the existing plain HTML/JS + Vercel + Neon setup (no new framework or dependency):
- **One design system:** colours, type, spacing, buttons, inputs, cards, tables and focus rings, applied to every page and meeting WCAG AA contrast.
- **A fixed top navigation bar:** Students · Appointments · School Years, with the current page highlighted, plus the school year, sync status and Log out.
- **A dashboard summary from real database numbers:** registered students, students examined, today's appointments and the latest examinations.
- **Exam-page safeguards:**
  - a "Discard this examination?" dialog for every way of leaving with unsaved work, including closing the tab;
  - double-tap protection on Save;
  - a colour key (legend) on the tooth chart;
  - the bottom tooth row can no longer hide behind the sticky Save bar on phones.
- **The pop-up message bug is fixed.**
- **Registration form:**
  - redesigned, with required-field markers;
  - inline, per-field error messages, with focus moved to the first problem;
  - a birthdate that cannot be in the future;
  - a single "Saving…" state that blocks double submission.
- **Server-side validation** of every registration field. Removed fields are no longer accepted from the public endpoint.
- **Security headers** through `vercel.json`.

**Result.** The app now looks and behaves like one product. Common jobs need fewer taps and less scrolling. Unsaved examinations can't be lost by accident. The public endpoint rejects bad input cleanly. Every change was tested in a browser on desktop and phone sizes; see section 8.

---

## 2. Issues Discovered

| # | Issue | Where | Why it was a problem | Severity | Type |
|---|---|---|---|---|---|
| 1 | Pop-up messages (toast) only appear on the student list | `Students.html` (the `#toast` element was inside `#dashboard`) | After saving an exam, marking absent or an upload result, the confirmation never showed. The dentist could not tell whether the action worked. | **High** | Confirmed defect |
| 2 | Leaving an exam discards work silently | `Dental.js` (Back, Cancel, menu, closing the tab) | One wrong tap lost all marked teeth and notes. | **High** | Confirmed defect |
| 3 | Public registration accepts unchecked values | `api/register.js` | A non-numeric age or invalid birthdate caused a 500 error. Unlimited text and arbitrary condition lists were stored. Removed fields (address, parent, etc.) could still be posted. | **High** | Confirmed defect / data-integrity risk |
| 4 | Bottom tooth row hidden behind the sticky Save bar on phones | Exam page | On a phone the lower teeth could sit under the Save/Absent bar, so touches hit the bar instead of the tooth. | Medium | Confirmed defect |
| 5 | Saved-row highlight could vanish | `Appointments.js` | If an upload finished just after returning to the list, the redraw removed the highlight, so the dentist lost track of where they were. | Low | Confirmed defect |
| 6 | Text below readable contrast | All pages (`--label: #7f8c88` ≈ 3.5:1; black on teal ≈ 3.7:1) | Hard to read in a bright clinic, and fails WCAG AA. | Medium | Accessibility |
| 7 | No consistent navigation or current-page indicator | Dentist page toolbar | Features sat in a mixed row of buttons, with no indication of which area was open. | Medium | UX |
| 8 | No overview of the day or the year | Dashboard | The dentist had to open each class to know progress. | Medium | Improvement |
| 9 | Tooth chart has no legend; colours only appear in marking mode | Exam page | New users could not tell what a colour meant. | Medium | UX |
| 10 | Absent Students box takes a lot of space even when empty | Appointments page | Pushed the queue further down, adding scrolling. | Low | UX |
| 11 | Registration form: generic error at the bottom, browser pop-ups, no required markers, low-contrast button text | `StudentReg.html` / `.js` | Parents and students could not see which field was wrong. | Medium | UX / Accessibility |
| 12 | No security headers (clickjacking, MIME sniffing, referrer) | Vercel config | The dentist page could be embedded in another site, and browsers were given no hardening hints. | Medium | Security risk |
| 13 | Record page shows "Weight: —" for every student | `Dental.js` | Weight is no longer collected, so it is clutter. | Low | Polish |
| 14 | Search box had no label for screen readers; no visible keyboard focus on many controls | Dentist page | Accessibility. | Low | Accessibility |

**Checked and fine (kept as is):**
- **No HTML injection:** student data is always inserted with `textContent`, never `innerHTML`.
- **Database safety:** all SQL uses parameterised tagged templates, so there is no SQL injection.
- **Login:** constant-time comparison plus a 1.5 s delay on a wrong password.
- **Dentist-only endpoints:** every dentist endpoint checks the signed token.
- **Codes and sorting:** student codes are validated on the client and the server, and unique per school year, grade and section.
- **Offline sync:** idempotent; no duplicates on retry.
- **Saving is not completion:** examination saving and appointment completion happen in one step, so an incomplete exam is never marked Completed.

---

## 3. Improvements Implemented

| Change | Files | Why | How it works | Benefit |
|---|---|---|---|---|
| **Top navigation bar** | `Students.html`, `Dental.js`, `Students.js` | Clear, consistent way around the app | The header holds the brand, the menu (Students · Appointments · School Years), the school year, the sync status and Log out. `show()` marks the current area (`.active` + `aria-current="page"`); the exam page belongs to the area it was opened from. The menu is hidden until login. | Always one tap to any area; you always know where you are. |
| **Dashboard summary** | new `api/stats.js`, `Students.js`, `Students.html` | Real overview without opening each class | `GET /api/stats?date=<today>` (dentist only) counts registered students, distinct students examined, examinations this year, today's appointments by status, and the 5 latest exams. The dentist's own date is sent so "today" is correct in the Philippines. The last result is kept on the device for offline viewing (labelled "Offline – summary from …"). It refreshes about once a minute and after uploads. | Progress at a glance. No numbers are invented: every figure is a database count. |
| **Unsaved-changes protection** | `Dental.js`, `Students.html` | Prevent lost examinations | A snapshot of teeth and notes is taken when the exam opens. Back, Cancel or the menu with changes opens "Discard this examination?" (**Keep editing** / **Discard changes**), and closing or reloading the tab triggers the browser's own warning. There's no question when nothing changed, after saving, or after choosing Absent. | No accidental loss of work. |
| **Double-save protection** | `Dental.js` | One exam per save | A `form.saving` flag ignores a second tap while saving; it's cleared again if saving fails. | No duplicate exams. |
| **Tooth-chart colour key** | `Dental.js`, `Students.html` | Explain colours | Every condition chip shows its colour dot and abbreviation (e.g. "Root Fragment (RF)"). The chips double as the legend and the marking-mode buttons, with `aria-pressed` for screen readers. | Colours are self-explanatory. |
| **Messages visible on every page** | `Students.html` | Bug #1 | The toast moved to the page body and got `role="status"` / `aria-live`. | The dentist sees "Saved", "Marked absent", upload results and so on, wherever they are. |
| **Sticky-bar overlap fix** | `Students.html` | Bug #4 | `scroll-padding-bottom: 96px` makes the browser keep scrolled-to teeth and fields above the sticky Save bar. | Every tooth can be tapped on a phone. |
| **Highlight survives a redraw** | `Appointments.js` | Bug #5 | The saved row keeps its highlight for 2.5 s even if the list is redrawn. | Easier to continue with the next student. |
| **Compact Absent box** | `Appointments.js`, `Students.html` | Less scrolling | When nobody is absent, the help text, filters and search are hidden and only the heading and "No students are marked absent" show. | The queue appears higher on the screen. |
| **Registration: inline validation** | `StudentReg.js`, `StudentReg.html` | Clear feedback | `novalidate` replaces browser pop-ups with messages under each field. Focus moves to the first problem, and a message clears as soon as its field is fixed. Required fields are marked with `*`, the birthdate can't be in the future (`max` = today), and Confirm shows "Saving…" and ignores a second tap. Success and error messages are coloured boxes. | Parents and students fix mistakes quickly. |
| **Registration: server validation** | `api/register.js` | Bug #3 | Birthdate: valid date, not in the future, within 30 years. Age: an integer 0–30, otherwise ignored. Conditions: only the 6 listed choices, without duplicates. Free text is limited to 300 characters. Removed fields are no longer stored from the public form. | No 500 errors from bad input, and no oversized or unexpected data. |
| **Security headers** | `vercel.json` | Issue #12 | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a restrictive `Permissions-Policy`, `noindex` on the dentist page and API, and `no-store` on the API. | Harder to embed or index; no caching of student data. |
| **Record page tidy-up** | `Dental.js` | Issue #13 | Weight is shown only for older records that have it. | Less clutter. |

---

## 4. UI/UX Improvements

**Design system** (a single token set in `Students.html`, mirrored in `StudentReg.html`):
- **Colours:**
  - primary teal `#0e6f7a`, hover `#0a5862`, soft tint `#e7f3f4`;
  - text `#1b2a2f`, muted `#566a70` (≈ 5.6:1 contrast, AA);
  - borders `#d5e0e2`, page background `#f4f7f8` with white surfaces;
  - semantic success, warning and danger colours, each with a soft background.
  - **Before:** an `#336e7b` header with **black** title text, and `#7f8c88` labels (≈ 3.5:1).
- **Typography:** DM Sans 400/500/700, a 15 px base with a clear hierarchy (page title 26 px, card title 18 px, upper-case 12.5 px labels for table headers and stat labels).
- **Shape and depth:** one radius scale (8 px controls, 10 px cards, 12 px dialogs) and one soft shadow for cards. **Before:** 2 px heavy borders, square inputs and mixed radii.
- **Buttons:** primary (teal), secondary (white with border), danger (red), success (green "Save & complete"), and disabled (55 % opacity with a not-allowed cursor). Every interactive element gets a visible 3 px teal focus ring for keyboard use.
- **Inputs:** 1 px border, 8 px radius, a teal focus ring, and readable placeholders.

**Navigation and layout:**
- **Header:** a sticky white header with the brand, menu and status. **Before:** a teal bar with a title, plus a toolbar of six mixed buttons (Appointments, School Years, Refresh, CSV, Log out).
- **Students page:**
  - a page title with a live count line;
  - the summary cards;
  - the search, Refresh and Download CSV toolbar;
  - the grade tabs and section cards from the previous update, now in the new style.
- **Page bars** (Student Record, Appointments, Exam, School Years) are now white cards with dark titles instead of solid teal blocks.

**Dashboard:** four cards: Registered students, Examined this year (with %), Today's appointments (done, waiting, absent), and Latest examinations.

**Tables and lists:**
- upper-case muted column headers;
- 11 × 14 px cell padding;
- a teal row hover;
- rounded section boxes;
- pill-shaped tags (Yes/No consent, health alerts).

**Feedback:** dark toasts readable on any page; a confirmation dialog for discarding; inline form errors; "Saving…" states on buttons.

**Responsive behaviour:**
- **Header:** up to 860 px wide, the menu moves to its own full-width row and the header stops being sticky, to save height.
- **Phone (≤ 600 px):**
  - stats in 2 columns, with Latest examinations full width;
  - the search box on its own line, with Refresh and CSV side by side;
  - grade tabs in a 3 × 2 grid;
  - section cards in 2 columns;
  - the registration form edge to edge with a full-width Confirm button.
- **Tooth chart:** quadrant rows on phones, and it no longer hides behind the sticky bar.
- **Reduced motion:** honoured (`prefers-reduced-motion`).

---

## 5. Bug Fixes

| Bug | Fix | How it was verified |
|---|---|---|
| Messages invisible outside the student list | Toast moved to the page body | `redesign_test`: after saving an exam from the Appointments page, `#toast` is visible and reads "✓ Saved on this device – uploading now". |
| Unsaved exam lost on Back, Cancel or the menu | Discard dialog plus `beforeunload` | `redesign_test` covers: Back asks; Keep editing keeps tooth 11; the menu asks; Discard leaves with 0 exams saved; no question when unchanged; no question after saving. |
| Double tap on Save could submit twice | `form.saving` guard | `redesign_test`: a double click on Save gives exactly 1 exam in the database. |
| Bad registration input caused 500s or stored junk | Server validation | `reg2_test` API checks: a future birthdate gives 400; "hello" as a birthdate gives 400 (not 500); age "abc" is stored as null; an unknown condition is dropped; 5,000-character allergies are trimmed to 300; blood type is not stored. |
| Bottom teeth under the sticky bar on phones | `scroll-padding-bottom` | Found by `ui_test` (touch double-tap and slide on teeth 41–44 failed: the tap landed on the Save bar). After the fix the test passes and teeth 41–44 are Decayed. |
| Saved-row highlight lost on redraw | `ap.flashUntil` | `ui_test` "saved row highlighted" passes every time. It had been intermittent. |
| "Weight" shown for every student | Shown only when present | Visual check of the record page. |

---

## 6. Code and Architecture Improvements

- **No new dependencies or frameworks.** The same vanilla JS pages, Vercel functions and Neon database.
- **One new endpoint:** `api/stats.js`. It reuses the shared helpers (`_auth.js`, `_sy.js`, `_visit.js` `validDate`).
- **One design system:** a single token layer (`:root` variables) and component rules appended to `Students.html`, so older rules inherit the new values, plus a matching block in `StudentReg.html`. Shared button classes: `.secondary`, `.btn-danger`, `.btn-complete`, `.mini-btn`.
- **Unsaved-change logic** is self-contained in `Dental.js`: `examSnapshot`, `isExamDirty`, `askDiscard`, `resetExamHooks`.
- **Navigation highlighting** is centralised in `show()`, the single function that switches pages.
- **Validation:**
  - Registration has small, testable helpers (`cleanConditions`, `cleanBirthdate`, `cleanAge`) on the server and `validateForm`/`setFieldError` on the client.
  - An unused `orNull` helper was removed from `api/register.js`.
- **Service worker:** cache version bumped (`dental-app-shell-v3`) so devices pick up the new design. It is still network-first, so new and old files never mix.
- Grade-tab and section-card dashboard code from the previous update was kept and restyled. Search no longer depends on the hidden grade drop-down.

---

## 7. Security and Data Integrity

**Checked:**
- **SQL:** all queries are parameterised (Neon tagged templates). No string-built SQL.
- **XSS:** all student data is rendered with `textContent` or `createTextNode`. The only `innerHTML` uses are fixed strings.
- **Authentication:** every dentist endpoint (`students`, `visits`, `appointments`, `sync`, `history`, `schoolyears`, `identity`, `stats`) checks the HMAC-signed 12-hour token. The new `stats` endpoint does too.
- **Public endpoints:** only `register` (create a registration) and `codes` (grade, section and code only, with no names). The registration response never reveals returning-student matches.
- **Secrets:** none in the code. The database URL and dentist login are Vercel environment variables. The report contains no student data.
- **Errors:** messages are generic ("Database error. Please try again."). Details go only to the server log, and student details are never put in error messages.
- **Deletion safeguards:** removing a student is a soft delete (records kept). Discarding unsent offline changes and removing students both ask twice. Starting a school year requires typing the year twice, and is refused while uploads are pending.

**Fixed in this round:** registration input validation (section 3) and the security headers in `vercel.json`.

**Remaining risks (not fixed; see section 10):**
- **No rate limiting** on the public registration endpoint, so a person could submit many fake registrations.
- **One shared dentist account.** Actions are recorded under that one username, not per person.
- **Login token storage:** the token is kept in the browser's localStorage for offline use. Anyone with access to an unlocked, logged-in device can see records for up to 12 hours. Always log out on shared devices.
- **Grade and section not checked on the server:** the server accepts any grade or section text; the form only offers the school's list.
- **CSV download:** the file contains student information and is saved on the device that downloads it.

The app has not had a professional security audit, so it is not claimed to be fully secure.

---

## 8. Testing Results

**Environment.** Tests ran against a local copy of the app:
- PostgreSQL 16 with the project's `schema.sql`;
- the project's API files run through a small Vercel-style Node server, with the Neon driver replaced by a stand-in that sends the same SQL to the local Postgres;
- headless Chromium (Playwright) in desktop (1280–1366 px) and phone (390 px, touch) modes.

All records are synthetic: fake names, the `test-students.sql` data, and seeded "last year" students.

**Not tested:** the live Vercel deployment and the real Neon database. That needs uploading and running `schema.sql` (see section 10).

| Test suite | Result | What it covers |
|---|---|---|
| Syntax check (`node --check`, all 25 JS files) | **Passed** | Every frontend and API file parses. |
| `api_test.py`, backend | **Passed** (all expected results) | Returning-student matching (auto, pending, new); duplicate codes give 409; link and reject; active-year roster; history across years; batch sync idempotency (retry and lost receipt give no duplicates); conflict not applied; invalid tooth condition refused; school-year start, repeat, archive and snapshot. |
| `ui_test.py`, full workflow | **Passed, 66/66** | Separate list and exam pages; scroll restore; no removed fields; new conditions; mouse drag Sound/Decayed both directions; no duplicates; tap and double-tap; absent and Mark as Arrived; offline save, reload, auto-upload and no duplicates; network failure and retry; refused upload, failed and discard; edit conflict and keep both; history across years; returning-student confirmation; school-year start; archive viewing online and offline; phone quadrant layout; touch drag and double-tap drag; no page scroll while marking; vertical swipe scrolls; no console errors. |
| `redesign_test.py`, new features | **Passed, 18/18** | Menu highlights Students and Appointments; dashboard numbers equal database counts and update after an exam; latest exams list; legend on all 10 conditions; discard dialog (Back, menu, Keep editing, Discard, unchanged, after save); double-click save gives 1 exam; toast visible on the Appointments page; visible keyboard focus; no console errors. |
| `reg2_test.py`, registration | **Passed, 15/15** | Phone and desktop: empty submit gives 5 inline errors and focus on the name; an error clears when fixed; a future birthdate is refused inline; a valid registration is saved with the correct section and age. API: a future or invalid birthdate gives 400 (not 500); bad age, unknown condition, long text and removed fields are cleaned. |
| `reg_test.py` | **Passed, 4/4** | No class list on the form; save; taken-code warning. |
| `dash_test.py`, grade and section navigation | **Passed, 22/22** | Tabs for Grades 7–12; cards; one section at a time; quick switch; back from a record returns to the same section; remembered after reload; search across all grades (desktop and phone). |
| `class_test.py`, sections and strands | **Passed, 20/20** | Registration grade and section lists; only that grade's sections; dentist cards in the school's order; edit form; Appointments picker. |
| `scroll_test.py`, long lists | **Passed, 8/8** | A 30-student list scrolls inside its box; redraws keep the position; return after saving lands at the same spot (iPad and phone). |
| `old_test.py`, Kinder–Grade 6 removal | **Passed, 8/8** | Hidden from all lists and search; one-button removal; Grade 7–12 untouched. |
| `grade_test.py` | **Passed, 5/5** | Only Grade 7–12 tabs and Appointments grades. |
| Visual review (screenshots) | **Done** | Login, dashboard, section, Appointments, exam, discard dialog, record and School Years on desktop; dashboard, exam and registration on phone. |
| Live deployment (Vercel + Neon) | **Not run** | No access to the live site or database from the test environment. |
| Screen-reader testing | **Not run** | Only labels, ARIA attributes and focus were checked in code and the browser. |

---

## 9. Files Changed

| File | Change |
|---|---|
| `Students.html` | New header with navigation, school year, sync status and Log out; toast moved to the page body; discard dialog; dashboard summary container; toolbar simplified; search label; design-system CSS; responsive rules; scroll padding; compact Absent box. |
| `Students.js` | Dashboard summary (`loadStats`, `renderStats`; offline copy); signed-in state for the header; Students highlighted after login; stats cleared on logout; hint shown only with a table; search independent of the hidden drop-down. |
| `Dental.js` | Navigation highlighting in `show()`; unsaved-changes guard (Back, Cancel, menu, tab close); double-save guard; clearer save-error message; colour legend on condition chips; weight only for older records. |
| `Appointments.js` | Compact Absent box when empty; saved-row highlight survives redraws. |
| `StudentReg.html` | Redesign (same design system); required markers; `novalidate`; status message area. |
| `StudentReg.js` | Inline validation (`validateForm`, `setFieldError`); birthdate max = today; single-submit "Saving…" state; coloured success and error messages. |
| `api/register.js` | Server-side validation (birthdate, age, conditions, text lengths); removed fields no longer accepted; `no-store`; unused helper removed. |
| `api/stats.js` | **New:** dentist-only dashboard numbers from the database. |
| `vercel.json` | Security headers added (the existing `/` → registration redirect kept). |
| `sw.js` | Cache version v3, so devices load the new design. |
| `APP_IMPROVEMENT_REPORT.md` | **New:** this report. |
| `backup-2026-10-20-before-redesign/` | **New:** copy of every file before this work. |

No files were deleted, and the database schema was not changed.

---

## 10. Remaining Issues and Recommendations

**To do when deploying:**
1. Upload the changed files above to the `dental-app2` repository: the top-level files, the two `api` files, and `vercel.json`.
2. If not done yet, run `schema.sql` in the Neon SQL Editor. The dashboard summary uses the `school_year` columns it adds.
3. After Vercel shows **Ready**, log in once on each device so it loads the new version.

**Recommended future work (not done):**
- **Rate limiting** on `/api/register`, for example a Vercel Firewall rule or a simple per-IP counter, to stop spam registrations.
- **Personal dentist or nurse accounts** with roles, so actions are recorded per person and access can be withdrawn individually.
- **Server-side grade and section whitelist**, by moving the `SchoolClasses.js` list into a database table that both the server and the pages read.
- **Printable reports:** a per-section DMFT summary and class attendance report for the school head.
- **Automated tests in the repository**, so they can be re-run after every change. The tests used here live outside the app folder.
- **Screen-reader testing** with VoiceOver or TalkBack.

---

## 11. Final Summary

- **Functional:** examinations can't be lost by accident; confirmation messages now appear on every page; saves can't be duplicated; the bottom tooth row is reachable on phones; the dentist has a live summary of students, exams and today's appointments.
- **Data integrity and security:** the public registration endpoint validates and cleans every field. Removed personal fields are no longer accepted. Security headers protect the site.
- **Visual and UX:** one professional, accessible design across every page, with clear navigation, consistent buttons, inputs and cards, a tooth-chart colour key, clearer forms with inline errors, and layouts tuned for desktop, tablet and phone.
- **Verified:** about 170 automated checks across 10 suites passed on the local replica. The live deployment still needs the upload steps in section 10.

---

## 12. Update (November 2026): Dental Records, School-Year History and Tooth Map

### What was added

| Area | Change |
|---|---|
| Printable dental record | "🖨 Print dental record" on every student record (and on archived records). Builds an A4 PDF for **that student only**: school name, school year, name, code, grade/section, age, exam date, tooth chart, findings, DMFT, notes, every earlier examination in date order, colour key, "Page X of Y". Download it or open it to print. Made in the browser by `DentalRecordPDF.js` (no external library). |
| Permanent history | Examinations from **all** school years are shown on the record, grouped by school year with the grade/section the student had *at that time*. Newest/oldest order toggle. Old exams keep their own year/grade/section, so editing the current class never changes them. |
| Compare | "Compare examinations" card: choose any two exams (defaults to the latest vs. the latest of an earlier school year). Side-by-side charts, changed teeth outlined, DMFT for each and a list of changed teeth. |
| Pagination | Section lists, search results and archived-year lists show 25 per page. The page, grade, section and filter are kept when you open a record, come back, or refresh. Previous / Next student buttons on the record ("26 of 32"). |
| School year selector | On the Students page: the active year plus every archived year (read only). Choosing an archived year opens its records. |
| Returning students | On an archived record: "Enrol in <active year>" (suggests the next grade). Creates the new year's registration linked to the **same student identity** — no duplicate student, history continues. Enrolling twice is refused. |
| Auto "Sound" | When a **new** exam is saved, teeth the dentist did not mark are saved as Sound. Marked conditions are kept. Edits of old exams are never auto-filled. |
| Tooth map | Tap/click = Decayed immediately. Double-tap/double-click = undo (back to unmarked). Slide across teeth = Decayed. Vertical swipe on a phone still scrolls. |
| Safety | `api/students.js` DELETE is now a soft delete (`removed_at`); exams, appointments and archives are kept. |

### Important deployment note
The GitHub repository still had **older** copies of `api/students.js`, `api/visits.js`, `api/appointments.js` and `schema.sql`. The old `api/students.js` **hard-deleted** students (and with them their examinations). Students removed with the old version (for example Kinder–Grade 6) cannot be brought back by the app; check Neon's point-in-time restore if they are needed. Upload the new files and run the full `schema.sql` in Neon (safe to run more than once).

### Testing (local Postgres 16 + Vercel-like server + Playwright, desktop and phone)
| Suite | Result |
|---|---|
| Core workflow (ui_test) | 67/67 |
| Dashboard grades/sections (dash_test) | 22/22 |
| Section list scroll / absent filter | 8/8, 24/24 |
| Redesign / conditions / registration | 18/18, 13/13, 15/15 |
| New tooth-map gestures (tap_test) | 17/17 |
| History, compare and PDF (pdf_test) | 8/8 |
| Pagination, Prev/Next, year selector, new school year, archive PDF, enrolment, no duplicates, history unchanged, refresh (feature_test) | 28/28 |

Only made-up test students were used.

### Files changed
`Students.html`, `Students.js`, `Dental.js`, `SchoolYearDentalRecords.js`, `SchoolClasses.js` (new `SCHOOL_NAME`), `sw.js` (cache v4), **new** `DentalRecordPDF.js`, `api/students.js` (soft delete + enrol), `api/visits.js` (history across years), `api/appointments.js`, `schema.sql`.

### Remaining issues / recommendations
- Set your school's name in `SchoolClasses.js` (`SCHOOL_NAME`); it appears on the PDF.
- Auto-Sound marks every unmarked tooth of the examined chart as Sound — including third molars that have not come in. Mark those **Unerupted** before saving.
- Tooth conditions are stored per exam as JSON (not a separate table). This is enough for history, compare and PDF; a separate table would only be needed for school-wide statistics per tooth.
- Exam history is loaded per student when the record opens (not all at once), and lists are paged; very large schools may later want server-side paging of the roster.
- This is not a security certification: keep the dentist password strong and private.

---

## 13. Update (November 2026): Quick notes, new conditions, redesign v2

- **Dentist quick notes:** Presence of Calculus, With Orthodontic Appliance, Upper, Lower (added to the notes; tap again to remove).
- **New tooth conditions:** Composite filled (CF), Amalgam filled (AF), Indicated for extraction (X), Carious tooth (C), Erupting (E). DMFT: Carious and Indicated for extraction count as D; Composite and Amalgam as F; Erupting not counted.
- **Compare:** the tooth-by-tooth list is hidden behind a button (choice remembered per device).
- **Redesign v2** (ui-ux-pro-max: Minimalism/Swiss style, calm clinical teal, Atkinson Hyperlegible font):
  - SVG icons instead of emoji; one consistent button family; 44px+ touch targets; visible focus rings; reduced-motion support.
  - Phones: bottom tab bar (Students / Appointments / School Years); save bar fixed at the bottom of the examination.
  - Examination: Permanent/Primary switch above the tooth map; selected-tooth panel right under the map; conditions grouped (Common, Restorations, Problems, Eruption) and swipeable on phones.
  - Student record: "Add examination" is the main button at the top; editing name/class/code is folded away; empty medical box is one line.
  - Registration page: same colours and font, larger tick boxes.
- Tests: all suites pass (core 67, dashboard 22, redesign 18, features 28, conditions 25, quick notes 22, compare 12, tooth map 17, PDF 8, registration 15, absent 24, scroll 8).

---

## 14. Update (November 2026): My Dental Record – students see their records online

- **Flow:** the registration form now asks for a birthdate and a password; after Confirm the student goes straight to their home screen (MyRecords.html). Later they sign in with **name + birthdate + password**.
- **Home screen:** profile (class, code, school year, age), stats, latest check-up (tooth chart, findings, DMFT, tooth notes, dentist's notes), all check-ups grouped by school year, appointments, Download PDF, change password, sign out.
- **Privacy / security:**
  - passwords hashed with scrypt; 5 wrong tries lock the account for 15 minutes; generic error messages;
  - student sessions use a different signing key from the dentist (a student token cannot open dentist pages); changing the password ends old sessions; session ends when the tab closes;
  - a returning student who makes a password on the public form sees only this year until the dentist confirms it's them (record page → "Online dental record" → Confirm);
  - students who registered before this feature (or forgot their password) get a one-time **set-up code** from the dentist (valid 14 days, single use, birthdate must match).
- **Dentist:** new "Online dental record" card on each student record: status (Not set up / Code given / Waiting for you / Active), Create set-up code, Confirm.
- **Database:** new table `student_accounts` (added to Neon on 22 Nov 2026; also in schema.sql). Linking/unlinking returning students moves the account with the registration.
- **Code:** shared tooth-chart code moved to `DentalCore.js` (used by the dentist pages and MyRecords). New: `MyRecords.html`, `MyRecords.js`, `api/portal.js`, `api/_student.js`. Changed: `StudentReg.html/js`, `api/register.js`, `api/identity.js`, `Students.html`, `Dental.js`, `sw.js`, `vercel.json`, `schema.sql`.
- **Tests:** portal suite 57/57 (desktop + phone: register → home, exams/notes/appointments shown, PDF, sign out/in, wrong password + lockout, change password, returning-student confirmation, set-up code incl. wrong birthdate + single use, next school year re-registration); all earlier suites still pass.

---

## 15. Update (November 2026): Pre-launch security checklist (20 items)

| # | Item | Status in this app |
|---|---|---|
| 1 | Hide API keys | No keys in the pages or the code; the database URL and dentist login live only in Vercel environment variables. `.env.local` (local runs) is git-ignored. |
| 2 | Purge Git secrets | All 54 commits of the GitHub repository scanned for database URLs, passwords, tokens and private keys: none found (only the example text in Start-Local.bat). |
| 3 | Public DB key | Not applicable: the browser never talks to the database; only the server functions do. |
| 4 | Row-level security | RLS enabled on every table (schema.sql). The app's own owner role is unaffected; any other role or Neon's Data API sees nothing. |
| 5 | Encrypt sensitive data | HTTPS in transit, Neon encrypts at rest (AES-256), passwords scrypt-hashed, set-up codes and network addresses stored only as hashes. |
| 6 | Server-side auth | Every dentist endpoint checks a signed token; every student endpoint checks the student's own token. |
| 7 | Lock record access | Students only get their own identity's records; earlier years only after dentist confirmation. |
| 8 | Block field tampering | Servers accept only known fields; who saved an exam is set by the server; grade/section checked against the school's list (`api/_classes.js` reads SchoolClasses.js). |
| 9 | Secure session cookies | Sign-in now also sets an **HttpOnly, Secure, SameSite=Strict** cookie; the server only accepts a request when the token AND the cookie match, so a copied token is useless. Logging out clears it. |
| 10 | Hash passwords | scrypt with a random salt (students); dentist password compared in constant time. |
| 11 | Rate-limit login | Dentist login 10 tries / 15 min per network (60 total); student sign-in 60 / 15 min per network + 5 wrong passwords lock the account; set-up codes 20 / 15 min; table `rate_limits` creates itself. |
| 12 | Bot protection | Registration: hidden honeypot field, minimum fill time, 150 registrations per network per hour. |
| 13 | Parameterised queries | All SQL uses tagged templates; no string-built SQL. |
| 14 | Validate all input | Dates, codes, lengths, conditions, tooth numbers, grade/section, passwords validated on the server. |
| 15 | Escape user content | All user text shown with textContent; CSV export neutralises spreadsheet formulas (`=`, `+`, `-`, `@`). |
| 16 | Restrict file uploads | The app has no file uploads. |
| 17 | Trim API responses | Public/student responses return only what the page needs (registration no longer returns the internal id). |
| 18 | Security headers | Content-Security-Policy (no inline scripts, no eval, no framing), HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP. Inline service-worker script moved to `sw-register.js`. |
| 19 | Force HTTPS | Vercel redirects HTTP → HTTPS; HSTS (2 years) + `upgrade-insecure-requests`. |
| 20 | Scan dependencies | One runtime dependency (`@neondatabase/serverless` ^1.0.0, latest 1.x installed on every Vercel build). `npm audit` could not be run from the test environment (registry blocked); turn on GitHub Dependabot alerts. |

Tests: new security suites 15/15 and 34/34 (with the CSP switched on), plus every earlier suite passes (core 67, portal 57, registration 15, features 28, redesign 18, dashboard 22, conditions 13+25, tooth map 17, PDF 8, absent 24, scroll 8, quick notes 22, compare 12, intro 22).

---

## 16. Update (November 2026): Attack test of the app (own app, local copy)

An automated attack suite (`attack_test.py`, 39 checks) was run against a local copy with the security settings on.

**Held up:** forged/foreign tokens on every dentist endpoint; a student reading or changing other students; students using dentist actions; SQL injection in sign-in, registration and ids; stored XSS through a student name (shown as text only); extra fields in registration (no mass assignment); oversized names (cut to 120 chars); 5,000 fake teeth; wrong data types; broken JSON; `__proto__`; error messages (no internal details); cross-site requests with only the cookie; page scripts reading the session cookie.

**Found and fixed:**
| Severity | Weak point | Fix |
|---|---|---|
| **High** (local server only) | `local-server.mjs` served `.env.local` (database password) to anyone on the same Wi-Fi via `/x/..%2f.env.local` | Only plain file names of page/script/image types in the app folder are served; dotfiles, `.sql`, `.mjs`, sub-folders and `..` never are |
| **Medium** (local server only) | One malformed web address (`/%E0%A4%A`) crashed the local server | Bad addresses get "400 Bad request"; the server keeps running |
| Medium | Anyone could lock the dentist out of logging in for 15 min with 60 wrong passwords (global cap) | **Trusted device:** after a successful login the browser gets a signed HttpOnly cookie (90 days); the global cap only applies to browsers that never logged in. Per-network limit stays |
| Medium | Per-network limits trusted the `X-Forwarded-For` header, which a visitor can fake outside Vercel | On Vercel the platform's own header is used; elsewhere only the real connection address |
| Low | Student sign-in said "ask the dentist for a set-up code" only when the student existed (reveals who is registered) | Same message for every failure; the set-up code hint is now always shown on the page |
| Low | A classmate who knows a name + birthdate could lock a student out | Trusted device for students too: their own phone can still sign in while others are locked out |
| Low | Project files (`schema.sql`, this report, `local-server.mjs`, `Start-Local.bat`, `package.json`) were downloadable from the website | `.vercelignore` + redirects keep them off the website |
| Info | Password comparison could reveal the password's length by timing | Both sides hashed before a constant-time compare |

**Remaining (accepted):** a student with a known name + birthdate can be locked out on *other* devices for 15 minutes; the dentist account is shared (one password) – use a long, unique password.

## 17. Update (November 2026): Teacher accounts and student approval

**What changed**
- **Teacher accounts (Teacher.html).** Each section adviser makes their own account: name, the grade and section they handle, a username and a password of at least 8 characters. The school dentist approves new teacher accounts on the new **Teachers** page (4th menu item; a red number shows how many are waiting). The dentist can also change a teacher's section or remove an account.
- **Students wait for their teacher.** A student who registers now sees "Waiting for your teacher (Grade – Section)" instead of their record. The page checks again by itself every minute. When the section's teacher approves them, My Dental Record opens. If the teacher taps **Not my student**, the student is told to talk to the teacher or the dentist; a teacher can still approve later if that was a mistake. If a section has no teacher yet, students keep waiting and are asked to remind their teacher to sign up. Only teachers approve students.
- **Moving a student.** A teacher can **Move** a student who chose the wrong section. The student gets the next free number in the new section (or a number the teacher types, which must be free). Their waiting appointments move with them, and they then wait for the new section's teacher to approve them.
- **Privacy.** Teachers only see each student's name, code, birthdate and registration date. They never see dental or medical data. A teacher can only act on students in their own section in the active school year.
- **Older registrations.** Students who registered before this update are counted as already approved, so nobody loses access.

**Security.** Teacher sessions use their own signed token plus an HttpOnly cookie (`tsess`), separate from the dentist's and the students' sessions; a teacher token can't open dentist or student pages. Five wrong passwords lock a teacher account for 15 minutes, and sign-in and sign-up are rate-limited. Sign-up uses the same bot checks as registration, and the new table has row-level security on.

**Technical.** The teacher API is served through `/api/portal?as=teacher`, because Vercel's free plan allows 12 functions and the app already uses 12. The `teachers` table and 3 new `students` columns (`teacher_status`, `teacher_id`, `teacher_decided_at`) are created automatically the first time they're needed; they're also in `schema.sql`. The new test suite `teacher_test.py` passes 86/86, and every earlier suite still passes.
