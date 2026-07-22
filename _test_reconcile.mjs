// Local harness: stubs global fetch (Graph + Resend) and the neon sql
// client to test reconcileRange end to end without touching production.
process.env.AZURE_TENANT_ID = "t";
process.env.AZURE_CLIENT_ID = "c";
process.env.AZURE_CLIENT_SECRET = "s";
process.env.RESEND_API_KEY = "re_test";

const sentEmails = [];
let liveEvent = null; // what Graph reports for the booking's event

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("login.microsoftonline.com")) {
    return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
  }
  if (u.includes("graph.microsoft.com") && u.includes("/events/")) {
    if (liveEvent === null) return new Response("", { status: 404 });
    return new Response(JSON.stringify(liveEvent), { status: 200 });
  }
  if (u.includes("api.resend.com")) {
    sentEmails.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
  }
  throw new Error("unexpected fetch: " + u);
};

// Minimal in-memory bookings table behind a neon-style tagged template.
let table = [];
function makeSql() {
  return (strings, ...vals) => {
    const q = strings.join("$").replace(/\s+/g, " ");
    if (q.startsWith(" SELECT") || q.startsWith("SELECT")) {
      return Promise.resolve(table.map((r) => ({ ...r })));
    }
    if (q.includes("UPDATE bookings SET")) {
      const [newDate, newTime, id, oldDate, oldTime, exDate, exTime] = vals;
      const occupied = table.some((r) => r.id !== vals[2] && keyOf(r) === `${exDate}|${exTime}`);
      const row = table.find((r) => r.id === id && keyOf(r) === `${oldDate}|${oldTime}`);
      if (!row || occupied) return Promise.resolve([]);
      row.booking_date = newDate; row.booking_time = newTime;
      return Promise.resolve([{ id: row.id }]);
    }
    if (q.includes("DELETE FROM bookings")) {
      const id = vals[0];
      const before = table.length;
      const matches = (r) => vals.length >= 3
        ? r.id === id && keyOf(r) === `${vals[1]}|${vals[2]}`
        : r.id === id;
      const removed = table.filter(matches).map((r) => ({ id: r.id }));
      table = table.filter((r) => !matches(r));
      return Promise.resolve(q.includes("RETURNING") ? removed : new Array(before - table.length));
    }
    throw new Error("unexpected sql: " + q);
  };
}
const keyOf = (r) => `${new Date(r.booking_date).toISOString().split("T")[0]}|${r.booking_time}`;

const { reconcileRange } = await import("./api/_reconcile.js");

function seed() {
  table = [{
    id: 7, booking_date: "2026-07-24", booking_time: "11:00",
    customer_name: "Test Customer", customer_email: "customer@example.com",
    project_address: "123 Test Ln", graph_event_id: "evt1",
  }];
  sentEmails.length = 0;
}
const ev = (start, end) => ({ isCancelled: false, start: { dateTime: start }, end: { dateTime: end } });
let failures = 0;
function check(name, cond, detail) {
  if (!cond) { failures++; console.log("FAIL:", name, detail ?? ""); }
  else console.log("pass:", name);
}

// 1. Unchanged event: no emails, row intact.
seed();
liveEvent = ev("2026-07-24T11:00:00.0000000", "2026-07-24T13:00:00.0000000");
let r = await reconcileRange(makeSql(), "https://test", "2026-07-01", "2026-07-31");
check("unchanged: no emails", sentEmails.length === 0 && r.moved === 0 && r.freed === 0);
check("unchanged: row active at 11:00", r.active.length === 1 && r.active[0].windowId === "11:00");

// 2. Dragged to Friday 5-7 PM window: row moves, both branded emails sent with correct labels.
seed();
liveEvent = ev("2026-07-24T17:00:00.0000000", "2026-07-24T19:00:00.0000000");
r = await reconcileRange(makeSql(), "https://test", "2026-07-01", "2026-07-31");
check("drag to window: moved=1, freed=0", r.moved === 1 && r.freed === 0, JSON.stringify(r));
check("drag to window: 2 emails", sentEmails.length === 2, sentEmails.length);
check("drag to window: owner email first", sentEmails[0]?.to === "schedule@belvederedecks.com");
check("drag to window: customer addressed", sentEmails[1]?.to === "customer@example.com");
check("drag to window: subject says RESCHEDULED + new time",
  /RESCHEDULED: your site visit is now Friday, July 24, 2026, 5:00 - 7:00 PM/.test(sentEmails[1]?.subject || ""), sentEmails[1]?.subject);
check("drag to window: old window struck through in body",
  (sentEmails[1]?.html || "").includes("line-through") && (sentEmails[1]?.html || "").includes("11:00 AM - 1:00 PM"));
check("drag to window: db row now 17:00", table[0].booking_time === "17:00" && table[0].booking_date === "2026-07-24");

// 3. Dragged to an off-window time (9:15-10:45): row freed, emails carry EXACT times.
seed();
liveEvent = ev("2026-07-24T09:15:00.0000000", "2026-07-24T10:45:00.0000000");
r = await reconcileRange(makeSql(), "https://test", "2026-07-01", "2026-07-31");
check("off-window: freed=1", r.freed === 1 && r.moved === 0, JSON.stringify(r));
check("off-window: 2 emails with exact times",
  sentEmails.length === 2 && /9:15 AM - 10:45 AM/.test(sentEmails[1]?.subject || ""), sentEmails[1]?.subject);
check("off-window: row released", table.length === 0);

// 4. Event deleted in Outlook: row freed AND branded cancellation pair sent.
seed();
liveEvent = null;
r = await reconcileRange(makeSql(), "https://test", "2026-07-01", "2026-07-31");
check("deleted: freed=1, 2 emails", r.freed === 1 && sentEmails.length === 2, JSON.stringify(r));
check("deleted: owner email first", sentEmails[0]?.to === "schedule@belvederedecks.com");
check("deleted: customer subject has date",
  /Cancelled: your site visit on Friday, July 24, 2026/.test(sentEmails[1]?.subject || ""), sentEmails[1]?.subject);
check("deleted: owner subject has window",
  /Cancelled: Test Customer, Friday, July 24, 2026, 11:00 AM - 1:00 PM/.test(sentEmails[0]?.subject || ""), sentEmails[0]?.subject);
check("deleted: row gone", table.length === 0);

// 4b. Two reconcilers race after one deletion: cancellation emailed exactly once.
seed();
liveEvent = null;
const sqlDel = makeSql();
await Promise.all([
  reconcileRange(sqlDel, "https://test", "2026-07-01", "2026-07-31"),
  reconcileRange(sqlDel, "https://test", "2026-07-01", "2026-07-31"),
]);
check("deleted race: exactly 2 emails total", sentEmails.length === 2, sentEmails.length);

// 5. Two reconcilers race after one drag: emails sent exactly once.
seed();
liveEvent = ev("2026-07-24T17:00:00.0000000", "2026-07-24T19:00:00.0000000");
const sql = makeSql();
await Promise.all([
  reconcileRange(sql, "https://test", "2026-07-01", "2026-07-31"),
  reconcileRange(sql, "https://test", "2026-07-01", "2026-07-31"),
]);
check("race: exactly 2 emails total (one winner)", sentEmails.length === 2, sentEmails.length);

// 6. Target window already taken by another booking: row stays, no emails.
seed();
table.push({
  id: 8, booking_date: "2026-07-24", booking_time: "17:00",
  customer_name: "Other", customer_email: "o@example.com",
  project_address: "9 Elm", graph_event_id: null,
});
liveEvent = ev("2026-07-24T17:00:00.0000000", "2026-07-24T19:00:00.0000000");
r = await reconcileRange(makeSql(), "https://test", "2026-07-01", "2026-07-31");
check("conflict: no move, no emails", r.moved === 0 && sentEmails.length === 0, JSON.stringify(r));

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL TESTS PASSED");
process.exit(failures ? 1 : 0);
