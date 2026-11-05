/** Runs once when the server starts: apply database migrations, then start the SMS sending queue. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runMigrations } = await import("./db/migrate");
  await runMigrations();
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { startCampaignWorker } = await import("./lib/campaigns");
    await startCampaignWorker();
  }
}
