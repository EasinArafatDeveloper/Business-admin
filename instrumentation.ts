/** Runs once when the server starts: apply database migrations, then start the sending queue and email reply sync. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runMigrations } = await import("./db/migrate");
  // After a reboot Postgres can still be starting up: retry for ~2 minutes, then give up so the container restarts.
  for (let attempt = 1; ; attempt++) {
    try {
      await runMigrations();
      break;
    } catch (err) {
      if (attempt >= 24) {
        console.error("[db] database not reachable, exiting so Docker restarts the app", err);
        process.exit(1);
      }
      console.warn(`[db] database not ready (attempt ${attempt}), retrying in 5s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { startCampaignWorker } = await import("./lib/campaigns");
    await startCampaignWorker();
    const { startInboxSync } = await import("./lib/email-inbox");
    startInboxSync();
  }
}
