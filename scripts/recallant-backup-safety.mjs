const rehearsalDatabasePattern = /^recallant_rehearsal_[a-f0-9_]{32,}$/;

export function assertSafeRehearsalDatabase(targetDatabase, sourceDatabase) {
  if (!rehearsalDatabasePattern.test(targetDatabase)) {
    throw new Error("Rehearsal database target is outside the dedicated namespace");
  }
  if (targetDatabase === sourceDatabase) {
    throw new Error("Production database cannot be a rehearsal target");
  }
  return true;
}
